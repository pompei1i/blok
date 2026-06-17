-- ════════════════ 20260615_quest_triggers_catchup.sql ════════════════
-- Catch-up: re-assert the daily-quest increment triggers.
-- The reactions quest never advances on this DB even though message_reactions
-- INSERTs succeed → the AFTER-INSERT trigger is missing (migrations were applied
-- partially; cf. has_server_perm also absent). Re-creating both triggers is
-- idempotent (create or replace + drop trigger if exists), so it's safe to run
-- regardless of current state and fixes the reactions counter.

create or replace function public.increment_quest_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
begin
  select server_id into v_server_id from channels where id = NEW.channel_id;
  if v_server_id is null then return NEW; end if;

  insert into daily_quest_progress (user_id, server_id, quest_type, count)
  values (NEW.author_id, v_server_id, 'messages_sent', 1)
  on conflict (user_id, server_id, quest_type, date)
  do update set count = daily_quest_progress.count + 1;

  return NEW;
end;
$$;

drop trigger if exists trg_quest_message on messages;
create trigger trg_quest_message
after insert on messages
for each row execute function public.increment_quest_on_message();

create or replace function public.increment_quest_on_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
begin
  select c.server_id into v_server_id
  from messages m
  join channels c on c.id = m.channel_id
  where m.id = NEW.message_id;

  if v_server_id is null then return NEW; end if;

  insert into daily_quest_progress (user_id, server_id, quest_type, count)
  values (NEW.user_id, v_server_id, 'reactions_added', 1)
  on conflict (user_id, server_id, quest_type, date)
  do update set count = daily_quest_progress.count + 1;

  return NEW;
end;
$$;

drop trigger if exists trg_quest_reaction on message_reactions;
create trigger trg_quest_reaction
after insert on message_reactions
for each row execute function public.increment_quest_on_reaction();

-- ════════════════ 20260615_roles_realtime.sql ════════════════
-- Realtime publication catch-up.
--
-- Several client subscriptions silently receive nothing unless their table is in
-- the supabase_realtime publication. Two user-visible bugs trace back to this:
--   • A freshly granted role's permission bits don't reach the member's client
--     until a full re-login (roles never streamed).            → add `roles`
--   • A peer flips to "offline" ~90s after load even while active, because their
--     heartbeat online_at updates never arrive.                → add `user_presence`
-- `server_members` is included too so role-assignment / xp changes always stream.
-- All adds are guarded → idempotent and safe if already published.
do $$
declare
  t text;
begin
  foreach t in array array['roles', 'user_presence', 'server_members'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

-- ════════════════ 20260616_attachments_bucket.sql ════════════════
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

-- ════════════════ 20260616_bait_rate_limit.sql ════════════════
-- Per-user rate limiting for the b.ai.t proxy (the Edge Function calls this with
-- the caller's JWT, so auth.uid() is the requesting user). Replaces the old
-- client-side-only limiter, which was trivially bypassable now that the Anthropic
-- key lives server-side.

create table if not exists bait_requests (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists idx_bait_requests_user_time on bait_requests(user_id, created_at desc);

alter table bait_requests enable row level security;
-- No client policies — only the SECURITY DEFINER RPC below touches this table.

-- Sliding-window check: prune the caller's old rows, count what's left, and admit
-- the request (inserting a marker) only if under the limit. Returns true=allowed.
create or replace function public.bait_rate_check(p_max integer, p_window_secs integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    return false;
  end if;

  delete from bait_requests
  where user_id = v_uid and created_at < now() - make_interval(secs => p_window_secs);

  select count(*) into v_count from bait_requests where user_id = v_uid;
  if v_count >= p_max then
    return false;
  end if;

  insert into bait_requests (user_id) values (v_uid);
  return true;
end;
$$;

