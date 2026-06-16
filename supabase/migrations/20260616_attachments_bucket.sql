-- The app uploads every chat attachment to a Storage bucket literally named
-- "attachments" (desktop/src/hooks/useChatInput.ts → storage.from("attachments")).
-- If that bucket doesn't exist, uploads fail and messages arrive with no media —
-- which is exactly the "media doesn't load in chat" bug. This creates the bucket
-- (public, 20 MB cap to match MAX_FILE_SIZE) and the Storage RLS policies an
-- authenticated client needs to upload / read / delete.

-- ── Bucket ────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', true, 20 * 1024 * 1024)
on conflict (id) do update
  set public = true,
      file_size_limit = 20 * 1024 * 1024;

-- ── Policies on storage.objects (scoped to this bucket) ───────────────────────
-- Public read: the bucket is public (served via the CDN URL getPublicUrl()
-- returns); an explicit SELECT policy also covers listing.
drop policy if exists "attachments public read" on storage.objects;
create policy "attachments public read"
  on storage.objects for select
  using (bucket_id = 'attachments');

-- Any authenticated user may upload.
drop policy if exists "attachments authenticated upload" on storage.objects;
create policy "attachments authenticated upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments');

-- Authenticated users may remove objects (e.g. cleanup on message delete).
drop policy if exists "attachments authenticated delete" on storage.objects;
create policy "attachments authenticated delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'attachments');
