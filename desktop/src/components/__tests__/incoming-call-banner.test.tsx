import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IncomingCallBanner } from "@/components/blok/incoming-call-banner";

const { mockUseDMStore, mockUseFriendsStore } = vi.hoisted(() => ({
  mockUseDMStore: vi.fn(),
  mockUseFriendsStore: vi.fn(),
}));

vi.mock("@/lib/store/dm-store", () => ({ useDMStore: mockUseDMStore }));
vi.mock("@/lib/store/friends-store", () => ({ useFriendsStore: mockUseFriendsStore }));
// Stub UserAvatar to avoid deep rendering
vi.mock("@/components/blok/user-avatar", () => ({
  UserAvatar: () => <div data-testid="user-avatar" />,
}));

const mockAcceptCall = vi.fn();
const mockDeclineCall = vi.fn();
const mockCancelCall = vi.fn();

const noCall = {
  incomingCall: null,
  outgoingCall: null,
  acceptCall: mockAcceptCall,
  declineCall: mockDeclineCall,
  cancelCall: mockCancelCall,
};

beforeEach(() => {
  mockAcceptCall.mockReset().mockResolvedValue(undefined);
  mockDeclineCall.mockReset();
  mockCancelCall.mockReset();
  mockUseFriendsStore.mockReturnValue({ friends: [] });
  mockUseDMStore.mockReturnValue({ ...noCall });
});

// ── no call ───────────────────────────────────────────────────────────────────

describe("no call", () => {
  it("renders nothing when there is no incoming or outgoing call", () => {
    const { container } = render(<IncomingCallBanner />);
    expect(container.firstChild).toBeNull();
  });
});

// ── incoming call ─────────────────────────────────────────────────────────────

describe("incoming call", () => {
  const incoming = {
    incomingCall: { fromUserId: "u-2", fromUsername: "bob", dmChannelId: "dm-1" },
    outgoingCall: null,
    acceptCall: mockAcceptCall,
    declineCall: mockDeclineCall,
    cancelCall: mockCancelCall,
  };

  it("shows caller username", () => {
    mockUseDMStore.mockReturnValue(incoming);
    render(<IncomingCallBanner />);
    expect(screen.getByText("@bob")).toBeTruthy();
  });

  it("shows 'incoming call' label", () => {
    mockUseDMStore.mockReturnValue(incoming);
    render(<IncomingCallBanner />);
    expect(screen.getByText(/incoming call/i)).toBeTruthy();
  });

  it("accept button calls acceptCall", () => {
    mockUseDMStore.mockReturnValue(incoming);
    render(<IncomingCallBanner />);
    fireEvent.click(screen.getByTitle("Accept"));
    expect(mockAcceptCall).toHaveBeenCalledTimes(1);
  });

  it("decline button calls declineCall", () => {
    mockUseDMStore.mockReturnValue(incoming);
    render(<IncomingCallBanner />);
    fireEvent.click(screen.getByTitle("Decline"));
    expect(mockDeclineCall).toHaveBeenCalledTimes(1);
  });
});

// ── outgoing call ─────────────────────────────────────────────────────────────

describe("outgoing call", () => {
  const outgoing = {
    incomingCall: null,
    outgoingCall: { toUserId: "u-3", toUsername: "carol", dmChannelId: "dm-2" },
    acceptCall: mockAcceptCall,
    declineCall: mockDeclineCall,
    cancelCall: mockCancelCall,
  };

  it("shows callee username and 'calling' label", () => {
    mockUseDMStore.mockReturnValue(outgoing);
    render(<IncomingCallBanner />);
    expect(screen.getByText("@carol")).toBeTruthy();
    expect(screen.getByText(/calling/i)).toBeTruthy();
  });

  it("cancel button calls cancelCall", () => {
    mockUseDMStore.mockReturnValue(outgoing);
    render(<IncomingCallBanner />);
    fireEvent.click(screen.getByTitle("Cancel"));
    expect(mockCancelCall).toHaveBeenCalledTimes(1);
  });
});
