import { useMemo, useState } from "react";
import emojiMartData, { type EmojiMartData } from "@emoji-mart/data";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

interface EmojiEntry {
  native: string;
  /** Lowercased "name keywords id" used for substring search. */
  search: string;
}

// Build the categories + a flat search index once from the full emoji dataset
// (~1800 emojis). Reactions/messages stay color emojis — this only powers the
// picker menu the user opens.
const DATA = emojiMartData as EmojiMartData;

const CATEGORIES: { id: string; icon: string; emojis: EmojiEntry[] }[] = DATA.categories
  .map((cat) => {
    const emojis: EmojiEntry[] = [];
    for (const id of cat.emojis) {
      const e = DATA.emojis[id];
      const native = e?.skins?.[0]?.native;
      if (!native) continue;
      emojis.push({ native, search: `${e.name} ${(e.keywords ?? []).join(" ")} ${id}`.toLowerCase() });
    }
    return { id: cat.id, icon: emojis[0]?.native ?? "?", emojis };
  })
  .filter((c) => c.emojis.length > 0);

const ALL_EMOJIS: EmojiEntry[] = CATEGORIES.flatMap((c) => c.emojis);
const SEARCH_LIMIT = 120;

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const { t } = useI18n();
  const [activeCategory, setActiveCategory] = useState(0);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      q
        ? ALL_EMOJIS.filter((e) => e.search.includes(q)).slice(0, SEARCH_LIMIT)
        : CATEGORIES[activeCategory].emojis,
    [q, activeCategory],
  );

  return (
    <div className="absolute bottom-full right-0 mb-2 w-72 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg shadow-xl overflow-hidden animate-slide-in z-50">
      <div className="p-1.5 border-b border-[var(--border)]">
        <input
          type="text"
          autoFocus
          placeholder={t("emoji.searchEmojis")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md px-2 py-1 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--text-muted)]"
        />
      </div>

      {!q && (
        <div className="flex border-b border-[var(--border)]">
          {CATEGORIES.map((category, idx) => (
            <button
              key={category.id}
              onClick={() => setActiveCategory(idx)}
              className={cn(
                "flex-1 px-1 py-1.5 text-sm transition-colors",
                activeCategory === idx
                  ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]",
              )}
              aria-label={category.id}
            >
              {category.icon}
            </button>
          ))}
        </div>
      )}

      <div className="p-1.5 h-40 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="py-6 text-center text-xs text-[var(--text-muted)]">{t("emoji.noResults")}</p>
        ) : (
          <div className="grid grid-cols-8 gap-0.5">
            {shown.map((e, idx) => (
              <button
                key={`${e.native}-${idx}`}
                onClick={() => {
                  onSelect(e.native);
                  onClose();
                }}
                className="w-7 h-7 flex items-center justify-center text-base hover:bg-[var(--bg-hover)] rounded transition-colors"
              >
                {e.native}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
