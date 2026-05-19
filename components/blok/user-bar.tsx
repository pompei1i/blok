'use client';

import { Mic, MicOff, Headphones, HeadphoneOff, Settings, PhoneOff } from 'lucide-react';
import { useAuthStore } from '@/lib/store/auth-store';
import { useGroupStore } from '@/lib/store/group-store';
import { UserAvatar } from './user-avatar';
import { PresenceDot } from './presence-dot';
import { AccountEditModal } from './account-edit-modal';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

export function UserBar() {
  const { t } = useI18n();
  const { user } = useAuthStore();
  const {
    activeVoiceChannelId,
    leaveVoiceChannel,
    isMuted,
    isDeafened,
    toggleMute,
    toggleDeafen,
    channels,
    activeGroupId,
  } = useGroupStore();
  const [showSettings, setShowSettings] = useState(false);

  const groupChannels = activeGroupId ? channels[activeGroupId] || [] : [];
  const activeVoiceChannel = groupChannels.find(c => c.id === activeVoiceChannelId);

  return (
    <>
      <div className="h-14 bg-[var(--bg-surface)] border-t border-[var(--border)] flex items-center px-3 gap-2">
        {/* Voice channel indicator */}
        {activeVoiceChannelId && activeVoiceChannel && (
          <div className="flex items-center gap-2 px-2 py-1 bg-[var(--online)]/20 rounded-lg border border-[var(--online)]/30">
            <div className="w-2 h-2 rounded-full bg-[var(--online)] animate-pulse" />
            <span className="text-xs text-[var(--online)]">
              {activeVoiceChannel.name}
            </span>
            <button
              onClick={() => void leaveVoiceChannel()}
              className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors"
              title={t('userBar.leaveVoice')}
            >
              <PhoneOff className="w-3 h-3 text-[var(--destructive)]" />
            </button>
          </div>
        )}

        {/* User info */}
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
              {user?.statusMessage || t('userBar.online')}
            </p>
          </div>
        </div>

        {/* Voice controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={toggleMute}
            className={cn(
              'p-2 rounded-lg transition-colors',
              isMuted
                ? 'bg-[var(--destructive)] text-white'
                : 'hover:bg-[var(--bg-hover)] text-[var(--text-muted)]'
            )}
            title={isMuted ? t('userBar.unmute') : t('userBar.mute')}
          >
            {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <button
            onClick={toggleDeafen}
            className={cn(
              'p-2 rounded-lg transition-colors',
              isDeafened
                ? 'bg-[var(--destructive)] text-white'
                : 'hover:bg-[var(--bg-hover)] text-[var(--text-muted)]'
            )}
            title={isDeafened ? t('userBar.undeafen') : t('userBar.deafen')}
          >
            {isDeafened ? <HeadphoneOff className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors"
            title={t('userBar.settings')}
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
