# Changelog

## [0.9.17] — 2026-06-13

### Accessibility
- **Secondary-text contrast** — `--text-muted` raised from `#666` to `#8a8a8a` (dark theme) / `#595959` (light theme): contrast on the base background went from ~3.4:1 to ~5.7:1, now passing WCAG AA. Placeholders no longer use the near-invisible `#444`/`#333` and instead inherit the token
- **Font legibility** — removed every 8–10px size (146 occurrences); established an **11px** floor (micro-labels: rarity, level badges, slider ticks) / **12px** (small content: balances, hints, activity)
- **Visible keyboard focus** — added a global `:focus-visible` ring (focus was previously invisible because of `focus:outline-none`); the rule lives outside `@layer` so it overrides utility classes
- **Respect `prefers-reduced-motion`** — when enabled, the infinite/decorative animations are disabled (scrolling terminal grid, blinking cursor, shimmer, bounce, pulse) — vestibular safety and battery savings

### Fixed
- **Light theme** — removed hardcoded `white` in hover/focus borders and hover text that made actions (log out, close, input focus) invisible on a light background; introduced an adaptive `--border-strong` token (white-alpha in dark theme, black-alpha in light theme)

### Changed
- **Multiline message input** — the chat composer is now an auto-growing `textarea` (up to ~6 lines, then scrolls): **Enter** sends, **Shift+Enter** inserts a newline (previously a single-line `input` with no line breaks)

## [0.9.16] — 2026-06-12

### Added
- **Economy & gacha** — completing daily quests now awards **coins** (🪙, global wallet) in addition to XP. A store with three sections:
  - **Box** — a loot box for 🪙100: random cosmetic by rarity weights, **pity** (guaranteed Epic+ on the 10th open without one), duplicates turn into **dust** (✦)
  - **Shop** — deterministic purchase of a specific item for coins or dust
  - **Inventory** — slot-based ownership with one-click equip/unequip
- **Profile cosmetics (4 types)** — drop from the box and are sold in the shop:
  - **Nameplate** — username color/gradient (visible in chat, member list, UserBar); legendary has a shimmer animation
  - **Avatar frame** — colored ring/glow around the avatar (everywhere an avatar appears)
  - **Badge** — collectible emoji badges on the profile card (up to 3 at once)
  - **Banner** — gradient header on the profile card (finally uses the `banner_url` field)
- Cosmetics are **visible to other players live** — equipment is denormalized into `profiles.cosmetics` and arrives via the existing Realtime subscription on `profiles`, with no new joins
- **Quick access from the bottom bar** — 📜 quests and 🛍 store icons next to settings open them as modals (plus a `store` tab in the right sidebar). The 🪙/✦ balance is shown in UserBar under the level and is clickable
- **Toast notifications** — when a quest is completed (progress reaches the goal), a "Quest complete!" toast with the reward appears in the bottom-right corner; auto-dismiss after 5 s
- **Full localization** of the economy, store, and quest toasts in 6 languages (EN/RU/UK/PL/DE/ES)

### Fixed
- **XP now updates in real time** — there was no Realtime subscription on `server_members`, so XP/level only changed after a reload. Added a `public:server_members` subscription
- **Daily quest progress in real time** — the `daily_quest_progress` and `server_members` tables were not in the `supabase_realtime` publication, so events never arrived; they were added to the publication

### Security / Anti-abuse
- All RNG and currency spending happen **server-side only** in `SECURITY DEFINER` RPCs; the client cannot forge a roll or a balance (`FOR UPDATE` on the wallet row)
- **Global daily cap** on coin earning (`daily_coin_earn`, PK without `server_id`) — protects against farming via self-created servers, since quests are per-server while the wallet is global
- All new tables are under RLS: clients get only `SELECT own` / `SELECT active`, mutations exclusively through RPCs

### Database
- `user_wallet` (coins + dust), `item_catalog`, `user_inventory`, `user_gacha_state` (pity), `daily_coin_earn` (global cap)
- Columns on `profiles`: `equipped_nameplate/avatar_frame/banner`, `equipped_badges`, `cosmetics` (jsonb snapshot)
- RPCs: `claim_quest_reward`, `open_loot_box`, `buy_item`, `equip_item`, `unequip_slot`, `rebuild_cosmetics` (migration `20260611_economy.sql`)
- Realtime publication: `user_wallet`, `daily_quest_progress`, `server_members` (migrations `20260611_economy.sql` + `20260611_realtime_progress.sql`)

> ⚠️ Migrations `supabase/migrations/20260611_economy.sql` and `20260611_realtime_progress.sql` must be applied to the Supabase project (they are not applied automatically).

## [0.9.15] — 2026-06-10

### Fixed
- **Screen share: black screen for late joiners** — with a static image the native capture deduplicates identical frames, so a new viewer received nothing until the next screen change. The last frame is now cached and sent to the viewer immediately when they open the channel
- **Screen share: picture breakup when a new participant joins** — `screenshare_start` is now idempotent: already-connected viewers don't recreate the connection when a third participant joins the channel
- **Screen share: frame buildup and reordering on the viewer** — decoding moved to `createImageBitmap` with coalescing (newest-wins, one decode at a time) instead of `Blob`+`Image`+`createObjectURL` per frame; less GC pressure, no frame desync
- **Screen share: `tauri://move` listener leak** on rapid start/stop of sharing
- **Screen share: the browser "Stop sharing" button** now correctly ends sharing and resets the `isScreenSharing` state
- **Message realtime could fail** — cleanup of old channels ran after creating the new subscriptions and killed them; cleanup now runs strictly before `initMessageRealtime`/`initPollRealtime`
- **Push-to-talk captured the spacebar while typing** — a space in an input field no longer toggles the microphone
- **DM realtime channel leak** on re-login, and `profile-self-*` channel leak on logout
- **Kick/role assignment didn't work for a just-invited member** — the local member was created with a synthetic id instead of the id from the DB
- **Login: fixed 500 ms delay** replaced with profile polling and backoff — a typical login is faster

## [0.9.14] — 2026-06-08

### Added
- **XP + Levels** — every message gives +5 XP. Levels 1–10+ with color tiers (gray → blue → purple → gold). A level badge next to the username in the member list; a progress bar on the profile card and UserBar
- **Rich Presence** — the `+ set activity` button in UserBar opens a picker with 6 presets (Gaming, Listening, Studying, Working, Watching, AFK). Activity syncs in real time and is shown next to the username
- **Daily Quests** — a new "quests" tab in the right sidebar. 3 daily quests: Send 5 messages (+50 XP), Send 15 messages (+100 XP), React to 5 messages (+75 XP). Progress is counted automatically via DB triggers; the "Claim XP" button atomically grants the reward
- **Profile card redesign** — a new layout with a level badge on the avatar, a presence pill, an XP progress bar under the name, and Message and Call buttons for other users' profiles
- **Friends list: Online/Offline sections** — friends are split into Online/Offline with collapse support. A context menu (right-click) with View Profile, Message, Call, Invite to Server, Remove Friend
- **Disabled the system context menu** — right-click on empty areas no longer opens the Chromium browser menu

### Fixed
- The profile card showed "Online" from the `statusMessage` field instead of the real presence status

### Database
- `server_members.xp INTEGER DEFAULT 0` + `trg_message_xp` trigger (+5 XP per message)
- `user_presence.activity TEXT` for rich presence
- `daily_quest_progress`, `daily_quest_claims` tables + triggers and the `claim_quest_xp` RPC
