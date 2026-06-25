-- create_server: atomic server bootstrap (server + default "general" channel +
-- owner membership row) via a single SECURITY DEFINER RPC.
--
-- Root cause: createServer() on the client inserted into `servers` and
-- `channels` directly but never added the owner to `server_members`. This
-- was masked while server_members had a permissive INSERT policy, but
-- 20260623_server_members_lockdown.sql revoked direct client writes to
-- server_members entirely, so owners now never become members. Since
-- channels/messages SELECT policies (and Realtime, which enforces RLS) gate
-- on server_members, the owner's own client stops receiving Realtime events
-- for channels it just created -- including the bootstrap "general" channel.

begin;

create or replace function public.create_server(p_name text, p_description text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_server_id  uuid;
  v_channel_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if p_name is null or trim(p_name) = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  insert into servers (name, description, owner_id)
  values (trim(p_name), p_description, v_uid)
  returning id into v_server_id;

  insert into channels (server_id, name, type, position)
  values (v_server_id, 'general', 'text', 0)
  returning id into v_channel_id;

  insert into server_members (server_id, user_id) values (v_server_id, v_uid);

  return jsonb_build_object('ok', true, 'server_id', v_server_id, 'channel_id', v_channel_id);
end;
$$;
grant execute on function public.create_server(text, text) to authenticated;

commit;
