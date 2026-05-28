import type { Server } from "./store/types";

export type ServerAction =
  | "invite_member"
  | "create_channel"
  | "delete_channel"
  | "pin_message"
  | "manage_server";

export interface PermissionContext {
  userId?: string | null;
  server?: Server | null;
}

export function can(action: ServerAction, ctx: PermissionContext): boolean {
  if (!ctx.userId || !ctx.server) return false;
  const isOwner = ctx.userId === ctx.server.ownerId;
  switch (action) {
    case "invite_member":
    case "create_channel":
    case "delete_channel":
    case "pin_message":
    case "manage_server":
      return isOwner;
  }
}
