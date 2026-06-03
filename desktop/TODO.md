# TODO (desktop)

## Up next

- [ ] Role & permission management per channel.
- [ ] Search by users and channels (current search covers messages only).
- [ ] b.ai.t Phase 1 — context-aware suggestions, message summarization, smarter tool chaining.

## Done (v0.7.0)

- [x] **b.ai.t — Claude API integration** — Claude Haiku via `@anthropic-ai/sdk`; 5 tools: `create_server`, `create_channel`, `translate`, `create_poll`, `create_announcement`; `set_timer` schedules a message after N seconds. API key embedded at build time via `VITE_BAIT_DEFAULT_KEY`. Chat history persisted across restarts.
- [x] **"Translate with b.ai.t"** — right-click any message → opens b.ai.t and sends translation request.
- [x] **Announcements** — 📢 toggle in chat input; red left border + badge in message list; always sends desktop notification to all server members regardless of active channel.
- [x] **@mention autocomplete** — type `@` in chat input → inline dropdown of server members filtered as you type; ↑↓ / Enter / Tab to select, Escape to close.

## Done (v0.6.0)

- [x] **In-channel search** — `Ctrl+F` / 🔍 icon opens modal; debounced Supabase ILIKE query; ↑↓ keyboard navigation; Enter jumps to message with flash highlight.
- [x] **Polls** — 📊 in chat toolbar; single/multiple choice; anonymous/open; vote confirmation step; realtime progress bars; voter names on hover (open polls); DB: `polls`, `poll_options`, `poll_votes` + RLS.
- [x] **Right-click context menu** — ПКМ on any message opens the action menu at cursor position.
- [x] **Portal context menu** — menu rendered via `createPortal` in `document.body`; `position: fixed`; never clipped, never closes on cursor movement. Closes on outside click or Escape.
- [x] **"original deleted message :"** — shown when replied-to message no longer exists.
- [x] **Project structure cleanup** — dead root Tauri files removed; `lib/i18n.ts`, `lib/store/ui-settings-store.ts`, `locales/` moved to proper root locations; `desktop/README.md` slimmed; root `package.json` cleaned.

## Done (v0.5.0)

- [x] Screen share / camera black screen fix: `.play()` called explicitly after `srcObject` assigned — `autoPlay` unreliable in Tauri/WebView2 when `srcObject` is set dynamically.
- [x] Late-joiner fix: re-broadcast `screenshare_start` / `video_start` on `join` so users entering an active channel see existing streams.
- [x] TURN servers added (`openrelay.metered.ca`) for ICE connectivity behind strict NAT.
- [x] Custom stub installer (`installer/`) — frameless dark Tauri window: downloads latest release from GitHub API, runs NSIS silently (`/S /D=path`), custom path picker, auto-closes after install.
- [x] NSIS installer branding: `header.bmp` (150×57) + `sidebar.bmp` (164×314) generated via `scripts/gen-nsis-assets.mjs`.
- [x] Website (`getblok.app`) — landing page with auto-updating download button (GitHub API), PayPal donation, terminal aesthetic matching app style.

## Done (v0.4.0)

- [x] **b.ai.t** (Blok Artificial Intelligence Toy) — Phase 0 placeholder UI:
  - `bait-store.ts` (Zustand): `isTabOpen`, `isActive`, `openTab`, `closeTab`, `activate`, `deactivate`.
  - `FishHookIcon` — custom SVG fishing hook icon shared across bait components.
  - `BaitView` — full-screen placeholder (header, `$bait` watermark, "coming soon", disabled input).
  - `BaitSidebar` — left sidebar replacement when bait is active (context, quick commands, history).
  - TopBar tab: bait opens as a tab alongside server tabs; server tab clicks deactivate bait.
  - `ChatArea` renders `<BaitView />` when bait is active.
  - `AppLayout` swaps `<GroupSidebar />` → `<BaitSidebar />` when bait is active.
  - `RightSidebar` — always-visible `$Bait` panel at the bottom (`h-[82px]`) as the trigger.
- [x] Full i18n coverage — 62+ new keys added to all 6 locales (EN/RU/UK/PL/DE/ES).
- [x] Empty state differentiation: no server selected → "SELECT A SERVER"; server selected but no channel → "SELECT A CHANNEL".
- [x] `UserBar` shown in `GroupSidebar` even when no server is selected.

## Done (v0.3.4)

- [x] Video calls in voice channels and DMs: WebRTC media tracks (`getUserMedia`), viewer-offerer pattern, `VideoCallOverlay` with tile grid.
- [x] Video settings: Camera Device, Camera Quality, Mirror My Camera, Enable Camera Preview.

## Done (v0.3.2)

- [x] `permission.ts`: `can(action, { userId, server })` — single permission check point.
- [x] URL Preview: OG via `microlink.io`, module-level cache.
- [x] Image lightbox: `createPortal`, ESC / click-outside.
- [x] Message grouping: consecutive messages collapse avatar/name, hover-timestamp.
- [x] Typing indicator: animated dots, real display names.
- [x] Invite TTL + usage limits: `invite_expires_at` / `invite_max_uses` / `invite_used_count`.
- [x] Message list virtualisation: `@tanstack/react-virtual`, dynamic heights, scroll-restoration, jump-to-message.
- [x] GIN index: `idx_messages_content_gin` on `to_tsvector('russian', content)`.
- [x] Screen share frame-skip: FNV-64a frame hash, skip when unchanged.
- [x] `server-slice.ts` split: message realtime → `message-slice.ts`.
- [x] 55 Rust tests + 312 JS tests.

## Done (v0.3.0)

- [x] Single-instance: `tauri-plugin-single-instance`.
- [x] Test suite P1–P4: 303 JS (Vitest + jsdom) + 31 Rust (cargo test).
- [x] E2E scaffold: WebdriverIO + tauri-driver.
- [x] CI BOM-guard in `release.yml`.

## Done (v0.2.1–v0.2.19)

- [x] Auto-update via public `blok-releases` repo.
- [x] WebRTC P2P DataChannels for screen share.
- [x] DB-based presence heartbeat (30 s).
- [x] Supabase Storage attachments (up to 10 MB), drag-and-drop.
- [x] Message pagination (30 at a time).
- [x] Invite codes (CSPRNG, 8 characters).
- [x] Emoji reactions, pinned messages, reply system, message edit/delete.
- [x] DM calls: incoming/outgoing banners, voice + screen share in DM.
- [x] 6 languages (EN/RU/UK/PL/DE/ES), 165+ keys.
- [x] Custom CSS live-inject, system tray, push notifications.
- [x] Native noise suppression + echo cancellation (Rust).
- [x] GDI screen capture, configurable FPS/resolution/quality.
- [x] NSIS per-user install (`%LocalAppData%`, no UAC).
