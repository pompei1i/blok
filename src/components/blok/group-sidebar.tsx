import {
  Hash,
  Volume2,
  ChevronDown,
  Plus,
  Settings,
  PhoneOff,
  MicOff,
  HeadphoneOff,
  UserPlus,
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

interface GroupSidebarProps {
  isDrawerOpen?: boolean;
  onDrawerClose?: () => void;
}

export function GroupSidebar({ isDrawerOpen, onDrawerClose }: GroupSidebarProps) {
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

  // Only render + buttons if the current user is the server owner
  const isServerOwner = user?.id === activeServer?.ownerId;

  const [showInviteUser, setShowInviteUser] = useState(false);
  const [joiningChannel, setJoiningChannel] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const handleVoiceChannelClick = async (channelId: string) => {
    if (!user || joiningChannel) return;
    setVoiceError(null);
    if (activeVoiceChannelId === channelId) {
      await leaveVoiceChannel();
      playSound("leave");
    } else {
      setJoiningChannel(channelId);
      const error = await joinVoiceChannel(channelId, user);
      setJoiningChannel(null);
      if (error) {
        setVoiceError(error);
      } else {
        playSound("join");
      }
    }
  };

  if (!activeServer) {
    return (
      <div className="w-56 bg-[var(--bg-surface)] border-r border-[var(--border)] flex flex-col items-center justify-center text-[var(--text-muted)] text-sm relative">
        {onDrawerClose && (
          <button onClick={onDrawerClose} className="absolute top-3 right-3 p-1 hover:bg-[var(--bg-hover)] rounded">
            <X className="w-4 h-4 text-[var(--text-muted)]" />
          </button>
        )}
        <p className="text-center px-4">
          <span className="text-[var(--text-muted)]">$ </span>
          {t("group.noGroupSelected")}
        </p>
      </div>
    );
  }

  return (
    <div className="w-56 bg-[var(--bg-surface)] border-r border-[var(--border)] flex flex-col">
      <div className="p-3 border-b border-[var(--border)]">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm text-[var(--text-primary)] truncate">
            {activeServer.name}
          </h2>
          <div className="flex items-center gap-1">
            {onDrawerClose && (
              <button onClick={onDrawerClose} className="md:hidden p-1 hover:bg-[var(--bg-hover)] rounded transition-colors">
                <X className="w-4 h-4 text-[var(--text-muted)]" />
              </button>
            )}
            {isServerOwner && (
              <button
                onClick={() => setShowInviteUser(true)}
                title="Add member"
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
            {isServerOwner && (
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
                <button
                  key={channel.id}
                  onClick={() => setActiveChannel(channel.id)}
                  className={cn(
                    "flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm transition-all duration-120",
                    activeChannelId === channel.id
                      ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] border-l-2 border-[var(--accent-red)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                  )}
                >
                  <Hash className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">{channel.name}</span>
                </button>
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
            {isServerOwner && (
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
                              {(participant.isMuted || participant.isDeafened) && (
                                <div className="flex items-center gap-0.5 ml-auto">
                                  <MicOff className="w-3 h-3 text-[var(--destructive)]" />
                                  {participant.isDeafened && (
                                    <HeadphoneOff className="w-3 h-3 text-[var(--destructive)]" />
                                  )}
                                </div>
                              )}
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
      {activeServer && isServerOwner && (
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

