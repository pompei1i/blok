import { useEffect, useRef } from "react";
import { UserAvatar } from "./user-avatar";
import { PresenceDot } from "./presence-dot";
import { useFriendsStore, effectiveStatus } from "@/lib/store/friends-store";
import { cn } from "@/lib/utils";
import type { User } from "@/lib/store/types";

interface AtMentionDropdownProps {
  query: string;
  members: User[];
  activeIndex: number;
  onSelect: (username: string) => void;
}

export function AtMentionDropdown({ query, members, activeIndex, onSelect }: AtMentionDropdownProps) {
  const { presence, presenceLastSeen } = useFriendsStore();
  const activeRef = useRef<HTMLButtonElement>(null);

  const filtered = members
    .filter((u) =>
      u.username.toLowerCase().includes(query.toLowerCase()) ||
      (u.displayName ?? "").toLowerCase().includes(query.toLowerCase())
    )
    .slice(0, 8);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (filtered.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 mb-1 w-64 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg shadow-xl overflow-hidden z-50">
      <p className="px-3 py-1.5 text-[12px] text-[var(--text-muted)] font-mono uppercase tracking-wider border-b border-[var(--border)]">
        members
      </p>
      <div className="max-h-48 overflow-y-auto py-1">
        {filtered.map((user, i) => {
          const status = effectiveStatus(presence[user.id], presenceLastSeen[user.id]);
          const isActive = i === activeIndex % filtered.length;
          return (
            <button
              key={user.id}
              ref={isActive ? activeRef : null}
              onMouseDown={(e) => { e.preventDefault(); onSelect(user.username); }}
              className={cn(
                "flex items-center gap-2 w-full px-3 py-1.5 transition-colors text-left",
                isActive ? "bg-[var(--bg-hover)]" : "hover:bg-[var(--bg-hover)]",
              )}
            >
              <div className="relative flex-shrink-0">
                <UserAvatar user={user} size="sm" />
                <PresenceDot status={status} size="sm" className="absolute -bottom-0.5 -right-0.5 ring-2 ring-[var(--bg-elevated)]" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-[var(--text-primary)] truncate">@{user.username}</p>
                {user.displayName && user.displayName !== user.username && (
                  <p className="text-xs text-[var(--text-muted)] truncate">{user.displayName}</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
