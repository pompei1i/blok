import { useState } from "react";
import { X, Plus, Trash2, Shield, Users } from "lucide-react";
import { useServerStore } from "@/lib/store/server-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { Perm } from "@/lib/permission";
import { UserAvatar } from "./user-avatar";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/store/types";

interface RoleManagerModalProps {
  serverId: string;
  onClose: () => void;
}

type Tab = "roles" | "members";

const PERM_LABELS: { flag: number; label: string }[] = [
  { flag: Perm.INVITE_MEMBER,  label: "Invite Members" },
  { flag: Perm.CREATE_CHANNEL, label: "Create Channels" },
  { flag: Perm.DELETE_CHANNEL, label: "Delete Channels" },
  { flag: Perm.PIN_MESSAGE,    label: "Pin Messages" },
  { flag: Perm.MANAGE_SERVER,  label: "Manage Server" },
  { flag: Perm.MANAGE_ROLES,   label: "Manage Roles" },
  { flag: Perm.KICK_MEMBER,    label: "Kick Members" },
];

const PRESET_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#3b82f6", "#8b5cf6", "#ec4899", "#6b7280",
];

export function RoleManagerModal({ serverId, onClose }: RoleManagerModalProps) {
  const { roles, members, createRole, updateRole, deleteRole, assignRole, kickMember } = useServerStore();
  const { user } = useAuthStore();
  const [tab, setTab] = useState<Tab>("roles");
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#6b7280");
  const [editPerms, setEditPerms] = useState(0);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");

  const serverRoles = roles[serverId] ?? [];
  const serverMembers = members[serverId] ?? [];
  const selectedRole = serverRoles.find((r) => r.id === selectedRoleId) ?? null;

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

  const isDirty = selectedRole &&
    (editName !== selectedRole.name || editColor !== (selectedRole.color ?? "#6b7280") || editPerms !== selectedRole.permissions);

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[var(--bg-elevated)] border border-[var(--border)] shadow-2xl flex flex-col"
        style={{ maxHeight: "80vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-[var(--accent-red)]" />
            <span className="text-sm font-semibold text-[var(--text-primary)]">Roles & Permissions</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--border)] flex-shrink-0">
          {(["roles", "members"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium capitalize transition-colors border-b-2",
                tab === t
                  ? "border-[var(--accent-red)] text-[var(--accent-red)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              )}
            >
              {t === "roles" ? <Shield className="w-3 h-3" /> : <Users className="w-3 h-3" />}
              {t}
            </button>
          ))}
        </div>

        {tab === "roles" && (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Role list */}
            <div className="w-44 flex-shrink-0 border-r border-[var(--border)] flex flex-col">
              <div className="flex-1 overflow-y-auto py-2">
                {serverRoles.map((role) => (
                  <button
                    key={role.id}
                    onClick={() => openRole(role)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left group",
                      selectedRoleId === role.id
                        ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                        : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: role.color ?? "#6b7280" }}
                    />
                    <span className="flex-1 truncate">{role.name}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleDeleteRole(role.id); }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-[var(--destructive)] transition-all"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </button>
                ))}
              </div>
              <div className="p-2 border-t border-[var(--border)]">
                {creating ? (
                  <div className="flex flex-col gap-1">
                    <input
                      autoFocus
                      value={newRoleName}
                      onChange={(e) => setNewRoleName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void handleCreateRole(); if (e.key === "Escape") setCreating(false); }}
                      placeholder="Role name"
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded px-2 py-1 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-red)]"
                    />
                    <div className="flex gap-1">
                      <button
                        onClick={() => void handleCreateRole()}
                        disabled={saving || !newRoleName.trim()}
                        className="flex-1 py-1 text-[10px] bg-[var(--accent-red)] text-white rounded disabled:opacity-50"
                      >
                        {saving ? "…" : "Create"}
                      </button>
                      <button
                        onClick={() => setCreating(false)}
                        className="flex-1 py-1 text-[10px] bg-[var(--bg-surface)] text-[var(--text-muted)] rounded hover:text-[var(--text-primary)]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setCreating(true)}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    New Role
                  </button>
                )}
              </div>
            </div>

            {/* Role editor */}
            <div className="flex-1 overflow-y-auto p-5">
              {!selectedRole ? (
                <div className="flex items-center justify-center h-full text-xs text-[var(--text-muted)]">
                  Select a role to edit
                </div>
              ) : (
                <div className="space-y-5">
                  <div>
                    <label className="block text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                      Role Name
                    </label>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-red)]"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                      Color
                    </label>
                    <div className="flex items-center gap-2 flex-wrap">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => setEditColor(c)}
                          className={cn(
                            "w-6 h-6 rounded-full transition-transform",
                            editColor === c && "ring-2 ring-white ring-offset-1 ring-offset-[var(--bg-elevated)] scale-110"
                          )}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                      <input
                        type="color"
                        value={editColor}
                        onChange={(e) => setEditColor(e.target.value)}
                        className="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0"
                        title="Custom color"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                      Permissions
                    </label>
                    <div className="space-y-1.5">
                      {PERM_LABELS.map(({ flag, label }) => {
                        const has = !!(editPerms & flag);
                        return (
                          <label key={flag} className="flex items-center gap-2.5 cursor-pointer group">
                            <button
                              role="checkbox"
                              aria-checked={has}
                              onClick={() => togglePerm(flag)}
                              className={cn(
                                "w-4 h-4 rounded border transition-colors flex-shrink-0 flex items-center justify-center",
                                has
                                  ? "bg-[var(--accent-red)] border-[var(--accent-red)]"
                                  : "border-[var(--border)] bg-[var(--bg-surface)] group-hover:border-[var(--text-muted)]"
                              )}
                            >
                              {has && <span className="text-white text-[10px] leading-none">✓</span>}
                            </button>
                            <span className="text-xs text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors">
                              {label}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    onClick={() => void handleSaveRole()}
                    disabled={saving || !isDirty}
                    className="px-4 py-2 text-xs bg-[var(--accent-red)] text-white rounded hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {saving ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "members" && (
          <div className="flex-1 overflow-y-auto p-4">
            {serverMembers.length === 0 ? (
              <div className="text-xs text-[var(--text-muted)] text-center py-8">No members</div>
            ) : (
              <div className="space-y-1">
                {serverMembers.map((member) => {
                  const memberRole = member.roleId
                    ? serverRoles.find((r) => r.id === member.roleId)
                    : null;
                  const isCurrentUser = member.userId === user?.id;
                  return (
                    <div key={member.id} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-[var(--bg-hover)] transition-colors">
                      <UserAvatar user={member.user} size="sm" className="flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium text-[var(--text-primary)] truncate block">
                          @{member.user?.username ?? member.userId}
                        </span>
                        {member.user?.displayName && (
                          <span className="text-[10px] text-[var(--text-muted)] truncate block">{member.user.displayName}</span>
                        )}
                      </div>
                      <select
                        value={member.roleId ?? ""}
                        onChange={(e) => void assignRole(member.id, serverId, e.target.value || null)}
                        disabled={isCurrentUser}
                        className="text-[10px] bg-[var(--bg-surface)] border border-[var(--border)] rounded px-1.5 py-1 text-[var(--text-muted)] outline-none focus:border-[var(--accent-red)] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="">No role</option>
                        {serverRoles.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                      {memberRole && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                          style={{ backgroundColor: (memberRole.color ?? "#6b7280") + "33", color: memberRole.color ?? "#6b7280" }}
                        >
                          {memberRole.name}
                        </span>
                      )}
                      {!isCurrentUser && (
                        <button
                          onClick={() => void kickMember(member.id, serverId)}
                          className="p-1 text-[var(--text-muted)] hover:text-[var(--destructive)] transition-colors opacity-0 group-hover:opacity-100"
                          title="Kick member"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
