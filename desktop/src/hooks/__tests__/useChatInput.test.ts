import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatInput } from "@/hooks/useChatInput";
import { MAX_FILE_SIZE } from "@/lib/constants";
import type { User } from "@/lib/store/types";

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockAddMessage = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/store/server-store", () => ({
  useServerStore: () => ({ addMessage: mockAddMessage }),
}));


// ── fixtures ──────────────────────────────────────────────────────────────────

const mockUser: User = {
  id: "user-1",
  username: "testuser",
  email: "test@example.com",
  createdAt: "2024-01-01T00:00:00Z",
};

const defaultOpts = { activeChannelId: "ch-1", user: mockUser };

const makeFile = (name: string, size: number) => {
  const f = new File(["x".repeat(size)], name, { type: "text/plain" });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

beforeEach(() => {
  mockAddMessage.mockReset();
  mockAddMessage.mockResolvedValue(undefined);
});

// ── canSend ───────────────────────────────────────────────────────────────────

describe("canSend", () => {
  it("is false when inputValue is empty and no attachments", () => {
    const { result } = renderHook(() => useChatInput(defaultOpts));
    expect(result.current.canSend).toBe(false);
  });

  it("is true when inputValue has non-whitespace content", () => {
    const { result } = renderHook(() => useChatInput(defaultOpts));
    act(() => { result.current.setInputValue("hello"); });
    expect(result.current.canSend).toBe(true);
  });

  it("is false when inputValue is only whitespace", () => {
    const { result } = renderHook(() => useChatInput(defaultOpts));
    act(() => { result.current.setInputValue("   "); });
    expect(result.current.canSend).toBe(false);
  });

  it("is true when there are file attachments even with empty text", () => {
    const { result } = renderHook(() => useChatInput(defaultOpts));
    act(() => { result.current.handleAttach([makeFile("doc.txt", 100)]); });
    expect(result.current.canSend).toBe(true);
  });

  it("is true when there are gif attachments even with empty text", () => {
    const { result } = renderHook(() => useChatInput(defaultOpts));
    act(() => { result.current.handleGifSelect("https://media.tenor.com/abc.gif"); });
    expect(result.current.canSend).toBe(true);
  });
});

// ── handleKeyDown ─────────────────────────────────────────────────────────────

describe("handleKeyDown", () => {
  const makeKeyEvent = (key: string, shiftKey = false) =>
    ({ key, shiftKey, preventDefault: vi.fn() }) as unknown as React.KeyboardEvent;

  it("sends message on Enter", async () => {
    const { result } = renderHook(() => useChatInput(defaultOpts));
    act(() => { result.current.setInputValue("hello"); });

    const event = makeKeyEvent("Enter");
    await act(async () => { result.current.handleKeyDown(event); });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(mockAddMessage).toHaveBeenCalledWith("ch-1", expect.objectContaining({ content: "hello" }));
  });

  it("does NOT send on Shift+Enter", async () => {
    const { result } = renderHook(() => useChatInput(defaultOpts));
    act(() => { result.current.setInputValue("hello"); });

    const event = makeKeyEvent("Enter", true);
    await act(async () => { result.current.handleKeyDown(event); });

    expect(mockAddMessage).not.toHaveBeenCalled();
  });

  it("does nothing on other keys", async () => {
    const { result } = renderHook(() => useChatInput(defaultOpts));
    act(() => { result.current.setInputValue("hello"); });

    const event = makeKeyEvent("a");
    await act(async () => { result.current.handleKeyDown(event); });

    expect(mockAddMessage).not.toHaveBeenCalled();
  });
});

// ── handleSendMessage ─────────────────────────────────────────────────────────

describe("handleSendMessage", () => {
  it("calls addMessage with correct shape and clears inputValue", async () => {
    const { result } = renderHook(() => useChatInput(defaultOpts));
    act(() => { result.current.setInputValue("world"); });

    await act(async () => { await result.current.handleSendMessage(); });

    expect(mockAddMessage).toHaveBeenCalledWith(
      "ch-1",
      expect.objectContaining({
        channelId: "ch-1",
        authorId: "user-1",
        content: "world",
        attachments: [],
      }),
    );
    expect(result.current.inputValue).toBe("");
  });

  it("does nothing when canSend is false", async () => {
    const { result } = renderHook(() => useChatInput(defaultOpts));
    await act(async () => { await result.current.handleSendMessage(); });
    expect(mockAddMessage).not.toHaveBeenCalled();
  });

  it("does nothing when activeChannelId is null", async () => {
    const { result } = renderHook(() => useChatInput({ activeChannelId: null, user: mockUser }));
    act(() => { result.current.setInputValue("hello"); });
    await act(async () => { await result.current.handleSendMessage(); });
    expect(mockAddMessage).not.toHaveBeenCalled();
  });

  it("does nothing when user is null", async () => {
    const { result } = renderHook(() => useChatInput({ activeChannelId: "ch-1", user: null }));
    act(() => { result.current.setInputValue("hello"); });
    await act(async () => { await result.current.handleSendMessage(); });
    expect(mockAddMessage).not.toHaveBeenCalled();
  });

  it("clears gif attachments and reply after send", async () => {
    const { result } = renderHook(() => useChatInput(defaultOpts));
    act(() => { result.current.handleGifSelect("https://example.com/a.gif"); });

    await act(async () => { await result.current.handleSendMessage(); });

    expect(result.current.gifAttachments).toHaveLength(0);
    expect(result.current.replyTo).toBeNull();
  });

  it("includes replyToId when replying", async () => {
    const { result } = renderHook(() => useChatInput(defaultOpts));

    const replyMsg = {
      id: "msg-42",
      channelId: "ch-1",
      authorId: "user-2",
      content: "original",
      createdAt: "",
      updatedAt: "",
      isEdited: false,
      author: mockUser,
      attachments: [],
    };

    act(() => {
      result.current.setReplyTo(replyMsg);
      result.current.setInputValue("reply text");
    });

    await act(async () => { await result.current.handleSendMessage(); });

    expect(mockAddMessage).toHaveBeenCalledWith(
      "ch-1",
      expect.objectContaining({ replyToId: "msg-42" }),
    );
  });
});

// ── emoji / mention ───────────────────────────────────────────────────────────

describe("handleEmojiSelect", () => {
  it("appends emoji to inputValue", () => {
    const { result } = renderHook(() => useChatInput(defaultOpts));
    act(() => { result.current.setInputValue("hello "); });
    act(() => { result.current.handleEmojiSelect("👋"); });
    expect(result.current.inputValue).toBe("hello 👋");
  });
});

describe("handleMentionSelect", () => {
  it("appends mention followed by a space", () => {
    const { result } = renderHook(() => useChatInput(defaultOpts));
    act(() => { result.current.handleMentionSelect("@alice"); });
    expect(result.current.inputValue).toBe("@alice ");
  });
});

// ── gif ───────────────────────────────────────────────────────────────────────

describe("handleGifSelect", () => {
  it("adds gif attachment with correct shape", () => {
    const { result } = renderHook(() => useChatInput(defaultOpts));
    act(() => { result.current.handleGifSelect("https://media.tenor.com/test.gif"); });

    expect(result.current.gifAttachments).toHaveLength(1);
    expect(result.current.gifAttachments[0]).toMatchObject({
      url: "https://media.tenor.com/test.gif",
      mediaType: "image/gif",
      filename: "gif",
    });
  });
});

// ── file attach ───────────────────────────────────────────────────────────────

describe("handleAttach", () => {
  it("adds valid files to attachments", () => {
    const { result } = renderHook(() => useChatInput(defaultOpts));
    const file = makeFile("doc.txt", 1024);
    act(() => { result.current.handleAttach([file]); });
    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.fileError).toBeNull();
  });

  it("sets fileError and skips oversized files", () => {
    const { result } = renderHook(() => useChatInput(defaultOpts));
    const big = makeFile("huge.zip", MAX_FILE_SIZE + 1);
    act(() => { result.current.handleAttach([big]); });
    expect(result.current.fileError).toContain("huge.zip");
    expect(result.current.attachments).toHaveLength(0);
  });

  it("adds valid files and sets error when mixed sizes", () => {
    const { result } = renderHook(() => useChatInput(defaultOpts));
    const small = makeFile("ok.txt", 100);
    const big = makeFile("nope.zip", MAX_FILE_SIZE + 1);
    act(() => { result.current.handleAttach([small, big]); });
    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.fileError).toContain("nope.zip");
  });

  it("clears fileError on subsequent valid attach", () => {
    const { result } = renderHook(() => useChatInput(defaultOpts));
    act(() => { result.current.handleAttach([makeFile("huge.zip", MAX_FILE_SIZE + 1)]); });
    expect(result.current.fileError).not.toBeNull();

    act(() => { result.current.handleAttach([makeFile("ok.txt", 100)]); });
    expect(result.current.fileError).toBeNull();
  });
});

describe("removeAttachment", () => {
  it("removes file at given index", () => {
    const { result } = renderHook(() => useChatInput(defaultOpts));
    act(() => {
      result.current.handleAttach([makeFile("a.txt", 10), makeFile("b.txt", 20)]);
    });
    act(() => { result.current.removeAttachment(0); });
    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.attachments[0].name).toBe("b.txt");
  });
});

describe("removeGifAttachment", () => {
  it("removes gif at given index", () => {
    const { result } = renderHook(() => useChatInput(defaultOpts));
    act(() => {
      result.current.handleGifSelect("https://example.com/a.gif");
      result.current.handleGifSelect("https://example.com/b.gif");
    });
    act(() => { result.current.removeGifAttachment(0); });
    expect(result.current.gifAttachments).toHaveLength(1);
    expect(result.current.gifAttachments[0].url).toBe("https://example.com/b.gif");
  });
});

// ── closeAllPickers ───────────────────────────────────────────────────────────

describe("closeAllPickers", () => {
  it("resets all picker states to false", () => {
    const { result } = renderHook(() => useChatInput(defaultOpts));
    act(() => {
      result.current.setShowEmojiPicker(true);
      result.current.setShowGifPicker(true);
      result.current.setShowMentionPicker(true);
      result.current.setShowAttachmentPicker(true);
    });

    act(() => { result.current.closeAllPickers(); });

    expect(result.current.showEmojiPicker).toBe(false);
    expect(result.current.showGifPicker).toBe(false);
    expect(result.current.showMentionPicker).toBe(false);
    expect(result.current.showAttachmentPicker).toBe(false);
  });
});
