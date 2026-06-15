-- Catch-up: re-assert the daily-quest increment triggers.
-- The reactions quest never advances on this DB even though message_reactions
-- INSERTs succeed → the AFTER-INSERT trigger is missing (migrations were applied
-- partially; cf. has_server_perm also absent). Re-creating both triggers is
-- idempotent (create or replace + drop trigger if exists), so it's safe to run
-- regardless of current state and fixes the reactions counter.

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
