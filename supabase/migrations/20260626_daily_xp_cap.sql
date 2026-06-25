-- Daily cap on message XP, per (user, server, date), so spamming messages
-- can't be used to farm levels indefinitely. Mirrors the daily_coin_earn
-- pattern from 20260611_economy.sql: a lock-and-cap row, incremented
-- atomically inside the same trigger that already grants XP.
--
-- DAILY_MESSAGE_XP_CAP = 100 (20 messages/day at +5 XP each).

create table if not exists daily_message_xp (
  user_id   uuid not null references profiles(id) on delete cascade,
  server_id uuid not null references servers(id) on delete cascade,
  date      date not null default current_date,
  earned    integer not null default 0,
  primary key (user_id, server_id, date)
);
alter table daily_message_xp enable row level security;
drop policy if exists "read own message xp" on daily_message_xp;
create policy "read own message xp" on daily_message_xp for select using (auth.uid() = user_id);

create or replace function public.increment_xp_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
  v_earned    integer;
  v_grant     constant integer := 5;    -- XP per message
  v_cap       constant integer := 100;  -- DAILY_MESSAGE_XP_CAP
  v_room      integer;
begin
  select server_id into v_server_id from channels where id = NEW.channel_id;
  if v_server_id is null then
    return NEW;
  end if;

  insert into daily_message_xp (user_id, server_id, date, earned)
  values (NEW.author_id, v_server_id, current_date, 0)
  on conflict (user_id, server_id, date) do nothing;

  select earned into v_earned
  from daily_message_xp
  where user_id = NEW.author_id and server_id = v_server_id and date = current_date
  for update;

  v_room := greatest(0, least(v_grant, v_cap - coalesce(v_earned, 0)));

  if v_room > 0 then
    update daily_message_xp set earned = earned + v_room
    where user_id = NEW.author_id and server_id = v_server_id and date = current_date;

    update server_members
    set xp = xp + v_room
    where user_id = NEW.author_id and server_id = v_server_id;
  end if;

  return NEW;
end;
$$;
