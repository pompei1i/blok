-- Security: move invite-code rotation behind a SECURITY DEFINER RPC.
--
-- generateInviteCode used to `update servers` directly from the client, relying
-- on an UPDATE policy that predates this migrations folder (its name/scope is
-- unknown — possibly permissive). Same class of fix as join_server_by_invite /
-- invite_member in 20260623: writes go through an RPC that checks permissions
-- server-side, and the direct write path is closed.
--
-- Permission: owner or INVITE_MEMBER (bit 1) — matches the client UI gate on
-- the invite modal. The code is generated server-side (gen_random_bytes, 40 bits,
-- same entropy as the old client CSPRNG).

begin;

create or replace function public.rotate_invite_code(
  p_server_id  uuid,
  p_expires_at timestamptz default null,
  p_max_uses   integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not public.has_server_perm(p_server_id, 1) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_max_uses is not null and p_max_uses < 1 then
    return jsonb_build_object('ok', false, 'reason', 'bad_max_uses');
  end if;

  v_code := encode(gen_random_bytes(5), 'hex'); -- 10 hex chars

  update servers set
    invite_code       = v_code,
    invite_expires_at = p_expires_at,
    invite_max_uses   = p_max_uses,
    invite_used_count = 0
  where id = p_server_id;

  return jsonb_build_object('ok', true, 'code', v_code);
end;
$$;

revoke all on function public.rotate_invite_code(uuid, timestamptz, integer) from public;
grant execute on function public.rotate_invite_code(uuid, timestamptz, integer) to authenticated;

-- Close the direct write path: drop EVERY UPDATE policy on servers, whatever
-- it's named (name-agnostic enumeration, same pattern as 20260625 for SELECT).
-- All server mutations now go through RPCs: rename_server, update_server_icon,
-- rotate_invite_code; join_server_by_invite bumps invite_used_count as DEFINER.
do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'servers'
      and cmd = 'UPDATE'
  loop
    execute format('drop policy if exists %I on public.servers', pol.policyname);
  end loop;
end $$;

commit;
