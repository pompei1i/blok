import type { StateCreator } from "zustand";
import { supabase } from "../../supabaseClient";
import { mapProfile } from "../../utils";
import { playMuteSound, playUnmuteSound, playCaptureStartSound, playCaptureStopSound } from "../../sounds";
import { NativeVoiceEngine, getActiveNativeVoiceEngine, setActiveNativeVoiceEngine } from "../../native-voice-engine";
import type { User, VoiceParticipant } from "../types";
import type { ServerStore } from "../server-store.shape";
import { voicePresenceCh } from "./_shared";

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
  isCameraOn: boolean;
  /** Remote cameras: userId → MediaStream */
  cameraUsers: Record<string, MediaStream>;
  /** Local camera stream for self-preview */
  localCameraStream: MediaStream | null;
  /** Per-user volume override: 0–200, default 100 */
  userVolumes: Record<string, number>;
  /** Users locally muted (only affects this client's playback) */
  locallyMuted: Record<string, boolean>;

  joinVoiceChannel: (channelId: string, user: User) => Promise<string | null>;
  leaveVoiceChannel: () => Promise<void>;
  toggleMute: () => void;
  toggleDeafen: () => void;
  toggleScreenShare: (sourceId?: string) => Promise<void>;
  setWatchingUserId: (userId: string) => void;
  toggleCamera: () => Promise<void>;
  setUserVolume: (userId: string, volume: number) => void;
  setLocalMute: (userId: string, muted: boolean) => void;
}

export const createVoiceSlice: StateCreator<ServerStore, [], [], VoiceSlice> = (set, get) => ({
  activeVoiceChannelId: null,
  voiceParticipants: {},
  isMuted: false,
  isDeafened: false,
  isScreenSharing: false,
  screenSharers: {},
  watchingUserId: null,
  isCameraOn: false,
  cameraUsers: {},
  localCameraStream: null,
  userVolumes: {},
  locallyMuted: {},

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
        if (userId === get()._currentUserId) return;
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
          let watching = state.watchingUserId;
          if (watching === userId) {
            const remaining = Object.keys(next);
            watching = remaining.length > 0 ? remaining[0] : null;
          }
          return { screenSharers: next, watchingUserId: watching };
        });
      },
      onVideoStart: (userId, stream) => {
        if (userId === get()._currentUserId) {
          set({ localCameraStream: stream });
        } else {
          set((state) => ({ cameraUsers: { ...state.cameraUsers, [userId]: stream } }));
        }
      },
      onVideoStop: (userId) => {
        if (userId === get()._currentUserId) {
          set({ localCameraStream: null });
        } else {
          set((state) => {
            const next = { ...state.cameraUsers };
            delete next[userId];
            return { cameraUsers: next };
          });
        }
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
    const currentUserId = get()._currentUserId;
    if (currentUserId) {
      voicePresenceCh?.track({ userId: currentUserId, voiceChannelId: null, isMuted: false, isDeafened: false, isScreenSharing: false });
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
        isCameraOn: false,
        cameraUsers: {},
        localCameraStream: null,
        // userVolumes and locallyMuted intentionally preserved across voice sessions
      };
    });
  },

  toggleMute: () => {
    const newMuted = !get().isMuted;
    if (newMuted) playMuteSound(); else playUnmuteSound();
    const { activeVoiceChannelId, isDeafened, isScreenSharing, _currentUserId } = get();
    getActiveNativeVoiceEngine()?.setMuted(newMuted);
    set((state) => ({
      isMuted: newMuted,
      voiceParticipants: activeVoiceChannelId ? {
        ...state.voiceParticipants,
        [activeVoiceChannelId]: (state.voiceParticipants[activeVoiceChannelId] ?? []).map((p) =>
          p.userId === _currentUserId ? { ...p, isMuted: newMuted } : p
        ),
      } : state.voiceParticipants,
    }));
    if (activeVoiceChannelId && _currentUserId) {
      voicePresenceCh?.track({ userId: _currentUserId, voiceChannelId: activeVoiceChannelId, isMuted: newMuted, isDeafened, isScreenSharing });
    }
  },

  toggleDeafen: () => {
    const newDeafened = !get().isDeafened;
    const { activeVoiceChannelId, isMuted, isScreenSharing, _currentUserId } = get();
    getActiveNativeVoiceEngine()?.setDeafened(newDeafened);
    set((state) => ({
      isDeafened: newDeafened,
      voiceParticipants: activeVoiceChannelId ? {
        ...state.voiceParticipants,
        [activeVoiceChannelId]: (state.voiceParticipants[activeVoiceChannelId] ?? []).map((p) =>
          p.userId === _currentUserId ? { ...p, isDeafened: newDeafened } : p
        ),
      } : state.voiceParticipants,
    }));
    if (activeVoiceChannelId && _currentUserId) {
      voicePresenceCh?.track({ userId: _currentUserId, voiceChannelId: activeVoiceChannelId, isMuted, isDeafened: newDeafened, isScreenSharing });
    }
  },

  setWatchingUserId: (userId) => {
    set({ watchingUserId: userId });
  },

  toggleCamera: async () => {
    const engine = getActiveNativeVoiceEngine();
    if (!engine) return;
    const { isCameraOn } = get();
    if (isCameraOn) {
      playCaptureStopSound();
      await engine.stopCamera();
      set({ isCameraOn: false, localCameraStream: null });
    } else {
      try {
        playCaptureStartSound();
        await engine.startCamera();
        set({ isCameraOn: true });
      } catch { /* user cancelled or no camera */ }
    }
  },

  toggleScreenShare: async (sourceId?: string) => {
    const engine = getActiveNativeVoiceEngine();
    if (!engine) return;
    const { isScreenSharing, activeVoiceChannelId, isMuted, isDeafened, _currentUserId } = get();
    if (isScreenSharing) {
      playCaptureStopSound();
      await engine.stopScreenShare();
      if (activeVoiceChannelId && _currentUserId) {
        voicePresenceCh?.track({ userId: _currentUserId, voiceChannelId: activeVoiceChannelId, isMuted, isDeafened, isScreenSharing: false });
        set((state) => ({
          isScreenSharing: false,
          voiceParticipants: {
            ...state.voiceParticipants,
            [activeVoiceChannelId]: (state.voiceParticipants[activeVoiceChannelId] ?? []).map((p) =>
              p.userId === _currentUserId ? { ...p, isScreenSharing: false } : p
            ),
          },
        }));
      } else {
        set({ isScreenSharing: false });
      }
    } else {
      try {
        playCaptureStartSound();
        await engine.startScreenShare(sourceId);
        if (activeVoiceChannelId && _currentUserId) {
          voicePresenceCh?.track({ userId: _currentUserId, voiceChannelId: activeVoiceChannelId, isMuted, isDeafened, isScreenSharing: true });
          set((state) => ({
            isScreenSharing: true,
            voiceParticipants: {
              ...state.voiceParticipants,
              [activeVoiceChannelId]: (state.voiceParticipants[activeVoiceChannelId] ?? []).map((p) =>
                p.userId === _currentUserId ? { ...p, isScreenSharing: true } : p
              ),
            },
          }));
        } else {
          set({ isScreenSharing: true });
        }
      } catch { /* user cancelled */ }
    }
  },

  setUserVolume: (userId, volume) => {
    set((s) => ({ userVolumes: { ...s.userVolumes, [userId]: volume } }));
    getActiveNativeVoiceEngine()?.setUserVolume(userId, volume);
  },

  setLocalMute: (userId, muted) => {
    set((s) => ({ locallyMuted: { ...s.locallyMuted, [userId]: muted } }));
    getActiveNativeVoiceEngine()?.setLocalMute(userId, muted);
  },
});
