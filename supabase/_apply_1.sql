-- ════════════════ 20260527_invite_expiry.sql ════════════════
-- Add invite link expiry and usage-limit columns to servers table.
-- invite_expires_at: null = never expires
-- invite_max_uses:   null = unlimited
-- invite_used_count: incremented on every successful join via invite code

ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS invite_expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invite_max_uses    INT,
  ADD COLUMN IF NOT EXISTS invite_used_count  INT NOT NULL DEFAULT 0;

-- ════════════════ 20260528_messages_gin_index.sql ════════════════
-- Full-text search index on messages.content.
-- (Plain CREATE INDEX, not CONCURRENTLY, so it can run inside the migration
-- transaction / SQL editor; the table is small and superseded by the 'simple'
-- index in 20260605 anyway.)
-- Uses Russian language config — add more configs or switch to 'simple' if multilingual search is needed.
CREATE INDEX IF NOT EXISTS idx_messages_content_gin
  ON messages USING gin(to_tsvector('russian', content))
  WHERE content IS NOT NULL;

-- ════════════════ 20260602_polls.sql ════════════════
create table if not exists polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  is_multiple_choice BOOLEAN NOT NULL DEFAULT false,
  is_anonymous BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

create table if not exists poll_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID REFERENCES polls(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  position INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

create table if not exists poll_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_option_id UUID REFERENCES poll_options(id) ON DELETE CASCADE,
  poll_id UUID REFERENCES polls(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(poll_option_id, user_id)
);

create index if not exists idx_poll_options_poll_id ON poll_options(poll_id);
create index if not exists idx_poll_votes_poll_id ON poll_votes(poll_id);
create index if not exists idx_poll_votes_poll_option_id ON poll_votes(poll_option_id);

-- RLS
ALTER TABLE polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_votes ENABLE ROW LEVEL SECURITY;

-- Security review F2: polls/options/votes were world-readable (USING true), so
-- anyone could enumerate every poll and every vote across all servers. Scope
-- reads to members of the server the poll's message lives in. SECURITY DEFINER so
-- the membership lookup bypasses base-table RLS (same pattern as is_server_owner).
create or replace function public.can_view_poll(p_poll_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from polls p
    join messages m       on m.id = p.message_id
    join channels c       on c.id = m.channel_id
    join server_members sm on sm.server_id = c.server_id
    where p.id = p_poll_id and sm.user_id = auth.uid()
  );
$$;

drop policy if exists "polls_select" on polls;
CREATE POLICY "polls_select" ON polls FOR SELECT USING (public.can_view_poll(id));
drop policy if exists "polls_insert" on polls;
CREATE POLICY "polls_insert" ON polls FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM messages m
    WHERE m.id = message_id AND m.author_id = auth.uid()
  )
);

drop policy if exists "poll_options_select" on poll_options;
CREATE POLICY "poll_options_select" ON poll_options FOR SELECT USING (public.can_view_poll(poll_id));
drop policy if exists "poll_options_insert" on poll_options;
CREATE POLICY "poll_options_insert" ON poll_options FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM polls p
    JOIN messages m ON m.id = p.message_id
    WHERE p.id = poll_id AND m.author_id = auth.uid()
  )
);

drop policy if exists "poll_votes_select" on poll_votes;
CREATE POLICY "poll_votes_select" ON poll_votes FOR SELECT USING (public.can_view_poll(poll_id));
drop policy if exists "poll_votes_insert" on poll_votes;
CREATE POLICY "poll_votes_insert" ON poll_votes FOR INSERT WITH CHECK (user_id = auth.uid());
drop policy if exists "poll_votes_delete" on poll_votes;
CREATE POLICY "poll_votes_delete" ON poll_votes FOR DELETE USING (user_id = auth.uid());

-- Realtime for live vote updates
ALTER TABLE poll_votes REPLICA IDENTITY FULL;

-- ════════════════ 20260602_threads.sql ════════════════
ALTER TABLE messages ADD COLUMN IF NOT EXISTS thread_id UUID REFERENCES messages(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id) WHERE thread_id IS NOT NULL;

-- ════════════════ 20260603_announcements.sql ════════════════
alter table messages add column if not exists is_announcement boolean not null default false;

create index if not exists idx_messages_announcement on messages (channel_id) where is_announcement = true;

-- ════════════════ 20260604_profile_trigger.sql ════════════════
-- Automatically create a profiles row when a new auth user is registered.
-- Runs as security definer so it bypasses RLS on the profiles table.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  raw_username text;
  clean_username text;
begin
  raw_username := coalesce(
    new.raw_user_meta_data->>'username',
    split_part(new.email, '@', 1)
  );

  -- Normalise: lowercase, spaces→underscore, keep only [a-z0-9_], max 24 chars
  clean_username := substring(
    regexp_replace(
      regexp_replace(lower(trim(raw_username)), '\s+', '_', 'g'),
      '[^a-z0-9_]', '', 'g'
    )
    from 1 for 24
  );

  if clean_username = '' then
    clean_username := 'user';
  end if;

  insert into public.profiles (id, username, email, display_name, status_message, accent_color, created_at)
  values (
    new.id,
    clean_username,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', clean_username),
    'Online',
    '#c0392b',
    now()
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Drop and recreate so the function body is always up to date
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ════════════════ 20260604_roles.sql ════════════════
-- roles table + role_id on server_members
create table if not exists roles (
  id          uuid primary key default gen_random_uuid(),
  server_id   uuid not null references servers(id) on delete cascade,
  name        text not null,
  color       text,
  permissions integer not null default 0,
  position    integer not null default 0,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table server_members add column if not exists role_id uuid references roles(id) on delete set null;

alter table roles enable row level security;

drop policy if exists "members can read roles" on roles;
create policy "members can read roles" on roles
  for select using (
    server_id in (
      select server_id from server_members where user_id = auth.uid()
    )
  );

drop policy if exists "owner can manage roles" on roles;
create policy "owner can manage roles" on roles
  for all using (
    server_id in (select id from servers where owner_id = auth.uid())
  )
  with check (
    server_id in (select id from servers where owner_id = auth.uid())
  );

-- ════════════════ 20260605_messages_fts_simple.sql ════════════════
-- Switch FTS index from 'russian' to 'simple' (language-neutral, no stemming).
-- 'simple' matches all languages in the app (EN, RU, UK, PL, DE, ES) without
-- language-specific stemming that would drop non-Russian tokens.
--
-- The old 'russian' index is dropped first; IF NOT EXISTS makes this re-runnable.
-- (Plain CREATE/DROP INDEX, not CONCURRENTLY, so it runs inside the migration
-- transaction / SQL editor.)

DROP INDEX IF EXISTS idx_messages_content_gin;

CREATE INDEX IF NOT EXISTS idx_messages_content_fts
  ON messages USING GIN (to_tsvector('simple', content))
  WHERE content IS NOT NULL;

-- ════════════════ 20260605_roles_grants.sql ════════════════
-- Grant missing from 20260604_roles.sql — RLS was enabled but authenticated
-- role had no table-level permissions, causing 403 on all roles API calls.
grant select, insert, update, delete on public.roles to authenticated;

-- server_members.role_id column was added in the same migration; make sure
-- authenticated can still read/write the full row (inherits from existing grant
-- on server_members, but explicit is safer).
grant select, update on public.server_members to authenticated;

-- ════════════════ 20260605_roles_policy_fix.sql ════════════════
-- The "owner can manage roles" policy used a subquery into `servers`, which is
-- itself protected by RLS. When the policy evaluated `auth.uid()` inside that
-- subquery, Postgres ran it as the row-level user and the servers RLS blocked
-- it, causing a 42501 violation even for the actual server owner.
--
-- Fix: wrap the ownership check in a SECURITY DEFINER function so it always
-- executes as the defining role (bypassing RLS on `servers`).

create or replace function public.is_server_owner(p_server_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.servers
    where id = p_server_id
      and owner_id = auth.uid()
  );
$$;

-- Recreate the policy using the helper function
drop policy if exists "owner can manage roles" on public.roles;

create policy "owner can manage roles" on public.roles
  for all
  using  (public.is_server_owner(server_id))
  with check (public.is_server_owner(server_id));

-- ════════════════ 20260607_channel_delete_and_server_icon.sql ════════════════
-- delete_channel_cascade: deletes a channel and all dependent rows, bypassing
-- RLS (SECURITY DEFINER). Only the server owner can call it.
create or replace function public.delete_channel_cascade(p_channel_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
begin
  -- Resolve server_id and verify caller is the owner.
  select server_id into v_server_id from channels where id = p_channel_id;
  if not found then
    raise exception 'channel not found';
  end if;
  if not public.is_server_owner(v_server_id) then
    raise exception 'permission denied';
  end if;

  -- Delete reactions on messages in this channel.
  delete from message_reactions
  where message_id in (
    select id from messages where channel_id = p_channel_id
  );

  -- Delete messages (polls/poll_options/poll_votes cascade automatically).
  delete from messages where channel_id = p_channel_id;

  -- Delete the channel itself.
  delete from channels where id = p_channel_id;
end;
$$;

-- update_server_icon: lets the server owner update icon_url, bypassing any
-- column-level RLS that would silently ignore the write.
create or replace function public.update_server_icon(p_server_id uuid, p_icon_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_server_owner(p_server_id) then
    raise exception 'permission denied';
  end if;

  update servers set icon_url = p_icon_url where id = p_server_id;
end;
$$;

