-- ════════════════════════════════════════════════════════════════════════════
-- Gacha System Upgrade: two-tier pity (10 epic+, 90 legendary) + increasing rate
-- Changes:
--   - Add opens_since_legendary column to track pulls toward 90-pity guarantee
--   - Epic pity at 10: resets opens_since_epic on epic+
--   - Legendary pity at 90: resets opens_since_legendary on legendary
--   - Legendary rate increases 0.5% per pull (pulls 1-89)
-- Update sync points:
--   - desktop/src/lib/economy.ts: PITY_N = 90
-- ════════════════════════════════════════════════════════════════════════════

-- Add legendary pity tracker (separate from epic pity)
alter table user_gacha_state
  add column if not exists opens_since_legendary integer not null default 0;

-- Re-declare open_loot_box with two-tier pity system
create or replace function public.open_loot_box()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_coins integer;
  v_epic_pity integer;
  v_leg_pity integer;
  v_total bigint;
  v_roll  numeric;
  v_acc   bigint := 0;
  v_is_epic_guaranteed boolean;
  v_is_leg_guaranteed boolean;
  v_legendary_bonus numeric;
  v_item  record;
  v_dup   boolean := false;
  v_dust  integer := 0;
  v_cost  constant integer := 100;  -- BOX_COST
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

  -- Lock pity state.
  insert into user_gacha_state (user_id) values (v_uid) on conflict do nothing;
  select opens_since_epic, opens_since_legendary
    into v_epic_pity, v_leg_pity
  from user_gacha_state where user_id = v_uid for update;
  v_epic_pity := coalesce(v_epic_pity, 0);
  v_leg_pity := coalesce(v_leg_pity, 0);

  -- Determine guaranteed status: legendary at 90, epic+ at 10
  v_is_leg_guaranteed := (v_leg_pity + 1) >= 90;
  v_is_epic_guaranteed := (v_epic_pity + 1) >= 10 and not v_is_leg_guaranteed;

  -- Build candidate pool based on guarantee status
  if v_is_leg_guaranteed then
    -- 90-pull pity: legendary only
    select coalesce(sum(weight), 0) into v_total
    from item_catalog where active and weight > 0 and rarity = 'legendary';
    if v_total = 0 then v_is_leg_guaranteed := false; end if;
  end if;

  if v_is_epic_guaranteed and not v_is_leg_guaranteed then
    -- 10-pull pity: epic+ only
    select coalesce(sum(weight), 0) into v_total
    from item_catalog where active and weight > 0 and rarity in ('epic','legendary');
    if v_total = 0 then v_is_epic_guaranteed := false; end if;
  end if;

  if not v_is_leg_guaranteed and not v_is_epic_guaranteed then
    -- Regular odds: full pool with legendary rate bonus (0.5% per pull)
    v_legendary_bonus := v_leg_pity * 0.005;
    select coalesce(sum(
      case when rarity = 'legendary' then weight * (1 + v_legendary_bonus) else weight end
    ), 0) into v_total
    from item_catalog where active and weight > 0;
  end if;

  if v_total = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty_pool');
  end if;

  v_roll := random() * v_total;

  -- Weighted pick with appropriate pool
  for v_item in
    select id, type, rarity, payload, weight from item_catalog
    where active and weight > 0
      and (v_is_leg_guaranteed and rarity = 'legendary'
           or v_is_epic_guaranteed and rarity in ('epic','legendary')
           or not v_is_leg_guaranteed and not v_is_epic_guaranteed)
    order by id
  loop
    if v_is_leg_guaranteed or v_is_epic_guaranteed then
      v_acc := v_acc + v_item.weight;
    else
      v_acc := v_acc + (case when v_item.rarity = 'legendary'
                             then v_item.weight * (1 + v_legendary_bonus)
                             else v_item.weight end);
    end if;
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

  -- Update pity: epic+ resets epic pity, legendary resets legendary pity.
  if v_item.rarity = 'legendary' then
    update user_gacha_state
    set opens_since_epic = 0, opens_since_legendary = 0, total_opens = total_opens + 1
    where user_id = v_uid;
    v_leg_pity := 0;
    v_epic_pity := 0;
  elsif v_item.rarity = 'epic' then
    update user_gacha_state
    set opens_since_epic = 0, opens_since_legendary = opens_since_legendary + 1, total_opens = total_opens + 1
    where user_id = v_uid;
    v_epic_pity := 0;
    v_leg_pity := coalesce(v_leg_pity, 0) + 1;
  else
    update user_gacha_state
    set opens_since_epic = opens_since_epic + 1, opens_since_legendary = opens_since_legendary + 1, total_opens = total_opens + 1
    where user_id = v_uid;
    v_epic_pity := coalesce(v_epic_pity, 0) + 1;
    v_leg_pity := coalesce(v_leg_pity, 0) + 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'item_id', v_item.id,
    'type', v_item.type::text,
    'rarity', v_item.rarity::text,
    'payload', v_item.payload,
    'duplicate', v_dup,
    'dust_awarded', v_dust,
    'new_pity', v_leg_pity
  );
end;
$$;