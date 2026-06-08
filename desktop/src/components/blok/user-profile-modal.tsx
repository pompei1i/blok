import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X, MessageCircle, Phone } from "lucide-react";
import { UserAvatar } from "./user-avatar";
import { levelProgress, levelColor } from "@/lib/levels";
import { useDMStore } from "@/lib/store/dm-store";
import { useAuthStore } from "@/lib/store/auth-store";
import type { User, PresenceStatus } from "@/lib/store/types";

interface Props {
  user: User;
  status: PresenceStatus;
  xp?: number;
  onClose: () => void;
}

const PRESENCE_LABEL: Record<PresenceStatus, string> = {
  online: "Online",
  offline: "Offline",
  afk: "Away",
  dnd: "Do not disturb",
};

const PRESENCE_COLOR: Record<PresenceStatus, string> = {
  online: "var(--online)",
  offline: "#6b7280",
  afk: "#f59e0b",
  dnd: "var(--destructive)",
};

export function UserProfileModal({ user, status, xp, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const { user: me } = useAuthStore();
  const { openDM, callUser } = useDMStore();
  const isMe = me?.id === user.id;

  const displayName = user.displayName || user.username;
  const progress = xp !== undefined ? levelProgress(xp) : null;
  const lvColor = progress ? levelColor(progress.level) : null;
  const accent = user.accentColor ?? "var(--accent-red)";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] w-76 shadow-2xl overflow-hidden" style={{ width: 300 }}>

        {/* Banner */}
        <div
          className="relative h-20 flex-shrink-0"
          style={{ background: `linear-gradient(135deg, ${accent}, ${accent}99)` }}
        >
          <button
            onClick={onClose}
            className="absolute top-2 right-2 p-1 rounded text-white/60 hover:text-white/90 hover:bg-black/20 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Avatar row */}
        <div className="px-4 -mt-8 flex items-end justify-between mb-3">
          <div className="relative ring-4 ring-[var(--bg-elevated)] rounded-full">
            <UserAvatar user={user} size="xl" />
            {progress && lvColor && (
              <div
                className="absolute -bottom-1 -right-1 text-[9px] font-black px-1.5 py-px rounded-full border-2 border-[var(--bg-elevated)] text-white leading-tight"
                style={{ background: lvColor }}
              >
                {progress.level}
              </div>
            )}
          </div>
          <div
            className="mb-1 flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--bg-surface)]"
          >
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: PRESENCE_COLOR[status] }} />
            <span className="text-[10px] font-medium text-[var(--text-muted)]">{PRESENCE_LABEL[status]}</span>
          </div>
        </div>

        {/* Name */}
        <div className="px-4 pb-3">
          <p className="font-bold text-[var(--text-primary)] leading-tight">{displayName}</p>
          <p className="text-xs text-[var(--text-muted)]">@{user.username}</p>
          {user.pronouns && (
            <p className="text-[11px] text-[var(--text-muted)] opacity-60 mt-0.5">{user.pronouns}</p>
          )}
        </div>

        {/* Action buttons */}
        {!isMe && (
          <div className="px-4 pb-3 flex gap-2">
            <button
              onClick={() => { if (me) { void openDM(me.id, user.id); onClose(); } }}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded border border-[var(--border)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              Message
            </button>
            <button
              onClick={() => { void callUser(user.id, user.username); onClose(); }}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded border border-[var(--border)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Phone className="w-3.5 h-3.5" />
              Call
            </button>
          </div>
        )}

        {/* XP bar — shown even before bio/status for prominence */}
        {progress && lvColor && (
          <div className="px-4 pb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: lvColor }}>
                Level {progress.level}{progress.maxed ? " · MAX" : ""}
              </span>
              {!progress.maxed && (
                <span className="text-[10px] text-[var(--text-muted)]">{progress.current} / {progress.needed} XP</span>
              )}
            </div>
            {!progress.maxed && (
              <div className="w-full h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${progress.percent}%`, background: lvColor }}
                />
              </div>
            )}
          </div>
        )}

        {/* Custom status message (skip the default "Online" that's set by the DB trigger) */}
        {user.statusMessage && user.statusMessage !== "Online" && (
          <div className="mx-4 border-t border-[var(--border)] py-3">
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium mb-1">Status</p>
            <p className="text-xs text-[var(--text-primary)]">{user.statusMessage}</p>
          </div>
        )}

        {user.bio && (
          <div className="mx-4 border-t border-[var(--border)] py-3">
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium mb-1">About me</p>
            <p className="text-xs text-[var(--text-primary)] whitespace-pre-wrap">{user.bio}</p>
          </div>
        )}

        <div className="mx-4 border-t border-[var(--border)] py-3">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium mb-1">Member since</p>
          <p className="text-xs text-[var(--text-muted)]">{new Date(user.createdAt).toLocaleDateString()}</p>
        </div>

      </div>
    </div>,
    document.body,
  );
}
