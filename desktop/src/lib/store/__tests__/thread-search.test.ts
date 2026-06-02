import { describe, it, expect, beforeEach, vi } from "vitest";
import { useServerStore } from "../server-store";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeDbRow(id: string, channelId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    channel_id: channelId,
    author_id: "u1",
    reply_to_id: null,
    content: `message ${id}`,
    is_edited: false,
    pinned: false,
    created_at: "2024-01-15T12:00:00Z",
    updated_at: "2024-01-15T12:00:00Z",
    author: { id: "u1", username: "alice", display_name: "Alice", avatar_url: null, accent_color: null, pronouns: null },
    attachments: [],
    message_reactions: [],
    ...overrides,
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
  screenSharers: {},
  watchingUserId: null,
  polls: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  useServerStore.setState(BASE_STATE);
});

// ── searchMessages ─────────────────────────────────────────────────────────────

describe("searchMessages", () => {
  it("returns empty array when query is shorter than 2 chars", async () => {
    const results = await useServerStore.getState().searchMessages("c1", "a");
    expect(results).toEqual([]);
    expect(q().then).not.toHaveBeenCalled();
  });

  it("returns mapped messages from Supabase on a valid query", async () => {
    const row = makeDbRow("m1", "c1", { content: "hello world" });
    resolveWith([row]);

    const results = await useServerStore.getState().searchMessages("c1", "hello");

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("m1");
    expect(results[0].content).toBe("hello world");
    expect(results[0].channelId).toBe("c1");
    expect(results[0].author?.username).toBe("alice");
  });

  it("returns empty array on Supabase error", async () => {
    resolveWith(null, { message: "DB error" });
    const results = await useServerStore.getState().searchMessages("c1", "hello");
    expect(results).toEqual([]);
  });

  it("returns empty array when Supabase returns null data", async () => {
    resolveWith(null);
    const results = await useServerStore.getState().searchMessages("c1", "test");
    expect(results).toEqual([]);
  });
});
