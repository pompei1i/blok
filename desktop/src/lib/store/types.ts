// Copied from root lib/store/types.ts

export type Rarity = "common" | "rare" | "epic" | "legendary";
export type CosmeticType = "nameplate" | "avatar_frame" | "banner";

/** A single equipped cosmetic, denormalized onto profiles.cosmetics by the equip RPC. */
export interface CosmeticItem {
  id: string;
  rarity: Rarity;
  payload: Record<string, any>;
}

/** Snapshot of a user's equipped cosmetics (profiles.cosmetics jsonb). */
export interface Cosmetics {
  nameplate?: CosmeticItem;
  avatar_frame?: CosmeticItem;
  banner?: CosmeticItem;
}

export interface User {
  id: string;
  username: string;
  /** Only set for the current user (from the auth session); never for other users. */
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  bio?: string;
  statusMessage?: string;
  accentColor?: string;
  pronouns?: string;
  cosmetics?: Cosmetics;
  createdAt: string;
}

export type PresenceStatus = "online" | "offline" | "afk" | "dnd";

export interface UserPresence {
  userId: string;
  status: PresenceStatus;
  lastSeen: string;
  activity?: string;
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

interface BaseMessage {
  id: string;
  authorId: string;
  replyToId?: string;
  content: string;
  isEdited: boolean;
  createdAt: string;
  updatedAt: string;
  author?: User;
  attachments?: Attachment[];
}

export interface Message extends BaseMessage {
  channelId: string;
  isPinned?: boolean;
  isAnnouncement?: boolean;
  reactions?: Reaction[];
  poll?: Poll;
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

export interface DMMessage extends BaseMessage {
  dmChannelId: string;
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
  xp: number;
  /** ISO timestamp until which the member is timed out (cannot post). */
  timeoutUntil?: string | null;
  user?: User;
}

export interface ServerBan {
  serverId: string;
  userId: string;
  reason?: string | null;
  bannedBy?: string | null;
  createdAt: string;
  user?: User;
}

export type AuditAction = "ban" | "unban" | "timeout" | "slowmode" | "kick";

export interface AuditEntry {
  id: string;
  serverId: string;
  actorId?: string | null;
  action: AuditAction;
  targetId?: string | null;
  meta: Record<string, any>;
  createdAt: string;
  actor?: User;
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
  /** Per-message cooldown in seconds; 0 = disabled. */
  slowModeSeconds: number;
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

