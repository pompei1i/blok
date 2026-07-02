# Changelog

## [0.9.41] — 2026-07-02

### Added
- **Two-tier gacha pity**: guaranteed Epic+ every 10 opens, guaranteed Legendary
  every 90 — with the legendary rate climbing 0.5% per open in between. Two
  separate pity meters in the loot-box UI (purple for Epic, gold for Legendary).
- Equipped cosmetics (nameplate color/FX, avatar frame, banner) now preview live
  in the Account settings header, not just on the public profile card.

### Changed
- **Lower audio overhead**: voice capture/playback moved from JSON frame arrays
  over Tauri's event bus to a binary IPC channel; per-user volume is now applied
  natively in Rust instead of JS. Wire format to peers is unchanged.
- **Faster boot on large servers**: initial load no longer joins every member's
  profile — profiles hydrate lazily per server (chunked, deduped) instead of
  inflating the bootstrap payload.
- Settings modal: the 1249-line account editor is now a thin shell over
  per-tab components; Security (password) is its own tab, split out of Account.

### Fixed
- **Production security/audit pass**: server mutations (rename, icon, invite
  rotation) are now RPC-only; message/DM content and rate limits enforced
  server-side; member kicks/bans/leaves propagate live instead of needing a
  refresh; optimistic-send/reaction race conditions resolved; voice connections
  auto-rebuild on ICE failure and after reconnect; DM attachments and avatars
  moved off base64-in-row to Storage.
- Rejected sends (rate limit, slowmode, message too long) now surface a toast
  instead of failing silently; stale frozen screen shares are reconciled
  against live voice presence.

## [0.9.40] — 2026-06-28

### Fixed
- **Screen share / camera / voice now connect across NATs.** The Cloudflare TURN
  relay was misconfigured server-side (a stale TURN key id → the `turn` Edge
  Function returned no credentials), and the client silently fell back to a dead
  public relay. Calls only ever worked when a direct P2P path existed, so the
  relay never engaged for peers behind strict/symmetric NAT. Rotated to a fresh
  Cloudflare TURN key; relay now reachable over UDP, TCP and TLS/443.

### Added
- **Connection test** (Settings → Audio, beta) — gathers ICE and confirms a TURN
  `relay` candidate is reachable, so relay health can be verified in the production
  build without DevTools. Distinguishes a working relay from the openrelay fallback.

### Changed
- **Lower voice latency.** Native audio now streams over a per-peer WebRTC
  DataChannel (unordered, no retransmits) instead of the Supabase Realtime
  broadcast relay, removing a server round-trip from every audio frame. Frame size
  100 ms → 40 ms and the playback jitter buffer cap 2 s → 150 ms.
- **b.ai.t beta cap surfaced** — a rolling 24h "left today" counter; admin accounts
  are exempt (server + client). New signups auto-join the official "blok off" server.
- A `BLOK_MULTI` env opt-in (+ `run-second-instance.bat`) launches a second isolated
  instance for local multi-user testing; normal launches stay single-instance.

## [0.9.32] — 2026-06-27 — hotfix

### Fixed
- **Severe in-call lag / broken screen share / higher voice latency** introduced
  in v0.9.31. The new speaking indicator animated a CSS `blur()` filter on
  avatars; during a call (avatars toggling speaking many times/sec) this thrashed
  the GPU compositor and starved the main thread, which handles incoming audio
  chunks and WebRTC/ICE signaling — so voice lagged and screen share failed to
  connect (a silent timeout, hence no error). Replaced the blur with a cheap dark
  overlay + loudspeaker icon (no GPU filter).
- **Screen-share icon no longer lingers** after stopping the share via the native
  "Stop sharing" button: the participant entry and presence are now cleared (and
  the stop broadcast to others), not just the local flag.

## [0.9.31] — 2026-06-26

### Added
- **Full emoji picker** — ~1800 emojis across 8 categories with search by name /
  keyword, powered by `@emoji-mart/data` (lazy-loaded, so the dataset only
  downloads when the picker is first opened). Replaces the old ~150 hardcoded set.
- **Mute / deafen hotkeys** — Ctrl+Shift+M toggles the mic, Ctrl+Shift+D toggles
  deafen; both listed in Settings → Hotkeys and shown in the button tooltips' a11y names.
- **Quest feedback** — a sound plays when a daily quest completes, and the quests
  button shows a red ring while a reward is unclaimed.

### Changed
- **Monochrome UI** — decorative color emojis in the interface (quests, toasts,
  coin rewards, announcement notifications) are now monochrome icons. Reactions
  and message content keep color emojis.
- **Speaking indicator** — instead of a green ring, a speaking avatar now blurs
  and shows a centered loudspeaker icon.
- **Presence dots** convey status by shape as well as color (online ●, offline ○,
  dnd ⊝, away ◐), so dnd/offline are distinguishable and color-blind safe.
- **Readability** — separate readable red/green text tokens (≥4.5:1) for errors
  and status; aligned the three column headers into one divider line; larger user
  avatar; removed the divider above the user bar.
- **No native tooltips** — all `title` hover tooltips replaced with `aria-label`
  (no browser tooltip chrome; screen-reader names preserved).
- **Removed the badges cosmetic type** entirely (customization rework).
- Minimum window size so the layout no longer breaks when shrunk.

### Fixed
- **Chat wallpaper** now covers the whole scrollable area instead of staying
  pinned to the top and disappearing as you scroll.
- Horizontal alignment of the b.ai.t input / body.

## [0.9.30] — 2026-06-25

### Added
- **Channel categories (sections)** — group text *and* voice channels under a
  category; create / rename (double-click) / delete (channels move out, not
  deleted) / collapse. Each category has its own "+" to add a channel into it.
- **Drag-and-drop** — reorder channels up/down and between categories (including
  the uncategorized bucket), and reorder the categories themselves. Native HTML5
  DnD, no new dependencies.

### Changed
- **Daily message-XP cap** — 100 XP/day per (user, server) so messages can't be
  spammed to farm levels. The +5/message reward is unchanged below the cap.
- **Single-instance only** — removed the dev-only `BLOK_MULTI` multi-instance
  opt-in; a second launch now always just focuses the existing window.

### Performance (architecture review)
- **DB indexes** — composite `messages(channel_id, created_at desc)` for the
  hottest query, plus the missing FK indexes most hit by RLS membership checks
  (`server_members`, `channels`, `categories`, `messages`, `user_relationships`).
- **Scoped presence** — fetch presence only for people the UI shows (friends ∪
  co-server-members ∪ self) instead of every user in the database; realtime
  ignores churn from unrelated users.
- **Scoped store selectors** — six heavy components (chat, sidebars, voice view,
  top bar) no longer re-render on unrelated store churn.
- **Incremental friends graph** — friend request/accept/decline/remove no longer
  re-fetch the entire relationship + presence graph; changes apply incrementally.
- **Dead code removed** — ~850 lines (unused browser voice engine + landing page).

## [0.9.27] — 2026-06-25

### Fixed
- Voice channels can now be deleted (gated by manage permission).
- Right-click a voice participant or a screen share to set per-user/per-share volume (0–200%).
- Sidebar member context menu actions (mention, invite) now actually work.
- Screen-share overlay supports a grid view for multiple concurrent shares, and resumes video correctly after window minimize/restore.
- Join/leave/watching sounds are synthesized via Web Audio instead of shipped mp3s.
- Removed dead screen-share source-picker code (UI + native Rust scaffolding) that was never wired up.

### Security
- **`servers` table RLS** — non-members could see metadata for every server in the database (not just ones they belonged to). Reads are now scoped to membership.

### Known issue — signing key rotation
The updater's signing key pair was rotated in this release. **This was a mistake born from an incorrect diagnosis**: the previous key (set up correctly back in v0.2.17) was assumed broken based on a local-build-only warning, and was overwritten in GitHub Secrets without verifying that assumption — the old private key is now unrecoverable.

Practical effect: anyone running v0.9.26 or earlier cannot auto-update past this point; one **manual** download+install of v0.9.27 is required. From v0.9.27 onward, auto-update works normally again (same situation, and same fix, as the v0.2.17 incident). See [docs/SIGNING.md](docs/SIGNING.md).

## [0.9.26] — 2026-06-23

### Security
- **RLS hardening (F1)** — private messages were readable across users, and channel messages / member lists / categories leaked across servers you'd never joined; profiles were even scrapeable by unauthenticated clients. All reads are now scoped to server membership / DM participants.
- **`server_members` lockdown** — joining by invite, inviting, role assignment and kicking went straight to the table with only client-side checks (any user could self-promote to admin, join past invite limits, or kick anyone). These now run through permission-checked `SECURITY DEFINER` RPCs.
- **Quest rewards validated server-side** — the reward amount and completion target now come from a server catalog instead of being trusted from the client.
- **Message edit/delete** restricted to the author (plus the server owner, for moderation); **DM call signals** scoped to the recipient instead of a shared channel; the redundant **`profiles.email`** column (a PII leak) was dropped.

### Added
- **Change password** in account settings.
- **Forgot password** — reset via an emailed code on the login screen.

### Changed
- **TURN relay** for screen share / video now uses **Cloudflare TURN** via a credentials Edge Function — short-lived credentials minted server-side, no static TURN secrets in the client.

### Meta
- Project **open-sourced under AGPL-3.0**.

## [0.9.18] — 2026-06-15

### Added
- **Multi-line composer** — the message input is now an auto-growing `textarea` (grows up to ~6 lines): **Enter** sends, **Shift+Enter** inserts a newline
- **Custom chat background** — removed the default ASCII grid behind messages; a new **Settings → Theme** control lets you upload an image (compressed to ≤1280px, stored as a data URL) or paste an image URL. The image renders behind the message list at reduced opacity for readability; the setting persists
- **Custom theme mode** — the theme picker now offers **Dark / Light / Custom**. Custom CSS is applied **only** while the `Custom` theme is selected, so you can swap between the built-in themes and your own without deleting your CSS
- **`kube` loot boxes** — the loot box is rebranded **kube** with a new **low-poly red cube** icon (shaded off `--accent-red`, so it re-colours with the theme). A custom **low-poly gold coin** icon replaces the `🪙` emoji in balances, the store, and the open button
- **Store / economy redesign** — item cards get a rarity accent bar, hover lift and a rarity-aware "equipped" state; currency chips in the header; a framed kube with a **possible-drops** rarity legend; accent-underline sub-tabs

### Changed
- **Tighter, consistent message spacing** — server message rows are no longer inflated by the hover action buttons (moved to an absolute overlay), so a single-line message is a single line tall; corrected the virtualizer height estimates and removed double padding
- **Members / Friends sidebar** — dropped the redundant `quests` / `store` tabs (both still open from the user bar), aligned the panel width with the channel sidebar, and tightened the secondary-text scale (11px headers / 12px names / 10px meta)
- **Loading screen** — added the `you're not blocked. you're Bloked` tagline and removed the animated scrolling grid from the bootstrap screen

### Fixed
- **Push-to-talk** — Space now calls `preventDefault`, so holding it to talk no longer scrolls the view or activates a focused button
- **Auth screen** no longer force-resizes the OS window (it was shrinking / clobbering the user's window size on every login and logout)
- **Light theme** — restored the higher-contrast `--text-muted` (`#595959`) and focus `--ring` (`#555555`)

### Accessibility
- Modals (settings, join-by-code) now expose `role="dialog"` + `aria-modal` and close on **Escape**; icon-only message actions got `aria-label`s

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
