import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MessageBubble } from "@/components/blok/message-bubble";
import type { Message, User } from "@/lib/store/types";

// ── mocks ─────────────────────────────────────────────────────────────────────

const { mockUseFriendsStore, mockUseAuthStore } = vi.hoisted(() => ({
  mockUseFriendsStore: vi.fn(),
  mockUseAuthStore: vi.fn(),
}));

vi.mock("@/lib/store/friends-store", () => ({
  useFriendsStore: mockUseFriendsStore,
  effectiveStatus: () => "offline",
}));
vi.mock("@/lib/store/auth-store", () => ({ useAuthStore: mockUseAuthStore }));

vi.mock("@/components/blok/user-avatar", () => ({
  UserAvatar: ({ user }: { user?: User }) => (
    <div data-testid="user-avatar">{user?.username}</div>
  ),
}));
vi.mock("@/components/blok/presence-dot", () => ({
  PresenceDot: () => <div data-testid="presence-dot" />,
}));

// LazyImage / LazyMedia use IntersectionObserver — stub it globally
globalThis.IntersectionObserver = vi.fn(() => ({
  observe: vi.fn(),
  disconnect: vi.fn(),
  unobserve: vi.fn(),
})) as unknown as typeof IntersectionObserver;

// ── fixtures ──────────────────────────────────────────────────────────────────

const mockUser: User = {
  id: "user-1",
  username: "alice",
  email: "alice@test.com",
  createdAt: "2024-01-01T00:00:00Z",
};

const baseMsg: Message = {
  id: "msg-1",
  channelId: "ch-1",
  authorId: "user-1",
  content: "hello world",
  isEdited: false,
  createdAt: "2024-01-01T12:00:00Z",
  updatedAt: "2024-01-01T12:00:00Z",
};

beforeEach(() => {
  mockUseFriendsStore.mockReturnValue({ presence: {}, presenceLastSeen: {} });
  mockUseAuthStore.mockReturnValue({ user: null });
});

// ── plain text ────────────────────────────────────────────────────────────────

describe("plain text", () => {
  it("renders message content", () => {
    render(<MessageBubble message={{ ...baseMsg, content: "hello world" }} />);
    expect(screen.getByText("hello world")).toBeTruthy();
  });

  it("renders username with @ prefix", () => {
    render(<MessageBubble message={baseMsg} user={mockUser} showAvatar />);
    expect(screen.getByText("@alice")).toBeTruthy();
  });

  it("shows (edited) label when isEdited=true", () => {
    render(<MessageBubble message={{ ...baseMsg, isEdited: true }} user={mockUser} showAvatar />);
    expect(screen.getByText("(edited)")).toBeTruthy();
  });
});

// ── markdown formatting ───────────────────────────────────────────────────────

describe("markdown formatting", () => {
  it("renders **bold** as <strong>", () => {
    const { container } = render(
      <MessageBubble message={{ ...baseMsg, content: "**bold text**" }} />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("bold text");
  });

  it("renders *italic* as <em>", () => {
    const { container } = render(
      <MessageBubble message={{ ...baseMsg, content: "*italic text*" }} />,
    );
    expect(container.querySelector("em")?.textContent).toBe("italic text");
  });

  it("renders `code` as <code>", () => {
    const { container } = render(
      <MessageBubble message={{ ...baseMsg, content: "`const x = 1`" }} />,
    );
    expect(container.querySelector("code")?.textContent).toBe("const x = 1");
  });
});

// ── XSS protection ────────────────────────────────────────────────────────────

describe("XSS protection", () => {
  it("does not inject raw <script> tags", () => {
    const { container } = render(
      <MessageBubble message={{ ...baseMsg, content: "<script>alert(1)</script>" }} />,
    );
    expect(container.querySelector("script")).toBeNull();
  });

  it("does not inject onerror attributes into img", () => {
    const { container } = render(
      <MessageBubble message={{ ...baseMsg, content: '<img src="x" onerror="alert(1)">' }} />,
    );
    const imgs = container.querySelectorAll("img");
    imgs.forEach((img) => expect(img.getAttribute("onerror")).toBeNull());
  });

  it("strips onclick from injected anchor via URL regex", () => {
    const { container } = render(
      <MessageBubble
        message={{ ...baseMsg, content: 'https://x.com" onclick="alert(1)' }}
      />,
    );
    const anchors = container.querySelectorAll("a");
    anchors.forEach((a) => expect(a.getAttribute("onclick")).toBeNull());
  });
});

// ── reactions ─────────────────────────────────────────────────────────────────

describe("reactions", () => {
  const msgWithReactions: Message = {
    ...baseMsg,
    reactions: [
      { id: "r1", messageId: "msg-1", userId: "user-2", emoji: "👍", createdAt: "" },
      { id: "r2", messageId: "msg-1", userId: "user-3", emoji: "👍", createdAt: "" },
      { id: "r3", messageId: "msg-1", userId: "user-2", emoji: "❤️", createdAt: "" },
    ],
  };

  it("shows reaction emoji and grouped count", () => {
    render(<MessageBubble message={msgWithReactions} />);
    // 👍 appears twice → count 2; ❤️ once → count 1
    expect(screen.getByText("👍")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("❤️")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("calls onReact when clicking a reaction the user hasn't made", () => {
    const onReact = vi.fn();
    render(
      <MessageBubble message={msgWithReactions} onReact={onReact} currentUserId="user-99" />,
    );
    fireEvent.click(screen.getByText("👍").closest("button")!);
    expect(onReact).toHaveBeenCalledWith("👍");
  });

  it("calls onRemoveReact when clicking user's own reaction", () => {
    const onRemoveReact = vi.fn();
    render(
      <MessageBubble
        message={msgWithReactions}
        onRemoveReact={onRemoveReact}
        currentUserId="user-2"
      />,
    );
    fireEvent.click(screen.getByText("👍").closest("button")!);
    expect(onRemoveReact).toHaveBeenCalledWith("👍");
  });
});

// ── context menu actions ──────────────────────────────────────────────────────

describe("context menu actions (non-DM)", () => {
  it("opens menu and calls onReply", () => {
    const onReply = vi.fn();
    render(<MessageBubble message={baseMsg} onReply={onReply} />);
    // MoreHorizontal is the only button when no onReact provided
    const [moreBtn] = screen.getAllByRole("button");
    fireEvent.click(moreBtn);
    fireEvent.click(screen.getByText("Reply"));
    expect(onReply).toHaveBeenCalledWith(baseMsg);
  });

  it("opens menu and calls onDelete for own message", () => {
    const onDelete = vi.fn();
    render(<MessageBubble message={baseMsg} isOwn onDelete={onDelete} />);
    const [moreBtn] = screen.getAllByRole("button");
    fireEvent.click(moreBtn);
    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalledWith("msg-1");
  });

  it("saves edit on Enter and calls onEdit", () => {
    const onEdit = vi.fn();
    render(<MessageBubble message={baseMsg} isOwn onEdit={onEdit} />);
    const [moreBtn] = screen.getAllByRole("button");
    fireEvent.click(moreBtn);
    fireEvent.click(screen.getByText("Edit"));
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "updated text" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onEdit).toHaveBeenCalledWith("msg-1", "updated text");
  });

  it("cancels edit on Escape without calling onEdit", () => {
    const onEdit = vi.fn();
    render(<MessageBubble message={baseMsg} isOwn onEdit={onEdit} />);
    const [moreBtn] = screen.getAllByRole("button");
    fireEvent.click(moreBtn);
    fireEvent.click(screen.getByText("Edit"));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

// ── DM mode ───────────────────────────────────────────────────────────────────

describe("DM mode", () => {
  const dmMsg = { ...baseMsg };

  it("renders content in DM layout", () => {
    render(<MessageBubble message={dmMsg} isDM />);
    expect(screen.getByText("hello world")).toBeTruthy();
  });

  it("DM reply button calls onReply", () => {
    const onReply = vi.fn();
    render(<MessageBubble message={dmMsg} isDM onReply={onReply} />);
    fireEvent.click(screen.getByLabelText("Reply"));
    expect(onReply).toHaveBeenCalledWith(dmMsg);
  });

  it("DM delete button calls onDelete for own message", () => {
    const onDelete = vi.fn();
    render(<MessageBubble message={dmMsg} isDM isOwn onDelete={onDelete} />);
    fireEvent.click(screen.getByLabelText("Delete"));
    expect(onDelete).toHaveBeenCalledWith("msg-1");
  });
});
