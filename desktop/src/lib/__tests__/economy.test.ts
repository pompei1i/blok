import { describe, it, expect } from "vitest";
import {
  BOX_COST,
  DAILY_COIN_CAP,
  PITY_N,
  DUPLICATE_DUST,
  rarityColor,
  mapCatalogItem,
  nameplateStyle,
  avatarFrameStyle,
  bannerBackground,
  bannerClass,
  bannerTheme,
  cardThemeVars,
} from "../economy";
import type { Cosmetics } from "../store/types";

function withCosmetics(c: Cosmetics) {
  return { cosmetics: c } as { cosmetics?: Cosmetics };
}

// ── constants ───────────────────────────────────────────────────────────────
describe("economy constants", () => {
  it("match the migration values", () => {
    expect(BOX_COST).toBe(100);
    expect(DAILY_COIN_CAP).toBe(200);
    expect(PITY_N).toBe(90);
    expect(DUPLICATE_DUST).toEqual({ common: 10, rare: 25, epic: 60, legendary: 150 });
  });
});

describe("rarityColor", () => {
  it("returns a distinct color per rarity", () => {
    const colors = new Set([
      rarityColor("common"),
      rarityColor("rare"),
      rarityColor("epic"),
      rarityColor("legendary"),
    ]);
    expect(colors.size).toBe(4);
  });
});

// ── mapCatalogItem ──────────────────────────────────────────────────────────
describe("mapCatalogItem", () => {
  it("maps snake_case DB row to a CatalogItem", () => {
    const item = mapCatalogItem({
      id: "np_crimson",
      type: "nameplate",
      rarity: "common",
      name: "Crimson Name",
      payload: { color: "#e74c3c" },
      shop_cost: 200,
      shop_currency: "coins",
      weight: 60,
      active: true,
    });
    expect(item.shopCost).toBe(200);
    expect(item.shopCurrency).toBe("coins");
    expect(item.payload.color).toBe("#e74c3c");
  });

  it("treats null shop_cost as not-for-sale", () => {
    const item = mapCatalogItem({ id: "x", type: "banner", rarity: "legendary", name: "X", shop_cost: null });
    expect(item.shopCost).toBeNull();
  });
});

// ── nameplateStyle ──────────────────────────────────────────────────────────
describe("nameplateStyle", () => {
  it("returns empty object when no nameplate equipped", () => {
    expect(nameplateStyle(null)).toEqual({});
    expect(nameplateStyle(withCosmetics({}))).toEqual({});
  });

  it("applies a flat color", () => {
    const out = nameplateStyle(withCosmetics({ nameplate: { id: "np", rarity: "common", payload: { color: "#abc" } } }));
    expect(out.style?.color).toBe("#abc");
    expect(out.className).toBeUndefined();
  });

  it("applies a gradient with background-clip text", () => {
    const out = nameplateStyle(withCosmetics({ nameplate: { id: "np", rarity: "epic", payload: { gradient: ["#f00", "#00f"] } } }));
    expect(out.style?.color).toBe("transparent");
    expect(out.style?.WebkitBackgroundClip).toBe("text");
    expect(out.style?.background).toContain("#f00");
  });

  it("adds the shimmer class for animated gradients", () => {
    const out = nameplateStyle(withCosmetics({ nameplate: { id: "np", rarity: "legendary", payload: { gradient: ["#f00", "#00f"], animation: "shimmer" } } }));
    expect(out.className).toBe("nameplate-shimmer");
  });

  it("adds the flame class for flame gradients", () => {
    const out = nameplateStyle(withCosmetics({ nameplate: { id: "np", rarity: "epic", payload: { gradient: ["#fbbf24", "#ef4444"], animation: "flame" } } }));
    expect(out.className).toBe("nameplate-flame");
    expect(out.style?.backgroundSize).toBe("200% auto");
  });

  it("adds a text-shadow for glow / neon effects", () => {
    const glow = nameplateStyle(withCosmetics({ nameplate: { id: "np", rarity: "rare", payload: { color: "#22d3ee", effect: "glow" } } }));
    expect(glow.style?.color).toBe("#22d3ee");
    expect(glow.style?.textShadow).toContain("#22d3ee");
    const neon = nameplateStyle(withCosmetics({ nameplate: { id: "np", rarity: "epic", payload: { color: "#ec4899", effect: "neon" } } }));
    expect(neon.style?.textShadow).toContain("#ec4899");
  });

  it("adds the glitch class for glitch animation", () => {
    const out = nameplateStyle(withCosmetics({ nameplate: { id: "np", rarity: "legendary", payload: { color: "#e2e8f0", animation: "glitch" } } }));
    expect(out.className).toBe("nameplate-glitch");
    expect(out.style?.color).toBe("#e2e8f0");
  });
});

// ── avatarFrameStyle ────────────────────────────────────────────────────────
describe("avatarFrameStyle", () => {
  it("returns null when no frame equipped", () => {
    expect(avatarFrameStyle(null)).toBeNull();
  });

  it("returns ring and effect", () => {
    const out = avatarFrameStyle(withCosmetics({ avatar_frame: { id: "f", rarity: "epic", payload: { ring: "#ffd700", effect: "glow" } } }));
    expect(out?.ring).toBe("#ffd700");
    expect(out?.effect).toBe("glow");
  });

  it("returns shape and colors for SVG frames", () => {
    const out = avatarFrameStyle(withCosmetics({ avatar_frame: { id: "f", rarity: "legendary", payload: { shape: "orbit", color: "#a855f7", color2: "#c084fc" } } }));
    expect(out?.shape).toBe("orbit");
    expect(out?.color).toBe("#a855f7");
    expect(out?.color2).toBe("#c084fc");
  });
});

// ── bannerBackground ────────────────────────────────────────────────────────
describe("bannerBackground", () => {
  it("returns null when nothing is set", () => {
    expect(bannerBackground(null)).toBeNull();
    expect(bannerBackground({})).toBeNull();
  });

  it("prefers an equipped gradient banner", () => {
    const bg = bannerBackground(withCosmetics({ banner: { id: "b", rarity: "common", payload: { gradient: ["#111", "#222"] } } }));
    expect(bg).toContain("linear-gradient");
    expect(bg).toContain("#111");
  });

  it("uses an equipped image banner when provided", () => {
    const bg = bannerBackground(withCosmetics({ banner: { id: "b", rarity: "rare", payload: { url: "https://x/y.png" } } }));
    expect(bg).toContain("url(https://x/y.png)");
  });

  it("falls back to bannerUrl when no cosmetic banner", () => {
    const bg = bannerBackground({ bannerUrl: "https://z/w.png" });
    expect(bg).toContain("url(https://z/w.png)");
  });

  it("prepends a texture layer for overlay banners", () => {
    const dots = bannerBackground(withCosmetics({ banner: { id: "b", rarity: "epic", payload: { gradient: ["#111", "#222"], overlay: "dots" } } }));
    expect(dots).toContain("radial-gradient");
    expect(dots).toContain("linear-gradient(135deg"); // base gradient still present
    const noise = bannerBackground(withCosmetics({ banner: { id: "b", rarity: "legendary", payload: { gradient: ["#111", "#222"], overlay: "noise" } } }));
    expect(noise).toContain("feTurbulence");
  });
});

// ── bannerClass ─────────────────────────────────────────────────────────────
describe("bannerClass", () => {
  it("returns undefined when not animated", () => {
    expect(bannerClass(null)).toBeUndefined();
    expect(bannerClass(withCosmetics({ banner: { id: "b", rarity: "common", payload: { gradient: ["#111"] } } }))).toBeUndefined();
  });

  it("returns banner-shift for shift animation", () => {
    expect(bannerClass(withCosmetics({ banner: { id: "b", rarity: "rare", payload: { gradient: ["#111"], animation: "shift" } } }))).toBe("banner-shift");
  });
});

// ── bannerTheme / cardThemeVars ─────────────────────────────────────────────
describe("bannerTheme", () => {
  it("returns null without a complete theme payload", () => {
    expect(bannerTheme(null)).toBeNull();
    expect(bannerTheme(withCosmetics({ banner: { id: "b", rarity: "legendary", payload: { gradient: ["#111"] } } }))).toBeNull();
    // partial theme (missing border) → rejected
    expect(bannerTheme(withCosmetics({ banner: { id: "b", rarity: "legendary", payload: { theme: { bg: "#000", surface: "#111" } } } }))).toBeNull();
  });

  it("extracts a full theme", () => {
    const t = bannerTheme(withCosmetics({ banner: { id: "b", rarity: "legendary", payload: { theme: { bg: "#0d0516", surface: "#1a0f2e", border: "#7c3aed", hover: "#241542" } } } }));
    expect(t).toEqual({ bg: "#0d0516", surface: "#1a0f2e", border: "#7c3aed", hover: "#241542" });
  });

  it("cardThemeVars maps a theme to CSS custom properties", () => {
    const vars = cardThemeVars({ bg: "#0d0516", surface: "#1a0f2e", border: "#7c3aed" }) as Record<string, string>;
    expect(vars["--bg-elevated"]).toBe("#0d0516");
    expect(vars["--bg-surface"]).toBe("#1a0f2e");
    expect(vars["--border"]).toBe("#7c3aed");
    expect(cardThemeVars(null)).toBeUndefined();
  });
});
