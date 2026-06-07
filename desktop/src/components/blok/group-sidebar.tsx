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
} from "lucide-react";
import { useServerStore } from "@/lib/store/server-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { UserAvatar } from "./user-avatar";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { playSound } from "@/lib/sounds";
import { UserBar } from "./user-bar";
import { useI18n } from "@/lib/i18n";
import { CreateChannelModal } from "./create-channel-modal";
import { InviteUserModal } from "./invite-user-modal";
import { RoleManagerModal } from "./role-manager-modal";
import { can } from "@/lib/permission";

export function GroupSidebar() {
  const { t } = useI18n();
  const {
    servers,
    activeServerId,
    channels,
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
    userVolumes,
    locallyMuted,
    setUserVolume,
    setLocalMute,
    isCameraOn,
    cameraUsers,
    updateServerIcon,
    renameChannel,
    renameServer,
  } = useServerStore();
  const { user } = useAuthStore();
  const [expandedSections, setExpandedSections] = useState({
    text: true,
    voice: true,
  });

  const activeServer = servers.find((s) => s.id === activeServerId);
  const serverChannels = activeServerId ? channels[activeServerId] || [] : [];

  const textChannels = serverChannels.filter((c) => c.type === "text");
  const voiceChannels = serverChannels.filter((c) => c.type === "voice");

  // Local state for modal
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [channelModalType, setChannelModalType] = useState<"text" | "voice">("text");
  const [showRoleManager, setShowRoleManager] = useState(false);

  // Resolve current user's role in this server
  const serverMembers = activeServerId ? members[activeServerId] ?? [] : [];
  const myMember = serverMembers.find((m) => m.userId === user?.id);
  const myRole = myMember?.roleId
    ? (roles[activeServerId ?? ""] ?? []).find((r) => r.id === myMember.roleId) ?? null
    : null;
  const roleCtx = { userId: user?.id, server: activeServer ?? null, role: myRole };

  const canManage       = can("manage_server",      roleCtx);
  const canRenameChannel= can("rename_channel",     roleCtx);
  const canRenameServer = can("rename_server",      roleCtx);
  const canManageIcon   = can("manage_server_icon", roleCtx);

  const [showInviteUser, setShowInviteUser] = useState(false);
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
  const [renamingChannelId, setRenamingChannelId] = useState<string | null>(null);
  const [renamingServer, setRenamingServer] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const serverRenameInputRef = useRef<HTMLInputElement>(null);

  type CtxMenu = { userId: string; name: string; x: number; y: number };
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [ctxMenu]);

  useEffect(() => {
    if (renamingChannelId) renameInputRef.current?.focus();
  }, [renamingChannelId]);

  useEffect(() => {
    if (renamingServer) serverRenameInputRef.current?.focus();
  }, [renamingServer]);

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
          playSound("join");
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
    playSound("leave");
  };

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
      <div className="p-3 border-b border-[var(--border)]">
        <div className="flex items-center justify-between">
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
              title={canRenameServer ? "Double-click to rename" : undefined}
            >
              <span className="text-[var(--text-muted)] font-normal mr-1">$</span>{activeServer.name}
            </h2>
          )}
          <div className="flex items-center gap-1">
            {canManage && (
              <button
                onClick={() => setShowInviteUser(true)}
                title={t("invite.addMember")}
                className="p-1 hover:bg-[var(--bg-hover)] transition-colors"
              >
                <UserPlus className="w-4 h-4 text-[var(--text-muted)]" />
              </button>
            )}
            {canManage && (
              <button
                onClick={() => setShowRoleManager(true)}
                title="Roles & Permissions"
                className="p-1 hover:bg-[var(--bg-hover)] transition-colors"
              >
                <Settings className="w-4 h-4 text-[var(--text-muted)]" />
              </button>
            )}
          </div>
        </div>
        {activeServer.description && (
          <p className="text-xs text-[var(--text-muted)] mt-1 truncate">
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
                className="text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--destructive)] transition-colors"
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

      {voiceError && (
        <div className="mx-2 mt-2 px-2 py-1.5 border border-[var(--destructive)]/30 text-xs text-[var(--destructive)] flex items-center justify-between gap-1">
          <span className="truncate prefix-error">{voiceError}</span>
          <button onClick={() => setVoiceError(null)} className="shrink-0 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        <div className="mb-4">
          <div className="flex items-center justify-between hover:text-[var(--text-primary)] transition-colors mb-1 pr-1 group">
            <button
              onClick={() =>
                setExpandedSections((s) => ({ ...s, text: !s.text }))
              }
              className="flex items-center gap-1 flex-1 text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium"
            >
              <ChevronDown
                className={cn(
                  "w-3 h-3 transition-transform",
                  !expandedSections.text && "-rotate-90",
                )}
              />
              <span className="text-[var(--text-muted)] opacity-60">$</span>
              {t("group.textChannels")}
            </button>
            {canManage && (
              <button
                onClick={() => {
                  setChannelModalType("text");
                  setShowCreateChannel(true);
                }}
                className="opacity-0 group-hover:opacity-100 hover:text-[var(--text-primary)] transition-all p-0.5"
              >
                <Plus className="w-3 h-3 text-[var(--text-muted)]" />
              </button>
            )}
          </div>

          {expandedSections.text && (
            <div className="space-y-1">
              {textChannels.map((channel) => (
                <div key={channel.id} className="group/ch relative">
                  {confirmDeleteChannelId === channel.id ? (
                    <div className="flex items-center gap-1 px-2 py-1.5 bg-[var(--bg-elevated)] border border-[var(--destructive)]/40 text-xs">
                      <span className="text-[var(--destructive)] truncate flex-1">
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
                  ) : renamingChannelId === channel.id ? (
                    <div className="flex items-center gap-1.5 w-full px-2 py-1.5 border border-[var(--accent-red)]/60 bg-[var(--bg-elevated)]">
                      <span className="text-[var(--text-muted)] flex-shrink-0 font-mono">#</span>
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
                      onClick={() => setActiveChannel(channel.id)}
                      onDoubleClick={canRenameChannel ? (e) => {
                        e.preventDefault();
                        setRenamingChannelId(channel.id);
                        setRenameValue(channel.name);
                      } : undefined}
                      className={cn(
                        "flex items-center gap-1.5 w-full px-2 py-1.5 text-sm transition-all duration-150 text-left border",
                        activeChannelId === channel.id
                          ? "border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[inset_2px_0_0_var(--accent-red)]"
                          : "border-dashed border-[var(--border)] text-[var(--text-muted)] hover:border-solid hover:border-white/30 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                      )}
                    >
                      <span className="text-[var(--text-muted)] flex-shrink-0 font-mono">#</span>
                      <span className="truncate flex-1 min-w-0">{channel.name}</span>
                      {(unreadCounts[channel.id] ?? 0) > 0 && (
                        <span className="flex-shrink-0 min-w-[18px] h-[18px] flex items-center justify-center bg-[var(--accent-red)] text-[10px] text-white font-bold px-1">
                          {unreadCounts[channel.id] > 99 ? "99+" : unreadCounts[channel.id]}
                        </span>
                      )}
                      {canManage && (
                        <span
                          role="button"
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteChannelId(channel.id); }}
                          className="opacity-0 group-hover/ch:opacity-100 p-0.5 hover:text-[var(--destructive)] transition-all"
                        >
                          <Trash2 className="w-3 h-3" />
                        </span>
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between hover:text-[var(--text-primary)] transition-colors mb-1 pr-1 group">
            <button
              onClick={() =>
                setExpandedSections((s) => ({ ...s, voice: !s.voice }))
              }
              className="flex items-center gap-1 flex-1 text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium"
            >
              <ChevronDown
                className={cn(
                  "w-3 h-3 transition-transform",
                  !expandedSections.voice && "-rotate-90",
                )}
              />
              <span className="text-[var(--text-muted)] opacity-60">$</span>
              {t("group.voiceRooms")}
            </button>
            {canManage && (
              <button
                onClick={() => {
                  setChannelModalType("voice");
                  setShowCreateChannel(true);
                }}
                className="opacity-0 group-hover:opacity-100 hover:text-[var(--text-primary)] transition-all p-0.5"
              >
                <Plus className="w-3 h-3 text-[var(--text-muted)] hover:text-[var(--text-primary)]" />
              </button>
            )}
          </div>

          {expandedSections.voice && (
            <div className="space-y-1">
              {voiceChannels.map((channel) => {
                const isInChannel = activeVoiceChannelId === channel.id;
                const participants = voiceParticipants[channel.id] || [];

                return (
                  <div key={channel.id}>
                    {renamingChannelId === channel.id ? (
                      <div className="flex items-center gap-1.5 w-full px-2 py-1.5 border border-[var(--online)]/60 bg-[var(--bg-elevated)]">
                        <span className="flex-shrink-0 font-mono text-xs text-[var(--text-muted)]">♪</span>
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
                      onClick={() => void handleVoiceChannelClick(channel.id)}
                      onDoubleClick={canRenameChannel ? (e) => {
                        e.preventDefault();
                        setRenamingChannelId(channel.id);
                        setRenameValue(channel.name);
                      } : undefined}
                      disabled={joiningChannel === channel.id}
                      className={cn(
                        "flex items-center gap-2 w-full px-2 py-1.5 text-sm transition-all duration-150 border",
                        isInChannel
                          ? "border-[var(--online)]/40 bg-[var(--bg-elevated)] text-[var(--online)] shadow-[inset_2px_0_0_var(--online)]"
                          : "border-dashed border-[var(--border)] text-[var(--text-muted)] hover:border-solid hover:border-white/30 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                        joiningChannel === channel.id && "opacity-60 cursor-wait",
                      )}
                    >
                      <span className={cn("flex-shrink-0 font-mono text-xs", isInChannel ? "text-[var(--online)]" : "text-[var(--text-muted)]")}>♪</span>
                      <span className="truncate flex-1 text-left">
                        {channel.name}
                      </span>
                      {joiningChannel === channel.id && (
                        <span className="text-[10px] text-[var(--text-muted)] animate-pulse">…</span>
                      )}
                      {isInChannel && !joiningChannel && (
                        <span
                          role="button"
                          onClick={(e) => void handleLeaveVoice(e)}
                          title="Leave voice"
                          className="p-0.5 hover:text-[var(--destructive)] transition-colors"
                        >
                          <PhoneOff className="w-3 h-3 text-[var(--destructive)]" />
                        </span>
                      )}
                    </button>
                    )}

                    {participants.length > 0 && (
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
                              <div
                                className={cn(
                                  "rounded-full transition-all",
                                  participant.isSpeaking &&
                                    "ring-2 ring-[var(--online)] ring-offset-1 ring-offset-[var(--bg-surface)]",
                                )}
                              >
                                <UserAvatar user={displayUser} size="xs" />
                              </div>
                              <span
                                className={cn(
                                  "truncate transition-colors",
                                  participant.isSpeaking && "text-[var(--online)]",
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
                                    title="View screen share"
                                    className="hover:text-[var(--online)] transition-colors"
                                  >
                                    <Monitor className="w-3 h-3 text-[var(--online)]" />
                                  </button>
                                )}
                                {(participant.userId === user?.id ? isCameraOn : !!cameraUsers[participant.userId]) && (
                                  <Video className="w-3 h-3 text-[var(--online)]" />
                                )}
                                {(participant.isMuted || participant.isDeafened) && (
                                  <MicOff className="w-3 h-3 text-[var(--destructive)]" />
                                )}
                                {participant.isDeafened && (
                                  <VolumeX className="w-3 h-3 text-[var(--destructive)]" />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <UserBar />
      
      {activeServer && (
        <CreateChannelModal
          isOpen={showCreateChannel}
          onClose={() => setShowCreateChannel(false)}
          serverId={activeServer.id}
          initialType={channelModalType}
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

      {ctxMenu && createPortal(
        <div
          ref={ctxMenuRef}
          style={{ position: "fixed", left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999 }}
          className="w-52 bg-[var(--bg-elevated)] border border-[var(--border)] shadow-xl py-2 px-3 space-y-3"
        >
          <p className="text-[11px] font-semibold text-[var(--text-muted)] truncate">{ctxMenu.name}</p>

          {/* Volume slider */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[var(--text-muted)]">{t("voice.ctx.volume")}</span>
              <span className="text-[11px] font-mono text-[var(--text-primary)]">
                {userVolumes[ctxMenu.userId] ?? 100}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              step={5}
              value={userVolumes[ctxMenu.userId] ?? 100}
              onChange={(e) => setUserVolume(ctxMenu.userId, Number(e.target.value))}
              className="w-full h-1 accent-[var(--online)] cursor-pointer"
            />
            <div className="flex justify-between text-[9px] text-[var(--text-muted)] opacity-50">
              <span>0</span><span>100</span><span>200</span>
            </div>
          </div>

          {/* Local mute toggle */}
          <button
            onClick={() => {
              setLocalMute(ctxMenu.userId, !locallyMuted[ctxMenu.userId]);
              setCtxMenu(null);
            }}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1.5 text-[12px] transition-colors",
              locallyMuted[ctxMenu.userId]
                ? "bg-[var(--destructive)] bg-opacity-15 text-[var(--destructive)] hover:bg-opacity-25"
                : "hover:bg-[var(--bg-hover)] text-[var(--text-primary)]"
            )}
          >
            <VolumeX className="w-3.5 h-3.5 flex-shrink-0" />
            {locallyMuted[ctxMenu.userId] ? t("voice.ctx.unmute") : t("voice.ctx.mute")}
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

