-- New nameplate cosmetics with glow / neon / flame / glitch effects.
-- Payload keys read by lib/economy.ts nameplateStyle():
--   {color, effect:"glow"|"neon"}         → solid color + text-shadow
--   {gradient[], animation:"flame"}        → warm animated gradient text
--   {color, animation:"glitch"}            → chromatic-aberration jitter

insert into item_catalog (id, type, rarity, name, payload, shop_cost, shop_currency, weight) values
  ('np_glow_cyan', 'nameplate', 'rare',      'Cyan Glow',  '{"color":"#22d3ee","effect":"glow"}',                                        400, 'coins', 30),
  ('np_neon_pink', 'nameplate', 'epic',      'Neon Pink',  '{"color":"#ec4899","effect":"neon"}',                                        120, 'dust',  9),
  ('np_flame',     'nameplate', 'epic',      'Flame',      '{"gradient":["#fbbf24","#f97316","#ef4444","#f97316","#fbbf24"],"animation":"flame"}', 130, 'dust', 9),
  ('np_glitch',    'nameplate', 'legendary', 'Glitch',     '{"color":"#e2e8f0","animation":"glitch"}',                                   null, 'coins', 1)
on conflict (id) do nothing;
