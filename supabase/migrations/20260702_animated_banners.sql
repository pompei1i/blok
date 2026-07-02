-- New animated / textured profile banners.
-- Payload keys read by lib/economy.ts bannerBackground() + bannerClass():
--   {gradient[], animation:"shift"}   → gradient scrolls (CSS keyframe banner-bg-shift)
--   {gradient[], overlay:"dots"|"grid"} → static texture layer over the gradient
--   {gradient[], overlay:"noise"}     → SVG feTurbulence grain over the gradient

insert into item_catalog (id, type, rarity, name, payload, shop_cost, shop_currency, weight) values
  ('banner_pulse',  'banner', 'rare',      'Pulse',     '{"gradient":["#0ea5e9","#7c3aed","#0ea5e9"],"animation":"shift"}',  450, 'coins', 30),
  ('banner_dotgrid','banner', 'epic',      'Dot Grid',  '{"gradient":["#f43f5e","#a855f7"],"overlay":"dots"}',               150, 'dust',  9),
  ('banner_static', 'banner', 'legendary', 'Static',    '{"gradient":["#1e1b4b","#4c1d95","#831843"],"overlay":"noise"}',    null, 'coins', 1)
on conflict (id) do nothing;
