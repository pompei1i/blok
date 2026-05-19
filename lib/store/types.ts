// User types
export interface User {
  id: string;
  username: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  bio?: string;
  statusMessage?: string;
  accentColor?: string;
  pronouns?: string;
  createdAt: string;
}

// Presence types
export type PresenceStatus = 'online' | 'offline' | 'afk';

export interface UserPresence {
  userId: string;
  status: PresenceStatus;
  lastSeen: string;
}

// Friend types
export type FriendshipStatus = 'pending' | 'accepted' | 'blocked';

export interface Friendship {
  id: string;
  userId: string;
  friendId: string;
  status: FriendshipStatus;
  createdAt: string;
  friend?: User;
}

// DM types
export interface DirectMessage {
  id: string;
  fromUserId: string;
  toUserId: string;
  content: string;
  createdAt: string;
  editedAt?: string;
}

export interface DMWindowState {
  userId: string;
  position: { x: number; y: number };
  minimized: boolean;
  messages: DirectMessage[];
  unreadCount: number;
}

// Group types
export interface Group {
  id: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  ownerId: string;
  createdAt: string;
}

export interface Channel {
  id: string;
  groupId: string;
  name: string;
  type: 'text' | 'voice';
  position: number;
}

export type MemberRole = 'owner' | 'admin' | 'member';

export interface GroupMember {
  id: string;
  groupId: string;
  userId: string;
  role: MemberRole;
  joinedAt: string;
  user?: User;
}

// Message types
export interface Message {
  id: string;
  channelId: string;
  userId: string;
  content: string;
  createdAt: string;
  editedAt?: string;
  user?: User;
}

// Voice types
export interface VoiceParticipant {
  userId: string;
  channelId: string;
  isMuted: boolean;
  isDeafened: boolean;
  isSpeaking: boolean;
  user?: User;
}
