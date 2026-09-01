import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useServerStore } from "@/lib/store/server-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { useUiSettingsStore, type ScreenShareFps, type ScreenShareResolution } from "@/lib/store/ui-settings-store";
import { getActiveNativeVoiceEngine } from "@/lib/native-voice-engine";
import { X, Minimize2, Maximize2, Monitor, LayoutGrid, Square, Volume2, SwitchCamera, Expand, Shrink } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n } from "@/lib/i18n";

/**
 * True fullscreen: the OS window itself, not just the element.
 *
 * `Element.requestFullscreen()` only fills the *webview*, so inside the desktop
 * app the window frame and the taskbar stayed on screen — a "fullscreen" that
 * plainly wasn't. Driving the Tauri window instead gives the real thing, with
 * the element fullscreen kept as the fallback for a browser build.
 *
 * Returns whether the window was already fullscreen, so leaving the overlay
 * doesn't yank someone out of a fullscreen they had set up themselves.
 */
async function enterWindowFullscreen(el: HTMLElement | null): Promise<boolean> {
  if (!("__TAURI_INTERNALS__" in window)) {
    await el?.requestFullscreen().catch(() => {});
    return false;
  }
  const win = getCurrentWindow();
  const was = await win.isFullscreen().catch(() => false);
  if (!was) await win.setFullscreen(true).catch(() => {});
  return was;
}

async function exitWindowFullscreen(wasAlreadyFullscreen: boolean): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    return;
  }
  if (wasAlreadyFullscreen) return;
  await getCurrentWindow().setFullscreen(false).catch(() => {});
}

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
  const { screenSharers, watchingUserId, isScreenSharing, localScreenStream, members, activeServerId, setWatchingUserId } =
    useServerStore();
  const { user } = useAuthStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const videoWrapRef = useRef<HTMLDivElement>(null);
  const { screenShareResolution, screenShareFps, setSetting } = useUiSettingsStore();
  // Native (Linux) capture exposes live source/quality/fps switching; the
  // getDisplayMedia path doesn't. Re-evaluated per render — cheap getter.
  const nativeShare = getActiveNativeVoiceEngine()?.isNativeScreenShare() ?? false;
  const [minimized, setMinimized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Null unless *we* put the window into fullscreen; `wasAlready` records that it
  // was fullscreen before we did, so leaving restores what the user had rather
  // than forcing the window back to a normal size.
  const ourFullscreenRef = useRef<{ wasAlready: boolean } | null>(null);
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

  /** Leaves our fullscreen if we're in it; a no-op otherwise. */
  const leaveFullscreen = () => {
    const ours = ourFullscreenRef.current;
    if (!ours) return;
    ourFullscreenRef.current = null;
    void exitWindowFullscreen(ours.wasAlready);
    setFullscreen(false);
  };

  const toggleFullscreen = () => {
    if (fullscreen) {
      leaveFullscreen();
      return;
    }
    void (async () => {
      setMinimized(false); // a minimized overlay has nothing to show fullscreen
      const wasAlready = await enterWindowFullscreen(videoWrapRef.current);
      ourFullscreenRef.current = { wasAlready };
      setFullscreen(true);
    })();
  };

  // Escape leaves fullscreen — the one key everyone tries first, and without it
  // a chrome-less fullscreen view has no obvious way out.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") leaveFullscreen();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // The share ending while fullscreen would otherwise strand the user in a
  // fullscreen window with nothing in it.
  useEffect(() => {
    if (!isVisible) leaveFullscreen();
  }, [isVisible]);

  // Unmount: only undo a fullscreen we ourselves set, never one the user had.
  useEffect(() => {
    return () => {
      const ours = ourFullscreenRef.current;
      ourFullscreenRef.current = null;
      if (ours) void exitWindowFullscreen(ours.wasAlready);
    };
  }, []);

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
        minimized ? "bottom-20 right-4 w-64" : fullscreen ? "inset-0 flex flex-col" : "inset-4 flex flex-col"
      }`}
    >
      {/* Fullscreen drops the inset, border, rounding and shadow so the picture
          reaches every edge of the display — the point of the mode. */}
      <div
        className={`relative bg-[var(--bg-base)] overflow-hidden flex flex-col h-full ${
          fullscreen ? "" : "border border-[var(--border)] rounded-lg shadow-2xl"
        }`}
      >
        {/* Header — hidden in fullscreen, where a floating exit button replaces it */}
        <div className={`items-center justify-between px-3 py-2 bg-[var(--bg-surface)] border-b border-[var(--border)] shrink-0 ${fullscreen ? "hidden" : "flex"}`}>
          <div className="flex items-center gap-2 text-xs font-mono text-[var(--text-muted)] min-w-0">
            <Monitor className="w-3 h-3 text-[var(--online-text)] flex-shrink-0" />
            {layout === "grid" ? (
              <span className="truncate">{sharerIds.length} {t("screenShare.isSharing")}</span>
            ) : (
              <>
                <span className="text-[var(--online-text)] truncate">{sharingName}</span>
                <span className="truncate">{isSelfSharing ? `— ${t("screenShare.sharingYour")}` : t("screenShare.isSharing")}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Offered for every view, including your own share and the grid —
                it was previously limited to watching one remote stream, which
                left the most common cases with no way to go fullscreen. */}
            {!minimized && (
              <button
                onClick={toggleFullscreen}
                className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title={t("screenShare.fullscreen")}
                aria-label={t("screenShare.fullscreen")}
              >
                <Expand className="w-3 h-3" />
              </button>
            )}
            {!minimized && sharerIds.length > 1 && (
              <button
                onClick={() => setLayout((l) => (l === "grid" ? "single" : "grid"))}
                className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                aria-label={layout === "grid" ? t("screenShare.viewSingle") : t("screenShare.viewGrid")}
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
                className="p-1 hover:bg-[var(--destructive)]/20 rounded text-[var(--text-muted)] hover:text-[var(--accent-red-text)] transition-colors"
                aria-label={t("screenShare.stopSharing")}
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

        {/* Fullscreen exit affordance. Dim until hovered so it doesn't sit on top
            of the picture, but always present — Escape alone is not discoverable. */}
        {fullscreen && (
          <button
            onClick={toggleFullscreen}
            className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-black/50 text-white/60 opacity-40 hover:opacity-100 hover:bg-black/80 hover:text-white transition-all font-mono text-xs"
            title={t("screenShare.exitFullscreen")}
            aria-label={t("screenShare.exitFullscreen")}
          >
            <Shrink className="w-3.5 h-3.5" />
            ESC
          </button>
        )}

        {/* Video area */}
        {!minimized && (
          <div className="flex-1 bg-black overflow-hidden">
            {isSelfSharing ? (
              <div className="relative flex items-center justify-center h-full">
                {localScreenStream ? (
                  // Self-preview: mirror our own outgoing stream so we can see what
                  // we're sharing. Muted to avoid a desktop-audio feedback loop.
                  <ShareVideo
                    stream={localScreenStream}
                    volume={0}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="text-center text-[var(--text-muted)] font-mono text-sm">
                    <Monitor className="w-8 h-8 mx-auto mb-2 text-[var(--online-text)]" />
                    <p>{t("screenShare.beingShared")}</p>
                  </div>
                )}
                {/* Share control bar: source switch + live quality/fps (native
                    capture only) and stop, grouped bottom-center like a call bar. */}
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-2 bg-black/70 border border-[var(--border)] rounded font-mono">
                  {nativeShare && (
                    <>
                      <button
                        onClick={() => {
                          void (async () => {
                            await getActiveNativeVoiceEngine()?.changeScreenShareSource();
                            // The stream object can change when the audio choice
                            // changes (internal restart) — refresh the self-preview.
                            useServerStore.setState({
                              localScreenStream: getActiveNativeVoiceEngine()?.getScreenStream() ?? null,
                            });
                          })();
                        }}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[var(--text-primary)] border border-[var(--border)] rounded hover:bg-[var(--bg-hover)] transition-colors"
                        title={t("screenShare.changeSource")}
                      >
                        <SwitchCamera className="w-3.5 h-3.5" />
                        {t("screenShare.source")}
                      </button>
                      <select
                        value={screenShareResolution}
                        onChange={(e) => {
                          setSetting("screenShareResolution", e.target.value as ScreenShareResolution);
                          void getActiveNativeVoiceEngine()?.applyNativeCaptureSettings();
                        }}
                        className="bg-[var(--bg-base)] text-xs text-[var(--text-primary)] border border-[var(--border)] rounded px-2 py-1.5 focus:outline-none cursor-pointer"
                        title={t("screenShare.resolution")}
                      >
                        <option value="720p">720p</option>
                        <option value="1080p">1080p</option>
                        <option value="1440p">1440p</option>
                        <option value="native">Native</option>
                      </select>
                      <select
                        value={screenShareFps}
                        onChange={(e) => {
                          setSetting("screenShareFps", Number(e.target.value) as ScreenShareFps);
                          void getActiveNativeVoiceEngine()?.applyNativeCaptureSettings();
                        }}
                        className="bg-[var(--bg-base)] text-xs text-[var(--text-primary)] border border-[var(--border)] rounded px-2 py-1.5 focus:outline-none cursor-pointer"
                        title={t("screenShare.frameRate")}
                      >
                        <option value={15}>15 FPS</option>
                        <option value={30}>30 FPS</option>
                        <option value={60}>60 FPS</option>
                      </select>
                    </>
                  )}
                  <button
                    onClick={() => useServerStore.getState().toggleScreenShare()}
                    className="px-3 py-1.5 bg-[var(--destructive)] text-white text-xs rounded hover:opacity-80 transition-opacity"
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
                      className="w-full h-full object-contain"
                    />
                    <span className="absolute bottom-1 left-1 flex items-center gap-1 px-1.5 py-0.5 bg-black/60 rounded text-[11px] font-mono text-white">
                      {getDisplayName(uid)}
                      {getVolume(uid) === 0 && <Volume2 className="w-3 h-3 text-[var(--accent-red-text)]" />}
                    </span>
                  </div>
                ))}
              </div>
            ) : watchingStream ? (
              <div ref={videoWrapRef} className="flex items-center justify-center h-full bg-black">
                <ShareVideo
                  stream={watchingStream}
                  volume={getVolume(watchingUserId!)}
                  onContextMenu={watchingUserId ? openVolMenu(watchingUserId) : undefined}
                  className="w-full h-full object-contain"
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
