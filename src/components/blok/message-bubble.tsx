import { cn } from "@/lib/utils";
import { UserAvatar } from "./user-avatar";
import type { Message, DMMessage, User } from "@/lib/store/types";
import { useState, useRef, useEffect } from "react";
import { MoreHorizontal, Edit2, Trash2, Copy } from "lucide-react";
import { AudioPlayer } from "./audio-player";
import { VideoPlayer } from "./video-player";
import { useI18n } from "@/lib/i18n";

// Для изображений: img загружается в hidden (display:none), что безопасно для img
function LazyImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setShow(true); obs.disconnect(); } },
      { rootMargin: "400px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref}>
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

// Для видео/аудио: нельзя скрывать через display:none — браузер не грузит медиа.
// Просто откладываем рендер до появления во viewport.
function LazyMedia({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setShow(true); obs.disconnect(); } },
      { rootMargin: "400px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  if (!show) return <div ref={ref} className="h-16 w-52 rounded-md bg-[var(--bg-elevated)] animate-pulse" />;
  return <>{children}</>;
}

interface MessageBubbleProps {
  message:
    | Message
    | DMMessage
    | { id: string; content: string; createdAt: string; editedAt?: string };
  user?: User | null;
  isOwn?: boolean;
  showAvatar?: boolean;
  isDM?: boolean;
}

export function MessageBubble({
  message,
  user,
  isOwn,
  showAvatar = true,
  isDM,
}: MessageBubbleProps) {
  const { t } = useI18n();
  const [showTimestamp, setShowTimestamp] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatContent = (content: string) => {
    return content
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(
        /`(.+?)`/g,
        '<code class="bg-[var(--bg-elevated)] px-1 rounded text-sm">$1</code>',
      )
      .replace(
        /(https?:\/\/[^\s]+)/g,
        '<a href="$1" class="text-[var(--accent-red)] hover:underline" target="_blank" rel="noopener">$1</a>',
      );
  };

  if (isDM) {
    return (
      <div
        className={cn(
          "flex gap-2 max-w-[80%]",
          isOwn ? "ml-auto flex-row-reverse" : "",
        )}
        onMouseEnter={() => setShowTimestamp(true)}
        onMouseLeave={() => setShowTimestamp(false)}
      >
        {showAvatar && !isOwn && <UserAvatar user={user} size="sm" />}
        <div
          className={cn(
            "px-3 py-2 rounded-lg text-sm",
            isOwn
              ? "bg-[var(--accent-red)] text-white rounded-br-sm"
              : "bg-[var(--bg-elevated)] text-[var(--text-primary)] rounded-bl-sm border border-[var(--border)]",
          )}
        >
          {message.content && (
            <p
              dangerouslySetInnerHTML={{
                __html: formatContent(message.content),
              }}
            />
          )}

          {"attachments" in message && message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-col gap-2 mt-2">
              {message.attachments.map((att) => {
                if (att.mediaType?.startsWith("image/")) {
                  return (
                    <LazyImage
                      key={att.id}
                      src={att.url}
                      alt={att.filename}
                      className="max-w-full max-h-64 rounded-md object-contain bg-[var(--bg-base)]"
                    />
                  );
                }
                if (att.mediaType?.startsWith("video/")) {
                  return (
                    <LazyMedia key={att.id}>
                      <VideoPlayer src={att.url} className="max-w-full max-h-64" />
                    </LazyMedia>
                  );
                }
                if (att.mediaType?.startsWith("audio/")) {
                  return (
                    <LazyMedia key={att.id}>
                      <AudioPlayer src={att.url} filename={att.filename} className="max-w-full" />
                    </LazyMedia>
                  );
                }
                return (
                  <div
                    key={att.id}
                    className="flex items-center gap-2 p-2 bg-[var(--bg-base)] rounded-lg text-xs"
                  >
                    <span className="truncate max-w-[150px]">{att.filename}</span>
                  </div>
                );
              })}
            </div>
          )}
          {showTimestamp && (
            <span className="text-[10px] opacity-60 mt-1 block">
              {formatTime(message.createdAt)}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="group flex gap-3 px-4 py-1 hover:bg-[var(--bg-hover)]/50 transition-colors"
      onMouseEnter={() => setShowTimestamp(true)}
      onMouseLeave={() => {
        setShowTimestamp(false);
        setShowMenu(false);
      }}
    >
      {showAvatar ? (
        <UserAvatar user={user} size="md" />
      ) : (
        <div className="w-8 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        {showAvatar && (
          <div className="mb-0.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[var(--text-primary)]">
                @{user?.username || "Unknown"}
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {formatTime(message.createdAt)}
              </span>
              {"editedAt" in message &&
                message.editedAt && (
                  <span className="text-xs text-[var(--text-muted)]">
                    {t("message.edited")}
                  </span>
                )}
            </div>
            {user?.pronouns && (
              <span className="text-xs text-[var(--text-muted)] opacity-60">
                {user.pronouns}
              </span>
            )}
          </div>
        )}
        {message.content && (
          <p
            className="text-sm text-[var(--text-primary)] leading-relaxed"
            dangerouslySetInnerHTML={{
              __html: formatContent(message.content),
            }}
          />
        )}

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
                  />
                );
              }
              if (att.mediaType?.startsWith("video/")) {
                return (
                  <LazyMedia key={att.id}>
                    <VideoPlayer src={att.url} />
                  </LazyMedia>
                );
              }
              if (att.mediaType?.startsWith("audio/")) {
                return (
                  <LazyMedia key={att.id}>
                    <AudioPlayer src={att.url} filename={att.filename} />
                  </LazyMedia>
                );
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
      </div>

      <div
        className={cn(
          "flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity",
        )}
      >
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="p-1 hover:bg-[var(--bg-elevated)] rounded transition-colors"
        >
          <MoreHorizontal className="w-4 h-4 text-[var(--text-muted)]" />
        </button>

        {showMenu && (
          <div className="absolute right-12 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg shadow-lg py-1 z-10">
            {isOwn && (
              <>
                <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
                  <Edit2 className="w-3 h-3" /> {t("message.edit")}
                </button>
                <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--destructive)] hover:bg-[var(--bg-hover)] transition-colors">
                  <Trash2 className="w-3 h-3" /> {t("message.delete")}
                </button>
              </>
            )}
            <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
              <Copy className="w-3 h-3" /> {t("message.copy")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

