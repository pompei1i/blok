// Copied from root lib/store/types.ts

export interface User {
  id: string;
  username: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
  statusMessage?: string;
  accentColor?: string;
  pronouns?: string;
  createdAt: string;
}

export type PresenceStatus = "online" | "offline" | "afk" | "dnd";

export interface UserPresence {
  userId: string;
  status: PresenceStatus;
  lastSeen: string;
}

export type RelationshipStatus = "pending" | "accepted" | "blocked";

export interface UserRelationship {
  id: string;
  requesterId: string;
  targetId: string;
  status: RelationshipStatus;
  createdAt: string;
  // Included in joined queries
  targetUser?: User;
  requesterUser?: User;
}

export interface Attachment {
  id: string;
  messageId: string;
  url: string;
  filename: string;
  mediaType?: string;
  sizeBytes?: number;
  createdAt: string;
}

export interface Reaction {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: string;
}

export interface PollOption {
  id: string;
  pollId: string;
  text: string;
  position: number;
  voteCount: number;
  voters: string[];
}

export interface Poll {
  id: string;
  messageId: string;
  question: string;
  isMultipleChoice: boolean;
  isAnonymous: boolean;
  options: PollOption[];
  myVotes: string[];
  totalVotes: number;
}

export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  replyToId?: string;
  content: string;
  isEdited: boolean;
  isPinned?: boolean;
  createdAt: string;
  updatedAt: string;
  poll?: Poll;
  // Included in joined queries
  author?: User;
  attachments?: Attachment[];
  reactions?: Reaction[];
}

export interface DMChannel {
  id: string;
  type: "dm" | "group";
  name?: string;
  createdAt: string;
}

export interface DMParticipant {
  dmChannelId: string;
  userId: string;
  joinedAt: string;
  user?: User;
}

export interface DMMessage {
  id: string;
  dmChannelId: string;
  authorId: string;
  replyToId?: string;
  content: string;
  isEdited: boolean;
  createdAt: string;
  updatedAt: string;
  author?: User;
  attachments?: Attachment[];
}

// Front-end only state for desktop floating windows
export interface DMWindowState {
  userId: string;
  position: { x: number; y: number };
  minimized: boolean;
  messages: DMMessage[];
  unreadCount: number;
}

export interface Server {
  id: string;
  ownerId: string;
  name: string;
  iconUrl?: string;
  description?: string;
  inviteCode?: string;
  inviteExpiresAt?: string | null;
  inviteMaxUses?: number | null;
  inviteUsedCount?: number;
  createdAt: string;
}

export interface Category {
  id: string;
  serverId: string;
  name: string;
  position: number;
  createdAt: string;
}

export interface Role {
  id: string;
  serverId: string;
  name: string;
  color?: string;
  permissions: number;
  position: number;
  isDefault: boolean;
  createdAt: string;
}

export interface ServerMember {
  id: string;
  serverId: string;
  userId: string;
  roleId?: string;
  nickname?: string;
  joinedAt: string;
  user?: User;
}

export interface Channel {
  id: string;
  serverId: string;
  categoryId?: string;
  name: string;
  type: "text" | "voice";
  topic?: string;
  position: number;
  isPrivate: boolean;
  createdAt: string;
}

export interface VoiceParticipant {
  userId: string;
  channelId: string;
  isMuted: boolean;
  isDeafened: boolean;
  isScreenSharing: boolean;
  isSpeaking: boolean;
  user?: User;
}

