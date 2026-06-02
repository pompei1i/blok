import DOMPurify from "dompurify";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { UserAvatar } from "./user-avatar";
import { PresenceDot } from "./presence-dot";
import { UrlPreview, extractFirstUrl } from "./url-preview";
import { PollView } from "./poll-view";
import type { Message, DMMessage, User, Reaction } from "@/lib/store/types";
import { useState, useRef, useEffect } from "react";
import { MoreHorizontal, Trash2, Copy, CornerUpLeft, Pin, Smile, Edit2, Check, X as XIcon } from "lucide-react";
import { AudioPlayer } from "./audio-player";
import { VideoPlayer } from "./video-player";
import { useI18n } from "@/lib/i18n";
import { useFriendsStore, effectiveStatus } from "@/lib/store/friends-store";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  QUICK_EMOJIS,
  LAZY_LOAD_ROOT_MARGIN,
  REPLY_PREVIEW_MAX_CHARS,
  REPLY_PREVIEW_MAX_CHARS_DM,
} from "@/lib/constants";

// ── Formatting ────────────────────────────────────────────────────────────────

const FORMAT_SANITIZE_CONFIG = {
  ALLOWED_TAGS: ["strong", "em", "code", "a"],
  ALLOWED_ATTR: ["href", "class", "target", "rel"],
  ALLOW_DATA_ATTR: false,
};

function formatContent(content: string): string {
  // Escape raw HTML first to prevent injection, then apply markdown transforms.
  const escaped = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const formatted = escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(
      /`(.+?)`/g,
      '<code class="bg-[var(--bg-elevated)] px-1 rounded text-sm">$1</code>',
    )
    .replace(
      /(https?:\/\/[^\s]+)/g,
      '<a href="$1" class="text-[var(--accent-red)] hover:underline" target="_blank" rel="noopener noreferrer">$1</a>',
    );

  return DOMPurify.sanitize(formatted, FORMAT_SANITIZE_CONFIG);
}

function groupReactions(reactions: Reaction[]): { emoji: string; count: number; userIds: string[] }[] {
  const map = new Map<string, string[]>();
  for (const r of reactions) {
    const list = map.get(r.emoji) ?? [];
    list.push(r.userId);
    map.set(r.emoji, list);
  }
  return Array.from(map.entries()).map(([emoji, userIds]) => ({ emoji, count: userIds.length, userIds }));
}

// ── Lazy media ────────────────────────────────────────────────────────────────

function LazyImage({ src, alt, className, onClick }: { src: string; alt: string; className?: string; onClick?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setShow(true); obs.disconnect(); } },
      { rootMargin: LAZY_LOAD_ROOT_MARGIN },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} onClick={onClick} className={onClick ? "cursor-zoom-in inline-block" : "inline-block"}>
      {(!show || !loaded) && (
        <div className="h-36 w-52 rounded-md bg-[var(--bg-elevated)] animate-pulse" />
      )}
      {show && (
        <img
          src={src}
          alt={alt}
          decoding="async"
          draggable={false}
          className={cn(className, !loaded && "hidden")}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
        />
      )}
    </div>
  );
}

function LazyMedia({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setShow(true); obs.disconnect(); } },
      { rootMargin: LAZY_LOAD_ROOT_MARGIN },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  if (!show) return <div ref={ref} className="h-16 w-52 rounded-md bg-[var(--bg-elevated)] animate-pulse" />;
  return <>{children}</>;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message:
    | Message
    | DMMessage
    | { id: string; content: string; createdAt: string; editedAt?: string };
  user?: User | null;
  isOwn?: boolean;
  showAvatar?: boolean;
  isDM?: boolean;
  replyToMessage?: Message | DMMessage | null;
  replyToId?: string;
  onReply?: (message: Message | DMMessage) => void;
  onDelete?: (messageId: string) => void;
  onPin?: (messageId: string) => void;
  onJumpTo?: (messageId: string) => void;
  onReact?: (emoji: string) => void;
  onRemoveReact?: (emoji: string) => void;
  onEdit?: (messageId: string, newContent: string) => void;
  currentUserId?: string;
  onVotePoll?: (pollId: string, optionIds: string[]) => void;
}

export function MessageBubble({
  message,
  user,
  isOwn,
  showAvatar = true,
  isDM,
  replyToMessage,
  replyToId,
  onReply,
  onDelete,
  onPin,
  onJumpTo,
  onReact,
  onRemoveReact,
  onEdit,
  currentUserId,
  onVotePoll,
}: MessageBubbleProps) {
  const { t } = useI18n();
  const { presence, presenceLastSeen } = useFriendsStore();
  const { user: me } = useAuthStore();
  const authorId = "authorId" in message ? message.authorId : undefined;
  const authorStatus = authorId === me?.id
    ? ("online" as const)
    : effectiveStatus(presence[authorId ?? ""], presenceLastSeen[authorId ?? ""]);
  const [showTimestamp, setShowTimestamp] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const showMenu = menuPos !== null;
  const [showQuickEmoji, setShowQuickEmoji] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const editRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const msgRef = useRef<HTMLDivElement>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const openMenuAt = (clientX: number, clientY: number) => {
    const W = 160; // w-40 = 160px
    const H = 240; // estimated max height
    const x = Math.min(clientX, window.innerWidth - W - 8);
    const y = clientY + H > window.innerHeight ? clientY - H : clientY + 4;
    setMenuPos({ x, y });
    setShowQuickEmoji(false);
  };

  const closeMenu = () => setMenuPos(null);

  useEffect(() => {
    if (!lightboxSrc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLightboxSrc(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightboxSrc]);

  useEffect(() => {
    if (isEditing) editRef.current?.focus();
  }, [isEditing]);

  const firstUrl = !isEditing && message.content ? extractFirstUrl(message.content) : null;

  const startEdit = () => {
    setEditValue(message.content ?? "");
    setIsEditing(true);
    closeMenu();
  };

  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== message.content) onEdit?.(message.id, trimmed);
    setIsEditing(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitEdit(); }
    if (e.key === "Escape") setIsEditing(false);
  };

  useEffect(() => {
    if (!showMenu) return;
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeMenu(); };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [showMenu]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopy = () => {
    if (message.content) void navigator.clipboard.writeText(message.content);
    closeMenu();
  };

  const formatTime = (dateString: string) =>
    new Date(dateString).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (isDM) {
    return (
      <>
      <div
        className={cn(
          "flex gap-2 max-w-[80%] group/dm",
          isOwn ? "ml-auto flex-row-reverse" : "",
        )}
        onMouseEnter={() => setShowTimestamp(true)}
        onMouseLeave={() => setShowTimestamp(false)}
      >
        {showAvatar && !isOwn && <UserAvatar user={user} size="sm" />}
        <div className="flex flex-col gap-0.5 min-w-0">
          <div
            className={cn(
              "px-3 py-2 rounded-lg text-sm",
              isOwn
                ? "bg-[var(--accent-red)] text-white rounded-br-sm"
                : "bg-[var(--bg-elevated)] text-[var(--text-primary)] rounded-bl-sm border border-[var(--border)]",
            )}
          >
            {(replyToMessage || replyToId) && (
              <button
                onClick={() => replyToMessage && onJumpTo?.(replyToMessage.id)}
                className={cn(
                  "flex items-center gap-1.5 mb-2 w-full text-left rounded px-2 py-1 border-l-2 transition-colors",
                  isOwn
                    ? "border-white/40 bg-black/10 hover:bg-black/20"
                    : "border-[var(--accent-red)]/60 bg-[var(--bg-base)]/50 hover:bg-[var(--bg-base)]",
                )}
              >
                <span className="text-xs truncate">
                  {replyToMessage ? (
                    <>
                      <span className={cn("font-medium", isOwn ? "text-white/80" : "text-[var(--accent-red)]")}>
                        @{"author" in replyToMessage ? replyToMessage.author?.username ?? "unknown" : "unknown"}
                      </span>
                      {replyToMessage.content && (
                        <span className={cn("ml-1", isOwn ? "text-white/60" : "text-[var(--text-muted)]")}>
                          {replyToMessage.content.slice(0, REPLY_PREVIEW_MAX_CHARS_DM)}
                          {replyToMessage.content.length > REPLY_PREVIEW_MAX_CHARS_DM ? "…" : ""}
                        </span>
                      )}
                      {!replyToMessage.content && (
                        <span className={cn("ml-1 italic opacity-60", isOwn ? "text-white/60" : "text-[var(--text-muted)]")}>
                          attachment
                        </span>
                      )}
                    </>
                  ) : (
                    <span className={cn("italic opacity-50", isOwn ? "text-white/60" : "text-[var(--text-muted)]")}>
                      original deleted message :(
                    </span>
                  )}
                </span>
              </button>
            )}
            {message.content && (
              <p dangerouslySetInnerHTML={{ __html: formatContent(message.content) }} />
            )}
            {firstUrl && <UrlPreview url={firstUrl} />}
            {"attachments" in message && message.attachments && message.attachments.length > 0 && (
              <div className="flex flex-col gap-2 mt-2">
                {message.attachments.map((att) => {
                  if (att.mediaType?.startsWith("image/")) {
                    return (
                      <LazyImage key={att.id} src={att.url} alt={att.filename}
                        className="max-w-full max-h-64 rounded-md object-contain bg-[var(--bg-base)]"
                        onClick={() => setLightboxSrc(att.url)} />
                    );
                  }
                  if (att.mediaType?.startsWith("video/")) {
                    return <LazyMedia key={att.id}><VideoPlayer src={att.url} className="max-w-full max-h-64" /></LazyMedia>;
                  }
                  if (att.mediaType?.startsWith("audio/")) {
                    return <LazyMedia key={att.id}><AudioPlayer src={att.url} filename={att.filename} className="max-w-full" /></LazyMedia>;
                  }
                  return (
                    <div key={att.id} className="flex items-center gap-2 p-2 bg-[var(--bg-base)] rounded-lg text-xs">
                      <span className="truncate max-w-[150px]">{att.filename}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {showTimestamp && (
              <span className="text-[10px] opacity-60 mt-1 block">{formatTime(message.createdAt)}</span>
            )}
          </div>

          <div className={cn(
            "flex gap-0.5",
            isOwn ? "justify-end" : "justify-start",
            "opacity-0 group-hover/dm:opacity-100 transition-opacity",
          )}>
            {onReply && (
              <button
                onClick={() => onReply(message as Message | DMMessage)}
                className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title="Reply"
              >
                <CornerUpLeft className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={handleCopy}
              className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              title="Copy"
            >
              <Copy className="w-3 h-3" />
            </button>
            {isOwn && onDelete && (
              <button
                onClick={() => onDelete(message.id)}
                className="p-1 rounded hover:bg-[var(--destructive)]/20 text-[var(--text-muted)] hover:text-[var(--destructive)] transition-colors"
                title="Delete"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>
      {lightboxSrc && createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center cursor-pointer"
          onClick={() => setLightboxSrc(null)}
        >
          <img
            src={lightboxSrc}
            alt=""
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl cursor-default"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            onClick={() => setLightboxSrc(null)}
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>,
        document.body,
      )}
      </>
    );
  }

  return (
    <div
      ref={msgRef}
      className={cn(
        "group flex gap-3 px-4 hover:bg-[var(--bg-hover)]/50 transition-colors",
        showAvatar ? "pt-3 pb-0.5" : "pt-0 pb-0.5",
      )}
      onMouseEnter={() => setShowTimestamp(true)}
      onMouseLeave={() => setShowTimestamp(false)}
      onContextMenu={(e) => { e.preventDefault(); openMenuAt(e.clientX, e.clientY); }}
    >
      {showAvatar ? (
        <div className="relative flex-shrink-0 self-start mt-0.5">
          <UserAvatar user={user} size="md" />
          <PresenceDot status={authorStatus} size="sm" className="absolute -bottom-1 -right-1 ring-2 ring-[var(--bg-surface)]" />
        </div>
      ) : (
        <div className="w-8 flex-shrink-0 flex items-start justify-end pr-1 pt-1">
          <span className="text-[9px] text-[var(--text-muted)] opacity-0 group-hover:opacity-60 transition-opacity leading-none whitespace-nowrap select-none">
            {formatTime(message.createdAt)}
          </span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        {(replyToMessage || replyToId) && (
          <button
            onClick={() => replyToMessage && onJumpTo?.(replyToMessage.id)}
            className="flex items-center gap-1.5 mb-1 max-w-full text-left group/reply"
          >
            <div className="w-4 h-2.5 border-l-2 border-t-2 border-[var(--text-muted)]/40 rounded-tl-sm flex-shrink-0 self-end mb-0.5" />
            <span className="text-xs text-[var(--text-muted)] truncate group-hover/reply:text-[var(--text-primary)] transition-colors">
              {replyToMessage ? (
                <>
                  <span className="font-medium">
                    @{"author" in replyToMessage ? replyToMessage.author?.username ?? "unknown" : "unknown"}
                  </span>
                  {replyToMessage.content && (
                    <span className="ml-1 opacity-70">
                      {replyToMessage.content.slice(0, REPLY_PREVIEW_MAX_CHARS)}
                      {replyToMessage.content.length > REPLY_PREVIEW_MAX_CHARS ? "…" : ""}
                    </span>
                  )}
                  {!replyToMessage.content && <span className="ml-1 opacity-50 italic">attachment</span>}
                </>
              ) : (
                <span className="opacity-50 italic">original deleted message :(</span>
              )}
            </span>
          </button>
        )}
        {showAvatar && (
          <div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              @{user?.username || "Unknown"}
            </span>
            {user?.pronouns && (
              <span className="text-xs text-[var(--text-muted)] opacity-60 leading-none">
                {user.pronouns}
              </span>
            )}
            <span className="text-xs text-[var(--text-muted)]">
              {formatTime(message.createdAt)}
            </span>
            {(("isEdited" in message && message.isEdited) || ("editedAt" in message && message.editedAt)) && (
              <span className="text-xs text-[var(--text-muted)]">{t("message.edited")}</span>
            )}
          </div>
        )}
        {isEditing ? (
          <div className="flex flex-col gap-1">
            <textarea
              ref={editRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleEditKeyDown}
              rows={2}
              className="w-full bg-[var(--bg-base)] border border-[var(--accent-red)] rounded px-2 py-1 text-sm text-[var(--text-primary)] resize-none focus:outline-none"
            />
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <span>Enter to save · Esc to cancel</span>
              <button onClick={commitEdit} className="ml-auto p-0.5 hover:text-[var(--online)] transition-colors">
                <Check className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setIsEditing(false)} className="p-0.5 hover:text-[var(--destructive)] transition-colors">
                <XIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : message.content ? (
          <p
            className="text-sm text-[var(--text-primary)] leading-relaxed"
            dangerouslySetInnerHTML={{ __html: formatContent(message.content) }}
          />
        ) : null}

        {"poll" in message && message.poll && onVotePoll && (
          <PollView
            poll={message.poll}
            onVote={(optionIds) => onVotePoll((message as Message).poll!.id, optionIds)}
          />
        )}
        {firstUrl && <UrlPreview url={firstUrl} />}

        {"attachments" in message && message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-col gap-2 mt-2">
            {message.attachments.map((att) => {
              if (att.mediaType?.startsWith("image/")) {
                return (
                  <LazyImage
                    key={att.id}
                    src={att.url}
                    alt={att.filename}
                    className="max-w-sm max-h-80 rounded-md object-contain border border-[var(--border)]"
                    onClick={() => setLightboxSrc(att.url)}
                  />
                );
              }
              if (att.mediaType?.startsWith("video/")) {
                return <LazyMedia key={att.id}><VideoPlayer src={att.url} /></LazyMedia>;
              }
              if (att.mediaType?.startsWith("audio/")) {
                return <LazyMedia key={att.id}><AudioPlayer src={att.url} filename={att.filename} /></LazyMedia>;
              }
              return (
                <div
                  key={att.id}
                  className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg max-w-sm"
                >
                  <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {att.filename}
                  </span>
                  <span className="text-xs text-[var(--text-muted)] ml-auto">
                    {att.sizeBytes ? (att.sizeBytes / 1024 / 1024).toFixed(2) + " MB" : ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {"reactions" in message && message.reactions && message.reactions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {groupReactions(message.reactions).map(({ emoji, count, userIds }) => {
              const reacted = currentUserId ? userIds.includes(currentUserId) : false;
              return (
                <button
                  key={emoji}
                  onClick={() => reacted ? onRemoveReact?.(emoji) : onReact?.(emoji)}
                  className={cn(
                    "flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs transition-colors",
                    reacted
                      ? "bg-[var(--accent-red)]/20 border-[var(--accent-red)]/50 text-[var(--accent-red)]"
                      : "bg-[var(--bg-elevated)] border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                  )}
                  title={userIds.join(", ")}
                >
                  <span>{emoji}</span>
                  <span className="font-medium">{count}</span>
                </button>
              );
            })}
          </div>
        )}

      </div>

      <div
        ref={menuRef}
        className="relative flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity self-start mt-1"
      >
        {onReact && (
          <div className="relative">
            <button
              onClick={() => { setShowQuickEmoji((v) => !v); closeMenu(); }}
              className="p-1 hover:bg-[var(--bg-elevated)] rounded transition-colors"
            >
              <Smile className="w-4 h-4 text-[var(--text-muted)]" />
            </button>
            {showQuickEmoji && (
              <div className={cn(
                "absolute right-0 flex gap-0.5 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg shadow-xl p-1 z-50",
                "top-full mt-1",
              )}>
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => { onReact(emoji); setShowQuickEmoji(false); }}
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-base transition-colors"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          onClick={(e) => {
            if (showMenu) { closeMenu(); return; }
            const r = e.currentTarget.getBoundingClientRect();
            openMenuAt(r.right, r.bottom);
          }}
          className="p-1 hover:bg-[var(--bg-elevated)] rounded transition-colors"
        >
          <MoreHorizontal className="w-4 h-4 text-[var(--text-muted)]" />
        </button>

      </div>

      {showMenu && menuPos && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", left: menuPos.x, top: menuPos.y, zIndex: 9998 }}
          className="w-40 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg shadow-xl py-1"
        >
          {onReply && (
            <button
              onClick={() => { onReply(message as Message | DMMessage); closeMenu(); }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <CornerUpLeft className="w-3 h-3" /> Reply
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <Copy className="w-3 h-3" /> {t("message.copy")}
          </button>
          {onPin && (
            <button
              onClick={() => { onPin(message.id); closeMenu(); }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Pin className="w-3 h-3" />
              {"isPinned" in message && message.isPinned ? "Unpin" : "Pin"}
            </button>
          )}
          {isOwn && onEdit && (
            <button
              onClick={startEdit}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Edit2 className="w-3 h-3" /> {t("message.edit")}
            </button>
          )}
          {isOwn && onDelete && (
            <>
              <div className="my-1 border-t border-[var(--border)]" />
              <button
                onClick={() => { onDelete(message.id); closeMenu(); }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--destructive)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <Trash2 className="w-3 h-3" /> {t("message.delete")}
              </button>
            </>
          )}
        </div>,
        document.body
      )}
      {lightboxSrc && createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center cursor-pointer"
          onClick={() => setLightboxSrc(null)}
        >
          <img
            src={lightboxSrc}
            alt=""
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl cursor-default"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            onClick={() => setLightboxSrc(null)}
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
