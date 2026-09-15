# Changelog

## [0.9.54] — 2026-09-15

### Fixed
- **Changing the share's source no longer ends it.** Picking a source again
  mid-share — including the same window with another frame rate, resolution or
  audio setting — could stop the share on your side after a few seconds and
  leave viewers on a frozen frame. A stop meant for the old capture could be
  handled after the new one had started and kill it; stops now only ever end
  the capture they were issued for.
- **Window shares follow the window's size.** Resizing a shared window kept
  sending the area it had when the share started, cutting off a grown window.
  The share now tracks the window's size, live while you drag.
- **60fps shares actually run at 60fps.** Windows delivered window frames at
  most every 16ms, which on a 144Hz display meant ~48fps, and the capture loop
  drifted against the display and dropped a frame every second or so (~56fps
  on 60Hz). Both are fixed.

### Changed
- **Screen share encoding is about a third faster**, and your own preview of
  what you're sharing updates at ~15fps instead of every frame, leaving more
  CPU for the encoder and the app you're sharing. What viewers receive is
  unchanged.

## [0.9.53] — 2026-09-14

### Fixed
- **Sharing one window shares only that window's sound.** Desktop audio on
  Windows recorded everything playing on the speakers, so viewers heard every
  other app too. A window share now records just the app that owns the window
  (a browser's audio included), and a monitor share records everything except
  blok itself — so the other people in the call no longer hear their own voices
  echoed back through your share. Switching the shared window mid-share moves
  the audio with it. On Windows 10 before build 20348 the old whole-system audio
  is used, since per-app capture isn't available there.
- **People you can hear no longer vanish from the voice channel list.** The list
  came from Realtime Presence alone, so if someone's presence entry got lost
  (a slow network moment, a reconnect) they dropped off the list the next time
  anyone muted or unmuted, while their voice kept playing. Anyone you have a live
  connection to now stays listed, and each client notices within seconds when
  its own entry is missing and re-announces itself, so it shows up again for
  everyone.

## [0.9.52] — 2026-09-14

### Added
- **Per-channel permissions.** Right-click a channel → *Permissions* to set
  *View channel*, *Send messages* and *Connect* per role, plus an @everyone
  baseline. A role's own setting wins over @everyone; the server owner and
  anyone with MANAGE_SERVER always keep access, so a channel can't be locked
  with nobody able to fix it. Hidden channels disappear from the sidebar, a
  channel you can't post in shows a read-only composer instead of failing the
  send, and changes apply live without a reload. Reading and sending are enforced
  by the database; voice *Connect* is checked before joining.

### Fixed
- **Online status is accurate again.** Everyone dropped to offline about 90s
  after launch: the heartbeat that kept a user online was built but never
  actually sent. Status now comes from Supabase Realtime Presence: you are
  online while any of your connections is up, a crash or sleep shows as
  offline within seconds instead of ~1.5 min, and it updates without needing a
  re-render. The socket heartbeat runs in a Web Worker so blok minimized to the
  tray stays online. Older versions can't see newer ones as online (and the
  reverse) until everyone updates.
- **Auto-translate works again.** Messages showed "translating…" and then
  nothing. The primary Gemini model was overloaded and there was no fallback.
  Translation and b.ai.t now fall back across `gemini-3.6-flash` →
  `gemini-3.5-flash` → `gemini-flash-lite-latest`. The token budget is raised so
  the models' reasoning can't cut the reply short, and a truncated reply moves on
  to the next model instead of counting as a success.

## [0.9.51] — 2026-09-01

### Fixed
- **The desktop-audio tick no longer clears once a share is running.** Whether
  audio was on was read back from the share's `MediaStream`, but desktop audio
  never becomes a track on it — it is captured in Rust and sent straight over the
  native transport. The answer was therefore always "no": reopening the picker to
  switch source showed the box unticked, and re-picking the same audio setting
  looked like a change and forced a needless restart of the share. The share now
  tracks its own audio state.
- A desktop-audio capture that fails to start now clears that state too, so the
  picker stops offering to keep audio the share doesn't actually have.

### Changed
- Desktop audio logs its level every 5s (`[desktop-audio] N samples/s @ 48000Hz,
  peak P`). It is deliberately never played back locally — the sharer already
  hears it — so there was previously no way to tell a silent capture from one
  that never started without asking a viewer.

## [0.9.50] — 2026-09-01

### Fixed
- **Screen shares have sound on Windows again.** Desktop-audio capture was
  implemented only for Linux; the Windows branch returned an error, so ticking
  "share desktop audio" did nothing at all. That was correct back when Windows
  shared through `getDisplayMedia`, which carried system audio itself, but the
  native picker replaced it on both platforms and the error was never revisited.
  Windows now captures a WASAPI loopback stream from the default output device
  and fans it out to peers like the Linux path does.
- **The "share desktop audio" tick is remembered.** It reset to unchecked on
  every new share because the picker had no saved state to fall back on — only a
  mid-share source switch passed the live value. It is now a persisted setting,
  while a source switch still wins with the share's actual state.
- **Resolution changes sharpness, not size.** Picking 720p made the picture
  smaller instead of softer: the video element was capped at its natural size, so
  a lower-resolution frame simply drew smaller inside the same panel. It now fills
  the panel at every resolution, with the aspect ratio preserved.

## [0.9.49] — 2026-09-01

### Added
- **Real fullscreen for screen shares.** The fullscreen button used the browser's
  element fullscreen, which only fills the webview — inside the desktop app the
  window frame and taskbar stayed on screen, so it never actually went full
  screen. It now drives the app window itself, and the overlay drops its inset,
  border, rounding and header so the picture reaches every edge of the display.
  Escape leaves, and a dimmed exit button sits in the corner for the mouse.
- The fullscreen button is available in every view. It used to appear only while
  watching a single remote stream, so your own share and the multi-person grid —
  the cases people reach for most — had no way to go fullscreen at all.

### Fixed
- Leaving a share no longer strands the window in fullscreen, and exiting restores
  a fullscreen the user had set up themselves rather than forcing the window back
  to a normal size.

## [0.9.48] — 2026-09-01

### Fixed
- **Sharing a single window actually shows the window.** It was not slow — it was
  blank: GDI cannot read a composited window's content, so anything drawn by the
  GPU (browsers, Electron apps, games) came back as a black surface that never
  changed. The frame-hash dedup then suppressed every frame, leaving viewers with
  a black or frozen share. Windows now capture through Windows.Graphics.Capture,
  which asks the compositor for the window's own content and works for occluded
  and GPU-rendered windows alike, at ~6ms a frame. Measured against the old path
  on the same windows: 100% black and one distinct colour before, full-colour
  frames after. Windows without WGC (pre-1903) keep the previous path.
  Complements 0.9.47, which fixed the monitor half.
- The capture window's yellow "recording" border is suppressed, so it isn't burned
  into the frames viewers see, and the frame pool is rebuilt when the shared window
  is resized instead of continuing to deliver the old dimensions.

## [0.9.47] — 2026-09-01

### Fixed
- **Screen share now actually reaches the frame rate you picked.** Choosing 60fps
  delivered 22-31. Two stages were each too slow to fit a 16.7ms frame: capture
  went through GDI `BitBlt` off the screen DC, which costs 22-32ms on a composited
  desktop, and JPEG encoding ran on a single thread at ~35ms for 1080p. Windows
  monitor capture now uses DXGI Desktop Duplication (~4ms, reading the frame the
  compositor already built), and encoding runs on a pool of 2-4 workers. Measured
  ceiling on a 1080p share went from ~26fps to ~179fps. Window shares, Linux, and
  any machine where duplication won't initialise keep the previous capture path —
  now with the encoder pool behind it.
- **b.ai.t no longer fails on a routine upstream hiccup.** The retry only knew
  Anthropic's 529 overload code, left over from before the proxy moved to Gemini,
  whose overload is a 503 — so every "this model is experiencing high demand" spike
  went straight to the user as a wall of raw JSON. Transient failures are now
  retried in the proxy (where it also stops a dead request from burning a daily
  quota slot) and in the client, and the proxy falls back through less contended
  Gemini Flash models rather than hammering an overloaded one. Overload now reads
  as a sentence instead of an error dump.
- **GIF picker works in released builds.** The client reads `VITE_GIPHY_API_KEY`,
  but the release workflow passed `VITE_TENOR_API_KEY` — a name left behind by the
  move from Tenor to GIPHY, and one that was never set as a secret. GIF search had
  therefore never worked in a shipped build. The workflow, `.env.example`, both
  READMEs and the release guide now all agree on the GIPHY name.

### Changed
- The screen-share throughput log reports per-stage timings
  (`59 fps sent (capture 4.2ms, encode 22.4ms x4 workers)`), so a low rate caused
  by an idle screen is distinguishable from a stage that can't keep up.

### Documentation
- New reader-facing guides: getting started, user guide, FAQ, troubleshooting and
  a project overview, with the README rewritten to lead into them.

## [0.9.46] — 2026-08-11

### Added
- **Realtime message translation** — messages written in another language are
  translated into your UI language as they arrive, in every text chat (channels,
  DMs, group DMs), with a "show original" toggle under each one. Off by default:
  Settings → Language → Message Translation. Runs on Gemini through a new
  `translate` Edge Function; translations are cached per (message, language) and
  shared across everyone in the channel, so a message is paid for once rather
  than once per reader. Messages already in your language are skipped before any
  network call, and the client sends message ids — never text — so content is
  read back under your own RLS. Accuracy comes from context: the model gets the
  preceding messages of the conversation plus the author's pronouns, which is
  what keeps gendered forms and ellipsis correct in Slavic languages.

### Changed
- CSP now allows Tauri's IPC origins (`ipc:`, `http://ipc.localhost`) in
  `connect-src`.
- Project documentation for open source: screenshots, an architecture guide, a
  self-hosting walkthrough, contribution and security policies, issue and PR
  templates. Two stale claims corrected — builds ship for Windows **and** Linux,
  and voice no longer travels over Supabase Realtime (since the webrtc-rs
  transport, audio and video are peer-to-peer over data channels; Realtime
  carries only signaling and presence).

## [0.9.43] — 2026-07-10

### Added
- **Native P2P transport (webrtc-rs)** — voice, screen share and camera now run
  over peer connections owned in Rust instead of the browser's WebRTC. Ubuntu/Mint's
  system WebKitGTK ships **without** `RTCPeerConnection`, so calls between people
  never worked on Linux; the native transport is the same code path on Windows and
  Linux, so it's universal. Data channels only — we ship our own payloads (raw i16
  PCM for voice, JPEG frames for video); signaling stays on Supabase broadcast.
- **Unified screen-share picker on both OSes** — our own source picker (monitors +
  windows, live source switch, realtime resolution/FPS/quality) now runs on Windows
  too via native GDI capture, replacing the OS getDisplayMedia picker. The mouse
  cursor is drawn into the frame on both platforms (XFixes on Linux, GDI on Windows).
- Desktop-audio sharing on Linux is captured natively (parec on the active output's
  monitor) and fanned out to peers — WebKitGTK can't expose monitor sources at all.

### Changed
- Screen-capture encode is dramatically faster (fused BGRA→RGB + nearest-neighbour
  downscale, SIMD JPEG, dependency opt-level in dev) — ~460ms/frame → ~16ms.
- Native TURN connectivity test (settings → audio) — the browser probe couldn't run
  on Linux (no `RTCPeerConnection`); it now gathers ICE natively via webrtc-rs.

### Fixed
- Linux launch/media issues: D-Bus single-instance panic, missing `libasound2-dev`,
  light-themed native `<select>` dropdowns.

### Note
- **b.ai.t is paused for the beta** (Anthropic credits) — the assistant shows
  "coming soon" and is disabled behind a single flag; the whole pipeline is intact.

## [0.9.42] — 2026-07-03

### Fixed
- **Linux desktop crash on launch**: the single-instance plugin used the app's
  numeric `identifier` ("2303") verbatim as its D-Bus well-known name, which
  D-Bus rejects (segments can't start with a digit) — panicked on every start.
  Now passes an explicit `dbus_id`.

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
