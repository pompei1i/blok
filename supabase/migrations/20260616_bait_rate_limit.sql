-- Per-user rate limiting for the b.ai.t proxy (the Edge Function calls this with
-- the caller's JWT, so auth.uid() is the requesting user). Replaces the old
-- client-side-only limiter, which was trivially bypassable now that the Anthropic
-- key lives server-side.

create table if not exists bait_requests (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists idx_bait_requests_user_time on bait_requests(user_id, created_at desc);

alter table bait_requests enable row level security;
-- No client policies — only the SECURITY DEFINER RPC below touches this table.

-- Burst (per-window) + daily cap. Prunes a day of history, checks both limits,
-- and admits the request (inserting a marker) only if under both. Returns
-- true=allowed. p_daily_max is optional (null = no daily cap).
-- The 2-arg signature is dropped so only this version exists.
drop function if exists public.bait_rate_check(integer, integer);

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
