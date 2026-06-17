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
-- No SELECT policy on purpose (security review F4): the bucket is public, so
-- files are served via the CDN URL getPublicUrl() returns without RLS. A broad
-- SELECT policy would additionally let any client *list/enumerate* every uploaded
-- file, so we drop it instead.
drop policy if exists "attachments public read" on storage.objects;

-- Any authenticated user may upload.
drop policy if exists "attachments authenticated upload" on storage.objects;
create policy "attachments authenticated upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments');

-- Only the uploader may delete their own attachment (security review F3 — was
-- any authenticated user, which let anyone delete anyone else's files).
drop policy if exists "attachments authenticated delete" on storage.objects;
create policy "attachments authenticated delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and owner = auth.uid());
