import { useState } from "react";
import { X, UserPlus, Search, Check, AlertCircle } from "lucide-react";
import { useServerStore } from "@/lib/store/server-store";
import { cn } from "@/lib/utils";

interface InviteUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverId: string;
  serverName: string;
}

export function InviteUserModal({ isOpen, onClose, serverId, serverName }: InviteUserModalProps) {
  const { inviteUser } = useServerStore();
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  if (!isOpen) return null;

  const handleInvite = async () => {
    if (!username.trim()) return;
    setStatus("loading");
    setMessage("");
    const error = await inviteUser(serverId, username);
    if (error) {
      setStatus("error");
      setMessage(error);
    } else {
      setStatus("success");
      setMessage(`@${username.trim()} добавлен на сервер`);
      setUsername("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleInvite();
    if (e.key === "Escape") onClose();
  };

  const handleClose = () => {
    setUsername("");
    setStatus("idle");
    setMessage("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[380px] bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl shadow-2xl animate-fade-in">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-[var(--accent-red)]" />
            <span className="font-semibold text-sm text-[var(--text-primary)]">
              Добавить участника
            </span>
          </div>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-[var(--bg-hover)] rounded transition-colors"
          >
            <X className="w-4 h-4 text-[var(--text-muted)]" />
          </button>
        </div>

        <div className="px-4 py-4 space-y-4">
          <p className="text-xs text-[var(--text-muted)]">
            <span className="opacity-60">$ server </span>
            <span className="text-[var(--text-primary)]">{serverName}</span>
          </p>

          <div className="space-y-2">
            <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
              Username
            </label>
            <div className="flex items-center gap-2 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2">
              <Search className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
              <input
                autoFocus
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (status !== "idle") { setStatus("idle"); setMessage(""); }
                }}
                onKeyDown={handleKeyDown}
                placeholder="введи username..."
                className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
              />
            </div>
          </div>

          {message && (
            <div className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-xs",
              status === "success"
                ? "bg-[var(--online)]/10 border border-[var(--online)]/30 text-[var(--online)]"
                : "bg-[var(--destructive)]/10 border border-[var(--destructive)]/30 text-[var(--destructive)]"
            )}>
              {status === "success"
                ? <Check className="w-3 h-3 flex-shrink-0" />
                : <AlertCircle className="w-3 h-3 flex-shrink-0" />
              }
              {message}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleClose}
              className="flex-1 px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleInvite}
              disabled={!username.trim() || status === "loading"}
              className={cn(
                "flex-1 px-3 py-2 text-sm rounded-lg transition-colors font-medium",
                username.trim() && status !== "loading"
                  ? "bg-[var(--accent-red)] hover:opacity-90 text-white"
                  : "bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed"
              )}
            >
              {status === "loading" ? "Добавление..." : "Добавить"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
