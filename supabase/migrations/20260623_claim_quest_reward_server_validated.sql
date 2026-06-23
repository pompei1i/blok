-- claim_quest_reward trusted the client-supplied p_xp/p_coins outright and
-- never checked that the quest's progress target was actually met — only that
-- it hadn't been claimed today. A client could call the RPC directly with any
-- quest_id and an arbitrarily large p_xp/p_coins (coins were capped by the
-- daily-earn cap; XP had no cap at all) and/or claim a quest never completed.
--
-- Fix: the reward (xp, coins) and the completion target now come from a
-- server-side catalog, not the client. p_xp/p_coins are still accepted for
-- backward compatibility with the current client call shape but are ignored.
--
-- Keep this catalog in sync with desktop/src/lib/quests.ts (DAILY_QUESTS) by
-- review — same convention as the BOX_COST/PITY_N constants in 20260611_economy.sql.

begin;

create or replace function public.quest_def(p_quest_id text)
returns table (quest_type text, target integer, xp integer, coins integer)
language sql
immutable
as $$
  -- select only the 4 declared return columns (NOT quest_id) — `select *` here
  -- returned 5 columns and shifted the types (text into `target integer`).
  select t.quest_type, t.target, t.xp, t.coins from (values
    ('send_5',  'messages_sent',   5,  50,  50),
    ('send_15', 'messages_sent',  15, 100, 100),
    ('react_5', 'reactions_added', 5,  75,  75)
  ) as t(quest_id, quest_type, target, xp, coins)
  where t.quest_id = p_quest_id;
$$;

create or replace function public.claim_quest_reward(
  p_server_id uuid,
  p_quest_id  text,
  p_xp        integer,
  p_coins     integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_def    record;
  v_count  integer;
  v_earned integer;
  v_grant  integer;
  v_cap    constant integer := 200;  -- DAILY_COIN_CAP
begin
  if v_uid is null then
    return jsonb_build_object('claimed', false);
  end if;

  select * into v_def from public.quest_def(p_quest_id);
  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'unknown_quest');
  end if;

  select count into v_count
  from daily_quest_progress
  where user_id = v_uid and server_id = p_server_id
    and quest_type = v_def.quest_type and date = current_date;

  if coalesce(v_count, 0) < v_def.target then
    return jsonb_build_object('claimed', false, 'reason', 'not_completed');
  end if;

  insert into daily_quest_claims (user_id, server_id, quest_id)
  values (v_uid, p_server_id, p_quest_id)
  on conflict do nothing;

  if not found then
    return jsonb_build_object('claimed', false);
  end if;

  update server_members
  set xp = xp + v_def.xp
  where user_id = v_uid and server_id = p_server_id;

  -- Global daily cap: lock the (user, today) row, grant only up to the remainder.
  insert into daily_coin_earn (user_id, date, earned)
  values (v_uid, current_date, 0)
  on conflict (user_id, date) do nothing;

  select earned into v_earned
  from daily_coin_earn
  where user_id = v_uid and date = current_date
  for update;

  v_grant := greatest(0, least(v_def.coins, v_cap - coalesce(v_earned, 0)));

  if v_grant > 0 then
    update daily_coin_earn set earned = earned + v_grant
    where user_id = v_uid and date = current_date;

    insert into user_wallet (user_id, coins) values (v_uid, v_grant)
    on conflict (user_id) do update
      set coins = user_wallet.coins + v_grant, updated_at = now();
  end if;

  return jsonb_build_object('claimed', true, 'coins_granted', v_grant, 'xp', v_def.xp);
end;
$$;

-- claim_quest_xp (legacy, no longer called by the client) had the same
-- unvalidated-p_xp hole; close it too for any direct callers.
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
declare
  v_uid   uuid := auth.uid();
  v_def   record;
  v_count integer;
begin
  if v_uid is null then
    return false;
  end if;

  select * into v_def from public.quest_def(p_quest_id);
  if not found then
    return false;
  end if;

  select count into v_count
  from daily_quest_progress
  where user_id = v_uid and server_id = p_server_id
    and quest_type = v_def.quest_type and date = current_date;

  if coalesce(v_count, 0) < v_def.target then
    return false;
  end if;

  insert into daily_quest_claims (user_id, server_id, quest_id)
  values (v_uid, p_server_id, p_quest_id)
  on conflict do nothing;

  if not found then
    return false;
  end if;

  update server_members
  set xp = xp + v_def.xp
  where user_id = v_uid and server_id = p_server_id;

  return true;
end;
$$;

commit;
