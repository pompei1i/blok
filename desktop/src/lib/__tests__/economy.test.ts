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
    expect(PITY_N).toBe(10);
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
});
