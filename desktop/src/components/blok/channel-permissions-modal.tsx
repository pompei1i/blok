import { useMemo, useState } from "react";
import { X, Hash, Volume2, Check, Minus, Ban } from "lucide-react";
import { useServerStore } from "@/lib/store/server-store";
import { ChannelPerm, type ChannelAccess } from "@/lib/permission";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { Channel } from "@/lib/store/types";

/** Inherit / allow / deny — the three states one bit can be in for one role. */
type TriState = "inherit" | "allow" | "deny";

const BIT: Record<ChannelAccess, number> = {
  view: ChannelPerm.VIEW,
  send: ChannelPerm.SEND,
  connect: ChannelPerm.CONNECT,
};

function stateOf(allow: number, deny: number, bit: number): TriState {
  if (allow & bit) return "allow";
  if (deny & bit) return "deny";
  return "inherit";
}

/** Applies a tri-state to a bit, keeping allow and deny mutually exclusive. */
function applyState(allow: number, deny: number, bit: number, next: TriState) {
  return {
    allow: next === "allow" ? allow | bit : allow & ~bit,
    deny: next === "deny" ? deny | bit : deny & ~bit,
  };
}

interface Props {
  channel: Channel | null;
  onClose: () => void;
}

export function ChannelPermissionsModal({ channel, onClose }: Props) {
  const { t } = useI18n();
  const { roles, channelOverrides, setChannelPermission } = useServerStore();
  // null = the @everyone baseline, which is what most channels only ever need.
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const serverRoles = useMemo(
    () => (channel ? roles[channel.serverId] ?? [] : []),
    [roles, channel],
  );

  const current = useMemo(() => {
    const row = channelOverrides.find(
      (o) => o.channelId === channel?.id && o.roleId === selectedRoleId,
    );
    return { allow: row?.allow ?? 0, deny: row?.deny ?? 0 };
  }, [channelOverrides, channel?.id, selectedRoleId]);

  if (!channel) return null;

  // Send is meaningless on a voice channel and connect on a text one, so each
  // channel only shows the switches that can actually do something.
  const rows: ChannelAccess[] = channel.type === "voice" ? ["view", "connect"] : ["view", "send"];

  const setBit = async (access: ChannelAccess, next: TriState) => {
    const { allow, deny } = applyState(current.allow, current.deny, BIT[access], next);
    setBusy(true);
    try {
      await setChannelPermission(channel.id, selectedRoleId, allow, deny);
    } finally {
      setBusy(false);
    }
  };

  /** Which override rows exist, so a role with settings is marked in the list. */
  const roleHasOverride = (roleId: string | null) =>
    channelOverrides.some(
      (o) => o.channelId === channel.id && o.roleId === roleId && (o.allow !== 0 || o.deny !== 0),
    );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center font-mono">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-2xl max-h-[80vh] bg-[var(--bg-surface)] border border-[var(--border)] shadow-2xl animate-fade-in flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider">
            <span className="text-[var(--text-muted)]">$</span>
            {t("channelPerms.title")}
            <span className="flex items-center gap-1 text-[var(--text-muted)] normal-case tracking-normal">
              {channel.type === "voice" ? <Volume2 className="w-3.5 h-3.5" /> : <Hash className="w-3.5 h-3.5" />}
              {channel.name}
            </span>
          </h2>
          <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Role picker */}
          <div className="w-48 border-r border-[var(--border)] overflow-y-auto py-2 shrink-0">
            <RoleButton
              label={t("channelPerms.everyone")}
              active={selectedRoleId === null}
              marked={roleHasOverride(null)}
              onClick={() => setSelectedRoleId(null)}
            />
            {serverRoles.map((r) => (
              <RoleButton
                key={r.id}
                label={r.name}
                color={r.color}
                active={selectedRoleId === r.id}
                marked={roleHasOverride(r.id)}
                onClick={() => setSelectedRoleId(r.id)}
              />
            ))}
            {serverRoles.length === 0 && (
              <p className="px-3 py-2 text-[11px] leading-snug text-[var(--text-muted)]">
                {t("channelPerms.noRoles")}
              </p>
            )}
          </div>

          {/* Switches for the selected role */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {rows.map((access) => {
              const state = stateOf(current.allow, current.deny, BIT[access]);
              return (
                <div key={access} className="flex items-center justify-between gap-4">
                  <span className="text-sm text-[var(--text-primary)]">{t(`channelPerms.${access}`)}</span>
                  <div className="flex items-center border border-[var(--border)]">
                    <TriButton
                      icon={<Ban className="w-3.5 h-3.5" />}
                      title={t("channelPerms.deny")}
                      active={state === "deny"}
                      activeClass="bg-[var(--destructive)] text-white"
                      disabled={busy}
                      onClick={() => void setBit(access, "deny")}
                    />
                    <TriButton
                      icon={<Minus className="w-3.5 h-3.5" />}
                      title={t("channelPerms.inherit")}
                      active={state === "inherit"}
                      activeClass="bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                      disabled={busy}
                      onClick={() => void setBit(access, "inherit")}
                    />
                    <TriButton
                      icon={<Check className="w-3.5 h-3.5" />}
                      title={t("channelPerms.allow")}
                      active={state === "allow"}
                      activeClass="bg-[var(--online)] text-black"
                      disabled={busy}
                      onClick={() => void setBit(access, "allow")}
                    />
                  </div>
                </div>
              );
            })}

            <p className="pt-2 text-[11px] leading-snug text-[var(--text-muted)] border-t border-[var(--border)]">
              {t("channelPerms.hint")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function RoleButton({
  label, color, active, marked, onClick,
}: {
  label: string;
  color?: string;
  active: boolean;
  marked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 w-full px-3 py-1.5 text-left text-sm transition-colors",
        active
          ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[inset_2px_0_0_var(--accent-red)]"
          : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
      )}
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ background: color || "var(--text-muted)" }}
      />
      <span className="truncate flex-1">{label}</span>
      {/* A dot marks roles that already carry an override, so a channel's
          configuration is visible without clicking through every role. */}
      {marked && <span className="text-[var(--accent-red)] text-xs">•</span>}
    </button>
  );
}

function TriButton({
  icon, title, active, activeClass, disabled, onClick,
}: {
  icon: React.ReactNode;
  title: string;
  active: boolean;
  activeClass: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "p-1.5 transition-colors disabled:opacity-50",
        active ? activeClass : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]",
      )}
    >
      {icon}
    </button>
  );
}
