-- Categories (sections) for grouping text + voice channels, plus reorder RPCs.
-- The `categories` table and `channels.category_id` column already exist and
-- are read by the client; this migration adds the missing write path
-- (create/rename/delete category, reorder channels and categories) gated by
-- the same has_server_perm() permission bits used elsewhere.

-- ── categories: scope writes to permission, not just membership ────────────
alter table categories enable row level security;

-- create_category: CREATE_CHANNEL permission (bit 2).
create or replace function public.create_category(p_server_id uuid, p_name text)
returns categories
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pos integer;
  v_row categories;
begin
  if not public.has_server_perm(p_server_id, 2) then
    raise exception 'permission denied';
  end if;

  select coalesce(max(position), -1) + 1 into v_pos
  from categories where server_id = p_server_id;

  insert into categories (server_id, name, position)
  values (p_server_id, p_name, v_pos)
  returning * into v_row;

  return v_row;
end;
$$;

-- rename_category: RENAME_CHANNEL permission (bit 128).
create or replace function public.rename_category(p_category_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
begin
  select server_id into v_server_id from categories where id = p_category_id;
  if not found then raise exception 'category not found'; end if;
  if not public.has_server_perm(v_server_id, 128) then raise exception 'permission denied'; end if;

  update categories set name = p_name where id = p_category_id;
end;
$$;

-- delete_category: DELETE_CHANNEL permission (bit 4). Channels inside are not
-- deleted — they're uncategorized, mirroring Discord's "delete category" behavior.
create or replace function public.delete_category(p_category_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
begin
  select server_id into v_server_id from categories where id = p_category_id;
  if not found then raise exception 'category not found'; end if;
  if not public.has_server_perm(v_server_id, 4) then raise exception 'permission denied'; end if;

  update channels set category_id = null where category_id = p_category_id;
  delete from categories where id = p_category_id;
end;
$$;

-- reorder_categories: MANAGE_CHANNELS permission (bit 4096). Batch position
-- update so the whole reorder is atomic instead of N separate client writes.
-- p_items: jsonb array of {"id": uuid, "position": int}, all belonging to p_server_id.
create or replace function public.reorder_categories(p_server_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
begin
  if not public.has_server_perm(p_server_id, 4096) then
    raise exception 'permission denied';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    update categories
    set position = (v_item->>'position')::int
    where id = (v_item->>'id')::uuid and server_id = p_server_id;
  end loop;
end;
$$;

-- reorder_channels: MANAGE_CHANNELS permission (bit 4096). Batch update of
-- category_id + position so drag-and-drop (within or across categories) is
-- one atomic write instead of racing partial updates from the client.
-- p_items: jsonb array of {"id": uuid, "category_id": uuid|null, "position": int},
-- all belonging to p_server_id.
create or replace function public.reorder_channels(p_server_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_category_id uuid;
begin
  if not public.has_server_perm(p_server_id, 4096) then
    raise exception 'permission denied';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_category_id := (v_item->>'category_id')::uuid;

    -- Reject categories that don't belong to this server (cross-server moves).
    if v_category_id is not null and not exists (
      select 1 from categories where id = v_category_id and server_id = p_server_id
    ) then
      raise exception 'category does not belong to server';
    end if;

    update channels
    set category_id = v_category_id, position = (v_item->>'position')::int
    where id = (v_item->>'id')::uuid and server_id = p_server_id;
  end loop;
end;
$$;

-- ── Realtime: stream category create/rename/delete to other members ───────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'categories'
  ) then
    alter publication supabase_realtime add table categories;
  end if;
end $$;
