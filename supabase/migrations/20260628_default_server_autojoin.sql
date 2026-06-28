-- Auto-join every user to "default" servers (the official "blok off" server).
--
-- Approach: a boolean flag on `servers` marks which servers everyone joins. A new
-- trigger on profiles adds each new signup, and a one-time backfill adds all
-- existing users. Using a flag (not a hardcoded id / name match at runtime) means
-- the official server can be renamed or rebuilt without touching this logic — you
-- just set is_default on whichever server should auto-enroll members.
--
-- server_members write access is locked down (20260623), but these run as the
-- table owner via SECURITY DEFINER / migration context, so they bypass that.

begin;

alter table public.servers
  add column if not exists is_default boolean not null default false;

-- Flag the official server. Adjust the name here if it differs in your DB:
--   update public.servers set is_default = true where name = 'Exact Name';
update public.servers set is_default = true where lower(trim(name)) = 'blok off';

-- New signups: join every default server. Runs after handle_new_user() has created
-- the profile row (same transaction), so the FK on server_members.user_id is met.
create or replace function public.auto_join_default_servers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into server_members (server_id, user_id)
  select s.id, new.id
  from servers s
  where s.is_default = true
    and not exists (
      select 1 from server_members m where m.server_id = s.id and m.user_id = new.id
    );
  return new;
end;
$$;

drop trigger if exists on_profile_created_autojoin on public.profiles;
create trigger on_profile_created_autojoin
  after insert on public.profiles
  for each row execute procedure public.auto_join_default_servers();

-- Backfill: add every existing user to every default server (skips current members).
insert into server_members (server_id, user_id)
select s.id, p.id
from servers s
cross join profiles p
where s.is_default = true
  and not exists (
    select 1 from server_members m where m.server_id = s.id and m.user_id = p.id
  );

commit;
