import { useState, useEffect, useRef } from "react";
import { X, Plus, Trash2, Shield, Users, UserX, Ban, ScrollText, RotateCcw } from "lucide-react";
import { createPortal } from "react-dom";
import { useServerStore } from "@/lib/store/server-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { Perm } from "@/lib/permission";
import { UserAvatar } from "./user-avatar";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n";
import type { Role, AuditEntry } from "@/lib/store/types";
import { formatSlowmode } from "@/lib/moderation";

interface RoleManagerModalProps {
  serverId: string;
  onClose: () => void;
}

type Tab = "roles" | "members" | "bans" | "audit";

const PERM_GROUPS: { titleKey: TranslationKey; perms: { flag: number; labelKey: TranslationKey }[] }[] = [
  {
    titleKey: "roles.permGroup.general",
    perms: [
      { flag: Perm.MANAGE_SERVER,      labelKey: "roles.perm.manageServer" },
      { flag: Perm.RENAME_SERVER,      labelKey: "roles.perm.renameServer" },
      { flag: Perm.MANAGE_SERVER_ICON, labelKey: "roles.perm.manageServerIcon" },
      { flag: Perm.INVITE_MEMBER,      labelKey: "roles.perm.inviteMembers" },
    ],
  },
  {
    titleKey: "roles.permGroup.channels",
    perms: [
      { flag: Perm.CREATE_CHANNEL,  labelKey: "roles.perm.createChannels" },
      { flag: Perm.DELETE_CHANNEL,  labelKey: "roles.perm.deleteChannels" },
      { flag: Perm.RENAME_CHANNEL,  labelKey: "roles.perm.renameChannels" },
      { flag: Perm.MANAGE_CHANNELS, labelKey: "roles.perm.manageChannels" },
    ],
  },
  {
    titleKey: "roles.permGroup.moderation",
    perms: [
      { flag: Perm.MODERATE_MEMBERS, labelKey: "roles.perm.moderateMembers" },
      { flag: Perm.BAN_MEMBER,       labelKey: "roles.perm.banMembers" },
    ],
  },
  {
    titleKey: "roles.permGroup.roles",
    perms: [
      { flag: Perm.MANAGE_ROLES, labelKey: "roles.perm.manageRoles" },
    ],
  },
];

const ALL_PERMS = PERM_GROUPS.flatMap((g) => g.perms);

const PRESET_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#3b82f6", "#8b5cf6", "#ec4899", "#6b7280",
];

export function RoleManagerModal({ serverId, onClose }: RoleManagerModalProps) {
  const {
    roles, members, createRole, updateRole, deleteRole, assignRole, kickMember,
    bans, auditLog, loadBans, loadAuditLog, unbanMember, channelIndex, userProfileCache,
  } = useServerStore();
  const { user } = useAuthStore();
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("roles");
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#6b7280");
  const [editPerms, setEditPerms] = useState(0);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");

  type MemberCtx = { memberId: string; username: string; x: number; y: number };
  const [memberCtx, setMemberCtx] = useState<MemberCtx | null>(null);
  const memberCtxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!memberCtx) return;
    const close = (e: MouseEvent) => {
      if (memberCtxRef.current && !memberCtxRef.current.contains(e.target as Node))
        setMemberCtx(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [memberCtx]);

  const serverRoles = roles[serverId] ?? [];
  const serverMembers = members[serverId] ?? [];
  const selectedRole = serverRoles.find((r) => r.id === selectedRoleId) ?? null;
  const serverBans = bans[serverId] ?? [];
  const serverAudit = auditLog[serverId] ?? [];

  useEffect(() => {
    if (tab === "bans") void loadBans(serverId);
    if (tab === "audit") void loadAuditLog(serverId);
  }, [tab, serverId, loadBans, loadAuditLog]);

  const openRole = (role: Role) => {
    setSelectedRoleId(role.id);
    setEditName(role.name);
    setEditColor(role.color ?? "#6b7280");
    setEditPerms(role.permissions);
  };

  const handleSaveRole = async () => {
    if (!selectedRoleId) return;
    setSaving(true);
    try {
      await updateRole(selectedRoleId, serverId, { name: editName, color: editColor, permissions: editPerms });
    } finally {
      setSaving(false);
    }
  };

  const handleCreateRole = async () => {
    if (!newRoleName.trim()) return;
    setSaving(true);
    try {
      await createRole({ serverId, name: newRoleName.trim(), permissions: 0 });
      setNewRoleName("");
      setCreating(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRole = async (roleId: string) => {
    await deleteRole(roleId, serverId);
    if (selectedRoleId === roleId) setSelectedRoleId(null);
  };

  const togglePerm = (flag: number) =>
    setEditPerms((p) => (p & flag ? p & ~flag : p | flag));

  const AuditRow = ({ entry }: { entry: AuditEntry }) => {
    const actorName = entry.actor?.username ?? entry.actorId?.slice(0, 8) ?? "system";
    const isChannelTarget = entry.action === "slowmode";
    const targetName = isChannelTarget
      ? (entry.targetId ? `#${channelIndex[entry.targetId]?.name ?? entry.targetId.slice(0, 8)}` : "")
      : `@${userProfileCache[entry.targetId ?? ""]?.username
          ?? serverMembers.find((m) => m.userId === entry.targetId)?.user?.username
          ?? entry.targetId?.slice(0, 8) ?? ""}`;
    const actionLabel = t(`audit.action.${entry.action}` as TranslationKey);
    const detail =
      entry.action === "timeout" ? `${entry.meta.minutes ?? 0}m`
      : entry.action === "slowmode" ? formatSlowmode(entry.meta.seconds ?? 0)
      : entry.action === "ban" && entry.meta.reason ? `— ${entry.meta.reason}`
      : "";
    const when = new Date(entry.createdAt).toLocaleString();
    const color = entry.action === "ban" ? "text-[var(--destructive)]"
      : entry.action === "unban" ? "text-[var(--online)]"
      : "text-[var(--text-muted)]";
    return (
      <div className="flex items-start gap-2 px-3 py-2 text-xs border-b border-[var(--border)]/40">
        <ScrollText className={cn("w-3 h-3 mt-0.5 flex-shrink-0", color)} />
        <div className="flex-1 min-w-0">
          <p className="text-[var(--text-primary)] break-words">
            <span className="font-medium">@{actorName}</span>{" "}
            <span className={color}>{actionLabel}</span>{" "}
            <span className="font-medium">{targetName}</span>
            {detail && <span className="text-[var(--text-muted)]"> {detail}</span>}
          </p>
          <p className="text-[10px] text-[var(--text-muted)]">{when}</p>
        </div>
      </div>
    );
  };

  const isDirty = selectedRole &&
    (editName !== selectedRole.name || editColor !== (selectedRole.color ?? "#6b7280") || editPerms !== selectedRole.permissions);

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: "82vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0 bg-[var(--bg-surface)]/40">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--accent-red)]/12 border border-[var(--accent-red)]/25">
              <Shield className="w-4 h-4 text-[var(--accent-red)]" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold text-[var(--text-primary)]">{t("roles.title")}</span>
              <span className="text-[11px] text-[var(--text-muted)] font-mono">
                {serverRoles.length} {serverRoles.length === 1 ? t("roles.roleSingular") : t("roles.rolePlural")} · {serverMembers.length} {t("roles.membersLower")}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--border)] flex-shrink-0">
          {(["roles", "members", "bans", "audit"] as Tab[]).map((tabId) => {
            const icon = tabId === "roles" ? <Shield className="w-3 h-3" />
              : tabId === "members" ? <Users className="w-3 h-3" />
              : tabId === "bans" ? <Ban className="w-3 h-3" />
              : <ScrollText className="w-3 h-3" />;
            const labelKey: TranslationKey = tabId === "roles" ? "roles.tab.roles"
              : tabId === "members" ? "roles.tab.members"
              : tabId === "bans" ? "roles.tab.bans"
              : "roles.tab.audit";
            return (
              <button
                key={tabId}
                onClick={() => setTab(tabId)}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2",
                  tab === tabId
                    ? "border-[var(--accent-red)] text-[var(--accent-red)]"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                )}
              >
                {icon}
                {t(labelKey)}
              </button>
            );
          })}
        </div>

        {tab === "roles" && (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Role list */}
            <div className="w-44 flex-shrink-0 border-r border-[var(--border)] flex flex-col">
              <div className="flex-1 overflow-y-auto py-2">
                {serverRoles.map((role) => {
                  const memberCount = serverMembers.filter((m) => m.roleId === role.id).length;
                  return (
                    <button
                      key={role.id}
                      onClick={() => openRole(role)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left group relative",
                        selectedRoleId === role.id
                          ? "bg-[var(--bg-hover)] text-[var(--text-primary)] before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:bg-[var(--accent-red)]"
                          : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      )}
                    >
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0 ring-1 ring-inset ring-black/20"
                        style={{ backgroundColor: role.color ?? "#6b7280" }}
                      />
                      <span className="flex-1 truncate">{role.name}</span>
                      {memberCount > 0 && (
                        <span className="flex items-center gap-0.5 text-[10px] text-[var(--text-muted)] opacity-70 group-hover:opacity-0 transition-opacity flex-shrink-0">
                          <Users className="w-2.5 h-2.5" />
                          {memberCount}
                        </span>
                      )}
                      <span
                        role="button"
                        onClick={(e) => { e.stopPropagation(); void handleDeleteRole(role.id); }}
                        className="absolute right-2 opacity-0 group-hover:opacity-100 p-0.5 hover:text-[var(--destructive)] transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="p-2 border-t border-[var(--border)]">
                {creating ? (
                  <div className="flex flex-col gap-1">
                    <input
                      autoFocus
                      value={newRoleName}
                      onChange={(e) => setNewRoleName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void handleCreateRole(); if (e.key === "Escape") setCreating(false); }}
                      placeholder={t("roles.roleNamePlaceholder")}
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded px-2 py-1 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-red)]"
                    />
                    <div className="flex gap-1">
                      <button
                        onClick={() => void handleCreateRole()}
                        disabled={saving || !newRoleName.trim()}
                        className="flex-1 py-1 text-[12px] bg-[var(--accent-red)] text-white rounded disabled:opacity-50"
                      >
                        {saving ? "…" : t("roles.create")}
                      </button>
                      <button
                        onClick={() => setCreating(false)}
                        className="flex-1 py-1 text-[12px] bg-[var(--bg-surface)] text-[var(--text-muted)] rounded hover:text-[var(--text-primary)]"
                      >
                        {t("roles.cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setCreating(true)}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    {t("roles.newRole")}
                  </button>
                )}
              </div>
            </div>

            {/* Role editor */}
            <div className="flex-1 overflow-y-auto p-5">
              {!selectedRole ? (
                <div className="flex items-center justify-center h-full text-xs text-[var(--text-muted)]">
                  {t("roles.selectRole")}
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Live preview chip */}
                  <div className="flex items-center gap-2 pb-1">
                    <span className="text-[11px] text-[var(--text-muted)] font-mono">{t("roles.preview")}</span>
                    <span
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium max-w-[200px]"
                      style={{
                        backgroundColor: (editColor || "#6b7280") + "22",
                        color: editColor || "#6b7280",
                        border: `1px solid ${(editColor || "#6b7280")}55`,
                      }}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: editColor || "#6b7280" }} />
                      <span className="truncate">{editName || t("roles.roleName")}</span>
                    </span>
                  </div>

                  <div>
                    <label className="block text-[12px] text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                      {t("roles.roleName")}
                    </label>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-red)] transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-[12px] text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                      {t("roles.color")}
                    </label>
                    <div className="flex items-center gap-2 flex-wrap">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => setEditColor(c)}
                          className={cn(
                            "w-6 h-6 rounded-full transition-transform hover:scale-110",
                            editColor === c && "ring-2 ring-white ring-offset-1 ring-offset-[var(--bg-elevated)] scale-110"
                          )}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                      <label className="relative w-6 h-6 rounded-full overflow-hidden cursor-pointer ring-1 ring-[var(--border)] flex items-center justify-center" title={t("roles.customColor")}>
                        <input
                          type="color"
                          value={editColor}
                          onChange={(e) => setEditColor(e.target.value)}
                          className="absolute inset-0 w-[150%] h-[150%] -translate-x-2 -translate-y-2 cursor-pointer border-0 p-0 bg-transparent"
                        />
                        <Plus className="w-3 h-3 text-white mix-blend-difference pointer-events-none" />
                      </label>
                      <span className="ml-1 text-[11px] font-mono text-[var(--text-muted)] uppercase">{editColor}</span>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-[12px] text-[var(--text-muted)] uppercase tracking-wider">
                        {t("roles.permissions")}
                      </label>
                      <span className="text-[11px] font-mono text-[var(--text-muted)]">
                        {ALL_PERMS.filter((p) => editPerms & p.flag).length}/{ALL_PERMS.length}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {PERM_GROUPS.map((group) => (
                        <div key={group.titleKey}>
                          <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] opacity-60 mb-1 px-1">
                            {t(group.titleKey)}
                          </p>
                          <div className="rounded-lg border border-[var(--border)] overflow-hidden divide-y divide-[var(--border)]/50">
                            {group.perms.map(({ flag, labelKey }) => {
                              const has = !!(editPerms & flag);
                              return (
                                <button
                                  key={flag}
                                  role="checkbox"
                                  aria-checked={has}
                                  onClick={() => togglePerm(flag)}
                                  className={cn(
                                    "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors group",
                                    has ? "bg-[var(--accent-red)]/5" : "hover:bg-[var(--bg-hover)]"
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "w-4 h-4 rounded border transition-colors flex-shrink-0 flex items-center justify-center",
                                      has
                                        ? "bg-[var(--accent-red)] border-[var(--accent-red)]"
                                        : "border-[var(--border)] bg-[var(--bg-surface)] group-hover:border-[var(--text-muted)]"
                                    )}
                                  >
                                    {has && <span className="text-white text-[12px] leading-none">✓</span>}
                                  </span>
                                  <span className={cn(
                                    "text-xs transition-colors",
                                    has ? "text-[var(--text-primary)]" : "text-[var(--text-muted)] group-hover:text-[var(--text-primary)]"
                                  )}>
                                    {t(labelKey)}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-1">
                    <button
                      onClick={() => void handleSaveRole()}
                      disabled={saving || !isDirty}
                      className="px-4 py-2 text-xs bg-[var(--accent-red)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {saving ? t("roles.saving") : t("roles.saveChanges")}
                    </button>
                    {isDirty && (
                      <span className="text-[11px] text-[var(--text-muted)] font-mono">{t("roles.unsaved")}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "members" && (
          <div className="flex-1 overflow-y-auto p-4">
            {serverMembers.length === 0 ? (
              <div className="text-xs text-[var(--text-muted)] text-center py-8">{t("roles.noMembers")}</div>
            ) : (
              <div className="space-y-1">
                {serverMembers.map((member) => {
                  const memberRole = member.roleId
                    ? serverRoles.find((r) => r.id === member.roleId)
                    : null;
                  const isCurrentUser = member.userId === user?.id;
                  return (
                    <div
                      key={member.id}
                      className="flex items-center gap-3 px-3 py-2 rounded hover:bg-[var(--bg-hover)] transition-colors"
                      onContextMenu={isCurrentUser ? undefined : (e) => {
                        e.preventDefault();
                        setMemberCtx({ memberId: member.id, username: member.user?.username ?? member.userId, x: e.clientX, y: e.clientY });
                      }}
                    >
                      <UserAvatar user={member.user} size="sm" className="flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                            @{member.user?.username ?? member.userId}
                          </span>
                          {memberRole && (
                            <span
                              className="text-[12px] px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                              style={{ backgroundColor: (memberRole.color ?? "#6b7280") + "33", color: memberRole.color ?? "#6b7280" }}
                            >
                              {memberRole.name}
                            </span>
                          )}
                        </div>
                        {member.user?.displayName && (
                          <span className="text-[12px] text-[var(--text-muted)] truncate block">{member.user.displayName}</span>
                        )}
                      </div>
                      <select
                        value={member.roleId ?? ""}
                        onChange={(e) => void assignRole(member.id, serverId, e.target.value || null)}
                        disabled={isCurrentUser}
                        className="text-[12px] bg-[var(--bg-surface)] border border-[var(--border)] rounded px-1.5 py-1 text-[var(--text-muted)] outline-none focus:border-[var(--accent-red)] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="">{t("roles.noRole")}</option>
                        {serverRoles.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "bans" && (
          <div className="flex-1 overflow-y-auto p-4">
            {serverBans.length === 0 ? (
              <div className="text-xs text-[var(--text-muted)] text-center py-8">{t("bans.empty")}</div>
            ) : (
              <div className="space-y-1">
                {serverBans.map((ban) => (
                  <div key={ban.userId} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-[var(--bg-hover)] transition-colors">
                    <UserAvatar user={ban.user} size="sm" className="flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium text-[var(--text-primary)] truncate block">
                        @{ban.user?.username ?? ban.userId.slice(0, 8)}
                      </span>
                      {ban.reason && (
                        <span className="text-[12px] text-[var(--text-muted)] truncate block">{ban.reason}</span>
                      )}
                    </div>
                    <button
                      onClick={() => void unbanMember(serverId, ban.userId)}
                      className="flex items-center gap-1 text-[12px] px-2 py-1 border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--online)] hover:border-[var(--online)]/40 transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" />
                      {t("bans.unban")}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "audit" && (
          <div className="flex-1 overflow-y-auto p-4">
            {serverAudit.length === 0 ? (
              <div className="text-xs text-[var(--text-muted)] text-center py-8">{t("audit.empty")}</div>
            ) : (
              <div className="space-y-0.5">
                {serverAudit.map((e) => <AuditRow key={e.id} entry={e} />)}
              </div>
            )}
          </div>
        )}
      </div>

      {memberCtx && createPortal(
        <div
          ref={memberCtxRef}
          style={{ position: "fixed", left: memberCtx.x, top: memberCtx.y, zIndex: 99999 }}
          className="w-44 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg shadow-xl py-1"
        >
          <div className="px-3 py-1.5 text-[12px] text-[var(--text-muted)] border-b border-[var(--border)] truncate">
            @{memberCtx.username}
          </div>
          <button
            onClick={() => {
              void kickMember(memberCtx.memberId, serverId);
              setMemberCtx(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[var(--destructive)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <UserX className="w-3.5 h-3.5 flex-shrink-0" />
            {t("roles.kick")}
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
