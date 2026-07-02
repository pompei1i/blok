import { describe, it, expect, beforeEach, vi } from "vitest";
import { useServerStore } from "../server-store";
import type { Server } from "../types";

function makeServer(id: string, inviteCode?: string): Server {
  return { id, ownerId: "owner", name: `Server ${id}`, inviteCode, createdAt: "2024-01-01" };
}

const q = () => (globalThis as Record<string, unknown>).__mockSupabaseQuery as Record<string, ReturnType<typeof vi.fn>>;
const rpc = () => (globalThis as Record<string, unknown>).__mockSupabaseRpc as ReturnType<typeof vi.fn>;

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
//
// The code is now minted server-side by the rotate_invite_code SECURITY DEFINER
// RPC (owner/INVITE_MEMBER check + gen_random_bytes) — see
// supabase/migrations/20260702_rotate_invite_code.sql. The client forwards opts
// and mirrors the returned code into state.

describe("generateInviteCode", () => {
  it("returns the RPC-minted code and updates server.inviteCode in state", async () => {
    useServerStore.setState({ servers: [makeServer("s1")] });
    rpc().mockResolvedValueOnce({ data: { ok: true, code: "abcdef1234" }, error: null });

    const code = await useServerStore.getState().generateInviteCode("s1");

    expect(code).toBe("abcdef1234");
    expect(useServerStore.getState().servers[0].inviteCode).toBe("abcdef1234");
  });

  it("returns null and leaves server.inviteCode unchanged when the RPC call errors", async () => {
    useServerStore.setState({ servers: [makeServer("s1")] });
    rpc().mockResolvedValueOnce({ data: null, error: { message: "DB error" } });

    const code = await useServerStore.getState().generateInviteCode("s1");

    expect(code).toBeNull();
    expect(useServerStore.getState().servers[0].inviteCode).toBeUndefined();
  });

  it("returns null when the RPC reports forbidden (no INVITE_MEMBER permission)", async () => {
    useServerStore.setState({ servers: [makeServer("s1")] });
    rpc().mockResolvedValueOnce({ data: { ok: false, reason: "forbidden" }, error: null });

    const code = await useServerStore.getState().generateInviteCode("s1");

    expect(code).toBeNull();
    expect(useServerStore.getState().servers[0].inviteCode).toBeUndefined();
  });

  it("only updates the targeted server and leaves others unchanged", async () => {
    useServerStore.setState({ servers: [makeServer("s1"), makeServer("s2")] });
    rpc().mockResolvedValueOnce({ data: { ok: true, code: "abcdef1234" }, error: null });

    await useServerStore.getState().generateInviteCode("s1");

    expect(useServerStore.getState().servers[1].inviteCode).toBeUndefined();
    expect(useServerStore.getState().servers[0].inviteCode).toBe("abcdef1234");
  });

  it("passes opts through to the RPC", async () => {
    const expiresAt = "2026-08-01T00:00:00.000Z";
    useServerStore.setState({ servers: [makeServer("s1")] });
    rpc().mockResolvedValueOnce({ data: { ok: true, code: "abcdef1234" }, error: null });

    await useServerStore.getState().generateInviteCode("s1", { expiresAt, maxUses: 5 });

    expect(rpc()).toHaveBeenCalledWith("rotate_invite_code", {
      p_server_id: "s1",
      p_expires_at: expiresAt,
      p_max_uses: 5,
    });
  });
});

// ── joinByInviteCode ──────────────────────────────────────────────────────────
//
// Validation (expiry/max-uses/ban) and the membership write now live entirely
// in the join_server_by_invite SECURITY DEFINER RPC — see
// supabase/migrations/20260623_server_members_lockdown.sql. The client only
// forwards the code and interprets the {ok, reason} result.

describe("joinByInviteCode", () => {
  it("returns error message when the RPC reports an invalid code", async () => {
    rpc().mockResolvedValueOnce({ data: { ok: false, reason: "invalid_code" }, error: null });

    const result = await useServerStore.getState().joinByInviteCode("INVALID", "u1");

    expect(result).toBe("Invalid or expired invite code");
  });

  it("returns a generic error message when the RPC call itself errors", async () => {
    rpc().mockResolvedValueOnce({ data: null, error: { message: "network error" } });

    const result = await useServerStore.getState().joinByInviteCode("abc", "u1");

    expect(result).toBe("Failed to join server");
  });

  it("returns 'Invite link has expired' when the RPC reports expired", async () => {
    rpc().mockResolvedValueOnce({ data: { ok: false, reason: "expired" }, error: null });

    const result = await useServerStore.getState().joinByInviteCode("abc123", "u1");

    expect(result).toBe("Invite link has expired");
  });

  it("returns 'Invite link has reached its usage limit' when the RPC reports max_uses_reached", async () => {
    rpc().mockResolvedValueOnce({ data: { ok: false, reason: "max_uses_reached" }, error: null });

    const result = await useServerStore.getState().joinByInviteCode("abc123", "u1");

    expect(result).toBe("Invite link has reached its usage limit");
  });

  it("returns 'You are banned from this server' when the RPC reports banned", async () => {
    rpc().mockResolvedValueOnce({ data: { ok: false, reason: "banned" }, error: null });

    const result = await useServerStore.getState().joinByInviteCode("abc123", "u1");

    expect(result).toBe("You are banned from this server");
  });

  it("returns null without re-fetching when already a member and server is already in state", async () => {
    rpc().mockResolvedValueOnce({ data: { ok: true, server_id: "s1", already_member: true }, error: null });
    useServerStore.setState({ servers: [makeServer("s1")] });

    const result = await useServerStore.getState().joinByInviteCode("abc123", "u1");

    expect(result).toBeNull();
    expect(q().single).not.toHaveBeenCalled();
  });

  it("returns null and appends the new server to state on successful join", async () => {
    rpc().mockResolvedValueOnce({ data: { ok: true, server_id: "s1", member_id: "m1" }, error: null });
    const dbServer = { id: "s1", invite_code: "abc123", owner_id: "owner", name: "Test", created_at: "2024-01-01",
      invite_expires_at: null, invite_max_uses: null, invite_used_count: 1 };
    q().single.mockResolvedValueOnce({ data: dbServer, error: null });
    useServerStore.setState({ members: { s1: [] } });
    resolveWith([]); // channels fetch (Promise.all)
    resolveWith([]); // categories fetch
    resolveWith([]); // members fetch
    resolveWith([]); // roles fetch

    const result = await useServerStore.getState().joinByInviteCode("abc123", "u1");

    expect(result).toBeNull();
    const state = useServerStore.getState();
    expect(state.servers.some((s) => s.id === "s1")).toBe(true);
    expect(state.openTabs).toContain("s1");
    expect(state.activeServerId).toBe("s1");
  });

  it("trims whitespace from the invite code before calling the RPC", async () => {
    rpc().mockResolvedValueOnce({ data: { ok: false, reason: "invalid_code" }, error: null });

    await useServerStore.getState().joinByInviteCode("  abc123  ", "u1");

    expect(rpc()).toHaveBeenCalledWith("join_server_by_invite", { p_code: "abc123" });
  });
});

describe("generateInviteCode — opts", () => {
  it("stores expiresAt and maxUses in state after successful generation", async () => {
    const expiresAt = new Date(Date.now() + 86_400_000 * 7).toISOString();
    useServerStore.setState({ servers: [makeServer("s1")] });
    rpc().mockResolvedValueOnce({ data: { ok: true, code: "abcdef1234" }, error: null });

    await useServerStore.getState().generateInviteCode("s1", { expiresAt, maxUses: 5 });

    const s = useServerStore.getState().servers[0];
    expect(s.inviteExpiresAt).toBe(expiresAt);
    expect(s.inviteMaxUses).toBe(5);
    expect(s.inviteUsedCount).toBe(0);
  });

  it("stores null expiresAt and null maxUses when opts are omitted", async () => {
    useServerStore.setState({ servers: [makeServer("s1")] });
    rpc().mockResolvedValueOnce({ data: { ok: true, code: "abcdef1234" }, error: null });

    await useServerStore.getState().generateInviteCode("s1");

    const s = useServerStore.getState().servers[0];
    expect(s.inviteExpiresAt).toBeNull();
    expect(s.inviteMaxUses).toBeNull();
    expect(s.inviteUsedCount).toBe(0);
  });
});
