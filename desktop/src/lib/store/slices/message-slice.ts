import type { StateCreator } from "zustand";
import { supabase } from "../../supabaseClient";
import { mapProfile } from "../../utils";
import { MESSAGE_PAGE_SIZE, MESSAGE_LRU_LIMIT, NOTIFICATION_PREVIEW_LEN } from "../../constants";
import { playNotificationBeep } from "../../sounds";
import { sendDesktopNotification } from "../../notifications";
import type { Message, Reaction } from "../types";
import type { ServerStore } from "../server-store.shape";
import { trackDataChannel } from "./_shared";

interface MessageAuthorRow {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  accent_color: string | null;
  pronouns: string | null;
}

interface MessageRow {
  id: string;
  channel_id: string;
  author_id: string;
  reply_to_id: string | null;
  content: string;
  is_edited: boolean;
  is_announcement: boolean | null;
  pinned: boolean | null;
  created_at: string;
  updated_at: string;
  // Supabase join inference returns array for FK relations; runtime value is single object or null
  author?: MessageAuthorRow | MessageAuthorRow[] | null;
  attachments?: Array<{ id: string; message_id: string; url: string; filename: string; media_type: string | null; size_bytes: number | null; created_at: string }>;
  message_reactions?: Array<{ id: string; message_id: string; user_id: string; emoji: string; created_at: string }>;
}

export interface MessageSlice {
  messages: Record<string, Message[]>;
  messageChannelIndex: Record<string, string>;
  lruChannelOrder: string[];
  messagesLoaded: Set<string>;
  messagesLoading: Set<string>;
  messagesAtStart: Set<string>;
  typingUsers: Record<string, string[]>;

  initMessageRealtime: (userId: string) => void;
  loadMessages: (channelId: string) => Promise<void>;
  loadMoreMessages: (channelId: string) => Promise<void>;
  addMessage: (channelId: string, message: Message) => Promise<void>;
  setTyping: (channelId: string, userId: string, isTyping: boolean) => void;
  editMessage: (channelId: string, messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string, channelId: string) => Promise<void>;
  pinMessage: (messageId: string, channelId: string) => Promise<void>;
  addReaction: (messageId: string, channelId: string, emoji: string, userId: string) => Promise<void>;
  removeReaction: (messageId: string, channelId: string, emoji: string, userId: string) => Promise<void>;
  searchMessages: (channelId: string, query: string) => Promise<Message[]>;
}

function mapMessageRow(m: MessageRow): Message {
  const authorRaw = Array.isArray(m.author) ? m.author[0] : m.author;
  return {
    id: m.id,
    channelId: m.channel_id,
    authorId: m.author_id,
    replyToId: m.reply_to_id ?? undefined,
    content: m.content,
    isEdited: m.is_edited,
    isPinned: m.pinned ?? false,
    isAnnouncement: m.is_announcement ?? false,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
    author: authorRaw ? mapProfile(authorRaw) : undefined,
    attachments: Array.isArray(m.attachments)
      ? m.attachments.map((a) => ({
          id: a.id, messageId: a.message_id, url: a.url, filename: a.filename,
          mediaType: a.media_type ?? undefined, sizeBytes: a.size_bytes ?? undefined, createdAt: a.created_at,
        }))
      : [],
    reactions: Array.isArray(m.message_reactions)
      ? m.message_reactions.map((r) => ({
          id: r.id, messageId: r.message_id, userId: r.user_id,
          emoji: r.emoji, createdAt: r.created_at,
        }))
      : [],
  };
}

const MESSAGE_SELECT = `
  id, channel_id, author_id, reply_to_id, content, is_edited, is_announcement, pinned, created_at, updated_at,
  author:profiles(id, username, display_name, avatar_url, accent_color, pronouns),
  attachments(id, message_id, url, filename, media_type, size_bytes, created_at),
  message_reactions(id, message_id, user_id, emoji, created_at)
`;

export const createMessageSlice: StateCreator<ServerStore, [], [], MessageSlice> = (set, get) => ({
  messages: {},
  messageChannelIndex: {},
  lruChannelOrder: [],
  messagesLoaded: new Set(),
  messagesLoading: new Set(),
  messagesAtStart: new Set(),
  typingUsers: {},

  initMessageRealtime: (_userId) => {
    trackDataChannel(
    supabase.channel("public:messages").on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      async (payload) => {
        const m = payload.new;
        const cachedAuthor = get().userProfileCache[m.author_id];

        // Fast path: author cached + no attachments expected → build from payload immediately,
        // then do a single background fetch to pick up any attachments/reactions.
        // This avoids 2 sequential round-trips (profiles + attachments) on every message.
        const fastMessage: Message = {
          id: m.id, channelId: m.channel_id, authorId: m.author_id,
          replyToId: m.reply_to_id ?? undefined,
          content: m.content, isEdited: m.is_edited,
          isAnnouncement: m.is_announcement ?? false,
          createdAt: m.created_at, updatedAt: m.updated_at,
          author: cachedAuthor,
          attachments: [],
          reactions: [],
          isPinned: false,
        };

        if (get().messagesLoaded.has(m.channel_id)) {
          const alreadyInState = (get().messages[m.channel_id] ?? []).some((msg) => msg.id === m.id);
          if (!alreadyInState) {
            set((state) => ({
              messages: { ...state.messages, [m.channel_id]: [...(state.messages[m.channel_id] || []), fastMessage] },
              messageChannelIndex: { ...state.messageChannelIndex, [m.id]: m.channel_id },
            }));
            void get().loadPollsForMessages([m.id], get()._currentUserId ?? "");
          }
        }

        // Notification and unread use fastMessage — payload has all required fields
        // (content, author_id, channel_id, is_announcement) and must not wait on the
        // background DB fetch so unread counts are always incremented promptly.
        {
          const { activeChannelId } = get();
          const isAnnouncement = fastMessage.isAnnouncement;
          const isOtherChannel = m.channel_id !== activeChannelId;
          const isOtherUser = m.author_id !== get()._currentUserId;
          if (isOtherUser && (isOtherChannel || isAnnouncement)) {
            if (isOtherChannel) {
              set((state) => ({ unreadCounts: { ...state.unreadCounts, [m.channel_id]: (state.unreadCounts[m.channel_id] ?? 0) + 1 } }));
            }
            playNotificationBeep();
            const channelName = get().channelIndex[m.channel_id]?.name ?? "blok";
            const preview = fastMessage.content?.slice(0, NOTIFICATION_PREVIEW_LEN) || "sent an attachment";
            const title = isAnnouncement ? `[!] #${channelName}` : `#${channelName}`;
            sendDesktopNotification(title, `${cachedAuthor?.username ?? "someone"}: ${preview}`);
          }
        }

        // Single joined fetch: resolves author avatar/username if not cached,
        // and picks up any attachments/reactions. Patches the already-inserted message.
        const { data: fullRow } = await supabase
          .from("messages")
          .select(MESSAGE_SELECT)
          .eq("id", m.id)
          .single();

        if (fullRow) {
          const fullMessage = mapMessageRow(fullRow as unknown as MessageRow);
          if (!cachedAuthor && fullMessage.author) {
            set((state) => ({ userProfileCache: { ...state.userProfileCache, [m.author_id]: fullMessage.author! } }));
          }
          if (get().messagesLoaded.has(m.channel_id)) {
            set((state) => ({
              messages: {
                ...state.messages,
                [m.channel_id]: (state.messages[m.channel_id] ?? []).map((msg) =>
                  msg.id === m.id ? fullMessage : msg
                ),
              },
            }));
          }
        }
      }
    ).subscribe()
    );

    trackDataChannel(
      supabase.channel("public:messages:update").on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload) => {
          const m = payload.new;
          if (!get().messagesLoaded.has(m.channel_id)) return;
          set((state) => ({
            messages: {
              ...state.messages,
              [m.channel_id]: (state.messages[m.channel_id] ?? []).map((msg) =>
                msg.id === m.id ? { ...msg, content: m.content, isEdited: m.is_edited, updatedAt: m.updated_at } : msg
              ),
            },
          }));
        }
      ).subscribe()
    );

    trackDataChannel(
      supabase.channel("public:message_reactions").on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reactions" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const r = payload.new;
            const reaction = { id: r.id, messageId: r.message_id, userId: r.user_id, emoji: r.emoji, createdAt: r.created_at };
            set((state) => {
              const channelId = state.messageChannelIndex[r.message_id];
              if (!channelId) return state;
              return {
                messages: { ...state.messages, [channelId]: state.messages[channelId].map((m) =>
                  m.id === r.message_id && !m.reactions?.some((rx) => rx.id === r.id)
                    ? { ...m, reactions: [...(m.reactions || []), reaction] } : m
                ) },
              };
            });
          } else if (payload.eventType === "DELETE") {
            const r = payload.old;
            set((state) => {
              const channelId = state.messageChannelIndex[r.message_id];
              if (!channelId) return state;
              return {
                messages: { ...state.messages, [channelId]: state.messages[channelId].map((m) =>
                  m.id === r.message_id
                    ? { ...m, reactions: (m.reactions || []).filter((rx) => rx.id !== r.id) } : m
                ) },
              };
            });
          }
        }
      ).subscribe()
    );
  },

  loadMessages: async (channelId) => {
    const { messagesLoaded, messagesLoading } = get();
    if (messagesLoaded.has(channelId) || messagesLoading.has(channelId)) return;

    set((state) => ({ messagesLoading: new Set([...state.messagesLoading, channelId]) }));

    const { data, error } = await supabase
      .from("messages")
      .select(MESSAGE_SELECT)
      .eq("channel_id", channelId)
      .order("created_at", { ascending: false })
      .limit(MESSAGE_PAGE_SIZE);

    if (error) {
      console.error("loadMessages error", error);
      set((state) => {
        const loading = new Set(state.messagesLoading);
        loading.delete(channelId);
        return { messagesLoading: loading };
      });
      return;
    }

    const messages: Message[] = ((data || []) as unknown as MessageRow[]).reverse().map(mapMessageRow);
    const isAtStart = (data || []).length < MESSAGE_PAGE_SIZE;
    const messageIds = messages.map((m) => m.id);

    void get().loadPollsForMessages(messageIds, get()._currentUserId ?? "");

    set((state) => {
      const loading = new Set(state.messagesLoading);
      loading.delete(channelId);
      const newIndex: Record<string, string> = {};
      for (const m of messages) newIndex[m.id] = channelId;
      const order = [channelId, ...state.lruChannelOrder.filter((id) => id !== channelId)];
      let updatedMessages: Record<string, Message[]> = { ...state.messages, [channelId]: messages };
      let updatedIndex = { ...state.messageChannelIndex, ...newIndex };
      const updatedLoaded = new Set([...state.messagesLoaded, channelId]);
      const updatedAtStart = new Set(state.messagesAtStart);
      if (isAtStart) updatedAtStart.add(channelId);
      if (order.length > MESSAGE_LRU_LIMIT) {
        const evictId = order[order.length - 1];
        // Targeted delete: iterate only the evicted channel's messages (O(k))
        // instead of Object.entries(index).filter(...)  which is O(total_cached).
        for (const msg of updatedMessages[evictId] ?? []) {
          delete updatedIndex[msg.id];
        }
        delete updatedMessages[evictId];
        updatedLoaded.delete(evictId);
        updatedAtStart.delete(evictId);
      }
      return {
        messages: updatedMessages,
        messageChannelIndex: updatedIndex,
        lruChannelOrder: order.slice(0, MESSAGE_LRU_LIMIT),
        messagesLoaded: updatedLoaded,
        messagesLoading: loading,
        messagesAtStart: updatedAtStart,
      };
    });
  },

  loadMoreMessages: async (channelId) => {
    const { messages, messagesAtStart, messagesLoading } = get();
    if (messagesAtStart.has(channelId) || messagesLoading.has(channelId)) return;

    const existing = messages[channelId] ?? [];
    if (existing.length === 0) return;
    const oldestCreatedAt = existing[0].createdAt;

    set((state) => ({ messagesLoading: new Set([...state.messagesLoading, channelId]) }));

    const { data, error } = await supabase
      .from("messages")
      .select(MESSAGE_SELECT)
      .eq("channel_id", channelId)
      .lt("created_at", oldestCreatedAt)
      .order("created_at", { ascending: false })
      .limit(MESSAGE_PAGE_SIZE);

    if (error) {
      console.error("loadMoreMessages error", error);
      set((state) => {
        const loading = new Set(state.messagesLoading);
        loading.delete(channelId);
        return { messagesLoading: loading };
      });
      return;
    }

    const older: Message[] = ((data || []) as unknown as MessageRow[]).reverse().map(mapMessageRow);
    void get().loadPollsForMessages(older.map((m) => m.id), get()._currentUserId ?? "");

    set((state) => {
      const loading = new Set(state.messagesLoading);
      loading.delete(channelId);
      const atStart = new Set(state.messagesAtStart);
      if ((data || []).length < MESSAGE_PAGE_SIZE) atStart.add(channelId);
      const newIndex: Record<string, string> = { ...state.messageChannelIndex };
      for (const m of older) newIndex[m.id] = channelId;
      return {
        messages: {
          ...state.messages,
          [channelId]: [...older, ...(state.messages[channelId] ?? [])],
        },
        messageChannelIndex: newIndex,
        messagesLoading: loading,
        messagesAtStart: atStart,
      };
    });
  },

  addMessage: async (channelId, message) => {
    // Optimistic: show immediately with temp ID so the sender doesn't wait on network
    if (get().messagesLoaded.has(channelId)) {
      set((state) => ({
        messages: { ...state.messages, [channelId]: [...(state.messages[channelId] || []), message] },
        messageChannelIndex: { ...state.messageChannelIndex, [message.id]: channelId },
      }));
    }

    const { data: insertedMsg, error } = await supabase
      .from("messages")
      .insert({ channel_id: channelId, author_id: message.authorId, content: message.content, reply_to_id: message.replyToId ?? null, is_announcement: message.isAnnouncement ?? false })
      .select()
      .single();

    if (error) {
      console.error("Message send failed", error);
      // Rollback optimistic message
      set((state) => {
        const { [message.id]: _dropped, ...restIndex } = state.messageChannelIndex;
        return {
          messages: { ...state.messages, [channelId]: (state.messages[channelId] || []).filter((m) => m.id !== message.id) },
          messageChannelIndex: restIndex,
        };
      });
      return;
    }

    // Swap temp ID for real DB ID
    set((state) => {
      const { [message.id]: _dropped, ...restIndex } = state.messageChannelIndex;
      return {
        messages: {
          ...state.messages,
          [channelId]: (state.messages[channelId] || []).map((m) =>
            m.id === message.id ? { ...m, id: insertedMsg.id } : m
          ),
        },
        messageChannelIndex: { ...restIndex, [insertedMsg.id]: channelId },
      };
    });

    if (message.attachments && message.attachments.length > 0) {
      await supabase.from("attachments").insert(
        message.attachments.map((att) => ({
          message_id: insertedMsg.id, url: att.url, filename: att.filename,
          media_type: att.mediaType, size_bytes: att.sizeBytes,
        }))
      );
    }
  },

  setTyping: (channelId, userId, isTyping) =>
    set((state) => {
      const current = state.typingUsers[channelId] || [];
      const updated = isTyping ? [...new Set([...current, userId])] : current.filter((id) => id !== userId);
      return { typingUsers: { ...state.typingUsers, [channelId]: updated } };
    }),

  editMessage: async (channelId, messageId, content) => {
    const { error } = await supabase.from("messages").update({ content, is_edited: true }).eq("id", messageId);
    if (error) { console.error("Edit message failed", error); return; }
    set((state) => ({
      messages: {
        ...state.messages,
        [channelId]: (state.messages[channelId] ?? []).map((m) =>
          m.id === messageId ? { ...m, content, isEdited: true } : m
        ),
      },
    }));
  },

  deleteMessage: async (messageId, channelId) => {
    const snapshotMessages = get().messages[channelId];
    const snapshotIndex = { ...get().messageChannelIndex };
    set((state) => {
      const { [messageId]: _dropped, ...restIndex } = state.messageChannelIndex;
      return {
        messages: { ...state.messages, [channelId]: (state.messages[channelId] || []).filter((m) => m.id !== messageId) },
        messageChannelIndex: restIndex,
      };
    });
    const { error } = await supabase.from("messages").delete().eq("id", messageId);
    if (error) {
      console.error("Failed to delete message", error);
      set((state) => ({
        messages: { ...state.messages, [channelId]: snapshotMessages ?? state.messages[channelId] },
        messageChannelIndex: snapshotIndex,
      }));
    }
  },

  pinMessage: async (messageId, channelId) => {
    const current = get().messages[channelId]?.find((m) => m.id === messageId);
    const newPinned = !current?.isPinned;
    set((state) => ({
      messages: { ...state.messages, [channelId]: (state.messages[channelId] || []).map((m) => m.id === messageId ? { ...m, isPinned: newPinned } : m) },
    }));
    const { error } = await supabase.from("messages").update({ pinned: newPinned }).eq("id", messageId);
    if (error) {
      console.error("Failed to pin message", error);
      set((state) => ({
        messages: { ...state.messages, [channelId]: (state.messages[channelId] || []).map((m) => m.id === messageId ? { ...m, isPinned: !newPinned } : m) },
      }));
    }
  },

  addReaction: async (messageId, channelId, emoji, userId) => {
    const reaction: Reaction = { id: crypto.randomUUID(), messageId, userId, emoji, createdAt: new Date().toISOString() };
    set((state) => ({
      messages: {
        ...state.messages,
        [channelId]: (state.messages[channelId] || []).map((m) =>
          m.id === messageId && !m.reactions?.some((r) => r.userId === userId && r.emoji === emoji)
            ? { ...m, reactions: [...(m.reactions || []), reaction] } : m
        ),
      },
    }));
    await supabase.from("message_reactions").upsert(
      { message_id: messageId, user_id: userId, emoji },
      { onConflict: "message_id,user_id,emoji" }
    );
  },

  removeReaction: async (messageId, channelId, emoji, userId) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [channelId]: (state.messages[channelId] || []).map((m) =>
          m.id === messageId
            ? { ...m, reactions: (m.reactions || []).filter((r) => !(r.userId === userId && r.emoji === emoji)) } : m
        ),
      },
    }));
    await supabase.from("message_reactions").delete()
      .eq("message_id", messageId).eq("user_id", userId).eq("emoji", emoji);
  },

  searchMessages: async (channelId, query) => {
    if (query.length < 2) return [];

    const SEARCH_SELECT = `
      id, channel_id, author_id, reply_to_id, content, is_edited, is_announcement,
      pinned, created_at, updated_at,
      author:profiles(id, username, display_name, avatar_url, accent_color, pronouns)
    `;

    // Primary: full-text search via GIN index on to_tsvector('simple', content).
    // 'simple' config is language-neutral — no stemming, matches all languages.
    // Requires: CREATE INDEX messages_content_fts ON messages
    //           USING GIN (to_tsvector('simple', content));
    const { data: ftsData, error: ftsError } = await supabase
      .from("messages")
      .select(SEARCH_SELECT)
      .eq("channel_id", channelId)
      .textSearch("content", query, { type: "websearch", config: "simple" })
      .order("created_at", { ascending: false })
      .limit(25);

    // Fallback to ILIKE for short tokens (single word, no spaces) that FTS
    // may not match without a prefix index — e.g. typing "hel" mid-word.
    // Only kicks in when FTS returns nothing and the query has no spaces.
    const useFallback =
      !ftsError && (ftsData ?? []).length === 0 && !query.includes(" ");

    const { data, error } = useFallback
      ? await supabase
          .from("messages")
          .select(SEARCH_SELECT)
          .eq("channel_id", channelId)
          .ilike("content", `%${query}%`)
          .order("created_at", { ascending: false })
          .limit(25)
      : { data: ftsData, error: ftsError };

    if (error) { console.error("searchMessages error", error); return []; }
    return (data ?? []).map((m) => ({
      id: m.id,
      channelId: m.channel_id,
      authorId: m.author_id,
      replyToId: m.reply_to_id ?? undefined,
      content: m.content,
      isEdited: m.is_edited,
      isAnnouncement: m.is_announcement ?? false,
      isPinned: m.pinned ?? false,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
      author: m.author ? mapProfile(m.author) : undefined,
    }));
  },
});
