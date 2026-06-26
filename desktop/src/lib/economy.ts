import type { CSSProperties } from "react";
import type { Rarity, CosmeticType, Cosmetics } from "./store/types";

// ── Tunable constants — MUST stay in sync with supabase/migrations/20260611_economy.sql
export const BOX_COST = 100; // coins per loot-box open
export const DAILY_COIN_CAP = 200; // max coins earnable from quests per user per day
export const PITY_N = 10; // guaranteed epic+ on the Nth open without one

/** Dust awarded when a box rolls an item already owned (per rarity). */
export const DUPLICATE_DUST: Record<Rarity, number> = {
  common: 10,
  rare: 25,
  epic: 60,
  legendary: 150,
};

/** A catalog row as returned from item_catalog. */
export interface CatalogItem {
  id: string;
  type: CosmeticType;
  rarity: Rarity;
  name: string;
  payload: Record<string, any>;
  shopCost: number | null;
  shopCurrency: "coins" | "dust";
  weight: number;
  active: boolean;
}

export function mapCatalogItem(row: Record<string, any>): CatalogItem {
  return {
    id: row.id,
    type: row.type,
    rarity: row.rarity,
    name: row.name,
    payload: row.payload ?? {},
    shopCost: row.shop_cost ?? null,
    shopCurrency: row.shop_currency ?? "coins",
    weight: row.weight ?? 0,
    active: row.active ?? true,
  };
}

/** Accent color per rarity — used for borders, glows, drop reveals. */
export function rarityColor(rarity: Rarity): string {
  switch (rarity) {
    case "legendary": return "#f59e0b";
    case "epic":      return "#a855f7";
    case "rare":      return "#3b82f6";
    default:          return "#6b7280";
  }
}

export const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

export const COSMETIC_TYPE_LABEL: Record<CosmeticType, string> = {
  nameplate: "Nameplate",
  avatar_frame: "Avatar Frame",
  banner: "Banner",
};

/**
 * Inline style + optional class for an equipped nameplate (username color/gradient).
 * Returns `{}` when the user has no nameplate equipped, so it's safe to spread.
 * The `nameplate-shimmer` keyframe is defined in the global stylesheet.
 */
export function nameplateStyle(
  user?: { cosmetics?: Cosmetics } | null,
): { style?: CSSProperties; className?: string } {
  const np = user?.cosmetics?.nameplate;
  if (!np) return {};
  const p = np.payload ?? {};

  if (Array.isArray(p.gradient) && p.gradient.length > 0) {
    const style: CSSProperties = {
      background: `linear-gradient(90deg, ${p.gradient.join(", ")})`,
      backgroundSize: p.animation === "shimmer" ? "200% auto" : undefined,
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
    };
    return { style, className: p.animation === "shimmer" ? "nameplate-shimmer" : undefined };
  }

  if (typeof p.color === "string") {
    return { style: { color: p.color } };
  }

  return {};
}

/** Ring/effect style for an equipped avatar frame, or null if none. */
export function avatarFrameStyle(
  user?: { cosmetics?: Cosmetics } | null,
): { ring?: string; effect?: string } | null {
  const fr = user?.cosmetics?.avatar_frame;
  if (!fr) return null;
  const p = fr.payload ?? {};
  return { ring: typeof p.ring === "string" ? p.ring : undefined, effect: p.effect };
}

/** CSS background for an equipped banner (gradient or hosted image), or null. */
export function bannerBackground(
  user?: { cosmetics?: Cosmetics; bannerUrl?: string; accentColor?: string } | null,
): string | null {
  const bn = user?.cosmetics?.banner;
  if (bn) {
    const p = bn.payload ?? {};
    if (typeof p.url === "string") return `url(${p.url}) center/cover`;
    if (Array.isArray(p.gradient) && p.gradient.length > 0) {
      return `linear-gradient(135deg, ${p.gradient.join(", ")})`;
    }
  }
  if (user?.bannerUrl) return `url(${user.bannerUrl}) center/cover`;
  return null;
}
