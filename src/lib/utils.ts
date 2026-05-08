import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { User } from "./store/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function mapProfile(p: Record<string, any>): User {
  return {
    id: p.id,
    username: p.username,
    email: p.email,
    displayName: p.display_name ?? undefined,
    avatarUrl: p.avatar_url ?? undefined,
    bio: p.bio ?? undefined,
    statusMessage: p.status_message ?? undefined,
    accentColor: p.accent_color ?? undefined,
    createdAt: p.created_at,
  };
}

