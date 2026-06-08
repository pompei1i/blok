import { create } from "zustand";
import { supabase } from "../supabaseClient";
import { DAILY_QUESTS } from "../quests";

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
  claimQuest: (questId: string, xp: number) => Promise<boolean>;
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
          set((state) => ({
            progress: state.progress.map((p) => {
              const q = DAILY_QUESTS.find((q) => q.id === p.questId);
              if (!q || q.type !== row.quest_type) return p;
              return { ...p, count: row.count };
            }),
          }));
        },
      )
      .subscribe();
  },

  claimQuest: async (questId, xp) => {
    const { serverId } = get();
    if (!serverId) return false;
    const { data } = await supabase.rpc("claim_quest_xp", {
      p_server_id: serverId,
      p_quest_id: questId,
      p_xp: xp,
    });
    if (data) {
      set((state) => ({
        progress: state.progress.map((p) =>
          p.questId === questId ? { ...p, claimed: true } : p,
        ),
      }));
    }
    return !!data;
  },

  cleanup: () => {
    if (realtimeChannel) {
      void supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    set({ progress: [], serverId: null });
  },
}));
