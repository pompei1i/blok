import { useFriendsStore, effectiveStatus } from "@/lib/store/friends-store";
import { useDMStore } from "@/lib/store/dm-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { PresenceDot } from "./presence-dot";
import { UserAvatar } from "./user-avatar";
import { AddFriendModal } from "./add-friend-modal";
import { cn } from "@/lib/utils";
import { Search, UserPlus, Check, X, MessageCircle, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";

function formatLastSeen(iso: string | undefined): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

export function FriendsSidebar() {
  const { t } = useI18n();
  const { user } = useAuthStore();
  const {
    friends,
    pendingRequests,
    outgoingRequests,
    presence,
    presenceLastSeen,
    acceptRequest,
    declineRequest,
    cancelRequest,
    loadError,
  } = useFriendsStore();
  const { openDM } = useDMStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [outgoingOpen, setOutgoingOpen] = useState(true);
  const [incomingOpen, setIncomingOpen] = useState(true);

  const normalizedQuery = searchQuery.toLowerCase().trim();

  const friendsWithMeta = friends
    .map((f) => {
      if (!user) return null;
      const isRequester = f.requesterId === user.id;
      const friendId = isRequester ? f.targetId : f.requesterId;
      const friendUser = isRequester ? f.targetUser : f.requesterUser;
      return { ...f, friendId, friendUser };
    })
    .filter((f): f is NonNullable<typeof f> => !!f);

  const filteredFriends = friendsWithMeta.filter((f) => {
    if (!normalizedQuery) return true;
    return (
      f.friendUser?.username?.toLowerCase().includes(normalizedQuery) ||
      f.friendUser?.displayName?.toLowerCase().includes(normalizedQuery)
    );
  });

  const sortedFriends = [...filteredFriends].sort((a, b) => {
    const statusOrder = { online: 0, afk: 1, dnd: 2, offline: 3 } as const;
    const statusA = effectiveStatus(presence[a.friendId], presenceLastSeen[a.friendId]);
    const statusB = effectiveStatus(presence[b.friendId], presenceLastSeen[b.friendId]);
    return statusOrder[statusA] - statusOrder[statusB];
  });

  const handleFriendClick = (friendId: string) => {
    if (user) openDM(user.id, friendId);
  };

  return (
    <div className="w-52 bg-[var(--bg-surface)] border-l border-[var(--border)] flex flex-col flex-shrink-0">
      {/* Current user */}
      <div className="p-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <UserAvatar user={user} size="md" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)] truncate">
              @{user?.username}
            </p>
            <div className="flex items-center gap-1">
              <PresenceDot status={effectiveStatus(presence[user?.id ?? ""], presenceLastSeen[user?.id ?? ""])} size="sm" />
              <span className="text-xs text-[var(--text-muted)]">{t("friends.online")}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="p-2 border-b border-[var(--border)]">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder={t("friends.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg pl-7 pr-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-muted)] transition-colors"
          />
        </div>
      </div>

      {/* Friends header */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium">
          {t("friends.friends")} — {friends.length}
        </span>
        <button
          onClick={() => setShowAddFriend(true)}
          className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors"
          aria-label={t("friends.addFriend")}
        >
          <UserPlus className="w-3.5 h-3.5 text-[var(--text-muted)]" />
        </button>
      </div>

      <AddFriendModal isOpen={showAddFriend} onClose={() => setShowAddFriend(false)} />

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {loadError && (
          <div className="p-2 rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 text-[var(--accent-red-text)] text-xs">
            {loadError}
          </div>
        )}

        {/* Outgoing requests — only shown when there are some */}
        {outgoingRequests.length > 0 && (
          <div>
            <button
              onClick={() => setOutgoingOpen((v) => !v)}
              className="flex items-center gap-1 w-full px-1 py-1.5 text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium hover:text-[var(--text-primary)] transition-colors"
            >
              <ChevronDown className={cn("w-3 h-3 transition-transform", !outgoingOpen && "-rotate-90")} />
              Outgoing — {outgoingRequests.length}
            </button>
            {outgoingOpen && (
              <div className="space-y-1">
                {outgoingRequests.map((request) => {
                  const targetUser = request.targetUser;
                  return (
                    <div
                      key={request.id}
                      className="p-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)]"
                    >
                      <div className="flex items-center gap-2">
                        <UserAvatar user={targetUser} size="sm" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-[var(--text-primary)] truncate font-medium">
                            @{targetUser?.username ?? "unknown"}
                          </p>
                          <p className="text-xs text-[var(--text-muted)] truncate">pending</p>
                        </div>
                        <button
                          onClick={() => cancelRequest(request.id)}
                          className="p-1 hover:bg-[var(--destructive)]/20 rounded text-[var(--text-muted)] hover:text-[var(--accent-red-text)] transition-colors flex-shrink-0"
                          aria-label="Cancel request"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Incoming requests — only shown when there are some */}
        {pendingRequests.length > 0 && (
          <div>
            <button
              onClick={() => setIncomingOpen((v) => !v)}
              className="flex items-center gap-1 w-full px-1 py-1.5 text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium hover:text-[var(--text-primary)] transition-colors"
            >
              <ChevronDown className={cn("w-3 h-3 transition-transform", !incomingOpen && "-rotate-90")} />
              <span className="text-[var(--online-text)]">Incoming — {pendingRequests.length}</span>
            </button>
            {incomingOpen && (
              <div className="space-y-1">
                {pendingRequests.map((request) => {
                  const requestUser = request.requesterUser;
                  return (
                    <div
                      key={request.id}
                      className="p-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)]"
                    >
                      <div className="flex items-center gap-2">
                        <UserAvatar user={requestUser} size="sm" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-[var(--text-primary)] truncate font-medium">
                            @{requestUser?.username ?? "unknown"}
                          </p>
                          <p className="text-xs text-[var(--text-muted)] truncate">wants to add you</p>
                        </div>
                      </div>
                      <div className="mt-1.5 flex gap-1">
                        <button
                          onClick={() => acceptRequest(request.id)}
                          className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded text-xs bg-[var(--online)]/20 text-[var(--online-text)] hover:bg-[var(--online)]/30 transition-colors"
                        >
                          <Check className="w-3 h-3" />
                          Accept
                        </button>
                        <button
                          onClick={() => declineRequest(request.id)}
                          className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded text-xs bg-[var(--destructive)]/20 text-[var(--accent-red-text)] hover:bg-[var(--destructive)]/30 transition-colors"
                        >
                          <X className="w-3 h-3" />
                          Decline
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Friends list */}
        <div className="space-y-0.5">
          {sortedFriends.map((friendship) => {
            const status = effectiveStatus(presence[friendship.friendId], presenceLastSeen[friendship.friendId]);
            return (
              <button
                key={friendship.id}
                onClick={() => handleFriendClick(friendship.friendId)}
                className={cn(
                  "flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-left transition-all duration-120",
                  "hover:bg-[var(--bg-hover)] group",
                )}
              >
                <div className="relative flex-shrink-0">
                  <UserAvatar user={friendship.friendUser} size="sm" />
                  <PresenceDot
                    status={status}
                    size="sm"
                    className="absolute -bottom-0.5 -right-0.5 ring-2 ring-[var(--bg-surface)]"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[var(--text-primary)] truncate font-medium">
                    @{friendship.friendUser?.username ?? "unknown"}
                  </p>
                  {status === "offline" ? (
                    <p className="text-xs text-[var(--text-muted)] truncate opacity-60">
                      {formatLastSeen(presenceLastSeen[friendship.friendId])}
                    </p>
                  ) : friendship.friendUser?.pronouns ? (
                    <p className="text-xs text-[var(--text-muted)] truncate opacity-60">
                      {friendship.friendUser.pronouns}
                    </p>
                  ) : null}
                </div>
                <MessageCircle className="w-3 h-3 text-[var(--text-muted)] opacity-0 group-hover:opacity-70 transition-opacity flex-shrink-0" />
              </button>
            );
          })}
          {sortedFriends.length === 0 && !normalizedQuery && (
            <div className="py-6 text-center text-xs text-[var(--text-muted)]">
              No friends yet
            </div>
          )}
          {sortedFriends.length === 0 && normalizedQuery && (
            <div className="py-4 text-center text-xs text-[var(--text-muted)]">
              No results
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
