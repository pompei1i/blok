import { create } from "zustand";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";
import { mapProfile } from "../utils";
import type { UserRelationship, PresenceStatus } from "./types";

let friendsChannel: RealtimeChannel | null = null;
let onlineChannel: RealtimeChannel | null = null;
let lastSeenInterval: ReturnType<typeof setInterval> | null = null;

/** Every signed-in client joins this one Realtime Presence channel, keyed by
 *  user id. A user is online while at least one of their connections is in it.
 *  Realtime drops a dead socket's entry by itself, so a crash, sleep or lost
 *  network reads as offline without any client-side timeout. */
export const ONLINE_CHANNEL = "online-users";

/** How often a connected client persists its last-seen time. Only matters for
 *  users who drop without a clean quit — a quit or logout writes it directly. */
export const LAST_SEEN_INTERVAL_MS = 5 * 60_000;

/** Display status for a user; anyone not in the presence channel is offline. */
export function effectiveStatus(status: PresenceStatus | undefined): PresenceStatus {
  return status ?? "offline";
}

// async + await on purpose: a PostgREST builder only sends its request once
// awaited, so `void supabase.from(...).upsert(...)` silently never runs.
async function writeLastSeen(userId: string, status: "online" | "offline") {
  await supabase
    .from("user_presence")
    .upsert({ user_id: userId, status, online_at: new Date().toISOString() });
}

/** Rebuild online/offline for every tracked id from the presence channel. */
function syncOnlineStatus() {
  if (!onlineChannel) return;
  const online = new Set(Object.keys(onlineChannel.presenceState()));
  useFriendsStore.setState((state) => {
    const presence = { ...state.presence };
    const presenceLastSeen = { ...state.presenceLastSeen };
    const now = new Date().toISOString();
    let changed = false;
    for (const id of state.presenceTrackedIds) {
      const next: PresenceStatus = online.has(id) ? "online" : "offline";
      if (presence[id] === next) continue;
      // We watched them leave, so this moment is fresher than the stored last-seen.
      if (presence[id] === "online") presenceLastSeen[id] = now;
      presence[id] = next;
      changed = true;
    }
    return changed ? { presence, presenceLastSeen } : state;
  });
}

interface FriendsState {
  friends: UserRelationship[];
  pendingRequests: UserRelationship[];
  outgoingRequests: UserRelationship[];
  /** Live status from the presence channel; absent means offline. */
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
  /** Apply a single user_relationships realtime change incrementally instead of
   *  re-fetching the whole friends graph. */
  applyRelationshipEvent: (eventType: "INSERT" | "UPDATE" | "DELETE", row: any) => Promise<void>;
  removeFriend: (relationshipId: string) => Promise<void>;
  /** Leave the presence channel and persist last-seen (quit / logout). */
  stopPresence: () => Promise<void>;
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
    syncOnlineStatus();

    // Online-ness comes from the presence channel; the table only holds
    // last-seen and activity.
    const { data } = await supabase
      .from("user_presence")
      .select("user_id, online_at, activity")
      .in("user_id", newIds);
    if (!data || data.length === 0) return;

    set((state) => {
      const presenceLastSeen = { ...state.presenceLastSeen };
      const activity = { ...state.activity };
      for (const p of data as any[]) {
        // A leave observed while this fetch was in flight is newer — keep it.
        const observed = presenceLastSeen[p.user_id];
        if (p.online_at && !(observed && Date.parse(observed) > Date.parse(p.online_at))) {
          presenceLastSeen[p.user_id] = p.online_at;
        }
        if (p.activity) activity[p.user_id] = p.activity;
      }
      return { presenceLastSeen, activity };
    });
  },

  applyRelationshipEvent: async (eventType, row) => {
    if (!row?.id) return;

    // DELETE payloads carry only the primary key (no requester/target), so
    // remove by id across every bucket — a no-op if we never had it.
    if (eventType === "DELETE") {
      set((state) => ({
        friends: state.friends.filter((r) => r.id !== row.id),
        pendingRequests: state.pendingRequests.filter((r) => r.id !== row.id),
        outgoingRequests: state.outgoingRequests.filter((r) => r.id !== row.id),
      }));
      return;
    }

    const me = get().currentUserId;
    if (!me || (row.requester_id !== me && row.target_id !== me)) return;
    const counterpartyId = row.requester_id === me ? row.target_id : row.requester_id;

    // Reuse a counterparty profile we already hold; otherwise fetch just that
    // one row instead of re-loading the entire friends graph.
    let counterpartyUser = [...get().friends, ...get().pendingRequests, ...get().outgoingRequests]
      .map((r) => (r.requesterId === counterpartyId ? r.requesterUser
                 : r.targetId === counterpartyId ? r.targetUser : undefined))
      .find(Boolean);
    if (!counterpartyUser) {
      const { data } = await supabase.from("profiles").select("*").eq("id", counterpartyId).single();
      if (data) counterpartyUser = mapProfile(data);
    }

    const rel: UserRelationship = {
      id: row.id,
      requesterId: row.requester_id,
      targetId: row.target_id,
      status: row.status,
      createdAt: row.created_at,
      requesterUser: row.requester_id === counterpartyId ? counterpartyUser : undefined,
      targetUser: row.target_id === counterpartyId ? counterpartyUser : undefined,
    };

    // Re-bucket by (status, direction), removing any stale copy by id first.
    set((state) => {
      const friends = state.friends.filter((r) => r.id !== row.id);
      const pendingRequests = state.pendingRequests.filter((r) => r.id !== row.id);
      const outgoingRequests = state.outgoingRequests.filter((r) => r.id !== row.id);
      if (rel.status === "accepted") friends.push(rel);
      else if (rel.status === "pending") {
        if (rel.requesterId === me) outgoingRequests.push(rel);
        else pendingRequests.push(rel);
      }
      return { friends, pendingRequests, outgoingRequests };
    });

    void get().trackPresenceFor([counterpartyId]);
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
            if (payload.new && "user_id" in payload.new) {
              const p = payload.new as any;
              // Ignore churn from users the UI never shows (not a friend or
              // co-server-member). Keeps state + re-renders scoped to our network.
              if (!get().presenceTrackedIds.has(p.user_id)) return;
              set((state) => ({
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
            void get().applyRelationshipEvent(payload.eventType as "INSERT" | "UPDATE" | "DELETE", row);
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
        .subscribe();

      // 4. Presence — this client counts as online while it's in the channel.
      if (onlineChannel) await supabase.removeChannel(onlineChannel);
      if (lastSeenInterval) clearInterval(lastSeenInterval);
      const ch = supabase.channel(ONLINE_CHANNEL, { config: { presence: { key: userId } } });
      onlineChannel = ch;
      ch.on("presence", { event: "sync" }, syncOnlineStatus)
        .subscribe((status) => {
          // Server-side presence dies with the socket; re-track on every
          // (re)join or we stay invisible after a reconnect.
          if (status !== "SUBSCRIBED") return;
          void ch.track({ online_at: new Date().toISOString() });
          void writeLastSeen(userId, "online");
        });
      lastSeenInterval = setInterval(() => void writeLastSeen(userId, "online"), LAST_SEEN_INTERVAL_MS);

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

  stopPresence: async () => {
    if (lastSeenInterval) { clearInterval(lastSeenInterval); lastSeenInterval = null; }
    const ch = onlineChannel;
    if (!ch) return;
    onlineChannel = null;
    const me = get().currentUserId;
    // Leaving the channel drops our presence for everyone right away.
    await Promise.all([
      supabase.removeChannel(ch),
      me ? writeLastSeen(me, "offline") : null,
    ]);
  },

  acceptRequest: async (relationshipId) => {
    const { error } = await supabase.from("user_relationships").update({ status: "accepted" }).eq("id", relationshipId);
    if (!error) {
       // Optimistic move pending → friends; the realtime UPDATE re-buckets by id
       // (idempotent) and tracks the new friend's presence.
       const me = get().currentUserId;
       const req = get().pendingRequests.find(r => r.id === relationshipId);
       set((state) => {
         if (!req) return state;
         return {
           pendingRequests: state.pendingRequests.filter(r => r.id !== relationshipId),
           friends: [...state.friends, { ...req, status: "accepted" as const }]
         };
       });
       if (req) {
         void get().trackPresenceFor([req.requesterId === me ? req.targetId : req.requesterId]);
       }
    }
  },

  declineRequest: async (relationshipId) => {
    const { error } = await supabase.from("user_relationships").delete().eq("id", relationshipId);
    if (!error) {
       // Optimistic remove; the realtime DELETE removes by id (idempotent).
       set((state) => ({
         pendingRequests: state.pendingRequests.filter(r => r.id !== relationshipId),
       }));
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

    // The outgoing request appears via the realtime INSERT (applyRelationshipEvent),
    // no full re-fetch needed.
    return { success: true, message: `Friend request sent to ${username}` };
  },

  cancelRequest: async (relationshipId) => {
    const { error } = await supabase.from("user_relationships").delete().eq("id", relationshipId);
    if (!error) {
       // Optimistic remove; the realtime DELETE removes by id (idempotent).
       set((state) => ({
         outgoingRequests: state.outgoingRequests.filter(r => r.id !== relationshipId),
       }));
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
