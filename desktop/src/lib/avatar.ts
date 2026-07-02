import { supabase } from "./supabaseClient";

// Avatars live in the public "avatars" Storage bucket (migration
// 20260703_avatars_bucket). profiles.avatar_url used to hold the image itself
// as a base64 data-URL — which joined selects then duplicated into every
// message/member row other clients fetched (multi-MB history pages).

/**
 * Upload a (client-compressed) avatar image and return its public URL, or null
 * on failure. Versioned path (`<uid>/<timestamp>.jpg`) — the bucket is public
 * and CDN-cached, so overwriting a fixed key would keep serving the stale
 * image. The previous bucket object (if any) is deleted best-effort.
 */
export async function uploadAvatar(
  userId: string,
  dataUrl: string,
  previousUrl?: string | null,
): Promise<string | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const path = `${userId}/${Date.now()}.jpg`;
    const { error } = await supabase.storage
      .from("avatars")
      .upload(path, blob, { upsert: false, contentType: blob.type || "image/jpeg" });
    if (error) {
      console.error("Avatar upload failed", error);
      return null;
    }
    const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);

    // Best-effort cleanup of the previous versioned object (skip data-URLs and
    // anything not in our bucket).
    const prevPath = previousUrl && !previousUrl.startsWith("data:")
      ? previousUrl.split("/avatars/")[1]
      : undefined;
    if (prevPath) void supabase.storage.from("avatars").remove([decodeURIComponent(prevPath)]);

    return publicUrl;
  } catch (e) {
    console.error("Avatar upload failed", e);
    return null;
  }
}

/**
 * Lazy self-migration for profiles created before the Storage move: if own
 * avatar_url is still a base64 data-URL, upload it to the bucket and point the
 * profile at the public URL. Fire-and-forget on login/init — the profile-self
 * realtime subscription patches the in-memory user when the row updates.
 * No-ops (and retries next login) if the bucket migration isn't applied yet.
 */
export async function migrateOwnBase64Avatar(userId: string, avatarUrl?: string): Promise<void> {
  if (!avatarUrl?.startsWith("data:")) return;
  const publicUrl = await uploadAvatar(userId, avatarUrl, null);
  if (!publicUrl) return;
  const { error } = await supabase.from("profiles").update({ avatar_url: publicUrl }).eq("id", userId);
  if (error) console.error("Avatar base64→Storage migration failed", error);
}
