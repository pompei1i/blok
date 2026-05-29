import { Phone, PhoneOff, PhoneCall } from "lucide-react";
import { useDMStore } from "@/lib/store/dm-store";
import { useFriendsStore } from "@/lib/store/friends-store";
import { UserAvatar } from "./user-avatar";
import { useI18n } from "@/lib/i18n";

export function IncomingCallBanner() {
  const { t } = useI18n();
  const { incomingCall, outgoingCall, acceptCall, declineCall, cancelCall } = useDMStore();
  const { friends } = useFriendsStore();

  const findUser = (userId: string) => {
    const rel = friends.find((f) => f.targetId === userId || f.requesterId === userId);
    return rel?.targetId === userId ? rel.targetUser : rel?.requesterUser;
  };

  if (incomingCall) {
    const caller = findUser(incomingCall.fromUserId);
    return (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] animate-slide-in">
        <div className="flex items-center gap-3 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-4 py-3 shadow-2xl min-w-[17.5rem]">
          <div className="relative flex-shrink-0">
            <UserAvatar user={caller} size="md" />
            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[var(--online)] border-2 border-[var(--bg-elevated)] animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider opacity-60">
              {t("incomingCall.incoming")}
            </p>
            <p className="text-sm font-medium text-[var(--text-primary)] truncate">
              @{incomingCall.fromUsername}
            </p>
          </div>
          <button
            onClick={() => void acceptCall()}
            className="p-2 bg-[var(--online)] hover:opacity-90 text-white rounded-lg transition-opacity flex-shrink-0"
            title={t("incomingCall.accept")}
          >
            <Phone className="w-4 h-4" />
          </button>
          <button
            onClick={() => declineCall()}
            className="p-2 bg-[var(--accent-red)] hover:opacity-90 text-white rounded-lg transition-opacity flex-shrink-0"
            title={t("incomingCall.decline")}
          >
            <PhoneOff className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  if (outgoingCall) {
    const callee = findUser(outgoingCall.toUserId);
    return (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] animate-slide-in">
        <div className="flex items-center gap-3 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-4 py-3 shadow-2xl min-w-[17.5rem]">
          <div className="relative flex-shrink-0">
            <UserAvatar user={callee} size="md" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider opacity-60">
              {t("incomingCall.calling")}
            </p>
            <p className="text-sm font-medium text-[var(--text-primary)] truncate">
              @{outgoingCall.toUsername}
            </p>
          </div>
          <PhoneCall className="w-4 h-4 text-[var(--online)] animate-pulse flex-shrink-0" />
          <button
            onClick={() => cancelCall()}
            className="p-2 bg-[var(--accent-red)] hover:opacity-90 text-white rounded-lg transition-opacity flex-shrink-0"
            title={t("incomingCall.cancel")}
          >
            <PhoneOff className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
