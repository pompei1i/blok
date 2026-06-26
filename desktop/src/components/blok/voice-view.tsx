import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Headphones, HeadphoneOff, VolumeX, Monitor, Video, VideoOff, PhoneOff } from "lucide-react";
import { useServerStore } from "@/lib/store/server-store";
import { useShallow } from "zustand/react/shallow";
import { useAuthStore } from "@/lib/store/auth-store";
import { useUiSettingsStore } from "@/lib/store/ui-settings-store";
import { UserAvatar } from "./user-avatar";
import { cn } from "@/lib/utils";
import { VoiceUserContextMenu, type VoiceUserCtx } from "./voice-user-context-menu";

function VideoTile({
  stream,
  label,
  muted,
  mirror,
  onContextMenu,
}: {
  stream: MediaStream;
  label: string;
  muted?: boolean;
  mirror?: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = stream;
    ref.current.play().catch(() => {});
  }, [stream]);
  return (
    <div className="relative bg-black rounded overflow-hidden aspect-video" onContextMenu={onContextMenu}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={cn("w-full h-full object-cover", mirror && "scale-x-[-1]")}
      />
      <span className="absolute bottom-1 left-1 px-1 py-0.5 bg-black/60 rounded text-[12px] font-mono text-white">
        {label}
      </span>
    </div>
  );
}

export function VoiceView() {
  const {
    activeVoiceChannelId,
    voiceParticipants,
    members,
    activeServerId,
    channels,
    isMuted,
    isDeafened,
    isScreenSharing,
    isCameraOn,
    localCameraStream,
    cameraUsers,
    toggleMute,
    toggleDeafen,
    toggleScreenShare,
    toggleCamera,
    leaveVoiceChannel,
  } = useServerStore(
    useShallow((s) => ({
      activeVoiceChannelId: s.activeVoiceChannelId,
      voiceParticipants: s.voiceParticipants,
      members: s.members,
      activeServerId: s.activeServerId,
      channels: s.channels,
      isMuted: s.isMuted,
      isDeafened: s.isDeafened,
      isScreenSharing: s.isScreenSharing,
      isCameraOn: s.isCameraOn,
      localCameraStream: s.localCameraStream,
      cameraUsers: s.cameraUsers,
      toggleMute: s.toggleMute,
      toggleDeafen: s.toggleDeafen,
      toggleScreenShare: s.toggleScreenShare,
      toggleCamera: s.toggleCamera,
      leaveVoiceChannel: s.leaveVoiceChannel,
    })),
  );
  const { user } = useAuthStore();
  const mirrorCamera = useUiSettingsStore((s) => s.mirrorCamera);
  const [ctxMenu, setCtxMenu] = useState<VoiceUserCtx | null>(null);

  if (!activeVoiceChannelId) return null;

  const participants = voiceParticipants[activeVoiceChannelId] ?? [];
  const serverMembers = activeServerId ? (members[activeServerId] ?? []) : [];
  const serverChannels = activeServerId ? (channels[activeServerId] ?? []) : [];
  const voiceChannel = serverChannels.find((c) => c.id === activeVoiceChannelId);

  const getDisplayName = (userId: string) => {
    const m = serverMembers.find((x) => x.userId === userId);
    return m?.user?.displayName || m?.user?.username || userId.slice(0, 8);
  };

  const openCtxMenu = (userId: string) => (e: React.MouseEvent) => {
    if (userId === user?.id) return; // no volume control over yourself
    e.preventDefault();
    setCtxMenu({ userId, name: getDisplayName(userId), x: e.clientX, y: e.clientY });
  };

  const tiles: { id: string; stream: MediaStream; label: string; muted: boolean; mirror?: boolean }[] = [];
  if (localCameraStream && isCameraOn) {
    const label = user?.displayName || user?.username || "you";
    tiles.push({ id: "local", stream: localCameraStream, label, muted: true, mirror: mirrorCamera });
  }
  for (const [uid, stream] of Object.entries(cameraUsers)) {
    tiles.push({ id: uid, stream, label: getDisplayName(uid), muted: false });
  }

  const gridCols =
    tiles.length <= 1 ? "grid-cols-1" : tiles.length <= 4 ? "grid-cols-2" : "grid-cols-3";

  const nonVideoParticipants = participants.filter((p) => {
    const hasCam = p.userId === user?.id ? isCameraOn : !!cameraUsers[p.userId];
    return !hasCam;
  });

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-base)] overflow-hidden">
      {/* Channel header */}
      <div className="h-12 border-b border-[var(--border)] flex items-center px-4 bg-[var(--bg-surface)] shrink-0">
        <span className="font-mono text-xs text-[var(--text-muted)] mr-2">♪</span>
        <span className="font-medium text-[var(--text-primary)]">
          {voiceChannel?.name ?? "voice"}
        </span>
        <span className="ml-2 text-xs text-[var(--text-muted)] font-mono">
          — {participants.length} {participants.length === 1 ? "participant" : "participants"}
        </span>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Video grid */}
        {tiles.length > 0 && (
          <div
            className={cn(
              "p-4 bg-[#080808] grid gap-3",
              gridCols,
              tiles.length === 1 ? "max-h-[65%]" : "flex-1",
            )}
          >
            {tiles.map((tile) => (
              <VideoTile
                key={tile.id}
                stream={tile.stream}
                label={tile.label}
                muted={tile.muted}
                mirror={tile.mirror}
                onContextMenu={openCtxMenu(tile.id === "local" ? (user?.id ?? "") : tile.id)}
              />
            ))}
          </div>
        )}

        {/* Audio-only participants */}
        <div className="flex-1 p-4 overflow-y-auto">
          {participants.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)] font-mono text-xs opacity-50">
              <span className="cursor-blink mr-1">$</span> no participants
            </div>
          ) : nonVideoParticipants.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {nonVideoParticipants.map((p) => {
                const member = serverMembers.find((m) => m.userId === p.userId);
                const u = member?.user ?? p.user;
                return (
                  <div
                    key={p.userId}
                    onContextMenu={openCtxMenu(p.userId)}
                    className={cn(
                      "flex flex-col items-center gap-2 p-3 rounded bg-[var(--bg-surface)] border border-[var(--border)] min-w-[80px]",
                      p.userId !== user?.id && "cursor-context-menu",
                    )}
                  >
                    <UserAvatar user={u} size="md" isSpeaking={p.isSpeaking} />
                    <span className="text-xs font-mono text-[var(--text-primary)] text-center truncate max-w-[80px]">
                      {u?.displayName || u?.username || p.userId.slice(0, 8)}
                    </span>
                    <div className="flex gap-1">
                      {p.isMuted && <MicOff className="w-3 h-3 text-[var(--accent-red-text)]" />}
                      {p.isDeafened && <VolumeX className="w-3 h-3 text-[var(--text-muted)]" />}
                      {p.isScreenSharing && <Monitor className="w-3 h-3 text-[var(--accent-red)]" />}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {/* Controls bar */}
      <div className="shrink-0 h-14 border-t border-[var(--border)] bg-[var(--bg-surface)] flex items-center justify-center gap-2 px-4">
        <button
          onClick={toggleMute}
          aria-label={isMuted ? "Unmute" : "Mute"}
          className={cn(
            "p-2.5 rounded transition-colors",
            isMuted
              ? "bg-[var(--destructive)] text-white"
              : "bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]",
          )}
        >
          {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>

        <button
          onClick={toggleDeafen}
          aria-label={isDeafened ? "Undeafen" : "Deafen"}
          className={cn(
            "p-2.5 rounded transition-colors",
            isDeafened
              ? "bg-[var(--destructive)] text-white"
              : "bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]",
          )}
        >
          {isDeafened ? <HeadphoneOff className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
        </button>

        <div className="relative">
          <button
            onClick={() => void toggleCamera()}
            aria-label={`${isCameraOn ? "Turn off camera" : "Turn on camera"} (experimental)`}
            className={cn(
              "p-2.5 rounded transition-colors",
              isCameraOn
                ? "bg-[var(--online)]/20 text-[var(--online-text)] border border-[var(--online)]/30"
                : "bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]",
            )}
          >
            {isCameraOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
          </button>
          <span className="absolute -top-1 -right-1 text-[8px] font-bold leading-none px-0.5 bg-[var(--afk)] text-black rounded-sm select-none pointer-events-none" aria-label="experimental">β</span>
        </div>

        <div className="relative">
          <button
            onClick={() => void toggleScreenShare()}
            aria-label={`${isScreenSharing ? "Stop sharing" : "Share screen"} (experimental)`}
            className={cn(
              "p-2.5 rounded transition-colors",
              isScreenSharing
                ? "bg-[var(--online)]/20 text-[var(--online-text)] border border-[var(--online)]/30"
                : "bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]",
            )}
          >
            <Monitor className="w-4 h-4" />
          </button>
          <span className="absolute -top-1 -right-1 text-[8px] font-bold leading-none px-0.5 bg-[var(--afk)] text-black rounded-sm select-none pointer-events-none" aria-label="experimental">β</span>
        </div>

        <div className="w-px h-6 bg-[var(--border)] mx-1" />

        <button
          onClick={() => void leaveVoiceChannel()}
          aria-label="Leave voice"
          className="p-2.5 rounded bg-[var(--destructive)] hover:opacity-90 text-white transition-opacity"
        >
          <PhoneOff className="w-4 h-4" />
        </button>
      </div>

      {ctxMenu && (
        <VoiceUserContextMenu ctx={ctxMenu} onClose={() => setCtxMenu(null)} />
      )}
    </div>
  );
}
