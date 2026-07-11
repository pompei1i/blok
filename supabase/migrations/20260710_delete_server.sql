-- Server deletion — owner only. All child rows (channels, categories,
-- server_members, roles, messages via channels, quests, moderation, …) are
-- removed by their `on delete cascade` FKs to servers(id).

create or replace function delete_server(p_server_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_owner uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select owner_id into v_owner from servers where id = p_server_id;
  if v_owner is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_owner <> v_uid then
    return jsonb_build_object('ok', false, 'reason', 'not_owner');
  end if;

  delete from servers where id = p_server_id;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function delete_server(uuid) to authenticated;
