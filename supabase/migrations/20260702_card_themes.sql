-- Legendary-exclusive perk: banners with a `theme` payload recolor the entire
-- profile card, not just the banner strip. Read by lib/economy.ts bannerTheme().
-- The theme vars (--bg-elevated / --bg-surface / --border) cascade to every
-- child of the card. Presets are dark so the existing light text stays legible.

-- Nebula (existing legendary) → Void card + gentle gradient shift.
update item_catalog
set payload = '{"gradient":["#ec4899","#8b5cf6","#0ea5e9"],"animation":"shift","theme":{"bg":"#0d0516","surface":"#1a0f2e","border":"#7c3aed","hover":"#241542"}}'
where id = 'banner_nebula';

-- Static (legendary, added in 20260702_animated_banners) → matching dark card.
update item_catalog
set payload = '{"gradient":["#1e1b4b","#4c1d95","#831843"],"overlay":"noise","theme":{"bg":"#0a0618","surface":"#16092e","border":"#6d28d9","hover":"#1f1140"}}'
where id = 'banner_static';
