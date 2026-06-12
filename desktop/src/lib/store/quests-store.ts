import { create } from "zustand";
import { supabase } from "../supabaseClient";
import { DAILY_QUESTS, type QuestDef } from "../quests";
import { useToastStore } from "./toast-store";
import { translate } from "../i18n";

export interface QuestProgress {
  questId: string;
  count: number;
  claimed: boolean;
}

interface QuestsState {
  progress: QuestProgress[];
  serverId: string | null;
  loading: boolean;

  loadQuests: (userId: string, serverId: string) => Promise<void>;
  claimQuest: (questId: string, xp: number, coins: number) => Promise<boolean>;
  cleanup: () => void;
}

let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

export const useQuestsStore = create<QuestsState>((set, get) => ({
  progress: [],
  serverId: null,
  loading: false,

  loadQuests: async (userId, serverId) => {
    set({ loading: true, serverId });

    const today = new Date().toISOString().slice(0, 10);

    const [progressRes, claimsRes] = await Promise.all([
      supabase
        .from("daily_quest_progress")
        .select("quest_type, count")
        .eq("user_id", userId)
        .eq("server_id", serverId)
        .eq("date", today),
      supabase
        .from("daily_quest_claims")
        .select("quest_id")
        .eq("user_id", userId)
        .eq("server_id", serverId)
        .eq("date", today),
    ]);

    const counts: Record<string, number> = {};
    (progressRes.data ?? []).forEach((r: any) => { counts[r.quest_type] = r.count; });

    const claimedIds = new Set((claimsRes.data ?? []).map((r: any) => r.quest_id));

    const progress: QuestProgress[] = DAILY_QUESTS.map((q) => ({
      questId: q.id,
      count: counts[q.type] ?? 0,
      claimed: claimedIds.has(q.id),
    }));

    set({ progress, loading: false });

    // Realtime: re-subscribe on server change
    if (realtimeChannel) await supabase.removeChannel(realtimeChannel);
    realtimeChannel = supabase
      .channel(`quests-${userId}-${serverId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_quest_progress", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as any;
          if (!row || row.server_id !== serverId) return;
          const completed: QuestDef[] = [];
          set((state) => ({
            progress: state.progress.map((p) => {
              const q = DAILY_QUESTS.find((q) => q.id === p.questId);
              if (!q || q.type !== row.quest_type) return p;
              const wasDone = p.count >= q.target;
              const nowDone = row.count >= q.target;
              if (!wasDone && nowDone && !p.claimed) completed.push(q);
              return { ...p, count: row.count };
            }),
          }));
          for (const q of completed) {
            useToastStore.getState().showToast({
              emoji: q.emoji,
              title: translate("quests.completed"),
              message: `${q.label} · +${q.xp} XP · 🪙${q.coins}`,
            });
          }
        },
      )
      .subscribe();
  },

  claimQuest: async (questId, xp, coins) => {
    const { serverId } = get();
    if (!serverId) return false;
    const { data } = await supabase.rpc("claim_quest_reward", {
      p_server_id: serverId,
      p_quest_id: questId,
      p_xp: xp,
      p_coins: coins,
    });
    const claimed = !!data?.claimed;
    if (claimed) {
      set((state) => ({
        progress: state.progress.map((p) =>
          p.questId === questId ? { ...p, claimed: true } : p,
        ),
      }));
      const granted = data?.coins_granted ?? 0;
      if (granted > 0) {
        const { useEconomyStore } = await import("./economy-store");
        useEconomyStore.getState().addCoins(granted);
      }
    }
    return claimed;
  },

  cleanup: () => {
    if (realtimeChannel) {
      void supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    set({ progress: [], serverId: null });
  },
}));
