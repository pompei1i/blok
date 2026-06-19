-- F1 RLS hardening — close base-table leaks found in the pg_policies review.
--
-- Root cause: early "Enable read = true" policies were left in place when later,
-- properly-scoped policies were added. RLS policies are OR'd, so the permissive
-- `true` policies win and defeat the scoped ones. Plus the DM area had two
-- self-referential bugs (`p.dm_channel_id = p.dm_channel_id`, always true) and an
-- open `dm_participants` insert that together broke DM privacy entirely.
--
-- Findings fixed here:
--   profiles       — readable by anon (public) + multiple `true` policies → scrapeable
--   messages       — any authenticated user could read messages in servers they never joined
--   channels/categories/server_members — same cross-server leak via leftover `true` SELECT
--   dm_messages    — buggy policy let anyone in *any* DM read/insert into *all* DMs
--   dm_channels    — `true` INSERT let you forge channels between other users
--   dm_participants— open INSERT let you add yourself to someone else's DM, then read it
--
-- Idempotent: safe to replay (DROP ... IF EXISTS before each CREATE).

begin;

-- ── membership helpers (SECURITY DEFINER → bypass RLS, no recursion) ──────────
create or replace function public.is_server_member(p_server uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from server_members
    where server_id = p_server and user_id = auth.uid()
  );
$$;

create or replace function public.is_channel_member(p_channel uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from channels c
    join server_members sm on sm.server_id = c.server_id
    where c.id = p_channel and sm.user_id = auth.uid()
  );
$$;

grant execute on function public.is_server_member(uuid)  to authenticated, anon;
grant execute on function public.is_channel_member(uuid) to authenticated, anon;

-- ── profiles: close anon scraping, collapse to one authenticated read ─────────
drop policy if exists "Authenticated users can read profiles"     on public.profiles;
drop policy if exists "Enable read access for authenticated users" on public.profiles;
drop policy if exists "Profiles are publicly readable"            on public.profiles;
drop policy if exists "anyone can read profiles"                  on public.profiles;
drop policy if exists "Users can read own profile"                on public.profiles;
drop policy if exists "profiles_select_authenticated"             on public.profiles;
create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated using (true);
-- (write policies left untouched: "user can upsert own profile", inserts/updates
--  are already scoped to id = auth.uid().)

-- ── messages: only members of the channel's server can read ───────────────────
drop policy if exists "Enable read for messages" on public.messages;
drop policy if exists "messages_select_member"   on public.messages;
create policy "messages_select_member" on public.messages
  for select to authenticated using (public.is_channel_member(channel_id));
-- (INSERT "Enable insert for messages" already enforces author_id = auth.uid().)

-- ── channels: drop the leftover `true` read; scoped policy already exists ──────
drop policy if exists "Enable read access for authenticated users" on public.channels;

-- ── categories: scope read to server membership ───────────────────────────────
drop policy if exists "Enable read access for authenticated users" on public.categories;
drop policy if exists "categories_select_member"                   on public.categories;
create policy "categories_select_member" on public.categories
  for select to authenticated using (public.is_server_member(server_id));

-- ── server_members: scope read to fellow members (no cross-server roster leak) ─
drop policy if exists "Enable read access for authenticated users" on public.server_members;
drop policy if exists "server_members_select_member"               on public.server_members;
create policy "server_members_select_member" on public.server_members
  for select to authenticated using (public.is_server_member(server_id));

-- ── dm_channels: keep participant-scoped policies, drop the open/duplicate ones ─
drop policy if exists "dm_channels_insert_authenticated_simple" on public.dm_channels;
drop policy if exists "dm_channels_select_participant"          on public.dm_channels;
drop policy if exists "participant can read dm channel"         on public.dm_channels;
drop policy if exists "user can create dm channel as participant" on public.dm_channels;
-- remaining: "Users can view their dm channels" (SELECT, user_a/user_b scoped),
--            "Users can create dm channels"    (INSERT, user_a/user_b scoped)

-- ── dm_messages: drop the buggy/unscoped policies, add a correct INSERT ────────
drop policy if exists "dm_messages_select_participant"          on public.dm_messages;
drop policy if exists "dm_messages_insert_participant_author"   on public.dm_messages;
drop policy if exists "participant can insert own dm message"   on public.dm_messages;
drop policy if exists "dm_messages_insert_participant"          on public.dm_messages;
create policy "dm_messages_insert_participant" on public.dm_messages
  for insert to authenticated with check (
    author_id = auth.uid()
    and exists (
      select 1 from dm_channels dc
      where dc.id = dm_messages.dm_channel_id
        and (dc.user_a_id = auth.uid() or dc.user_b_id = auth.uid())
    )
  );
-- remaining: "participants can read dm messages" (SELECT, correctly scoped via
--            dm_channels), "owner can delete own dm message" (DELETE).

-- ── dm_participants: remove the open INSERT (DM-takeover hole) ─────────────────
drop policy if exists "dm_participants_insert_authenticated" on public.dm_participants;
-- (kept: "dm_participants_select_own". The app uses the user_a/user_b model, so
--  this table takes no client inserts.)

commit;
