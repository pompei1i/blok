import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, ChevronDown, Search, UserPlus, UserMinus, Check, X, User, Phone, AtSign, Link2, UserX } from "lucide-react";
import { can } from "@/lib/permission";
import { FishHookIcon } from "./fish-hook-icon";
import { useI18n } from "@/lib/i18n";
import { useBaitStore } from "@/lib/store/bait-store";
import { useServerStore } from "@/lib/store/server-store";
import { useFriendsStore, effectiveStatus } from "@/lib/store/friends-store";
import { useDMStore } from "@/lib/store/dm-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { UserAvatar } from "./user-avatar";
import { PresenceDot } from "./presence-dot";
import { AddFriendModal } from "./add-friend-modal";
import { UserProfileModal } from "./user-profile-modal";
import { EconomyView } from "./economy-view";
import { cn } from "@/lib/utils";
import { xpToLevel, levelColor } from "@/lib/levels";
import { nameplateStyle } from "@/lib/economy";
import { useQuestsStore } from "@/lib/store/quests-store";
import { DAILY_QUESTS } from "@/lib/quests";
import type { ServerMember } from "@/lib/store/types";

type Tab = "members" | "friends" | "quests" | "shop";

// ─── Tab button ───────────────────────────────────────────────────────────────

function TabBtn({ label, active, count, onClick }: { label: string; active?: boolean; count?: number; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors",
        active
          ? "text-[var(--text-primary)] bg-[var(--bg-elevated)]"
          : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]/50",
      )}
    >
      {active && <span className="text-[var(--accent-red)]">$</span>}
      {label}
      {count !== undefined && (
        <span className={cn(
          "px-1 py-0.5 text-[9px] leading-none",
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
  const { activeServerId, members, channels, voiceParticipants, servers, roles, kickMember, generateInviteCode } = useServerStore();
  const { presence, presenceLastSeen, activity, friends, sendFriendRequest, removeFriend } = useFriendsStore();
  const { openDM, callUser } = useDMStore();
  const { user } = useAuthStore();
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [onlineOpen, setOnlineOpen] = useState(true);
  const [offlineOpen, setOfflineOpen] = useState(true);

  type MemberCtxMenu = { member: ServerMember; x: number; y: number };
  const [ctxMenu, setCtxMenu] = useState<MemberCtxMenu | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const [profileMember, setProfileMember] = useState<ServerMember | null>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node))
        setCtxMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [ctxMenu]);

  const activeServer = servers.find((s) => s.id === activeServerId) ?? null;
  const serverRoles = activeServerId ? (roles[activeServerId] ?? []) : [];
  const serverMembers: ServerMember[] = activeServerId ? (members[activeServerId] ?? []) : [];
  const query = search.toLowerCase().trim();

  // Presence helper — current user is always online (they're using the app)
  const getStatus = (userId: string) =>
    userId === user?.id
      ? ("online" as const)
      : effectiveStatus(presence[userId], presenceLastSeen[userId]);

  // "in voice" only for channels that belong to this server
  const serverVoiceIds = new Set(
    (activeServerId ? channels[activeServerId] ?? [] : [])
      .filter((c) => c.type === "voice")
      .map((c) => c.id),
  );
  const inVoice = new Set(
    Object.entries(voiceParticipants)
      .filter(([chId]) => serverVoiceIds.has(chId))
      .flatMap(([, ps]) => ps.map((p) => p.userId)),
  );

  const filtered = serverMembers.filter((m) => {
    if (!query) return true;
    return (
      (m.user?.username ?? "").toLowerCase().includes(query) ||
      (m.user?.displayName ?? "").toLowerCase().includes(query) ||
      (m.nickname ?? "").toLowerCase().includes(query)
    );
  });

  const online = filtered.filter((m) => {
    const s = getStatus(m.userId);
    return s === "online" || s === "afk" || s === "dnd";
  });
  const offline = filtered.filter((m) => getStatus(m.userId) === "offline");

  const MemberRow = ({ m }: { m: ServerMember }) => {
    const status = getStatus(m.userId);
    const isMe = m.userId === user?.id;
    const name = m.nickname ?? m.user?.displayName ?? m.user?.username ?? m.userId.slice(0, 8);

    return (
      <button
        onClick={() => { if (user && !isMe) openDM(user.id, m.userId); }}
        onContextMenu={isMe ? undefined : (e) => {
          e.preventDefault();
          const menuH = 260;
          const y = e.clientY + menuH > window.innerHeight ? e.clientY - menuH : e.clientY;
          setCtxMenu({ member: m, x: Math.min(e.clientX, window.innerWidth - 200), y });
        }}
        disabled={isMe}
        className={cn(
          "flex items-center gap-2 w-full px-2 py-1.5 text-left transition-all",
          !isMe && "hover:bg-[var(--bg-hover)] group cursor-pointer",
          isMe && "cursor-default",
        )}
      >
        <div className="relative flex-shrink-0">
          <UserAvatar user={m.user} size="sm" />
          <PresenceDot status={status} size="sm" className="absolute -bottom-0.5 -right-0.5 ring-2 ring-[var(--bg-surface)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <p
              className={cn("text-xs font-medium text-[var(--text-primary)] truncate", nameplateStyle(m.user).className)}
              style={nameplateStyle(m.user).style}
            >
              @{name}
              {isMe && <span className="ml-1 text-[var(--text-muted)] font-normal opacity-50">{t("members.you")}</span>}
            </p>
            <span
              className="text-[9px] font-bold flex-shrink-0 px-1 rounded"
              style={{ color: levelColor(xpToLevel(m.xp)), border: `1px solid ${levelColor(xpToLevel(m.xp))}44` }}
            >
              {xpToLevel(m.xp)}
            </span>
          </div>
          {m.user?.pronouns && (
            <p className="text-[10px] text-[var(--text-muted)] truncate opacity-60">{m.user.pronouns}</p>
          )}
          {activity[m.userId] && (
            <p className="text-[10px] text-[var(--text-muted)] truncate opacity-70">{activity[m.userId]}</p>
          )}
          {inVoice.has(m.userId) && (
            <p className="text-[10px] text-[var(--online)]">{t("members.inVoice")}</p>
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
            placeholder={t("members.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] pl-7 pr-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-muted)] transition-colors"
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
              {t("members.online")} — {online.length}
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
              {t("members.offline")} — {offline.length}
            </button>
            {offlineOpen && <div className="space-y-0.5 mt-0.5">{offline.map((m) => <MemberRow key={m.userId} m={m} />)}</div>}
          </div>
        )}

        {filtered.length === 0 && (
          <p className="py-6 text-center text-xs text-[var(--text-muted)]">{t("members.notFound")}</p>
        )}
      </div>

      {ctxMenu && createPortal((() => {
        const m = ctxMenu.member;
        const username = m.nickname ?? m.user?.displayName ?? m.user?.username ?? m.userId.slice(0, 8);
        const friendship = friends.find((f) =>
          (f.requesterId === user?.id && f.targetId === m.userId) ||
          (f.targetId === user?.id && f.requesterId === m.userId),
        );
        const myMember = serverMembers.find((sm) => sm.userId === user?.id);
        const myRole = myMember?.roleId
          ? serverRoles.find((r) => r.id === myMember.roleId) ?? null
          : null;
        const canKick = can("kick_member", { userId: user?.id, server: activeServer, role: myRole });

        const close = () => setCtxMenu(null);

        return (
          <div
            ref={ctxMenuRef}
            style={{ position: "fixed", left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999 }}
            className="w-48 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg shadow-xl py-1"
          >
            <div className="px-3 py-1.5 text-[10px] text-[var(--text-muted)] border-b border-[var(--border)] truncate font-medium">
              @{username}
            </div>

            <button
              onClick={() => { setProfileMember(m); close(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] text-[var(--text-primary)] transition-colors"
            >
              <User className="w-3.5 h-3.5 flex-shrink-0" />
              {t("member.ctx.viewProfile")}
            </button>

            {/* Add / Remove friend */}
            {friendship ? (
              <button
                onClick={() => { void removeFriend(friendship.id); close(); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] text-[var(--text-primary)] transition-colors"
              >
                <UserMinus className="w-3.5 h-3.5 flex-shrink-0" />
                {t("member.ctx.removeFriend")}
              </button>
            ) : (
              <button
                onClick={() => { if (user && m.user?.username) void sendFriendRequest(m.user.username, user.id); close(); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] text-[var(--text-primary)] transition-colors"
              >
                <UserPlus className="w-3.5 h-3.5 flex-shrink-0" />
                {t("member.ctx.addFriend")}
              </button>
            )}

            {/* Message */}
            <button
              onClick={() => { if (user) void openDM(user.id, m.userId); close(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] text-[var(--text-primary)] transition-colors"
            >
              <MessageCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {t("member.ctx.message")}
            </button>

            {/* Call */}
            <button
              onClick={() => { void callUser(m.userId, username); close(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] text-[var(--text-primary)] transition-colors"
            >
              <Phone className="w-3.5 h-3.5 flex-shrink-0" />
              {t("member.ctx.call")}
            </button>

            {/* Mention */}
            <button
              onClick={() => {
                window.dispatchEvent(new CustomEvent("blok:mention-user", { detail: m.user?.username ?? username }));
                close();
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] text-[var(--text-primary)] transition-colors"
            >
              <AtSign className="w-3.5 h-3.5 flex-shrink-0" />
              {t("member.ctx.mention")}
            </button>

            {/* Invite to server */}
            {activeServerId && (
              <button
                onClick={() => {
                  void generateInviteCode(activeServerId).then((code) => {
                    if (code) navigator.clipboard.writeText(code).catch(() => {});
                  });
                  close();
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] text-[var(--text-primary)] transition-colors"
              >
                <Link2 className="w-3.5 h-3.5 flex-shrink-0" />
                {t("member.ctx.inviteToServer")}
              </button>
            )}

            {/* Kick — owner or has kick_member perm */}
            {canKick && (
              <>
                <div className="my-1 border-t border-[var(--border)]" />
                <button
                  onClick={() => { if (activeServerId) void kickMember(m.id, activeServerId); close(); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] text-[var(--destructive)] transition-colors"
                >
                  <UserX className="w-3.5 h-3.5 flex-shrink-0" />
                  {t("member.ctx.kick")}
                </button>
              </>
            )}
          </div>
        );
      })(), document.body)}

      {profileMember?.user && (
        <UserProfileModal
          user={profileMember.user}
          status={getStatus(profileMember.userId)}
          xp={profileMember.xp}
          onClose={() => setProfileMember(null)}
        />
      )}
    </div>
  );
}

// ─── Friends view ─────────────────────────────────────────────────────────────

function FriendsView() {
  const { user } = useAuthStore();
  const { friends, pendingRequests, outgoingRequests, presence, presenceLastSeen, activity, acceptRequest, declineRequest, cancelRequest, removeFriend, loadError } = useFriendsStore();
  const { openDM, callUser } = useDMStore();
  const { activeServerId, generateInviteCode } = useServerStore();
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [outgoingOpen, setOutgoingOpen] = useState(true);
  const [incomingOpen, setIncomingOpen] = useState(true);
  const [onlineOpen, setOnlineOpen] = useState(true);
  const [offlineOpen, setOfflineOpen] = useState(true);

  type FriendMeta = { id: string; friendId: string; friendUser: import("@/lib/store/types").User | undefined };
  type FriendCtxMenu = { friend: FriendMeta; x: number; y: number };
  const [ctxMenu, setCtxMenu] = useState<FriendCtxMenu | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const [profileFriend, setProfileFriend] = useState<FriendMeta | null>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node))
        setCtxMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [ctxMenu]);

  const query = search.toLowerCase().trim();

  const friendsWithMeta: FriendMeta[] = friends.map((f) => {
    if (!user) return null;
    const isRequester = f.requesterId === user.id;
    return { id: f.id, friendId: isRequester ? f.targetId : f.requesterId, friendUser: isRequester ? f.targetUser : f.requesterUser };
  }).filter((f): f is NonNullable<typeof f> => !!f);

  const filtered = friendsWithMeta.filter((f) =>
    !query ||
    f.friendUser?.username?.toLowerCase().includes(query) ||
    f.friendUser?.displayName?.toLowerCase().includes(query),
  );

  const onlineFriends = filtered.filter((f) => {
    const s = effectiveStatus(presence[f.friendId], presenceLastSeen[f.friendId]);
    return s === "online" || s === "afk" || s === "dnd";
  });
  const offlineFriends = filtered.filter((f) =>
    effectiveStatus(presence[f.friendId], presenceLastSeen[f.friendId]) === "offline",
  );

  const FriendRow = ({ f }: { f: FriendMeta }) => (
    <button
      key={f.id}
      onClick={() => user && openDM(user.id, f.friendId)}
      onContextMenu={(e) => {
        e.preventDefault();
        const menuH = 140;
        const y = e.clientY + menuH > window.innerHeight ? e.clientY - menuH : e.clientY;
        setCtxMenu({ friend: f, x: Math.min(e.clientX, window.innerWidth - 200), y });
      }}
      className="flex items-center gap-2 w-full px-2 py-1.5 text-left transition-all hover:bg-[var(--bg-hover)] group"
    >
      <div className="relative flex-shrink-0">
        <UserAvatar user={f.friendUser} size="sm" />
        <PresenceDot status={effectiveStatus(presence[f.friendId], presenceLastSeen[f.friendId])} size="sm" className="absolute -bottom-0.5 -right-0.5 ring-2 ring-[var(--bg-surface)]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-[var(--text-primary)] truncate font-medium">@{f.friendUser?.username ?? "unknown"}</p>
        {activity[f.friendId] && (
          <p className="text-[10px] text-[var(--text-muted)] truncate opacity-70">{activity[f.friendId]}</p>
        )}
        {!activity[f.friendId] && f.friendUser?.pronouns && (
          <p className="text-[10px] text-[var(--text-muted)] truncate opacity-60">{f.friendUser.pronouns}</p>
        )}
      </div>
      <MessageCircle className="w-3 h-3 text-[var(--text-muted)] opacity-0 group-hover:opacity-70 transition-opacity flex-shrink-0" />
    </button>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="p-2 border-b border-[var(--border)]">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder={t("friends.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] pl-7 pr-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-muted)] transition-colors"
          />
        </div>
      </div>

      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium">
          {t("friends.friends")} — {friends.length}
        </span>
        <button onClick={() => setShowAddFriend(true)} className="p-1 hover:bg-[var(--bg-hover)] transition-colors" title="Add friend">
          <UserPlus className="w-3.5 h-3.5 text-[var(--text-muted)]" />
        </button>
      </div>

      <AddFriendModal isOpen={showAddFriend} onClose={() => setShowAddFriend(false)} />

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {loadError && (
          <div className="p-2 mb-1 border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 text-[var(--destructive)] text-xs">{loadError}</div>
        )}

        {/* Outgoing requests */}
        {outgoingRequests.length > 0 && (
          <div className="mt-1">
            <button onClick={() => setOutgoingOpen((v) => !v)} className="flex items-center gap-1 w-full px-1 py-1 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium hover:text-[var(--text-primary)] transition-colors">
              <ChevronDown className={cn("w-3 h-3 transition-transform", !outgoingOpen && "-rotate-90")} />
              Outgoing — {outgoingRequests.length}
            </button>
            {outgoingOpen && (
              <div className="space-y-0.5 mt-0.5">
                {outgoingRequests.map((req) => (
                  <div key={req.id} className="flex items-center gap-2 px-2 py-1.5">
                    <UserAvatar user={req.targetUser} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[var(--text-primary)] truncate font-medium">@{req.targetUser?.username ?? "unknown"}</p>
                      <p className="text-[10px] text-[var(--text-muted)] truncate opacity-60">{t("friends.pending")}</p>
                    </div>
                    <button onClick={() => cancelRequest(req.id)} className="p-1 hover:bg-[var(--destructive)]/20 text-[var(--text-muted)] hover:text-[var(--destructive)] transition-colors flex-shrink-0">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Incoming requests */}
        {pendingRequests.length > 0 && (
          <div className="mt-1">
            <button onClick={() => setIncomingOpen((v) => !v)} className="flex items-center gap-1 w-full px-1 py-1 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium hover:text-[var(--text-primary)] transition-colors">
              <ChevronDown className={cn("w-3 h-3 transition-transform", !incomingOpen && "-rotate-90")} />
              <span className="text-[var(--online)]">Incoming — {pendingRequests.length}</span>
            </button>
            {incomingOpen && (
              <div className="space-y-0.5 mt-0.5">
                {pendingRequests.map((req) => (
                  <div key={req.id} className="px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <UserAvatar user={req.requesterUser} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[var(--text-primary)] truncate font-medium">@{req.requesterUser?.username ?? "unknown"}</p>
                        <p className="text-[10px] text-[var(--text-muted)] truncate opacity-60">{t("friends.wantsToAdd")}</p>
                      </div>
                    </div>
                    <div className="mt-1.5 flex gap-1">
                      <button onClick={() => acceptRequest(req.id)} className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 text-xs bg-[var(--online)]/20 text-[var(--online)] hover:bg-[var(--online)]/30 transition-colors">
                        <Check className="w-3 h-3" /> {t("friends.accept")}
                      </button>
                      <button onClick={() => declineRequest(req.id)} className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 text-xs bg-[var(--destructive)]/20 text-[var(--destructive)] hover:bg-[var(--destructive)]/30 transition-colors">
                        <X className="w-3 h-3" /> {t("friends.decline")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Online friends */}
        {onlineFriends.length > 0 && (
          <div className="mt-1">
            <button onClick={() => setOnlineOpen((v) => !v)} className="flex items-center gap-1 w-full px-1 py-1 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium hover:text-[var(--text-primary)] transition-colors">
              <ChevronDown className={cn("w-3 h-3 transition-transform", !onlineOpen && "-rotate-90")} />
              Online — {onlineFriends.length}
            </button>
            {onlineOpen && (
              <div className="space-y-0.5 mt-0.5">
                {onlineFriends.map((f) => <FriendRow key={f.id} f={f} />)}
              </div>
            )}
          </div>
        )}

        {/* Offline friends */}
        {offlineFriends.length > 0 && (
          <div className="mt-1">
            <button onClick={() => setOfflineOpen((v) => !v)} className="flex items-center gap-1 w-full px-1 py-1 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium hover:text-[var(--text-primary)] transition-colors">
              <ChevronDown className={cn("w-3 h-3 transition-transform", !offlineOpen && "-rotate-90")} />
              Offline — {offlineFriends.length}
            </button>
            {offlineOpen && (
              <div className="space-y-0.5 mt-0.5">
                {offlineFriends.map((f) => <FriendRow key={f.id} f={f} />)}
              </div>
            )}
          </div>
        )}

        {filtered.length === 0 && !query && <p className="py-6 text-center text-xs text-[var(--text-muted)]">{t("friends.noFriends")}</p>}
        {filtered.length === 0 && query && <p className="py-4 text-center text-xs text-[var(--text-muted)]">{t("friends.noResults")}</p>}
      </div>

      {/* Context menu */}
      {ctxMenu && createPortal((() => {
        const { friend: f } = ctxMenu;
        const close = () => setCtxMenu(null);
        return (
          <div
            ref={ctxMenuRef}
            className="fixed z-50 w-48 bg-[var(--bg-elevated)] border border-[var(--border)] shadow-xl py-1"
            style={{ top: ctxMenu.y, left: ctxMenu.x }}
          >
            <div className="px-3 py-1.5 border-b border-[var(--border)] mb-1">
              <p className="text-xs font-semibold text-[var(--text-muted)] truncate">@{f.friendUser?.username ?? "unknown"}</p>
            </div>
            <button
              onClick={() => { setProfileFriend(f); close(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] text-[var(--text-primary)] transition-colors"
            >
              <User className="w-3.5 h-3.5 flex-shrink-0" />
              {t("member.ctx.viewProfile")}
            </button>
            <button
              onClick={() => { if (user) void openDM(user.id, f.friendId); close(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] text-[var(--text-primary)] transition-colors"
            >
              <MessageCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {t("member.ctx.message")}
            </button>
            <button
              onClick={() => { void callUser(f.friendId, f.friendUser?.username ?? ""); close(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] text-[var(--text-primary)] transition-colors"
            >
              <Phone className="w-3.5 h-3.5 flex-shrink-0" />
              {t("member.ctx.call")}
            </button>
            {activeServerId && (
              <button
                onClick={() => {
                  void generateInviteCode(activeServerId).then((code) => {
                    if (code) navigator.clipboard.writeText(code).catch(() => {});
                  });
                  close();
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] text-[var(--text-primary)] transition-colors"
              >
                <Link2 className="w-3.5 h-3.5 flex-shrink-0" />
                {t("member.ctx.inviteToServer")}
              </button>
            )}
            <div className="my-1 border-t border-[var(--border)]" />
            <button
              onClick={() => { void removeFriend(f.id); close(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] text-[var(--destructive)] transition-colors"
            >
              <UserMinus className="w-3.5 h-3.5 flex-shrink-0" />
              {t("member.ctx.removeFriend")}
            </button>
          </div>
        );
      })(), document.body)}

      {/* Profile modal */}
      {profileFriend?.friendUser && (
        <UserProfileModal
          user={profileFriend.friendUser}
          status={effectiveStatus(presence[profileFriend.friendId], presenceLastSeen[profileFriend.friendId])}
          onClose={() => setProfileFriend(null)}
        />
      )}
    </div>
  );
}

// ─── Quests view ──────────────────────────────────────────────────────────────

export function QuestsView() {
  const { user } = useAuthStore();
  const { activeServerId } = useServerStore();
  const { progress, loading, loadQuests, claimQuest } = useQuestsStore();

  useEffect(() => {
    if (user && activeServerId) void loadQuests(user.id, activeServerId);
  }, [user, activeServerId, loadQuests]);

  const today = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  return (
    <div className="flex flex-col flex-1 min-h-0 px-3 py-3 gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
          <span className="text-[var(--accent-red)]">$</span> daily quests
        </span>
        <span className="text-[10px] text-[var(--text-muted)]">{today}</span>
      </div>

      {loading && (
        <p className="text-xs text-[var(--text-muted)] text-center py-4">Loading...</p>
      )}

      {!loading && DAILY_QUESTS.map((quest) => {
        const p = progress.find((p) => p.questId === quest.id);
        const count = p?.count ?? 0;
        const claimed = p?.claimed ?? false;
        const done = count >= quest.target;
        const percent = Math.min(100, Math.round((count / quest.target) * 100));

        return (
          <div key={quest.id} className={cn(
            "border border-[var(--border)] p-3 flex flex-col gap-2",
            done && !claimed && "border-[var(--accent-red)]/40 bg-[var(--accent-red)]/5",
            claimed && "opacity-50",
          )}>
            <div className="flex items-center gap-2">
              <span className="text-base leading-none">{quest.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-[var(--text-primary)]">{quest.label}</p>
                <p className="text-[10px] text-[var(--text-muted)]">
                  {count}/{quest.target} · +{quest.xp} XP · 🪙{quest.coins}
                </p>
              </div>
              {claimed && <span className="text-[10px] text-[var(--text-muted)]">✓</span>}
            </div>

            <div className="w-full h-1 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${percent}%`,
                  background: claimed ? "var(--text-muted)" : done ? "var(--accent-red)" : "var(--online)",
                }}
              />
            </div>

            {done && !claimed && (
              <button
                onClick={() => void claimQuest(quest.id, quest.xp, quest.coins)}
                className="w-full py-1 text-xs font-bold text-white bg-[var(--accent-red)] hover:bg-[var(--accent-red)]/80 transition-colors"
              >
                Claim +{quest.xp} XP · 🪙{quest.coins}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Unified sidebar ──────────────────────────────────────────────────────────

export function RightSidebar() {
  const { activeServerId, members } = useServerStore();
  const { friends } = useFriendsStore();
  const memberCount = activeServerId ? (members[activeServerId]?.length ?? 0) : 0;
  const friendCount = friends.length;
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("members");
  const { isTabOpen: isBaitTabOpen, isActive: isBaitActive, openTab: openBaitTab, activate: activateBait } = useBaitStore();

  const activeTab = activeServerId ? tab : (tab === "shop" ? "shop" : "friends");

  return (
    <div className="w-52 bg-[var(--bg-surface)] border-l border-[var(--border)] flex flex-col flex-shrink-0">
      {/* Tab header */}
      <div className="px-2 pt-2 pb-0 border-b border-[var(--border)]">
        <div className="flex items-center gap-1 w-full">
          {activeServerId ? (
            <>
              <TabBtn label={t("sidebar.members")} count={memberCount} active={activeTab === "members"} onClick={() => setTab("members")} />
              <TabBtn label={t("friends.friends")} count={friendCount} active={activeTab === "friends"} onClick={() => setTab("friends")} />
              <TabBtn label="quests" active={activeTab === "quests"} onClick={() => setTab("quests")} />
              <TabBtn label={t("store.tab")} active={activeTab === "shop"} onClick={() => setTab("shop")} />
            </>
          ) : (
            <>
              <TabBtn label={t("friends.friends")} count={friendCount} active={activeTab === "friends"} onClick={() => setTab("friends")} />
              <TabBtn label={t("store.tab")} active={activeTab === "shop"} onClick={() => setTab("shop")} />
            </>
          )}
        </div>
      </div>

      {activeTab === "members" && <MembersView />}
      {activeTab === "friends" && <FriendsView />}
      {activeTab === "quests" && <QuestsView />}
      {activeTab === "shop" && <EconomyView />}

      <button
        onClick={() => isBaitTabOpen ? activateBait() : openBaitTab()}
        className={cn(
          "flex items-center gap-3 px-3 border-t border-[var(--border)] transition-colors shrink-0 h-[82px]",
          isBaitActive ? "bg-[var(--bg-elevated)]" : "hover:bg-[var(--bg-hover)]",
        )}
      >
        <div className={cn(
          "flex items-center justify-center w-8 h-8 shrink-0 transition-colors",
          isBaitActive ? "bg-[var(--accent-red)]/10" : "bg-[var(--bg-elevated)]",
        )}>
          <FishHookIcon className={cn("w-4 h-4", isBaitActive ? "text-[var(--accent-red)]" : "text-[var(--text-muted)]")} />
        </div>
        <div className="flex-1 flex flex-col gap-0.5 text-left">
          <span className={cn(
            "text-sm font-mono font-medium flex items-center gap-1",
            isBaitActive ? "text-[var(--accent-red)]" : "text-[var(--text-primary)]",
          )}>
            $b.ai.t
            <span className="cursor-blink inline-block w-1 h-3 bg-current opacity-80" />
          </span>
          <span className="text-[10px] text-[var(--text-muted)] font-mono leading-tight">
            $blok artificial intelligence toy
          </span>
        </div>
      </button>
    </div>
  );
}
