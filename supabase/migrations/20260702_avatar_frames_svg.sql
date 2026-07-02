-- Upgrade existing avatar frames to SVG shape system.
-- Old "ring"/"effect" payloads are replaced with "shape"/"color" payloads.
-- The client rendering code falls back gracefully for any profiles.cosmetics
-- JSONB snapshots that still carry the old payload (re-equip refreshes them).

update item_catalog set payload = '{"shape":"ring","color":"#cd7f32"}'
  where id = 'frame_bronze';

update item_catalog set payload = '{"shape":"ring","color":"#c0c0c0"}'
  where id = 'frame_silver';

update item_catalog set payload = '{"shape":"crystal","color":"#ffd700"}'
  where id = 'frame_gold';

update item_catalog set payload = '{"shape":"orbit","color":"#a855f7","color2":"#c084fc"}'
  where id = 'frame_void';

-- New rare frame: hexagonal outline.
insert into item_catalog (id, type, rarity, name, payload, shop_cost, shop_currency, weight)
values (
  'frame_hextech',
  'avatar_frame',
  'rare',
  'Hextech',
  '{"shape":"hex","color":"#60a5fa"}',
  380,
  'coins',
  30
) on conflict (id) do nothing;
