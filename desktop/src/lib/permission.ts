import type { Server, Role } from "./store/types";

export const Perm = {
  INVITE_MEMBER:      1 << 0,  //    1
  CREATE_CHANNEL:     1 << 1,  //    2
  DELETE_CHANNEL:     1 << 2,  //    4
  PIN_MESSAGE:        1 << 3,  //    8
  MANAGE_SERVER:      1 << 4,  //   16
  MANAGE_ROLES:       1 << 5,  //   32
  KICK_MEMBER:        1 << 6,  //   64
  RENAME_CHANNEL:     1 << 7,  //  128
  RENAME_SERVER:      1 << 8,  //  256
  MANAGE_SERVER_ICON: 1 << 9,  //  512
  BAN_MEMBER:         1 << 10, // 1024
  MODERATE_MEMBERS:   1 << 11, // 2048  — timeout members
  MANAGE_CHANNELS:    1 << 12, // 4096  — slowmode / topic; bypasses slowmode
} as const;

export type ServerAction =
  | "invite_member"
  | "create_channel"
  | "delete_channel"
  | "pin_message"
  | "manage_server"
  | "manage_roles"
  | "kick_member"
  | "rename_channel"
  | "rename_server"
  | "manage_server_icon"
  | "ban_member"
  | "moderate_members"
  | "manage_channels";

export interface PermissionContext {
  userId?: string | null;
  server?: Server | null;
  /** The active member's role. Null means no role assigned. Owner bypasses this. */
  role?: Role | null;
}

const ACTION_FLAG: Record<ServerAction, number> = {
  invite_member:      Perm.INVITE_MEMBER,
  create_channel:     Perm.CREATE_CHANNEL,
  delete_channel:     Perm.DELETE_CHANNEL,
  pin_message:        Perm.PIN_MESSAGE,
  manage_server:      Perm.MANAGE_SERVER,
  manage_roles:       Perm.MANAGE_ROLES,
  kick_member:        Perm.KICK_MEMBER,
  rename_channel:     Perm.RENAME_CHANNEL,
  rename_server:      Perm.RENAME_SERVER,
  manage_server_icon: Perm.MANAGE_SERVER_ICON,
  ban_member:         Perm.BAN_MEMBER,
  moderate_members:   Perm.MODERATE_MEMBERS,
  manage_channels:    Perm.MANAGE_CHANNELS,
};

export function can(action: ServerAction, ctx: PermissionContext): boolean {
  if (!ctx.userId || !ctx.server) return false;
  if (ctx.userId === ctx.server.ownerId) return true;
  if (!ctx.role) return false;
  return !!(ctx.role.permissions & ACTION_FLAG[action]);
}

// ── per-channel access ────────────────────────────────────────────────────────

/**
 * Channel-scoped bits, a separate namespace from the server-wide `Perm` above.
 * Must match the values documented in the channel_permissions migration.
 */
export const ChannelPerm = {
  VIEW:    1 << 0, // see the channel and read its history
  SEND:    1 << 1, // post in a text channel
  CONNECT: 1 << 2, // join a voice channel
} as const;

export type ChannelAccess = "view" | "send" | "connect";

const CHANNEL_FLAG: Record<ChannelAccess, number> = {
  view:    ChannelPerm.VIEW,
  send:    ChannelPerm.SEND,
  connect: ChannelPerm.CONNECT,
};

/** One (channel, role) override. `roleId === null` is the @everyone baseline. */
export interface ChannelOverride {
  /**
   * Row id. Only the store needs it — a realtime DELETE payload carries the
   * primary key and nothing else, so there is no other way to find the row to
   * drop. Resolution ignores it.
   */
  id?: string;
  channelId: string;
  roleId: string | null;
  allow: number;
  deny: number;
}

export interface ChannelPermissionContext extends PermissionContext {
  /** Overrides for the channel in question; other channels are ignored. */
  overrides?: ChannelOverride[];
}

/**
 * Mirrors `public.channel_perm_allowed` in SQL — the database stays the
 * authority, this is what lets the UI grey out a channel before the round trip.
 * Any divergence shows up as a control that looks usable and then fails, so the
 * two resolution orders are kept deliberately identical:
 *
 *   default allow → @everyone override → the member's own role override.
 *
 * The owner and MANAGE_SERVER bypass overrides entirely, so a channel can never
 * be locked away from everyone who could unlock it.
 */
export function canInChannel(
  access: ChannelAccess,
  channelId: string,
  ctx: ChannelPermissionContext,
): boolean {
  if (!ctx.userId || !ctx.server) return false;
  if (ctx.userId === ctx.server.ownerId) return true;
  if (ctx.role && ctx.role.permissions & Perm.MANAGE_SERVER) return true;

  const bit = CHANNEL_FLAG[access];
  const forChannel = (ctx.overrides ?? []).filter((o) => o.channelId === channelId);
  let allowed = true;

  const apply = (o: ChannelOverride | undefined) => {
    if (!o) return;
    if (o.deny & bit) allowed = false;
    if (o.allow & bit) allowed = true;
  };

  apply(forChannel.find((o) => o.roleId === null));
  if (ctx.role) apply(forChannel.find((o) => o.roleId === ctx.role!.id));

  return allowed;
}
