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

-- Sliding-window check: prune the caller's old rows, count what's left, and admit
-- the request (inserting a marker) only if under the limit. Returns true=allowed.
create or replace function public.bait_rate_check(p_max integer, p_window_secs integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    return false;
  end if;

  delete from bait_requests
  where user_id = v_uid and created_at < now() - make_interval(secs => p_window_secs);

  select count(*) into v_count from bait_requests where user_id = v_uid;
  if v_count >= p_max then
    return false;
  end if;

  insert into bait_requests (user_id) values (v_uid);
  return true;
end;
$$;
