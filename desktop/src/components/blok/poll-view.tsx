import { useState } from "react";
import { BarChart2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { Poll } from "@/lib/store/types";
import { useServerStore } from "@/lib/store/server-store";
import { useAuthStore } from "@/lib/store/auth-store";

interface PollViewProps {
  poll: Poll;
  onVote: (optionIds: string[]) => void;
}

export function PollView({ poll, onVote }: PollViewProps) {
  const { t } = useI18n();
  const { members, activeServerId, userProfileCache } = useServerStore();
  const { user } = useAuthStore();
  const [pendingVotes, setPendingVotes] = useState<string[]>([]);

  const hasVoted = poll.myVotes.length > 0;
  const serverMembers = activeServerId ? members[activeServerId] || [] : [];

  const getDisplayName = (userId: string) => {
    if (userId === user?.id) return user.username;
    const member = serverMembers.find((m) => m.userId === userId);
    if (member?.user?.username) return member.user.username;
    return userProfileCache[userId]?.username ?? userId.slice(0, 8);
  };

  const togglePending = (optionId: string) => {
    if (hasVoted) return;
    if (poll.isMultipleChoice) {
      setPendingVotes((prev) =>
        prev.includes(optionId) ? prev.filter((id) => id !== optionId) : [...prev, optionId]
      );
    } else {
      setPendingVotes((prev) => (prev[0] === optionId ? [] : [optionId]));
    }
  };

  const handleVote = () => {
    if (pendingVotes.length === 0) return;
    onVote(pendingVotes);
    setPendingVotes([]);
  };

  return (
    <div className="mt-2 border border-[var(--border)] rounded-lg bg-[var(--bg-elevated)] overflow-hidden max-w-sm">
      {/* Poll header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-surface)]">
        <BarChart2 className="w-3.5 h-3.5 text-[var(--accent-red)] flex-shrink-0" />
        <span className="text-[12px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
          {t("poll.title")}
          {poll.isAnonymous && (
            <span className="ml-1.5 text-[var(--text-muted)] normal-case font-normal">· {t("poll.anonymous")}</span>
          )}
          {poll.isMultipleChoice && (
            <span className="ml-1.5 text-[var(--text-muted)] normal-case font-normal">· {t("poll.multipleChoice")}</span>
          )}
        </span>
      </div>

      {/* Question */}
      <div className="px-3 pt-2.5 pb-1">
        <p className="text-sm font-medium text-[var(--text-primary)] leading-snug">{poll.question}</p>
      </div>

      {/* Options */}
      <div className="px-3 pb-2 flex flex-col gap-1.5 mt-1">
        {poll.options.map((option) => {
          const isMyVote = poll.myVotes.includes(option.id);
          const isPending = pendingVotes.includes(option.id);
          const pct = poll.totalVotes > 0
            ? Math.round((option.voteCount / poll.totalVotes) * 100)
            : 0;

          return (
            <button
              key={option.id}
              onClick={() => togglePending(option.id)}
              disabled={hasVoted}
              className={cn(
                "relative w-full rounded overflow-hidden text-left transition-all",
                !hasVoted && "hover:bg-[var(--bg-hover)] cursor-pointer",
                hasVoted && "cursor-default",
              )}
            >
              {/* Progress bar (only after voting) */}
              {hasVoted && (
                <div
                  className={cn(
                    "absolute inset-0 rounded transition-all duration-500",
                    isMyVote
                      ? "bg-[var(--accent-red)]/20"
                      : "bg-[var(--bg-hover)]/60",
                  )}
                  style={{ width: `${pct}%` }}
                />
              )}

              {/* Pending highlight (before voting) */}
              {!hasVoted && isPending && (
                <div className="absolute inset-0 rounded bg-[var(--accent-red)]/15" />
              )}

              <div className="relative flex items-center gap-2 px-2.5 py-2">
                {/* Checkbox/radio indicator */}
                <div className={cn(
                  "w-3.5 h-3.5 flex-shrink-0 rounded-full border transition-colors",
                  !hasVoted && isPending
                    ? "border-[var(--accent-red)] bg-[var(--accent-red)]"
                    : hasVoted && isMyVote
                    ? "border-[var(--accent-red)] bg-[var(--accent-red)]"
                    : "border-[var(--border)]",
                  poll.isMultipleChoice && "rounded-sm",
                )}>
                  {(isPending || (hasVoted && isMyVote)) && (
                    <Check className="w-2.5 h-2.5 text-white m-auto block" />
                  )}
                </div>

                {/* Option text */}
                <span className={cn(
                  "flex-1 text-xs leading-tight",
                  (isPending || (hasVoted && isMyVote))
                    ? "text-[var(--text-primary)] font-medium"
                    : "text-[var(--text-primary)]",
                )}>
                  {option.text}
                </span>

                {/* Vote count after voting */}
                {hasVoted && (
                  <span className="text-[12px] text-[var(--text-muted)] flex-shrink-0">
                    {pct}%
                  </span>
                )}
              </div>

              {/* Voter names tooltip (open polls only) */}
              {hasVoted && !poll.isAnonymous && option.voters.length > 0 && (
                <div className="px-2.5 pb-1.5 -mt-1">
                  <p className="text-[11px] text-[var(--text-muted)] truncate">
                    {option.voters.slice(0, 3).map(getDisplayName).join(", ")}
                    {option.voters.length > 3 && ` +${option.voters.length - 3}`}
                  </p>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-[var(--border)] flex items-center gap-2">
        <span className="text-[12px] text-[var(--text-muted)] flex-1">
          {t("poll.totalVotes").replace("{n}", String(poll.totalVotes))}
        </span>

        {hasVoted ? (
          <div className="flex items-center gap-1 text-[12px] text-[var(--accent-red)]">
            <Check className="w-3 h-3" />
            {t("poll.voted")}
          </div>
        ) : pendingVotes.length > 0 ? (
          <button
            onClick={handleVote}
            className="text-[12px] px-2.5 py-1 rounded bg-[var(--accent-red)] hover:opacity-90 text-white transition-opacity"
          >
            {t("poll.vote")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
