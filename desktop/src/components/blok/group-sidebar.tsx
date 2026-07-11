import {
  ChevronDown,
  Plus,
  Settings,
  PhoneOff,
  MicOff,
  VolumeX,
  Monitor,
  Video,
  UserPlus,
  Trash2,
  X,
  Clock,
  FolderPlus,
} from "lucide-react";
import { SLOWMODE_PRESETS, formatSlowmode } from "@/lib/moderation";
import { useServerStore } from "@/lib/store/server-store";
import { useShallow } from "zustand/react/shallow";
import { useAuthStore } from "@/lib/store/auth-store";
import { UserAvatar } from "./user-avatar";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef } from "react";
import { playJoinSound, playLeaveSound } from "@/lib/sounds";
import { UserBar } from "./user-bar";
import { useI18n } from "@/lib/i18n";
import { CreateChannelModal } from "./create-channel-modal";
import { InviteUserModal } from "./invite-user-modal";
import { RoleManagerModal } from "./role-manager-modal";
import { VoiceUserContextMenu, type VoiceUserCtx } from "./voice-user-context-menu";
import { can } from "@/lib/permission";

export function GroupSidebar() {
  const { t } = useI18n();
  const {
    servers,
    activeServerId,
    channels,
    categories,
    activeChannelId,
    setActiveChannel,
    activeVoiceChannelId,
    voiceParticipants,
    joinVoiceChannel,
    leaveVoiceChannel,
    unreadCounts,
    deleteChannel,
    members,
    roles,
    isCameraOn,
    cameraUsers,
    updateServerIcon,
    renameChannel,
    renameServer,
    setChannelSlowmode,
    createCategory,
    renameCategory,
    deleteCategory,
    reorderCategories,
    reorderChannels,
    deleteServer,
  } = useServerStore(
    useShallow((s) => ({
      servers: s.servers,
      activeServerId: s.activeServerId,
      channels: s.channels,
      categories: s.categories,
      activeChannelId: s.activeChannelId,
      setActiveChannel: s.setActiveChannel,
      activeVoiceChannelId: s.activeVoiceChannelId,
      voiceParticipants: s.voiceParticipants,
      joinVoiceChannel: s.joinVoiceChannel,
      leaveVoiceChannel: s.leaveVoiceChannel,
      unreadCounts: s.unreadCounts,
      deleteChannel: s.deleteChannel,
      members: s.members,
      roles: s.roles,
      isCameraOn: s.isCameraOn,
      cameraUsers: s.cameraUsers,
      updateServerIcon: s.updateServerIcon,
      renameChannel: s.renameChannel,
      renameServer: s.renameServer,
      setChannelSlowmode: s.setChannelSlowmode,
      createCategory: s.createCategory,
      renameCategory: s.renameCategory,
      deleteCategory: s.deleteCategory,
      reorderCategories: s.reorderCategories,
      reorderChannels: s.reorderChannels,
      deleteServer: s.deleteServer,
    })),
  );
  const { user } = useAuthStore();
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const toggleCategory = (id: string) => setCollapsedCategories((s) => ({ ...s, [id]: !s[id] }));

  const activeServer = servers.find((s) => s.id === activeServerId);
  const serverChannels = activeServerId ? channels[activeServerId] || [] : [];
  const serverCategories = (activeServerId ? categories[activeServerId] ?? [] : [])
    .slice().sort((a, b) => a.position - b.position);

  const channelsIn = (categoryId: string | null) =>
    serverChannels.filter((c) => (c.categoryId ?? null) === categoryId).sort((a, b) => a.position - b.position);

  // Local state for modal
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [createChannelCategoryId, setCreateChannelCategoryId] = useState<string | undefined>(undefined);
  const [showRoleManager, setShowRoleManager] = useState(false);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const newCategoryInputRef = useRef<HTMLInputElement>(null);
  const [renamingCategoryId, setRenamingCategoryId] = useState<string | null>(null);
  const [confirmDeleteCategoryId, setConfirmDeleteCategoryId] = useState<string | null>(null);

  // Drag-and-drop state
  const [draggedChannelId, setDraggedChannelId] = useState<string | null>(null);
  const [dragOverChannel, setDragOverChannel] = useState<{ id: string; position: "above" | "below" } | null>(null);
  const [draggedCategoryId, setDraggedCategoryId] = useState<string | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<{ id: string; position: "above" | "below" } | null>(null);

  // Resolve current user's role in this server
  const serverMembers = activeServerId ? members[activeServerId] ?? [] : [];
  const myMember = serverMembers.find((m) => m.userId === user?.id);
  const myRole = myMember?.roleId
    ? (roles[activeServerId ?? ""] ?? []).find((r) => r.id === myMember.roleId) ?? null
    : null;
  const roleCtx = { userId: user?.id, server: activeServer ?? null, role: myRole };

  const canManage        = can("manage_server",      roleCtx);
  const canRenameChannel = can("rename_channel",     roleCtx);
  const canRenameServer  = can("rename_server",      roleCtx);
  const canManageIcon    = can("manage_server_icon", roleCtx);
  const canManageChannels= can("manage_channels",    roleCtx);
  const canCreateChannel = can("create_channel",     roleCtx);
  const canDeleteChannelPerm = can("delete_channel", roleCtx);
  const isServerOwner = !!user && !!activeServer && activeServer.ownerId === user.id;

  const handleDeleteServer = async () => {
    if (!activeServer) return;
    setConfirmDeleteServer(false);
    try {
      await deleteServer(activeServer.id);
    } catch (e) {
      console.error("delete server failed", e);
    }
  };

  const [showInviteUser, setShowInviteUser] = useState(false);
  const [confirmDeleteServer, setConfirmDeleteServer] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeServerId) return;
    e.target.value = "";
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 256;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      void updateServerIcon(activeServerId, canvas.toDataURL("image/jpeg", 0.85));
      URL.revokeObjectURL(objectUrl);
    };
    img.src = objectUrl;
  };

  const [joiningChannel, setJoiningChannel] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [confirmDeleteChannelId, setConfirmDeleteChannelId] = useState<string | null>(null);
  const [slowmodeChannelId, setSlowmodeChannelId] = useState<string | null>(null);
  const [renamingChannelId, setRenamingChannelId] = useState<string | null>(null);
  const [renamingServer, setRenamingServer] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const serverRenameInputRef = useRef<HTMLInputElement>(null);

  const [ctxMenu, setCtxMenu] = useState<VoiceUserCtx | null>(null);

  useEffect(() => {
    if (renamingChannelId) renameInputRef.current?.focus();
  }, [renamingChannelId]);

  useEffect(() => {
    if (renamingServer) serverRenameInputRef.current?.focus();
  }, [renamingServer]);

  useEffect(() => {
    if (showCreateCategory) newCategoryInputRef.current?.focus();
  }, [showCreateCategory]);

  useEffect(() => {
    if (renamingCategoryId) renameInputRef.current?.focus();
  }, [renamingCategoryId]);

  const commitCreateCategory = async () => {
    if (activeServerId && newCategoryName.trim()) {
      await createCategory(activeServerId, newCategoryName);
    }
    setShowCreateCategory(false);
    setNewCategoryName("");
  };

  const commitCategoryRename = async () => {
    if (renamingCategoryId && renameValue.trim()) {
      await renameCategory(renamingCategoryId, renameValue);
    }
    setRenamingCategoryId(null);
    setRenameValue("");
  };

  const openCreateChannel = (categoryId?: string) => {
    setCreateChannelCategoryId(categoryId);
    setShowCreateChannel(true);
  };

  // ── Channel drag-and-drop (reorder within/between categories) ─────────────
  const handleChannelDrop = (targetCategoryId: string | null, targetChannelId: string | null, insertAfter: boolean) => {
    if (!draggedChannelId || !activeServerId) return;
    const dragged = serverChannels.find((c) => c.id === draggedChannelId);
    if (!dragged) return;
    const sourceCategoryId = dragged.categoryId ?? null;

    const destIds = channelsIn(targetCategoryId).map((c) => c.id).filter((id) => id !== draggedChannelId);
    let insertIdx = destIds.length;
    if (targetChannelId) {
      const idx = destIds.indexOf(targetChannelId);
      insertIdx = idx === -1 ? destIds.length : insertAfter ? idx + 1 : idx;
    }
    destIds.splice(insertIdx, 0, draggedChannelId);

    const items = destIds.map((id, i) => ({ id, categoryId: targetCategoryId, position: i }));
    if (sourceCategoryId !== targetCategoryId) {
      const sourceIds = channelsIn(sourceCategoryId).map((c) => c.id).filter((id) => id !== draggedChannelId);
      items.push(...sourceIds.map((id, i) => ({ id, categoryId: sourceCategoryId, position: i })));
    }

    void reorderChannels(activeServerId, items);
    setDraggedChannelId(null);
    setDragOverChannel(null);
  };

  // ── Category drag-and-drop (reorder categories themselves) ─────────────────
  const handleCategoryDrop = (targetCategoryId: string, insertAfter: boolean) => {
    if (!draggedCategoryId || !activeServerId || draggedCategoryId === targetCategoryId) return;
    const ids = serverCategories.map((c) => c.id).filter((id) => id !== draggedCategoryId);
    const idx = ids.indexOf(targetCategoryId);
    const insertIdx = idx === -1 ? ids.length : insertAfter ? idx + 1 : idx;
    ids.splice(insertIdx, 0, draggedCategoryId);
    void reorderCategories(activeServerId, ids.map((id, i) => ({ id, position: i })));
    setDraggedCategoryId(null);
    setDragOverCategory(null);
  };

  const commitRename = async () => {
    if (renamingChannelId && renameValue.trim()) {
      await renameChannel(renamingChannelId, renameValue);
    }
    setRenamingChannelId(null);
    setRenameValue("");
  };

  const commitServerRename = async () => {
    if (activeServerId && renameValue.trim()) {
      await renameServer(activeServerId, renameValue);
    }
    setRenamingServer(false);
    setRenameValue("");
  };

  const handleVoiceChannelClick = async (channelId: string) => {
    if (!user || joiningChannel) return;
    setVoiceError(null);
    if (activeVoiceChannelId === channelId) {
      // Navigate to VoiceView (clear text channel selection)
      setActiveChannel(null);
    } else {
      setJoiningChannel(channelId);
      try {
        const error = await joinVoiceChannel(channelId, user);
        if (error) setVoiceError(error);
        else {
          playJoinSound();
          setActiveChannel(null);
        }
      } finally {
        setJoiningChannel(null);
      }
    }
  };

  const handleLeaveVoice = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await leaveVoiceChannel();
    playLeaveSound();
  };

  const renderChannel = (channel: import("@/lib/store/types").Channel, categoryId: string | null) => {
    const isVoice = channel.type === "voice";
    const isInChannel = isVoice && activeVoiceChannelId === channel.id;
    const participants = isVoice ? (voiceParticipants[channel.id] || []) : [];
    const dropAbove = dragOverChannel?.id === channel.id && dragOverChannel.position === "above";
    const dropBelow = dragOverChannel?.id === channel.id && dragOverChannel.position === "below";

    return (
      <div
        key={channel.id}
        className={cn(
          "group/ch relative",
          dropAbove && "border-t-2 border-t-[var(--accent-red)]",
          dropBelow && "border-b-2 border-b-[var(--accent-red)]",
        )}
        draggable={canManageChannels && !confirmDeleteChannelId && !renamingChannelId}
        onDragStart={(e) => { e.stopPropagation(); setDraggedChannelId(channel.id); }}
        onDragEnd={() => { setDraggedChannelId(null); setDragOverChannel(null); }}
        onDragOver={(e) => {
          if (!draggedChannelId || draggedChannelId === channel.id) return;
          e.preventDefault();
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          const position = e.clientY - rect.top > rect.height / 2 ? "below" : "above";
          setDragOverChannel({ id: channel.id, position });
        }}
        onDrop={(e) => {
          if (!draggedChannelId) return;
          e.preventDefault();
          e.stopPropagation();
          handleChannelDrop(categoryId, channel.id, dragOverChannel?.position === "below");
        }}
      >
        {confirmDeleteChannelId === channel.id ? (
          <div className="flex items-center gap-1 px-2 py-1.5 bg-[var(--bg-elevated)] border border-[var(--destructive)]/40 text-xs">
            <span className="text-[var(--accent-red-text)] truncate flex-1">
              {t("channel.deleteConfirm").replace("{name}", channel.name)}
            </span>
            <button
              onClick={() => { void deleteChannel(channel.id); setConfirmDeleteChannelId(null); }}
              className="px-1.5 py-0.5 bg-[var(--destructive)] text-white hover:opacity-90 transition-opacity text-[10px]"
            >
              {t("message.delete")}
            </button>
            <button
              onClick={() => setConfirmDeleteChannelId(null)}
              className="p-0.5 hover:text-[var(--text-primary)] transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : slowmodeChannelId === channel.id ? (
          <div className="flex flex-col gap-1 px-2 py-1.5 bg-[var(--bg-elevated)] border border-[var(--accent-red)]/40">
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--text-muted)]">
              <Clock className="w-3 h-3" />
              <span className="flex-1 truncate">{t("slowmode.title")} #{channel.name}</span>
              <button onClick={() => setSlowmodeChannelId(null)} className="hover:text-[var(--text-primary)] transition-colors">
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {SLOWMODE_PRESETS.map((s) => (
                <button
                  key={s}
                  onClick={() => { void setChannelSlowmode(channel.id, s); setSlowmodeChannelId(null); }}
                  className={cn(
                    "px-1.5 py-0.5 text-[10px] font-mono border transition-colors",
                    (channel.slowModeSeconds ?? 0) === s
                      ? "border-[var(--accent-red)] text-[var(--accent-red)]"
                      : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--text-primary)]/40",
                  )}
                >
                  {s === 0 ? t("slowmode.off") : formatSlowmode(s)}
                </button>
              ))}
            </div>
          </div>
        ) : renamingChannelId === channel.id ? (
          <div className={cn(
            "flex items-center gap-1.5 w-full px-2 py-1.5 border bg-[var(--bg-elevated)]",
            isVoice ? "border-[var(--online)]/60" : "border-[var(--accent-red)]/60",
          )}>
            <span className="text-[var(--text-muted)] flex-shrink-0 font-mono">{isVoice ? "♪" : "#"}</span>
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); void commitRename(); }
                if (e.key === "Escape") { setRenamingChannelId(null); setRenameValue(""); }
              }}
              onBlur={() => void commitRename()}
              className="flex-1 min-w-0 bg-transparent text-sm text-[var(--text-primary)] outline-none font-mono"
            />
          </div>
        ) : (
          <button
            onClick={() => isVoice ? void handleVoiceChannelClick(channel.id) : setActiveChannel(channel.id)}
            onDoubleClick={canRenameChannel ? (e) => {
              e.preventDefault();
              setRenamingChannelId(channel.id);
              setRenameValue(channel.name);
            } : undefined}
            disabled={isVoice && joiningChannel === channel.id}
            className={cn(
              "group/ch flex items-center gap-1.5 w-full px-2 py-1.5 text-sm transition-all duration-150 text-left border",
              isVoice
                ? isInChannel
                  ? "border-[var(--online)]/40 bg-[var(--bg-elevated)] text-[var(--online-text)] shadow-[inset_2px_0_0_var(--online)]"
                  : "border-dashed border-[var(--border)] text-[var(--text-muted)] hover:border-solid hover:border-[var(--text-primary)]/30 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                : activeChannelId === channel.id
                  ? "border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[inset_2px_0_0_var(--accent-red)]"
                  : "border-dashed border-[var(--border)] text-[var(--text-muted)] hover:border-solid hover:border-[var(--text-primary)]/30 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
              isVoice && joiningChannel === channel.id && "opacity-60 cursor-wait",
            )}
          >
            <span className={cn(
              "flex-shrink-0 font-mono text-xs",
              isVoice && isInChannel ? "text-[var(--online-text)]" : "text-[var(--text-muted)]",
            )}>
              {isVoice ? "♪" : "#"}
            </span>
            <span className="truncate flex-1 min-w-0 text-left">{channel.name}</span>
            {!isVoice && (unreadCounts[channel.id] ?? 0) > 0 && (
              <span className="flex-shrink-0 min-w-[18px] h-[18px] flex items-center justify-center bg-[var(--accent-red)] text-[10px] text-white font-bold px-1">
                {unreadCounts[channel.id] > 99 ? "99+" : unreadCounts[channel.id]}
              </span>
            )}
            {isVoice && joiningChannel === channel.id && (
              <span className="text-[10px] text-[var(--text-muted)] animate-pulse">…</span>
            )}
            {isVoice && isInChannel && !joiningChannel && (
              <span
                role="button"
                onClick={(e) => void handleLeaveVoice(e)}
                aria-label="Leave voice"
                className="p-0.5 hover:text-[var(--accent-red-text)] transition-colors"
              >
                <PhoneOff className="w-3 h-3 text-[var(--accent-red-text)]" />
              </span>
            )}
            {!isVoice && canManageChannels && (
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); setSlowmodeChannelId(channel.id); }}
                aria-label={`${t("slowmode.title")}: ${(channel.slowModeSeconds ?? 0) === 0 ? t("slowmode.off") : formatSlowmode(channel.slowModeSeconds ?? 0)}`}
                className={cn(
                  "p-0.5 transition-all",
                  (channel.slowModeSeconds ?? 0) > 0
                    ? "text-[var(--accent-red)] opacity-100"
                    : "opacity-0 group-hover/ch:opacity-100 hover:text-[var(--text-primary)]",
                )}
              >
                <Clock className="w-3 h-3" />
              </span>
            )}
            {canManage && (
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); setConfirmDeleteChannelId(channel.id); }}
                className="opacity-0 group-hover/ch:opacity-100 p-0.5 hover:text-[var(--accent-red-text)] transition-all"
              >
                <Trash2 className="w-3 h-3" />
              </span>
            )}
          </button>
        )}

        {isVoice && participants.length > 0 && (
          <div className="ml-6 mt-1 space-y-1">
            {participants.map((participant) => {
              const displayUser = participant.userId === user?.id ? user : participant.user;
              const isSelf = participant.userId === user?.id;
              return (
                <div
                  key={participant.userId}
                  className="flex items-center gap-2 px-2 py-1 text-xs text-[var(--text-muted)]"
                  onContextMenu={isSelf ? undefined : (e) => {
                    e.preventDefault();
                    const name = displayUser?.displayName || displayUser?.username || participant.userId.slice(0, 8);
                    setCtxMenu({ userId: participant.userId, name, x: e.clientX, y: e.clientY });
                  }}
                >
                  <div className="rounded-full transition-all">
                    <UserAvatar user={displayUser} size="xs" isSpeaking={participant.isSpeaking} />
                  </div>
                  <span
                    className={cn(
                      "truncate transition-colors",
                      participant.isSpeaking && "text-[var(--online-text)]",
                    )}
                  >
                    {displayUser?.displayName || displayUser?.username || "..."}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    {participant.isScreenSharing && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          window.dispatchEvent(new CustomEvent("blok:focus-screen-share"));
                        }}
                        aria-label="View screen share"
                        className="hover:text-[var(--online-text)] transition-colors"
                      >
                        <Monitor className="w-3 h-3 text-[var(--online-text)]" />
                      </button>
                    )}
                    {(participant.userId === user?.id ? isCameraOn : !!cameraUsers[participant.userId]) && (
                      <Video className="w-3 h-3 text-[var(--online-text)]" />
                    )}
                    {(participant.isMuted || participant.isDeafened) && (
                      <MicOff className="w-3 h-3 text-[var(--accent-red-text)]" />
                    )}
                    {participant.isDeafened && (
                      <VolumeX className="w-3 h-3 text-[var(--accent-red-text)]" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderCategoryChannels = (categoryId: string | null) => (
    <div
      className="space-y-1 min-h-[4px]"
      onDragOver={(e) => { if (draggedChannelId) e.preventDefault(); }}
      onDrop={(e) => {
        if (!draggedChannelId) return;
        e.preventDefault();
        handleChannelDrop(categoryId, null, true);
      }}
    >
      {channelsIn(categoryId).map((channel) => renderChannel(channel, categoryId))}
    </div>
  );

  if (!activeServer) {
    return (
      <div className="w-56 bg-[var(--bg-surface)] border-r border-[var(--border)] flex flex-col flex-shrink-0">
        <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-sm">
          <p className="text-center px-4">
            <span className="text-[var(--text-muted)]">$ </span>
            {t("server.noServerSelected")}
          </p>
        </div>
        <UserBar />
      </div>
    );
  }

  return (
    <div className="w-56 bg-[var(--bg-surface)] border-r border-[var(--border)] flex flex-col flex-shrink-0">
      <div>
        <div className="h-12 px-3 border-b border-[var(--border)] flex items-center justify-between">
          {renamingServer ? (
            <input
              ref={serverRenameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); void commitServerRename(); }
                if (e.key === "Escape") { setRenamingServer(false); setRenameValue(""); }
              }}
              onBlur={() => void commitServerRename()}
              className="flex-1 min-w-0 bg-transparent text-sm font-semibold text-[var(--text-primary)] outline-none border-b border-[var(--accent-red)] mr-2"
            />
          ) : (
            <h2
              className={cn("font-semibold text-sm text-[var(--text-primary)] truncate", canRenameServer && "cursor-text")}
              onDoubleClick={canRenameServer ? () => { setRenameValue(activeServer.name); setRenamingServer(true); } : undefined}
              aria-label={canRenameServer ? "Double-click to rename" : undefined}
            >
              <span className="text-[var(--text-muted)] font-normal mr-1">$</span>{activeServer.name}
            </h2>
          )}
          <div className="flex items-center gap-1">
            {confirmDeleteServer ? (
              <>
                <span className="text-[10px] font-mono text-[var(--accent-red-text)] truncate">
                  {t("server.deleteConfirm").replace("{name}", activeServer.name)}
                </span>
                <button
                  onClick={() => void handleDeleteServer()}
                  className="px-1.5 py-0.5 bg-[var(--destructive)] text-white hover:opacity-90 transition-opacity text-[10px]"
                >
                  {t("message.delete")}
                </button>
                <button
                  onClick={() => setConfirmDeleteServer(false)}
                  className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  aria-label={t("common.cancel")}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <>
                {canManage && (
                  <button
                    onClick={() => setShowInviteUser(true)}
                    aria-label={t("invite.addMember")}
                    className="p-1 hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <UserPlus className="w-4 h-4 text-[var(--text-muted)]" />
                  </button>
                )}
                {canManage && (
                  <button
                    onClick={() => setShowRoleManager(true)}
                    aria-label="Roles & Permissions"
                    className="p-1 hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <Settings className="w-4 h-4 text-[var(--text-muted)]" />
                  </button>
                )}
                {isServerOwner && (
                  <button
                    onClick={() => setConfirmDeleteServer(true)}
                    aria-label={t("server.delete")}
                    className="p-1 hover:bg-[var(--destructive)]/20 transition-colors group/del"
                  >
                    <Trash2 className="w-4 h-4 text-[var(--text-muted)] group-hover/del:text-[var(--accent-red-text)]" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        <div className="p-3">
        {activeServer.description && (
          <p className="text-xs text-[var(--text-muted)] mb-1 truncate">
            <span className="opacity-60">@desc </span>
            {activeServer.description}
          </p>
        )}

        {/* Server avatar */}
        <div className="mt-2 border border-[var(--border)]">
          <div className="px-2 py-0.5 bg-[var(--bg-elevated)] border-b border-[var(--border)] flex items-center justify-between">
            <span className="text-[10px] font-mono text-[var(--text-muted)]"><span className="opacity-50">$ </span>icon</span>
            {activeServer.iconUrl && canManageIcon && (
              <button
                onClick={() => void updateServerIcon(activeServerId!, null)}
                className="text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--accent-red-text)] transition-colors"
              >
                [rm]
              </button>
            )}
          </div>
          <div className="p-2">
            <div
              className={cn(
                "relative w-full aspect-square bg-[var(--bg-base)] border border-[var(--border)] overflow-hidden",
                canManageIcon && "cursor-pointer group/avatar",
              )}
              onClick={canManageIcon ? () => avatarInputRef.current?.click() : undefined}
            >
              {activeServer.iconUrl ? (
                <img src={activeServer.iconUrl} className="w-full h-full object-cover" alt="" />
              ) : (
                <div className="w-full h-full flex items-center justify-center font-mono text-base text-[var(--text-muted)] select-none">
                  {activeServer.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              {canManageIcon && (
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/avatar:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="text-[10px] font-mono text-white">[edit]</span>
                </div>
              )}
            </div>
            {canManageIcon && (
              <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            )}
          </div>
        </div>
        </div>
      </div>

      {voiceError && (
        <div className="mx-2 mt-2 px-2 py-1.5 border border-[var(--destructive)]/30 text-xs text-[var(--accent-red-text)] flex items-center justify-between gap-1">
          <span className="truncate prefix-error">{voiceError}</span>
          <button onClick={() => setVoiceError(null)} className="shrink-0 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        <div className="flex items-center justify-between gap-1 mb-2 pr-1">
          {canCreateChannel ? (
            <button
              onClick={() => setShowCreateCategory(true)}
              aria-label={t("category.create")}
              className="p-1 hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
          ) : <span />}
          {canCreateChannel && (
            <button
              onClick={() => openCreateChannel(undefined)}
              aria-label={t("createChannel.title")}
              className="p-1 hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {showCreateCategory && (
          <div className="flex items-center gap-1.5 mb-2 px-2 py-1.5 border border-[var(--accent-red)]/60 bg-[var(--bg-elevated)]">
            <FolderPlus className="w-3 h-3 text-[var(--text-muted)] flex-shrink-0" />
            <input
              ref={newCategoryInputRef}
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder={t("category.namePlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); void commitCreateCategory(); }
                if (e.key === "Escape") { setShowCreateCategory(false); setNewCategoryName(""); }
              }}
              onBlur={() => void commitCreateCategory()}
              className="flex-1 min-w-0 bg-transparent text-sm text-[var(--text-primary)] outline-none font-mono"
            />
          </div>
        )}

        {/* Uncategorized channels — flat list, no header, like Discord's root bucket */}
        {renderCategoryChannels(null)}

        {serverCategories.map((category) => {
          const collapsed = collapsedCategories[category.id];
          const dropAbove = dragOverCategory?.id === category.id && dragOverCategory.position === "above";
          const dropBelow = dragOverCategory?.id === category.id && dragOverCategory.position === "below";
          return (
            <div key={category.id} className="mt-3">
              <div
                className={cn(
                  "flex items-center justify-between hover:text-[var(--text-primary)] transition-colors mb-1 pr-1 group",
                  dropAbove && "border-t-2 border-t-[var(--accent-red)]",
                  dropBelow && "border-b-2 border-b-[var(--accent-red)]",
                )}
                draggable={canManageChannels && renamingCategoryId !== category.id}
                onDragStart={(e) => { e.stopPropagation(); setDraggedCategoryId(category.id); }}
                onDragEnd={() => { setDraggedCategoryId(null); setDragOverCategory(null); }}
                onDragOver={(e) => {
                  if (!draggedCategoryId || draggedCategoryId === category.id) return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const position = e.clientY - rect.top > rect.height / 2 ? "below" : "above";
                  setDragOverCategory({ id: category.id, position });
                }}
                onDrop={(e) => {
                  if (!draggedCategoryId) return;
                  e.preventDefault();
                  handleCategoryDrop(category.id, dragOverCategory?.position === "below");
                }}
              >
                {renamingCategoryId === category.id ? (
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); void commitCategoryRename(); }
                      if (e.key === "Escape") { setRenamingCategoryId(null); setRenameValue(""); }
                    }}
                    onBlur={() => void commitCategoryRename()}
                    className="flex-1 min-w-0 bg-transparent text-xs text-[var(--text-primary)] outline-none font-mono uppercase tracking-wider"
                  />
                ) : (
                  <button
                    onClick={() => toggleCategory(category.id)}
                    onDoubleClick={canRenameChannel ? (e) => {
                      e.preventDefault();
                      setRenamingCategoryId(category.id);
                      setRenameValue(category.name);
                    } : undefined}
                    className="flex items-center gap-1 flex-1 text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium"
                  >
                    <ChevronDown className={cn("w-3 h-3 transition-transform", collapsed && "-rotate-90")} />
                    <span className="truncate">{category.name}</span>
                  </button>
                )}
                <div className="flex items-center gap-0.5">
                  {confirmDeleteCategoryId === category.id ? (
                    <>
                      <button
                        onClick={() => { void deleteCategory(category.id); setConfirmDeleteCategoryId(null); }}
                        className="px-1 py-0.5 bg-[var(--destructive)] text-white hover:opacity-90 transition-opacity text-[10px]"
                      >
                        {t("message.delete")}
                      </button>
                      <button onClick={() => setConfirmDeleteCategoryId(null)} className="p-0.5 hover:text-[var(--text-primary)] transition-colors">
                        <X className="w-3 h-3" />
                      </button>
                    </>
                  ) : (
                    <>
                      {canCreateChannel && (
                        <button
                          onClick={() => openCreateChannel(category.id)}
                          className="opacity-0 group-hover:opacity-100 hover:text-[var(--text-primary)] transition-all p-0.5"
                        >
                          <Plus className="w-3 h-3 text-[var(--text-muted)]" />
                        </button>
                      )}
                      {canDeleteChannelPerm && (
                        <button
                          onClick={() => setConfirmDeleteCategoryId(category.id)}
                          className="opacity-0 group-hover:opacity-100 hover:text-[var(--accent-red-text)] transition-all p-0.5"
                        >
                          <Trash2 className="w-3 h-3 text-[var(--text-muted)]" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {!collapsed && renderCategoryChannels(category.id)}
            </div>
          );
        })}
      </div>
      <UserBar />
      
      {activeServer && (
        <CreateChannelModal
          isOpen={showCreateChannel}
          onClose={() => setShowCreateChannel(false)}
          serverId={activeServer.id}
          categoryId={createChannelCategoryId}
        />
      )}
      {activeServer && canManage && (
        <InviteUserModal
          isOpen={showInviteUser}
          onClose={() => setShowInviteUser(false)}
          serverId={activeServer.id}
          serverName={activeServer.name}
        />
      )}
      {activeServer && showRoleManager && (
        <RoleManagerModal
          serverId={activeServer.id}
          onClose={() => setShowRoleManager(false)}
        />
      )}

      {ctxMenu && (
        <VoiceUserContextMenu ctx={ctxMenu} onClose={() => setCtxMenu(null)} />
      )}
    </div>
  );
}

