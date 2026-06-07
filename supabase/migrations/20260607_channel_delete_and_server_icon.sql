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
