import { useState } from "react";
import { MessageCircle, ChevronDown, Search, UserPlus, Check, X } from "lucide-react";
import { useServerStore } from "@/lib/store/server-store";
import { useFriendsStore, effectiveStatus } from "@/lib/store/friends-store";
import { useDMStore } from "@/lib/store/dm-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { UserAvatar } from "./user-avatar";
import { PresenceDot } from "./presence-dot";
import { AddFriendModal } from "./add-friend-modal";
import { cn } from "@/lib/utils";
import type { ServerMember } from "@/lib/store/types";

type Tab = "members" | "friends";

// ─── Tab button ───────────────────────────────────────────────────────────────

function TabBtn({ label, active, count, onClick }: { label: string; active?: boolean; count?: number; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors rounded-t-md",
        active
          ? "text-[var(--text-primary)] bg-[var(--bg-elevated)]"
          : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]/50",
      )}
    >
      {active && <span className="text-[var(--accent-red)]">$</span>}
      {label}
      {count !== undefined && (
        <span className={cn(
          "px-1 py-0.5 rounded text-[9px] leading-none",
          active ? "bg-[var(--accent-red)]/20 text-[var(--accent-red)]" : "bg-[var(--bg-hover)] text-[var(--text-muted)]",
        )}>
          {count}
        </span>
      )}
      {active && (
        <span className="absolute bottom-0 left-0 right-0 h-px bg-[var(--accent-red)]" />
      )}
    </button>
  );
}

// ─── Members view ─────────────────────────────────────────────────────────────

function MembersView() {
  const { activeServerId, members, voiceParticipants } = useServerStore();
  const { presence, presenceLastSeen } = useFriendsStore();
  const { openDM } = useDMStore();
  const { user } = useAuthStore();
  const [search, setSearch] = useState("");
  const [onlineOpen, setOnlineOpen] = useState(true);
  const [offlineOpen, setOfflineOpen] = useState(true);

  const serverMembers: ServerMember[] = activeServerId ? (members[activeServerId] ?? []) : [];
  const query = search.toLowerCase().trim();

  const filtered = serverMembers.filter((m) => {
    if (!query) return true;
    return (
      (m.user?.username ?? "").toLowerCase().includes(query) ||
      (m.user?.displayName ?? "").toLowerCase().includes(query) ||
      (m.nickname ?? "").toLowerCase().includes(query)
    );
  });

  const online = filtered.filter((m) => {
    const s = effectiveStatus(presence[m.userId], presenceLastSeen[m.userId]);
    return s === "online" || s === "afk" || s === "dnd";
  });
  const offline = filtered.filter((m) => effectiveStatus(presence[m.userId], presenceLastSeen[m.userId]) === "offline");

  const inVoice = new Set(
    Object.values(voiceParticipants).flat().map((p) => p.userId),
  );

  const MemberRow = ({ m }: { m: ServerMember }) => {
    const status = effectiveStatus(presence[m.userId], presenceLastSeen[m.userId]);
    const isMe = m.userId === user?.id;
    const name = m.nickname ?? m.user?.displayName ?? m.user?.username ?? m.userId.slice(0, 8);

    return (
      <button
        onClick={() => { if (user && !isMe) openDM(user.id, m.userId); }}
        disabled={isMe}
        className={cn(
          "flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-left transition-all",
          !isMe && "hover:bg-[var(--bg-hover)] group cursor-pointer",
          isMe && "cursor-default",
        )}
      >
        <div className="relative flex-shrink-0">
          <UserAvatar user={m.user} size="sm" />
          <PresenceDot status={status} size="sm" className="absolute -bottom-0.5 -right-0.5 ring-2 ring-[var(--bg-surface)]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-[var(--text-primary)] truncate">
            @{name}
            {isMe && <span className="ml-1 text-[var(--text-muted)] font-normal opacity-50">you</span>}
          </p>
          {m.user?.pronouns && (
            <p className="text-[10px] text-[var(--text-muted)] truncate opacity-60">{m.user.pronouns}</p>
          )}
          {inVoice.has(m.userId) && (
            <p className="text-[10px] text-[var(--online)]">in voice</p>
          )}
        </div>
        {!isMe && (
          <MessageCircle className="w-3 h-3 text-[var(--text-muted)] opacity-0 group-hover:opacity-70 transition-opacity flex-shrink-0" />
        )}
      </button>
    );
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
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
        {online.length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setOnlineOpen((v) => !v)}
              className="flex items-center gap-1 w-full px-1 py-1 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium hover:text-[var(--text-primary)] transition-colors"
            >
              <ChevronDown className={cn("w-3 h-3 transition-transform", !onlineOpen && "-rotate-90")} />
              Online — {online.length}
            </button>
            {onlineOpen && <div className="space-y-0.5 mt-0.5">{online.map((m) => <MemberRow key={m.userId} m={m} />)}</div>}
          </div>
        )}

        {offline.length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setOfflineOpen((v) => !v)}
              className="flex items-center gap-1 w-full px-1 py-1 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium hover:text-[var(--text-primary)] transition-colors"
            >
              <ChevronDown className={cn("w-3 h-3 transition-transform", !offlineOpen && "-rotate-90")} />
              Offline — {offline.length}
            </button>
            {offlineOpen && <div className="space-y-0.5 mt-0.5">{offline.map((m) => <MemberRow key={m.userId} m={m} />)}</div>}
          </div>
        )}

        {filtered.length === 0 && (
          <p className="py-6 text-center text-xs text-[var(--text-muted)]">No members found</p>
        )}
      </div>
    </div>
  );
}

// ─── Friends view ─────────────────────────────────────────────────────────────

function FriendsView() {
  const { user } = useAuthStore();
  const { friends, pendingRequests, outgoingRequests, presence, presenceLastSeen, acceptRequest, declineRequest, cancelRequest, loadError } = useFriendsStore();
  const { openDM } = useDMStore();
  const [search, setSearch] = useState("");
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [outgoingOpen, setOutgoingOpen] = useState(true);
  const [incomingOpen, setIncomingOpen] = useState(true);

  const query = search.toLowerCase().trim();

  const friendsWithMeta = friends.map((f) => {
    if (!user) return null;
    const isRequester = f.requesterId === user.id;
    return { ...f, friendId: isRequester ? f.targetId : f.requesterId, friendUser: isRequester ? f.targetUser : f.requesterUser };
  }).filter((f): f is NonNullable<typeof f> => !!f);

  const filtered = friendsWithMeta.filter((f) =>
    !query ||
    f.friendUser?.username?.toLowerCase().includes(query) ||
    f.friendUser?.displayName?.toLowerCase().includes(query),
  );

  const sorted = [...filtered].sort((a, b) => {
    const order = { online: 0, afk: 1, dnd: 2, offline: 3 } as const;
    const sA = effectiveStatus(presence[a.friendId], presenceLastSeen[a.friendId]);
    const sB = effectiveStatus(presence[b.friendId], presenceLastSeen[b.friendId]);
    return order[sA] - order[sB];
  });

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="p-2 border-b border-[var(--border)]">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="search friends"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg pl-7 pr-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-muted)] transition-colors"
          />
        </div>
      </div>

      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium">
          Friends — {friends.length}
        </span>
        <button onClick={() => setShowAddFriend(true)} className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors" title="Add friend">
          <UserPlus className="w-3.5 h-3.5 text-[var(--text-muted)]" />
        </button>
      </div>

      <AddFriendModal isOpen={showAddFriend} onClose={() => setShowAddFriend(false)} />

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {loadError && (
          <div className="p-2 rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 text-[var(--destructive)] text-xs">{loadError}</div>
        )}

        {outgoingRequests.length > 0 && (
          <div>
            <button onClick={() => setOutgoingOpen((v) => !v)} className="flex items-center gap-1 w-full px-1 py-1.5 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium hover:text-[var(--text-primary)] transition-colors">
              <ChevronDown className={cn("w-3 h-3 transition-transform", !outgoingOpen && "-rotate-90")} />
              Outgoing — {outgoingRequests.length}
            </button>
            {outgoingOpen && (
              <div className="space-y-1">
                {outgoingRequests.map((req) => (
                  <div key={req.id} className="p-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)]">
                    <div className="flex items-center gap-2">
                      <UserAvatar user={req.targetUser} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[var(--text-primary)] truncate font-medium">@{req.targetUser?.username ?? "unknown"}</p>
                        <p className="text-xs text-[var(--text-muted)] truncate">pending</p>
                      </div>
                      <button onClick={() => cancelRequest(req.id)} className="p-1 hover:bg-[var(--destructive)]/20 rounded text-[var(--text-muted)] hover:text-[var(--destructive)] transition-colors flex-shrink-0">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {pendingRequests.length > 0 && (
          <div>
            <button onClick={() => setIncomingOpen((v) => !v)} className="flex items-center gap-1 w-full px-1 py-1.5 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium hover:text-[var(--text-primary)] transition-colors">
              <ChevronDown className={cn("w-3 h-3 transition-transform", !incomingOpen && "-rotate-90")} />
              <span className="text-[var(--online)]">Incoming — {pendingRequests.length}</span>
            </button>
            {incomingOpen && (
              <div className="space-y-1">
                {pendingRequests.map((req) => (
                  <div key={req.id} className="p-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)]">
                    <div className="flex items-center gap-2">
                      <UserAvatar user={req.requesterUser} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[var(--text-primary)] truncate font-medium">@{req.requesterUser?.username ?? "unknown"}</p>
                        <p className="text-xs text-[var(--text-muted)] truncate">wants to add you</p>
                      </div>
                    </div>
                    <div className="mt-1.5 flex gap-1">
                      <button onClick={() => acceptRequest(req.id)} className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded text-xs bg-[var(--online)]/20 text-[var(--online)] hover:bg-[var(--online)]/30 transition-colors">
                        <Check className="w-3 h-3" /> Accept
                      </button>
                      <button onClick={() => declineRequest(req.id)} className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded text-xs bg-[var(--destructive)]/20 text-[var(--destructive)] hover:bg-[var(--destructive)]/30 transition-colors">
                        <X className="w-3 h-3" /> Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="space-y-0.5">
          {sorted.map((f) => (
            <button
              key={f.id}
              onClick={() => user && openDM(user.id, f.friendId)}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-left transition-all hover:bg-[var(--bg-hover)] group"
            >
              <div className="relative flex-shrink-0">
                <UserAvatar user={f.friendUser} size="sm" />
                <PresenceDot status={effectiveStatus(presence[f.friendId], presenceLastSeen[f.friendId])} size="sm" className="absolute -bottom-0.5 -right-0.5 ring-2 ring-[var(--bg-surface)]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[var(--text-primary)] truncate font-medium">@{f.friendUser?.username ?? "unknown"}</p>
                {f.friendUser?.pronouns && (
                  <p className="text-xs text-[var(--text-muted)] truncate opacity-60">{f.friendUser.pronouns}</p>
                )}
              </div>
              <MessageCircle className="w-3 h-3 text-[var(--text-muted)] opacity-0 group-hover:opacity-70 transition-opacity flex-shrink-0" />
            </button>
          ))}
          {sorted.length === 0 && !query && <p className="py-6 text-center text-xs text-[var(--text-muted)]">No friends yet</p>}
          {sorted.length === 0 && query && <p className="py-4 text-center text-xs text-[var(--text-muted)]">No results</p>}
        </div>
      </div>
    </div>
  );
}

// ─── Unified sidebar ──────────────────────────────────────────────────────────

export function RightSidebar() {
  const { activeServerId, members } = useServerStore();
  const memberCount = activeServerId ? (members[activeServerId]?.length ?? 0) : 0;
  const [tab, setTab] = useState<Tab>("members");

  const activeTab = activeServerId ? tab : "friends";

  return (
    <div className="w-52 bg-[var(--bg-surface)] border-l border-[var(--border)] flex flex-col flex-shrink-0">
      {/* Tab header */}
      <div className="px-2 pt-2 pb-0 border-b border-[var(--border)]">
        <div className="flex items-center gap-1 w-full">
          {activeServerId ? (
            <>
              <TabBtn label="members" count={memberCount} active={activeTab === "members"} onClick={() => setTab("members")} />
              <TabBtn label="friends" active={activeTab === "friends"} onClick={() => setTab("friends")} />
            </>
          ) : (
            <TabBtn label="friends" active />
          )}
        </div>
      </div>

      {activeTab === "members" ? <MembersView /> : <FriendsView />}
    </div>
  );
}
