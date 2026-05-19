'use client';

import { X, Menu, Users } from 'lucide-react';
import { useGroupStore } from '@/lib/store/group-store';
import { cn } from '@/lib/utils';

interface TopBarProps {
  onOpenLeft?: () => void;
  onOpenRight?: () => void;
}

export function TopBar({ onOpenLeft, onOpenRight }: TopBarProps) {
  const { groups, openTabs, activeGroupId, setActiveGroup, closeTab, openTab } = useGroupStore();

  const openGroups = groups.filter(g => openTabs.includes(g.id));

  return (
    <div className="h-10 bg-[var(--bg-surface)] border-b border-[var(--border)] flex items-center px-2 gap-1">
      {onOpenLeft && (
        <button
          onClick={onOpenLeft}
          className="p-1.5 hover:bg-[var(--bg-hover)] rounded transition-colors shrink-0"
          aria-label="Open channels"
        >
          <Menu className="w-4 h-4 text-[var(--text-muted)]" />
        </button>
      )}

      {/* Group tabs */}
      <div className="flex items-center gap-1 flex-1 overflow-x-auto">
        {openGroups.map((group) => (
          <button
            key={group.id}
            onClick={() => setActiveGroup(group.id)}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-120',
              'hover:bg-[var(--bg-hover)]',
              activeGroupId === group.id
                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border)]'
                : 'text-[var(--text-muted)]'
            )}
          >
            <span className="text-[var(--text-muted)]">@</span>
            <span className="max-w-[100px] truncate">{group.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(group.id);
              }}
              className="hover:text-[var(--text-primary)] p-0.5 rounded"
            >
              <X className="w-3 h-3" />
            </button>
          </button>
        ))}
      </div>

      {/* Add group tabs from available groups not in tabs */}
      {groups.filter(g => !openTabs.includes(g.id)).length > 0 && (
        <div className="flex items-center gap-1 border-l border-[var(--border)] pl-2 ml-1">
          {groups.filter(g => !openTabs.includes(g.id)).slice(0, 2).map((group) => (
            <button
              key={group.id}
              onClick={() => {
                openTab(group.id);
                setActiveGroup(group.id);
              }}
              className="px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
            >
              + {group.name}
            </button>
          ))}
        </div>
      )}

      {!onOpenLeft && (
        <div className="flex items-center gap-1 ml-auto pl-4">
          <div className="text-xs text-[var(--text-muted)] font-mono">
            {'~/blok'}
            <span className="cursor-blink inline-block w-2 h-4 bg-[var(--text-primary)] ml-1" />
          </div>
        </div>
      )}

      {onOpenRight && (
        <button
          onClick={onOpenRight}
          className="p-1.5 hover:bg-[var(--bg-hover)] rounded transition-colors shrink-0"
          aria-label="Open friends"
        >
          <Users className="w-4 h-4 text-[var(--text-muted)]" />
        </button>
      )}
    </div>
  );
}
