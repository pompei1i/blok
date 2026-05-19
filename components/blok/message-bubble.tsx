'use client';

import { cn } from '@/lib/utils';
import { UserAvatar } from './user-avatar';
import type { Message, DirectMessage, User } from '@/lib/store/types';
import { useState } from 'react';
import { MoreHorizontal, Edit2, Trash2, Copy } from 'lucide-react';

interface MessageBubbleProps {
  message: Message | DirectMessage | { id: string; content: string; createdAt: string; editedAt?: string };
  user?: User | null;
  isOwn?: boolean;
  showAvatar?: boolean;
  isDM?: boolean;
}

export function MessageBubble({ message, user, isOwn, showAvatar = true, isDM }: MessageBubbleProps) {
  const [showTimestamp, setShowTimestamp] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatContent = (content: string) => {
    // Simple markdown-lite parsing
    return content
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code class="bg-[var(--bg-elevated)] px-1 rounded text-sm">$1</code>')
      .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" class="text-[var(--accent-red)] hover:underline" target="_blank" rel="noopener">$1</a>');
  };

  if (isDM) {
    return (
      <div
        className={cn(
          'flex gap-2 max-w-[80%]',
          isOwn ? 'ml-auto flex-row-reverse' : ''
        )}
        onMouseEnter={() => setShowTimestamp(true)}
        onMouseLeave={() => setShowTimestamp(false)}
      >
        {showAvatar && !isOwn && <UserAvatar user={user} size="sm" />}
        <div
          className={cn(
            'px-3 py-2 rounded-lg text-sm',
            isOwn
              ? 'bg-[var(--accent-red)] text-white rounded-br-sm'
              : 'bg-[var(--bg-elevated)] text-[var(--text-primary)] rounded-bl-sm border border-[var(--border)]'
          )}
        >
          <p dangerouslySetInnerHTML={{ __html: formatContent(message.content) }} />
          {showTimestamp && (
            <span className="text-[10px] opacity-60 mt-1 block">
              {formatTime(message.createdAt)}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="group flex gap-3 px-4 py-1 hover:bg-[var(--bg-hover)]/50 transition-colors"
      onMouseEnter={() => setShowTimestamp(true)}
      onMouseLeave={() => { setShowTimestamp(false); setShowMenu(false); }}
    >
      {showAvatar ? (
        <UserAvatar user={user} size="md" />
      ) : (
        <div className="w-8 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        {showAvatar && (
          <div className="mb-0.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[var(--text-primary)]">
                @{user?.username || 'Unknown'}
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {formatTime(message.createdAt)}
              </span>
              {'editedAt' in message && message.editedAt && (
                <span className="text-xs text-[var(--text-muted)]">(edited)</span>
              )}
            </div>
            {user?.pronouns && (
              <span className="text-xs text-[var(--text-muted)] opacity-60">
                {user.pronouns}
              </span>
            )}
          </div>
        )}
        <p
          className="text-sm text-[var(--text-primary)] leading-relaxed"
          dangerouslySetInnerHTML={{ __html: formatContent(message.content) }}
        />
      </div>
      
      {/* Context menu */}
      <div className={cn(
        'flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity',
      )}>
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="p-1 hover:bg-[var(--bg-elevated)] rounded transition-colors"
        >
          <MoreHorizontal className="w-4 h-4 text-[var(--text-muted)]" />
        </button>
        
        {showMenu && (
          <div className="absolute right-12 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg shadow-lg py-1 z-10">
            {isOwn && (
              <>
                <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
                  <Edit2 className="w-3 h-3" /> Edit
                </button>
                <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--destructive)] hover:bg-[var(--bg-hover)] transition-colors">
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              </>
            )}
            <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
              <Copy className="w-3 h-3" /> Copy
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
