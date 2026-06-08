import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { UserAvatar } from "./user-avatar";
import { PresenceDot } from "./presence-dot";
import type { User, PresenceStatus } from "@/lib/store/types";

interface Props {
  user: User;
  status: PresenceStatus;
  onClose: () => void;
}

export function UserProfileModal({ user, status, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const displayName = user.displayName || user.username;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[var(--bg-elevated)] border border-[var(--border)] w-80 shadow-2xl">
        <div
          className="h-16 flex-shrink-0"
          style={{ background: user.accentColor ?? "var(--accent-red)" }}
        />

        <div className="px-4 -mt-7 flex items-end justify-between">
          <div className="relative ring-4 ring-[var(--bg-elevated)] rounded-full">
            <UserAvatar user={user} size="xl" />
            <PresenceDot status={status} size="lg" className="absolute bottom-0.5 right-0.5 ring-2 ring-[var(--bg-elevated)]" />
          </div>
          <button
            onClick={onClose}
            className="mb-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 pt-3 pb-5 space-y-3">
          <div>
            <p className="font-semibold text-[var(--text-primary)]">{displayName}</p>
            <p className="text-xs text-[var(--text-muted)]">@{user.username}</p>
            {user.pronouns && (
              <p className="text-[11px] text-[var(--text-muted)] opacity-60 mt-0.5">{user.pronouns}</p>
            )}
          </div>

          {user.statusMessage && (
            <div className="border-t border-[var(--border)] pt-3">
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium mb-1">Status</p>
              <p className="text-xs text-[var(--text-primary)]">{user.statusMessage}</p>
            </div>
          )}

          {user.bio && (
            <div className="border-t border-[var(--border)] pt-3">
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium mb-1">About me</p>
              <p className="text-xs text-[var(--text-primary)] whitespace-pre-wrap">{user.bio}</p>
            </div>
          )}

          <div className="border-t border-[var(--border)] pt-3">
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-medium mb-1">Member since</p>
            <p className="text-xs text-[var(--text-muted)]">
              {new Date(user.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
