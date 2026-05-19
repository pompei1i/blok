import { create } from 'zustand';
import type { Group, Channel, GroupMember, Message, User, VoiceParticipant } from './types';
import { VoiceEngine, getActiveVoiceEngine, setActiveVoiceEngine } from '../voice-engine';

interface GroupState {
  groups: Group[];
  activeGroupId: string | null;
  activeChannelId: string | null;
  channels: Record<string, Channel[]>;
  members: Record<string, GroupMember[]>;
  messages: Record<string, Message[]>;
  typingUsers: Record<string, string[]>;
  openTabs: string[];
  activeVoiceChannelId: string | null;
  voiceParticipants: Record<string, VoiceParticipant[]>;
  isMuted: boolean;
  isDeafened: boolean;
  setActiveGroup: (groupId: string | null) => void;
  setActiveChannel: (channelId: string | null) => void;
  addGroup: (group: Group) => void;
  removeGroup: (groupId: string) => void;
  addMessage: (channelId: string, message: Message) => void;
  setTyping: (channelId: string, userId: string, isTyping: boolean) => void;
  openTab: (groupId: string) => void;
  closeTab: (groupId: string) => void;
  joinVoiceChannel: (channelId: string, user: User) => Promise<void>;
  leaveVoiceChannel: () => Promise<void>;
  toggleMute: () => void;
  toggleDeafen: () => void;
}

const mockUser1: User = {
  id: '2',
  username: 'CyberNinja',
  email: 'ninja@blok.app',
  displayName: 'Cyber Ninja',
  createdAt: new Date().toISOString(),
};

const mockGroups: Group[] = [
  { id: 'g1', name: 'Dev Hub', description: 'A place for developers to hang out', ownerId: '1', createdAt: new Date().toISOString() },
  { id: 'g2', name: 'Gaming Squad', description: "Let's play some games!", ownerId: '2', createdAt: new Date().toISOString() },
  { id: 'g3', name: 'Design Corner', description: 'UI/UX discussions', ownerId: '1', createdAt: new Date().toISOString() },
];

const mockChannels: Record<string, Channel[]> = {
  'g1': [
    { id: 'c1', groupId: 'g1', name: 'general', type: 'text', position: 0 },
    { id: 'c2', groupId: 'g1', name: 'help', type: 'text', position: 1 },
    { id: 'c3', groupId: 'g1', name: 'showcase', type: 'text', position: 2 },
    { id: 'v1', groupId: 'g1', name: 'voice-chat', type: 'voice', position: 3 },
    { id: 'v2', groupId: 'g1', name: 'pair-programming', type: 'voice', position: 4 },
  ],
  'g2': [
    { id: 'c4', groupId: 'g2', name: 'lobby', type: 'text', position: 0 },
    { id: 'c5', groupId: 'g2', name: 'lfg', type: 'text', position: 1 },
    { id: 'v3', groupId: 'g2', name: 'game-room-1', type: 'voice', position: 2 },
  ],
  'g3': [
    { id: 'c6', groupId: 'g3', name: 'inspiration', type: 'text', position: 0 },
    { id: 'c7', groupId: 'g3', name: 'feedback', type: 'text', position: 1 },
    { id: 'v4', groupId: 'g3', name: 'design-review', type: 'voice', position: 2 },
  ],
};

const mockMessages: Record<string, Message[]> = {
  'c1': [
    { id: 'm1', channelId: 'c1', userId: '2', content: 'Hey everyone! Welcome to the Dev Hub', createdAt: new Date(Date.now() - 3600000).toISOString(), user: mockUser1 },
    { id: 'm2', channelId: 'c1', userId: '1', content: 'Thanks for setting this up! Excited to be here.', createdAt: new Date(Date.now() - 3000000).toISOString() },
    { id: 'm3', channelId: 'c1', userId: '2', content: 'Anyone working on something cool?', createdAt: new Date(Date.now() - 1800000).toISOString(), user: mockUser1 },
  ],
};

export const useGroupStore = create<GroupState>((set, get) => ({
  groups: mockGroups,
  activeGroupId: 'g1',
  activeChannelId: 'c1',
  channels: mockChannels,
  members: {},
  messages: mockMessages,
  typingUsers: {},
  openTabs: ['g1'],
  activeVoiceChannelId: null,
  voiceParticipants: {},
  isMuted: false,
  isDeafened: false,

  setActiveGroup: (groupId) => {
    set({ activeGroupId: groupId });
    if (groupId) {
      const channels = get().channels[groupId];
      const firstTextChannel = channels?.find(c => c.type === 'text');
      if (firstTextChannel) set({ activeChannelId: firstTextChannel.id });
    }
  },

  setActiveChannel: (channelId) => set({ activeChannelId: channelId }),

  addGroup: (group) => set((state) => ({ groups: [...state.groups, group] })),

  removeGroup: (groupId) => set((state) => ({
    groups: state.groups.filter(g => g.id !== groupId),
    openTabs: state.openTabs.filter(id => id !== groupId),
    activeGroupId: state.activeGroupId === groupId ? null : state.activeGroupId,
  })),

  addMessage: (channelId, message) => set((state) => ({
    messages: { ...state.messages, [channelId]: [...(state.messages[channelId] || []), message] },
  })),

  setTyping: (channelId, userId, isTyping) => set((state) => {
    const current = state.typingUsers[channelId] || [];
    const updated = isTyping
      ? [...new Set([...current, userId])]
      : current.filter(id => id !== userId);
    return { typingUsers: { ...state.typingUsers, [channelId]: updated } };
  }),

  openTab: (groupId) => set((state) => {
    if (state.openTabs.includes(groupId)) return state;
    return { openTabs: [...state.openTabs, groupId] };
  }),

  closeTab: (groupId) => set((state) => ({
    openTabs: state.openTabs.filter(id => id !== groupId),
    activeGroupId: state.activeGroupId === groupId
      ? (state.openTabs[0] !== groupId ? state.openTabs[0] : state.openTabs[1] || null)
      : state.activeGroupId,
  })),

  joinVoiceChannel: async (channelId, user) => {
    // Leave any current channel first
    const { activeVoiceChannelId } = get();
    if (activeVoiceChannelId) {
      await get().leaveVoiceChannel();
    }

    // Optimistically add self to participants
    set((state) => {
      const participant: VoiceParticipant = {
        userId: user.id,
        channelId,
        isMuted: state.isMuted,
        isDeafened: state.isDeafened,
        isSpeaking: false,
        user,
      };
      return {
        activeVoiceChannelId: channelId,
        voiceParticipants: {
          ...state.voiceParticipants,
          [channelId]: [
            ...(state.voiceParticipants[channelId] || []).filter(p => p.userId !== user.id),
            participant,
          ],
        },
      };
    });

    const engine = new VoiceEngine(channelId, user.id, {
      onParticipantJoin: (userId) => {
        set((state) => {
          const participants = state.voiceParticipants[channelId] || [];
          if (participants.some(p => p.userId === userId)) return state;
          return {
            voiceParticipants: {
              ...state.voiceParticipants,
              [channelId]: [...participants, { userId, channelId, isMuted: false, isDeafened: false, isSpeaking: false }],
            },
          };
        });
      },
      onParticipantLeave: (userId) => {
        set((state) => ({
          voiceParticipants: {
            ...state.voiceParticipants,
            [channelId]: (state.voiceParticipants[channelId] || []).filter(p => p.userId !== userId),
          },
        }));
      },
      onSpeakingChange: (userId, speaking) => {
        set((state) => ({
          voiceParticipants: {
            ...state.voiceParticipants,
            [channelId]: (state.voiceParticipants[channelId] || []).map(p =>
              p.userId === userId ? { ...p, isSpeaking: speaking } : p
            ),
          },
        }));
      },
    });

    setActiveVoiceEngine(engine);

    try {
      await engine.join();
      // Apply current mute/deafen state
      engine.setMuted(get().isMuted);
      engine.setDeafened(get().isDeafened);
    } catch (err) {
      // Roll back on failure
      setActiveVoiceEngine(null);
      set((state) => {
        const newParticipants = { ...state.voiceParticipants };
        newParticipants[channelId] = (newParticipants[channelId] || []).filter(p => p.userId !== user.id);
        return { activeVoiceChannelId: null, voiceParticipants: newParticipants };
      });
      throw err;
    }
  },

  leaveVoiceChannel: async () => {
    const engine = getActiveVoiceEngine();
    if (engine) {
      try { await engine.leave(); } catch { /* ignore */ }
      setActiveVoiceEngine(null);
    }

    set((state) => {
      const currentChannel = state.activeVoiceChannelId;
      if (!currentChannel) return state;
      return {
        activeVoiceChannelId: null,
        voiceParticipants: { ...state.voiceParticipants, [currentChannel]: [] },
      };
    });
  },

  toggleMute: () => {
    const newMuted = !get().isMuted;
    set({ isMuted: newMuted });
    getActiveVoiceEngine()?.setMuted(newMuted);
  },

  toggleDeafen: () => {
    const newDeafened = !get().isDeafened;
    set({ isDeafened: newDeafened });
    getActiveVoiceEngine()?.setDeafened(newDeafened);
  },
}));
