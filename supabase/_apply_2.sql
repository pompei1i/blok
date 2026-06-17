-- ════════════════ 20260607_rename_permissions.sql ════════════════
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

-- ════════════════ 20260608_daily_quests.sql ════════════════
-- Progress counters (raw counts, reset daily via date column)
create table if not exists daily_quest_progress (
  user_id   uuid not null references profiles(id) on delete cascade,
  server_id uuid not null references servers(id)  on delete cascade,
  quest_type text not null,  -- 'messages_sent' | 'reactions_added'
  count     integer default 0 not null,
  date      date default current_date not null,
  primary key (user_id, server_id, quest_type, date)
);

alter table daily_quest_progress enable row level security;

drop policy if exists "select own quest progress" on daily_quest_progress;
create policy "select own quest progress"
  on daily_quest_progress for select
  using (auth.uid() = user_id);

-- One-time XP claim records (prevent double-awarding)
create table if not exists daily_quest_claims (
  user_id   uuid not null references profiles(id) on delete cascade,
  server_id uuid not null references servers(id)  on delete cascade,
  quest_id  text not null,   -- 'send_5' | 'send_15' | 'react_5'
  date      date default current_date not null,
  primary key (user_id, server_id, quest_id, date)
);

alter table daily_quest_claims enable row level security;

drop policy if exists "select own quest claims" on daily_quest_claims;
create policy "select own quest claims"
  on daily_quest_claims for select
  using (auth.uid() = user_id);

-- Trigger: increment messages_sent counter on each new message
create or replace function public.increment_quest_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
begin
  select server_id into v_server_id from channels where id = NEW.channel_id;
  if v_server_id is null then return NEW; end if;

  insert into daily_quest_progress (user_id, server_id, quest_type, count)
  values (NEW.author_id, v_server_id, 'messages_sent', 1)
  on conflict (user_id, server_id, quest_type, date)
  do update set count = daily_quest_progress.count + 1;

  return NEW;
end;
$$;

drop trigger if exists trg_quest_message on messages;
create trigger trg_quest_message
after insert on messages
for each row execute function public.increment_quest_on_message();

-- Trigger: increment reactions_added counter on each new reaction
create or replace function public.increment_quest_on_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
begin
  select c.server_id into v_server_id
  from messages m
  join channels c on c.id = m.channel_id
  where m.id = NEW.message_id;

  if v_server_id is null then return NEW; end if;

  insert into daily_quest_progress (user_id, server_id, quest_type, count)
  values (NEW.user_id, v_server_id, 'reactions_added', 1)
  on conflict (user_id, server_id, quest_type, date)
  do update set count = daily_quest_progress.count + 1;

  return NEW;
end;
$$;

drop trigger if exists trg_quest_reaction on message_reactions;
create trigger trg_quest_reaction
after insert on message_reactions
for each row execute function public.increment_quest_on_reaction();

-- RPC: atomically claim XP for a completed quest (idempotent)
create or replace function public.claim_quest_xp(
  p_server_id uuid,
  p_quest_id  text,
  p_xp        integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into daily_quest_claims (user_id, server_id, quest_id)
  values (auth.uid(), p_server_id, p_quest_id)
  on conflict do nothing;

  if not found then
    return false;
  end if;

  update server_members
  set xp = xp + p_xp
  where user_id = auth.uid() and server_id = p_server_id;

  return true;
end;
$$;

-- ════════════════ 20260608_rich_presence.sql ════════════════
alter table user_presence add column if not exists activity text;

-- ════════════════ 20260608_xp_levels.sql ════════════════
alter table server_members add column if not exists xp integer default 0 not null;

-- increment_xp_on_message: +5 XP per sent message, runs as definer to bypass RLS.
create or replace function public.increment_xp_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update server_members
  set xp = xp + 5
  where user_id = NEW.author_id
    and server_id = (select server_id from channels where id = NEW.channel_id);
  return NEW;
end;
$$;

drop trigger if exists trg_message_xp on messages;
create trigger trg_message_xp
after insert on messages
for each row execute function public.increment_xp_on_message();

