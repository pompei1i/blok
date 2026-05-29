# TODO (desktop)

## Up next

- [ ] Search — messages, users, channels.
- [ ] Role & permission management per channel.
- [ ] Threads in text channels.
- [ ] bait Phase 0 — Claude API integration: `create_server`, `create_channel`, `translate`, `create_poll`, `create_announcement` tools.

## Done (v0.4.0)

- [x] **bait** (Blok Artificial Intelligence Toy) — Phase 0 placeholder UI:
  - `bait-store.ts` (Zustand): `isTabOpen`, `isActive`, `openTab`, `closeTab`, `activate`, `deactivate`.
  - `FishHookIcon` — custom SVG fishing hook icon shared across bait components.
  - `BaitView` — full-screen placeholder (header, `$bait` watermark, "coming soon", disabled input).
  - `BaitSidebar` — left sidebar replacement when bait is active (context, quick commands, history).
  - TopBar tab: bait opens as a tab alongside server tabs; server tab clicks deactivate bait.
  - `ChatArea` renders `<BaitView />` when bait is active.
  - `AppLayout` swaps `<GroupSidebar />` → `<BaitSidebar />` when bait is active.
  - `RightSidebar` — always-visible `$Bait` panel at the bottom (`h-[82px]`) as the trigger.
- [x] Full i18n coverage — 62+ new keys added to all 6 locales (EN/RU/UK/PL/DE/ES):
  `incomingCall.*`, `screenShare.*`, `videoCall.*`, `gif.*`, `members.*`, `friends.*`,
  `update.*`, `bait.*`, `sidebar.*`, `server.*`, `app.loading`, `topBar.cancel/closeBait`.
  Previously untranslated components now fully covered: `incoming-call-banner`, `update-banner`,
  `screen-share-overlay`, `video-call-overlay`, `gif-picker`, `screen-share-picker`,
  `right-sidebar`, `top-bar`, `bait-view`, `bait-sidebar`, `app-layout`.
- [x] Empty state differentiation: no server selected → "SELECT A SERVER" prompt; server selected but no channel → "SELECT A CHANNEL" prompt.
- [x] `UserBar` shown in `GroupSidebar` even when no server is selected.

## Done (v0.3.4)

- [x] Video calls in voice channels and DMs: WebRTC media tracks (`getUserMedia`), viewer-offerer pattern (mirrors screen share), `VideoCallOverlay` with tile grid, buttons in `user-bar` and `dm-popup`.
- [x] Video settings activated: Camera Device (`enumerateDevices`), Camera Quality (constraints 720p/1080p/1440p), Mirror My Camera (`scale-x-[-1]`), Enable Camera Preview (live `<video>` in settings), Camera Access flow.

## Done (v0.3.2)

- [x] `permission.ts`: `can(action, { userId, server })` — single permission check point; `isServerOwner` removed from components.
- [x] URL Preview: `url-preview.tsx`, OG via `microlink.io`, module-level cache.
- [x] Image lightbox: `createPortal`, ESC / click-outside, `fixed inset-0 z-[9999]`.
- [x] Message grouping: consecutive messages hide avatar/name, `pt-3` between groups, hover-timestamp.
- [x] Typing indicator: three dots with `animate-bounce`, staggered delays, real display names.
- [x] Invite TTL + usage limits: `invite_expires_at` / `invite_max_uses` / `invite_used_count`, migration, UI.
- [x] Message list virtualisation: `@tanstack/react-virtual`, dynamic heights, scroll-restoration, jump-to-message.
- [x] GIN index: `idx_messages_content_gin` on `to_tsvector('russian', content)`.
- [x] Screen share frame-skip: FNV-64a frame hash, `None` when screen is unchanged.
- [x] Screen share resize: `Triangle` → `Nearest`, 720p→360p ~5ms → ~1-2ms.
- [x] `server-slice.ts` split: message realtime → `message-slice.ts#initMessageRealtime`, 570 → 478 lines.
- [x] Screen share default: `1080p` → `720p`.
- [x] 55 Rust tests (was 31) + 312 JS tests (was 303).

## Done (v0.3.0)

- [x] Single-instance: `tauri-plugin-single-instance` — second launch focuses the existing window.
- [x] Test suite P1–P4: 303 JS (Vitest + jsdom) + 31 Rust (cargo test), all green, mutation-verified.
- [x] E2E scaffold: `desktop/e2e/` — WebdriverIO + tauri-driver, `app.e2e.ts`, `single-instance.e2e.ts`.
- [x] CI BOM-guard in `release.yml` (checks first 3 bytes of `latest.json`).

## Done (v0.2.19)

- [x] Auto-update: migrated to public `pompei1i/blok-releases` (private repo returned 403).
- [x] BOM fix: `UTF8Encoding($false)` instead of `[System.Text.Encoding.UTF8]`.
- [x] `gh release download --clobber`.

## Done (v0.2.13–v0.2.18)

- [x] Screen share drag lag fix (GDI pause 150 ms on `tauri://move`).
- [x] WebRTC P2P DataChannels for screen share — removed Supabase rate limit.
- [x] Binary frame format: `[w:u32][h:u32][JPEG]`, backpressure guard 256 KB.
- [x] Multi-streamer picker: tab bar when multiple simultaneous sharers.
- [x] GDI in-flight guard `_captureInFlight`.
- [x] Auto-updater: keys regenerated, `productName` renamed to `blok`.
- [x] NSIS per-user install (`%LocalAppData%`, no UAC).

## Done (v0.2.9)

- [x] Native noise suppression (Rust): adaptive spectral gate.
- [x] Playback-aware echo cancellation (Rust): threshold ×4 during playback.

## Done (v0.2.1–v0.2.8)

- [x] DB-based presence heartbeat (30 s), "Last seen X ago".
- [x] Supabase Storage for attachments (up to 10 MB), drag-and-drop.
- [x] Message pagination (30 at a time, scroll position preserved).
- [x] Invite codes (CSPRNG, 8 characters).
- [x] Emoji reactions: quick-picker, pills under messages, realtime + DB.
- [x] Pinned messages: pin bar, jump-to, unpin.
- [x] Reply system with quote preview.
- [x] Message edit and delete.
- [x] DM calls: incoming/outgoing banners, voice + screen share in DM.
- [x] Mobile adaptation: drawer sidebars, rem-based DM popup.
- [x] 6 languages (EN/RU/UK/PL/DE/ES), 165+ keys.
- [x] Custom CSS live-inject.
- [x] System tray (minimize instead of close).
- [x] Push notifications + sounds.
- [x] RLS on all tables, CSP, XSS protection (DOMPurify).
- [x] Presence dot on avatars in chat (online/afk/dnd/offline).
- [x] GDI screen capture via Win32 API (`capture_screen_frame`).
- [x] Configurable screen share: FPS / resolution / JPEG quality.
- [x] Auto-update retry backoff: 3 s → 30 s → 5 min.
