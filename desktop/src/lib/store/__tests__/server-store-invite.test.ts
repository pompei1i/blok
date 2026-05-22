import { describe, it, expect, beforeEach, vi } from "vitest";
import { useServerStore } from "../server-store";
import type { Server } from "../types";

function makeServer(id: string, inviteCode?: string): Server {
  return { id, ownerId: "owner", name: `Server ${id}`, inviteCode, createdAt: "2024-01-01" };
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
};

beforeEach(() => {
  vi.clearAllMocks();
  useServerStore.setState(BASE_STATE);
});

// ── generateInviteCode ────────────────────────────────────────────────────────

describe("generateInviteCode", () => {
  it("returns a non-empty string and updates server.inviteCode in state", async () => {
    useServerStore.setState({ servers: [makeServer("s1")] });
    resolveWith(null); // update().eq() direct chain await

    const code = await useServerStore.getState().generateInviteCode("s1");

    expect(typeof code).toBe("string");
    expect(code!.length).toBeGreaterThan(0);
    expect(useServerStore.getState().servers[0].inviteCode).toBe(code);
  });

  it("returns null and leaves server.inviteCode unchanged when DB update fails", async () => {
    useServerStore.setState({ servers: [makeServer("s1")] });
    resolveWith(null, { message: "DB error" });

    const code = await useServerStore.getState().generateInviteCode("s1");

    expect(code).toBeNull();
    expect(useServerStore.getState().servers[0].inviteCode).toBeUndefined();
  });

  it("only updates the targeted server and leaves others unchanged", async () => {
    useServerStore.setState({ servers: [makeServer("s1"), makeServer("s2")] });
    resolveWith(null);

    await useServerStore.getState().generateInviteCode("s1");

    expect(useServerStore.getState().servers[1].inviteCode).toBeUndefined();
    expect(useServerStore.getState().servers[0].inviteCode).toBeTruthy();
  });

  it("generates unique codes on successive calls", async () => {
    useServerStore.setState({ servers: [makeServer("s1")] });
    resolveWith(null);
    const code1 = await useServerStore.getState().generateInviteCode("s1");

    resolveWith(null);
    const code2 = await useServerStore.getState().generateInviteCode("s1");

    expect(code1).not.toBe(code2);
  });
});

// ── joinByInviteCode ──────────────────────────────────────────────────────────

describe("joinByInviteCode", () => {
  it("returns error message when invite code matches no server", async () => {
    q().maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const result = await useServerStore.getState().joinByInviteCode("INVALID", "u1");

    expect(result).toBe("Invalid or expired invite code");
  });

  it("returns error message when maybeSingle itself errors", async () => {
    q().maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "network error" } });

    const result = await useServerStore.getState().joinByInviteCode("abc", "u1");

    expect(result).toBe("Invalid or expired invite code");
  });

  it("returns null without inserting when user is already a member", async () => {
    const dbServer = { id: "s1", invite_code: "abc123", owner_id: "owner", name: "Test", created_at: "2024-01-01" };
    q().maybeSingle.mockResolvedValueOnce({ data: dbServer, error: null });
    useServerStore.setState({
      members: { s1: [{ id: "m1", serverId: "s1", userId: "u1", joinedAt: "2024-01-01" }] },
    });

    const result = await useServerStore.getState().joinByInviteCode("abc123", "u1");

    expect(result).toBeNull();
    expect(q().insert).not.toHaveBeenCalled();
  });

  it("returns 'Failed to join server' when the member insert errors", async () => {
    const dbServer = { id: "s1", invite_code: "abc123", owner_id: "owner", name: "Test", created_at: "2024-01-01" };
    q().maybeSingle.mockResolvedValueOnce({ data: dbServer, error: null });
    useServerStore.setState({ members: { s1: [] } });
    resolveWith(null, { message: "insert fail" }); // insert().direct await

    const result = await useServerStore.getState().joinByInviteCode("abc123", "u1");

    expect(result).toBe("Failed to join server");
  });

  it("returns null and calls initData on successful join", async () => {
    const dbServer = { id: "s1", invite_code: "abc123", owner_id: "owner", name: "Test", created_at: "2024-01-01" };
    q().maybeSingle.mockResolvedValueOnce({ data: dbServer, error: null });
    useServerStore.setState({ members: { s1: [] } });
    resolveWith(null); // insert success

    const mockInitData = vi.fn().mockResolvedValue(undefined);
    useServerStore.setState({ initData: mockInitData } as Parameters<typeof useServerStore.setState>[0]);

    const result = await useServerStore.getState().joinByInviteCode("abc123", "u1");

    expect(result).toBeNull();
    expect(mockInitData).toHaveBeenCalledWith("u1");
  });

  it("trims whitespace from the invite code before querying", async () => {
    q().maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await useServerStore.getState().joinByInviteCode("  abc123  ", "u1");

    expect(q().eq).toHaveBeenCalledWith("invite_code", "abc123");
  });
});
