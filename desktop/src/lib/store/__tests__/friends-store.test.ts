import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { supabase } from "@/lib/supabaseClient";
import { useFriendsStore, effectiveStatus, ONLINE_CHANNEL } from "../friends-store";
import type { User, UserRelationship } from "../types";

function makeUser(id: string, name = "User"): User {
  return { id, username: name.toLowerCase(), displayName: name, email: `${name.toLowerCase()}@test.com`, createdAt: "2024-01-01" };
}

function makeRelationship(id: string, requester: User, target: User): UserRelationship {
  return {
    id,
    requesterId: requester.id,
    targetId: target.id,
    status: "accepted",
    createdAt: "2024-01-01",
    requesterUser: requester,
    targetUser: target,
  };
}

const alice = makeUser("u1", "Alice");
const bob = makeUser("u2", "Bob");
const carol = makeUser("u3", "Carol");

const q = () => (globalThis as any).__mockSupabaseQuery as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.clearAllMocks();
  useFriendsStore.setState({
    friends: [],
    pendingRequests: [],
    outgoingRequests: [],
    presence: {},
    presenceLastSeen: {},
    activity: {},
    presenceTrackedIds: new Set<string>(),
    currentUserId: null,
    loadError: null,
  });
});

// ── patchUser ─────────────────────────────────────────────────────────────────

describe("patchUser (friends-store)", () => {
  it("updates requesterUser on friends when id matches", () => {
    const updated = { ...alice, displayName: "Alicia" };
    useFriendsStore.setState({ friends: [makeRelationship("r1", alice, bob)] });
    useFriendsStore.getState().patchUser(updated);
    expect(useFriendsStore.getState().friends[0].requesterUser?.displayName).toBe("Alicia");
  });

  it("updates targetUser on friends when id matches", () => {
    const updated = { ...bob, displayName: "Robert" };
    useFriendsStore.setState({ friends: [makeRelationship("r1", alice, bob)] });
    useFriendsStore.getState().patchUser(updated);
    expect(useFriendsStore.getState().friends[0].targetUser?.displayName).toBe("Robert");
  });

  it("updates pendingRequests", () => {
    const updated = { ...carol, displayName: "Caroline" };
    useFriendsStore.setState({ pendingRequests: [makeRelationship("r2", carol, alice)] });
    useFriendsStore.getState().patchUser(updated);
    expect(useFriendsStore.getState().pendingRequests[0].requesterUser?.displayName).toBe("Caroline");
  });

  it("updates outgoingRequests", () => {
    const updated = { ...bob, displayName: "Bobby" };
    useFriendsStore.setState({ outgoingRequests: [makeRelationship("r3", alice, bob)] });
    useFriendsStore.getState().patchUser(updated);
    expect(useFriendsStore.getState().outgoingRequests[0].targetUser?.displayName).toBe("Bobby");
  });

  it("does not modify relationships where the user id does not appear", () => {
    useFriendsStore.setState({ friends: [makeRelationship("r1", alice, bob)] });
    useFriendsStore.getState().patchUser({ ...carol, displayName: "Caroline" });
    // alice and bob should be unchanged
    expect(useFriendsStore.getState().friends[0].requesterUser?.displayName).toBe("Alice");
    expect(useFriendsStore.getState().friends[0].targetUser?.displayName).toBe("Bob");
  });
});

// ── effectiveStatus ──────────────────────────────────────────────────────────

describe("effectiveStatus", () => {
  it("treats a user absent from presence as offline", () => {
    expect(effectiveStatus(undefined)).toBe("offline");
  });

  it("passes a known status through", () => {
    expect(effectiveStatus("online")).toBe("online");
    expect(effectiveStatus("dnd")).toBe("dnd");
  });
});

// ── Realtime presence (online-users channel) ─────────────────────────────────

describe("online presence", () => {
  const channel = () => (globalThis as any).__mockChannel as Record<string, ReturnType<typeof vi.fn>>;

  /** Run initFriendsData and return the presence-channel sync handler. */
  async function startPresence(me = "me") {
    await useFriendsStore.getState().initFriendsData(me);
    const syncCall = channel().on.mock.calls.find(
      ([type, filter]) => type === "presence" && filter?.event === "sync",
    );
    if (!syncCall) throw new Error("presence sync handler not registered");
    return syncCall[2] as () => void;
  }

  afterEach(async () => {
    channel().presenceState.mockReturnValue({});
    await useFriendsStore.getState().stopPresence();
  });

  it("joins the shared channel keyed by the user id", async () => {
    await startPresence("me");
    expect(supabase.channel).toHaveBeenCalledWith(ONLINE_CHANNEL, {
      config: { presence: { key: "me" } },
    });
  });

  it("tracks itself on every SUBSCRIBED so a reconnect re-announces", async () => {
    await startPresence();
    const subscribeCb = channel().subscribe.mock.calls
      .map(([cb]) => cb)
      .find((cb) => typeof cb === "function") as (s: string) => void;
    subscribeCb("SUBSCRIBED");
    subscribeCb("CHANNEL_ERROR");
    subscribeCb("SUBSCRIBED");
    expect(channel().track).toHaveBeenCalledTimes(2);
  });

  it("marks tracked users online/offline from presence state", async () => {
    const sync = await startPresence();
    await useFriendsStore.getState().trackPresenceFor(["a", "b"]);

    channel().presenceState.mockReturnValue({ a: [{ online_at: "x" }] });
    sync();

    const { presence } = useFriendsStore.getState();
    expect(presence.a).toBe("online");
    expect(presence.b).toBe("offline");
  });

  it("ignores users the UI doesn't track", async () => {
    const sync = await startPresence();
    channel().presenceState.mockReturnValue({ stranger: [{}] });
    sync();
    expect(useFriendsStore.getState().presence.stranger).toBeUndefined();
  });

  it("stamps last-seen when a user is observed leaving", async () => {
    const sync = await startPresence();
    await useFriendsStore.getState().trackPresenceFor(["a"]);
    channel().presenceState.mockReturnValue({ a: [{}] });
    sync();
    expect(useFriendsStore.getState().presenceLastSeen.a).toBeUndefined();

    channel().presenceState.mockReturnValue({});
    sync();
    const { presence, presenceLastSeen } = useFriendsStore.getState();
    expect(presence.a).toBe("offline");
    expect(Date.now() - Date.parse(presenceLastSeen.a)).toBeLessThan(1000);
  });

  it("applies current presence to ids tracked after the channel synced", async () => {
    await startPresence();
    channel().presenceState.mockReturnValue({ late: [{}] });
    await useFriendsStore.getState().trackPresenceFor(["late"]);
    expect(useFriendsStore.getState().presence.late).toBe("online");
  });

  it("stopPresence leaves the channel and persists last-seen", async () => {
    await startPresence("me");
    vi.mocked(supabase.removeChannel).mockClear();
    q().upsert.mockClear();
    q().then.mockClear();

    await useFriendsStore.getState().stopPresence();

    expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
    expect(q().upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "me", status: "offline", online_at: expect.any(String) }),
    );
    // Builders are lazy — the write only happens if something awaited it.
    expect(q().then).toHaveBeenCalled();
  });
});

// ── trackPresenceFor (scoped presence) ───────────────────────────────────────

describe("trackPresenceFor", () => {
  it("adds requested ids to the tracked set", async () => {
    await useFriendsStore.getState().trackPresenceFor(["a", "b"]);
    const tracked = useFriendsStore.getState().presenceTrackedIds;
    expect(tracked.has("a")).toBe(true);
    expect(tracked.has("b")).toBe(true);
  });

  it("only fetches ids not already tracked (idempotent)", async () => {
    await useFriendsStore.getState().trackPresenceFor(["a", "b"]);
    expect(q().in).toHaveBeenLastCalledWith("user_id", ["a", "b"]);

    await useFriendsStore.getState().trackPresenceFor(["a", "c"]);
    // Only the new id "c" should hit the DB on the second call.
    expect(q().in).toHaveBeenLastCalledWith("user_id", ["c"]);
  });

  it("does not query at all when every id is already tracked", async () => {
    await useFriendsStore.getState().trackPresenceFor(["a"]);
    const callsBefore = q().in.mock.calls.length;
    await useFriendsStore.getState().trackPresenceFor(["a"]);
    expect(q().in.mock.calls.length).toBe(callsBefore);
  });
});

// ── applyRelationshipEvent (incremental friends updates) ─────────────────────

describe("applyRelationshipEvent", () => {
  const me = "me";
  const row = (over: Record<string, any>) => ({
    id: "rel-1", requester_id: me, target_id: "other", status: "pending",
    created_at: "2024-01-01", ...over,
  });

  beforeEach(() => {
    useFriendsStore.setState({ currentUserId: me });
  });

  it("adds an incoming pending request (target = me)", async () => {
    await useFriendsStore.getState().applyRelationshipEvent(
      "INSERT", row({ requester_id: "other", target_id: me }),
    );
    const s = useFriendsStore.getState();
    expect(s.pendingRequests.map((r) => r.id)).toContain("rel-1");
    expect(s.outgoingRequests).toHaveLength(0);
  });

  it("adds an outgoing pending request (requester = me)", async () => {
    await useFriendsStore.getState().applyRelationshipEvent("INSERT", row({}));
    const s = useFriendsStore.getState();
    expect(s.outgoingRequests.map((r) => r.id)).toContain("rel-1");
    expect(s.pendingRequests).toHaveLength(0);
  });

  it("moves pending → friends on UPDATE to accepted (no duplicate)", async () => {
    await useFriendsStore.getState().applyRelationshipEvent(
      "INSERT", row({ requester_id: "other", target_id: me }),
    );
    await useFriendsStore.getState().applyRelationshipEvent(
      "UPDATE", row({ requester_id: "other", target_id: me, status: "accepted" }),
    );
    const s = useFriendsStore.getState();
    expect(s.friends.map((r) => r.id)).toEqual(["rel-1"]);
    expect(s.pendingRequests).toHaveLength(0);
  });

  it("removes from every bucket on DELETE (by id only)", async () => {
    useFriendsStore.setState({
      friends: [{ id: "rel-1", requesterId: "other", targetId: me, status: "accepted", createdAt: "" }],
    });
    await useFriendsStore.getState().applyRelationshipEvent("DELETE", { id: "rel-1" });
    expect(useFriendsStore.getState().friends).toHaveLength(0);
  });

  it("ignores events that don't involve the current user", async () => {
    await useFriendsStore.getState().applyRelationshipEvent(
      "INSERT", row({ requester_id: "x", target_id: "y" }),
    );
    const s = useFriendsStore.getState();
    expect(s.pendingRequests).toHaveLength(0);
    expect(s.outgoingRequests).toHaveLength(0);
  });
});
