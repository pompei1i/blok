import type { Server } from "./store/types";

/**
 * All actions that require a permission check.
 * Today every action is owner-only; when roles land, add member/role logic
 * inside `can()` rather than scattering checks across components.
 */
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
  // All actions are owner-only until the role system is implemented.
  // Add member / role checks here; do NOT add them in individual components.
  switch (action) {
    case "invite_member":
    case "create_channel":
    case "delete_channel":
    case "pin_message":
    case "manage_server":
      return isOwner;
  }
}
