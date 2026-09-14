-- Per-channel access overrides: view / send / connect, per role.
--
-- Until now access was all-or-nothing per server: any member could read, write
-- and join anything. This adds Discord-style per-channel overrides so an
-- announcements channel can be readable by everyone but writable only by staff,
-- and a voice channel can be restricted to particular roles.
--
-- Model. One row per (channel, role), plus a role_id IS NULL row meaning
-- @everyone. Resolution starts from "allowed", applies the @everyone row, then
-- the member's own role row, which wins. Members hold a single role
-- (server_members.role_id), so there is no role hierarchy to fold together.
--
-- Enforcement. The RLS policies below are added AS RESTRICTIVE, so they are
-- AND-ed with the existing permissive policies rather than replacing them. That
-- matters because the original message INSERT policy predates this repo's
-- migrations and only exists in the live database — a restrictive policy adds a
-- condition to it without needing to know or rewrite it.
--
-- Voice has no table to protect (participants live in Realtime presence, not the
-- database), so CONNECT is enforced client-side and backed by the channel row
-- itself disappearing for members who cannot view it.

-- Channel permission bits — must match desktop/src/lib/permission.ts ChannelPerm:
--   VIEW    = 1
--   SEND    = 2
--   CONNECT = 4

create table if not exists public.channel_permissions (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  -- NULL = the @everyone baseline for this channel.
  role_id    uuid references public.roles(id) on delete cascade,
  allow      integer not null default 0,
  deny       integer not null default 0,
  updated_at timestamptz not null default now()
);

-- One row per (channel, role). NULLs are not equal to each other in a plain
-- unique index, so the @everyone row is keyed through a sentinel instead.
create unique index if not exists channel_permissions_channel_role_key
  on public.channel_permissions (
    channel_id,
    coalesce(role_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists channel_permissions_channel_idx
  on public.channel_permissions (channel_id);

alter table public.channel_permissions enable row level security;
grant select on public.channel_permissions to authenticated;

-- Members read the overrides for their own servers: the client needs them to
-- grey out a channel it cannot post in. Writes go through the RPC below only.
drop policy if exists "channel_permissions_select_member" on public.channel_permissions;
create policy "channel_permissions_select_member" on public.channel_permissions
  for select to authenticated using (
    exists (
      select 1
        from public.channels c
        join public.server_members sm on sm.server_id = c.server_id
       where c.id = channel_permissions.channel_id
         and sm.user_id = auth.uid()
    )
  );

-- ── resolution ────────────────────────────────────────────────────────────────

-- True when the current user holds `p_bit` on this channel.
--
-- The server owner and anyone with MANAGE_SERVER bypass overrides outright, so a
-- channel can never be configured into a state where nobody can fix it.
create or replace function public.channel_perm_allowed(p_channel_id uuid, p_bit int)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_server_id  uuid;
  v_is_member  boolean;
  v_role_id    uuid;
  v_role_perms int;
  v_allow      int;
  v_deny       int;
  v_result     boolean := true;
begin
  if v_uid is null then
    return false;
  end if;

  select server_id into v_server_id from channels where id = p_channel_id;
  if v_server_id is null then
    return false;
  end if;

  if exists (select 1 from servers where id = v_server_id and owner_id = v_uid) then
    return true;
  end if;

  select true, sm.role_id
    into v_is_member, v_role_id
    from server_members sm
   where sm.server_id = v_server_id
     and sm.user_id = v_uid;
  if not coalesce(v_is_member, false) then
    return false;
  end if;

  if v_role_id is not null then
    select permissions into v_role_perms from roles where id = v_role_id;
    -- MANAGE_SERVER (1 << 4)
    if (coalesce(v_role_perms, 0) & 16) > 0 then
      return true;
    end if;
  end if;

  -- @everyone baseline.
  select allow, deny into v_allow, v_deny
    from channel_permissions
   where channel_id = p_channel_id and role_id is null;
  if (coalesce(v_deny, 0)  & p_bit) > 0 then v_result := false; end if;
  if (coalesce(v_allow, 0) & p_bit) > 0 then v_result := true;  end if;

  -- The member's own role wins over the baseline.
  if v_role_id is not null then
    v_allow := null;
    v_deny  := null;
    select allow, deny into v_allow, v_deny
      from channel_permissions
     where channel_id = p_channel_id and role_id = v_role_id;
    if (coalesce(v_deny, 0)  & p_bit) > 0 then v_result := false; end if;
    if (coalesce(v_allow, 0) & p_bit) > 0 then v_result := true;  end if;
  end if;

  return v_result;
end;
$$;

grant execute on function public.channel_perm_allowed(uuid, int) to authenticated;

-- ── enforcement ───────────────────────────────────────────────────────────────

-- RESTRICTIVE: AND-ed with whatever permissive policies already exist.
drop policy if exists "channels_view_requires_channel_perm" on public.channels;
create policy "channels_view_requires_channel_perm" on public.channels
  as restrictive for select to authenticated
  using (public.channel_perm_allowed(id, 1));

drop policy if exists "messages_read_requires_channel_perm" on public.messages;
create policy "messages_read_requires_channel_perm" on public.messages
  as restrictive for select to authenticated
  using (public.channel_perm_allowed(channel_id, 1));

drop policy if exists "messages_send_requires_channel_perm" on public.messages;
create policy "messages_send_requires_channel_perm" on public.messages
  as restrictive for insert to authenticated
  with check (public.channel_perm_allowed(channel_id, 2));

-- ── editing ───────────────────────────────────────────────────────────────────

-- Upsert one (channel, role) override. Passing allow = deny = 0 clears the row
-- so the channel falls back to the level above it.
--
-- Gated on MANAGE_ROLES (32) or MANAGE_CHANNELS (4096): both are already the
-- "can restructure this server" permissions, and requiring a new bit would leave
-- every existing admin role unable to use the feature.
create or replace function public.set_channel_permission(
  p_channel_id uuid,
  p_role_id    uuid,
  p_allow      int,
  p_deny       int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
begin
  select server_id into v_server_id from channels where id = p_channel_id;
  if v_server_id is null then
    raise exception 'channel not found';
  end if;
  if not (public.has_server_perm(v_server_id, 32) or public.has_server_perm(v_server_id, 4096)) then
    raise exception 'permission denied';
  end if;
  -- A role from another server would silently never match at resolution time.
  if p_role_id is not null and not exists (
    select 1 from roles where id = p_role_id and server_id = v_server_id
  ) then
    raise exception 'role does not belong to this server';
  end if;

  if coalesce(p_allow, 0) = 0 and coalesce(p_deny, 0) = 0 then
    delete from channel_permissions
     where channel_id = p_channel_id
       and coalesce(role_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_role_id, '00000000-0000-0000-0000-000000000000'::uuid);
    return;
  end if;

  insert into channel_permissions (channel_id, role_id, allow, deny)
  values (p_channel_id, p_role_id, coalesce(p_allow, 0), coalesce(p_deny, 0))
  on conflict (channel_id, coalesce(role_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set allow = excluded.allow, deny = excluded.deny, updated_at = now();
end;
$$;

grant execute on function public.set_channel_permission(uuid, uuid, int, int) to authenticated;

-- Realtime: the client keeps overrides in the server store like roles/channels,
-- so a member granted or denied a channel sees it appear or grey out without a
-- reload. Guarded the same way as 20260615_roles_realtime, so re-running is safe.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'channel_permissions'
  ) then
    alter publication supabase_realtime add table public.channel_permissions;
  end if;
end $$;
