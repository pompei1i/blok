import {
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  Settings,
  PhoneOff,
  Monitor,
  MonitorOff,
} from "lucide-react";
import { useAuthStore } from "@/lib/store/auth-store";
import { useServerStore } from "@/lib/store/server-store";
import { UserAvatar } from "./user-avatar";
import { PresenceDot } from "./presence-dot";
import { AccountEditModal } from "./account-edit-modal";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { playSound } from "@/lib/sounds";
import { useI18n } from "@/lib/i18n";

export function UserBar() {
  const { t } = useI18n();
  const { user } = useAuthStore();
  const {
    activeVoiceChannelId,
    leaveVoiceChannel,
    isMuted,
    isDeafened,
    isScreenSharing,
    toggleMute,
    toggleDeafen,
    toggleScreenShare,
    channels,
    activeServerId,
    voiceParticipants,
  } = useServerStore();

  const localParticipant = activeVoiceChannelId
    ? (voiceParticipants[activeVoiceChannelId] ?? []).find((p) => p.userId === user?.id)
    : null;
  const isSpeaking = localParticipant?.isSpeaking ?? false;
  const [showSettings, setShowSettings] = useState(false);

  const serverChannels = activeServerId ? channels[activeServerId] || [] : [];
  const activeVoiceChannel = serverChannels.find(
    (c) => c.id === activeVoiceChannelId,
  );

  return (
    <>
      <div className="w-56 bg-[var(--bg-surface)] border-t border-r border-[var(--border)] flex flex-col justify-center px-3 gap-2 py-3 mt-auto shrink-0">
        {activeVoiceChannelId && activeVoiceChannel && (
          <div className="flex items-center gap-2 px-2 py-1 bg-[var(--online)]/20 rounded-lg border border-[var(--online)]/30">
            <div className="w-2 h-2 rounded-full bg-[var(--online)] animate-pulse" />
            <span className="text-xs text-[var(--online)]">
              {activeVoiceChannel.name}
            </span>
            <button
              onClick={async () => {
                await leaveVoiceChannel();
                playSound("leave");
              }}
              className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors"
              title={t("userBar.leaveVoice")}
            >
              <PhoneOff className="w-3 h-3 text-[var(--destructive)]" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 flex-1">
          <button
            onClick={() => setShowSettings(true)}
            className="relative hover:opacity-80 transition-opacity"
          >
            <UserAvatar user={user} size="md" />
            <PresenceDot
              status="online"
              size="sm"
              className="absolute -bottom-0.5 -right-0.5 ring-2 ring-[var(--bg-surface)]"
            />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)] truncate">
              @{user?.username}
            </p>
            <p className="text-xs text-[var(--text-muted)] truncate">
              {user?.statusMessage || t("userBar.online")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={toggleMute}
            className={cn(
              "p-2 rounded-lg transition-colors",
              isMuted || isDeafened
                ? "bg-[var(--destructive)] text-white"
                : isSpeaking
                  ? "bg-[var(--online)]/20 text-[var(--online)] ring-1 ring-[var(--online)]"
                  : "hover:bg-[var(--bg-hover)] text-[var(--text-muted)]",
            )}
            title={isMuted ? t("userBar.unmute") : t("userBar.mute")}
          >
            {isMuted || isDeafened ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <button
            onClick={toggleDeafen}
            className={cn(
              "p-2 rounded-lg transition-colors",
              isDeafened
                ? "bg-[var(--destructive)] text-white"
                : "hover:bg-[var(--bg-hover)] text-[var(--text-muted)]",
            )}
            title={isDeafened ? t("userBar.undeafen") : t("userBar.deafen")}
          >
            {isDeafened ? (
              <HeadphoneOff className="w-4 h-4" />
            ) : (
              <Headphones className="w-4 h-4" />
            )}
          </button>
          {activeVoiceChannelId && (
            <button
              onClick={() => void toggleScreenShare()}
              className={cn(
                "p-2 rounded-lg transition-colors",
                isScreenSharing
                  ? "bg-[var(--online)]/20 text-[var(--online)] ring-1 ring-[var(--online)]"
                  : "hover:bg-[var(--bg-hover)] text-[var(--text-muted)]",
              )}
              title={isScreenSharing ? "Stop sharing" : "Share screen"}
            >
              {isScreenSharing ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors"
            title={t("userBar.settings")}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      <AccountEditModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </>
  );
}

