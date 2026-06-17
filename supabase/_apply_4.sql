-- ════════════════ 20260611_realtime_progress.sql ════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- Realtime fixes for live XP + daily-quest progress.
-- The v0.9.14 quests/XP migrations never added these tables to the realtime
-- publication, so the client's subscriptions received no events (progress/XP
-- only refreshed on reload). Add them here. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'daily_quest_progress'
  ) then
    alter publication supabase_realtime add table daily_quest_progress;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'server_members'
  ) then
    alter publication supabase_realtime add table server_members;
  end if;
end $$;

-- ════════════════ 20260615_moderation.sql ════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- Moderation: bans, member timeouts, channel slowmode, audit log.
-- Pattern mirrors 20260607_rename_permissions.sql / 20260611_economy.sql:
--   • RLS per table; privileged writes ONLY via SECURITY DEFINER RPCs.
--   • Permission checks reuse public.has_server_perm(server_id, bit) (owner passes).
--   • Server-side enforcement via BEFORE-INSERT triggers so a banned / timed-out /
--     rate-limited user cannot bypass the client.
--
-- New perm bits (must match desktop/src/lib/permission.ts):
--   BAN_MEMBER       = 1024 (1 << 10)
--   MODERATE_MEMBERS = 2048 (1 << 11)   -- timeout
--   MANAGE_CHANNELS  = 4096 (1 << 12)   -- slowmode / topic; also bypasses slowmode
-- ════════════════════════════════════════════════════════════════════════════

-- ── Dependency: has_server_perm ──────────────────────────────────────────────
-- Defined here too (create or replace = idempotent) so this migration is
-- self-contained even if 20260607_rename_permissions.sql wasn't applied first.
-- Owner always passes; otherwise the member's role must carry the permission bit.
create or replace function public.has_server_perm(p_server_id uuid, p_perm int)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists(select 1 from servers where id = p_server_id and owner_id = auth.uid())
    or
    exists(
      select 1 from server_members sm
      join roles r on r.id = sm.role_id
      where sm.server_id = p_server_id
        and sm.user_id  = auth.uid()
        and (r.permissions & p_perm) > 0
    );
$$;

-- ── Schema additions ─────────────────────────────────────────────────────────
create table if not exists server_bans (
  server_id  uuid not null references servers(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  reason     text,
  banned_by  uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (server_id, user_id)
);
alter table server_bans enable row level security;
-- Only moderators (BAN_MEMBER) may read the ban list; writes go through RPCs.
drop policy if exists "mods read bans" on server_bans;
create policy "mods read bans" on server_bans
  for select using (public.has_server_perm(server_id, 1024));

alter table channels        add column if not exists slow_mode_seconds integer not null default 0;
alter table server_members  add column if not exists timeout_until     timestamptz;

create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  server_id   uuid not null references servers(id) on delete cascade,
  actor_id    uuid references profiles(id) on delete set null,
  action      text not null,                 -- 'ban' | 'unban' | 'timeout' | 'slowmode' | 'kick'
  target_id   uuid,                           -- affected user or channel
  meta        jsonb not null default '{}',    -- {reason} | {minutes} | {seconds} | {name}
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_log_server on audit_log(server_id, created_at desc);
alter table audit_log enable row level security;
-- MANAGE_SERVER (16) or owner may read the audit log; writes go through RPCs.
drop policy if exists "mods read audit" on audit_log;
create policy "mods read audit" on audit_log
  for select using (public.has_server_perm(server_id, 16));

-- ════════════════════════════════════════════════════════════════════════════
-- RPCs (SECURITY DEFINER, search_path = public). All return jsonb {ok, reason?}.
-- ════════════════════════════════════════════════════════════════════════════

-- Ban: remove the member and record the ban so they can't rejoin via invite.
create or replace function public.ban_member(p_server_id uuid, p_user_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not public.has_server_perm(p_server_id, 1024) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  -- The owner can never be banned.
  if exists (select 1 from servers where id = p_server_id and owner_id = p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'cannot_ban_owner');
  end if;

  delete from server_members where server_id = p_server_id and user_id = p_user_id;

  insert into server_bans (server_id, user_id, reason, banned_by)
  values (p_server_id, p_user_id, nullif(p_reason, ''), v_uid)
  on conflict (server_id, user_id) do update
    set reason = excluded.reason, banned_by = excluded.banned_by, created_at = now();

  insert into audit_log (server_id, actor_id, action, target_id, meta)
  values (p_server_id, v_uid, 'ban', p_user_id, jsonb_build_object('reason', nullif(p_reason, '')));

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.unban_member(p_server_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not public.has_server_perm(p_server_id, 1024) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  delete from server_bans where server_id = p_server_id and user_id = p_user_id;

  insert into audit_log (server_id, actor_id, action, target_id)
  values (p_server_id, v_uid, 'unban', p_user_id);

  return jsonb_build_object('ok', true);
end;
$$;

-- Timeout: silence a member until now() + p_minutes (0 clears the timeout).
create or replace function public.timeout_member(p_server_id uuid, p_user_id uuid, p_minutes integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_until timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not public.has_server_perm(p_server_id, 2048) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if exists (select 1 from servers where id = p_server_id and owner_id = p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'cannot_timeout_owner');
  end if;

  v_until := case when coalesce(p_minutes, 0) <= 0
                  then null
                  else now() + make_interval(mins => p_minutes) end;

  update server_members set timeout_until = v_until
  where server_id = p_server_id and user_id = p_user_id;

  insert into audit_log (server_id, actor_id, action, target_id, meta)
  values (p_server_id, v_uid, 'timeout', p_user_id, jsonb_build_object('minutes', p_minutes));

  return jsonb_build_object('ok', true, 'timeout_until', v_until);
end;
$$;

-- Slowmode: set per-channel cooldown (seconds). 0 disables.
create or replace function public.set_channel_slowmode(p_channel_id uuid, p_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_server_id uuid;
  v_seconds   integer := greatest(0, least(coalesce(p_seconds, 0), 21600)); -- cap 6h
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  select server_id into v_server_id from channels where id = p_channel_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'channel_not_found');
  end if;
  if not public.has_server_perm(v_server_id, 4096) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  update channels set slow_mode_seconds = v_seconds where id = p_channel_id;

  insert into audit_log (server_id, actor_id, action, target_id, meta)
  values (v_server_id, v_uid, 'slowmode', p_channel_id, jsonb_build_object('seconds', v_seconds));

  return jsonb_build_object('ok', true, 'seconds', v_seconds);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- Server-side enforcement triggers (defence in depth; the client also guards UX)
-- ════════════════════════════════════════════════════════════════════════════

-- Reject joins (server_members INSERT) by a banned user.
create or replace function public.enforce_server_ban()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from server_bans where server_id = new.server_id and user_id = new.user_id) then
    raise exception 'user is banned from this server' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_enforce_server_ban on server_members;
create trigger trg_enforce_server_ban
  before insert on server_members
  for each row execute function public.enforce_server_ban();

-- Reject message INSERTs that violate an active timeout or channel slowmode.
-- Moderators with MANAGE_CHANNELS (4096) bypass slowmode; nobody bypasses timeout.
create or replace function public.enforce_message_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
  v_slow      integer;
  v_timeout   timestamptz;
  v_last      timestamptz;
begin
  select c.server_id, c.slow_mode_seconds into v_server_id, v_slow
  from channels c where c.id = new.channel_id;

  -- Channel may belong to no server (DMs use a separate table) — nothing to enforce.
  if v_server_id is null then
    return new;
  end if;

  select sm.timeout_until into v_timeout
  from server_members sm
  where sm.server_id = v_server_id and sm.user_id = new.author_id;

  if v_timeout is not null and v_timeout > now() then
    raise exception 'you are timed out in this server' using errcode = 'check_violation';
  end if;

  if coalesce(v_slow, 0) > 0 and not public.has_server_perm(v_server_id, 4096) then
    select max(created_at) into v_last
    from messages
    where channel_id = new.channel_id and author_id = new.author_id;
    if v_last is not null and v_last > now() - make_interval(secs => v_slow) then
      raise exception 'channel is in slow mode' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;
drop trigger if exists trg_enforce_message_rules on messages;
create trigger trg_enforce_message_rules
  before insert on messages
  for each row execute function public.enforce_message_rules();

