import { create } from "zustand";
import { supabase } from "../supabaseClient";
import { mapProfile } from "../utils";
import type { UserRelationship, PresenceStatus } from "./types";

let friendsChannel: ReturnType<typeof import("../supabaseClient").supabase.channel> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

/** Threshold: if last_seen is older than this, the user is considered offline. */
export const ONLINE_THRESHOLD_MS = 90_000;

/** Derive display status from the raw DB status + last_seen timestamp. */
export function effectiveStatus(
  status: PresenceStatus | undefined,
  lastSeen: string | undefined,
): PresenceStatus {
  if (status === "offline") return "offline";
  if (!lastSeen || Date.now() - new Date(lastSeen).getTime() > ONLINE_THRESHOLD_MS) return "offline";
  if (status === "dnd" || status === "afk") return status;
  return "online";
}

interface FriendsState {
  friends: UserRelationship[];
  pendingRequests: UserRelationship[];
  outgoingRequests: UserRelationship[];
  presence: Record<string, PresenceStatus>;
  presenceLastSeen: Record<string, string>;
  activity: Record<string, string>;
  /** Ids whose presence the UI actually shows (friends ∪ co-server-members ∪ self).
   *  Bounds presence fetches and filters out churn from unrelated users. */
  presenceTrackedIds: Set<string>;
  currentUserId: string | null;
  loadError: string | null;

  initFriendsData: (userId: string) => Promise<void>;
  /** Idempotently fetch + merge presence for a set of users (called by both
   *  friends-store and server-store as relationships/members load). */
  trackPresenceFor: (userIds: string[]) => Promise<void>;
  removeFriend: (relationshipId: string) => Promise<void>;
  updatePresence: (userId: string, status: PresenceStatus) => Promise<void>;
  setActivity: (userId: string, activity: string | null) => Promise<void>;
  acceptRequest: (relationshipId: string) => Promise<void>;
  declineRequest: (relationshipId: string) => Promise<void>;
  sendFriendRequest: (username: string, currentUserId: string) => Promise<{ success: boolean; message: string }>;
  cancelRequest: (relationshipId: string) => Promise<void>;
  patchUser: (user: import("./types").User) => void;
}

export const useFriendsStore = create<FriendsState>((set, get) => ({
  friends: [],
  pendingRequests: [],
  outgoingRequests: [],
  presence: {},
  presenceLastSeen: {},
  activity: {},
  presenceTrackedIds: new Set<string>(),
  currentUserId: null,
  loadError: null,

  trackPresenceFor: async (userIds) => {
    const tracked = get().presenceTrackedIds;
    const newIds = [...new Set(userIds)].filter((id) => id && !tracked.has(id));
    if (newIds.length === 0) return;

    // Grow the tracked set immediately so concurrent callers don't double-fetch
    // and so the realtime relevance filter recognises these ids right away.
    set((state) => {
      const next = new Set(state.presenceTrackedIds);
      for (const id of newIds) next.add(id);
      return { presenceTrackedIds: next };
    });

    const { data } = await supabase
      .from("user_presence")
      .select("user_id, status, online_at, activity")
      .in("user_id", newIds);
    if (!data || data.length === 0) return;

    set((state) => {
      const presence = { ...state.presence };
      const presenceLastSeen = { ...state.presenceLastSeen };
      const activity = { ...state.activity };
      for (const p of data as any[]) {
        presence[p.user_id] = p.status;
        if (p.online_at) presenceLastSeen[p.user_id] = p.online_at;
        if (p.activity) activity[p.user_id] = p.activity;
      }
      return { presence, presenceLastSeen, activity };
    });
  },

  initFriendsData: async (userId) => {
    try {
      set({ currentUserId: userId });

      // 1. Fetch relationships
      const { data: relData, error: relError } = await supabase
        .from("user_relationships")
        .select("*")
        .or(`requester_id.eq.${userId},target_id.eq.${userId}`);

      if (relError) {
        console.error("Err loading relationships", relError);
        set({ loadError: relError.message ?? "Failed to load relationships" });
      } else {
        set({ loadError: null });
      }

      const relationshipRows = relData || [];
      const profileIds = Array.from(
        new Set(
          relationshipRows.flatMap((r: any) => [r.requester_id, r.target_id]).filter(Boolean),
        ),
      );

      let profilesById: Record<string, any> = {};
      if (profileIds.length > 0) {
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("*")
          .in("id", profileIds);

        if (profileError) {
          console.error("Err loading profiles for relationships", profileError);
          set({
            loadError:
              profileError.message ?? "Failed to load profiles for relationships",
          });
        } else {
          profilesById = Object.fromEntries((profileData || []).map((p: any) => [p.id, p]));
        }
      }

      const friends: UserRelationship[] = [];
      const pending: UserRelationship[] = [];
      const outgoing: UserRelationship[] = [];

      relationshipRows.forEach((r: any) => {
        const requesterProfile = profilesById[r.requester_id];
        const targetProfile = profilesById[r.target_id];

        const rel: UserRelationship = {
          id: r.id,
          requesterId: r.requester_id,
          targetId: r.target_id,
          status: r.status,
          createdAt: r.created_at,
          requesterUser: requesterProfile ? mapProfile(requesterProfile) : undefined,
          targetUser: targetProfile ? mapProfile(targetProfile) : undefined,
        };

        if (rel.status === "accepted") friends.push(rel);
        else if (rel.status === "pending") {
          if (rel.requesterId === userId) outgoing.push(rel);
          else pending.push(rel);
        }
      });

      const getTime = (value?: string) => {
        if (!value) return 0;
        const parsed = new Date(value).getTime();
        return Number.isNaN(parsed) ? 0 : parsed;
      };

      const dedupeByCounterparty = (
        list: UserRelationship[],
        mode: "friends" | "incoming" | "outgoing",
      ) => {
        const map = new Map<string, UserRelationship>();
        for (const rel of list) {
          const counterpartyId =
            mode === "incoming"
              ? rel.requesterId
              : mode === "outgoing"
                ? rel.targetId
                : rel.requesterId === userId
                  ? rel.targetId
                  : rel.requesterId;

          const prev = map.get(counterpartyId);
          if (!prev || getTime(rel.createdAt) > getTime(prev.createdAt)) {
            map.set(counterpartyId, rel);
          }
        }
        return Array.from(map.values());
      };

      const uniqueFriends = dedupeByCounterparty(friends, "friends");
      const uniqueIncoming = dedupeByCounterparty(pending, "incoming");
      const uniqueOutgoing = dedupeByCounterparty(outgoing, "outgoing");

      set({
        friends: uniqueFriends,
        pendingRequests: uniqueIncoming,
        outgoingRequests: uniqueOutgoing,
      });

      // 2. Fetch presence scoped to people the UI shows (friends + self).
      //    Server members are added separately by server-store via
      //    trackPresenceFor — both load concurrently, and trackPresenceFor is
      //    idempotent so order doesn't matter.
      const friendIds = [
        userId,
        ...uniqueFriends.map((r) => (r.requesterId === userId ? r.targetId : r.requesterId)),
        ...uniqueIncoming.map((r) => r.requesterId),
        ...uniqueOutgoing.map((r) => r.targetId),
      ];
      await get().trackPresenceFor(friendIds);

      // 3. Realtime setup — unsubscribe previous channel on re-init (e.g. re-login)
      if (friendsChannel) {
        await supabase.removeChannel(friendsChannel);
        friendsChannel = null;
      }

      friendsChannel = supabase
        .channel(`friends-${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "user_presence" },
          (payload) => {
            if (payload.new && "status" in payload.new) {
              const p = payload.new as any;
              // Ignore churn from users the UI never shows (not a friend or
              // co-server-member). Keeps state + re-renders scoped to our network.
              if (!get().presenceTrackedIds.has(p.user_id)) return;
              set((state) => ({
                presence: { ...state.presence, [p.user_id]: p.status },
                ...(p.online_at ? { presenceLastSeen: { ...state.presenceLastSeen, [p.user_id]: p.online_at } } : {}),
                activity: p.activity != null
                  ? { ...state.activity, [p.user_id]: p.activity }
                  : (() => { const a = { ...state.activity }; delete a[p.user_id]; return a; })(),
              }));
            }
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "user_relationships" },
          (payload) => {
            const row = (payload.new ?? payload.old) as any;
            if (!row) return;
            if (row.requester_id === userId || row.target_id === userId) {
              get().initFriendsData(userId);
            }
          },
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "profiles" },
          (payload) => {
            const updated = mapProfile(payload.new as any);
            set((state) => {
              const patch = (rel: import("./types").UserRelationship) => ({
                ...rel,
                requesterUser: rel.requesterUser?.id === updated.id ? updated : rel.requesterUser,
                targetUser: rel.targetUser?.id === updated.id ? updated : rel.targetUser,
              });
              return {
                friends: state.friends.map(patch),
                pendingRequests: state.pendingRequests.map(patch),
                outgoingRequests: state.outgoingRequests.map(patch),
              };
            });
          },
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            void get().updatePresence(userId, 'online');
          }
        });

      // Heartbeat: keep online_at fresh so peers can infer online/offline from timestamp
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(() => {
        void supabase.from("user_presence").upsert({
          user_id: userId,
          status: 'online',
          online_at: new Date().toISOString(),
        });
      }, 30_000);

    } catch(e) {
      console.error(e);
      set({
        loadError: e instanceof Error ? e.message : "Unexpected friends load error",
      });
    }
  },

  removeFriend: async (relationshipId) => {
    const { error } = await supabase.from("user_relationships").delete().eq("id", relationshipId);
    if (!error) {
      set((state) => ({
        friends: state.friends.filter(f => f.id !== relationshipId)
      }));
    }
  },

  setActivity: async (userId, activity) => {
    set((state) => {
      const a = { ...state.activity };
      if (activity) a[userId] = activity; else delete a[userId];
      return { activity: a };
    });
    await supabase.from("user_presence").upsert({ user_id: userId, activity: activity ?? null });
  },

  updatePresence: async (userId, status) => {
    if (status === 'offline') {
      // Stop heartbeat before writing so it can't race with the offline write
      if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
      // Don't update online_at — keeps "last seen X ago" accurate
      set((state) => ({ presence: { ...state.presence, [userId]: status } }));
      await supabase.from("user_presence").upsert({ user_id: userId, status });
    } else {
      const now = new Date().toISOString();
      set((state) => ({
        presence: { ...state.presence, [userId]: status },
        presenceLastSeen: { ...state.presenceLastSeen, [userId]: now },
      }));
      await supabase.from("user_presence").upsert({ user_id: userId, status, online_at: now });
    }
  },

  acceptRequest: async (relationshipId) => {
    const { error } = await supabase.from("user_relationships").update({ status: "accepted" }).eq("id", relationshipId);
    if (!error) {
       set((state) => {
         const req = state.pendingRequests.find(r => r.id === relationshipId);
         if (!req) return state;
         return {
           pendingRequests: state.pendingRequests.filter(r => r.id !== relationshipId),
           friends: [...state.friends, { ...req, status: "accepted" }]
         };
       });

      const currentUserId = get().currentUserId;
      if (currentUserId) {
        await get().initFriendsData(currentUserId);
      }
    }
  },

  declineRequest: async (relationshipId) => {
    const { error } = await supabase.from("user_relationships").delete().eq("id", relationshipId);
    if (!error) {
       set((state) => ({
         pendingRequests: state.pendingRequests.filter(r => r.id !== relationshipId),
       }));

      const currentUserId = get().currentUserId;
      if (currentUserId) {
        await get().initFriendsData(currentUserId);
      }
    }
  },

  sendFriendRequest: async (username, currentUserId) => {
    // 1. Find user by username
    const { data: targetProfile, error: profileErr } = await supabase.from("profiles").select("id").ilike("username", username).single();
    if (profileErr || !targetProfile) {
       if (profileErr?.code === "PGRST116") {
         return { success: false, message: "User not found" };
       }
       return {
         success: false,
         message: profileErr?.message ?? "Failed to load user profile",
       };
    }

    if (targetProfile.id === currentUserId) {
       return { success: false, message: "Cannot send request to yourself" };
    }

    // 2. Prevent duplicates locally
    const state = get();
    const existing = [...state.friends, ...state.outgoingRequests, ...state.pendingRequests].find(
      r => r.requesterId === targetProfile.id || r.targetId === targetProfile.id
    );
    if (existing) {
      if (existing.status === "accepted") {
        return { success: false, message: "You are already friends with this user" };
      }
      if (existing.requesterId === currentUserId) {
        return {
          success: false,
          message: "Outgoing request already exists (see Outgoing Requests)",
        };
      }
      return {
        success: false,
        message: "Incoming request already exists (see Incoming Requests)",
      };
    }

    // 3. Send Request
    const { error } = await supabase.from("user_relationships").insert({
       requester_id: currentUserId,
       target_id: targetProfile.id,
       status: "pending"
    });

    if (error) {
       if (error.code === "23505") {
         return {
           success: false,
           message: "Request already exists between these users",
         };
       }
       if (error.code === "42501") {
         return {
           success: false,
           message: "Permission denied by database policy (RLS)",
         };
       }
       return {
         success: false,
         message: error.message ?? "Failed to send request",
       };
    }

    await get().initFriendsData(currentUserId);
    
    return { success: true, message: `Friend request sent to ${username}` };
  },

  cancelRequest: async (relationshipId) => {
    const { error } = await supabase.from("user_relationships").delete().eq("id", relationshipId);
    if (!error) {
       set((state) => ({
         outgoingRequests: state.outgoingRequests.filter(r => r.id !== relationshipId),
       }));

      const currentUserId = get().currentUserId;
      if (currentUserId) {
        await get().initFriendsData(currentUserId);
      }
    }
  },

  patchUser: (user) => {
    const patch = (rel: import("./types").UserRelationship) => ({
      ...rel,
      requesterUser: rel.requesterUser?.id === user.id ? user : rel.requesterUser,
      targetUser: rel.targetUser?.id === user.id ? user : rel.targetUser,
    });
    set((state) => ({
      friends: state.friends.map(patch),
      pendingRequests: state.pendingRequests.map(patch),
      outgoingRequests: state.outgoingRequests.map(patch),
    }));
  },
}));
