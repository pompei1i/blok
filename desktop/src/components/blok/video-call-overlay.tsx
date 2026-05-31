import { useEffect, useRef, useState } from "react";
import { Video, VideoOff, Minimize2, Maximize2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useServerStore } from "@/lib/store/server-store";
import { useDMStore } from "@/lib/store/dm-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { useUiSettingsStore } from "@/lib/store/ui-settings-store";
import { cn } from "@/lib/utils";

function VideoTile({ stream, label, muted, mirror }: { stream: MediaStream; label: string; muted?: boolean; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = stream;
    ref.current.play().catch(() => {});
  }, [stream]);
  return (
    <div className="relative bg-black rounded overflow-hidden aspect-video">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={cn("w-full h-full object-cover", mirror && "scale-x-[-1]")}
      />
      <span className="absolute bottom-1 left-1 px-1 py-0.5 bg-black/60 rounded text-[10px] font-mono text-white">
        {label}
      </span>
    </div>
  );
}

export function VideoCallOverlay() {
  const { cameraUsers, localCameraStream, isCameraOn, members, activeServerId, toggleCamera } = useServerStore();
  const { dmCameraUsers, localDMCameraStream, isDMCameraOn, activeCall, toggleDMCamera } = useDMStore();
  const { user } = useAuthStore();
  const mirrorCamera = useUiSettingsStore((s) => s.mirrorCamera);
  const { t } = useI18n();
  const [minimized, setMinimized] = useState(false);

  // Collect all video tiles: local + remote from voice channel OR DM call
  const isVoiceVideo = isCameraOn || Object.keys(cameraUsers).length > 0;
  const isDMVideo = isDMCameraOn || Object.keys(dmCameraUsers).length > 0;
  const isVisible = isVoiceVideo || isDMVideo;

  if (!isVisible) return null;

  const serverMembers = activeServerId ? (members[activeServerId] ?? []) : [];
  const getDisplayName = (userId: string) => {
    const m = serverMembers.find((x) => x.userId === userId);
    const u = m?.user;
    return u?.displayName || u?.username || userId.slice(0, 8);
  };

  const localLabel = user?.displayName || user?.username || t("videoCall.you");
  const localStream = localCameraStream ?? localDMCameraStream;
  const remoteEntries = Object.entries({ ...cameraUsers, ...dmCameraUsers });

  const tiles: { id: string; stream: MediaStream; label: string; muted: boolean; mirror?: boolean }[] = [];
  if (localStream) tiles.push({ id: "local", stream: localStream, label: `${localLabel} (you)`, muted: true, mirror: mirrorCamera });
  for (const [uid, stream] of remoteEntries) {
    const label = activeCall?.peerUserId === uid
      ? (activeCall.peerUsername || uid.slice(0, 8))
      : getDisplayName(uid);
    tiles.push({ id: uid, stream, label, muted: false });
  }

  const onToggle = isVoiceVideo ? toggleCamera : () => void toggleDMCamera();

  const gridCols = tiles.length <= 1 ? "grid-cols-1" : tiles.length <= 4 ? "grid-cols-2" : "grid-cols-3";

  return (
    <div
      className={cn(
        "fixed z-50 transition-all duration-200",
        minimized ? "bottom-20 right-4 w-64" : "inset-4 flex flex-col",
      )}
    >
      <div className="bg-[var(--bg-base)] border border-[var(--border)] rounded-lg overflow-hidden flex flex-col h-full shadow-2xl">
        <div className="flex items-center justify-between px-3 py-2 bg-[var(--bg-surface)] border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-2 text-xs font-mono text-[var(--text-muted)]">
            <Video className="w-3 h-3 text-[var(--online)]" />
            <span className="text-[var(--online)]">{t("videoCall.title")}</span>
            <span>— {tiles.length} {tiles.length !== 1 ? t("videoCall.participants") : t("videoCall.participant")}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onToggle}
              className={cn(
                "p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors",
                (isCameraOn || isDMCameraOn)
                  ? "hover:bg-[var(--destructive)]/20"
                  : "hover:bg-[var(--bg-hover)]",
              )}
              title={(isCameraOn || isDMCameraOn) ? t("videoCall.turnOffCamera") : t("videoCall.turnOnCamera")}
            >
              {(isCameraOn || isDMCameraOn) ? <VideoOff className="w-3 h-3" /> : <Video className="w-3 h-3" />}
            </button>
            <button
              onClick={() => setMinimized((v) => !v)}
              className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              {minimized ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
            </button>
            <button
              onClick={onToggle}
              className="p-1 hover:bg-[var(--destructive)]/20 rounded text-[var(--text-muted)] hover:text-[var(--destructive)] transition-colors"
              title={t("videoCall.stopAll")}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>

        {!minimized && (
          <div className={cn("flex-1 p-2 bg-[#0a0a0a] grid gap-2 content-start overflow-auto", gridCols)}>
            {tiles.map((t) => (
              <VideoTile key={t.id} stream={t.stream} label={t.label} muted={t.muted} mirror={t.mirror} />
            ))}
            {tiles.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center py-12 text-[var(--text-muted)] font-mono text-sm">
                <Video className="w-8 h-8 mb-2 opacity-30" />
                <p>{t("videoCall.noStreams")}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
