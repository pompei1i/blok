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
      members: { s1: [{ id: "m1", serverId: "s1", userId: "u1", joinedAt: "2024-01-01", xp: 0 }] },
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

  it("returns null and appends the new server to state on successful join", async () => {
    const dbServer = { id: "s1", invite_code: "abc123", owner_id: "owner", name: "Test", created_at: "2024-01-01",
      invite_expires_at: null, invite_max_uses: null, invite_used_count: 0 };
    q().maybeSingle.mockResolvedValueOnce({ data: dbServer, error: null });
    useServerStore.setState({ members: { s1: [] } });
    resolveWith(null);  // insert member
    resolveWith(null);  // update used_count
    resolveWith([]);    // channels fetch (Promise.all)
    resolveWith([]);    // categories fetch
    resolveWith([]);    // members fetch
    resolveWith([]);    // roles fetch

    const result = await useServerStore.getState().joinByInviteCode("abc123", "u1");

    expect(result).toBeNull();
    const state = useServerStore.getState();
    expect(state.servers.some((s) => s.id === "s1")).toBe(true);
    expect(state.openTabs).toContain("s1");
    expect(state.activeServerId).toBe("s1");
  });

  it("trims whitespace from the invite code before querying", async () => {
    q().maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await useServerStore.getState().joinByInviteCode("  abc123  ", "u1");

    expect(q().eq).toHaveBeenCalledWith("invite_code", "abc123");
  });
});

// ── joinByInviteCode — expiry & limits ────────────────────────────────────────

describe("joinByInviteCode — expiry", () => {
  it("returns 'Invite link has expired' when invite_expires_at is in the past", async () => {
    const dbServer = {
      id: "s1", invite_code: "abc123", owner_id: "owner", name: "Test", created_at: "2024-01-01",
      invite_expires_at: new Date(Date.now() - 1000).toISOString(),
      invite_max_uses: null, invite_used_count: 0,
    };
    q().maybeSingle.mockResolvedValueOnce({ data: dbServer, error: null });

    const result = await useServerStore.getState().joinByInviteCode("abc123", "u1");

    expect(result).toBe("Invite link has expired");
    expect(q().insert).not.toHaveBeenCalled();
  });

  it("allows join when invite_expires_at is in the future", async () => {
    const dbServer = {
      id: "s1", invite_code: "abc123", owner_id: "owner", name: "Test", created_at: "2024-01-01",
      invite_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      invite_max_uses: null, invite_used_count: 0,
    };
    q().maybeSingle.mockResolvedValueOnce({ data: dbServer, error: null });
    useServerStore.setState({ members: { s1: [] } });
    resolveWith(null); resolveWith(null); resolveWith([]); resolveWith([]); resolveWith([]); resolveWith([]);

    const result = await useServerStore.getState().joinByInviteCode("abc123", "u1");

    expect(result).toBeNull();
  });

  it("allows join when invite_expires_at is null (no expiry)", async () => {
    const dbServer = {
      id: "s1", invite_code: "abc123", owner_id: "owner", name: "Test", created_at: "2024-01-01",
      invite_expires_at: null, invite_max_uses: null, invite_used_count: 0,
    };
    q().maybeSingle.mockResolvedValueOnce({ data: dbServer, error: null });
    useServerStore.setState({ members: { s1: [] } });
    resolveWith(null); resolveWith(null); resolveWith([]); resolveWith([]); resolveWith([]); resolveWith([]);

    const result = await useServerStore.getState().joinByInviteCode("abc123", "u1");

    expect(result).toBeNull();
  });
});

describe("joinByInviteCode — usage limit", () => {
  it("returns error when used_count equals max_uses", async () => {
    const dbServer = {
      id: "s1", invite_code: "abc123", owner_id: "owner", name: "Test", created_at: "2024-01-01",
      invite_expires_at: null, invite_max_uses: 5, invite_used_count: 5,
    };
    q().maybeSingle.mockResolvedValueOnce({ data: dbServer, error: null });

    const result = await useServerStore.getState().joinByInviteCode("abc123", "u1");

    expect(result).toBe("Invite link has reached its usage limit");
    expect(q().insert).not.toHaveBeenCalled();
  });

  it("returns error when used_count exceeds max_uses", async () => {
    const dbServer = {
      id: "s1", invite_code: "abc123", owner_id: "owner", name: "Test", created_at: "2024-01-01",
      invite_expires_at: null, invite_max_uses: 3, invite_used_count: 7,
    };
    q().maybeSingle.mockResolvedValueOnce({ data: dbServer, error: null });

    const result = await useServerStore.getState().joinByInviteCode("abc123", "u1");

    expect(result).toBe("Invite link has reached its usage limit");
  });

  it("allows join when used_count is below max_uses", async () => {
    const dbServer = {
      id: "s1", invite_code: "abc123", owner_id: "owner", name: "Test", created_at: "2024-01-01",
      invite_expires_at: null, invite_max_uses: 10, invite_used_count: 3,
    };
    q().maybeSingle.mockResolvedValueOnce({ data: dbServer, error: null });
    useServerStore.setState({ members: { s1: [] } });
    resolveWith(null); resolveWith(null); resolveWith([]); resolveWith([]); resolveWith([]); resolveWith([]);

    const result = await useServerStore.getState().joinByInviteCode("abc123", "u1");

    expect(result).toBeNull();
  });

  it("allows join when max_uses is null (unlimited)", async () => {
    const dbServer = {
      id: "s1", invite_code: "abc123", owner_id: "owner", name: "Test", created_at: "2024-01-01",
      invite_expires_at: null, invite_max_uses: null, invite_used_count: 9999,
    };
    q().maybeSingle.mockResolvedValueOnce({ data: dbServer, error: null });
    useServerStore.setState({ members: { s1: [] } });
    resolveWith(null); resolveWith(null); resolveWith([]); resolveWith([]); resolveWith([]); resolveWith([]);

    const result = await useServerStore.getState().joinByInviteCode("abc123", "u1");

    expect(result).toBeNull();
  });
});

describe("generateInviteCode — opts", () => {
  it("stores expiresAt and maxUses in state after successful generation", async () => {
    const expiresAt = new Date(Date.now() + 86_400_000 * 7).toISOString();
    useServerStore.setState({ servers: [makeServer("s1")] });
    resolveWith(null);

    await useServerStore.getState().generateInviteCode("s1", { expiresAt, maxUses: 5 });

    const s = useServerStore.getState().servers[0];
    expect(s.inviteExpiresAt).toBe(expiresAt);
    expect(s.inviteMaxUses).toBe(5);
    expect(s.inviteUsedCount).toBe(0);
  });

  it("stores null expiresAt and null maxUses when opts are omitted", async () => {
    useServerStore.setState({ servers: [makeServer("s1")] });
    resolveWith(null);

    await useServerStore.getState().generateInviteCode("s1");

    const s = useServerStore.getState().servers[0];
    expect(s.inviteExpiresAt).toBeNull();
    expect(s.inviteMaxUses).toBeNull();
    expect(s.inviteUsedCount).toBe(0);
  });
});
