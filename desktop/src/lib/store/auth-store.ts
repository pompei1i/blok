import { create } from "zustand";
import type { User } from "./types";
import { supabase } from "../supabaseClient";
import { mapProfile } from "../utils";

let _profileSelfChannel: ReturnType<typeof supabase.channel> | null = null;

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
  changePassword: (newPassword: string) => Promise<{ success: boolean; message?: string }>;
  requestPasswordReset: (email: string) => Promise<{ success: boolean; message?: string }>;
  resetPasswordWithOtp: (email: string, token: string, newPassword: string) => Promise<{ success: boolean; message?: string }>;
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

// App-admin flag lives in a locked-down table; this SECURITY DEFINER RPC only ever
// reports the *caller's* own status. Used to bypass beta limits for one account.
async function fetchIsAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_current_user_admin");
  if (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to check admin status", error);
    return false;
  }
  return data === true;
}

export function normalizeUsername(value: string): string {
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
    const isAdmin = profile ? await fetchIsAdmin() : false;
    set({
      // own email comes from the auth session, not profiles (column was dropped)
      user: profile ? { ...profile, email: user.email ?? undefined, isAdmin } : null,
      isAuthenticated: !!profile,
      isLoading: false,
      initialized: true,
    });

    if (_profileSelfChannel) await supabase.removeChannel(_profileSelfChannel);
    _profileSelfChannel = supabase
      .channel(`profile-self-${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
        (payload) => {
          const updated = mapProfile(payload.new as Record<string, any>);
          set((state) => ({
            user: state.user ? { ...state.user, ...updated } : state.user,
          }));
        },
      )
      .subscribe();
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

    // The profile row is created by a DB trigger on signup; poll briefly instead
    // of a fixed sleep so the common case (row already exists) resolves instantly.
    let profile = await fetchProfile(data.user.id);
    for (let attempt = 0; !profile && attempt < 3; attempt++) {
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      profile = await fetchProfile(data.user.id);
    }

    // Safety net: if trigger didn't create the profile, create it now
    if (!profile) {
      const meta = data.user.user_metadata ?? {};
      const fallbackUsername = meta.username ?? email.split("@")[0];

      const { error: upsertErr } = await supabase.from("profiles").upsert(
        {
          id: data.user.id,
          username: fallbackUsername,
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

    const isAdmin = await fetchIsAdmin();
    set({ user: { ...profile, email: data.user.email ?? undefined, isAdmin }, isAuthenticated: true, isLoading: false });
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
      user: profile ? { ...profile, email: data.user.email ?? undefined } : profile,
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
    const { useFriendsStore } = await import("./friends-store");
    if (currentUser) {
      await useFriendsStore.getState().updatePresence(currentUser.id, "offline");
    }
    // Reset friends/presence so re-login as a different account doesn't inherit
    // a stale relationship list or a stale presence-tracking set.
    useFriendsStore.setState({
      friends: [], pendingRequests: [], outgoingRequests: [],
      presence: {}, presenceLastSeen: {}, activity: {},
      presenceTrackedIds: new Set<string>(),
    });
    const { useServerStore } = await import("./server-store");
    await useServerStore.getState().leaveVoiceChannel();
    const { clearDataChannels } = await import("./slices/_shared");
    await clearDataChannels();
    const { useEconomyStore } = await import("./economy-store");
    useEconomyStore.getState().cleanup();
    if (_profileSelfChannel) {
      await supabase.removeChannel(_profileSelfChannel);
      _profileSelfChannel = null;
    }
    await supabase.auth.signOut();
    set({ user: null, isAuthenticated: false, error: null });
  },

  updateUser: async (updates) => {
    const current = get().user;
    if (!current) return;

    const updatedUser = { ...current, ...updates } as User;

    // Optimistic update — UI reflects changes instantly
    set({ user: updatedUser });
    const { useServerStore } = await import("./server-store");
    useServerStore.getState().patchUser(updatedUser);
    const { useFriendsStore } = await import("./friends-store");
    useFriendsStore.getState().patchUser(updatedUser);

    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: updates.displayName,
        username: updates.username,
        bio: updates.bio,
        status_message: updates.statusMessage,
        accent_color: updates.accentColor,
        avatar_url: updates.avatarUrl,
        pronouns: updates.pronouns,
      })
      .eq("id", current.id);

    if (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to update profile", error);
      set({ user: current, error: "Failed to update profile" });
      useServerStore.getState().patchUser(current);
      useFriendsStore.getState().patchUser(current);
    }
  },

  changePassword: async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { success: false, message: error.message };
    return { success: true };
  },

  requestPasswordReset: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    if (error) return { success: false, message: error.message };
    return { success: true };
  },

  resetPasswordWithOtp: async (email, token, newPassword) => {
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type: "recovery",
    });
    if (verifyError) return { success: false, message: verifyError.message };
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) return { success: false, message: updateError.message };
    // verifyOtp(recovery) creates a session; sign out so the user logs in fresh
    await supabase.auth.signOut();
    return { success: true };
  },

  clearError: () => set({ error: null }),
}));

