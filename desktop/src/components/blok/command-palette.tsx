import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { Hash, Server, AtSign, Search, CornerDownLeft } from "lucide-react";
import { useServerStore } from "@/lib/store/server-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { useFriendsStore } from "@/lib/store/friends-store";
import { useDMStore } from "@/lib/store/dm-store";
import { useBaitStore } from "@/lib/store/bait-store";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { filterCommandItems, type PaletteItem } from "@/lib/command-palette";
import type { User } from "@/lib/store/types";

export function CommandPalette() {
  const { t } = useI18n();
  const { servers, channels, members, activeServerId, setActiveServer, setActiveChannel, openTab } = useServerStore();
  const { user } = useAuthStore();
  const { friends } = useFriendsStore();
  const { openDM } = useDMStore();
  const baitActive = useBaitStore((s) => s.isActive);
  const deactivateBait = useBaitStore((s) => s.deactivate);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Global Ctrl/Cmd+K toggle ────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reset + focus when opening.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      // Focus after the portal mounts.
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  // ── Build the full item list from the loaded stores ─────────────────────────
  const allItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];

    for (const s of servers) {
      items.push({ type: "server", key: `server:${s.id}`, id: s.id, label: s.name });
    }

    for (const s of servers) {
      for (const ch of channels[s.id] ?? []) {
        if (ch.type !== "text") continue; // voice channels are joined, not navigated
        items.push({
          type: "channel", key: `channel:${ch.id}`, id: ch.id,
          label: ch.name, sublabel: s.name, serverId: s.id,
        });
      }
    }

    // People: members across all servers + friends, deduped by userId, minus self.
    const people = new Map<string, User>();
    for (const list of Object.values(members)) {
      for (const m of list) {
        if (m.user && m.userId !== user?.id) people.set(m.userId, m.user);
      }
    }
    for (const f of friends) {
      const isReq = f.requesterId === user?.id;
      const other = isReq ? f.targetUser : f.requesterUser;
      const otherId = isReq ? f.targetId : f.requesterId;
      if (other && otherId !== user?.id && !people.has(otherId)) people.set(otherId, other);
    }
    for (const [id, u] of people) {
      items.push({ type: "person", key: `person:${id}`, id, label: u.displayName ?? u.username, sublabel: `@${u.username}` });
    }

    return items;
  }, [servers, channels, members, friends, user?.id]);

  const results = useMemo(() => filterCommandItems(allItems, query, 12), [allItems, query]);

  // Keep the highlighted row in range as results change.
  useEffect(() => { setActiveIndex(0); }, [query]);

  const select = (item: PaletteItem | undefined) => {
    if (!item) return;
    if (baitActive) deactivateBait();
    if (item.type === "server") {
      openTab(item.id);
      setActiveServer(item.id);
    } else if (item.type === "channel") {
      if (item.serverId && item.serverId !== activeServerId) {
        openTab(item.serverId);
        setActiveServer(item.serverId);
      }
      setActiveChannel(item.id);
    } else if (item.type === "person" && user) {
      void openDM(user.id, item.id);
    }
    setOpen(false);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); select(results[activeIndex]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  };

  if (!open) return null;

  const iconFor = (type: PaletteItem["type"]) =>
    type === "server" ? <Server className="w-4 h-4 flex-shrink-0" />
    : type === "channel" ? <Hash className="w-4 h-4 flex-shrink-0" />
    : <AtSign className="w-4 h-4 flex-shrink-0" />;

  return createPortal(
    <div
      className="fixed inset-0 z-[10001] bg-black/50 flex items-start justify-center pt-[12vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg bg-[var(--bg-elevated)] border border-[var(--border)] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border)]">
          <Search className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder={t("palette.placeholder")}
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
          <kbd className="text-[10px] font-mono text-[var(--text-muted)] border border-[var(--border)] px-1.5 py-0.5 rounded">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-[var(--text-muted)]">{t("palette.empty")}</p>
          ) : (
            results.map((item, i) => (
              <button
                key={item.key}
                onClick={() => select(item)}
                onMouseEnter={() => setActiveIndex(i)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors",
                  i === activeIndex
                    ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
                )}
              >
                <span className={cn(i === activeIndex ? "text-[var(--accent-red)]" : "")}>{iconFor(item.type)}</span>
                <span className="flex-1 min-w-0 truncate text-sm">
                  {item.label}
                  {item.sublabel && (
                    <span className="ml-1.5 text-[11px] text-[var(--text-muted)] opacity-70">{item.sublabel}</span>
                  )}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] opacity-50">
                  {t(`palette.group.${item.type}` as Parameters<typeof t>[0])}
                </span>
                {i === activeIndex && <CornerDownLeft className="w-3 h-3 text-[var(--text-muted)] flex-shrink-0" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
