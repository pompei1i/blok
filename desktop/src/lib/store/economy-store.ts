import { create } from "zustand";
import { supabase } from "../supabaseClient";
import { mapCatalogItem, BOX_COST, type CatalogItem } from "../economy";
import type { CosmeticType, Rarity } from "./types";

export interface BoxDrop {
  itemId: string;
  type: CosmeticType;
  rarity: Rarity;
  payload: Record<string, any>;
  duplicate: boolean;
  dustAwarded: number;
  newPity: number;
}

interface EquippedState {
  nameplate?: string;
  avatarFrame?: string;
  banner?: string;
}

interface EconomyState {
  userId: string | null;
  coins: number;
  dust: number;
  catalog: CatalogItem[];
  inventory: Set<string>;
  equipped: EquippedState;
  pity: number;
  loading: boolean;
  opening: boolean;
  lastDrop: BoxDrop | null;

  loadEconomy: (userId: string) => Promise<void>;
  refreshWallet: () => Promise<void>;
  openBox: () => Promise<BoxDrop | null>;
  buyItem: (itemId: string) => Promise<{ ok: boolean; reason?: string }>;
  equipItem: (itemId: string) => Promise<boolean>;
  unequipSlot: (type: CosmeticType) => Promise<boolean>;
  /** Optimistic local bump after a quest grants coins (wallet Realtime confirms). */
  addCoins: (delta: number) => void;
  clearDrop: () => void;
  cleanup: () => void;
}

let walletChannel: ReturnType<typeof supabase.channel> | null = null;

export const useEconomyStore = create<EconomyState>((set, get) => ({
  userId: null,
  coins: 0,
  dust: 0,
  catalog: [],
  inventory: new Set(),
  equipped: {},
  pity: 0,
  loading: false,
  opening: false,
  lastDrop: null,

  loadEconomy: async (userId) => {
    set({ loading: true, userId });

    const [walletRes, catalogRes, invRes, gachaRes, profileRes] = await Promise.all([
      supabase.from("user_wallet").select("coins, dust").eq("user_id", userId).maybeSingle(),
      supabase.from("item_catalog").select("*").eq("active", true),
      supabase.from("user_inventory").select("item_id").eq("user_id", userId),
      supabase.from("user_gacha_state").select("opens_since_epic").eq("user_id", userId).maybeSingle(),
      supabase
        .from("profiles")
        .select("equipped_nameplate, equipped_avatar_frame, equipped_banner")
        .eq("id", userId)
        .maybeSingle(),
    ]);

    const catalog = (catalogRes.data ?? []).map(mapCatalogItem);
    const inventory = new Set((invRes.data ?? []).map((r: any) => r.item_id as string));
    const prof = profileRes.data as any;
    const equipped: EquippedState = {
      nameplate: prof?.equipped_nameplate ?? undefined,
      avatarFrame: prof?.equipped_avatar_frame ?? undefined,
      banner: prof?.equipped_banner ?? undefined,
    };

    set({
      coins: walletRes.data?.coins ?? 0,
      dust: walletRes.data?.dust ?? 0,
      catalog,
      inventory,
      equipped,
      pity: gachaRes.data?.opens_since_epic ?? 0,
      loading: false,
    });

    // Realtime: live wallet balance. Re-subscribe on re-login.
    if (walletChannel) await supabase.removeChannel(walletChannel);
    walletChannel = supabase
      .channel(`wallet-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_wallet", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as any;
          if (!row) return;
          set({ coins: row.coins ?? 0, dust: row.dust ?? 0 });
        },
      )
      .subscribe();
  },

  refreshWallet: async () => {
    const { userId } = get();
    if (!userId) return;
    const { data } = await supabase
      .from("user_wallet")
      .select("coins, dust")
      .eq("user_id", userId)
      .maybeSingle();
    if (data) set({ coins: data.coins ?? 0, dust: data.dust ?? 0 });
  },

  openBox: async () => {
    const { userId, opening, coins } = get();
    if (!userId || opening || coins < BOX_COST) return null;

    set({ opening: true });
    const { data, error } = await supabase.rpc("open_loot_box");
    set({ opening: false });

    if (error || !data || !data.ok) return null;

    const drop: BoxDrop = {
      itemId: data.item_id,
      type: data.type,
      rarity: data.rarity,
      payload: data.payload ?? {},
      duplicate: !!data.duplicate,
      dustAwarded: data.dust_awarded ?? 0,
      newPity: data.new_pity ?? 0,
    };

    set((s) => {
      const inventory = new Set(s.inventory);
      if (!drop.duplicate) inventory.add(drop.itemId);
      return { inventory, pity: drop.newPity, lastDrop: drop };
    });
    await get().refreshWallet();
    return drop;
  },

  buyItem: async (itemId) => {
    const { data, error } = await supabase.rpc("buy_item", { p_item_id: itemId });
    if (error || !data) return { ok: false, reason: "error" };
    if (data.ok) {
      set((s) => {
        const inventory = new Set(s.inventory);
        inventory.add(itemId);
        return { inventory };
      });
      await get().refreshWallet();
    }
    return { ok: !!data.ok, reason: data.reason };
  },

  equipItem: async (itemId) => {
    const item = get().catalog.find((c) => c.id === itemId);
    const { data, error } = await supabase.rpc("equip_item", { p_item_id: itemId });
    if (error || !data?.ok) return false;

    if (item) {
      set((s) => {
        const equipped = { ...s.equipped };
        if (item.type === "nameplate") equipped.nameplate = itemId;
        else if (item.type === "avatar_frame") equipped.avatarFrame = itemId;
        else if (item.type === "banner") equipped.banner = itemId;
        return { equipped };
      });
    }
    return true;
  },

  unequipSlot: async (type) => {
    const { data, error } = await supabase.rpc("unequip_slot", { p_type: type });
    if (error || !data?.ok) return false;

    set((s) => {
      const equipped = { ...s.equipped };
      if (type === "nameplate") equipped.nameplate = undefined;
      else if (type === "avatar_frame") equipped.avatarFrame = undefined;
      else if (type === "banner") equipped.banner = undefined;
      return { equipped };
    });
    return true;
  },

  addCoins: (delta) => set((s) => ({ coins: Math.max(0, s.coins + delta) })),

  clearDrop: () => set({ lastDrop: null }),

  cleanup: () => {
    if (walletChannel) {
      void supabase.removeChannel(walletChannel);
      walletChannel = null;
    }
    set({
      userId: null,
      coins: 0,
      dust: 0,
      catalog: [],
      inventory: new Set(),
      equipped: {},
      pity: 0,
      lastDrop: null,
    });
  },
}));
