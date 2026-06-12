import { describe, it, expect, beforeEach, vi } from "vitest";
import { useEconomyStore } from "../economy-store";
import type { CatalogItem } from "../../economy";

const rpc = () => (globalThis as Record<string, unknown>).__mockSupabaseRpc as ReturnType<typeof vi.fn>;

function npItem(id: string): CatalogItem {
  return { id, type: "nameplate", rarity: "common", name: id, payload: { color: "#abc" }, shopCost: 200, shopCurrency: "coins", weight: 60, active: true };
}

beforeEach(() => {
  rpc().mockReset();
  rpc().mockResolvedValue({ data: null, error: null });
  useEconomyStore.setState({
    userId: "u1",
    coins: 0,
    dust: 0,
    catalog: [],
    inventory: new Set<string>(),
    equipped: { badges: [] },
    pity: 0,
    loading: false,
    opening: false,
    lastDrop: null,
  });
});

// ── addCoins / clearDrop ──────────────────────────────────────────────────────
describe("addCoins", () => {
  it("adds and never goes negative", () => {
    useEconomyStore.getState().addCoins(50);
    expect(useEconomyStore.getState().coins).toBe(50);
    useEconomyStore.getState().addCoins(-999);
    expect(useEconomyStore.getState().coins).toBe(0);
  });
});

describe("clearDrop", () => {
  it("clears lastDrop", () => {
    useEconomyStore.setState({ lastDrop: { itemId: "x", type: "badge", rarity: "common", payload: {}, duplicate: false, dustAwarded: 0, newPity: 1 } });
    useEconomyStore.getState().clearDrop();
    expect(useEconomyStore.getState().lastDrop).toBeNull();
  });
});

// ── openBox ───────────────────────────────────────────────────────────────────
describe("openBox", () => {
  it("does nothing when the user cannot afford a box", async () => {
    useEconomyStore.setState({ coins: 10 }); // < BOX_COST (100)
    const drop = await useEconomyStore.getState().openBox();
    expect(drop).toBeNull();
    expect(rpc()).not.toHaveBeenCalled();
  });

  it("adds a new item to inventory and updates pity on a fresh drop", async () => {
    useEconomyStore.setState({ coins: 150 });
    rpc().mockResolvedValueOnce({
      data: { ok: true, item_id: "np_ocean", type: "nameplate", rarity: "rare", payload: { color: "#3b82f6" }, duplicate: false, dust_awarded: 0, new_pity: 1 },
      error: null,
    });
    const drop = await useEconomyStore.getState().openBox();
    expect(drop?.itemId).toBe("np_ocean");
    expect(useEconomyStore.getState().inventory.has("np_ocean")).toBe(true);
    expect(useEconomyStore.getState().pity).toBe(1);
    expect(useEconomyStore.getState().lastDrop?.duplicate).toBe(false);
  });

  it("does not add to inventory on a duplicate but records the drop", async () => {
    useEconomyStore.setState({ coins: 150, inventory: new Set(["np_ocean"]) });
    rpc().mockResolvedValueOnce({
      data: { ok: true, item_id: "np_ocean", type: "nameplate", rarity: "rare", payload: {}, duplicate: true, dust_awarded: 25, new_pity: 2 },
      error: null,
    });
    const drop = await useEconomyStore.getState().openBox();
    expect(drop?.duplicate).toBe(true);
    expect(drop?.dustAwarded).toBe(25);
    expect(useEconomyStore.getState().inventory.size).toBe(1);
  });

  it("returns null when the RPC reports failure", async () => {
    useEconomyStore.setState({ coins: 150 });
    rpc().mockResolvedValueOnce({ data: { ok: false, reason: "insufficient" }, error: null });
    const drop = await useEconomyStore.getState().openBox();
    expect(drop).toBeNull();
  });
});

// ── buyItem ───────────────────────────────────────────────────────────────────
describe("buyItem", () => {
  it("adds the item to inventory on success", async () => {
    rpc().mockResolvedValueOnce({ data: { ok: true, item_id: "frame_bronze" }, error: null });
    const res = await useEconomyStore.getState().buyItem("frame_bronze");
    expect(res.ok).toBe(true);
    expect(useEconomyStore.getState().inventory.has("frame_bronze")).toBe(true);
  });

  it("does not add the item when the purchase is rejected", async () => {
    rpc().mockResolvedValueOnce({ data: { ok: false, reason: "owned" }, error: null });
    const res = await useEconomyStore.getState().buyItem("frame_bronze");
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("owned");
    expect(useEconomyStore.getState().inventory.has("frame_bronze")).toBe(false);
  });
});

// ── equip / unequip ───────────────────────────────────────────────────────────
describe("equipItem / unequipSlot", () => {
  it("optimistically sets the equipped nameplate slot", async () => {
    useEconomyStore.setState({ catalog: [npItem("np_crimson")], inventory: new Set(["np_crimson"]) });
    rpc().mockResolvedValueOnce({ data: { ok: true }, error: null });
    const ok = await useEconomyStore.getState().equipItem("np_crimson");
    expect(ok).toBe(true);
    expect(useEconomyStore.getState().equipped.nameplate).toBe("np_crimson");
  });

  it("clears the slot on unequip", async () => {
    useEconomyStore.setState({ equipped: { nameplate: "np_crimson", badges: [] } });
    rpc().mockResolvedValueOnce({ data: { ok: true }, error: null });
    const ok = await useEconomyStore.getState().unequipSlot("nameplate");
    expect(ok).toBe(true);
    expect(useEconomyStore.getState().equipped.nameplate).toBeUndefined();
  });

  it("toggles badges off when equipping an already-equipped badge", async () => {
    useEconomyStore.setState({
      catalog: [{ id: "badge_fire", type: "badge", rarity: "common", name: "Fire", payload: { icon: "🔥" }, shopCost: 100, shopCurrency: "coins", weight: 60, active: true }],
      inventory: new Set(["badge_fire"]),
      equipped: { badges: ["badge_fire"] },
    });
    rpc().mockResolvedValueOnce({ data: { ok: true }, error: null });
    await useEconomyStore.getState().equipItem("badge_fire");
    expect(useEconomyStore.getState().equipped.badges).not.toContain("badge_fire");
  });
});
