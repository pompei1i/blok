import { useState } from "react";
import { MessageCircle, ChevronDown, Search } from "lucide-react";
import { useServerStore } from "@/lib/store/server-store";
import { useShallow } from "zustand/react/shallow";
import { useFriendsStore, effectiveStatus } from "@/lib/store/friends-store";
import { useDMStore } from "@/lib/store/dm-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { UserAvatar } from "./user-avatar";
import { PresenceDot } from "./presence-dot";
import { cn } from "@/lib/utils";
import { xpToLevel, levelColor } from "@/lib/levels";
import type { ServerMember } from "@/lib/store/types";

export function MembersSidebar() {
  const { activeServerId, members, voiceParticipants } = useServerStore(
    useShallow((s) => ({ activeServerId: s.activeServerId, members: s.members, voiceParticipants: s.voiceParticipants })),
  );
  const { presence, presenceLastSeen, activity } = useFriendsStore();
  const { openDM } = useDMStore();
  const { user } = useAuthStore();
  const [search, setSearch] = useState("");
  const [onlineOpen, setOnlineOpen] = useState(true);
  const [offlineOpen, setOfflineOpen] = useState(true);

  const serverMembers: ServerMember[] = activeServerId ? (members[activeServerId] ?? []) : [];

  const query = search.toLowerCase().trim();
  const filtered = serverMembers.filter((m) => {
    if (!query) return true;
    const name = (m.user?.username ?? "").toLowerCase();
    const display = (m.user?.displayName ?? "").toLowerCase();
    const nick = (m.nickname ?? "").toLowerCase();
    return name.includes(query) || display.includes(query) || nick.includes(query);
  });

  const online = filtered.filter((m) => {
    const s = effectiveStatus(presence[m.userId], presenceLastSeen[m.userId]);
    return s === "online" || s === "afk" || s === "dnd";
  });
  const offline = filtered.filter((m) => effectiveStatus(presence[m.userId], presenceLastSeen[m.userId]) === "offline");

  // Collect all userIds currently in any voice channel on this server
  const inVoice = new Set(
    Object.values(voiceParticipants)
      .flat()
      .map((p) => p.userId),
  );

  const handleClick = (memberId: string) => {
    if (user && memberId !== user.id) openDM(user.id, memberId);
  };

  const MemberRow = ({ m }: { m: ServerMember }) => {
    const status = effectiveStatus(presence[m.userId], presenceLastSeen[m.userId]);
    const isMe = m.userId === user?.id;
    const inCall = inVoice.has(m.userId);
    const displayName = m.nickname ?? m.user?.displayName ?? m.user?.username ?? m.userId.slice(0, 8);

    const level = xpToLevel(m.xp);
    const color = levelColor(level);

    return (
      <button
        key={m.userId}
        onClick={() => handleClick(m.userId)}
        disabled={isMe}
        className={cn(
          "flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-left transition-all",
          !isMe && "hover:bg-[var(--bg-hover)] group cursor-pointer",
          isMe && "cursor-default",
        )}
      >
        <div className="relative flex-shrink-0">
          <UserAvatar user={m.user} size="sm" />
          <PresenceDot
            status={status}
            size="sm"
            className="absolute -bottom-0.5 -right-0.5 ring-2 ring-[var(--bg-surface)]"
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-xs font-medium text-[var(--text-primary)] truncate">
              @{displayName}
              {isMe && <span className="ml-1 text-[var(--text-muted)] font-normal opacity-60">you</span>}
            </p>
            <span
              className="text-[11px] font-bold flex-shrink-0 px-1 rounded"
              style={{ color, border: `1px solid ${color}44` }}
            >
              {level}
            </span>
          </div>
          {activity[m.userId] && (
            <p className="text-[12px] text-[var(--text-muted)] truncate opacity-70">{activity[m.userId]}</p>
          )}
          {!activity[m.userId] && m.user?.pronouns && (
            <p className="text-[12px] text-[var(--text-muted)] truncate opacity-60">
              {m.user.pronouns}
            </p>
          )}
          {inCall && (
            <p className="text-[12px] text-[var(--online-text)] truncate">in voice</p>
          )}
        </div>
        {!isMe && (
          <MessageCircle className="w-3 h-3 text-[var(--text-muted)] opacity-0 group-hover:opacity-70 transition-opacity flex-shrink-0" />
        )}
      </button>
    );
  };

  return (
    <div className="w-52 bg-[var(--bg-surface)] border-l border-[var(--border)] flex flex-col flex-shrink-0">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--border)]">
        <span className="text-[12px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
          <span className="text-[var(--accent-red)]">$</span> members — {serverMembers.length}
        </span>
      </div>

      {/* Search */}
      <div className="p-2 border-b border-[var(--border)]">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="search members"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg pl-7 pr-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-muted)] transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {/* Online */}
        {online.length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setOnlineOpen((v) => !v)}
              className="flex items-center gap-1 w-full px-1 py-1 text-[12px] text-[var(--text-muted)] uppercase tracking-wider font-medium hover:text-[var(--text-primary)] transition-colors"
            >
              <ChevronDown className={cn("w-3 h-3 transition-transform", !onlineOpen && "-rotate-90")} />
              Online — {online.length}
            </button>
            {onlineOpen && (
              <div className="space-y-0.5 mt-0.5">
                {online.map((m) => <MemberRow key={m.userId} m={m} />)}
              </div>
            )}
          </div>
        )}

        {/* Offline */}
        {offline.length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setOfflineOpen((v) => !v)}
              className="flex items-center gap-1 w-full px-1 py-1 text-[12px] text-[var(--text-muted)] uppercase tracking-wider font-medium hover:text-[var(--text-primary)] transition-colors"
            >
              <ChevronDown className={cn("w-3 h-3 transition-transform", !offlineOpen && "-rotate-90")} />
              Offline — {offline.length}
            </button>
            {offlineOpen && (
              <div className="space-y-0.5 mt-0.5">
                {offline.map((m) => <MemberRow key={m.userId} m={m} />)}
              </div>
            )}
          </div>
        )}

        {filtered.length === 0 && (
          <p className="py-6 text-center text-xs text-[var(--text-muted)]">No members found</p>
        )}
      </div>
    </div>
  );
}
