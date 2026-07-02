import type { StateCreator } from "zustand";
import { supabase } from "../../supabaseClient";
import { mapProfile } from "../../utils";
import { getActiveNativeVoiceEngine } from "../../native-voice-engine";
import type { Server, Category, Channel, ServerMember, User, VoiceParticipant, Role, ServerBan, AuditEntry } from "../types";
import type { ServerStore } from "../server-store.shape";
import {
  voicePresenceCh, setVoicePresenceCh,
  trackDataChannel, clearDataChannels,
} from "./_shared";

function removeChannelFromState(
  state: Pick<ServerStore, "channels" | "channelIndex" | "activeChannelId">,
  channelId: string
) {
  const newChannels: Record<string, Channel[]> = {};
  const newChannelIndex = { ...state.channelIndex };
  delete newChannelIndex[channelId];
  for (const [sid, chs] of Object.entries(state.channels)) {
    newChannels[sid] = chs.filter((c) => c.id !== channelId);
  }
  return {
    channels: newChannels,
    channelIndex: newChannelIndex,
    activeChannelId: state.activeChannelId === channelId
      ? Object.values(newChannels).flat().find((c) => c.type === "text")?.id ?? null
      : state.activeChannelId,
  };
}

export interface ServerSlice {
  _currentUserId: string | null;
  servers: Server[];
  activeServerId: string | null;
  activeChannelId: string | null;
  categories: Record<string, Category[]>;
  channels: Record<string, Channel[]>;
  channelIndex: Record<string, Channel>;
  members: Record<string, ServerMember[]>;
  roles: Record<string, Role[]>;
  userProfileCache: Record<string, User>;
  memberUserIndex: Record<string, { serverId: string; memberId: string }[]>;
  openTabs: string[];
  serverAccessOrder: string[];
  lastChannelPerServer: Record<string, string>;
  unreadCounts: Record<string, number>;
  bans: Record<string, ServerBan[]>;
  auditLog: Record<string, AuditEntry[]>;

  initData: (userId: string) => Promise<void>;
  setActiveServer: (serverId: string | null) => void;
  setActiveChannel: (channelId: string | null) => void;
  createServer: (data: { name: string; description?: string }) => Promise<void>;
  createChannel: (data: { serverId: string; name: string; type: "text" | "voice"; categoryId?: string }) => Promise<void>;
  deleteChannel: (channelId: string) => Promise<void>;
  renameChannel: (channelId: string, name: string) => Promise<void>;
  renameServer: (serverId: string, name: string) => Promise<void>;
  createCategory: (serverId: string, name: string) => Promise<void>;
  renameCategory: (categoryId: string, name: string) => Promise<void>;
  deleteCategory: (categoryId: string) => Promise<void>;
  reorderCategories: (serverId: string, items: { id: string; position: number }[]) => Promise<void>;
  reorderChannels: (serverId: string, items: { id: string; categoryId: string | null; position: number }[]) => Promise<void>;
  removeServer: (serverId: string) => void;
  inviteUser: (serverId: string, username: string) => Promise<string | null>;
  generateInviteCode: (serverId: string, opts?: { expiresAt?: string | null; maxUses?: number | null }) => Promise<string | null>;
  joinByInviteCode: (code: string, userId: string) => Promise<string | null>;
  openTab: (serverId: string) => void;
  closeTab: (serverId: string) => void;
  patchUser: (user: User) => void;
  // Roles
  createRole: (data: { serverId: string; name: string; color?: string; permissions: number }) => Promise<void>;
  updateRole: (roleId: string, serverId: string, data: { name?: string; color?: string; permissions?: number }) => Promise<void>;
  deleteRole: (roleId: string, serverId: string) => Promise<void>;
  assignRole: (memberId: string, serverId: string, roleId: string | null) => Promise<void>;
  kickMember: (memberId: string, serverId: string) => Promise<void>;
  updateServerIcon: (serverId: string, iconUrl: string | null) => Promise<void>;
  // Moderation
  banMember: (serverId: string, userId: string, reason?: string) => Promise<string | null>;
  unbanMember: (serverId: string, userId: string) => Promise<void>;
  timeoutMember: (serverId: string, userId: string, minutes: number) => Promise<string | null>;
  setChannelSlowmode: (channelId: string, seconds: number) => Promise<void>;
  loadBans: (serverId: string) => Promise<void>;
  loadAuditLog: (serverId: string) => Promise<void>;
  // Search
  searchUsers: (serverId: string, query: string) => User[];
  searchChannels: (serverId: string, query: string) => Channel[];
}

export const createServerSlice: StateCreator<ServerStore, [], [], ServerSlice> = (set, get) => ({
  _currentUserId: null,
  servers: [],
  activeServerId: null,
  activeChannelId: null,
  categories: {},
  channels: {},
  channelIndex: {},
  members: {},
  roles: {},
  userProfileCache: {},
  memberUserIndex: {},
  openTabs: [],
  serverAccessOrder: [],
  lastChannelPerServer: {},
  unreadCounts: {},
  bans: {},
  auditLog: {},

  initData: async (_userId) => {
    try {
      const [serverRes, channelRes, categoryRes, memberRes, rolesRes] = await Promise.all([
        supabase.from("servers").select("*"),
        supabase.from("channels").select("*"),
        supabase.from("categories").select("*"),
        supabase.from("server_members").select("*, user:profiles(*)"),
        supabase.from("roles").select("*"),
      ]);

      if (serverRes.error) console.error("Err loading servers", serverRes.error);
      if (channelRes.error) console.error("Err loading channels", channelRes.error);
      if (categoryRes.error) console.error("Err loading categories", categoryRes.error);
      if (memberRes.error) console.error("Err loading members", memberRes.error);
      if (rolesRes.error) console.error("Err loading roles", rolesRes.error);

      const servers: Server[] = (serverRes.data || []).map((s) => ({
        id: s.id, ownerId: s.owner_id, name: s.name, iconUrl: s.icon_url,
        description: s.description, inviteCode: s.invite_code, createdAt: s.created_at,
        inviteExpiresAt: s.invite_expires_at ?? null,
        inviteMaxUses: s.invite_max_uses ?? null,
        inviteUsedCount: s.invite_used_count ?? 0,
      }));

      const channelsMap: Record<string, Channel[]> = {};
      const channelIndex: Record<string, Channel> = {};
      (channelRes.data || []).forEach((c) => {
        if (!channelsMap[c.server_id]) channelsMap[c.server_id] = [];
        const ch: Channel = {
          id: c.id, serverId: c.server_id, categoryId: c.category_id, name: c.name,
          type: c.type, topic: c.topic, position: c.position,
          isPrivate: c.is_private, slowModeSeconds: c.slow_mode_seconds ?? 0, createdAt: c.created_at,
        };
        channelsMap[c.server_id].push(ch);
        channelIndex[c.id] = ch;
      });

      const categoriesMap: Record<string, Category[]> = {};
      (categoryRes.data || []).forEach((c) => {
        if (!categoriesMap[c.server_id]) categoriesMap[c.server_id] = [];
        categoriesMap[c.server_id].push({
          id: c.id, serverId: c.server_id, name: c.name,
          position: c.position, createdAt: c.created_at,
        });
      });

      const membersMap: Record<string, ServerMember[]> = {};
      const userProfileCache: Record<string, User> = {};
      const memberUserIndex: Record<string, { serverId: string; memberId: string }[]> = {};
      (memberRes.data || []).forEach((m) => {
        if (!membersMap[m.server_id]) membersMap[m.server_id] = [];
        const user = m.user ? mapProfile(m.user) : undefined;
        if (user) userProfileCache[m.user_id] = user;
        const entry: ServerMember = {
          id: m.id, serverId: m.server_id, userId: m.user_id,
          roleId: m.role_id, nickname: m.nickname, joinedAt: m.joined_at,
          xp: m.xp ?? 0, timeoutUntil: m.timeout_until ?? null, user,
        };
        membersMap[m.server_id].push(entry);
        if (!memberUserIndex[m.user_id]) memberUserIndex[m.user_id] = [];
        memberUserIndex[m.user_id].push({ serverId: m.server_id, memberId: m.id });
      });

      const rolesMap: Record<string, Role[]> = {};
      (rolesRes.data || []).forEach((r) => {
        if (!rolesMap[r.server_id]) rolesMap[r.server_id] = [];
        rolesMap[r.server_id].push({
          id: r.id, serverId: r.server_id, name: r.name, color: r.color,
          permissions: r.permissions, position: r.position,
          isDefault: r.is_default, createdAt: r.created_at,
        });
      });

      const validServerIds = new Set(servers.map((s) => s.id));
      const prevTabs = get().openTabs.filter((id) => validServerIds.has(id));
      const prevActiveId = get().activeServerId;
      const restoredActiveId = prevActiveId && validServerIds.has(prevActiveId) ? prevActiveId : (prevTabs[0] ?? null);
      const restoredChannels = restoredActiveId ? (channelsMap[restoredActiveId] ?? []) : [];
      const prevLastChannel = restoredActiveId ? get().lastChannelPerServer[restoredActiveId] : null;
      const restoredChannel = prevLastChannel
        ? restoredChannels.find((c) => c.id === prevLastChannel)
        : null;
      const fallbackChannel = restoredChannels.find((c) => c.type === "text") ?? restoredChannels[0] ?? null;
      const targetChannel = restoredChannel ?? fallbackChannel;

      set({
        servers, categories: categoriesMap, channels: channelsMap, channelIndex,
        members: membersMap, roles: rolesMap, userProfileCache, memberUserIndex,
        openTabs: prevTabs,
        activeServerId: restoredActiveId,
        activeChannelId: targetChannel?.id ?? null,
      });

      if (targetChannel) void get().loadMessages(targetChannel.id);

      // Track presence for every co-server-member (friends-store fetches friends
      // separately; trackPresenceFor is idempotent so the union is race-free).
      void import("../friends-store").then(({ useFriendsStore }) =>
        useFriendsStore.getState().trackPresenceFor(Object.keys(memberUserIndex)),
      );

      set({ _currentUserId: _userId });
      // Clean up channels from any previous initData call BEFORE creating new
      // subscriptions — calling this after initMessageRealtime/initPollRealtime
      // would tear down the channels they just registered via trackDataChannel.
      await clearDataChannels();
      get().initMessageRealtime(_userId);
      get().initPollRealtime(_userId);
      if (voicePresenceCh) await supabase.removeChannel(voicePresenceCh);
      const ch = supabase.channel("voice-presence", { config: { presence: { key: _userId } } });
      setVoicePresenceCh(ch);

      const syncPresence = () => {
        if (!voicePresenceCh) return;
        const raw = voicePresenceCh.presenceState() as Record<string, Array<{
          userId: string; voiceChannelId: string | null;
          isMuted?: boolean; isDeafened?: boolean; isScreenSharing?: boolean;
        }>>;
        const all = Object.values(raw).flat();
        const newMap: Record<string, VoiceParticipant[]> = {};
        const cache = get().userProfileCache;
        const missingProfileIds: string[] = [];
        for (const p of all) {
          if (!p.voiceChannelId) continue;
          if (!newMap[p.voiceChannelId]) newMap[p.voiceChannelId] = [];
          const cachedUser = cache[p.userId];
          if (!cachedUser) missingProfileIds.push(p.userId);
          newMap[p.voiceChannelId].push({
            userId: p.userId, channelId: p.voiceChannelId,
            isMuted: p.isMuted ?? false, isDeafened: p.isDeafened ?? false,
            isScreenSharing: p.isScreenSharing ?? false, isSpeaking: false, user: cachedUser,
          });
        }
        set((state) => {
          const merged: Record<string, VoiceParticipant[]> = {};
          for (const [chId, participants] of Object.entries(newMap)) {
            const existingById: Record<string, VoiceParticipant> = {};
            for (const e of (state.voiceParticipants[chId] ?? [])) existingById[e.userId] = e;
            merged[chId] = participants.map((p) => {
              const existing = existingById[p.userId];
              return existing ? { ...p, isSpeaking: existing.isSpeaking, user: p.user ?? existing.user } : p;
            });
          }

          // Reconcile screenSharers against presence: if a sharer stopped (or
          // left) while WE were offline, we missed their screenshare_stop and
          // the overlay keeps a frozen frame forever. Presence is the truth:
          // drop streams whose owner is gone from the channel, or whose flag
          // is false AND our viewer PC to them is dead (the flag alone can lag
          // ~1s behind a freshly-started share, so a live PC keeps the stream).
          let screenSharers = state.screenSharers;
          let watchingUserId = state.watchingUserId;
          const activeCh = state.activeVoiceChannelId;
          if (activeCh && Object.keys(screenSharers).length > 0) {
            const inChannel = new Map((merged[activeCh] ?? []).map((p) => [p.userId, p]));
            const engine = getActiveNativeVoiceEngine();
            const next: typeof screenSharers = {};
            for (const [uid, stream] of Object.entries(screenSharers)) {
              const p = inChannel.get(uid);
              const stale = !p || (!p.isScreenSharing && !(engine?.hasLiveViewerPc(uid) ?? false));
              if (!stale) next[uid] = stream;
            }
            if (Object.keys(next).length !== Object.keys(screenSharers).length) {
              screenSharers = next;
              if (watchingUserId && !next[watchingUserId]) {
                const rest = Object.keys(next);
                watchingUserId = rest.length > 0 ? rest[0] : null;
              }
            }
          }

          return { voiceParticipants: merged, screenSharers, watchingUserId };
        });
        const uniqueMissing = [...new Set(missingProfileIds)];
        if (uniqueMissing.length > 0) {
          supabase.from("profiles").select("*").in("id", uniqueMissing).then(({ data }) => {
            if (!data || data.length === 0) return;
            const byId: Record<string, User> = {};
            for (const row of data) byId[row.id] = mapProfile(row);
            set((s) => ({
              userProfileCache: { ...s.userProfileCache, ...byId },
              voiceParticipants: Object.fromEntries(
                Object.entries(s.voiceParticipants).map(([chId, parts]) => [
                  chId, parts.map((p) => !p.user && byId[p.userId] ? { ...p, user: byId[p.userId] } : p),
                ])
              ),
            }));
          });
        }
      };

      ch.on("presence", { event: "sync" }, syncPresence)
        .on("presence", { event: "join" }, syncPresence)
        .on("presence", { event: "leave" }, syncPresence)
        .subscribe((status) => {
          // Presence state on the server dies with the socket. After the
          // client auto-rejoins (SUBSCRIBED fires again), re-announce our
          // voice state or our tile silently vanishes for everyone else.
          // First SUBSCRIBED is a no-op: activeVoiceChannelId is null at init.
          if (status !== "SUBSCRIBED") return;
          const s = get();
          if (s.activeVoiceChannelId && s._currentUserId) {
            void ch.track({
              userId: s._currentUserId,
              voiceChannelId: s.activeVoiceChannelId,
              isMuted: s.isMuted,
              isDeafened: s.isDeafened,
              isScreenSharing: s.isScreenSharing,
            });
          }
        });

      trackDataChannel(
        supabase.channel("public:servers").on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "servers" },
          (payload) => {
            const s = payload.new;
            const newServer: Server = {
              id: s.id, ownerId: s.owner_id, name: s.name, iconUrl: s.icon_url,
              description: s.description, inviteCode: s.invite_code, createdAt: s.created_at,
              inviteExpiresAt: s.invite_expires_at ?? null,
              inviteMaxUses: s.invite_max_uses ?? null,
              inviteUsedCount: s.invite_used_count ?? 0,
            };
            set((state) => ({ servers: [...state.servers, newServer], openTabs: [...state.openTabs, newServer.id] }));
          }
        ).on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "servers" },
          (payload) => {
            const s = payload.new;
            set((state) => ({
              servers: state.servers.map((srv) =>
                srv.id === s.id
                  ? {
                      ...srv,
                      name: s.name,
                      iconUrl: s.icon_url ?? undefined,
                      description: s.description,
                      inviteCode: s.invite_code,
                      inviteExpiresAt: s.invite_expires_at ?? null,
                      inviteMaxUses: s.invite_max_uses ?? null,
                      inviteUsedCount: s.invite_used_count ?? 0,
                    }
                  : srv
              ),
            }));
          }
        ).subscribe()
      );

      trackDataChannel(
        supabase.channel("public:profiles").on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "profiles" },
          (payload) => {
            const updated = mapProfile(payload.new as any);
            set((state) => {
              const targets = state.memberUserIndex[updated.id] ?? [];
              const affectedServerIds = new Set(targets.map((t) => t.serverId));
              const updatedMembers = { ...state.members };
              for (const srvId of affectedServerIds) {
                updatedMembers[srvId] = (updatedMembers[srvId] ?? []).map(
                  (m) => m.userId === updated.id ? { ...m, user: updated } : m
                );
              }
              return {
                userProfileCache: { ...state.userProfileCache, [updated.id]: updated },
                members: updatedMembers,
                voiceParticipants: Object.fromEntries(
                  Object.entries(state.voiceParticipants).map(([chId, parts]) => [
                    chId, parts.map((p) => p.user?.id === updated.id ? { ...p, user: updated } : p),
                  ])
                ),
              };
            });
          }
        ).subscribe()
      );

      trackDataChannel(
        supabase.channel("public:server_members").on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "server_members" },
          (payload) => {
            const m = payload.new as any;
            if (!m?.server_id) return;
            set((state) => {
              const list = state.members[m.server_id];
              if (!list) return {};
              return {
                members: {
                  ...state.members,
                  [m.server_id]: list.map((mem) =>
                    mem.id === m.id
                      ? {
                          ...mem,
                          xp: m.xp ?? mem.xp,
                          roleId: m.role_id ?? undefined,
                          nickname: m.nickname ?? undefined,
                          timeoutUntil: m.timeout_until ?? null,
                        }
                      : mem,
                  ),
                },
              };
            });
          },
        ).on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "server_members" },
          (payload) => {
            // Kick / ban / leave from another client. DELETE payloads carry only
            // the PK, so locate the member entry in local state by row id.
            const deletedId = (payload.old as any)?.id;
            if (!deletedId) return;
            let removed: ServerMember | undefined;
            for (const list of Object.values(get().members)) {
              removed = list.find((m) => m.id === deletedId);
              if (removed) break;
            }
            if (!removed) return; // acting client already dropped it locally
            const { serverId, userId } = removed;
            set((state) => ({
              members: {
                ...state.members,
                [serverId]: (state.members[serverId] ?? []).filter((m) => m.id !== deletedId),
              },
              memberUserIndex: {
                ...state.memberUserIndex,
                [userId]: (state.memberUserIndex[userId] ?? []).filter((e) => e.memberId !== deletedId),
              },
            }));
            // If *we* were removed, drop the whole server from this client too.
            if (userId === get()._currentUserId) get().removeServer(serverId);
          },
        ).subscribe(),
      );

      trackDataChannel(
        supabase.channel("public:roles").on(
          "postgres_changes",
          { event: "*", schema: "public", table: "roles" },
          (payload) => {
            if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
              const r = payload.new;
              const role: Role = {
                id: r.id, serverId: r.server_id, name: r.name, color: r.color,
                permissions: r.permissions, position: r.position,
                isDefault: r.is_default, createdAt: r.created_at,
              };
              set((state) => {
                const list = state.roles[r.server_id] ?? [];
                const exists = list.some((x) => x.id === r.id);
                return {
                  roles: {
                    ...state.roles,
                    [r.server_id]: exists ? list.map((x) => (x.id === r.id ? role : x)) : [...list, role],
                  },
                };
              });
            } else if (payload.eventType === "DELETE") {
              // DELETE payloads carry only the primary key, so sweep all servers.
              const id = payload.old.id;
              set((state) => {
                const newRoles: Record<string, Role[]> = {};
                for (const [sid, list] of Object.entries(state.roles)) {
                  newRoles[sid] = list.filter((x) => x.id !== id);
                }
                const newMembers: Record<string, ServerMember[]> = {};
                for (const [sid, list] of Object.entries(state.members)) {
                  newMembers[sid] = list.map((m) => (m.roleId === id ? { ...m, roleId: undefined } : m));
                }
                return { roles: newRoles, members: newMembers };
              });
            }
          }
        ).subscribe()
      );

      trackDataChannel(
        supabase.channel("public:channels").on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "channels" },
          (payload) => {
            const c = payload.new;
            const newChannel: Channel = {
              id: c.id, serverId: c.server_id, categoryId: c.category_id, name: c.name,
              type: c.type, topic: c.topic, position: c.position,
              isPrivate: c.is_private, slowModeSeconds: c.slow_mode_seconds ?? 0, createdAt: c.created_at,
            };
            set((state) => {
              const existing = state.channels[c.server_id] || [];
              if (existing.some((ch) => ch.id === c.id)) return {};
              return {
                channels: { ...state.channels, [c.server_id]: [...existing, newChannel].sort((a, b) => a.position - b.position) },
                channelIndex: { ...state.channelIndex, [newChannel.id]: newChannel },
              };
            });
          }
        ).subscribe()
      );

      trackDataChannel(
        supabase.channel("public:channels:update").on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "channels" },
          (payload) => {
            const c = payload.new;
            set((state) => {
              const list = state.channels[c.server_id];
              if (!list) return {};
              const patch = (ch: Channel): Channel => ch.id === c.id
                ? {
                    ...ch, name: c.name, topic: c.topic, slowModeSeconds: c.slow_mode_seconds ?? 0,
                    categoryId: c.category_id ?? undefined, position: c.position,
                  }
                : ch;
              const existing = state.channelIndex[c.id];
              return {
                channels: { ...state.channels, [c.server_id]: list.map(patch).sort((a, b) => a.position - b.position) },
                channelIndex: existing
                  ? { ...state.channelIndex, [c.id]: patch(existing) }
                  : state.channelIndex,
              };
            });
          }
        ).subscribe()
      );

      trackDataChannel(
        supabase.channel("public:channels:delete").on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "channels" },
          (payload) => {
            const channelId = payload.old.id;
            set((state) => removeChannelFromState(state, channelId));
          }
        ).subscribe()
      );

      trackDataChannel(
        supabase.channel("public:categories").on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "categories" },
          (payload) => {
            const c = payload.new;
            const newCategory: Category = {
              id: c.id, serverId: c.server_id, name: c.name,
              position: c.position, createdAt: c.created_at,
            };
            set((state) => {
              const existing = state.categories[c.server_id] || [];
              if (existing.some((cat) => cat.id === c.id)) return {};
              return {
                categories: { ...state.categories, [c.server_id]: [...existing, newCategory].sort((a, b) => a.position - b.position) },
              };
            });
          }
        ).on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "categories" },
          (payload) => {
            const c = payload.new;
            set((state) => {
              const list = state.categories[c.server_id];
              if (!list) return {};
              const next = list
                .map((cat) => cat.id === c.id ? { ...cat, name: c.name, position: c.position } : cat)
                .sort((a, b) => a.position - b.position);
              return { categories: { ...state.categories, [c.server_id]: next } };
            });
          }
        ).on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "categories" },
          (payload) => {
            const categoryId = payload.old.id;
            set((state) => {
              const updatedCategories: Record<string, Category[]> = {};
              for (const sid of Object.keys(state.categories)) {
                updatedCategories[sid] = state.categories[sid].filter((c) => c.id !== categoryId);
              }
              const updatedChannels: Record<string, Channel[]> = {};
              for (const sid of Object.keys(state.channels)) {
                updatedChannels[sid] = state.channels[sid].map((c) =>
                  c.categoryId === categoryId ? { ...c, categoryId: undefined } : c
                );
              }
              return { categories: updatedCategories, channels: updatedChannels };
            });
          }
        ).subscribe()
      );

    } catch (e) {
      console.error(e);
    }
  },

  setActiveServer: (serverId) => {
    const state = get();
    const serverChannels = serverId ? state.channels[serverId] ?? [] : [];
    const lastChannel = serverId ? state.lastChannelPerServer[serverId] : null;
    const restored = lastChannel ? serverChannels.find((c) => c.id === lastChannel) : null;
    const fallback = serverChannels.find((c) => c.type === "text") ?? serverChannels[0] ?? null;
    const target = restored ?? fallback;
    set((s) => ({
      activeServerId: serverId,
      activeChannelId: target?.id ?? null,
      unreadCounts: target ? { ...s.unreadCounts, [target.id]: 0 } : s.unreadCounts,
      serverAccessOrder: serverId
        ? [serverId, ...s.serverAccessOrder.filter((id) => id !== serverId)]
        : s.serverAccessOrder,
    }));
    if (target) void get().loadMessages(target.id);
  },

  setActiveChannel: (channelId) => {
    const { activeServerId } = get();
    set((state) => ({
      activeChannelId: channelId,
      lastChannelPerServer: activeServerId && channelId
        ? { ...state.lastChannelPerServer, [activeServerId]: channelId }
        : state.lastChannelPerServer,
      unreadCounts: channelId ? { ...state.unreadCounts, [channelId]: 0 } : state.unreadCounts,
    }));
    if (channelId) void get().loadMessages(channelId);
  },

  createServer: async (data) => {
    const { data: result, error } = await supabase.rpc("create_server", {
      p_name: data.name,
      p_description: data.description ?? null,
    });
    if (error) { console.error("Create server failed", error); throw error; }
    if (!result?.ok) { const e = new Error(result?.reason ?? "create_server failed"); console.error(e); throw e; }
    // State update handled by the realtime INSERT subscription to avoid duplicates.
  },

  createChannel: async (data) => {
    const currentChannels = get().channels[data.serverId] || [];
    // Position is scoped per category (mixing text + voice in one ordered list,
    // same as a Discord category), not per channel type.
    const pos = currentChannels
      .filter((c) => (c.categoryId ?? null) === (data.categoryId ?? null))
      .reduce((max, c) => Math.max(max, c.position), -1) + 1;
    const { error } = await supabase.from("channels").insert({
      server_id: data.serverId, category_id: data.categoryId || null,
      name: data.name, type: data.type, position: pos,
    });
    if (error) { console.error("Failed to create channel", error); throw error; }
  },

  deleteChannel: async (channelId) => {
    const { error } = await supabase.rpc("delete_channel_cascade", { p_channel_id: channelId });
    if (error) { console.error("Delete channel failed", error); return; }
    set((state) => removeChannelFromState(state, channelId));
  },

  renameChannel: async (channelId, name) => {
    const trimmed = name.trim().toLowerCase().replace(/\s+/g, "-");
    if (!trimmed) return;
    const { error } = await supabase.rpc("rename_channel", { p_channel_id: channelId, p_name: trimmed });
    if (error) { console.error("Rename channel failed", error); return; }
    set((state) => {
      const updated = { ...state.channels };
      for (const sid of Object.keys(updated)) {
        updated[sid] = updated[sid].map((c) => c.id === channelId ? { ...c, name: trimmed } : c);
      }
      return { channels: updated };
    });
  },

  renameServer: async (serverId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const { error } = await supabase.rpc("rename_server", { p_server_id: serverId, p_name: trimmed });
    if (error) { console.error("Rename server failed", error); return; }
    set((state) => ({
      servers: state.servers.map((s) => s.id === serverId ? { ...s, name: trimmed } : s),
    }));
  },

  removeServer: (serverId) =>
    set((state) => ({
      servers: state.servers.filter((s) => s.id !== serverId),
      openTabs: state.openTabs.filter((id) => id !== serverId),
      activeServerId: state.activeServerId === serverId ? null : state.activeServerId,
    })),

  createCategory: async (serverId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const { error } = await supabase.rpc("create_category", { p_server_id: serverId, p_name: trimmed });
    if (error) { console.error("Create category failed", error); throw error; }
    // State update handled by the realtime INSERT subscription to avoid duplicates.
  },

  renameCategory: async (categoryId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const { error } = await supabase.rpc("rename_category", { p_category_id: categoryId, p_name: trimmed });
    if (error) { console.error("Rename category failed", error); return; }
    set((state) => {
      const updated: Record<string, Category[]> = {};
      for (const sid of Object.keys(state.categories)) {
        updated[sid] = state.categories[sid].map((c) => c.id === categoryId ? { ...c, name: trimmed } : c);
      }
      return { categories: updated };
    });
  },

  deleteCategory: async (categoryId) => {
    const { error } = await supabase.rpc("delete_category", { p_category_id: categoryId });
    if (error) { console.error("Delete category failed", error); return; }
    set((state) => {
      const updatedCategories: Record<string, Category[]> = {};
      for (const sid of Object.keys(state.categories)) {
        updatedCategories[sid] = state.categories[sid].filter((c) => c.id !== categoryId);
      }
      const updatedChannels: Record<string, Channel[]> = {};
      for (const sid of Object.keys(state.channels)) {
        updatedChannels[sid] = state.channels[sid].map((c) =>
          c.categoryId === categoryId ? { ...c, categoryId: undefined } : c
        );
      }
      return { categories: updatedCategories, channels: updatedChannels };
    });
  },

  reorderCategories: async (serverId, items) => {
    set((state) => {
      const list = state.categories[serverId];
      if (!list) return {};
      const byId = new Map(items.map((it) => [it.id, it.position]));
      const next = list
        .map((c) => (byId.has(c.id) ? { ...c, position: byId.get(c.id)! } : c))
        .sort((a, b) => a.position - b.position);
      return { categories: { ...state.categories, [serverId]: next } };
    });
    const { error } = await supabase.rpc("reorder_categories", { p_server_id: serverId, p_items: items });
    if (error) console.error("Reorder categories failed", error);
  },

  reorderChannels: async (serverId, items) => {
    set((state) => {
      const list = state.channels[serverId];
      if (!list) return {};
      const byId = new Map(items.map((it) => [it.id, it]));
      const next = list
        .map((c) => {
          const patch = byId.get(c.id);
          return patch ? { ...c, categoryId: patch.categoryId ?? undefined, position: patch.position } : c;
        })
        .sort((a, b) => a.position - b.position);
      const newChannelIndex = { ...state.channelIndex };
      for (const c of next) if (byId.has(c.id)) newChannelIndex[c.id] = c;
      return { channels: { ...state.channels, [serverId]: next }, channelIndex: newChannelIndex };
    });
    const { error } = await supabase.rpc("reorder_channels", {
      p_server_id: serverId,
      p_items: items.map((it) => ({ id: it.id, category_id: it.categoryId, position: it.position })),
    });
    if (error) console.error("Reorder channels failed", error);
  },

  inviteUser: async (serverId, username) => {
    // Membership writes go through invite_member (SECURITY DEFINER) — it checks
    // INVITE_MEMBER permission and bans server-side; the client can't be trusted.
    const { data, error } = await supabase.rpc("invite_member", {
      p_server_id: serverId, p_username: username.toLowerCase().trim(),
    });
    if (error) return "Failed to add user";
    if (!data?.ok) {
      switch (data?.reason) {
        case "user_not_found": return "User not found";
        case "already_member": return "Already a member";
        case "banned": return "User is banned from this server";
        case "forbidden": return "You don't have permission to invite members";
        default: return "Failed to add user";
      }
    }

    const { data: row, error: rowError } = await supabase
      .from("server_members").select("*, user:profiles(*)").eq("id", data.member_id).single();
    if (rowError || !row) return "Failed to add user";
    const newMember: ServerMember = {
      id: row.id, serverId, userId: row.user_id,
      roleId: row.role_id ?? undefined,
      joinedAt: row.joined_at, xp: row.xp ?? 0,
      timeoutUntil: row.timeout_until ?? null, user: mapProfile(row.user),
    };
    set((state) => ({
      members: { ...state.members, [serverId]: [...(state.members[serverId] || []), newMember] },
      userProfileCache: { ...state.userProfileCache, [row.user_id]: mapProfile(row.user) },
      memberUserIndex: {
        ...state.memberUserIndex,
        [row.user_id]: [...(state.memberUserIndex[row.user_id] ?? []), { serverId, memberId: newMember.id }],
      },
    }));
    return null;
  },

  generateInviteCode: async (serverId, opts) => {
    // Code is generated server-side by rotate_invite_code (SECURITY DEFINER) —
    // it checks owner/INVITE_MEMBER; direct UPDATEs on servers are closed by RLS.
    const { data, error } = await supabase.rpc("rotate_invite_code", {
      p_server_id: serverId,
      p_expires_at: opts?.expiresAt ?? null,
      p_max_uses: opts?.maxUses ?? null,
    });
    if (error || !data?.ok) {
      console.error("rotate_invite_code failed", error ?? data?.reason);
      return null;
    }
    const code = data.code as string;
    set((state) => ({
      servers: state.servers.map((s) => s.id === serverId ? {
        ...s,
        inviteCode: code,
        inviteExpiresAt: opts?.expiresAt ?? null,
        inviteMaxUses: opts?.maxUses ?? null,
        inviteUsedCount: 0,
      } : s),
    }));
    return code;
  },

  joinByInviteCode: async (code, _userId) => {
    // join_server_by_invite (SECURITY DEFINER) validates expiry/max-uses/ban and
    // inserts atomically server-side — the client can no longer write directly to
    // server_members, and the old read-then-write max-uses check was racy anyway.
    const { data: joinResult, error: joinError } = await supabase
      .rpc("join_server_by_invite", { p_code: code.trim() });
    if (joinError) return "Failed to join server";
    if (!joinResult?.ok) {
      switch (joinResult?.reason) {
        case "invalid_code": return "Invalid or expired invite code";
        case "expired": return "Invite link has expired";
        case "max_uses_reached": return "Invite link has reached its usage limit";
        case "banned": return "You are banned from this server";
        default: return "Failed to join server";
      }
    }
    if (get().servers.some((s) => s.id === joinResult.server_id)) return null;

    const { data: server, error } = await supabase
      .from("servers").select("*").eq("id", joinResult.server_id).single();
    if (error || !server) return "Failed to join server";

    // Fetch only the new server's data instead of full re-init (avoids closing
    // all realtime subscriptions and re-fetching every server the user is in).
    const [channelRes, categoryRes, memberRes, rolesRes] = await Promise.all([
      supabase.from("channels").select("*").eq("server_id", server.id),
      supabase.from("categories").select("*").eq("server_id", server.id),
      supabase.from("server_members").select("*, user:profiles(*)").eq("server_id", server.id),
      supabase.from("roles").select("*").eq("server_id", server.id),
    ]);

    const newServer: Server = {
      id: server.id, ownerId: server.owner_id, name: server.name, iconUrl: server.icon_url,
      description: server.description, inviteCode: server.invite_code, createdAt: server.created_at,
      inviteExpiresAt: server.invite_expires_at ?? null,
      inviteMaxUses: server.invite_max_uses ?? null,
      inviteUsedCount: server.invite_used_count ?? 0,
    };

    const newChannels: Channel[] = (channelRes.data || []).map((c) => ({
      id: c.id, serverId: c.server_id, categoryId: c.category_id, name: c.name,
      type: c.type, topic: c.topic, position: c.position,
      isPrivate: c.is_private, slowModeSeconds: c.slow_mode_seconds ?? 0, createdAt: c.created_at,
    }));

    const newChannelIndex: Record<string, Channel> = {};
    for (const ch of newChannels) newChannelIndex[ch.id] = ch;

    const newCategories: Category[] = (categoryRes.data || []).map((c) => ({
      id: c.id, serverId: c.server_id, name: c.name,
      position: c.position, createdAt: c.created_at,
    }));

    const newProfileCache: Record<string, User> = {};
    const addedMemberIndex: Record<string, { serverId: string; memberId: string }[]> = {};
    const newMembers: ServerMember[] = (memberRes.data || []).map((m) => {
      const user = m.user ? mapProfile(m.user) : undefined;
      if (user) newProfileCache[m.user_id] = user;
      if (!addedMemberIndex[m.user_id]) addedMemberIndex[m.user_id] = [];
      addedMemberIndex[m.user_id].push({ serverId: server.id, memberId: m.id });
      return { id: m.id, serverId: m.server_id, userId: m.user_id, roleId: m.role_id, nickname: m.nickname, joinedAt: m.joined_at, xp: m.xp ?? 0, timeoutUntil: m.timeout_until ?? null, user };
    });

    const newRoles: Role[] = (rolesRes.data || []).map((r) => ({
      id: r.id, serverId: r.server_id, name: r.name, color: r.color,
      permissions: r.permissions, position: r.position, isDefault: r.is_default, createdAt: r.created_at,
    }));

    set((state) => {
      const mergedMemberIndex = { ...state.memberUserIndex };
      for (const [uid, entries] of Object.entries(addedMemberIndex)) {
        mergedMemberIndex[uid] = [...(mergedMemberIndex[uid] ?? []), ...entries];
      }
      const firstTextChannel = newChannels.find((c) => c.type === "text") ?? newChannels[0] ?? null;
      return {
        servers: [...state.servers, newServer],
        openTabs: [...state.openTabs, newServer.id],
        channels: { ...state.channels, [server.id]: newChannels },
        channelIndex: { ...state.channelIndex, ...newChannelIndex },
        categories: { ...state.categories, [server.id]: newCategories },
        members: { ...state.members, [server.id]: newMembers },
        roles: { ...state.roles, [server.id]: newRoles },
        userProfileCache: { ...state.userProfileCache, ...newProfileCache },
        memberUserIndex: mergedMemberIndex,
        activeServerId: newServer.id,
        activeChannelId: firstTextChannel?.id ?? null,
      };
    });

    const firstTextChannel = newChannels.find((c) => c.type === "text") ?? newChannels[0] ?? null;
    if (firstTextChannel) void get().loadMessages(firstTextChannel.id);

    // Track presence for members of the newly-joined server.
    void import("../friends-store").then(({ useFriendsStore }) =>
      useFriendsStore.getState().trackPresenceFor(newMembers.map((m) => m.userId)),
    );
    return null;
  },

  openTab: (serverId) =>
    set((state) => {
      if (state.openTabs.includes(serverId)) return state;
      return { openTabs: [...state.openTabs, serverId] };
    }),

  closeTab: (serverId) => {
    const state = get();
    const newTabs = state.openTabs.filter((id) => id !== serverId);
    let newActiveServerId = state.activeServerId;
    let newActiveChannelId = state.activeChannelId;
    if (state.activeServerId === serverId) {
      const next = newTabs[0] ?? null;
      newActiveServerId = next;
      const nextChannels = next ? state.channels[next] ?? [] : [];
      const firstText = nextChannels.find((c) => c.type === "text") ?? nextChannels[0] ?? null;
      newActiveChannelId = firstText?.id ?? null;
      if (firstText) void get().loadMessages(firstText.id);
    }
    set((s) => ({
      openTabs: newTabs, activeServerId: newActiveServerId, activeChannelId: newActiveChannelId,
      unreadCounts: newActiveChannelId ? { ...s.unreadCounts, [newActiveChannelId]: 0 } : s.unreadCounts,
    }));
  },

  createRole: async (data) => {
    const pos = (get().roles[data.serverId] ?? []).length;
    const { data: row, error } = await supabase.from("roles")
      .insert({ server_id: data.serverId, name: data.name, color: data.color ?? null, permissions: data.permissions, position: pos })
      .select().single();
    if (error) { console.error("createRole failed", error); throw error; }
    const role: Role = {
      id: row.id, serverId: row.server_id, name: row.name, color: row.color,
      permissions: row.permissions, position: row.position, isDefault: row.is_default, createdAt: row.created_at,
    };
    set((s) => ({ roles: { ...s.roles, [data.serverId]: [...(s.roles[data.serverId] ?? []), role] } }));
  },

  updateRole: async (roleId, serverId, data) => {
    const { error } = await supabase.from("roles").update({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.color !== undefined && { color: data.color }),
      ...(data.permissions !== undefined && { permissions: data.permissions }),
    }).eq("id", roleId);
    if (error) { console.error("updateRole failed", error); throw error; }
    set((s) => ({
      roles: {
        ...s.roles,
        [serverId]: (s.roles[serverId] ?? []).map((r) =>
          r.id === roleId ? { ...r, ...data } : r
        ),
      },
    }));
  },

  deleteRole: async (roleId, serverId) => {
    const { error } = await supabase.from("roles").delete().eq("id", roleId);
    if (error) { console.error("deleteRole failed", error); throw error; }
    set((s) => ({
      roles: { ...s.roles, [serverId]: (s.roles[serverId] ?? []).filter((r) => r.id !== roleId) },
      members: {
        ...s.members,
        [serverId]: (s.members[serverId] ?? []).map((m) => m.roleId === roleId ? { ...m, roleId: undefined } : m),
      },
    }));
  },

  assignRole: async (memberId, serverId, roleId) => {
    const { data, error } = await supabase.rpc("assign_member_role", {
      p_member_id: memberId, p_server_id: serverId, p_role_id: roleId,
    });
    if (error || !data?.ok) {
      console.error("assignRole failed", error ?? data?.reason);
      throw error ?? new Error(data?.reason ?? "assign_role_failed");
    }
    set((s) => ({
      members: {
        ...s.members,
        [serverId]: (s.members[serverId] ?? []).map((m) =>
          m.id === memberId ? { ...m, roleId: roleId ?? undefined } : m
        ),
      },
    }));
  },

  updateServerIcon: async (serverId, iconUrl) => {
    const { error } = await supabase.rpc("update_server_icon", {
      p_server_id: serverId,
      p_icon_url: iconUrl,
    });
    if (error) { console.error("updateServerIcon failed", error); throw error; }
    set((s) => ({
      servers: s.servers.map((srv) => srv.id === serverId ? { ...srv, iconUrl: iconUrl ?? undefined } : srv),
    }));
  },

  kickMember: async (memberId, serverId) => {
    const { data, error } = await supabase.rpc("kick_server_member", {
      p_member_id: memberId, p_server_id: serverId,
    });
    if (error || !data?.ok) {
      console.error("kickMember failed", error ?? data?.reason);
      throw error ?? new Error(data?.reason ?? "kick_failed");
    }
    set((s) => ({
      members: { ...s.members, [serverId]: (s.members[serverId] ?? []).filter((m) => m.id !== memberId) },
    }));
  },

  banMember: async (serverId, userId, reason) => {
    const { data, error } = await supabase.rpc("ban_member", {
      p_server_id: serverId, p_user_id: userId, p_reason: reason ?? "",
    });
    if (error || !data?.ok) {
      console.error("banMember failed", error ?? data?.reason);
      return (data?.reason as string) ?? "ban_failed";
    }
    // Drop the member locally (the acting client doesn't get a DELETE event for itself).
    set((s) => ({
      members: { ...s.members, [serverId]: (s.members[serverId] ?? []).filter((m) => m.userId !== userId) },
    }));
    void get().loadBans(serverId);
    return null;
  },

  unbanMember: async (serverId, userId) => {
    const { data, error } = await supabase.rpc("unban_member", { p_server_id: serverId, p_user_id: userId });
    if (error || !data?.ok) { console.error("unbanMember failed", error ?? data?.reason); return; }
    set((s) => ({
      bans: { ...s.bans, [serverId]: (s.bans[serverId] ?? []).filter((b) => b.userId !== userId) },
    }));
  },

  timeoutMember: async (serverId, userId, minutes) => {
    const { data, error } = await supabase.rpc("timeout_member", {
      p_server_id: serverId, p_user_id: userId, p_minutes: minutes,
    });
    if (error || !data?.ok) {
      console.error("timeoutMember failed", error ?? data?.reason);
      return (data?.reason as string) ?? "timeout_failed";
    }
    const until = (data.timeout_until as string | null) ?? null;
    set((s) => ({
      members: {
        ...s.members,
        [serverId]: (s.members[serverId] ?? []).map((m) =>
          m.userId === userId ? { ...m, timeoutUntil: until } : m
        ),
      },
    }));
    return null;
  },

  setChannelSlowmode: async (channelId, seconds) => {
    const { data, error } = await supabase.rpc("set_channel_slowmode", {
      p_channel_id: channelId, p_seconds: seconds,
    });
    if (error || !data?.ok) { console.error("setChannelSlowmode failed", error ?? data?.reason); return; }
    const applied = (data.seconds as number) ?? seconds;
    set((state) => {
      const existing = state.channelIndex[channelId];
      const serverId = existing?.serverId;
      const patch = (ch: Channel): Channel => ch.id === channelId ? { ...ch, slowModeSeconds: applied } : ch;
      return {
        channelIndex: existing ? { ...state.channelIndex, [channelId]: patch(existing) } : state.channelIndex,
        channels: serverId
          ? { ...state.channels, [serverId]: (state.channels[serverId] ?? []).map(patch) }
          : state.channels,
      };
    });
  },

  loadBans: async (serverId) => {
    const { data, error } = await supabase
      .from("server_bans")
      .select("*, user:profiles!server_bans_user_id_fkey(*)")
      .eq("server_id", serverId)
      .order("created_at", { ascending: false });
    if (error) { console.error("loadBans failed", error); return; }
    const bans: ServerBan[] = (data ?? []).map((b: any) => ({
      serverId: b.server_id, userId: b.user_id, reason: b.reason,
      bannedBy: b.banned_by, createdAt: b.created_at,
      user: b.user ? mapProfile(b.user) : undefined,
    }));
    set((s) => ({ bans: { ...s.bans, [serverId]: bans } }));
  },

  loadAuditLog: async (serverId) => {
    const { data, error } = await supabase
      .from("audit_log")
      .select("*, actor:profiles!audit_log_actor_id_fkey(*)")
      .eq("server_id", serverId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) { console.error("loadAuditLog failed", error); return; }
    const entries: AuditEntry[] = (data ?? []).map((e: any) => ({
      id: e.id, serverId: e.server_id, actorId: e.actor_id, action: e.action,
      targetId: e.target_id, meta: e.meta ?? {}, createdAt: e.created_at,
      actor: e.actor ? mapProfile(e.actor) : undefined,
    }));
    set((s) => ({ auditLog: { ...s.auditLog, [serverId]: entries } }));
  },

  searchUsers: (serverId, query) => {
    if (!query || query.length < 1) return [];
    const q = query.toLowerCase();
    return (get().members[serverId] ?? [])
      .filter((m) => m.user && (
        m.user.username.toLowerCase().includes(q) ||
        (m.user.displayName?.toLowerCase().includes(q))
      ))
      .map((m) => m.user!)
      .slice(0, 20);
  },

  searchChannels: (serverId, query) => {
    if (!query || query.length < 1) return [];
    const q = query.toLowerCase();
    return (get().channels[serverId] ?? [])
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 20);
  },

  patchUser: (user) => {
    set((state) => {
      const targets = state.memberUserIndex[user.id] ?? [];
      const affectedServerIds = targets.length > 0
        ? new Set(targets.map((t) => t.serverId))
        : new Set(
            Object.entries(state.members)
              .filter(([, mbs]) => mbs.some((m) => m.userId === user.id))
              .map(([srvId]) => srvId)
          );
      const updatedMembers = { ...state.members };
      for (const srvId of affectedServerIds) {
        updatedMembers[srvId] = (updatedMembers[srvId] ?? []).map(
          (m) => m.userId === user.id ? { ...m, user } : m
        );
      }
      // Messages are NOT iterated here. Message author is resolved at render-time
      // from userProfileCache (see ChatArea resolvedAuthor), so updating the cache
      // below is sufficient — no O(n×channels) message scan needed.
      return {
        userProfileCache: { ...state.userProfileCache, [user.id]: user },
        members: updatedMembers,
        voiceParticipants: Object.fromEntries(
          Object.entries(state.voiceParticipants).map(([chId, parts]) => [
            chId, parts.map((p) => p.user?.id === user.id ? { ...p, user } : p),
          ])
        ),
      };
    });
  },
});
