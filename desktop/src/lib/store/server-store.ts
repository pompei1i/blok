import { create } from "zustand";
import { supabase } from "../supabaseClient";
import { mapProfile } from "../utils";
import { NativeVoiceEngine, getActiveNativeVoiceEngine, setActiveNativeVoiceEngine } from "../native-voice-engine";
import type {
  Server,
  Category,
  Channel,
  ServerMember,
  Message,
  User,
  VoiceParticipant,
} from "./types";

let voicePresenceCh: ReturnType<typeof supabase.channel> | null = null;
let _currentUserId: string | null = null;

interface ServerState {
  servers: Server[];
  activeServerId: string | null;
  activeChannelId: string | null;
  categories: Record<string, Category[]>;
  channels: Record<string, Channel[]>;
  members: Record<string, ServerMember[]>;
  messages: Record<string, Message[]>;
  messagesLoaded: Set<string>;
  messagesLoading: Set<string>;
  typingUsers: Record<string, string[]>;
  openTabs: string[];
  activeVoiceChannelId: string | null;
  voiceParticipants: Record<string, VoiceParticipant[]>;
  isMuted: boolean;
  isDeafened: boolean;
  isScreenSharing: boolean;
  screenShareUserId: string | null;
  remoteScreenStream: MediaStream | null;

  initData: (userId: string) => Promise<void>;
  loadMessages: (channelId: string) => Promise<void>;
  setActiveServer: (serverId: string | null) => void;
  setActiveChannel: (channelId: string | null) => void;
  createServer: (data: { name: string; description?: string; ownerId: string }) => Promise<void>;
  createChannel: (data: { serverId: string; name: string; type: "text" | "voice"; categoryId?: string }) => Promise<void>;
  removeServer: (serverId: string) => void;
  addMessage: (channelId: string, message: Message) => Promise<void>;
  setTyping: (channelId: string, userId: string, isTyping: boolean) => void;
  openTab: (serverId: string) => void;
  closeTab: (serverId: string) => void;
  joinVoiceChannel: (channelId: string, user: User) => Promise<string | null>;
  leaveVoiceChannel: () => Promise<void>;
  toggleMute: () => void;
  toggleDeafen: () => void;
  toggleScreenShare: () => Promise<void>;
  inviteUser: (serverId: string, username: string) => Promise<string | null>;
  deleteMessage: (messageId: string, channelId: string) => Promise<void>;
  pinMessage: (messageId: string, channelId: string) => Promise<void>;
  patchUser: (user: User) => void;
}

export const useServerStore = create<ServerState>((set, get) => ({
  servers: [],
  activeServerId: null,
  activeChannelId: null,
  categories: {},
  channels: {},
  members: {},
  messages: {},
  messagesLoaded: new Set(),
  messagesLoading: new Set(),
  typingUsers: {},
  openTabs: [],
  activeVoiceChannelId: null,
  voiceParticipants: {},
  isMuted: false,
  isDeafened: false,
  isScreenSharing: false,
  screenShareUserId: null,
  remoteScreenStream: null,

  initData: async (_userId) => {
    try {
      // Fetch all structural data in parallel
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
        id: s.id,
        ownerId: s.owner_id,
        name: s.name,
        iconUrl: s.icon_url,
        description: s.description,
        inviteCode: s.invite_code,
        createdAt: s.created_at,
      }));

      const channelsMap: Record<string, Channel[]> = {};
      (channelRes.data || []).forEach((c) => {
        if (!channelsMap[c.server_id]) channelsMap[c.server_id] = [];
        channelsMap[c.server_id].push({
          id: c.id,
          serverId: c.server_id,
          categoryId: c.category_id,
          name: c.name,
          type: c.type,
          topic: c.topic,
          position: c.position,
          isPrivate: c.is_private,
          createdAt: c.created_at,
        });
      });

      const categoriesMap: Record<string, Category[]> = {};
      (categoryRes.data || []).forEach((c) => {
        if (!categoriesMap[c.server_id]) categoriesMap[c.server_id] = [];
        categoriesMap[c.server_id].push({
          id: c.id,
          serverId: c.server_id,
          name: c.name,
          position: c.position,
          createdAt: c.created_at,
        });
      });

      const membersMap: Record<string, ServerMember[]> = {};
      (memberRes.data || []).forEach((m) => {
        if (!membersMap[m.server_id]) membersMap[m.server_id] = [];
        membersMap[m.server_id].push({
          id: m.id,
          serverId: m.server_id,
          userId: m.user_id,
          roleId: m.role_id,
          nickname: m.nickname,
          joinedAt: m.joined_at,
          user: m.user ? mapProfile(m.user) : undefined,
        });
      });

      const firstServer = servers[0] ?? null;
      const firstServerChannels = firstServer ? (channelsMap[firstServer.id] ?? []) : [];
      const firstTextChannel = firstServerChannels.find((c) => c.type === "text") ?? firstServerChannels[0] ?? null;

      set({
        servers,
        categories: categoriesMap,
        channels: channelsMap,
        members: membersMap,
        activeServerId: firstServer?.id ?? null,
        activeChannelId: firstTextChannel?.id ?? null,
        openTabs: servers.map((s) => s.id),
      });

      // Load messages for the initially active channel
      if (firstTextChannel) void get().loadMessages(firstTextChannel.id);

      // Voice presence: all users subscribe so they can see who's in voice channels
      _currentUserId = _userId;
      if (voicePresenceCh) await supabase.removeChannel(voicePresenceCh);
      voicePresenceCh = supabase.channel("voice-presence", {
        config: { presence: { key: _userId } },
      });

      const syncPresence = () => {
        if (!voicePresenceCh) return;
        const raw = voicePresenceCh.presenceState() as Record<string, Array<{ userId: string; voiceChannelId: string | null; isMuted?: boolean; isDeafened?: boolean }>>;
        const all = Object.values(raw).flat();
        const newMap: Record<string, VoiceParticipant[]> = {};
        const allMembers = Object.values(get().members).flat();
        const missingProfileIds: string[] = [];
        for (const p of all) {
          if (!p.voiceChannelId) continue;
          if (!newMap[p.voiceChannelId]) newMap[p.voiceChannelId] = [];
          const member = allMembers.find((m) => m.userId === p.userId);
          if (!member?.user) missingProfileIds.push(p.userId);
          newMap[p.voiceChannelId].push({
            userId: p.userId,
            channelId: p.voiceChannelId,
            isMuted: p.isMuted ?? false,
            isDeafened: p.isDeafened ?? false,
            isSpeaking: false,
            user: member?.user,
          });
        }
        set((state) => {
          const merged: Record<string, VoiceParticipant[]> = {};
          for (const [chId, participants] of Object.entries(newMap)) {
            merged[chId] = participants.map((p) => {
              const existing = (state.voiceParticipants[chId] ?? []).find((e) => e.userId === p.userId);
              return existing
                ? { ...p, isSpeaking: existing.isSpeaking, user: p.user ?? existing.user }
                : p;
            });
          }
          return { voiceParticipants: merged };
        });
        // Fetch profiles for presence participants not yet in the members cache
        for (const uid of missingProfileIds) {
          supabase.from("profiles").select("*").eq("id", uid).single().then(({ data }) => {
            if (!data) return;
            const loadedUser = mapProfile(data);
            set((s) => ({
              voiceParticipants: Object.fromEntries(
                Object.entries(s.voiceParticipants).map(([chId, parts]) => [
                  chId,
                  parts.map((p) => p.userId === uid && !p.user ? { ...p, user: loadedUser } : p),
                ])
              ),
            }));
          });
        }
      };

      voicePresenceCh
        .on("presence", { event: "sync" }, syncPresence)
        .on("presence", { event: "join" }, syncPresence)
        .on("presence", { event: "leave" }, syncPresence)
        .subscribe();

      // Realtime: new messages
      supabase
        .channel("public:messages")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          async (payload) => {
            const m = payload.new;

            // Use cached member profile; fall back to DB only if missing
            const allMembers = Object.values(get().members).flat();
            const authorMember = allMembers.find((mem) => mem.userId === m.author_id);
            let author = authorMember?.user;
            if (!author) {
              const { data } = await supabase.from("profiles").select("*").eq("id", m.author_id).single();
              if (data) author = mapProfile(data);
            }

            const parsedMessage: Message = {
              id: m.id,
              channelId: m.channel_id,
              authorId: m.author_id,
              replyToId: m.reply_to_id,
              content: m.content,
              isEdited: m.is_edited,
              createdAt: m.created_at,
              updatedAt: m.updated_at,
              author,
              attachments: [],
            };

            const { data: attachData } = await supabase.from("attachments").select("*").eq("message_id", m.id);
            if (attachData && attachData.length > 0) {
              parsedMessage.attachments = attachData.map((a: any) => ({
                id: a.id,
                messageId: a.message_id,
                url: a.url,
                filename: a.filename,
                mediaType: a.media_type,
                sizeBytes: a.size_bytes,
                createdAt: a.created_at,
              }));
            }

            // Only append to channels already loaded — avoids duplicates on lazy load
            if (get().messagesLoaded.has(m.channel_id)) {
              set((state) => ({
                messages: {
                  ...state.messages,
                  [m.channel_id]: [...(state.messages[m.channel_id] || []), parsedMessage],
                },
              }));
            }
          }
        )
        .subscribe();

      supabase
        .channel("public:servers")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "servers" },
          (payload) => {
            const s = payload.new;
            const newServer: Server = {
              id: s.id,
              ownerId: s.owner_id,
              name: s.name,
              iconUrl: s.icon_url,
              description: s.description,
              inviteCode: s.invite_code,
              createdAt: s.created_at,
            };
            set((state) => ({
              servers: [...state.servers, newServer],
              openTabs: [...state.openTabs, newServer.id],
            }));
          }
        )
        .subscribe();

      supabase
        .channel("public:profiles")
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "profiles" },
          (payload) => {
            const updated = mapProfile(payload.new as any);
            set((state) => ({
              messages: Object.fromEntries(
                Object.entries(state.messages).map(([chId, msgs]) => [
                  chId,
                  msgs.map((m) => m.author?.id === updated.id ? { ...m, author: updated } : m),
                ])
              ),
              members: Object.fromEntries(
                Object.entries(state.members).map(([srvId, mems]) => [
                  srvId,
                  mems.map((m) => m.user?.id === updated.id ? { ...m, user: updated } : m),
                ])
              ),
              voiceParticipants: Object.fromEntries(
                Object.entries(state.voiceParticipants).map(([chId, parts]) => [
                  chId,
                  parts.map((p) => p.user?.id === updated.id ? { ...p, user: updated } : p),
                ])
              ),
            }));
          }
        )
        .subscribe();

      supabase
        .channel("public:channels")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "channels" },
          (payload) => {
            const c = payload.new;
            const newChannel: Channel = {
              id: c.id,
              serverId: c.server_id,
              categoryId: c.category_id,
              name: c.name,
              type: c.type,
              topic: c.topic,
              position: c.position,
              isPrivate: c.is_private,
              createdAt: c.created_at,
            };
            set((state) => {
              const serverChannels = state.channels[c.server_id] || [];
              return {
                channels: {
                  ...state.channels,
                  [c.server_id]: [...serverChannels, newChannel].sort((a, b) => a.position - b.position),
                },
              };
            });
          }
        )
        .subscribe();
    } catch (e) {
      console.error(e);
    }
  },

  loadMessages: async (channelId) => {
    const { messagesLoaded, messagesLoading } = get();
    if (messagesLoaded.has(channelId) || messagesLoading.has(channelId)) return;

    set((state) => ({
      messagesLoading: new Set([...state.messagesLoading, channelId]),
    }));

    const { data, error } = await supabase
      .from("messages")
      .select(`
        id, channel_id, author_id, reply_to_id, content, is_edited, pinned, created_at, updated_at,
        author:profiles(id, username, display_name, avatar_url, accent_color, pronouns),
        attachments(id, message_id, url, filename, media_type, size_bytes, created_at)
      `)
      .eq("channel_id", channelId)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      console.error("loadMessages error", error);
      set((state) => {
        const loading = new Set(state.messagesLoading);
        loading.delete(channelId);
        return { messagesLoading: loading };
      });
      return;
    }

    const messages: Message[] = (data || []).reverse().map((m) => ({
      id: m.id,
      channelId: m.channel_id,
      authorId: m.author_id,
      replyToId: m.reply_to_id,
      content: m.content,
      isEdited: m.is_edited,
      isPinned: m.pinned ?? false,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
      author: m.author ? mapProfile(m.author) : undefined,
      attachments: Array.isArray(m.attachments)
        ? m.attachments.map((a: any) => ({
            id: a.id,
            messageId: a.message_id,
            url: a.url,
            filename: a.filename,
            mediaType: a.media_type,
            sizeBytes: a.size_bytes,
            createdAt: a.created_at,
          }))
        : [],
    }));

    set((state) => {
      const loading = new Set(state.messagesLoading);
      loading.delete(channelId);
      return {
        messages: { ...state.messages, [channelId]: messages },
        messagesLoaded: new Set([...state.messagesLoaded, channelId]),
        messagesLoading: loading,
      };
    });
  },

  setActiveServer: (serverId) => {
    const channels = serverId ? get().channels[serverId] ?? [] : [];
    const firstTextChannel = channels.find((c) => c.type === "text") ?? channels[0] ?? null;
    set({ activeServerId: serverId, activeChannelId: firstTextChannel?.id ?? null });
    if (firstTextChannel) void get().loadMessages(firstTextChannel.id);
  },

  setActiveChannel: (channelId) => {
    set({ activeChannelId: channelId });
    if (channelId) void get().loadMessages(channelId);
  },

  createServer: async (data) => {
    const { data: serverResult, error } = await supabase
      .from("servers")
      .insert({ name: data.name, description: data.description, owner_id: data.ownerId })
      .select()
      .single();

    if (error) {
      console.error("Create server failed", error);
      throw error;
    }

    const { data: channelResult } = await supabase
      .from("channels")
      .insert({ server_id: serverResult.id, name: "general", type: "text", position: 0 })
      .select()
      .single();

    if (channelResult) {
      const newChannel: Channel = {
        id: channelResult.id,
        serverId: channelResult.server_id,
        categoryId: channelResult.category_id,
        name: channelResult.name,
        type: channelResult.type,
        topic: channelResult.topic,
        position: channelResult.position,
        isPrivate: channelResult.is_private,
        createdAt: channelResult.created_at,
      };
      set((state) => ({
        channels: { ...state.channels, [serverResult.id]: [newChannel] },
      }));
    }
  },

  createChannel: async (data) => {
    const currentChannels = get().channels[data.serverId] || [];
    const sameTypeChannels = currentChannels.filter((c) => c.type === data.type);
    const pos = sameTypeChannels.reduce((max, c) => Math.max(max, c.position), -1) + 1;

    const { error } = await supabase.from("channels").insert({
      server_id: data.serverId,
      category_id: data.categoryId || null,
      name: data.name,
      type: data.type,
      position: pos,
    });

    if (error) {
      console.error("Failed to create channel", error);
      throw error;
    }
  },

  removeServer: (serverId) =>
    set((state) => ({
      servers: state.servers.filter((s) => s.id !== serverId),
      openTabs: state.openTabs.filter((id) => id !== serverId),
      activeServerId: state.activeServerId === serverId ? null : state.activeServerId,
    })),

  addMessage: async (channelId, message) => {
    const { data: insertedMsg, error } = await supabase
      .from("messages")
      .insert({ channel_id: channelId, author_id: message.authorId, content: message.content, reply_to_id: message.replyToId ?? null })
      .select()
      .single();

    if (error) {
      console.error("Message send failed", error);
      return;
    }

    if (message.attachments && message.attachments.length > 0) {
      const attachmentsToInsert = message.attachments.map((att) => ({
        message_id: insertedMsg.id,
        url: att.url,
        filename: att.filename,
        media_type: att.mediaType,
        size_bytes: att.sizeBytes,
      }));
      await supabase.from("attachments").insert(attachmentsToInsert);
    }
  },

  setTyping: (channelId, userId, isTyping) =>
    set((state) => {
      const current = state.typingUsers[channelId] || [];
      const updated = isTyping
        ? [...new Set([...current, userId])]
        : current.filter((id) => id !== userId);
      return { typingUsers: { ...state.typingUsers, [channelId]: updated } };
    }),

  openTab: (serverId) =>
    set((state) => {
      if (state.openTabs.includes(serverId)) return state;
      return { openTabs: [...state.openTabs, serverId] };
    }),

  closeTab: (serverId) =>
    set((state) => ({
      openTabs: state.openTabs.filter((id) => id !== serverId),
      activeServerId:
        state.activeServerId === serverId
          ? state.openTabs[0] !== serverId
            ? state.openTabs[0]
            : state.openTabs[1] || null
          : state.activeServerId,
    })),

  joinVoiceChannel: async (channelId, user) => {
    const prevChannel = get().activeVoiceChannelId;
    if (prevChannel) await get().leaveVoiceChannel();

    set((state) => ({
      activeVoiceChannelId: channelId,
      voiceParticipants: {
        ...state.voiceParticipants,
        [channelId]: [
          ...(state.voiceParticipants[channelId] ?? []).filter((p) => p.userId !== user.id),
          { userId: user.id, channelId, isMuted: state.isMuted, isDeafened: state.isDeafened, isSpeaking: false, user },
        ],
      },
    }));

    const engine = new NativeVoiceEngine(channelId, user.id, {
      onParticipantJoin: (userId) => {
        set((state) => {
          const existing = state.voiceParticipants[channelId] ?? [];
          if (existing.some((p) => p.userId === userId)) return state;
          const serverId = state.activeServerId;
          const member = (serverId ? state.members[serverId] ?? [] : []).find((m) => m.userId === userId);
          const participant = { userId, channelId, isMuted: false, isDeafened: false, isSpeaking: false, user: member?.user };

          if (!member?.user) {
            supabase.from("profiles").select("*").eq("id", userId).single().then(({ data }) => {
              if (!data) return;
              const loadedUser = mapProfile(data);
              set((s) => ({
                voiceParticipants: {
                  ...s.voiceParticipants,
                  [channelId]: (s.voiceParticipants[channelId] ?? []).map((p) =>
                    p.userId === userId ? { ...p, user: loadedUser } : p
                  ),
                },
              }));
            });
          }

          return {
            voiceParticipants: {
              ...state.voiceParticipants,
              [channelId]: [...existing, participant],
            },
          };
        });
      },
      onParticipantLeave: (userId) => {
        set((state) => ({
          voiceParticipants: {
            ...state.voiceParticipants,
            [channelId]: (state.voiceParticipants[channelId] ?? []).filter((p) => p.userId !== userId),
          },
        }));
      },
      onSpeakingChange: (userId, speaking) => {
        set((state) => ({
          voiceParticipants: {
            ...state.voiceParticipants,
            [channelId]: (state.voiceParticipants[channelId] ?? []).map((p) =>
              p.userId === userId ? { ...p, isSpeaking: speaking } : p
            ),
          },
        }));
      },
      onScreenShareStart: (userId, stream) => {
        set({ screenShareUserId: userId, remoteScreenStream: stream });
      },
      onScreenShareStop: () => {
        set({ screenShareUserId: null, remoteScreenStream: null });
      },
    });

    try {
      await engine.join();
      setActiveNativeVoiceEngine(engine);
      const { isMuted, isDeafened } = get();
      if (isMuted) engine.setMuted(true);
      if (isDeafened) engine.setDeafened(true);
      voicePresenceCh?.track({ userId: user.id, voiceChannelId: channelId, isMuted, isDeafened });
      return null;
    } catch (err) {
      setActiveNativeVoiceEngine(null);
      set((state) => ({
        activeVoiceChannelId: null,
        voiceParticipants: { ...state.voiceParticipants, [channelId]: [] },
      }));
      return err instanceof Error ? err.message : "Failed to access microphone";
    }
  },

  leaveVoiceChannel: async () => {
    if (_currentUserId) {
      voicePresenceCh?.track({ userId: _currentUserId, voiceChannelId: null, isMuted: false, isDeafened: false });
    }
    const engine = getActiveNativeVoiceEngine();
    if (engine) {
      setActiveNativeVoiceEngine(null);
      await engine.leave();
    }
    set((state) => {
      const ch = state.activeVoiceChannelId;
      if (!ch) return state;
      return {
        activeVoiceChannelId: null,
        voiceParticipants: { ...state.voiceParticipants, [ch]: [] },
        isScreenSharing: false,
        screenShareUserId: null,
        remoteScreenStream: null,
      };
    });
  },

  toggleScreenShare: async () => {
    const engine = getActiveNativeVoiceEngine();
    if (!engine) return;
    const { isScreenSharing } = get();
    if (isScreenSharing) {
      await engine.stopScreenShare();
      set({ isScreenSharing: false });
    } else {
      try {
        await engine.startScreenShare();
        set({ isScreenSharing: true });
      } catch {
        // User cancelled getDisplayMedia or permission denied
      }
    }
  },

  inviteUser: async (serverId, username) => {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("username", username.toLowerCase().trim())
      .maybeSingle();

    if (profileError) return "Failed to find user";
    if (!profile) return "User not found";

    const members = get().members[serverId] || [];
    if (members.some((m) => m.userId === profile.id)) return "Already a member";

    const { error } = await supabase
      .from("server_members")
      .insert({ server_id: serverId, user_id: profile.id });

    if (error) return "Failed to add user";

    const newMember: ServerMember = {
      id: crypto.randomUUID(),
      serverId,
      userId: profile.id,
      joinedAt: new Date().toISOString(),
      user: mapProfile(profile),
    };
    set((state) => ({
      members: {
        ...state.members,
        [serverId]: [...(state.members[serverId] || []), newMember],
      },
    }));

    return null;
  },

  toggleMute: () => {
    const newMuted = !get().isMuted;
    set({ isMuted: newMuted });
    getActiveNativeVoiceEngine()?.setMuted(newMuted);
    const { activeVoiceChannelId, isDeafened } = get();
    if (activeVoiceChannelId && _currentUserId) {
      voicePresenceCh?.track({ userId: _currentUserId, voiceChannelId: activeVoiceChannelId, isMuted: newMuted, isDeafened });
    }
  },

  toggleDeafen: () => {
    const newDeafened = !get().isDeafened;
    set({ isDeafened: newDeafened });
    getActiveNativeVoiceEngine()?.setDeafened(newDeafened);
    const { activeVoiceChannelId, isMuted } = get();
    if (activeVoiceChannelId && _currentUserId) {
      voicePresenceCh?.track({ userId: _currentUserId, voiceChannelId: activeVoiceChannelId, isMuted, isDeafened: newDeafened });
    }
  },

  deleteMessage: async (messageId, channelId) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [channelId]: (state.messages[channelId] || []).filter((m) => m.id !== messageId),
      },
    }));
    const { error } = await supabase.from("messages").delete().eq("id", messageId);
    if (error) {
      console.error("Failed to delete message", error);
    }
  },

  pinMessage: async (messageId, channelId) => {
    const current = get().messages[channelId]?.find((m) => m.id === messageId);
    const newPinned = !current?.isPinned;
    set((state) => ({
      messages: {
        ...state.messages,
        [channelId]: (state.messages[channelId] || []).map((m) =>
          m.id === messageId ? { ...m, isPinned: newPinned } : m
        ),
      },
    }));
    const { error } = await supabase
      .from("messages")
      .update({ pinned: newPinned })
      .eq("id", messageId);
    if (error) {
      console.error("Failed to pin message", error);
      // revert
      set((state) => ({
        messages: {
          ...state.messages,
          [channelId]: (state.messages[channelId] || []).map((m) =>
            m.id === messageId ? { ...m, isPinned: !newPinned } : m
          ),
        },
      }));
    }
  },

  patchUser: (user) => {
    set((state) => ({
      messages: Object.fromEntries(
        Object.entries(state.messages).map(([chId, msgs]) => [
          chId,
          msgs.map((m) => m.author?.id === user.id ? { ...m, author: user } : m),
        ])
      ),
      members: Object.fromEntries(
        Object.entries(state.members).map(([srvId, mems]) => [
          srvId,
          mems.map((m) => m.user?.id === user.id ? { ...m, user } : m),
        ])
      ),
      voiceParticipants: Object.fromEntries(
        Object.entries(state.voiceParticipants).map(([chId, parts]) => [
          chId,
          parts.map((p) => p.user?.id === user.id ? { ...p, user } : p),
        ])
      ),
    }));
  },
}));
