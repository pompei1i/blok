import { describe, it, expect, beforeEach } from "vitest";
import { useFriendsStore } from "../friends-store";
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
