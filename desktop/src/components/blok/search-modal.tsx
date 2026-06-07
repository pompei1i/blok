import { useState, useEffect, useRef, useCallback } from "react";
import { Search, X, Clock, Hash, Volume2 } from "lucide-react";
import { useServerStore } from "@/lib/store/server-store";
import { UserAvatar } from "./user-avatar";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { Message, User, Channel } from "@/lib/store/types";

type SearchTab = "messages" | "users" | "channels";

interface SearchModalProps {
  serverId: string;
  channelId: string;
  channelName: string;
  onClose: () => void;
  onJumpToMessage: (messageId: string) => void;
  onSelectChannel: (channelId: string) => void;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query || !text) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-[var(--accent-red)]/30 text-[var(--accent-red)] rounded px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function SearchModal({
  serverId,
  channelId,
  channelName,
  onClose,
  onJumpToMessage,
  onSelectChannel,
}: SearchModalProps) {
  const { searchMessages, searchUsers, searchChannels } = useServerStore();
  const { t } = useI18n();

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60_000) return t("search.timeJustNow");
    if (diff < 3_600_000) return t("search.timeMinutesAgo").replace("{n}", String(Math.floor(diff / 60_000)));
    if (diff < 86_400_000) return t("search.timeHoursAgo").replace("{n}", String(Math.floor(diff / 3_600_000)));
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const TABS: { id: SearchTab; label: string }[] = [
    { id: "messages", label: t("search.tab.messages") },
    { id: "users",    label: t("search.tab.users") },
    { id: "channels", label: t("search.tab.channels") },
  ];

  const [tab, setTab] = useState<SearchTab>("messages");
  const [query, setQuery] = useState("");
  const [msgResults, setMsgResults] = useState<Message[]>([]);
  const [userResults, setUserResults] = useState<User[]>([]);
  const [chanResults, setChanResults] = useState<Channel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Reset selection when tab or results change
  useEffect(() => { setSelectedIndex(0); }, [tab, msgResults, userResults, chanResults]);

  const runSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setMsgResults([]); setUserResults([]); setChanResults([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const [msgs] = await Promise.all([
      tab === "messages" ? searchMessages(channelId, q) : Promise.resolve([] as Message[]),
    ]);
    if (tab === "messages") setMsgResults(msgs);
    if (tab === "users")    setUserResults(searchUsers(serverId, q));
    if (tab === "channels") setChanResults(searchChannels(serverId, q));
    setIsLoading(false);
  }, [tab, channelId, serverId, searchMessages, searchUsers, searchChannels]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runSearch(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, runSearch]);

  // When tab switches, re-run search with existing query
  useEffect(() => { void runSearch(query); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentResults = tab === "messages" ? msgResults : tab === "users" ? userResults : chanResults;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, currentResults.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter") {
      if (tab === "messages" && msgResults[selectedIndex]) { onJumpToMessage(msgResults[selectedIndex].id); onClose(); }
      if (tab === "channels" && chanResults[selectedIndex]) { onSelectChannel(chanResults[selectedIndex].id); }
    }
  };

  const placeholder =
    tab === "messages" ? t("search.placeholderInChannel").replace("#{channel}", channelName) :
    tab === "users"    ? t("search.placeholderMembers") :
                         t("search.placeholderChannels");

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/60 flex items-start justify-center pt-24"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[var(--bg-elevated)] border border-[var(--border)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
          <Search className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
          {isLoading && (
            <div className="w-4 h-4 border-2 border-[var(--accent-red)] border-t-transparent rounded-full animate-spin flex-shrink-0" />
          )}
          <button
            onClick={onClose}
            className="p-0.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--border)]">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex-1 py-2 text-xs font-medium transition-colors border-b-2",
                tab === id
                  ? "border-[var(--accent-red)] text-[var(--accent-red)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto">
          {query.length < 2 ? (
            <div className="flex items-center gap-2 px-4 py-6 text-xs text-[var(--text-muted)] justify-center">
              <Clock className="w-3.5 h-3.5" />
              {t("search.minChars")}
            </div>
          ) : currentResults.length === 0 && !isLoading ? (
            <div className="px-4 py-6 text-xs text-[var(--text-muted)] text-center">{t("search.noResults")}</div>
          ) : tab === "messages" ? (
            msgResults.map((msg, i) => (
              <button
                key={msg.id}
                onClick={() => { onJumpToMessage(msg.id); onClose(); }}
                className={cn(
                  "w-full flex items-start gap-3 px-4 py-3 text-left transition-colors border-b border-[var(--border)]/50 last:border-0",
                  i === selectedIndex ? "bg-[var(--bg-hover)]" : "hover:bg-[var(--bg-hover)]/60"
                )}
              >
                <UserAvatar user={msg.author} size="sm" className="flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium text-[var(--text-primary)]">
                      @{msg.author?.username ?? "unknown"}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">{formatDate(msg.createdAt)}</span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                    {highlightMatch(msg.content ?? "", query)}
                  </p>
                </div>
              </button>
            ))
          ) : tab === "users" ? (
            userResults.map((u, i) => (
              <div
                key={u.id}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]/50 last:border-0",
                  i === selectedIndex ? "bg-[var(--bg-hover)]" : ""
                )}
              >
                <UserAvatar user={u} size="sm" className="flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-[var(--text-primary)] block truncate">
                    @{highlightMatch(u.username, query)}
                  </span>
                  {u.displayName && (
                    <span className="text-[10px] text-[var(--text-muted)] block truncate">
                      {highlightMatch(u.displayName, query)}
                    </span>
                  )}
                </div>
              </div>
            ))
          ) : (
            chanResults.map((ch, i) => (
              <button
                key={ch.id}
                onClick={() => onSelectChannel(ch.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-[var(--border)]/50 last:border-0",
                  i === selectedIndex ? "bg-[var(--bg-hover)]" : "hover:bg-[var(--bg-hover)]/60"
                )}
              >
                {ch.type === "voice"
                  ? <Volume2 className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
                  : <Hash className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
                }
                <span className="text-xs font-medium text-[var(--text-primary)] flex-1 truncate">
                  {highlightMatch(ch.name, query)}
                </span>
                <span className="text-[10px] text-[var(--text-muted)] uppercase">{ch.type}</span>
              </button>
            ))
          )}
        </div>

        {currentResults.length > 0 && (
          <div className="px-4 py-2 border-t border-[var(--border)] text-[10px] text-[var(--text-muted)] flex items-center gap-3">
            <span>{t("search.navHint")}</span>
            {tab !== "users" && <span>{tab === "messages" ? t("search.jumpHint") : t("search.openHint")}</span>}
            <span>{t("search.escHint")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
