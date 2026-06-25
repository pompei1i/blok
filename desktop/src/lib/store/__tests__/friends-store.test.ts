import { describe, it, expect, beforeEach } from "vitest";
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

beforeEach(() => {
  useFriendsStore.setState({
    friends: [],
    pendingRequests: [],
    outgoingRequests: [],
    presence: {},
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
