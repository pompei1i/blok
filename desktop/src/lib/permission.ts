import type { Server, Role } from "./store/types";

export const Perm = {
  INVITE_MEMBER:  1 << 0,  //  1
  CREATE_CHANNEL: 1 << 1,  //  2
  DELETE_CHANNEL: 1 << 2,  //  4
  PIN_MESSAGE:    1 << 3,  //  8
  MANAGE_SERVER:  1 << 4,  // 16
  MANAGE_ROLES:   1 << 5,  // 32
  KICK_MEMBER:    1 << 6,  // 64
} as const;

export type ServerAction =
  | "invite_member"
  | "create_channel"
  | "delete_channel"
  | "pin_message"
  | "manage_server"
  | "manage_roles"
  | "kick_member";

export interface PermissionContext {
  userId?: string | null;
  server?: Server | null;
  /** The active member's role. Null means no role assigned. Owner bypasses this. */
  role?: Role | null;
}

const ACTION_FLAG: Record<ServerAction, number> = {
  invite_member:  Perm.INVITE_MEMBER,
  create_channel: Perm.CREATE_CHANNEL,
  delete_channel: Perm.DELETE_CHANNEL,
  pin_message:    Perm.PIN_MESSAGE,
  manage_server:  Perm.MANAGE_SERVER,
  manage_roles:   Perm.MANAGE_ROLES,
  kick_member:    Perm.KICK_MEMBER,
};

export function can(action: ServerAction, ctx: PermissionContext): boolean {
  if (!ctx.userId || !ctx.server) return false;
  if (ctx.userId === ctx.server.ownerId) return true;
  if (!ctx.role) return false;
  return !!(ctx.role.permissions & ACTION_FLAG[action]);
}
