// Pure, framework-agnostic core for the Ctrl+K quick switcher.
// Kept separate from the React component so the matching/ranking is unit-testable.

export type PaletteItemType = "server" | "channel" | "person";

export interface PaletteItem {
  type: PaletteItemType;
  /** Stable id used as React key; format is "<type>:<entityId>" to avoid collisions. */
  key: string;
  /** Primary entity id (serverId / channelId / userId). */
  id: string;
  label: string;
  /** Secondary line, e.g. the server a channel belongs to. Also searched. */
  sublabel?: string;
  /** For channels: the server to switch to before selecting the channel. */
  serverId?: string;
}

/**
 * Substring score for `query` within `text`. Returns null when there's no match,
 * otherwise a lower number is a better match (earlier position, exact-prefix bonus).
 */
export function scoreMatch(text: string, query: string): number | null {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return 0;
  const idx = t.indexOf(q);
  if (idx === -1) return null;
  // Prefix matches rank best; otherwise earlier offsets win.
  return idx === 0 ? -1 : idx;
}

/**
 * Filter + rank palette items for a query. Empty query returns the head of the
 * list unchanged (so the palette shows recent/all items). Matches consider both
 * the label and the sublabel; the better of the two scores wins.
 */
export function filterCommandItems(
  items: PaletteItem[],
  query: string,
  limit = 10,
): PaletteItem[] {
  const trimmed = query.trim();
  if (!trimmed) return items.slice(0, limit);

  const scored: { item: PaletteItem; score: number }[] = [];
  for (const item of items) {
    const labelScore = scoreMatch(item.label, trimmed);
    const subScore = item.sublabel ? scoreMatch(item.sublabel, trimmed) : null;
    const best =
      labelScore === null ? subScore
      : subScore === null ? labelScore
      : Math.min(labelScore, subScore);
    if (best !== null) scored.push({ item, score: best });
  }

  // Stable sort: by score asc, ties keep original order.
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((s) => s.item);
}
