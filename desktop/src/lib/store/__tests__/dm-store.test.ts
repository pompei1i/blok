import { describe, it, expect, beforeEach } from "vitest";
import { useDMStore } from "../dm-store";
import { useAuthStore } from "../auth-store";

// Reset store state before each test
beforeEach(() => {
  useDMStore.setState({
    openDMs: {},
    incomingCall: null,
    outgoingCall: null,
    activeCall: null,
  });
});

// ── closeDM ───────────────────────────────────────────────────────────────────

describe("closeDM", () => {
  it("removes the DM window from openDMs", () => {
    useDMStore.setState({
      openDMs: {
        user1: { userId: "user1", position: { x: 100, y: 200 }, minimized: false, messages: [], unreadCount: 0 },
      },
    });
    useDMStore.getState().closeDM("user1");
    expect(useDMStore.getState().openDMs["user1"]).toBeUndefined();
  });

  it("does nothing when the DM does not exist", () => {
    useDMStore.setState({ openDMs: {} });
    expect(() => useDMStore.getState().closeDM("nonexistent")).not.toThrow();
    expect(useDMStore.getState().openDMs).toEqual({});
  });

  it("leaves other DMs intact when closing one", () => {
    useDMStore.setState({
      openDMs: {
        user1: { userId: "user1", position: { x: 0, y: 0 }, minimized: false, messages: [], unreadCount: 0 },
        user2: { userId: "user2", position: { x: 0, y: 0 }, minimized: false, messages: [], unreadCount: 0 },
      },
    });
    useDMStore.getState().closeDM("user1");
    expect(useDMStore.getState().openDMs["user1"]).toBeUndefined();
    expect(useDMStore.getState().openDMs["user2"]).toBeDefined();
  });
});

// ── minimizeDM / restoreDM ────────────────────────────────────────────────────

describe("minimizeDM", () => {
  it("sets minimized to true", () => {
    useDMStore.setState({
      openDMs: {
        user1: { userId: "user1", position: { x: 0, y: 0 }, minimized: false, messages: [], unreadCount: 0 },
      },
    });
    useDMStore.getState().minimizeDM("user1");
    expect(useDMStore.getState().openDMs["user1"].minimized).toBe(true);
  });

  it("does nothing when the DM does not exist", () => {
    useDMStore.setState({ openDMs: {} });
    expect(() => useDMStore.getState().minimizeDM("ghost")).not.toThrow();
  });
});

describe("restoreDM", () => {
  it("sets minimized to false", () => {
    useDMStore.setState({
      openDMs: {
        user1: { userId: "user1", position: { x: 0, y: 0 }, minimized: true, messages: [], unreadCount: 3 },
      },
    });
    useDMStore.getState().restoreDM("user1");
    expect(useDMStore.getState().openDMs["user1"].minimized).toBe(false);
    // unreadCount should be preserved (clearUnread is separate)
    expect(useDMStore.getState().openDMs["user1"].unreadCount).toBe(3);
  });

  it("does nothing when the DM does not exist", () => {
    useDMStore.setState({ openDMs: {} });
    expect(() => useDMStore.getState().restoreDM("ghost")).not.toThrow();
  });
});

// ── updatePosition ────────────────────────────────────────────────────────────

describe("updatePosition", () => {
  it("updates the position of an open DM", () => {
    useDMStore.setState({
      openDMs: {
        user1: { userId: "user1", position: { x: 0, y: 0 }, minimized: false, messages: [], unreadCount: 0 },
      },
    });
    useDMStore.getState().updatePosition("user1", { x: 350, y: 220 });
    expect(useDMStore.getState().openDMs["user1"].position).toEqual({ x: 350, y: 220 });
  });

  it("does nothing for a non-existent DM", () => {
    useDMStore.setState({ openDMs: {} });
    expect(() => useDMStore.getState().updatePosition("ghost", { x: 1, y: 1 })).not.toThrow();
  });
});

// ── clearUnread ───────────────────────────────────────────────────────────────

describe("clearUnread", () => {
  it("resets unreadCount to 0", () => {
    useDMStore.setState({
      openDMs: {
        user1: { userId: "user1", position: { x: 0, y: 0 }, minimized: true, messages: [], unreadCount: 7 },
      },
    });
    useDMStore.getState().clearUnread("user1");
    expect(useDMStore.getState().openDMs["user1"].unreadCount).toBe(0);
  });

  it("does nothing for a non-existent DM", () => {
    useDMStore.setState({ openDMs: {} });
    expect(() => useDMStore.getState().clearUnread("ghost")).not.toThrow();
  });
});

// ── call state ────────────────────────────────────────────────────────────────

describe("declineCall", () => {
  it("clears incomingCall without affecting openDMs", () => {
    // Both declineCall and endCall check useAuthStore for the current user ID.
    useAuthStore.setState({
      user: { id: "me", username: "testuser", displayName: "Test", email: "", createdAt: "" },
      isAuthenticated: true,
      isLoading: false,
    });

    useDMStore.setState({
      incomingCall: { fromUserId: "caller", fromUsername: "alice", dmChannelId: "ch1" },
      openDMs: {
        caller: { userId: "caller", position: { x: 0, y: 0 }, minimized: false, messages: [], unreadCount: 0 },
      },
    });

    useDMStore.getState().declineCall();

    expect(useDMStore.getState().incomingCall).toBeNull();
    expect(useDMStore.getState().openDMs["caller"]).toBeDefined();
  });
});

describe("endCall", () => {
  it("clears activeCall", () => {
    useAuthStore.setState({
      user: { id: "me", username: "testuser", displayName: "Test", email: "", createdAt: "" },
      isAuthenticated: true,
      isLoading: false,
    });

    useDMStore.setState({
      activeCall: {
        peerUserId: "peer1",
        peerUsername: "bob",
        dmChannelId: "ch-active",
        startedAt: Date.now(),
      },
    });
    useDMStore.getState().endCall();
    expect(useDMStore.getState().activeCall).toBeNull();
  });
});
