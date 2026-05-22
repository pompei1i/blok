import type { StateCreator } from "zustand";
import { supabase } from "../../supabaseClient";
import { mapProfile } from "../../utils";
import { NativeVoiceEngine, getActiveNativeVoiceEngine, setActiveNativeVoiceEngine } from "../../native-voice-engine";
import type { User, VoiceParticipant } from "../types";
import type { ServerStore } from "../server-store.shape";
import { voicePresenceCh, _currentUserId } from "./_shared";

export interface VoiceSlice {
  activeVoiceChannelId: string | null;
  voiceParticipants: Record<string, VoiceParticipant[]>;
  isMuted: boolean;
  isDeafened: boolean;
  isScreenSharing: boolean;
  /** All peers currently sharing their screen: userId → MediaStream */
  screenSharers: Record<string, MediaStream>;
  /** Which sharer the local user is currently watching (null = none) */
  watchingUserId: string | null;

  joinVoiceChannel: (channelId: string, user: User) => Promise<string | null>;
  leaveVoiceChannel: () => Promise<void>;
  toggleMute: () => void;
  toggleDeafen: () => void;
  toggleScreenShare: (sourceId?: string) => Promise<void>;
  setWatchingUserId: (userId: string) => void;
}

export const createVoiceSlice: StateCreator<ServerStore, [], [], VoiceSlice> = (set, get) => ({
  activeVoiceChannelId: null,
  voiceParticipants: {},
  isMuted: false,
  isDeafened: false,
  isScreenSharing: false,
  screenSharers: {},
  watchingUserId: null,

  joinVoiceChannel: async (channelId, user) => {
    const prevChannel = get().activeVoiceChannelId;
    if (prevChannel) await get().leaveVoiceChannel();

    set((state) => ({
      activeVoiceChannelId: channelId,
      voiceParticipants: {
        ...state.voiceParticipants,
        [channelId]: [
          ...(state.voiceParticipants[channelId] ?? []).filter((p) => p.userId !== user.id),
          { userId: user.id, channelId, isMuted: state.isMuted, isDeafened: state.isDeafened, isScreenSharing: false, isSpeaking: false, user },
        ],
      },
    }));

    const engine = new NativeVoiceEngine(channelId, user.id, {
      onParticipantJoin: (userId) => {
        set((state) => {
          const existing = state.voiceParticipants[channelId] ?? [];
          if (existing.some((p) => p.userId === userId)) return state;
          const cachedUser = state.userProfileCache[userId];
          const participant: VoiceParticipant = {
            userId, channelId, isMuted: false, isDeafened: false,
            isScreenSharing: false, isSpeaking: false, user: cachedUser,
          };
          if (!cachedUser) {
            supabase.from("profiles").select("*").eq("id", userId).single().then(({ data }) => {
              if (!data) return;
              const loadedUser = mapProfile(data);
              set((s) => ({
                userProfileCache: { ...s.userProfileCache, [userId]: loadedUser },
                voiceParticipants: {
                  ...s.voiceParticipants,
                  [channelId]: (s.voiceParticipants[channelId] ?? []).map((p) =>
                    p.userId === userId ? { ...p, user: loadedUser } : p
                  ),
                },
              }));
            });
          }
          return { voiceParticipants: { ...state.voiceParticipants, [channelId]: [...existing, participant] } };
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
        if (userId === _currentUserId) return;
        set((state) => {
          const next = { ...state.screenSharers, [userId]: stream };
          // Auto-select if nobody is being watched yet
          const watching = state.watchingUserId ?? userId;
          return { screenSharers: next, watchingUserId: watching };
        });
      },
      onScreenShareStop: (userId) => {
        set((state) => {
          if (!state.screenSharers[userId]) return state;
          const next = { ...state.screenSharers };
          delete next[userId];
          // If we were watching the stopped sharer, switch to another (or null)
          let watching = state.watchingUserId;
          if (watching === userId) {
            const remaining = Object.keys(next);
            watching = remaining.length > 0 ? remaining[0] : null;
          }
          return { screenSharers: next, watchingUserId: watching };
        });
      },
    });

    try {
      await engine.join();
      setActiveNativeVoiceEngine(engine);
      const { isMuted, isDeafened } = get();
      if (isMuted) engine.setMuted(true);
      if (isDeafened) engine.setDeafened(true);
      voicePresenceCh?.track({ userId: user.id, voiceChannelId: channelId, isMuted, isDeafened, isScreenSharing: false });
      return null;
    } catch (err) {
      setActiveNativeVoiceEngine(null);
      set((state) => ({
        activeVoiceChannelId: null,
        voiceParticipants: { ...state.voiceParticipants, [channelId]: [] },
      }));
      return typeof err === "string" ? err
        : err instanceof Error ? err.message
        : "Failed to access microphone";
    }
  },

  leaveVoiceChannel: async () => {
    if (_currentUserId) {
      voicePresenceCh?.track({ userId: _currentUserId, voiceChannelId: null, isMuted: false, isDeafened: false, isScreenSharing: false });
    }
    const engine = getActiveNativeVoiceEngine();
    if (engine) { setActiveNativeVoiceEngine(null); await engine.leave(); }
    set((state) => {
      const ch = state.activeVoiceChannelId;
      if (!ch) return state;
      return {
        activeVoiceChannelId: null,
        voiceParticipants: { ...state.voiceParticipants, [ch]: [] },
        isScreenSharing: false,
        screenSharers: {},
        watchingUserId: null,
      };
    });
  },

  toggleMute: () => {
    const newMuted = !get().isMuted;
    set({ isMuted: newMuted });
    getActiveNativeVoiceEngine()?.setMuted(newMuted);
    const { activeVoiceChannelId, isDeafened, isScreenSharing } = get();
    if (activeVoiceChannelId && _currentUserId) {
      voicePresenceCh?.track({ userId: _currentUserId, voiceChannelId: activeVoiceChannelId, isMuted: newMuted, isDeafened, isScreenSharing });
      set((state) => ({
        voiceParticipants: {
          ...state.voiceParticipants,
          [activeVoiceChannelId]: (state.voiceParticipants[activeVoiceChannelId] ?? []).map((p) =>
            p.userId === _currentUserId ? { ...p, isMuted: newMuted } : p
          ),
        },
      }));
    }
  },

  toggleDeafen: () => {
    const newDeafened = !get().isDeafened;
    set({ isDeafened: newDeafened });
    getActiveNativeVoiceEngine()?.setDeafened(newDeafened);
    const { activeVoiceChannelId, isMuted, isScreenSharing } = get();
    if (activeVoiceChannelId && _currentUserId) {
      voicePresenceCh?.track({ userId: _currentUserId, voiceChannelId: activeVoiceChannelId, isMuted, isDeafened: newDeafened, isScreenSharing });
      set((state) => ({
        voiceParticipants: {
          ...state.voiceParticipants,
          [activeVoiceChannelId]: (state.voiceParticipants[activeVoiceChannelId] ?? []).map((p) =>
            p.userId === _currentUserId ? { ...p, isDeafened: newDeafened } : p
          ),
        },
      }));
    }
  },

  setWatchingUserId: (userId) => {
    set({ watchingUserId: userId });
  },

  toggleScreenShare: async (sourceId?: string) => {
    const engine = getActiveNativeVoiceEngine();
    if (!engine) return;
    const { isScreenSharing, activeVoiceChannelId, isMuted, isDeafened } = get();
    if (isScreenSharing) {
      await engine.stopScreenShare();
      set({ isScreenSharing: false });
      if (activeVoiceChannelId && _currentUserId) {
        voicePresenceCh?.track({ userId: _currentUserId, voiceChannelId: activeVoiceChannelId, isMuted, isDeafened, isScreenSharing: false });
        set((state) => ({
          voiceParticipants: {
            ...state.voiceParticipants,
            [activeVoiceChannelId]: (state.voiceParticipants[activeVoiceChannelId] ?? []).map((p) =>
              p.userId === _currentUserId ? { ...p, isScreenSharing: false } : p
            ),
          },
        }));
      }
    } else {
      try {
        await engine.startScreenShare(sourceId);
        set({ isScreenSharing: true });
        if (activeVoiceChannelId && _currentUserId) {
          voicePresenceCh?.track({ userId: _currentUserId, voiceChannelId: activeVoiceChannelId, isMuted, isDeafened, isScreenSharing: true });
          set((state) => ({
            voiceParticipants: {
              ...state.voiceParticipants,
              [activeVoiceChannelId]: (state.voiceParticipants[activeVoiceChannelId] ?? []).map((p) =>
                p.userId === _currentUserId ? { ...p, isScreenSharing: true } : p
              ),
            },
          }));
        }
      } catch { /* user cancelled */ }
    }
  },
});
