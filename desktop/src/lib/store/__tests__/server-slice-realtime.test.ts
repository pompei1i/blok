import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { useServerStore } from "../server-store";
import type { User } from "../types";

const ch = () => (globalThis as any).__mockChannel as Record<string, ReturnType<typeof vi.fn>>;
const q = () => (globalThis as any).__mockSupabaseQuery as Record<string, ReturnType<typeof vi.fn>>;

function resolveQuery(data: unknown) {
  q().then.mockImplementationOnce((resolve: (v: unknown) => void) => resolve({ data, error: null }));
}

function makeUser(id: string, username: string): User {
  return { id, username, email: `${username}@test.com`, displayName: username, createdAt: "" };
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
  screenSharers: {},
  watchingUserId: null,
};

function getRealtimeHandler(event: string, table: string): Function {
  const calls = ch().on.mock.calls as [string, Record<string, unknown>, Function][];
  const handler = calls.find(
    ([type, f]) => type === "postgres_changes" && f?.event === event && f?.table === table,
  )?.[2];
  if (!handler) throw new Error(`Handler not found for event="${event}" table="${table}"`);
  return handler;
}

function getReactionsHandler(): Function {
  const calls = ch().on.mock.calls as [string, Record<string, unknown>, Function][];
  const handler = calls.find(
    ([type, f]) => type === "postgres_changes" && f?.event === "*" && f?.table === "message_reactions",
  )?.[2];
  if (!handler) throw new Error("Reactions handler not found");
  return handler;
}

// Handlers captured once after initData — they close over the store's set/get,
// so they always act on the current state regardless of beforeEach resets.
let msgInsert: (p: unknown) => Promise<void>;
let attachInsert: (p: unknown) => void;
let serverInsert: (p: unknown) => void;
let profileUpdate: (p: unknown) => void;
let channelInsert: (p: unknown) => void;
let channelDelete: (p: unknown) => void;
let msgUpdate: (p: unknown) => void;
let reactionsCb: (p: unknown) => void;

beforeAll(async () => {
  useServerStore.setState(BASE_STATE);
  for (let i = 0; i < 4; i++) resolveQuery([]);
  await useServerStore.getState().initData("user-1");

  msgInsert = getRealtimeHandler("INSERT", "messages") as typeof msgInsert;
  attachInsert = getRealtimeHandler("INSERT", "attachments") as typeof attachInsert;
  serverInsert = getRealtimeHandler("INSERT", "servers") as typeof serverInsert;
  profileUpdate = getRealtimeHandler("UPDATE", "profiles") as typeof profileUpdate;
  channelInsert = getRealtimeHandler("INSERT", "channels") as typeof channelInsert;
  channelDelete = getRealtimeHandler("DELETE", "channels") as typeof channelDelete;
  msgUpdate = getRealtimeHandler("UPDATE", "messages") as typeof msgUpdate;
  reactionsCb = getReactionsHandler() as typeof reactionsCb;
});

beforeEach(() => {
  vi.clearAllMocks();
  // Restore single() default after clearAllMocks clears call records.
  q().single.mockResolvedValue({ data: null, error: null });
  useServerStore.setState(BASE_STATE);
});

// ── helpers ────────────────────────────────────────────────────────────────────

function makeMsgPayload(overrides: Record<string, unknown> = {}) {
  return {
    new: {
      id: "m-1", channel_id: "ch-1", author_id: "author-1",
      reply_to_id: null, content: "hello", is_edited: false,
      created_at: "2024-01-15T12:00:00Z", updated_at: "2024-01-15T12:00:00Z",
      ...overrides,
    },
  };
}

// ── messages INSERT ────────────────────────────────────────────────────────────

describe("realtime: messages INSERT", () => {
  it("adds message to state when channel is loaded", async () => {
    useServerStore.setState({
      messagesLoaded: new Set(["ch-1"]),
      messages: { "ch-1": [] },
      messageChannelIndex: {},
      activeChannelId: "ch-1",
      userProfileCache: { "author-1": makeUser("author-1", "alice") },
    });
    resolveQuery([]); // attachments

    await msgInsert(makeMsgPayload());

    const msgs = useServerStore.getState().messages["ch-1"];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe("m-1");
    expect(msgs[0].content).toBe("hello");
  });

  it("indexes the message in messageChannelIndex", async () => {
    useServerStore.setState({
      messagesLoaded: new Set(["ch-1"]),
      messages: { "ch-1": [] },
      messageChannelIndex: {},
      activeChannelId: "ch-1",
      userProfileCache: { "author-1": makeUser("author-1", "alice") },
    });
    resolveQuery([]);

    await msgInsert(makeMsgPayload());

    expect(useServerStore.getState().messageChannelIndex["m-1"]).toBe("ch-1");
  });

  it("does not add message when channel is not in messagesLoaded", async () => {
    useServerStore.setState({
      messagesLoaded: new Set<string>(),
      messages: { "ch-1": [] },
      activeChannelId: "ch-1",
      userProfileCache: { "author-1": makeUser("author-1", "alice") },
    });
    resolveQuery([]); // attachments still fetched unconditionally

    await msgInsert(makeMsgPayload());

    expect(useServerStore.getState().messages["ch-1"]).toHaveLength(0);
  });

  it("fetches and caches author profile when not in userProfileCache", async () => {
    useServerStore.setState({
      messagesLoaded: new Set(["ch-1"]),
      messages: { "ch-1": [] },
      messageChannelIndex: {},
      activeChannelId: "ch-1",
      userProfileCache: {},
    });
    // New behaviour: uncached author → a single profiles fetch (no more full
    // joined MESSAGE_SELECT refetch per incoming message).
    q().single.mockResolvedValueOnce({
      data: {
        id: "author-1", username: "alice", display_name: "Alice",
        avatar_url: null, accent_color: null, pronouns: null, created_at: "",
      },
      error: null,
    });

    await msgInsert(makeMsgPayload());

    expect(useServerStore.getState().userProfileCache["author-1"]).toBeDefined();
    expect(useServerStore.getState().messages["ch-1"][0].author?.username).toBe("alice");
  });

  it("does not refetch anything when the author is already cached", async () => {
    useServerStore.setState({
      messagesLoaded: new Set(["ch-1"]),
      messages: { "ch-1": [] },
      messageChannelIndex: {},
      activeChannelId: "ch-1",
      userProfileCache: { "author-1": makeUser("author-1", "alice") },
    });

    await msgInsert(makeMsgPayload());

    expect(q().single).not.toHaveBeenCalled();
    expect(useServerStore.getState().messages["ch-1"][0].author?.username).toBe("alice");
  });

  it("increments unreadCounts for an inactive channel with a foreign author", async () => {
    useServerStore.setState({
      messagesLoaded: new Set(["ch-2"]),
      messages: { "ch-2": [] },
      messageChannelIndex: {},
      activeChannelId: "ch-1",
      unreadCounts: {},
      channelIndex: {
        "ch-2": { id: "ch-2", serverId: "s-1", name: "general", type: "text", categoryId: undefined, topic: undefined, position: 0, isPrivate: false, slowModeSeconds: 0, createdAt: "" },
      },
      userProfileCache: { "other": makeUser("other", "bob") },
    });
    // Unread/notification fires from fastMessage (no DB round-trip needed).
    // Leave q().single returning default null — that's fine, unread is incremented
    // before the background fetch.

    // author_id="other" !== _currentUserId="user-1"; channel_id="ch-2" !== activeChannelId="ch-1"
    await msgInsert(makeMsgPayload({ channel_id: "ch-2", author_id: "other" }));

    expect(useServerStore.getState().unreadCounts["ch-2"]).toBe(1);
  });

  it("does not increment unread for own messages", async () => {
    useServerStore.setState({
      messagesLoaded: new Set(["ch-2"]),
      messages: { "ch-2": [] },
      messageChannelIndex: {},
      activeChannelId: "ch-1",
      unreadCounts: {},
      userProfileCache: { "user-1": makeUser("user-1", "me") },
    });
    resolveQuery([]);

    // author_id === _currentUserId — no notification or unread increment
    await msgInsert(makeMsgPayload({ channel_id: "ch-2", author_id: "user-1" }));

    expect(useServerStore.getState().unreadCounts["ch-2"]).toBeUndefined();
  });

  it("patches attachments into the message via the attachments INSERT stream", async () => {
    useServerStore.setState({
      messagesLoaded: new Set(["ch-1"]),
      messages: { "ch-1": [] },
      messageChannelIndex: {},
      activeChannelId: "ch-1",
      userProfileCache: { "author-1": makeUser("author-1", "alice") },
    });
    await msgInsert(makeMsgPayload());

    // New behaviour: attachments stream over their own realtime INSERT events
    // instead of a full joined refetch of the message.
    attachInsert({
      new: {
        id: "att-1", message_id: "m-1", url: "https://cdn.example.com/file.png",
        filename: "file.png", media_type: "image/png", size_bytes: 1234, created_at: "",
      },
    });

    const msg = useServerStore.getState().messages["ch-1"][0];
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments![0].id).toBe("att-1");
    expect(msg.attachments![0].filename).toBe("file.png");
  });

  it("attachments INSERT dedups against the sender's optimistic copy by url", async () => {
    useServerStore.setState({
      messagesLoaded: new Set(["ch-1"]),
      messages: { "ch-1": [{
        id: "m-1", channelId: "ch-1", authorId: "user-1", content: "file",
        isEdited: false, isPinned: false, createdAt: "", updatedAt: "",
        reactions: [],
        attachments: [{
          id: "att-temp-0", messageId: "m-1", url: "https://cdn.example.com/file.png",
          filename: "file.png", mediaType: "image/png", sizeBytes: 1234, createdAt: "",
        }],
      }] },
      messageChannelIndex: { "m-1": "ch-1" },
    });

    attachInsert({
      new: {
        id: "att-db-1", message_id: "m-1", url: "https://cdn.example.com/file.png",
        filename: "file.png", media_type: "image/png", size_bytes: 1234, created_at: "",
      },
    });

    expect(useServerStore.getState().messages["ch-1"][0].attachments).toHaveLength(1);
  });

  it("attachments INSERT is a no-op for unknown messages", () => {
    useServerStore.setState({ messages: {}, messageChannelIndex: {} });

    expect(() =>
      attachInsert({
        new: { id: "att-1", message_id: "unknown", url: "https://x/y.png", filename: "y.png", media_type: null, size_bytes: null, created_at: "" },
      }),
    ).not.toThrow();
  });
});

// ── servers INSERT ─────────────────────────────────────────────────────────────

describe("realtime: servers INSERT", () => {
  it("adds the new server to the servers array and openTabs", () => {
    useServerStore.setState({ servers: [], openTabs: [] });

    serverInsert({
      new: {
        id: "s-2", owner_id: "u-1", name: "My Server",
        icon_url: null, description: null, invite_code: null, created_at: "",
      },
    });

    const { servers, openTabs } = useServerStore.getState();
    expect(servers).toHaveLength(1);
    expect(servers[0].id).toBe("s-2");
    expect(servers[0].name).toBe("My Server");
    expect(openTabs).toContain("s-2");
  });

  it("maps snake_case DB fields to camelCase Server shape", () => {
    useServerStore.setState({ servers: [], openTabs: [] });

    serverInsert({
      new: {
        id: "s-3", owner_id: "owner-id", name: "Test",
        icon_url: "https://cdn/icon.png", description: "desc",
        invite_code: "abc123", created_at: "2024-01-01T00:00:00Z",
      },
    });

    const s = useServerStore.getState().servers[0];
    expect(s.ownerId).toBe("owner-id");
    expect(s.iconUrl).toBe("https://cdn/icon.png");
    expect(s.inviteCode).toBe("abc123");
  });
});

// ── profiles UPDATE ────────────────────────────────────────────────────────────

describe("realtime: profiles UPDATE", () => {
  it("updates userProfileCache with new data", () => {
    useServerStore.setState({
      userProfileCache: { "u-1": makeUser("u-1", "old-alice") },
      members: {},
      memberUserIndex: {},
      voiceParticipants: {},
    });

    profileUpdate({
      new: {
        id: "u-1", username: "new-alice", email: "new@test.com",
        display_name: "New Alice", avatar_url: null, accent_color: null, pronouns: null, created_at: "",
      },
    });

    expect(useServerStore.getState().userProfileCache["u-1"].username).toBe("new-alice");
  });

  it("patches member entries in affected servers", () => {
    useServerStore.setState({
      userProfileCache: {},
      memberUserIndex: { "u-1": [{ serverId: "s-1", memberId: "mem-1" }] },
      members: {
        "s-1": [{ id: "mem-1", serverId: "s-1", userId: "u-1", joinedAt: "", xp: 0, user: makeUser("u-1", "old") }],
      },
      voiceParticipants: {},
    });

    profileUpdate({
      new: {
        id: "u-1", username: "updated", email: "u@test.com",
        display_name: "Updated", avatar_url: null, accent_color: null, pronouns: null, created_at: "",
      },
    });

    expect(useServerStore.getState().members["s-1"][0].user?.username).toBe("updated");
  });
});

// ── channels INSERT ────────────────────────────────────────────────────────────

describe("realtime: channels INSERT", () => {
  it("adds the channel to channels map and channelIndex", () => {
    useServerStore.setState({ channels: { "s-1": [] }, channelIndex: {} });

    channelInsert({
      new: {
        id: "ch-new", server_id: "s-1", category_id: null,
        name: "announcements", type: "text", topic: null,
        position: 1, is_private: false, created_at: "",
      },
    });

    const { channels, channelIndex } = useServerStore.getState();
    expect(channels["s-1"]).toHaveLength(1);
    expect(channels["s-1"][0].id).toBe("ch-new");
    expect(channelIndex["ch-new"]).toBeDefined();
    expect(channelIndex["ch-new"].name).toBe("announcements");
  });

  it("sorts channels by position", () => {
    const existing = { id: "ch-0", serverId: "s-1", name: "general", type: "text" as const, categoryId: undefined, topic: undefined, position: 0, isPrivate: false, slowModeSeconds: 0, createdAt: "" };
    useServerStore.setState({ channels: { "s-1": [existing] }, channelIndex: { "ch-0": existing } });

    channelInsert({
      new: { id: "ch-a", server_id: "s-1", category_id: null, name: "alpha", type: "text", topic: null, position: 2, is_private: false, created_at: "" },
    });
    channelInsert({
      new: { id: "ch-b", server_id: "s-1", category_id: null, name: "beta", type: "text", topic: null, position: 1, is_private: false, created_at: "" },
    });

    const positions = useServerStore.getState().channels["s-1"].map((c) => c.position);
    expect(positions).toEqual([0, 1, 2]);
  });
});

// ── channels DELETE ────────────────────────────────────────────────────────────

describe("realtime: channels DELETE", () => {
  it("removes the channel from channels map and channelIndex", () => {
    const c = { id: "ch-1", serverId: "s-1", name: "general", type: "text" as const, categoryId: undefined, topic: undefined, position: 0, isPrivate: false, slowModeSeconds: 0, createdAt: "" };
    useServerStore.setState({ channels: { "s-1": [c] }, channelIndex: { "ch-1": c }, activeChannelId: "other" });

    channelDelete({ old: { id: "ch-1" } });

    expect(useServerStore.getState().channels["s-1"]).toHaveLength(0);
    expect(useServerStore.getState().channelIndex["ch-1"]).toBeUndefined();
  });

  it("resets activeChannelId to null when the deleted channel was active", () => {
    const c = { id: "ch-1", serverId: "s-1", name: "general", type: "text" as const, categoryId: undefined, topic: undefined, position: 0, isPrivate: false, slowModeSeconds: 0, createdAt: "" };
    useServerStore.setState({ channels: { "s-1": [c] }, channelIndex: { "ch-1": c }, activeChannelId: "ch-1" });

    channelDelete({ old: { id: "ch-1" } });

    expect(useServerStore.getState().activeChannelId).toBeNull();
  });
});

// ── messages UPDATE ────────────────────────────────────────────────────────────

describe("realtime: messages UPDATE", () => {
  const baseMsg = {
    id: "m-1", channelId: "ch-1", authorId: "u-1",
    content: "original", isEdited: false, isPinned: false,
    createdAt: "", updatedAt: "", attachments: [], reactions: [],
  };

  it("patches content and isEdited for an existing message", () => {
    useServerStore.setState({ messagesLoaded: new Set(["ch-1"]), messages: { "ch-1": [{ ...baseMsg }] } });

    msgUpdate({ new: { id: "m-1", channel_id: "ch-1", content: "edited!", is_edited: true, updated_at: "" } });

    const msg = useServerStore.getState().messages["ch-1"][0];
    expect(msg.content).toBe("edited!");
    expect(msg.isEdited).toBe(true);
  });

  it("is a no-op when the channel is not in messagesLoaded", () => {
    useServerStore.setState({ messagesLoaded: new Set<string>(), messages: { "ch-1": [{ ...baseMsg }] } });

    msgUpdate({ new: { id: "m-1", channel_id: "ch-1", content: "edited!", is_edited: true, updated_at: "" } });

    expect(useServerStore.getState().messages["ch-1"][0].content).toBe("original");
  });
});

// ── message_reactions ──────────────────────────────────────────────────────────

describe("realtime: message_reactions INSERT / DELETE", () => {
  const baseMsg = {
    id: "m-1", channelId: "ch-1", authorId: "u-1",
    content: "hi", isEdited: false, isPinned: false,
    createdAt: "", updatedAt: "", attachments: [], reactions: [] as any[],
  };

  it("INSERT adds the reaction to the correct message", () => {
    useServerStore.setState({ messages: { "ch-1": [{ ...baseMsg }] }, messageChannelIndex: { "m-1": "ch-1" } });

    reactionsCb({ eventType: "INSERT", new: { id: "r-1", message_id: "m-1", user_id: "u-2", emoji: "👍", created_at: "" } });

    const reactions = useServerStore.getState().messages["ch-1"][0].reactions;
    expect(reactions).toHaveLength(1);
    expect(reactions![0].emoji).toBe("👍");
  });

  it("INSERT is idempotent — duplicate reaction not added twice", () => {
    const existing = { id: "r-1", messageId: "m-1", userId: "u-2", emoji: "👍", createdAt: "" };
    useServerStore.setState({
      messages: { "ch-1": [{ ...baseMsg, reactions: [existing] }] },
      messageChannelIndex: { "m-1": "ch-1" },
    });

    reactionsCb({ eventType: "INSERT", new: { id: "r-1", message_id: "m-1", user_id: "u-2", emoji: "👍", created_at: "" } });

    expect(useServerStore.getState().messages["ch-1"][0].reactions).toHaveLength(1);
  });

  it("DELETE removes the reaction from the message", () => {
    const existing = { id: "r-1", messageId: "m-1", userId: "u-2", emoji: "👍", createdAt: "" };
    useServerStore.setState({
      messages: { "ch-1": [{ ...baseMsg, reactions: [existing] }] },
      messageChannelIndex: { "m-1": "ch-1" },
    });

    reactionsCb({ eventType: "DELETE", old: { id: "r-1", message_id: "m-1" } });

    expect(useServerStore.getState().messages["ch-1"][0].reactions).toHaveLength(0);
  });

  it("is a no-op when message_id is not in messageChannelIndex", () => {
    useServerStore.setState({ messages: {}, messageChannelIndex: {} });

    expect(() =>
      reactionsCb({ eventType: "INSERT", new: { id: "r-1", message_id: "unknown", user_id: "u-2", emoji: "👍", created_at: "" } }),
    ).not.toThrow();
  });
});
