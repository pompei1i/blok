-- ════════════════════════════════════════════════════════════════════════════
-- Gacha System Upgrade: 90-pity guaranteed legendary + increasing legendary rate
-- Changes:
--   - PITY_N: 10 → 90 (guaranteed legendary on 90th)
--   - Legendary rate increases by 0.5% per pull (capped at 90)
--   - Resets to 0% bonus on legendary (or epic if no legendary in pool)
-- Update sync points:
--   - desktop/src/lib/economy.ts: PITY_N = 90
-- ════════════════════════════════════════════════════════════════════════════

-- Re-declare open_loot_box with new pity system
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
  v_legendary_bonus numeric;
  v_item  record;
  v_dup   boolean := false;
  v_dust  integer := 0;
  v_cost  constant integer := 100;  -- BOX_COST
  v_pity_n constant integer := 90;  -- PITY_N (guaranteed legendary)
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

  -- Guaranteed legendary on 90th pull
  v_guaranteed := (coalesce(v_pity, 0) + 1) >= v_pity_n;

  -- Candidate pool: guaranteed legendary on 90th, otherwise full pool with legendary bonus
  if v_guaranteed then
    -- 90th pull: legendary only
    select coalesce(sum(weight), 0) into v_total
    from item_catalog where active and weight > 0 and rarity = 'legendary';
    if v_total = 0 then v_guaranteed := false; end if;
  end if;

  if not v_guaranteed then
    -- Calculate legendary rate bonus: 0.5% per pull (capped at pull 89)
    v_legendary_bonus := least(coalesce(v_pity, 0), v_pity_n - 1) * 0.005;

    -- Full pool with legendary weight boost
    select coalesce(sum(
      case when rarity = 'legendary' then weight * (1 + v_legendary_bonus) else weight end
    ), 0) into v_total
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
      and (v_guaranteed and rarity = 'legendary' or not v_guaranteed)
    order by id
  loop
    if v_guaranteed then
      v_acc := v_acc + v_item.weight;
    else
      -- Apply legendary bonus
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

  -- Pity: reset on legendary, otherwise advance.
  if v_item.rarity = 'legendary' then
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