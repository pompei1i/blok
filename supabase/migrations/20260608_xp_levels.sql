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
