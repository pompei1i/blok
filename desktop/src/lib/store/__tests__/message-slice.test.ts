import { describe, it, expect, beforeEach, vi } from "vitest";
import { useServerStore } from "../server-store";
import type { Message } from "../types";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeMessage(id: string, channelId: string, createdAt = "2024-01-15T12:00:00Z"): Message {
  return {
    id,
    channelId,
    authorId: "u1",
    content: "hello",
    isEdited: false,
    isPinned: false,
    createdAt,
    updatedAt: createdAt,
    attachments: [],
    reactions: [],
  };
}

function makeDbRow(id: string, channelId: string, createdAt = "2024-01-01T00:00:00Z") {
  return {
    id,
    channel_id: channelId,
    author_id: "u1",
    reply_to_id: null,
    content: `msg ${id}`,
    is_edited: false,
    pinned: false,
    created_at: createdAt,
    updated_at: createdAt,
    author: { id: "u1", username: "alice", display_name: "Alice", avatar_url: null, accent_color: null, pronouns: null },
    attachments: [],
    message_reactions: [],
  };
}

const q = () => (globalThis as Record<string, unknown>).__mockSupabaseQuery as Record<string, ReturnType<typeof vi.fn>>;

function resolveWith(data: unknown, error: unknown = null) {
  q().then.mockImplementationOnce((resolve: (v: unknown) => void) => resolve({ data, error }));
}

const BASE_STATE = {
  servers: [],
  activeServerId: null,
  activeChannelId: null,
  categories: {},
  channels: {},
  channelIndex: {},
  members: {},
  userProfileCache: {},
  memberUserIndex: {},
  messages: {},
  messageChannelIndex: {},
  lruChannelOrder: [],
  messagesLoaded: new Set<string>(),
  messagesLoading: new Set<string>(),
  messagesAtStart: new Set<string>(),
  typingUsers: {},
  openTabs: [],
  unreadCounts: {},
  activeVoiceChannelId: null,
  voiceParticipants: {},
  isMuted: false,
  isDeafened: false,
  isScreenSharing: false,
  screenShareUserId: null,
  remoteScreenStream: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  useServerStore.setState(BASE_STATE);
});

// ── loadMoreMessages ──────────────────────────────────────────────────────────

describe("loadMoreMessages", () => {
  it("does nothing when messagesAtStart already contains the channel", async () => {
    useServerStore.setState({
      messages: { c1: [makeMessage("m1", "c1")] },
      messagesAtStart: new Set(["c1"]),
    });

    await useServerStore.getState().loadMoreMessages("c1");

    expect(q().then).not.toHaveBeenCalled();
  });

  it("does nothing when messagesLoading already contains the channel", async () => {
    useServerStore.setState({
      messages: { c1: [makeMessage("m1", "c1")] },
      messagesLoading: new Set(["c1"]),
    });

    await useServerStore.getState().loadMoreMessages("c1");

    expect(q().then).not.toHaveBeenCalled();
  });

  it("does nothing when there are no existing messages for the channel", async () => {
    useServerStore.setState({ messages: {} });

    await useServerStore.getState().loadMoreMessages("c1");

    expect(q().then).not.toHaveBeenCalled();
  });

  it("prepends older messages before the existing ones", async () => {
    const existing = makeMessage("new-msg", "c1", "2024-01-15T12:00:00Z");
    useServerStore.setState({ messages: { c1: [existing] } });

    // DB returns rows in descending order; loadMoreMessages reverses them
    const olderRow = makeDbRow("old-msg", "c1", "2024-01-10T00:00:00Z");
    resolveWith([olderRow]);

    await useServerStore.getState().loadMoreMessages("c1");

    const messages = useServerStore.getState().messages["c1"];
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe("old-msg");
    expect(messages[1].id).toBe("new-msg");
  });

  it("maps DB row fields to the Message shape correctly", async () => {
    useServerStore.setState({ messages: { c1: [makeMessage("m1", "c1")] } });
    resolveWith([makeDbRow("old1", "c1", "2024-01-01T00:00:00Z")]);

    await useServerStore.getState().loadMoreMessages("c1");

    const prepended = useServerStore.getState().messages["c1"][0];
    expect(prepended.id).toBe("old1");
    expect(prepended.channelId).toBe("c1");
    expect(prepended.authorId).toBe("u1");
    expect(prepended.content).toBe("msg old1");
    expect(prepended.author?.username).toBe("alice");
  });

  it("sets messagesAtStart when fewer rows than PAGE_SIZE are returned", async () => {
    useServerStore.setState({ messages: { c1: [makeMessage("m1", "c1")] } });
    // Return 1 row — less than MESSAGE_PAGE_SIZE (30)
    resolveWith([makeDbRow("old1", "c1", "2024-01-01T00:00:00Z")]);

    await useServerStore.getState().loadMoreMessages("c1");

    expect(useServerStore.getState().messagesAtStart.has("c1")).toBe(true);
  });

  it("does not set messagesAtStart when a full page (30 rows) is returned", async () => {
    useServerStore.setState({ messages: { c1: [makeMessage("m1", "c1")] } });
    const fullPage = Array.from({ length: 30 }, (_, i) =>
      makeDbRow(`old-${i}`, "c1", `2024-01-01T0${String(i).padStart(2, "0")}:00:00Z`),
    );
    resolveWith(fullPage);

    await useServerStore.getState().loadMoreMessages("c1");

    expect(useServerStore.getState().messagesAtStart.has("c1")).toBe(false);
  });

  it("also sets messagesAtStart when the result is an empty array", async () => {
    useServerStore.setState({ messages: { c1: [makeMessage("m1", "c1")] } });
    resolveWith([]);

    await useServerStore.getState().loadMoreMessages("c1");

    expect(useServerStore.getState().messagesAtStart.has("c1")).toBe(true);
  });

  it("removes channelId from messagesLoading after a successful fetch", async () => {
    useServerStore.setState({ messages: { c1: [makeMessage("m1", "c1")] } });
    resolveWith([]);

    await useServerStore.getState().loadMoreMessages("c1");

    expect(useServerStore.getState().messagesLoading.has("c1")).toBe(false);
  });

  it("removes channelId from messagesLoading even when the fetch errors", async () => {
    useServerStore.setState({ messages: { c1: [makeMessage("m1", "c1")] } });
    resolveWith(null, { message: "fetch error" });

    await useServerStore.getState().loadMoreMessages("c1");

    expect(useServerStore.getState().messagesLoading.has("c1")).toBe(false);
  });

  it("indexes prepended messages in messageChannelIndex", async () => {
    useServerStore.setState({
      messages: { c1: [makeMessage("m1", "c1")] },
      messageChannelIndex: { m1: "c1" },
    });
    resolveWith([makeDbRow("old1", "c1", "2024-01-01T00:00:00Z")]);

    await useServerStore.getState().loadMoreMessages("c1");

    expect(useServerStore.getState().messageChannelIndex["old1"]).toBe("c1");
    expect(useServerStore.getState().messageChannelIndex["m1"]).toBe("c1");
  });

  it("queries using the oldest existing message's createdAt as the upper bound", async () => {
    const oldest = makeMessage("m1", "c1", "2024-01-05T08:00:00Z");
    const newer = makeMessage("m2", "c1", "2024-01-15T12:00:00Z");
    useServerStore.setState({ messages: { c1: [oldest, newer] } });
    resolveWith([]);

    await useServerStore.getState().loadMoreMessages("c1");

    expect(q().lt).toHaveBeenCalledWith("created_at", "2024-01-05T08:00:00Z");
  });

  it("does not modify other channels' messages", async () => {
    const c2Msg = makeMessage("c2msg", "c2", "2024-01-15T00:00:00Z");
    useServerStore.setState({
      messages: {
        c1: [makeMessage("m1", "c1")],
        c2: [c2Msg],
      },
    });
    resolveWith([makeDbRow("old1", "c1")]);

    await useServerStore.getState().loadMoreMessages("c1");

    expect(useServerStore.getState().messages["c2"]).toEqual([c2Msg]);
  });
});
