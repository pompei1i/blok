import { create } from "zustand";
import { supabase } from "../supabaseClient";
import { mapProfile } from "../utils";
import { useAuthStore } from "./auth-store";
import type { DMMessage, Attachment } from "./types";

interface DMWindowState {
  userId: string; // the target user
  dmChannelId?: string; 
  position: { x: number; y: number };
  minimized: boolean;
  messages: DMMessage[];
  unreadCount: number;
}

interface DMState {
  openDMs: Record<string, DMWindowState>; // keyed by target userId
  
  initDMData: (userId: string) => Promise<void>;
  openDM: (currentUserId: string, targetUserId: string, initialPosition?: { x: number; y: number }) => Promise<void>;
  closeDM: (userId: string) => void;
  minimizeDM: (userId: string) => void;
  restoreDM: (userId: string) => void;
  updatePosition: (userId: string, position: { x: number; y: number }) => void;
  addMessage: (
    targetUserId: string,
    currentUserId: string,
    content: string,
    attachments?: File[],
    extraAttachments?: Attachment[],
  ) => Promise<boolean>;
  clearUnread: (userId: string) => void;
  deleteDMMessage: (messageId: string, targetUserId: string) => Promise<void>;
}

const DM_PAYLOAD_PREFIX = "__blok_dm_payload__:";

function parseDMContent(rawContent: string): { content: string; attachments: Attachment[] } {
  if (!rawContent.startsWith(DM_PAYLOAD_PREFIX)) {
    return { content: rawContent, attachments: [] };
  }

  try {
    const jsonPayload = rawContent.slice(DM_PAYLOAD_PREFIX.length);
    const payload = JSON.parse(jsonPayload) as {
      text?: string;
      attachments?: Array<{
        id?: string;
        url: string;
        filename: string;
        mediaType?: string;
        sizeBytes?: number;
        createdAt?: string;
      }>;
    };

    return {
      content: payload.text ?? "",
      attachments: (payload.attachments || []).map((a, index) => ({
        id: a.id ?? `dm-att-${index}-${Date.now()}`,
        messageId: "",
        url: a.url,
        filename: a.filename,
        mediaType: a.mediaType,
        sizeBytes: a.sizeBytes,
        createdAt: a.createdAt ?? new Date().toISOString(),
      })),
    };
  } catch {
    return { content: rawContent, attachments: [] };
  }
}

function buildDMContent(text: string, attachments: Attachment[]): string {
  if (attachments.length === 0) return text;
  return `${DM_PAYLOAD_PREFIX}${JSON.stringify({
    text,
    attachments: attachments.map((a) => ({
      id: a.id,
      url: a.url,
      filename: a.filename,
      mediaType: a.mediaType,
      sizeBytes: a.sizeBytes,
      createdAt: a.createdAt,
    })),
  })}`;
}

async function filesToDMAttachments(
  files: File[],
  messageId: string,
): Promise<Attachment[]> {
  return Promise.all(
    files.map((file, i) => {
      return new Promise<Attachment>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve({
            id: `dm-att-${Date.now()}-${i}`,
            messageId,
            url: reader.result as string,
            filename: file.name,
            mediaType: file.type,
            sizeBytes: file.size,
            createdAt: new Date().toISOString(),
          });
        };
        reader.readAsDataURL(file);
      });
    }),
  );
}

async function resolveOrCreateDMChannel(
  currentUserId: string,
  targetUserId: string,
): Promise<string | null> {
  // Sort IDs so lookup is consistent regardless of who initiates
  const [userA, userB] = [currentUserId, targetUserId].sort();

  const { data: existing, error: findError } = await supabase
    .from("dm_channels")
    .select("id")
    .eq("user_a_id", userA)
    .eq("user_b_id", userB)
    .maybeSingle();

  if (findError) console.error("Failed to find DM channel", findError);
  if (existing) return existing.id;

  const { data: created, error: createError } = await supabase
    .from("dm_channels")
    .insert({ user_a_id: userA, user_b_id: userB, type: "dm" })
    .select("id")
    .single();

  if (createError) {
    console.error("Failed to create DM channel", createError);
    return null;
  }

  return created.id;
}

export const useDMStore = create<DMState>((set, get) => ({
  openDMs: {},

  initDMData: async (userId) => {
    try {
      // Setup Realtime hook for incoming DM Messages
      // In advanced implementations, you'd only subscribe to channels you are part of
      supabase
        .channel("public:dm_messages")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "dm_messages" },
          async (payload) => {
            const m = payload.new;

            // Determine targetUserId from a fresh snapshot before the async call
            const openDMs = get().openDMs;
            const channelMatch = Object.entries(openDMs).find(
              ([, dm]) => dm.dmChannelId === m.dm_channel_id,
            );
            const targetUserId =
              channelMatch?.[0] ??
              (m.author_id !== userId ? m.author_id : null);
            if (!targetUserId) return;

            const { data: authorData } = await supabase
              .from("profiles").select("*").eq("id", m.author_id).single();
            const parsedPayload = parseDMContent(m.content);

            const parsedMessage: DMMessage = {
              id: m.id,
              dmChannelId: m.dm_channel_id,
              authorId: m.author_id,
              replyToId: m.reply_to_id,
              content: parsedPayload.content,
              isEdited: m.is_edited,
              createdAt: m.created_at,
              updatedAt: m.updated_at,
              attachments: parsedPayload.attachments.map((a) => ({
                ...a,
                messageId: m.id,
              })),
              author: authorData ? mapProfile(authorData) : undefined,
            };

            const isIncoming = m.author_id !== userId;

            // Functional set — всегда работаем с актуальным стейтом,
            // а не со снимком, захваченным до await
            set((state) => {
              const dm = state.openDMs[targetUserId];
              if (!dm) return state;
              if (dm.messages.some((msg) => msg.id === parsedMessage.id)) return state;
              return {
                openDMs: {
                  ...state.openDMs,
                  [targetUserId]: {
                    ...dm,
                    dmChannelId: m.dm_channel_id,
                    messages: [...dm.messages, parsedMessage],
                    unreadCount: isIncoming && dm.minimized ? dm.unreadCount + 1 : dm.unreadCount,
                  },
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

  openDM: async (currentUserId, targetUserId, initialPosition) => {
    if (!currentUserId || !targetUserId || currentUserId === targetUserId) return;

    const currentDMs = get().openDMs;
    if (currentDMs[targetUserId]) {
      const dm = currentDMs[targetUserId];
      let resolvedChannelId = dm.dmChannelId;
      if (!resolvedChannelId) {
        resolvedChannelId = await resolveOrCreateDMChannel(currentUserId, targetUserId) ?? undefined;
      }
      set({
        openDMs: {
          ...currentDMs,
          [targetUserId]: {
            ...dm,
            minimized: false,
            dmChannelId: resolvedChannelId,
          },
        },
      });
      return;
    }

    const offset = Object.keys(currentDMs).length * 30;
    const fallbackPosition =
      typeof window !== "undefined"
        ? {
            x: Math.max(20, window.innerWidth - 380 - offset),
            y: Math.max(20, window.innerHeight - 500 - offset),
          }
        : { x: 400, y: 200 };
    const position = initialPosition ?? fallbackPosition;

    set({ openDMs: { ...currentDMs, [targetUserId]: { userId: targetUserId, position, minimized: false, messages: [], unreadCount: 0 } } });

    const dmChannelId = await resolveOrCreateDMChannel(currentUserId, targetUserId);

    if (!dmChannelId) return; // failure

    // 3. fetch history
    const { data: msgData } = await supabase
      .from("dm_messages")
      .select(`
        id, dm_channel_id, author_id, reply_to_id, content, is_edited, created_at, updated_at,
        author:profiles(id, username, display_name, avatar_url, accent_color, pronouns)
      `)
      .eq("dm_channel_id", dmChannelId)
      .order("created_at", { ascending: true })
      .limit(30);

    const messages: DMMessage[] = (msgData || []).map(m => ({
      ...(() => {
        const parsed = parseDMContent(m.content);
        return {
          content: parsed.content,
          attachments: parsed.attachments.map((a) => ({
            ...a,
            messageId: m.id,
          })),
        };
      })(),
      id: m.id,
      dmChannelId: m.dm_channel_id,
      authorId: m.author_id,
      replyToId: m.reply_to_id,
      isEdited: m.is_edited,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
      author: m.author ? mapProfile(m.author) : undefined,
    }));

    set(state => ({
       openDMs: {
         ...state.openDMs,
         [targetUserId]: {
            ...state.openDMs[targetUserId],
            dmChannelId,
            messages
         }
       }
    }));
  },

  closeDM: (userId) => {
    const { [userId]: _, ...rest } = get().openDMs;
    set({ openDMs: rest });
  },

  minimizeDM: (userId) => {
    const currentDMs = get().openDMs;
    const dm = currentDMs[userId];
    if (dm) {
      set({
        openDMs: { ...currentDMs, [userId]: { ...dm, minimized: true } },
      });
    }
  },

  restoreDM: (userId) => {
    const currentDMs = get().openDMs;
    const dm = currentDMs[userId];
    if (dm) {
      set({
        openDMs: { ...currentDMs, [userId]: { ...dm, minimized: false } },
      });
    }
  },

  updatePosition: (userId, position) => {
    const currentDMs = get().openDMs;
    const dm = currentDMs[userId];
    if (dm) {
      set({
        openDMs: { ...currentDMs, [userId]: { ...dm, position } },
      });
    }
  },

  addMessage: async (targetUserId, currentUserId, content, files = [], extraAttachments = []) => {
    const dm = get().openDMs[targetUserId];
    if (!dm) return false;

    let dmChannelId = dm.dmChannelId;
    if (!dmChannelId) {
      dmChannelId = await resolveOrCreateDMChannel(currentUserId, targetUserId) ?? undefined;
      if (dmChannelId) {
        set((state) => ({
          openDMs: {
            ...state.openDMs,
            [targetUserId]: {
              ...state.openDMs[targetUserId],
              dmChannelId,
            },
          },
        }));
      }
    }

    if (!dmChannelId) {
      console.error("Cannot send DM message: dmChannelId missing");
      return false;
    }

    const localMessageId = `dm-${Date.now()}`;
    const convertedAttachments = await filesToDMAttachments(files, localMessageId);
    const allAttachments = [
      ...convertedAttachments,
      ...extraAttachments.map((a) => ({ ...a, messageId: localMessageId })),
    ];
    const payloadContent = buildDMContent(content, allAttachments);

    const { data: inserted, error } = await supabase
      .from("dm_messages")
      .insert({
        dm_channel_id: dmChannelId,
        author_id: currentUserId,
        content: payloadContent,
      })
      .select()
      .single();

    if (error) {
      console.error("Failed to send DM message", error);
      return false;
    }

    if (inserted) {
      const parsed = parseDMContent(inserted.content);
      const localMessage: DMMessage = {
        id: inserted.id,
        dmChannelId: inserted.dm_channel_id,
        authorId: inserted.author_id,
        replyToId: inserted.reply_to_id,
        content: parsed.content,
        isEdited: inserted.is_edited,
        createdAt: inserted.created_at,
        updatedAt: inserted.updated_at,
        attachments: parsed.attachments.map((a) => ({
          ...a,
          messageId: inserted.id,
        })),
      };

      set((state) => {
        const target = state.openDMs[targetUserId];
        if (!target) return state;
        const exists = target.messages.some((m) => m.id === localMessage.id);
        return {
          openDMs: {
            ...state.openDMs,
            [targetUserId]: {
              ...target,
              messages: exists ? target.messages : [...target.messages, localMessage],
            },
          },
        };
      });
    }

    return true;
  },

  clearUnread: (userId) => {
    const currentDMs = get().openDMs;
    const dm = currentDMs[userId];
    if (dm) {
      set({
        openDMs: { ...currentDMs, [userId]: { ...dm, unreadCount: 0 } },
      });
    }
  },

  deleteDMMessage: async (messageId, targetUserId) => {
    set((state) => ({
      openDMs: {
        ...state.openDMs,
        [targetUserId]: state.openDMs[targetUserId]
          ? {
              ...state.openDMs[targetUserId],
              messages: state.openDMs[targetUserId].messages.filter((m) => m.id !== messageId),
            }
          : state.openDMs[targetUserId],
      },
    }));
    const currentUserId = useAuthStore.getState().user?.id ?? "";
    const { error } = await supabase
      .from("dm_messages")
      .delete()
      .eq("id", messageId)
      .eq("author_id", currentUserId);
    if (error) console.error("Failed to delete DM message", error);
  },
}));
