'use client';

import { Hash, Volume2, ChevronDown, Plus, Settings, MicOff, X, PhoneOff } from 'lucide-react';
import { useGroupStore } from '@/lib/store/group-store';
import { useAuthStore } from '@/lib/store/auth-store';
import { UserAvatar } from './user-avatar';
import { cn } from '@/lib/utils';
import { useState } from 'react';

interface GroupSidebarProps {
  onDrawerClose?: () => void;
}

export function GroupSidebar({ onDrawerClose }: GroupSidebarProps) {
  const {
    groups,
    activeGroupId,
    channels,
    activeChannelId,
    setActiveChannel,
    voiceParticipants,
    activeVoiceChannelId,
    joinVoiceChannel,
    leaveVoiceChannel,
  } = useGroupStore();
  const { user } = useAuthStore();
  const [expandedSections, setExpandedSections] = useState({ text: true, voice: true });
  const [joiningChannelId, setJoiningChannelId] = useState<string | null>(null);

  const activeGroup = groups.find(g => g.id === activeGroupId);
  const groupChannels = activeGroupId ? channels[activeGroupId] || [] : [];

  const textChannels = groupChannels.filter(c => c.type === 'text');
  const voiceChannels = groupChannels.filter(c => c.type === 'voice');

  const handleVoiceChannelClick = async (channelId: string) => {
    if (!user) return;
    if (activeVoiceChannelId === channelId) {
      await leaveVoiceChannel();
      return;
    }
    setJoiningChannelId(channelId);
    try {
      await joinVoiceChannel(channelId, user);
    } catch (err) {
      console.error('Failed to join voice channel:', err);
    } finally {
      setJoiningChannelId(null);
    }
  };

  if (!activeGroup) {
    return (
      <div className="w-56 bg-[var(--bg-surface)] border-r border-[var(--border)] flex flex-col items-center justify-center text-[var(--text-muted)] text-sm relative">
        {onDrawerClose && (
          <button onClick={onDrawerClose} className="absolute top-3 right-3 p-1 hover:bg-[var(--bg-hover)] rounded">
            <X className="w-4 h-4 text-[var(--text-muted)]" />
          </button>
        )}
        <p className="text-center px-4">
          <span className="text-[var(--text-muted)]">$ </span>
          No group selected
        </p>
      </div>
    );
  }

  return (
    <div className="w-56 bg-[var(--bg-surface)] border-r border-[var(--border)] flex flex-col">
      {/* Group header */}
      <div className="p-3 border-b border-[var(--border)]">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm text-[var(--text-primary)] truncate">
            {activeGroup.name}
          </h2>
          <div className="flex items-center gap-1">
            {onDrawerClose && (
              <button onClick={onDrawerClose} className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors">
                <X className="w-4 h-4 text-[var(--text-muted)]" />
              </button>
            )}
            <button className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors">
              <Settings className="w-4 h-4 text-[var(--text-muted)]" />
            </button>
          </div>
        </div>
        {activeGroup.description && (
          <p className="text-xs text-[var(--text-muted)] mt-1 truncate">
            <span className="opacity-60">@desc </span>
            {activeGroup.description}
          </p>
        )}
      </div>

      {/* Channels */}
      <div className="flex-1 overflow-y-auto p-2">
        {/* Text Channels */}
        <div className="mb-4">
          <button
            onClick={() => setExpandedSections(s => ({ ...s, text: !s.text }))}
            className="flex items-center gap-1 w-full text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium mb-1 hover:text-[var(--text-primary)] transition-colors"
          >
            <ChevronDown className={cn('w-3 h-3 transition-transform', !expandedSections.text && '-rotate-90')} />
            Text Channels
            <Plus className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-100" />
          </button>

          {expandedSections.text && (
            <div className="space-y-0.5">
              {textChannels.map((channel) => (
                <button
                  key={channel.id}
                  onClick={() => setActiveChannel(channel.id)}
                  className={cn(
                    'flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm transition-all duration-120',
                    activeChannelId === channel.id
                      ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] border-l-2 border-[var(--accent-red)]'
                      : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                  )}
                >
                  <Hash className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">{channel.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Voice Channels */}
        <div>
          <button
            onClick={() => setExpandedSections(s => ({ ...s, voice: !s.voice }))}
            className="flex items-center gap-1 w-full text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium mb-1 hover:text-[var(--text-primary)] transition-colors"
          >
            <ChevronDown className={cn('w-3 h-3 transition-transform', !expandedSections.voice && '-rotate-90')} />
            Voice Rooms
          </button>

          {expandedSections.voice && (
            <div className="space-y-0.5">
              {voiceChannels.map((channel) => {
                const participants = voiceParticipants[channel.id] || [];
                const isActive = activeVoiceChannelId === channel.id;
                const isJoining = joiningChannelId === channel.id;
                return (
                  <div key={channel.id}>
                    <button
                      onClick={() => void handleVoiceChannelClick(channel.id)}
                      disabled={isJoining}
                      className={cn(
                        'flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm transition-all duration-120',
                        isActive
                          ? 'bg-[var(--online)]/10 text-[var(--online)] border-l-2 border-[var(--online)]'
                          : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
                        isJoining && 'opacity-50 cursor-wait'
                      )}
                    >
                      <Volume2 className="w-4 h-4 flex-shrink-0" />
                      <span className="truncate flex-1 text-left">{channel.name}</span>
                      {isActive && (
                        <PhoneOff className="w-3 h-3 shrink-0 opacity-70" />
                      )}
                    </button>
                    {participants.length > 0 && (
                      <div className="ml-6 mt-1 space-y-1">
                        {participants.map((participant) => (
                          <div
                            key={participant.userId}
                            className="flex items-center gap-2 px-2 py-1 text-xs text-[var(--text-muted)]"
                          >
                            <UserAvatar user={participant.user} size="xs" />
                            <span className={cn('truncate', participant.isSpeaking && 'text-[var(--online)]')}>
                              {participant.user?.username ?? participant.userId}
                            </span>
                            {participant.isMuted && (
                              <MicOff className="w-3 h-3 text-[var(--destructive)]" />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
