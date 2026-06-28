-- Admin accounts that bypass beta limits (b.ai.t rate/daily caps today, and any
-- future beta-gated feature). The flag lives in its own table with NO client-facing
-- RLS policies, so it can't be self-granted: only the SECURITY DEFINER functions
-- below and the service role (Supabase dashboard / SQL editor) can read or write it.
--
-- The founder admin (ceo@blok.com) is seeded at the bottom of this file. To grant
-- admin to any other account later (run from the SQL editor / service role):
--   insert into app_admins (user_id)
--   select id from auth.users where email = 'someone@blok.com'
--   on conflict do nothing;
-- To revoke:  delete from app_admins where user_id = (select id from auth.users where email = 'someone@blok.com');

create table if not exists app_admins (
  user_id    uuid primary key references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table app_admins enable row level security;
-- No policies on purpose — clients only ever reach this through the functions below.

-- Lets the client unlock admin-only UI for *itself* (and only itself); never leaks
-- the admin list. Returns false for anon/unknown callers.
create or replace function public.is_current_user_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from app_admins where user_id = auth.uid());
$$;

grant execute on function public.is_current_user_admin() to authenticated;

-- Rate limiter with an admin bypass added. Admins always pass and we don't even
-- record a marker for them. Same signature as 20260616_bait_rate_limit so the
-- bait Edge Function needs no change.
create or replace function public.bait_rate_check(p_max integer, p_window_secs integer, p_daily_max integer default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_window integer;
  v_daily  integer;
begin
  if v_uid is null then
    return false;
  end if;

  -- Admins bypass all beta limits.
  if exists (select 1 from app_admins where user_id = v_uid) then
    return true;
  end if;

  -- Keep a day of history (needed for the daily cap); drop older markers.
  delete from bait_requests
  where user_id = v_uid and created_at < now() - interval '1 day';

  -- Burst limit (per window).
  select count(*) into v_window from bait_requests
  where user_id = v_uid and created_at >= now() - make_interval(secs => p_window_secs);
  if v_window >= p_max then
    return false;
  end if;

  -- Daily cap.
  if p_daily_max is not null then
    select count(*) into v_daily from bait_requests where user_id = v_uid;
    if v_daily >= p_daily_max then
      return false;
    end if;
  end if;

  insert into bait_requests (user_id) values (v_uid);
  return true;
end;
$$;

-- Seed the founder admin account. No-op until that account exists, and idempotent,
-- so it's safe whether the account is created before or after this migration runs
-- (re-run this snippet from the SQL editor if you create the account afterwards).
insert into app_admins (user_id)
select id from auth.users where email = 'ceo@blok.com'
on conflict (user_id) do nothing;
