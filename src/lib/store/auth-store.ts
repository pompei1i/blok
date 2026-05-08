import { create } from "zustand";
import type { User } from "./types";
import { supabase } from "../supabaseClient";
import { mapProfile } from "../utils";

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  initialized: boolean;
  init: () => Promise<void>;
  login: (
    email: string,
    password: string,
  ) => Promise<{ success: boolean; message?: string }>;
  register: (
    username: string,
    email: string,
    password: string,
  ) => Promise<{ success: boolean; message?: string }>;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<User>) => Promise<void>;
  clearError: () => void;
}

async function fetchProfile(userId: string): Promise<User | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to fetch profile", error);
    return null;
  }

  return data ? mapProfile(data) : null;
}

function normalizeUsername(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 24);
  return cleaned || "user";
}

async function usernameExists(username: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("username", username);

  if (error) {
    // eslint-disable-next-line no-console
    console.error("Username check failed", error);
    return false;
  }

  return (count ?? 0) > 0;
}

async function resolveAvailableUsername(base: string): Promise<string> {
  const normalizedBase = normalizeUsername(base);

  if (!(await usernameExists(normalizedBase))) {
    return normalizedBase;
  }

  for (let i = 1; i <= 9999; i += 1) {
    const candidate = `${normalizedBase}_${i}`;
    if (!(await usernameExists(candidate))) {
      return candidate;
    }
  }

  return `${normalizedBase}_${Date.now().toString().slice(-6)}`;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    set({ isLoading: true });

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      set({ user: null, isAuthenticated: false, isLoading: false, initialized: true });
      return;
    }

    const profile = await fetchProfile(user.id);
    set({
      user: profile,
      isAuthenticated: !!profile,
      isLoading: false,
      initialized: true,
    });
  },

  login: async (email, password) => {
    set({ isLoading: true, error: null });

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      set({
        isLoading: false,
        error: error?.message ?? "Invalid email or password",
      });
      return {
        success: false,
        message: error?.message ?? "Invalid email or password",
      };
    }

    // Small delay to let the DB trigger fire and commit
    await new Promise((r) => setTimeout(r, 500));

    let profile = await fetchProfile(data.user.id);

    // Safety net: if trigger didn't create the profile, create it now
    if (!profile) {
      const meta = data.user.user_metadata ?? {};
      const fallbackUsername = meta.username ?? email.split("@")[0];

      const { error: upsertErr } = await supabase.from("profiles").upsert(
        {
          id: data.user.id,
          username: fallbackUsername,
          email,
          display_name: meta.display_name ?? fallbackUsername,
          status_message: "Online",
          accent_color: "#c0392b",
        },
        { onConflict: "id" },
      );

      if (upsertErr) {
        // eslint-disable-next-line no-console
        console.error("Login profile upsert failed:", upsertErr);
      }

      profile = await fetchProfile(data.user.id);
    }

    if (!profile) {
      // eslint-disable-next-line no-console
      console.error(
        "Profile still not found after upsert attempt for user:",
        data.user.id,
      );
      set({
        isLoading: false,
        error: "Profile not found. Please contact support.",
      });
      return { success: false, message: "Profile not found" };
    }

    set({ user: profile, isAuthenticated: true, isLoading: false });
    return { success: true };
  },

  register: async (username, email, password) => {
    set({ isLoading: true, error: null });
    const requestedUsername = normalizeUsername(username);
    const resolvedUsername = await resolveAvailableUsername(requestedUsername);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: resolvedUsername,
          display_name: resolvedUsername,
        },
      },
    });

    if (error || !data.user) {
      set({
        isLoading: false,
        error: error?.message ?? "Registration failed",
      });
      return {
        success: false,
        message: error?.message ?? "Registration failed",
      };
    }

    const { error: profileError } = await supabase.from("profiles").upsert({
      id: data.user.id,
      username: resolvedUsername,
      email,
      display_name: resolvedUsername,
      status_message: "Online",
      accent_color: "#c0392b",
    });

    if (profileError) {
      // eslint-disable-next-line no-console
      console.error("Failed to create profile", profileError);
    }

    const profile = await fetchProfile(data.user.id);

    set({
      user: profile,
      isAuthenticated: !!profile,
      isLoading: false,
    });

    return {
      success: true,
      message:
        resolvedUsername === requestedUsername
          ? "Registration successful"
          : `Registration successful. Username adjusted to @${resolvedUsername}`,
    };
  },

  logout: async () => {
    const currentUser = get().user;
    if (currentUser) {
      const { useFriendsStore } = await import("./friends-store");
      await useFriendsStore.getState().updatePresence(currentUser.id, "offline");
    }
    await supabase.auth.signOut();
    set({ user: null, isAuthenticated: false, error: null });
  },

  updateUser: async (updates) => {
    const current = get().user;
    if (!current) return;

    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: updates.displayName,
        username: updates.username,
        email: updates.email,
        bio: updates.bio,
        status_message: updates.statusMessage,
        accent_color: updates.accentColor,
        avatar_url: updates.avatarUrl,
      })
      .eq("id", current.id);

    if (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to update profile", error);
      set({ error: "Failed to update profile" });
      return;
    }

    set({ user: { ...current, ...updates } as User });
  },

  clearError: () => set({ error: null }),
}));

