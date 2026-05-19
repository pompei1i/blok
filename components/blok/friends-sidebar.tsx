'use client';

import { useFriendsStore } from '@/lib/store/friends-store';
import { useDMStore } from '@/lib/store/dm-store';
import { useAuthStore } from '@/lib/store/auth-store';
import { PresenceDot } from './presence-dot';
import { UserAvatar } from './user-avatar';
import { AddFriendModal } from './add-friend-modal';
import { cn } from '@/lib/utils';
import { Search, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';

interface FriendsSidebarProps {
  onDrawerClose?: () => void;
}

export function FriendsSidebar({ onDrawerClose }: FriendsSidebarProps) {
  const { t } = useI18n();
  const { user } = useAuthStore();
  const { friends, presence } = useFriendsStore();
  const { openDM } = useDMStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddFriend, setShowAddFriend] = useState(false);

  const filteredFriends = friends.filter(f => 
    f.friend?.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.friend?.displayName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Sort: online first, then afk, then offline
  const sortedFriends = [...filteredFriends].sort((a, b) => {
    const statusOrder = { online: 0, afk: 1, offline: 2 };
    const statusA = presence[a.friendId] || 'offline';
    const statusB = presence[b.friendId] || 'offline';
    return statusOrder[statusA] - statusOrder[statusB];
  });

  const handleFriendClick = (friendId: string) => {
    openDM(friendId);
  };

  return (
    <div className="w-56 bg-[var(--bg-surface)] border-l border-[var(--border)] flex flex-col">
      {/* User profile header */}
      <div className="p-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <UserAvatar user={user} size="md" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)] truncate">
              @{user?.username}
            </p>
            <div className="flex items-center gap-1">
              <PresenceDot status="online" size="sm" />
              <span className="text-xs text-[var(--text-muted)]">{t("friends.online")}</span>
            </div>
          </div>
          {onDrawerClose && (
            <button onClick={onDrawerClose} className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors">
              <X className="w-4 h-4 text-[var(--text-muted)]" />
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="p-2 border-b border-[var(--border)]">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder={t("friends.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg pl-8 pr-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-muted)] transition-colors"
          />
        </div>
      </div>

      {/* Friends list header */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium">
          {t("friends.friends")} — {friends.length}
        </span>
        <button 
          onClick={() => setShowAddFriend(true)}
          className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors"
          title={t("friends.addFriend")}
        >
          <UserPlus className="w-4 h-4 text-[var(--text-muted)]" />
        </button>
      </div>

      {/* Add Friend Modal */}
      <AddFriendModal 
        isOpen={showAddFriend} 
        onClose={() => setShowAddFriend(false)} 
      />

      {/* Friends list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="space-y-0.5">
          {sortedFriends.map((friendship) => {
            const status = presence[friendship.friendId] || 'offline';
            return (
              <button
                key={friendship.id}
                onClick={() => handleFriendClick(friendship.friendId)}
                className={cn(
                  'flex items-center gap-2 w-full px-2 py-2 rounded-lg text-left transition-all duration-120',
                  'hover:bg-[var(--bg-hover)] group'
                )}
              >
                <div className="relative">
                  <UserAvatar user={friendship.friend} size="sm" />
                  <PresenceDot 
                    status={status} 
                    size="sm" 
                    className="absolute -bottom-0.5 -right-0.5 ring-2 ring-[var(--bg-surface)]"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--text-primary)] truncate">
                    @{friendship.friend?.username}
                  </p>
                  {friendship.friend?.pronouns && (
                    <p className="text-xs text-[var(--text-muted)] truncate opacity-60">
                      {friendship.friend.pronouns}
                    </p>
                  )}
                  {!friendship.friend?.pronouns && friendship.friend?.statusMessage && (
                    <p className="text-xs text-[var(--text-muted)] truncate">
                      {friendship.friend.statusMessage}
                    </p>
                  )}
                </div>
                <span className={cn(
                  'text-xs capitalize',
                  status === 'online' && 'text-[var(--online)]',
                  status === 'afk' && 'text-[var(--afk)]',
                  status === 'offline' && 'text-[var(--text-muted)]'
                )}>
                  {status === 'online' ? '●' : status === 'afk' ? '◐' : '○'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
