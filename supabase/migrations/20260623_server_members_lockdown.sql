-- server_members write lockdown — close a privilege-escalation hole.
--
-- Root cause: no INSERT/UPDATE/DELETE policy for server_members exists in any
-- migration (only SELECT was scoped in 20260619_rls_f1_hardening). The client
-- was writing directly to the table for join-by-invite, inviteUser, assignRole
-- and kickMember with only client-side `can()` UI checks — nothing enforced
-- permissions server-side. Any authenticated user could, via a raw REST call:
--   - join any server bypassing invite expiry/max-uses (non-atomic race too)
--   - self-promote by UPDATEing their own role_id to an admin role
--   - kick or re-role any member of any server
--
-- Fix: revoke direct table writes from authenticated, route every mutation
-- through a SECURITY DEFINER RPC that checks public.has_server_perm(...).
-- Pattern matches 20260615_moderation.sql.

begin;

-- ── Close the table off to direct client writes ────────────────────────────
drop policy if exists "Enable insert for authenticated users" on public.server_members;
drop policy if exists "Enable update for authenticated users" on public.server_members;
drop policy if exists "Enable delete for authenticated users" on public.server_members;
drop policy if exists "server_members_insert_authenticated"   on public.server_members;
drop policy if exists "server_members_update_authenticated"   on public.server_members;
drop policy if exists "server_members_delete_authenticated"   on public.server_members;
revoke insert, update, delete on public.server_members from authenticated, anon;

-- ── join_server_by_invite: atomic expiry/max-uses/ban check + join ─────────
create or replace function public.join_server_by_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_server    record;
  v_member_id uuid;
  v_new_count int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_server from servers where invite_code = trim(p_code);
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;

  if v_server.invite_expires_at is not null and v_server.invite_expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if exists (select 1 from server_members where server_id = v_server.id and user_id = v_uid) then
    return jsonb_build_object('ok', true, 'server_id', v_server.id, 'already_member', true);
  end if;

  if exists (select 1 from server_bans where server_id = v_server.id and user_id = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'banned');
  end if;

  -- Atomically claim a usage slot before inserting, so two concurrent joiners
  -- can't both slip past a max-uses cap (the old client code read-then-wrote).
  update servers set invite_used_count = invite_used_count + 1
  where id = v_server.id
    and (invite_max_uses is null or invite_used_count < invite_max_uses)
  returning invite_used_count into v_new_count;

  if v_new_count is null then
    return jsonb_build_object('ok', false, 'reason', 'max_uses_reached');
  end if;

  insert into server_members (server_id, user_id) values (v_server.id, v_uid)
    returning id into v_member_id;

  return jsonb_build_object('ok', true, 'server_id', v_server.id, 'member_id', v_member_id);
end;
$$;
grant execute on function public.join_server_by_invite(text) to authenticated;

-- ── invite_member: owner/INVITE_MEMBER (1) adds a known user by username ───
create or replace function public.invite_member(p_server_id uuid, p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_profile   record;
  v_member_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not public.has_server_perm(p_server_id, 1) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_profile from profiles where username = lower(trim(p_username));
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'user_not_found');
  end if;

  if exists (select 1 from server_members where server_id = p_server_id and user_id = v_profile.id) then
    return jsonb_build_object('ok', false, 'reason', 'already_member');
  end if;
  if exists (select 1 from server_bans where server_id = p_server_id and user_id = v_profile.id) then
    return jsonb_build_object('ok', false, 'reason', 'banned');
  end if;

  insert into server_members (server_id, user_id) values (p_server_id, v_profile.id)
    returning id into v_member_id;

  return jsonb_build_object('ok', true, 'member_id', v_member_id, 'user_id', v_profile.id);
end;
$$;
grant execute on function public.invite_member(uuid, text) to authenticated;

-- ── assign_member_role: owner/MANAGE_ROLES (32) sets a member's role ───────
create or replace function public.assign_member_role(p_member_id uuid, p_server_id uuid, p_role_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not public.has_server_perm(p_server_id, 32) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if not exists (select 1 from server_members where id = p_member_id and server_id = p_server_id) then
    return jsonb_build_object('ok', false, 'reason', 'member_not_found');
  end if;
  if p_role_id is not null and not exists (select 1 from roles where id = p_role_id and server_id = p_server_id) then
    return jsonb_build_object('ok', false, 'reason', 'role_not_found');
  end if;

  update server_members set role_id = p_role_id where id = p_member_id and server_id = p_server_id;

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.assign_member_role(uuid, uuid, uuid) to authenticated;

-- ── kick_server_member: owner/KICK_MEMBER (64) removes a member ────────────
create or replace function public.kick_server_member(p_member_id uuid, p_server_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_user uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not public.has_server_perm(p_server_id, 64) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select user_id into v_target_user from server_members where id = p_member_id and server_id = p_server_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'member_not_found');
  end if;
  if exists (select 1 from servers where id = p_server_id and owner_id = v_target_user) then
    return jsonb_build_object('ok', false, 'reason', 'cannot_kick_owner');
  end if;

  delete from server_members where id = p_member_id and server_id = p_server_id;

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.kick_server_member(uuid, uuid) to authenticated;

commit;
