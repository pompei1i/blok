import { create } from "zustand";
import { supabase } from "../supabaseClient";
import { mapProfile } from "../utils";
import { useAuthStore } from "./auth-store";
import { NativeVoiceEngine, getActiveNativeVoiceEngine, setActiveNativeVoiceEngine } from "../native-voice-engine";
import type { DMMessage, Attachment } from "./types";

type CallSignal =
  | { type: "call_invite"; to: string; from: string; fromUsername: string; dmChannelId: string }
  | { type: "call_accept"; to: string; from: string }
  | { type: "call_decline"; to: string; from: string }
  | { type: "call_cancel"; to: string; from: string }
  | { type: "call_end"; to: string; from: string };

export interface IncomingCall {
  fromUserId: string;
  fromUsername: string;
  dmChannelId: string;
}

export interface OutgoingCall {
  toUserId: string;
  toUsername: string;
  dmChannelId: string;
}

export interface ActiveDMCall {
  peerUserId: string;
  peerUsername: string;
  dmChannelId: string;
  startedAt: number;
}

let _callChannel: ReturnType<typeof supabase.channel> | null = null;
let _callInviteTimer: ReturnType<typeof setTimeout> | null = null;
let _dmVoiceEngine: NativeVoiceEngine | null = null;

function stopDMVoiceLocally() {
  if (_dmVoiceEngine) {
    void _dmVoiceEngine.leave();
    _dmVoiceEngine = null;
    if (getActiveNativeVoiceEngine()) setActiveNativeVoiceEngine(null);
  }
}

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
  incomingCall: IncomingCall | null;
  outgoingCall: OutgoingCall | null;
  activeCall: ActiveDMCall | null;

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

  callUser: (targetUserId: string, targetUsername: string) => Promise<void>;
  cancelCall: () => void;
  acceptCall: () => Promise<void>;
  declineCall: () => void;
  endCall: () => void;
}

export const DM_PAYLOAD_PREFIX = "__blok_dm_payload__:";

export function parseDMContent(rawContent: string): { content: string; attachments: Attachment[] } {
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

export function buildDMContent(text: string, attachments: Attachment[]): string {
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
  incomingCall: null,
  outgoingCall: null,
  activeCall: null,

  initDMData: async (userId) => {
    try {
      // Persistent call-signaling channel — lives for the entire session.
      // All call signals are routed through one shared broadcast channel;
      // each client filters by `payload.to === myUserId`.
      if (_callChannel) {
        await supabase.removeChannel(_callChannel);
      }
      _callChannel = supabase
        .channel("dm_calls", { config: { broadcast: { self: false } } })
        .on("broadcast", { event: "call" }, ({ payload }) => {
          const sig = payload as CallSignal;
          if (sig.to !== userId) return;
          switch (sig.type) {
            case "call_invite":
              if (!get().activeCall && !get().incomingCall) {
                set({ incomingCall: { fromUserId: sig.from, fromUsername: sig.fromUsername, dmChannelId: sig.dmChannelId } });
              }
              break;
            case "call_accept": {
              const outgoing = get().outgoingCall;
              if (!outgoing || outgoing.toUserId !== sig.from) return;
              if (_callInviteTimer) { clearTimeout(_callInviteTimer); _callInviteTimer = null; }
              const engine = new NativeVoiceEngine(outgoing.dmChannelId, userId, {
                onParticipantJoin: () => {},
                onParticipantLeave: () => { stopDMVoiceLocally(); useDMStore.setState({ activeCall: null }); },
                onSpeakingChange: () => {},
              });
              void engine.join().then(() => {
                _dmVoiceEngine = engine;
                setActiveNativeVoiceEngine(engine);
                set({ outgoingCall: null, activeCall: { peerUserId: sig.from, peerUsername: outgoing.toUsername, dmChannelId: outgoing.dmChannelId, startedAt: Date.now() } });
              }).catch(() => set({ outgoingCall: null }));
              break;
            }
            case "call_decline":
            case "call_cancel":
              if (_callInviteTimer) { clearTimeout(_callInviteTimer); _callInviteTimer = null; }
              set({ outgoingCall: null, incomingCall: null });
              break;
            case "call_end":
              stopDMVoiceLocally();
              set({ activeCall: null });
              break;
          }
        })
        .subscribe();

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
      set(state => {
        const existing = state.openDMs[targetUserId];
        if (!existing) return state;
        return { openDMs: { ...state.openDMs, [targetUserId]: { ...existing, minimized: false, dmChannelId: resolvedChannelId } } };
      });
      return;
    }

    const offset = Object.keys(currentDMs).length * 30;
    const fallbackPosition =
      typeof window !== "undefined"
        ? (() => {
            const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
            const popupW = 21.25 * remPx;
            const popupH = 26.25 * remPx;
            return {
              x: Math.max(20, window.innerWidth - popupW - 40 - offset),
              y: Math.max(20, window.innerHeight - popupH - 80 - offset),
            };
          })()
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

    set(state => {
      const existing = state.openDMs[targetUserId];
      if (!existing) return state; // closed before async completed — don't re-add
      return {
        openDMs: {
          ...state.openDMs,
          [targetUserId]: { ...existing, dmChannelId, messages },
        },
      };
    });
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

  callUser: async (targetUserId, targetUsername) => {
    const currentUserId = useAuthStore.getState().user?.id;
    const currentUsername = useAuthStore.getState().user?.username ?? "unknown";
    if (!currentUserId) return;
    if (getActiveNativeVoiceEngine()) return; // already in a call/voice channel

    let dmChannelId = get().openDMs[targetUserId]?.dmChannelId;
    if (!dmChannelId) {
      dmChannelId = (await resolveOrCreateDMChannel(currentUserId, targetUserId)) ?? undefined;
    }
    if (!dmChannelId) return;

    set({ outgoingCall: { toUserId: targetUserId, toUsername: targetUsername, dmChannelId } });

    _callChannel?.send({
      type: "broadcast",
      event: "call",
      payload: { type: "call_invite", to: targetUserId, from: currentUserId, fromUsername: currentUsername, dmChannelId } satisfies CallSignal,
    }).catch(() => {});

    if (_callInviteTimer) clearTimeout(_callInviteTimer);
    _callInviteTimer = setTimeout(() => {
      if (useDMStore.getState().outgoingCall?.toUserId === targetUserId) {
        useDMStore.getState().cancelCall();
      }
    }, 45_000);
  },

  cancelCall: () => {
    const currentUserId = useAuthStore.getState().user?.id;
    const { outgoingCall } = get();
    if (!outgoingCall || !currentUserId) return;
    if (_callInviteTimer) { clearTimeout(_callInviteTimer); _callInviteTimer = null; }
    _callChannel?.send({
      type: "broadcast",
      event: "call",
      payload: { type: "call_cancel", to: outgoingCall.toUserId, from: currentUserId } satisfies CallSignal,
    }).catch(() => {});
    set({ outgoingCall: null });
  },

  acceptCall: async () => {
    const currentUserId = useAuthStore.getState().user?.id;
    const { incomingCall } = get();
    if (!incomingCall || !currentUserId) return;

    await _callChannel?.send({
      type: "broadcast",
      event: "call",
      payload: { type: "call_accept", to: incomingCall.fromUserId, from: currentUserId } satisfies CallSignal,
    });

    const engine = new NativeVoiceEngine(incomingCall.dmChannelId, currentUserId, {
      onParticipantJoin: () => {},
      onParticipantLeave: () => { stopDMVoiceLocally(); useDMStore.setState({ activeCall: null }); },
      onSpeakingChange: () => {},
    });

    try {
      await engine.join();
      _dmVoiceEngine = engine;
      setActiveNativeVoiceEngine(engine);
      set({
        incomingCall: null,
        activeCall: { peerUserId: incomingCall.fromUserId, peerUsername: incomingCall.fromUsername, dmChannelId: incomingCall.dmChannelId, startedAt: Date.now() },
      });
    } catch {
      set({ incomingCall: null });
    }
  },

  declineCall: () => {
    const currentUserId = useAuthStore.getState().user?.id;
    const { incomingCall } = get();
    if (!incomingCall || !currentUserId) return;
    _callChannel?.send({
      type: "broadcast",
      event: "call",
      payload: { type: "call_decline", to: incomingCall.fromUserId, from: currentUserId } satisfies CallSignal,
    }).catch(() => {});
    set({ incomingCall: null });
  },

  endCall: () => {
    const currentUserId = useAuthStore.getState().user?.id;
    const { activeCall } = get();
    if (!activeCall || !currentUserId) return;
    _callChannel?.send({
      type: "broadcast",
      event: "call",
      payload: { type: "call_end", to: activeCall.peerUserId, from: currentUserId } satisfies CallSignal,
    }).catch(() => {});
    stopDMVoiceLocally();
    set({ activeCall: null });
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
