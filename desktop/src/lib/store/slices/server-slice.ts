import type { StateCreator } from "zustand";
import { supabase } from "../../supabaseClient";
import { mapProfile } from "../../utils";
import type { Server, Category, Channel, ServerMember, User, VoiceParticipant, Role } from "../types";
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

  initData: (userId: string) => Promise<void>;
  setActiveServer: (serverId: string | null) => void;
  setActiveChannel: (channelId: string | null) => void;
  createServer: (data: { name: string; description?: string; ownerId: string }) => Promise<void>;
  createChannel: (data: { serverId: string; name: string; type: "text" | "voice"; categoryId?: string }) => Promise<void>;
  deleteChannel: (channelId: string) => Promise<void>;
  renameChannel: (channelId: string, name: string) => Promise<void>;
  renameServer: (serverId: string, name: string) => Promise<void>;
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
          isPrivate: c.is_private, createdAt: c.created_at,
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
          roleId: m.role_id, nickname: m.nickname, joinedAt: m.joined_at, user,
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

      set({ _currentUserId: _userId });
      get().initMessageRealtime(_userId);
      get().initPollRealtime(_userId);
      // Clean up channels from any previous initData call to prevent duplicate
      // event handlers from leaking across re-inits.
      await clearDataChannels();
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
          return { voiceParticipants: merged };
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
        .subscribe();

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
        supabase.channel("public:channels").on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "channels" },
          (payload) => {
            const c = payload.new;
            const newChannel: Channel = {
              id: c.id, serverId: c.server_id, categoryId: c.category_id, name: c.name,
              type: c.type, topic: c.topic, position: c.position,
              isPrivate: c.is_private, createdAt: c.created_at,
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
        supabase.channel("public:channels:delete").on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "channels" },
          (payload) => {
            const channelId = payload.old.id;
            set((state) => removeChannelFromState(state, channelId));
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
    const { data: serverResult, error } = await supabase
      .from("servers").insert({ name: data.name, description: data.description, owner_id: data.ownerId })
      .select().single();
    if (error) { console.error("Create server failed", error); throw error; }
    await supabase
      .from("channels").insert({ server_id: serverResult.id, name: "general", type: "text", position: 0 });
    // State update handled by the realtime INSERT subscription to avoid duplicates.
  },

  createChannel: async (data) => {
    const currentChannels = get().channels[data.serverId] || [];
    const pos = currentChannels.filter((c) => c.type === data.type).reduce((max, c) => Math.max(max, c.position), -1) + 1;
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

  inviteUser: async (serverId, username) => {
    const { data: profile, error: profileError } = await supabase
      .from("profiles").select("*").eq("username", username.toLowerCase().trim()).maybeSingle();
    if (profileError) return "Failed to find user";
    if (!profile) return "User not found";
    const members = get().members[serverId] || [];
    if (members.some((m) => m.userId === profile.id)) return "Already a member";
    const { error } = await supabase.from("server_members").insert({ server_id: serverId, user_id: profile.id });
    if (error) return "Failed to add user";
    const newMember: ServerMember = {
      id: crypto.randomUUID(), serverId, userId: profile.id,
      joinedAt: new Date().toISOString(), user: mapProfile(profile),
    };
    set((state) => ({
      members: { ...state.members, [serverId]: [...(state.members[serverId] || []), newMember] },
      userProfileCache: { ...state.userProfileCache, [profile.id]: mapProfile(profile) },
      memberUserIndex: {
        ...state.memberUserIndex,
        [profile.id]: [...(state.memberUserIndex[profile.id] ?? []), { serverId, memberId: newMember.id }],
      },
    }));
    return null;
  },

  generateInviteCode: async (serverId, opts) => {
    const bytes = new Uint8Array(5);
    crypto.getRandomValues(bytes);
    const code = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""); // 10 hex chars, CSPRNG
    const { error } = await supabase.from("servers").update({
      invite_code: code,
      invite_expires_at: opts?.expiresAt ?? null,
      invite_max_uses: opts?.maxUses ?? null,
      invite_used_count: 0,
    }).eq("id", serverId);
    if (error) return null;
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

  joinByInviteCode: async (code, userId) => {
    const { data: server, error } = await supabase
      .from("servers").select("*").eq("invite_code", code.trim()).maybeSingle();
    if (error || !server) return "Invalid or expired invite code";
    if (server.invite_expires_at && new Date(server.invite_expires_at) < new Date()) {
      return "Invite link has expired";
    }
    if (server.invite_max_uses != null && (server.invite_used_count ?? 0) >= server.invite_max_uses) {
      return "Invite link has reached its usage limit";
    }
    const members = get().members[server.id] || [];
    if (members.some((m) => m.userId === userId)) return null;

    const { error: insertError } = await supabase
      .from("server_members").insert({ server_id: server.id, user_id: userId });
    if (insertError) return "Failed to join server";

    await supabase.from("servers")
      .update({ invite_used_count: (server.invite_used_count ?? 0) + 1 })
      .eq("id", server.id);

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
      inviteUsedCount: (server.invite_used_count ?? 0) + 1,
    };

    const newChannels: Channel[] = (channelRes.data || []).map((c) => ({
      id: c.id, serverId: c.server_id, categoryId: c.category_id, name: c.name,
      type: c.type, topic: c.topic, position: c.position,
      isPrivate: c.is_private, createdAt: c.created_at,
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
      return { id: m.id, serverId: m.server_id, userId: m.user_id, roleId: m.role_id, nickname: m.nickname, joinedAt: m.joined_at, user };
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
    const { error } = await supabase.from("server_members").update({ role_id: roleId }).eq("id", memberId);
    if (error) { console.error("assignRole failed", error); throw error; }
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
    const { error } = await supabase.from("server_members").delete().eq("id", memberId);
    if (error) { console.error("kickMember failed", error); throw error; }
    set((s) => ({
      members: { ...s.members, [serverId]: (s.members[serverId] ?? []).filter((m) => m.id !== memberId) },
    }));
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
