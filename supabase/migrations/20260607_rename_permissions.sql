-- Helper: check if the current user has a specific permission bit in this server
-- (owner always passes).
create or replace function public.has_server_perm(p_server_id uuid, p_perm int)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- server owner
    exists(select 1 from servers where id = p_server_id and owner_id = auth.uid())
    or
    -- member with role that has the permission bit set
    exists(
      select 1 from server_members sm
      join roles r on r.id = sm.role_id
      where sm.server_id = p_server_id
        and sm.user_id  = auth.uid()
        and (r.permissions & p_perm) > 0
    );
$$;

-- Perm bits (must match desktop/src/lib/permission.ts):
--   RENAME_CHANNEL    = 128  (1 << 7)
--   RENAME_SERVER     = 256  (1 << 8)
--   MANAGE_SERVER_ICON= 512  (1 << 9)

create or replace function public.rename_channel(p_channel_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
begin
  select server_id into v_server_id from channels where id = p_channel_id;
  if not found then raise exception 'channel not found'; end if;
  if not public.has_server_perm(v_server_id, 128) then raise exception 'permission denied'; end if;
  update channels set name = p_name where id = p_channel_id;
end;
$$;

create or replace function public.rename_server(p_server_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_server_perm(p_server_id, 256) then raise exception 'permission denied'; end if;
  update servers set name = p_name where id = p_server_id;
end;
$$;

-- update_server_icon now re-uses has_server_perm (512) instead of is_server_owner.
create or replace function public.update_server_icon(p_server_id uuid, p_icon_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_server_perm(p_server_id, 512) then raise exception 'permission denied'; end if;
  update servers set icon_url = p_icon_url where id = p_server_id;
end;
$$;
