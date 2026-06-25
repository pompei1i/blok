import { describe, it, expect, beforeEach, vi } from "vitest";
import { useFriendsStore, effectiveStatus, ONLINE_THRESHOLD_MS } from "../friends-store";
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
  const fresh = new Date().toISOString();
  const stale = new Date(Date.now() - ONLINE_THRESHOLD_MS - 1000).toISOString();

  it("returns offline immediately when status is explicitly offline, even with a fresh heartbeat", () => {
    // A clean app close/logout writes status: "offline" without touching online_at,
    // so this must not fall through to the staleness check below.
    expect(effectiveStatus("offline", fresh)).toBe("offline");
  });

  it("returns offline when last_seen is missing", () => {
    expect(effectiveStatus("online", undefined)).toBe("offline");
  });

  it("returns offline when last_seen is stale, even if status is online", () => {
    expect(effectiveStatus("online", stale)).toBe("offline");
  });

  it("returns dnd/afk when fresh and set", () => {
    expect(effectiveStatus("dnd", fresh)).toBe("dnd");
    expect(effectiveStatus("afk", fresh)).toBe("afk");
  });

  it("returns online when fresh and status is online", () => {
    expect(effectiveStatus("online", fresh)).toBe("online");
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
