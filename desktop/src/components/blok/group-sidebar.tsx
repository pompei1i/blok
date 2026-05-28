import {
  Hash,
  Volume2,
  ChevronDown,
  Plus,
  Settings,
  PhoneOff,
  MicOff,
  VolumeX,
  Monitor,
  UserPlus,
  Trash2,
  X,
} from "lucide-react";
import { useServerStore } from "@/lib/store/server-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { UserAvatar } from "./user-avatar";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { playSound } from "@/lib/sounds";
import { UserBar } from "./user-bar";
import { useI18n } from "@/lib/i18n";
import { CreateChannelModal } from "./create-channel-modal";
import { InviteUserModal } from "./invite-user-modal";
import { can } from "@/lib/permission";

export function GroupSidebar() {
  const { t } = useI18n();
  const {
    servers,
    activeServerId,
    channels,
    activeChannelId,
    setActiveChannel,
    activeVoiceChannelId,
    voiceParticipants,
    joinVoiceChannel,
    leaveVoiceChannel,
    unreadCounts,
    deleteChannel,
  } = useServerStore();
  const { user } = useAuthStore();
  const [expandedSections, setExpandedSections] = useState({
    text: true,
    voice: true,
  });

  const activeServer = servers.find((s) => s.id === activeServerId);
  const serverChannels = activeServerId ? channels[activeServerId] || [] : [];

  const textChannels = serverChannels.filter((c) => c.type === "text");
  const voiceChannels = serverChannels.filter((c) => c.type === "voice");

  // Local state for modal
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [channelModalType, setChannelModalType] = useState<"text" | "voice">("text");

  const canManage = can("manage_server", { userId: user?.id, server: activeServer ?? null });

  const [showInviteUser, setShowInviteUser] = useState(false);
  const [joiningChannel, setJoiningChannel] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [confirmDeleteChannelId, setConfirmDeleteChannelId] = useState<string | null>(null);

  const handleVoiceChannelClick = async (channelId: string) => {
    if (!user || joiningChannel) return;
    setVoiceError(null);
    if (activeVoiceChannelId === channelId) {
      await leaveVoiceChannel();
      playSound("leave");
    } else {
      setJoiningChannel(channelId);
      try {
        const error = await joinVoiceChannel(channelId, user);
        if (error) setVoiceError(error);
        else playSound("join");
      } finally {
        setJoiningChannel(null);
      }
    }
  };

  if (!activeServer) {
    return (
      <div className="w-56 bg-[var(--bg-surface)] border-r border-[var(--border)] flex flex-col items-center justify-center text-[var(--text-muted)] text-sm flex-shrink-0">
        <p className="text-center px-4">
          <span className="text-[var(--text-muted)]">$ </span>
          {t("group.noGroupSelected")}
        </p>
      </div>
    );
  }

  return (
    <div className="w-56 bg-[var(--bg-surface)] border-r border-[var(--border)] flex flex-col flex-shrink-0">
      <div className="p-3 border-b border-[var(--border)]">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm text-[var(--text-primary)] truncate">
            {activeServer.name}
          </h2>
          <div className="flex items-center gap-1">
            {canManage && (
              <button
                onClick={() => setShowInviteUser(true)}
                title="Добавить участника"
                className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors"
              >
                <UserPlus className="w-4 h-4 text-[var(--text-muted)]" />
              </button>
            )}
            <button className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors">
              <Settings className="w-4 h-4 text-[var(--text-muted)]" />
            </button>
          </div>
        </div>
        {activeServer.description && (
          <p className="text-xs text-[var(--text-muted)] mt-1 truncate">
            <span className="opacity-60">@desc </span>
            {activeServer.description}
          </p>
        )}
      </div>

      {voiceError && (
        <div className="mx-2 mt-2 px-2 py-1.5 bg-[var(--destructive)]/10 border border-[var(--destructive)]/30 rounded text-xs text-[var(--destructive)] flex items-center justify-between gap-1">
          <span className="truncate">{voiceError}</span>
          <button onClick={() => setVoiceError(null)} className="shrink-0 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        <div className="mb-4">
          <div className="flex items-center justify-between hover:text-[var(--text-primary)] transition-colors mb-1 pr-1 group">
            <button
              onClick={() =>
                setExpandedSections((s) => ({ ...s, text: !s.text }))
              }
              className="flex items-center gap-1 flex-1 text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium"
            >
              <ChevronDown
                className={cn(
                  "w-3 h-3 transition-transform",
                  !expandedSections.text && "-rotate-90",
                )}
              />
              {t("group.textChannels")}
            </button>
            {canManage && (
              <button
                onClick={() => {
                  setChannelModalType("text");
                  setShowCreateChannel(true);
                }}
                className="opacity-0 group-hover:opacity-100 hover:text-[var(--text-primary)] transition-all p-0.5 rounded"
              >
                <Plus className="w-3 h-3 text-[var(--text-muted)]" />
              </button>
            )}
          </div>

          {expandedSections.text && (
            <div className="space-y-0.5">
              {textChannels.map((channel) => (
                <div key={channel.id} className="group/ch relative">
                  {confirmDeleteChannelId === channel.id ? (
                    <div className="flex items-center gap-1 px-2 py-1.5 rounded bg-[var(--bg-elevated)] border border-[var(--destructive)]/40 text-xs">
                      <span className="text-[var(--destructive)] truncate flex-1">
                        {t("channel.deleteConfirm").replace("{name}", channel.name)}
                      </span>
                      <button
                        onClick={() => { void deleteChannel(channel.id); setConfirmDeleteChannelId(null); }}
                        className="px-1.5 py-0.5 rounded bg-[var(--destructive)] text-white hover:opacity-90 transition-opacity text-[10px]"
                      >
                        {t("message.delete")}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteChannelId(null)}
                        className="p-0.5 hover:text-[var(--text-primary)] transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setActiveChannel(channel.id)}
                      className={cn(
                        "flex items-center gap-1.5 w-full px-2 py-1.5 rounded text-sm transition-all duration-120 text-left",
                        activeChannelId === channel.id
                          ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[inset_2px_0_0_var(--accent-red)]"
                          : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                      )}
                    >
                      <Hash className="w-4 h-4 flex-shrink-0" />
                      <span className="truncate flex-1 min-w-0">{channel.name}</span>
                      {(unreadCounts[channel.id] ?? 0) > 0 && (
                        <span className="flex-shrink-0 min-w-[18px] h-[18px] flex items-center justify-center bg-[var(--accent-red)] rounded-full text-[10px] text-white font-bold px-1">
                          {unreadCounts[channel.id] > 99 ? "99+" : unreadCounts[channel.id]}
                        </span>
                      )}
                      {canManage && (
                        <span
                          role="button"
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteChannelId(channel.id); }}
                          className="opacity-0 group-hover/ch:opacity-100 p-0.5 hover:text-[var(--destructive)] transition-all rounded"
                        >
                          <Trash2 className="w-3 h-3" />
                        </span>
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between hover:text-[var(--text-primary)] transition-colors mb-1 pr-1 group">
            <button
              onClick={() =>
                setExpandedSections((s) => ({ ...s, voice: !s.voice }))
              }
              className="flex items-center gap-1 flex-1 text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium"
            >
              <ChevronDown
                className={cn(
                  "w-3 h-3 transition-transform",
                  !expandedSections.voice && "-rotate-90",
                )}
              />
              {t("group.voiceRooms")}
            </button>
            {canManage && (
              <button
                onClick={() => {
                  setChannelModalType("voice");
                  setShowCreateChannel(true);
                }}
                className="opacity-0 group-hover:opacity-100 hover:text-[var(--text-primary)] transition-all p-0.5 rounded"
              >
                <Plus className="w-3 h-3 text-[var(--text-muted)] hover:text-[var(--text-primary)]" />
              </button>
            )}
          </div>

          {expandedSections.voice && (
            <div className="space-y-0.5">
              {voiceChannels.map((channel) => {
                const isInChannel = activeVoiceChannelId === channel.id;
                const participants = voiceParticipants[channel.id] || [];

                return (
                  <div key={channel.id}>
                    <button
                      onClick={() => handleVoiceChannelClick(channel.id)}
                      disabled={joiningChannel === channel.id}
                      className={cn(
                        "flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm transition-all duration-120",
                        isInChannel
                          ? "bg-[var(--bg-elevated)] text-[var(--online)] border-l-2 border-[var(--online)]"
                          : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                        joiningChannel === channel.id && "opacity-60 cursor-wait",
                      )}
                    >
                      <Volume2
                        className={cn(
                          "w-4 h-4 flex-shrink-0",
                          isInChannel && "text-[var(--online)]",
                        )}
                      />
                      <span className="truncate flex-1 text-left">
                        {channel.name}
                      </span>
                      {joiningChannel === channel.id && (
                        <span className="text-[10px] text-[var(--text-muted)] animate-pulse">…</span>
                      )}
                      {isInChannel && !joiningChannel && (
                        <PhoneOff className="w-3 h-3 text-[var(--destructive)]" />
                      )}
                    </button>

                    {participants.length > 0 && (
                      <div className="ml-6 mt-1 space-y-1">
                        {participants.map((participant) => {
                          const displayUser = participant.userId === user?.id ? user : participant.user;
                          return (
                            <div
                              key={participant.userId}
                              className="flex items-center gap-2 px-2 py-1 text-xs text-[var(--text-muted)]"
                            >
                              <div
                                className={cn(
                                  "rounded-full transition-all",
                                  participant.isSpeaking &&
                                    "ring-2 ring-[var(--online)] ring-offset-1 ring-offset-[var(--bg-surface)]",
                                )}
                              >
                                <UserAvatar user={displayUser} size="xs" />
                              </div>
                              <span
                                className={cn(
                                  "truncate transition-colors",
                                  participant.isSpeaking && "text-[var(--online)]",
                                )}
                              >
                                {displayUser?.displayName || displayUser?.username || "..."}
                              </span>
                              <div className="ml-auto flex items-center gap-1">
                                {participant.isScreenSharing && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      window.dispatchEvent(new CustomEvent("blok:focus-screen-share"));
                                    }}
                                    title="View screen share"
                                    className="hover:text-[var(--online)] transition-colors"
                                  >
                                    <Monitor className="w-3 h-3 text-[var(--online)]" />
                                  </button>
                                )}
                                {(participant.isMuted || participant.isDeafened) && (
                                  <MicOff className="w-3 h-3 text-[var(--destructive)]" />
                                )}
                                {participant.isDeafened && (
                                  <VolumeX className="w-3 h-3 text-[var(--destructive)]" />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <UserBar />
      
      {activeServer && (
        <CreateChannelModal
          isOpen={showCreateChannel}
          onClose={() => setShowCreateChannel(false)}
          serverId={activeServer.id}
          initialType={channelModalType}
        />
      )}
      {activeServer && canManage && (
        <InviteUserModal
          isOpen={showInviteUser}
          onClose={() => setShowInviteUser(false)}
          serverId={activeServer.id}
          serverName={activeServer.name}
        />
      )}
    </div>
  );
}

