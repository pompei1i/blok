import { useEffect, useRef, useState } from "react";
import { useServerStore } from "@/lib/store/server-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { X, Minimize2, Maximize2, Monitor } from "lucide-react";

export function ScreenShareOverlay() {
  const { screenShareUserId, remoteScreenStream, isScreenSharing, members, activeServerId } = useServerStore();
  const { user } = useAuthStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [minimized, setMinimized] = useState(false);

  const isSelfSharing = isScreenSharing && !screenShareUserId;
  const isVisible = isSelfSharing || !!screenShareUserId;

  useEffect(() => {
    if (videoRef.current && remoteScreenStream) {
      videoRef.current.srcObject = remoteScreenStream;
    }
  }, [remoteScreenStream]);

  useEffect(() => {
    const handler = () => setMinimized(false);
    window.addEventListener("blok:focus-screen-share", handler);
    return () => window.removeEventListener("blok:focus-screen-share", handler);
  }, []);

  if (!isVisible) return null;

  const serverMembers = activeServerId ? members[activeServerId] ?? [] : [];
  const sharingUser = screenShareUserId
    ? serverMembers.find((m) => m.userId === screenShareUserId)?.user
    : user;
  const sharingName = sharingUser?.displayName || sharingUser?.username || "Unknown";

  return (
    <div
      className={`fixed z-50 transition-all duration-200 ${
        minimized
          ? "bottom-20 right-4 w-64"
          : "inset-4 flex flex-col"
      }`}
    >
      <div className="bg-[var(--bg-base)] border border-[var(--border)] rounded-lg overflow-hidden flex flex-col h-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 bg-[var(--bg-surface)] border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-2 text-xs font-mono text-[var(--text-muted)]">
            <Monitor className="w-3 h-3 text-[var(--online)]" />
            <span className="text-[var(--online)]">{sharingName}</span>
            <span>is sharing screen</span>
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
                title="Stop sharing"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Video */}
        {!minimized && (
          <div className="flex-1 bg-black flex items-center justify-center overflow-hidden">
            {isSelfSharing ? (
              <div className="text-center text-[var(--text-muted)] font-mono text-sm">
                <Monitor className="w-8 h-8 mx-auto mb-2 text-[var(--online)]" />
                <p>Your screen is being shared</p>
                <button
                  onClick={() => useServerStore.getState().toggleScreenShare()}
                  className="mt-3 px-3 py-1 bg-[var(--destructive)] text-white text-xs rounded hover:opacity-80 transition-opacity"
                >
                  stop sharing
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
