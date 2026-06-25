import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useServerStore } from "@/lib/store/server-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { X, Minimize2, Maximize2, Monitor, LayoutGrid, Square, Volume2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/** A single screen-share <video> that owns its srcObject + audio volume. */
function ShareVideo({
  stream,
  volume,
  className,
  onContextMenu,
}: {
  stream: MediaStream;
  volume: number;
  className?: string;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  // (Re)attach the stream on mount / stream change. The element is unmounted
  // while the overlay is minimized, so a fresh one needs srcObject set again —
  // otherwise restoring shows a black screen with the stream still live.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = stream;
    v.play().catch(() => {});
  }, [stream]);

  // 0–100 → HTMLMediaElement.volume (0–1).
  useEffect(() => {
    if (ref.current) ref.current.volume = Math.max(0, Math.min(1, volume / 100));
  }, [volume]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      onContextMenu={onContextMenu}
      className={className}
    />
  );
}

export function ScreenShareOverlay() {
  const { t } = useI18n();
  const { screenSharers, watchingUserId, isScreenSharing, members, activeServerId, setWatchingUserId } =
    useServerStore();
  const { user } = useAuthStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [minimized, setMinimized] = useState(false);
  const [layout, setLayout] = useState<"single" | "grid">("single");
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [volCtx, setVolCtx] = useState<{ userId: string; x: number; y: number } | null>(null);

  const sharerIds = Object.keys(screenSharers);
  const isSelfSharing = isScreenSharing && sharerIds.length === 0;
  const isVisible = isSelfSharing || sharerIds.length > 0;

  const watchingStream = watchingUserId ? screenSharers[watchingUserId] ?? null : null;
  const getVolume = (uid: string) => volumes[uid] ?? 100;
  const setVolume = (uid: string, v: number) => setVolumes((prev) => ({ ...prev, [uid]: v }));

  // Resume playback when the window/tab is restored after being hidden/minimized —
  // WebView2 can pause <video> elements while the window is minimized, freezing them.
  useEffect(() => {
    const resume = () => {
      containerRef.current?.querySelectorAll("video").forEach((v) => {
        if (v.srcObject && v.paused) v.play().catch(() => {});
      });
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, []);

  useEffect(() => {
    const handler = () => setMinimized(false);
    window.addEventListener("blok:focus-screen-share", handler);
    return () => window.removeEventListener("blok:focus-screen-share", handler);
  }, []);

  // Fall back to single view when fewer than two people are sharing.
  useEffect(() => {
    if (sharerIds.length < 2 && layout === "grid") setLayout("single");
  }, [sharerIds.length, layout]);

  // Close the volume menu on Escape.
  useEffect(() => {
    if (!volCtx) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setVolCtx(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [volCtx]);

  if (!isVisible) return null;

  const serverMembers = activeServerId ? members[activeServerId] ?? [] : [];

  const getDisplayName = (userId: string) => {
    const member = serverMembers.find((m) => m.userId === userId);
    const u = member?.user;
    return u?.displayName || u?.username || userId.slice(0, 8);
  };

  const sharingName = watchingUserId ? getDisplayName(watchingUserId) : (user?.displayName ?? user?.username ?? "You");

  const openVolMenu = (userId: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    setVolCtx({ userId, x: e.clientX, y: e.clientY });
  };

  return (
    <div
      ref={containerRef}
      className={`fixed z-50 transition-all duration-200 ${
        minimized ? "bottom-20 right-4 w-64" : "inset-4 flex flex-col"
      }`}
    >
      <div className="bg-[var(--bg-base)] border border-[var(--border)] rounded-lg overflow-hidden flex flex-col h-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 bg-[var(--bg-surface)] border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-2 text-xs font-mono text-[var(--text-muted)] min-w-0">
            <Monitor className="w-3 h-3 text-[var(--online)] flex-shrink-0" />
            {layout === "grid" ? (
              <span className="truncate">{sharerIds.length} {t("screenShare.isSharing")}</span>
            ) : (
              <>
                <span className="text-[var(--online)] truncate">{sharingName}</span>
                <span className="truncate">{isSelfSharing ? `— ${t("screenShare.sharingYour")}` : t("screenShare.isSharing")}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {!minimized && sharerIds.length > 1 && (
              <button
                onClick={() => setLayout((l) => (l === "grid" ? "single" : "grid"))}
                className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title={layout === "grid" ? t("screenShare.viewSingle") : t("screenShare.viewGrid")}
              >
                {layout === "grid" ? <Square className="w-3 h-3" /> : <LayoutGrid className="w-3 h-3" />}
              </button>
            )}
            <button
              onClick={() => setMinimized((v) => !v)}
              className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              {minimized ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
            </button>
            {isSelfSharing && (
              <button
                onClick={() => useServerStore.getState().toggleScreenShare()}
                className="p-1 hover:bg-[var(--destructive)]/20 rounded text-[var(--text-muted)] hover:text-[var(--destructive)] transition-colors"
                title={t("screenShare.stopSharing")}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Single-view streamer picker — only shown when 2+ peers are sharing */}
        {!minimized && layout === "single" && sharerIds.length > 1 && (
          <div className="flex items-center gap-1 px-3 py-1 bg-[var(--bg-surface)] border-b border-[var(--border)] shrink-0 overflow-x-auto">
            {sharerIds.map((uid) => (
              <button
                key={uid}
                onClick={() => setWatchingUserId(uid)}
                className={`px-2 py-0.5 rounded text-xs font-mono transition-colors whitespace-nowrap ${
                  uid === watchingUserId
                    ? "bg-[var(--online)] text-black"
                    : "bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                {getDisplayName(uid)}
              </button>
            ))}
          </div>
        )}

        {/* Video area */}
        {!minimized && (
          <div className="flex-1 bg-black overflow-hidden">
            {isSelfSharing ? (
              <div className="flex items-center justify-center h-full text-center text-[var(--text-muted)] font-mono text-sm">
                <div>
                  <Monitor className="w-8 h-8 mx-auto mb-2 text-[var(--online)]" />
                  <p>{t("screenShare.beingShared")}</p>
                  <button
                    onClick={() => useServerStore.getState().toggleScreenShare()}
                    className="mt-3 px-3 py-1 bg-[var(--destructive)] text-white text-xs rounded hover:opacity-80 transition-opacity"
                  >
                    {t("screenShare.stop")}
                  </button>
                </div>
              </div>
            ) : layout === "grid" ? (
              <div
                className={`grid gap-2 p-2 h-full ${
                  sharerIds.length <= 2 ? "grid-cols-2" : sharerIds.length <= 4 ? "grid-cols-2" : "grid-cols-3"
                }`}
              >
                {sharerIds.map((uid) => (
                  <div key={uid} className="relative bg-black rounded overflow-hidden flex items-center justify-center border border-[var(--border)]">
                    <ShareVideo
                      stream={screenSharers[uid]}
                      volume={getVolume(uid)}
                      onContextMenu={openVolMenu(uid)}
                      className="max-w-full max-h-full object-contain"
                    />
                    <span className="absolute bottom-1 left-1 flex items-center gap-1 px-1.5 py-0.5 bg-black/60 rounded text-[11px] font-mono text-white">
                      {getDisplayName(uid)}
                      {getVolume(uid) === 0 && <Volume2 className="w-3 h-3 text-[var(--destructive)]" />}
                    </span>
                  </div>
                ))}
              </div>
            ) : watchingStream ? (
              <div className="flex items-center justify-center h-full">
                <ShareVideo
                  stream={watchingStream}
                  volume={getVolume(watchingUserId!)}
                  onContextMenu={watchingUserId ? openVolMenu(watchingUserId) : undefined}
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Per-share volume menu (right-click) */}
      {volCtx && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onMouseDown={() => setVolCtx(null)} onContextMenu={(e) => { e.preventDefault(); setVolCtx(null); }} />
          <div
            style={{ position: "fixed", left: Math.min(volCtx.x, window.innerWidth - 200), top: Math.min(volCtx.y, window.innerHeight - 90), zIndex: 9999 }}
            className="w-48 bg-[var(--bg-elevated)] border border-[var(--border)] shadow-xl py-2 px-3 space-y-1"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[var(--text-muted)] truncate">{getDisplayName(volCtx.userId)}</span>
              <span className="text-[11px] font-mono text-[var(--text-primary)]">{getVolume(volCtx.userId)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={getVolume(volCtx.userId)}
              onChange={(e) => setVolume(volCtx.userId, Number(e.target.value))}
              className="w-full h-1 accent-[var(--online)] cursor-pointer"
            />
            <div className="flex justify-between text-[9px] text-[var(--text-muted)] opacity-50">
              <span>{t("screenShare.volume")}</span>
              <span>100</span>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
