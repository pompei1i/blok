import { describe, it, expect, beforeEach, vi } from "vitest";
import { useServerStore } from "../server-store";
import type { Channel, ServerMember } from "../types";

const rpc = () => (globalThis as Record<string, unknown>).__mockSupabaseRpc as ReturnType<typeof vi.fn>;
const q = () => (globalThis as Record<string, unknown>).__mockSupabaseQuery as Record<string, ReturnType<typeof vi.fn>>;

/** Make the next awaited query builder resolve with `data`. */
function resolveQuery(data: unknown) {
  q().then.mockImplementationOnce((resolve: (v: unknown) => void) => resolve({ data, error: null }));
}

function member(userId: string): ServerMember {
  return { id: `m-${userId}`, serverId: "s1", userId, joinedAt: "", xp: 0, user: undefined };
}

function channel(id: string, slow = 0): Channel {
  return { id, serverId: "s1", name: id, type: "text", position: 0, isPrivate: false, slowModeSeconds: slow, createdAt: "" };
}

beforeEach(() => {
  rpc().mockReset();
  rpc().mockResolvedValue({ data: null, error: null });
  useServerStore.setState({
    members: { s1: [member("u1"), member("u2")] },
    channels: { s1: [channel("ch1")] },
    channelIndex: { ch1: channel("ch1") },
    bans: {},
    auditLog: {},
  });
});

describe("banMember", () => {
  it("removes the member locally and forwards reason to the RPC on success", async () => {
    rpc().mockResolvedValueOnce({ data: { ok: true }, error: null });
    const res = await useServerStore.getState().banMember("s1", "u1", "spamming");
    expect(res).toBeNull();
    expect(rpc()).toHaveBeenCalledWith("ban_member", { p_server_id: "s1", p_user_id: "u1", p_reason: "spamming" });
    expect(useServerStore.getState().members.s1.some((m) => m.userId === "u1")).toBe(false);
    expect(useServerStore.getState().members.s1.some((m) => m.userId === "u2")).toBe(true);
  });

  it("keeps the member and returns the reason when the RPC denies it", async () => {
    rpc().mockResolvedValueOnce({ data: { ok: false, reason: "forbidden" }, error: null });
    const res = await useServerStore.getState().banMember("s1", "u1");
    expect(res).toBe("forbidden");
    expect(useServerStore.getState().members.s1.some((m) => m.userId === "u1")).toBe(true);
  });
});

describe("timeoutMember", () => {
  it("applies the returned timeout_until to the member", async () => {
    const until = "2030-01-01T00:05:00.000Z";
    rpc().mockResolvedValueOnce({ data: { ok: true, timeout_until: until }, error: null });
    const res = await useServerStore.getState().timeoutMember("s1", "u1", 5);
    expect(res).toBeNull();
    expect(rpc()).toHaveBeenCalledWith("timeout_member", { p_server_id: "s1", p_user_id: "u1", p_minutes: 5 });
    expect(useServerStore.getState().members.s1.find((m) => m.userId === "u1")?.timeoutUntil).toBe(until);
  });

  it("clears the timeout when the RPC returns null", async () => {
    useServerStore.setState({ members: { s1: [{ ...member("u1"), timeoutUntil: "2030-01-01T00:00:00Z" }] } });
    rpc().mockResolvedValueOnce({ data: { ok: true, timeout_until: null }, error: null });
    await useServerStore.getState().timeoutMember("s1", "u1", 0);
    expect(useServerStore.getState().members.s1.find((m) => m.userId === "u1")?.timeoutUntil).toBeNull();
  });
});

describe("setChannelSlowmode", () => {
  it("updates slowModeSeconds in both channels and channelIndex", async () => {
    rpc().mockResolvedValueOnce({ data: { ok: true, seconds: 30 }, error: null });
    await useServerStore.getState().setChannelSlowmode("ch1", 30);
    expect(rpc()).toHaveBeenCalledWith("set_channel_slowmode", { p_channel_id: "ch1", p_seconds: 30 });
    expect(useServerStore.getState().channelIndex.ch1.slowModeSeconds).toBe(30);
    expect(useServerStore.getState().channels.s1[0].slowModeSeconds).toBe(30);
  });

  it("does not mutate state when the RPC denies it", async () => {
    rpc().mockResolvedValueOnce({ data: { ok: false, reason: "forbidden" }, error: null });
    await useServerStore.getState().setChannelSlowmode("ch1", 30);
    expect(useServerStore.getState().channelIndex.ch1.slowModeSeconds).toBe(0);
  });
});

describe("loadBans", () => {
  it("maps ban rows into state", async () => {
    resolveQuery([
      { server_id: "s1", user_id: "u9", reason: "abuse", banned_by: "owner", created_at: "2026-01-01", user: null },
    ]);
    await useServerStore.getState().loadBans("s1");
    const bans = useServerStore.getState().bans.s1;
    expect(bans).toHaveLength(1);
    expect(bans[0]).toMatchObject({ userId: "u9", reason: "abuse", bannedBy: "owner" });
  });
});
