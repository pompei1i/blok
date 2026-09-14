import { useState } from "react";
import { useFriendsStore, effectiveStatus } from "@/lib/store/friends-store";
import { UserAvatar } from "./user-avatar";
import { PresenceDot } from "./presence-dot";
import { useI18n } from "@/lib/i18n";

interface MentionPickerProps {
  onSelect: (mention: string) => void;
  onClose: () => void;
}

export function MentionPicker({ onSelect, onClose }: MentionPickerProps) {
  const { t } = useI18n();
  const { friends, presence } = useFriendsStore();
  const [searchQuery, setSearchQuery] = useState("");

  const mentionableUsers = friends.map((f) => f.targetUser).filter(Boolean);

  const filteredUsers = mentionableUsers.filter(
    (user) =>
      user?.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user?.displayName?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="absolute bottom-full right-0 mb-2 w-64 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg shadow-xl overflow-hidden animate-slide-in">
      <div className="p-2 border-b border-[var(--border)]">
        <input
          type="text"
          placeholder={t("mention.searchUsers")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-muted)]"
          autoFocus
        />
      </div>

      <div className="max-h-48 overflow-y-auto p-1">
        {filteredUsers.length === 0 ? (
          <p className="p-2 text-sm text-[var(--text-muted)] text-center">
            {t("mention.noUsersFound")}
          </p>
        ) : (
          filteredUsers.map((user) => {
            if (!user) return null;
            const status = effectiveStatus(presence[user.id]);
            return (
              <button
                key={user.id}
                onClick={() => {
                  onSelect(`@${user.username}`);
                  onClose();
                }}
                className="flex items-center gap-2 w-full p-2 hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
              >
                <div className="relative">
                  <UserAvatar user={user} size="sm" />
                  <PresenceDot
                    status={status}
                    size="sm"
                    className="absolute -bottom-0.5 -right-0.5 ring-2 ring-[var(--bg-surface)]"
                  />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm text-[var(--text-primary)] truncate">
                    @{user.username}
                  </p>
                  {user.displayName && user.displayName !== user.username && (
                    <p className="text-xs text-[var(--text-muted)] truncate">
                      {user.displayName}
                    </p>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

