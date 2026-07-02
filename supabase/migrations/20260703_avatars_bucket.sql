-- Avatars move from base64-in-profiles.avatar_url to a public Storage bucket.
--
-- Why: profiles.avatar_url is embedded per-row by joined selects (MESSAGE_SELECT
-- author join, server_members member join) — a 50KB base64 avatar is duplicated
-- into EVERY message row of that author a client fetches, turning a 50-message
-- history page into multi-MB responses. With Storage the row carries a short
-- CDN URL and the image is fetched once and cached.
--
-- Client paths (desktop):
--   lib/avatar.ts uploadAvatar()          — settings upload → avatars/<uid>/<ts>.jpg
--   lib/avatar.ts migrateOwnBase64Avatar() — lazy self-migration on login for
--                                            profiles that still carry data-URLs
--
-- Versioned object keys (<uid>/<timestamp>.jpg) instead of a fixed key: the
-- bucket is public and CDN-cached, overwriting one path would serve stale images.
-- The previous object is deleted best-effort after a successful upload.

insert into storage.buckets (id, name, public, file_size_limit)
values ('avatars', 'avatars', true, 2 * 1024 * 1024)
on conflict (id) do update
  set public = true,
      file_size_limit = 2 * 1024 * 1024;

-- No SELECT policy on purpose (same reasoning as the attachments bucket, F4):
-- public buckets serve via CDN URL without RLS; a SELECT policy would only
-- enable listing/enumeration.
drop policy if exists "avatars public read" on storage.objects;

-- Users may only write inside their own <uid>/ folder.
drop policy if exists "avatars own upload" on storage.objects;
create policy "avatars own upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars own delete" on storage.objects;
create policy "avatars own delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
