import { useEffect, useRef, useState } from "react";
import { useServerStore } from "@/lib/store/server-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { X, Minimize2, Maximize2, Monitor } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export function ScreenShareOverlay() {
  const { t } = useI18n();
  const { screenSharers, watchingUserId, isScreenSharing, members, activeServerId, setWatchingUserId } =
    useServerStore();
  const { user } = useAuthStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [minimized, setMinimized] = useState(false);

  const sharerIds = Object.keys(screenSharers);
  const isSelfSharing = isScreenSharing && sharerIds.length === 0;
  const isVisible = isSelfSharing || sharerIds.length > 0;

  const watchingStream = watchingUserId ? screenSharers[watchingUserId] ?? null : null;

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = watchingStream;
    }
  }, [watchingStream]);

  useEffect(() => {
    const handler = () => setMinimized(false);
    window.addEventListener("blok:focus-screen-share", handler);
    return () => window.removeEventListener("blok:focus-screen-share", handler);
  }, []);

  if (!isVisible) return null;

  const serverMembers = activeServerId ? members[activeServerId] ?? [] : [];

  const getDisplayName = (userId: string) => {
    const member = serverMembers.find((m) => m.userId === userId);
    const u = member?.user;
    return u?.displayName || u?.username || userId.slice(0, 8);
  };

  const sharingName = watchingUserId ? getDisplayName(watchingUserId) : (user?.displayName ?? user?.username ?? "You");

  return (
    <div
      className={`fixed z-50 transition-all duration-200 ${
        minimized ? "bottom-20 right-4 w-64" : "inset-4 flex flex-col"
      }`}
    >
      <div className="bg-[var(--bg-base)] border border-[var(--border)] rounded-lg overflow-hidden flex flex-col h-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 bg-[var(--bg-surface)] border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-2 text-xs font-mono text-[var(--text-muted)]">
            <Monitor className="w-3 h-3 text-[var(--online)]" />
            <span className="text-[var(--online)]">{sharingName}</span>
            <span>{isSelfSharing ? `— ${t("screenShare.sharingYour")}` : t("screenShare.isSharing")}</span>
          </div>
          <div className="flex items-center gap-1">
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

        {/* Multi-streamer picker — only shown when 2+ peers are sharing */}
        {!minimized && sharerIds.length > 1 && (
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

        {/* Video */}
        {!minimized && (
          <div className="flex-1 bg-black flex items-center justify-center overflow-hidden">
            {isSelfSharing ? (
              <div className="text-center text-[var(--text-muted)] font-mono text-sm">
                <Monitor className="w-8 h-8 mx-auto mb-2 text-[var(--online)]" />
                <p>{t("screenShare.beingShared")}</p>
                <button
                  onClick={() => useServerStore.getState().toggleScreenShare()}
                  className="mt-3 px-3 py-1 bg-[var(--destructive)] text-white text-xs rounded hover:opacity-80 transition-opacity"
                >
                  {t("screenShare.stop")}
                </button>
              </div>
            ) : (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="max-w-full max-h-full object-contain"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
