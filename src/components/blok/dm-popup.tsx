import { useRef, useState, useEffect } from "react";
import { X, Minus, Send, Smile, PlusCircle, Paperclip } from "lucide-react";
import type { Attachment } from "@/lib/store/types";
import { useDMStore } from "@/lib/store/dm-store";
import { useFriendsStore } from "@/lib/store/friends-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { UserAvatar } from "./user-avatar";
import { PresenceDot } from "./presence-dot";
import { MessageBubble } from "./message-bubble";
import { cn } from "@/lib/utils";
import type { DMWindowState } from "@/lib/store/types";
import { useI18n } from "@/lib/i18n";
import { EmojiPicker } from "./emoji-picker";
import { GifPicker } from "./gif-picker";
import { AttachmentPicker } from "./attachment-picker";

interface DMPopupProps {
  dmState: DMWindowState;
  windowIndex: number;
}

export function DMPopup({ dmState }: DMPopupProps) {
  const { t } = useI18n();
  const {
    closeDM,
    minimizeDM,
    restoreDM,
    updatePosition,
    addMessage,
    clearUnread,
  } = useDMStore();
  const { friends, presence } = useFriendsStore();
  const { user } = useAuthStore();
  const [inputValue, setInputValue] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showAttachmentPicker, setShowAttachmentPicker] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [gifAttachments, setGifAttachments] = useState<Attachment[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const friendRel = friends.find(
    (f) => f.targetId === dmState.userId || f.requesterId === dmState.userId,
  );
  const friend =
    friendRel?.targetId === dmState.userId
      ? friendRel?.targetUser
      : friendRel?.requesterUser;
  const friendPresence = presence[dmState.userId] || "offline";

  useEffect(() => {
    if (!dmState.minimized) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      clearUnread(dmState.userId);
    }
  }, [dmState.messages, dmState.minimized, dmState.userId, clearUnread]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const x = Math.max(0, Math.min(window.innerWidth - 340, e.clientX - dragOffset.current.x));
      const y = Math.max(0, Math.min(window.innerHeight - 48, e.clientY - dragOffset.current.y));
      updatePosition(dmState.userId, { x, y });
    };
    const onUp = () => setDragging(false);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [dragging, dmState.userId, updatePosition]);

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    dragOffset.current = { x: e.clientX - dmState.position.x, y: e.clientY - dmState.position.y };
    setDragging(true);
  };

  const handleSendMessage = async () => {
    if ((!inputValue.trim() && attachments.length === 0 && gifAttachments.length === 0) || !user) return;
    const sent = await addMessage(dmState.userId, user.id, inputValue.trim(), attachments, gifAttachments);
    if (sent) {
      setInputValue("");
      setAttachments([]);
      setGifAttachments([]);
      setShowEmojiPicker(false);
      setShowGifPicker(false);
      setShowAttachmentPicker(false);
    }
  };

  const handleGifSelect = (url: string) => {
    setGifAttachments((prev) => [
      ...prev,
      {
        id: `gif-${Date.now()}`,
        messageId: "",
        url,
        filename: "gif",
        mediaType: "image/gif",
        sizeBytes: 0,
        createdAt: new Date().toISOString(),
      },
    ]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    setInputValue((prev) => prev + emoji);
  };

  const handleAttach = (files: File[]) => {
    setAttachments((prev) => [...prev, ...files]);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  if (dmState.minimized) {
    return (
      <button
        onClick={() => restoreDM(dmState.userId)}
        className="fixed bottom-16 right-4 flex items-center gap-2 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-full px-3 py-2 hover:bg-[var(--bg-hover)] transition-colors shadow-lg z-50"
        style={{
          right: `${
            16 +
            Object.keys(useDMStore.getState().openDMs).indexOf(dmState.userId) *
              150
          }px`,
        }}
      >
        <div className="relative">
          <UserAvatar user={friend} size="sm" />
          <PresenceDot
            status={friendPresence}
            size="sm"
            className="absolute -bottom-0.5 -right-0.5 ring-2 ring-[var(--bg-elevated)]"
          />
        </div>
        <span className="text-sm text-[var(--text-primary)]">
          @{friend?.username}
        </span>
        {dmState.unreadCount > 0 && (
          <span className="bg-[var(--accent-red)] text-white text-xs rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
            {dmState.unreadCount}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      className="fixed w-[340px] h-[420px] bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-2xl flex flex-col z-50 overflow-hidden animate-slide-in"
      style={{
        left: `${dmState.position.x}px`,
        top: `${dmState.position.y}px`,
      }}
    >
      <div
        className="dm-header flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-elevated)] cursor-grab active:cursor-grabbing select-none"
        onMouseDown={handleHeaderMouseDown}
      >
        <div className="relative">
          <PresenceDot status={friendPresence} size="md" />
        </div>
        <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">
          @{friend?.username ?? dmState.userId.slice(0, 8)}
        </span>
        <button
          onClick={() => minimizeDM(dmState.userId)}
          className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors"
        >
          <Minus className="w-4 h-4 text-[var(--text-muted)]" />
        </button>
        <button
          onClick={() => closeDM(dmState.userId)}
          className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors"
        >
          <X className="w-4 h-4 text-[var(--text-muted)]" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-[var(--bg-base)]">
        {dmState.messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <UserAvatar user={friend} size="xl" className="mb-3" />
            <p className="text-sm text-[var(--text-primary)] font-medium">
              @{friend?.username ?? dmState.userId.slice(0, 8)}
            </p>
            {friend?.pronouns && (
              <p className="text-xs text-[var(--text-muted)] opacity-70">
                {friend.pronouns}
              </p>
            )}
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {t("dm.startConversation")}
            </p>
          </div>
        ) : (
          <>
            {dmState.messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                user={message.authorId === user?.id ? user : friend}
                isOwn={message.authorId === user?.id}
                showAvatar
                isDM
              />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      <div className="p-2 border-t border-[var(--border)] bg-[var(--bg-surface)]">
        {(attachments.length > 0 || gifAttachments.length > 0) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((file, idx) => (
              <div
                key={`${file.name}-${idx}`}
                className="flex items-center gap-1.5 px-2 py-1 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md"
              >
                <Paperclip className="w-3 h-3 text-[var(--text-muted)]" />
                <span className="text-xs text-[var(--text-primary)] max-w-28 truncate">
                  {file.name}
                </span>
                <button
                  onClick={() => removeAttachment(idx)}
                  className="p-0.5 hover:bg-[var(--bg-hover)] rounded"
                >
                  <X className="w-3 h-3 text-[var(--text-muted)]" />
                </button>
              </div>
            ))}
            {gifAttachments.map((att, idx) => (
              <div key={att.id} className="relative">
                <img
                  src={att.url}
                  alt="gif"
                  className="h-12 rounded border border-[var(--border)] object-cover"
                />
                <button
                  onClick={() => setGifAttachments((prev) => prev.filter((_, i) => i !== idx))}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-full flex items-center justify-center hover:bg-[var(--bg-hover)]"
                >
                  <X className="w-2.5 h-2.5 text-[var(--text-muted)]" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border)] px-2 py-1.5">
          <div className="relative">
            <button
              onClick={() => {
                setShowAttachmentPicker((v) => !v);
                setShowEmojiPicker(false);
              }}
              className={cn(
                "p-1 hover:bg-[var(--bg-hover)] rounded transition-colors",
                showAttachmentPicker && "bg-[var(--bg-hover)]",
              )}
            >
              <PlusCircle className="w-4 h-4 text-[var(--text-muted)]" />
            </button>
            {showAttachmentPicker && (
              <AttachmentPicker
                onAttach={handleAttach}
                onClose={() => setShowAttachmentPicker(false)}
              />
            )}
          </div>

          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("dm.messagePlaceholder").replace("{username}", friend?.username ?? "")}
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
          <div className="relative">
            <button
              onClick={() => {
                setShowGifPicker((v) => !v);
                setShowEmojiPicker(false);
                setShowAttachmentPicker(false);
              }}
              className={cn(
                "p-1 hover:bg-[var(--bg-hover)] rounded transition-colors text-[var(--text-muted)] text-[10px] font-bold leading-none",
                showGifPicker && "bg-[var(--bg-hover)]",
              )}
            >
              GIF
            </button>
            {showGifPicker && (
              <GifPicker
                onSelect={handleGifSelect}
                onClose={() => setShowGifPicker(false)}
              />
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => {
                setShowEmojiPicker((v) => !v);
                setShowGifPicker(false);
                setShowAttachmentPicker(false);
              }}
              className={cn(
                "p-1 hover:bg-[var(--bg-hover)] rounded transition-colors",
                showEmojiPicker && "bg-[var(--bg-hover)]",
              )}
            >
              <Smile className="w-4 h-4 text-[var(--text-muted)]" />
            </button>
            {showEmojiPicker && (
              <EmojiPicker
                onSelect={handleEmojiSelect}
                onClose={() => setShowEmojiPicker(false)}
              />
            )}
          </div>
          <button
            onClick={handleSendMessage}
            disabled={!inputValue.trim() && attachments.length === 0 && gifAttachments.length === 0}
            className={cn(
              "p-1 rounded transition-colors",
              inputValue.trim() || attachments.length > 0 || gifAttachments.length > 0
                ? "bg-[var(--accent-red)] hover:opacity-90 text-white"
                : "text-[var(--text-muted)]",
            )}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

