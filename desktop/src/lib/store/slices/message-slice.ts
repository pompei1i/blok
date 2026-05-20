import type { StateCreator } from "zustand";
import { supabase } from "../../supabaseClient";
import { mapProfile } from "../../utils";
import { MESSAGE_PAGE_SIZE, MESSAGE_LRU_LIMIT } from "../../constants";
import type { Message, Reaction } from "../types";
import type { ServerStore } from "../server-store.shape";
import { _currentUserId } from "./_shared";

export interface MessageSlice {
  messages: Record<string, Message[]>;
  messageChannelIndex: Record<string, string>;
  lruChannelOrder: string[];
  messagesLoaded: Set<string>;
  messagesLoading: Set<string>;
  messagesAtStart: Set<string>;
  typingUsers: Record<string, string[]>;

  loadMessages: (channelId: string) => Promise<void>;
  loadMoreMessages: (channelId: string) => Promise<void>;
  addMessage: (channelId: string, message: Message) => Promise<void>;
  setTyping: (channelId: string, userId: string, isTyping: boolean) => void;
  editMessage: (channelId: string, messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string, channelId: string) => Promise<void>;
  pinMessage: (messageId: string, channelId: string) => Promise<void>;
  addReaction: (messageId: string, channelId: string, emoji: string, userId: string) => Promise<void>;
  removeReaction: (messageId: string, channelId: string, emoji: string, userId: string) => Promise<void>;
}

export const createMessageSlice: StateCreator<ServerStore, [], [], MessageSlice> = (set, get) => ({
  messages: {},
  messageChannelIndex: {},
  lruChannelOrder: [],
  messagesLoaded: new Set(),
  messagesLoading: new Set(),
  messagesAtStart: new Set(),
  typingUsers: {},

  loadMessages: async (channelId) => {
    const { messagesLoaded, messagesLoading } = get();
    if (messagesLoaded.has(channelId) || messagesLoading.has(channelId)) return;

    set((state) => ({ messagesLoading: new Set([...state.messagesLoading, channelId]) }));

    const { data, error } = await supabase
      .from("messages")
      .select(`
        id, channel_id, author_id, reply_to_id, content, is_edited, pinned, created_at, updated_at,
        author:profiles(id, username, display_name, avatar_url, accent_color, pronouns),
        attachments(id, message_id, url, filename, media_type, size_bytes, created_at),
        message_reactions(id, message_id, user_id, emoji, created_at)
      `)
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
            id: a.id, messageId: a.message_id, url: a.url, filename: a.filename,
            mediaType: a.media_type, sizeBytes: a.size_bytes, createdAt: a.created_at,
          }))
        : [],
      reactions: Array.isArray(m.message_reactions)
        ? m.message_reactions.map((r: any) => ({
            id: r.id, messageId: r.message_id, userId: r.user_id,
            emoji: r.emoji, createdAt: r.created_at,
          }))
        : [],
    }));

    const isAtStart = (data || []).length < MESSAGE_PAGE_SIZE;

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
        delete updatedMessages[evictId];
        updatedIndex = Object.fromEntries(Object.entries(updatedIndex).filter(([, chId]) => chId !== evictId));
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
      .select(`
        id, channel_id, author_id, reply_to_id, content, is_edited, pinned, created_at, updated_at,
        author:profiles(id, username, display_name, avatar_url, accent_color, pronouns),
        attachments(id, message_id, url, filename, media_type, size_bytes, created_at),
        message_reactions(id, message_id, user_id, emoji, created_at)
      `)
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

    const older: Message[] = (data || []).reverse().map((m) => ({
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
            id: a.id, messageId: a.message_id, url: a.url, filename: a.filename,
            mediaType: a.media_type, sizeBytes: a.size_bytes, createdAt: a.created_at,
          }))
        : [],
      reactions: Array.isArray(m.message_reactions)
        ? m.message_reactions.map((r: any) => ({
            id: r.id, messageId: r.message_id, userId: r.user_id,
            emoji: r.emoji, createdAt: r.created_at,
          }))
        : [],
    }));

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
    const { data: insertedMsg, error } = await supabase
      .from("messages")
      .insert({ channel_id: channelId, author_id: message.authorId, content: message.content, reply_to_id: message.replyToId ?? null })
      .select()
      .single();
    if (error) { console.error("Message send failed", error); return; }
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
    set((state) => {
      const { [messageId]: _dropped, ...restIndex } = state.messageChannelIndex;
      return {
        messages: { ...state.messages, [channelId]: (state.messages[channelId] || []).filter((m) => m.id !== messageId) },
        messageChannelIndex: restIndex,
      };
    });
    const { error } = await supabase.from("messages").delete()
      .eq("id", messageId).eq("author_id", _currentUserId ?? "");
    if (error) console.error("Failed to delete message", error);
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
});
