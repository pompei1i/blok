import { useState } from "react";
import {
  X,
  UserPlus,
  Clock,
  Send,
  Check,
} from "lucide-react";
import { useFriendsStore } from "@/lib/store/friends-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { UserAvatar } from "./user-avatar";
import { cn } from "@/lib/utils";

interface AddFriendModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddFriendModal({ isOpen, onClose }: AddFriendModalProps) {
  const { sendFriendRequest, outgoingRequests, cancelRequest } =
    useFriendsStore();
  const { user } = useAuthStore();
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    setIsSubmitting(true);
    setMessage(null);

    await new Promise((resolve) => setTimeout(resolve, 300));

    const result = await sendFriendRequest(username.trim(), user!.id);
    setMessage({
      type: result.success ? "success" : "error",
      text: result.message,
    });

    if (result.success) {
      setUsername("");
    }

    setIsSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg shadow-2xl animate-fade-in">
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[var(--bg-elevated)] rounded-lg">
              <UserPlus className="w-5 h-5 text-[var(--text-primary)]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                Add Friend
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                <span className="opacity-60">$ </span>
                friend --add username
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--bg-hover)] rounded-lg transition-colors text-[var(--text-muted)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <form onSubmit={handleSubmit}>
            <label className="block text-xs text-[var(--text-muted)] mb-2 uppercase tracking-wider">
              Enter Username
            </label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
                  @
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="username"
                  className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg pl-8 pr-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-muted)] transition-colors"
                />
              </div>
              <button
                type="submit"
                disabled={!username.trim() || isSubmitting}
                className="px-4 py-2.5 bg-[var(--accent-red)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                {isSubmitting ? "Sending..." : "Send"}
              </button>
            </div>
          </form>

          {message && (
            <div
              className={cn(
                "p-3 rounded-lg text-sm flex items-center gap-2",
                message.type === "success"
                  ? "bg-[var(--online)]/20 text-[var(--online-text)] border border-[var(--online)]/30"
                  : "bg-[var(--destructive)]/20 text-[var(--accent-red-text)] border border-[var(--destructive)]/30",
              )}
            >
              {message.type === "success" ? (
                <Check className="w-4 h-4" />
              ) : (
                <X className="w-4 h-4" />
              )}
              {message.text}
            </div>
          )}

          {outgoingRequests.length > 0 && (
            <div className="pt-4 border-t border-[var(--border)]">
              <h3 className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3 flex items-center gap-2">
                <Clock className="w-3 h-3" />
                Pending Requests
              </h3>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {outgoingRequests.map((request) => (
                  <div
                    key={request.id}
                    className="flex items-center justify-between p-2 bg-[var(--bg-elevated)] rounded-lg"
                  >
                    <div className="flex items-center gap-2">
                      <UserAvatar user={request.targetUser} size="sm" />
                      <span className="text-sm text-[var(--text-primary)]">
                        @{request.targetUser?.username}
                      </span>
                    </div>
                    <button
                      onClick={() => cancelRequest(request.id)}
                      className="text-xs text-[var(--text-muted)] hover:text-[var(--accent-red-text)] px-2 py-1 hover:bg-[var(--bg-hover)] rounded transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

