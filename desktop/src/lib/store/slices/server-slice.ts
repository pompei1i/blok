import type { StateCreator } from "zustand";
import { supabase } from "../../supabaseClient";
import { mapProfile } from "../../utils";
import type { Server, Category, Channel, ServerMember, User, VoiceParticipant } from "../types";
import type { ServerStore } from "../server-store.shape";
import {
  voicePresenceCh, setVoicePresenceCh,
  _currentUserId, setCurrentUserId,
} from "./_shared";

export interface ServerSlice {
  servers: Server[];
  activeServerId: string | null;
  activeChannelId: string | null;
  categories: Record<string, Category[]>;
  channels: Record<string, Channel[]>;
  channelIndex: Record<string, Channel>;
  members: Record<string, ServerMember[]>;
  userProfileCache: Record<string, User>;
  memberUserIndex: Record<string, { serverId: string; memberId: string }[]>;
  openTabs: string[];
  unreadCounts: Record<string, number>;

  initData: (userId: string) => Promise<void>;
  setActiveServer: (serverId: string | null) => void;
  setActiveChannel: (channelId: string | null) => void;
  createServer: (data: { name: string; description?: string; ownerId: string }) => Promise<void>;
  createChannel: (data: { serverId: string; name: string; type: "text" | "voice"; categoryId?: string }) => Promise<void>;
  deleteChannel: (channelId: string) => Promise<void>;
  removeServer: (serverId: string) => void;
  inviteUser: (serverId: string, username: string) => Promise<string | null>;
  generateInviteCode: (serverId: string, opts?: { expiresAt?: string | null; maxUses?: number | null }) => Promise<string | null>;
  joinByInviteCode: (code: string, userId: string) => Promise<string | null>;
  openTab: (serverId: string) => void;
  closeTab: (serverId: string) => void;
  patchUser: (user: User) => void;
}

export const createServerSlice: StateCreator<ServerStore, [], [], ServerSlice> = (set, get) => ({
  servers: [],
  activeServerId: null,
  activeChannelId: null,
  categories: {},
  channels: {},
  channelIndex: {},
  members: {},
  userProfileCache: {},
  memberUserIndex: {},
  openTabs: [],
  unreadCounts: {},

  initData: async (_userId) => {
    try {
      const [serverRes, channelRes, categoryRes, memberRes] = await Promise.all([
        supabase.from("servers").select("*"),
        supabase.from("channels").select("*"),
        supabase.from("categories").select("*"),
        supabase.from("server_members").select("*, user:profiles(*)"),
      ]);

      if (serverRes.error) console.error("Err loading servers", serverRes.error);
      if (channelRes.error) console.error("Err loading channels", channelRes.error);
      if (categoryRes.error) console.error("Err loading categories", categoryRes.error);
      if (memberRes.error) console.error("Err loading members", memberRes.error);

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

      const firstServer = servers[0] ?? null;
      const firstServerChannels = firstServer ? (channelsMap[firstServer.id] ?? []) : [];
      const firstTextChannel = firstServerChannels.find((c) => c.type === "text") ?? firstServerChannels[0] ?? null;

      set({
        servers, categories: categoriesMap, channels: channelsMap, channelIndex,
        members: membersMap, userProfileCache, memberUserIndex,
        activeServerId: firstServer?.id ?? null,
        activeChannelId: firstTextChannel?.id ?? null,
        openTabs: servers.map((s) => s.id),
      });

      if (firstTextChannel) void get().loadMessages(firstTextChannel.id);

      setCurrentUserId(_userId);
      get().initMessageRealtime(_userId);
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
        for (const uid of missingProfileIds) {
          supabase.from("profiles").select("*").eq("id", uid).single().then(({ data }) => {
            if (!data) return;
            const loadedUser = mapProfile(data);
            set((s) => ({
              userProfileCache: { ...s.userProfileCache, [uid]: loadedUser },
              voiceParticipants: Object.fromEntries(
                Object.entries(s.voiceParticipants).map(([chId, parts]) => [
                  chId, parts.map((p) => p.userId === uid && !p.user ? { ...p, user: loadedUser } : p),
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
      ).subscribe();

      supabase.channel("public:profiles").on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        (payload) => {
          const updated = mapProfile(payload.new as any);
          set((state) => {
            // Targeted members update: only rebuild server arrays containing this user
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
      ).subscribe();

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
          set((state) => ({
            channels: { ...state.channels, [c.server_id]: [...(state.channels[c.server_id] || []), newChannel].sort((a, b) => a.position - b.position) },
            channelIndex: { ...state.channelIndex, [newChannel.id]: newChannel },
          }));
        }
      ).subscribe();

      supabase.channel("public:channels:delete").on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "channels" },
        (payload) => {
          const channelId = payload.old.id;
          set((state) => {
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
          });
        }
      ).subscribe();

    } catch (e) {
      console.error(e);
    }
  },

  setActiveServer: (serverId) => {
    const channels = serverId ? get().channels[serverId] ?? [] : [];
    const firstTextChannel = channels.find((c) => c.type === "text") ?? channels[0] ?? null;
    set((state) => ({
      activeServerId: serverId,
      activeChannelId: firstTextChannel?.id ?? null,
      unreadCounts: firstTextChannel ? { ...state.unreadCounts, [firstTextChannel.id]: 0 } : state.unreadCounts,
    }));
    if (firstTextChannel) void get().loadMessages(firstTextChannel.id);
  },

  setActiveChannel: (channelId) => {
    set((state) => ({
      activeChannelId: channelId,
      unreadCounts: channelId ? { ...state.unreadCounts, [channelId]: 0 } : state.unreadCounts,
    }));
    if (channelId) void get().loadMessages(channelId);
  },

  createServer: async (data) => {
    const { data: serverResult, error } = await supabase
      .from("servers").insert({ name: data.name, description: data.description, owner_id: data.ownerId })
      .select().single();
    if (error) { console.error("Create server failed", error); throw error; }
    const { data: channelResult } = await supabase
      .from("channels").insert({ server_id: serverResult.id, name: "general", type: "text", position: 0 })
      .select().single();
    if (channelResult) {
      const newChannel: Channel = {
        id: channelResult.id, serverId: channelResult.server_id, categoryId: channelResult.category_id,
        name: channelResult.name, type: channelResult.type, topic: channelResult.topic,
        position: channelResult.position, isPrivate: channelResult.is_private, createdAt: channelResult.created_at,
      };
      set((state) => ({
        channels: { ...state.channels, [serverResult.id]: [newChannel] },
        channelIndex: { ...state.channelIndex, [newChannel.id]: newChannel },
      }));
    }
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
    const { error } = await supabase.from("channels").delete().eq("id", channelId);
    if (error) { console.error("Delete channel failed", error); return; }
    set((state) => {
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
    });
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
    await get().initData(userId);
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
      return {
        userProfileCache: { ...state.userProfileCache, [user.id]: user },
        members: updatedMembers,
        voiceParticipants: Object.fromEntries(
          Object.entries(state.voiceParticipants).map(([chId, parts]) => [
            chId, parts.map((p) => p.user?.id === user.id ? { ...p, user } : p),
          ])
        ),
        messages: Object.fromEntries(
          Object.entries(state.messages).map(([chId, msgs]) => [
            chId, msgs.map((m) => m.author?.id === user.id ? { ...m, author: user } : m),
          ])
        ),
      };
    });
  },
});
