import { useState, useEffect, useRef, useCallback } from "react";
import { Search, X, Clock } from "lucide-react";
import { useServerStore } from "@/lib/store/server-store";
import { UserAvatar } from "./user-avatar";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { Message } from "@/lib/store/types";

interface SearchModalProps {
 channelId: string;
 channelName: string;
 onClose: () => void;
 onJumpToMessage: (messageId: string) => void;
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

function formatDate(iso: string) {
 const d = new Date(iso);
 const now = new Date();
 const diff = now.getTime() - d.getTime();
 if (diff < 60_000) return "just now";
 if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
 if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
 return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function SearchModal({ channelId, channelName, onClose, onJumpToMessage }: SearchModalProps) {
 const { t } = useI18n();
 const { searchMessages } = useServerStore();
 const [query, setQuery] = useState("");
 const [results, setResults] = useState<Message[]>([]);
 const [isLoading, setIsLoading] = useState(false);
 const [selectedIndex, setSelectedIndex] = useState(0);
 const inputRef = useRef<HTMLInputElement>(null);
 const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

 useEffect(() => {
 inputRef.current?.focus();
 }, []);

 const runSearch = useCallback(async (q: string) => {
 if (q.length < 2) { setResults([]); setIsLoading(false); return; }
 setIsLoading(true);
 const res = await searchMessages(channelId, q);
 setResults(res);
 setSelectedIndex(0);
 setIsLoading(false);
 }, [channelId, searchMessages]);

 useEffect(() => {
 if (debounceRef.current) clearTimeout(debounceRef.current);
 debounceRef.current = setTimeout(() => void runSearch(query), 300);
 return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
 }, [query, runSearch]);

 const handleJump = (msg: Message) => {
 onJumpToMessage(msg.id);
 onClose();
 };

 const handleKeyDown = (e: React.KeyboardEvent) => {
 if (e.key === "Escape") { onClose(); return; }
 if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, results.length - 1)); return; }
 if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); return; }
 if (e.key === "Enter" && results[selectedIndex]) { handleJump(results[selectedIndex]); }
 };

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
 placeholder={t("search.title").replace("{channel}", channelName)}
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

 {/* Results */}
 <div className="max-h-80 overflow-y-auto">
 {query.length < 2 ? (
 <div className="flex items-center gap-2 px-4 py-6 text-xs text-[var(--text-muted)] justify-center">
 <Clock className="w-3.5 h-3.5" />
 {t("search.minChars")}
 </div>
 ) : results.length === 0 && !isLoading ? (
 <div className="px-4 py-6 text-xs text-[var(--text-muted)] text-center">
 {t("search.noResults")}
 </div>
 ) : (
 results.map((msg, i) => (
 <button
 key={msg.id}
 onClick={() => handleJump(msg)}
 className={cn(
 "w-full flex items-start gap-3 px-4 py-3 text-left transition-colors border-b border-[var(--border)]/50 last:border-0",
 i === selectedIndex
 ? "bg-[var(--bg-hover)]"
 : "hover:bg-[var(--bg-hover)]/60",
 )}
 >
 <UserAvatar user={msg.author} size="sm" className="flex-shrink-0 mt-0.5" />
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 mb-0.5">
 <span className="text-xs font-medium text-[var(--text-primary)]">
 @{msg.author?.username ?? "unknown"}
 </span>
 <span className="text-[10px] text-[var(--text-muted)]">
 {formatDate(msg.createdAt)}
 </span>
 </div>
 <p className="text-xs text-[var(--text-muted)] line-clamp-2 leading-relaxed">
 {highlightMatch(msg.content ?? "", query)}
 </p>
 </div>
 </button>
 ))
 )}
 </div>

 {results.length > 0 && (
 <div className="px-4 py-2 border-t border-[var(--border)] text-[10px] text-[var(--text-muted)] flex items-center gap-3">
 <span>↑↓ navigate</span>
 <span>↵ jump</span>
 <span>Esc close</span>
 </div>
 )}
 </div>
 </div>
 );
}
