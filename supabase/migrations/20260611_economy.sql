-- ════════════════════════════════════════════════════════════════════════════
-- Economy: global wallet, item catalog, inventory, equipped cosmetics, gacha box
-- Pattern mirrors 20260608_daily_quests.sql: RLS per table, privileged writes only
-- via SECURITY DEFINER RPCs, clients get SELECT-own (or SELECT-active) policies.
--
-- Tunable constants live in BOTH the RPCs below and desktop/src/lib/economy.ts —
-- keep them in sync by review:
--   DAILY_COIN_CAP = 200   BOX_COST = 100   PITY_N = 10
--   DUST per rarity: common 10, rare 25, epic 60, legendary 150
-- ════════════════════════════════════════════════════════════════════════════

-- ── Enums ───────────────────────────────────────────────────────────────────
do $$ begin
  create type item_type as enum ('nameplate','avatar_frame','badge','banner');
exception when duplicate_object then null; end $$;

do $$ begin
  create type item_rarity as enum ('common','rare','epic','legendary');
exception when duplicate_object then null; end $$;

-- ── Wallet (GLOBAL, one row per user) ───────────────────────────────────────
create table if not exists user_wallet (
  user_id    uuid primary key references profiles(id) on delete cascade,
  coins      integer not null default 0 check (coins >= 0),
  dust       integer not null default 0 check (dust  >= 0),
  updated_at timestamptz not null default now()
);
alter table user_wallet enable row level security;
drop policy if exists "read own wallet" on user_wallet;
create policy "read own wallet" on user_wallet for select using (auth.uid() = user_id);
-- No insert/update/delete policy: only SECURITY DEFINER RPCs mutate it.

-- ── Item catalog ────────────────────────────────────────────────────────────
create table if not exists item_catalog (
  id            text primary key,
  type          item_type   not null,
  rarity        item_rarity not null,
  name          text not null,
  payload       jsonb not null default '{}',           -- {color}|{gradient,animation}|{url}|{icon,label}
  shop_cost     integer,                                -- null = not buyable in shop
  shop_currency text not null default 'coins' check (shop_currency in ('coins','dust')),
  weight        integer not null default 0,             -- gacha weight; 0 = box-excluded
  active        boolean not null default true
);
alter table item_catalog enable row level security;
drop policy if exists "read active catalog" on item_catalog;
create policy "read active catalog" on item_catalog for select using (active = true);

-- ── Inventory (unique ownership → duplicate detection) ──────────────────────
create table if not exists user_inventory (
  user_id     uuid not null references profiles(id) on delete cascade,
  item_id     text not null references item_catalog(id),
  acquired_at timestamptz not null default now(),
  source      text not null check (source in ('box','shop','grant')),
  primary key (user_id, item_id)
);
alter table user_inventory enable row level security;
drop policy if exists "read own inventory" on user_inventory;
create policy "read own inventory" on user_inventory for select using (auth.uid() = user_id);

-- ── Equipped cosmetics — denormalized onto profiles ─────────────────────────
-- The `cosmetics` JSON snapshot is rebuilt server-side on equip so renderers
-- read it directly (no catalog join). The existing public:profiles Realtime
-- subscription propagates equipped changes to every viewer for free.
alter table profiles
  add column if not exists equipped_nameplate    text references item_catalog(id) on delete set null,
  add column if not exists equipped_avatar_frame text references item_catalog(id) on delete set null,
  add column if not exists equipped_banner       text references item_catalog(id) on delete set null,
  add column if not exists equipped_badges        jsonb not null default '[]',
  add column if not exists cosmetics             jsonb not null default '{}';

-- ── Gacha pity state ────────────────────────────────────────────────────────
create table if not exists user_gacha_state (
  user_id          uuid primary key references profiles(id) on delete cascade,
  opens_since_epic integer not null default 0,
  total_opens      integer not null default 0
);
alter table user_gacha_state enable row level security;
drop policy if exists "read own gacha state" on user_gacha_state;
create policy "read own gacha state" on user_gacha_state for select using (auth.uid() = user_id);

-- ── Global daily coin-earn cap (NO server_id → global per user/day) ─────────
create table if not exists daily_coin_earn (
  user_id uuid not null references profiles(id) on delete cascade,
  date    date not null default current_date,
  earned  integer not null default 0,
  primary key (user_id, date)
);
alter table daily_coin_earn enable row level security;
drop policy if exists "read own earn" on daily_coin_earn;
create policy "read own earn" on daily_coin_earn for select using (auth.uid() = user_id);

-- ════════════════════════════════════════════════════════════════════════════
-- RPCs (SECURITY DEFINER, search_path = public, scoped to auth.uid())
-- ════════════════════════════════════════════════════════════════════════════

-- Rebuild the denormalized profiles.cosmetics snapshot from equipped_* columns.
create or replace function public.rebuild_cosmetics(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_np text; v_fr text; v_bn text; v_badges jsonb;
  v_cos jsonb := '{}'::jsonb;
  v_badge_arr jsonb;
begin
  select equipped_nameplate, equipped_avatar_frame, equipped_banner, equipped_badges
    into v_np, v_fr, v_bn, v_badges
  from profiles where id = p_uid;

  if v_np is not null then
    select jsonb_set(v_cos, '{nameplate}',
      jsonb_build_object('id', id, 'rarity', rarity::text, 'payload', payload))
    into v_cos from item_catalog where id = v_np;
  end if;
  if v_fr is not null then
    select jsonb_set(v_cos, '{avatar_frame}',
      jsonb_build_object('id', id, 'rarity', rarity::text, 'payload', payload))
    into v_cos from item_catalog where id = v_fr;
  end if;
  if v_bn is not null then
    select jsonb_set(v_cos, '{banner}',
      jsonb_build_object('id', id, 'rarity', rarity::text, 'payload', payload))
    into v_cos from item_catalog where id = v_bn;
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object('id', c.id, 'rarity', c.rarity::text, 'payload', c.payload)
              order by b.ord),
    '[]'::jsonb)
    into v_badge_arr
  from jsonb_array_elements_text(coalesce(v_badges, '[]'::jsonb)) with ordinality as b(bid, ord)
  join item_catalog c on c.id = b.bid;

  v_cos := jsonb_set(v_cos, '{badges}', coalesce(v_badge_arr, '[]'::jsonb));

  update profiles set cosmetics = v_cos where id = p_uid;
end;
$$;

-- Claim a quest: idempotent claim + per-server XP + globally-capped coins.
-- Does NOT replace claim_quest_xp (other callers/tests depend on it).
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
  v_earned integer;
  v_grant  integer;
  v_cap    constant integer := 200;  -- DAILY_COIN_CAP
begin
  if v_uid is null then
    return jsonb_build_object('claimed', false);
  end if;

  insert into daily_quest_claims (user_id, server_id, quest_id)
  values (v_uid, p_server_id, p_quest_id)
  on conflict do nothing;

  if not found then
    return jsonb_build_object('claimed', false);
  end if;

  update server_members
  set xp = xp + p_xp
  where user_id = v_uid and server_id = p_server_id;

  -- Global daily cap: lock the (user, today) row, grant only up to the remainder.
  insert into daily_coin_earn (user_id, date, earned)
  values (v_uid, current_date, 0)
  on conflict (user_id, date) do nothing;

  select earned into v_earned
  from daily_coin_earn
  where user_id = v_uid and date = current_date
  for update;

  v_grant := greatest(0, least(p_coins, v_cap - coalesce(v_earned, 0)));

  if v_grant > 0 then
    update daily_coin_earn set earned = earned + v_grant
    where user_id = v_uid and date = current_date;

    insert into user_wallet (user_id, coins) values (v_uid, v_grant)
    on conflict (user_id) do update
      set coins = user_wallet.coins + v_grant, updated_at = now();
  end if;

  return jsonb_build_object('claimed', true, 'coins_granted', v_grant, 'xp', p_xp);
end;
$$;

-- Open a loot box: SERVER-SIDE RNG only. Atomic deduct + weighted roll + pity.
create or replace function public.open_loot_box()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_coins integer;
  v_pity  integer;
  v_total bigint;
  v_roll  numeric;
  v_acc   bigint := 0;
  v_guaranteed boolean;
  v_item  record;
  v_dup   boolean := false;
  v_dust  integer := 0;
  v_cost  constant integer := 100;  -- BOX_COST
  v_pity_n constant integer := 10;  -- PITY_N
  v_dust_table constant jsonb := '{"common":10,"rare":25,"epic":60,"legendary":150}';
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  -- Lock wallet, check + deduct cost atomically.
  insert into user_wallet (user_id) values (v_uid) on conflict do nothing;
  select coins into v_coins from user_wallet where user_id = v_uid for update;
  if coalesce(v_coins, 0) < v_cost then
    return jsonb_build_object('ok', false, 'reason', 'insufficient');
  end if;
  update user_wallet set coins = coins - v_cost, updated_at = now() where user_id = v_uid;

  -- Lock pity.
  insert into user_gacha_state (user_id) values (v_uid) on conflict do nothing;
  select opens_since_epic into v_pity from user_gacha_state where user_id = v_uid for update;
  v_guaranteed := (coalesce(v_pity, 0) + 1) >= v_pity_n;

  -- Candidate pool (guaranteed → epic+ only). Fall back to full pool if empty.
  if v_guaranteed then
    select coalesce(sum(weight), 0) into v_total
    from item_catalog where active and weight > 0 and rarity in ('epic','legendary');
    if v_total = 0 then v_guaranteed := false; end if;
  end if;
  if not v_guaranteed then
    select coalesce(sum(weight), 0) into v_total
    from item_catalog where active and weight > 0;
  end if;

  if v_total = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty_pool');
  end if;

  v_roll := random() * v_total;

  -- Weighted pick by cumulative weight (deterministic order for reproducibility).
  for v_item in
    select id, type, rarity, payload, weight from item_catalog
    where active and weight > 0
      and (not v_guaranteed or rarity in ('epic','legendary'))
    order by id
  loop
    v_acc := v_acc + v_item.weight;
    exit when v_roll < v_acc;
  end loop;

  -- Insert into inventory; duplicate → dust.
  insert into user_inventory (user_id, item_id, source)
  values (v_uid, v_item.id, 'box')
  on conflict (user_id, item_id) do nothing;

  if not found then
    v_dup  := true;
    v_dust := (v_dust_table ->> v_item.rarity::text)::integer;
    update user_wallet set dust = dust + v_dust, updated_at = now() where user_id = v_uid;
  end if;

  -- Pity: reset on epic+, otherwise advance.
  if v_item.rarity in ('epic','legendary') then
    update user_gacha_state set opens_since_epic = 0, total_opens = total_opens + 1 where user_id = v_uid;
    v_pity := 0;
  else
    update user_gacha_state set opens_since_epic = opens_since_epic + 1, total_opens = total_opens + 1 where user_id = v_uid;
    v_pity := coalesce(v_pity, 0) + 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'item_id', v_item.id,
    'type', v_item.type::text,
    'rarity', v_item.rarity::text,
    'payload', v_item.payload,
    'duplicate', v_dup,
    'dust_awarded', v_dust,
    'new_pity', v_pity
  );
end;
$$;

-- Buy a catalog item deterministically with coins or dust.
create or replace function public.buy_item(p_item_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_cost integer;
  v_cur  text;
  v_bal  integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select shop_cost, shop_currency into v_cost, v_cur
  from item_catalog where id = p_item_id and active;
  if v_cost is null then
    return jsonb_build_object('ok', false, 'reason', 'not_for_sale');
  end if;

  if exists (select 1 from user_inventory where user_id = v_uid and item_id = p_item_id) then
    return jsonb_build_object('ok', false, 'reason', 'owned');
  end if;

  insert into user_wallet (user_id) values (v_uid) on conflict do nothing;

  if v_cur = 'dust' then
    select dust into v_bal from user_wallet where user_id = v_uid for update;
    if coalesce(v_bal, 0) < v_cost then
      return jsonb_build_object('ok', false, 'reason', 'insufficient');
    end if;
    update user_wallet set dust = dust - v_cost, updated_at = now() where user_id = v_uid;
  else
    select coins into v_bal from user_wallet where user_id = v_uid for update;
    if coalesce(v_bal, 0) < v_cost then
      return jsonb_build_object('ok', false, 'reason', 'insufficient');
    end if;
    update user_wallet set coins = coins - v_cost, updated_at = now() where user_id = v_uid;
  end if;

  insert into user_inventory (user_id, item_id, source) values (v_uid, p_item_id, 'shop');

  return jsonb_build_object('ok', true, 'item_id', p_item_id);
end;
$$;

-- Equip an owned item. Single-slot for nameplate/frame/banner; badges toggle (max 3).
create or replace function public.equip_item(p_item_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_type   item_type;
  v_badges jsonb;
  v_len    integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if not exists (select 1 from user_inventory where user_id = v_uid and item_id = p_item_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_owned');
  end if;

  select type into v_type from item_catalog where id = p_item_id;
  if v_type is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_item');
  end if;

  if v_type = 'nameplate' then
    update profiles set equipped_nameplate = p_item_id where id = v_uid;
  elsif v_type = 'avatar_frame' then
    update profiles set equipped_avatar_frame = p_item_id where id = v_uid;
  elsif v_type = 'banner' then
    update profiles set equipped_banner = p_item_id where id = v_uid;
  elsif v_type = 'badge' then
    select equipped_badges into v_badges from profiles where id = v_uid;
    v_badges := coalesce(v_badges, '[]'::jsonb);
    if v_badges ? p_item_id then
      v_badges := v_badges - p_item_id;                 -- toggle off
    else
      v_badges := v_badges || to_jsonb(p_item_id);      -- append
      v_len := jsonb_array_length(v_badges);
      if v_len > 3 then                                 -- keep last 3, in order
        select jsonb_agg(e order by ord) into v_badges
        from jsonb_array_elements(v_badges) with ordinality as t(e, ord)
        where ord > v_len - 3;
      end if;
    end if;
    update profiles set equipped_badges = v_badges where id = v_uid;
  end if;

  perform rebuild_cosmetics(v_uid);
  return jsonb_build_object('ok', true);
end;
$$;

-- Clear a cosmetic slot (badges: clears all).
create or replace function public.unequip_slot(p_type item_type)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if p_type = 'nameplate' then
    update profiles set equipped_nameplate = null where id = v_uid;
  elsif p_type = 'avatar_frame' then
    update profiles set equipped_avatar_frame = null where id = v_uid;
  elsif p_type = 'banner' then
    update profiles set equipped_banner = null where id = v_uid;
  elsif p_type = 'badge' then
    update profiles set equipped_badges = '[]'::jsonb where id = v_uid;
  end if;

  perform rebuild_cosmetics(v_uid);
  return jsonb_build_object('ok', true);
end;
$$;

-- ── Realtime: stream own wallet balance changes to the client ───────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_wallet'
  ) then
    alter publication supabase_realtime add table user_wallet;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Seed catalog (CSS-only MVP: colors, gradients, emoji — no hosted assets yet)
-- ════════════════════════════════════════════════════════════════════════════
insert into item_catalog (id, type, rarity, name, payload, shop_cost, shop_currency, weight) values
  -- Nameplates ──────────────────────────────────────────────────────────────
  ('np_crimson',  'nameplate', 'common',    'Crimson Name',  '{"color":"#e74c3c"}',                                   200,  'coins', 60),
  ('np_ocean',    'nameplate', 'common',    'Ocean Name',    '{"color":"#3b82f6"}',                                   200,  'coins', 60),
  ('np_emerald',  'nameplate', 'rare',      'Emerald Name',  '{"color":"#10b981"}',                                   400,  'coins', 30),
  ('np_sunset',   'nameplate', 'epic',      'Sunset Name',   '{"gradient":["#f97316","#db2777"]}',                    150,  'dust',  9),
  ('np_rainbow',  'nameplate', 'legendary', 'Rainbow Name',  '{"gradient":["#ef4444","#eab308","#22c55e","#3b82f6","#a855f7"],"animation":"shimmer"}', null, 'coins', 1),
  -- Avatar frames ───────────────────────────────────────────────────────────
  ('frame_bronze','avatar_frame','common',  'Bronze Frame',  '{"ring":"#cd7f32"}',                                    150,  'coins', 60),
  ('frame_silver','avatar_frame','rare',    'Silver Frame',  '{"ring":"#c0c0c0"}',                                    350,  'coins', 30),
  ('frame_gold',  'avatar_frame','epic',    'Gold Frame',    '{"ring":"#ffd700","effect":"glow"}',                    120,  'dust',  9),
  ('frame_void',  'avatar_frame','legendary','Void Frame',   '{"ring":"#a855f7","effect":"pulse"}',                   null, 'coins', 1),
  -- Badges ──────────────────────────────────────────────────────────────────
  ('badge_fire',  'badge', 'common',    'Fire Badge',    '{"icon":"🔥","label":"On Fire"}',                           100,  'coins', 60),
  ('badge_star',  'badge', 'rare',      'Star Badge',    '{"icon":"⭐","label":"Star"}',                              250,  'coins', 30),
  ('badge_crown', 'badge', 'epic',      'Crown Badge',   '{"icon":"👑","label":"Royalty"}',                           100,  'dust',  9),
  ('badge_diamond','badge','legendary', 'Diamond Badge', '{"icon":"💎","label":"Diamond"}',                           null, 'coins', 1),
  -- Banners ─────────────────────────────────────────────────────────────────
  ('banner_sunset','banner','common',   'Sunset Banner', '{"gradient":["#f97316","#db2777"]}',                        250,  'coins', 60),
  ('banner_ocean', 'banner','rare',     'Ocean Banner',  '{"gradient":["#0ea5e9","#1e3a8a"]}',                        450,  'coins', 30),
  ('banner_aurora','banner','epic',     'Aurora Banner', '{"gradient":["#22c55e","#3b82f6","#a855f7"]}',              150,  'dust',  9),
  ('banner_nebula','banner','legendary','Nebula Banner', '{"gradient":["#ec4899","#8b5cf6","#0ea5e9"]}',              null, 'coins', 1)
on conflict (id) do nothing;
