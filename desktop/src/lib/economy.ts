import type { CSSProperties } from "react";
import type { Rarity, CosmeticType, Cosmetics } from "./store/types";

// ── Tunable constants — MUST stay in sync with supabase/migrations/20260707_gacha_pity_90.sql
export const BOX_COST = 100; // coins per loot-box open
export const DAILY_COIN_CAP = 200; // max coins earnable from quests per user per day
export const PITY_N = 90; // guaranteed legendary on the Nth open without one

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

  // Animated gradient text (shimmer / flame). Both scroll the background so the
  // gradient must be oversized; the keyframes live in the global stylesheet.
  if (Array.isArray(p.gradient) && p.gradient.length > 0) {
    const animated = p.animation === "shimmer" || p.animation === "flame";
    const style: CSSProperties = {
      background: `linear-gradient(90deg, ${p.gradient.join(", ")})`,
      backgroundSize: animated ? "200% auto" : undefined,
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
    };
    const className =
      p.animation === "shimmer" ? "nameplate-shimmer"
      : p.animation === "flame" ? "nameplate-flame"
      : undefined;
    return { style, className };
  }

  // Solid color with optional effects. The `${color}NN` alpha suffix assumes a
  // 6-digit hex (all catalog colors are) → 8-digit hex is valid CSS.
  if (typeof p.color === "string") {
    if (p.effect === "glow") {
      return { style: { color: p.color, textShadow: `0 0 6px ${p.color}, 0 0 14px ${p.color}66` } };
    }
    if (p.effect === "neon") {
      return { style: { color: p.color, textShadow: `0 0 4px ${p.color}, 0 0 9px ${p.color}, 0 0 18px ${p.color}aa` } };
    }
    if (p.animation === "glitch") {
      // The cyan/magenta chromatic-aberration shadow lives in the keyframe.
      return { style: { color: p.color }, className: "nameplate-glitch" };
    }
    return { style: { color: p.color } };
  }

  return {};
}

/** Ring/effect style for an equipped avatar frame, or null if none. */
export function avatarFrameStyle(
  user?: { cosmetics?: Cosmetics } | null,
): { ring?: string; effect?: string; shape?: string; color?: string; color2?: string } | null {
  const fr = user?.cosmetics?.avatar_frame;
  if (!fr) return null;
  const p = fr.payload ?? {};
  return {
    ring: typeof p.ring === "string" ? p.ring : undefined,
    effect: p.effect,
    shape: typeof p.shape === "string" ? p.shape : undefined,
    color: typeof p.color === "string" ? p.color : undefined,
    color2: typeof p.color2 === "string" ? p.color2 : undefined,
  };
}

// Subtle grain as an inline SVG data-URI (feTurbulence) — layered over the
// gradient for legendary "noise" banners. No external asset, no runtime cost.
const NOISE_SVG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E\")";

/** A static texture layer prepended before the gradient, or null. */
function bannerOverlayLayer(overlay?: string): string | null {
  switch (overlay) {
    case "dots":
      return "radial-gradient(circle, rgba(255,255,255,0.18) 1px, transparent 1.5px) 0 0 / 10px 10px";
    case "grid":
      return "linear-gradient(rgba(255,255,255,0.10) 1px, transparent 1px) 0 0 / 14px 14px, linear-gradient(90deg, rgba(255,255,255,0.10) 1px, transparent 1px) 0 0 / 14px 14px";
    case "noise":
      return NOISE_SVG;
    default:
      return null;
  }
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
      const base = `linear-gradient(135deg, ${p.gradient.join(", ")})`;
      const overlay = bannerOverlayLayer(p.overlay);
      return overlay ? `${overlay}, ${base}` : base;
    }
  }
  if (user?.bannerUrl) return `url(${user.bannerUrl}) center/cover`;
  return null;
}

/** Animation class for an equipped banner (e.g. gradient shift), or undefined. */
export function bannerClass(user?: { cosmetics?: Cosmetics } | null): string | undefined {
  const p = user?.cosmetics?.banner?.payload ?? {};
  return p.animation === "shift" ? "banner-shift" : undefined;
}

/** CSS custom-property overrides that re-theme the whole profile card. */
export interface CardTheme {
  bg: string;
  surface: string;
  border: string;
  hover?: string;
}

/**
 * Legendary banners may carry a `theme` payload that recolors the entire
 * profile card (not just the banner strip). Applied by spreading the returned
 * object into the card's inline style — the vars cascade to every child that
 * reads --bg-elevated / --bg-surface / --border. Returns null when absent.
 */
export function bannerTheme(user?: { cosmetics?: Cosmetics } | null): CardTheme | null {
  const t = user?.cosmetics?.banner?.payload?.theme;
  if (!t || typeof t.bg !== "string" || typeof t.surface !== "string" || typeof t.border !== "string") {
    return null;
  }
  return { bg: t.bg, surface: t.surface, border: t.border, hover: typeof t.hover === "string" ? t.hover : undefined };
}

/** Turn a CardTheme into the CSS-variable style object for the profile card. */
export function cardThemeVars(theme: CardTheme | null): CSSProperties | undefined {
  if (!theme) return undefined;
  return {
    "--bg-elevated": theme.bg,
    "--bg-surface": theme.surface,
    "--border": theme.border,
    ...(theme.hover ? { "--bg-hover": theme.hover } : {}),
  } as CSSProperties;
}
