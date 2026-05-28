# Changelog

## [0.3.2] — 2026-05-28

### Added
- **E2E in CI** — `.github/workflows/e2e.yml` runs on every push to `main` and on `workflow_dispatch`. Uses `windows-latest` runner, builds a binary with `tauri build --no-bundle`, adds `msedgedriver` from `$EDGEWEBDRIVER` to PATH, caches `tauri-driver` binary. Uploads WDIO logs on failure.
- **`permission.ts` helper** — centralised `can(action, { userId, server })` in `desktop/src/lib/permission.ts` and `src/lib/permission.ts`. All permission checks now go through a single function; role logic can be added there without touching components. `isServerOwner` inline expressions removed from `chat-area.tsx` and both `group-sidebar.tsx` files.
- **URL Preview** — `url-preview.tsx` fetches OG metadata via `api.microlink.io`; module-level cache prevents re-fetch on virtualiser remount. Card shows thumbnail, site name, title, description, hostname. Renders under messages in both server-channel and DM views.
- **Image lightbox** — click any image to open a `fixed inset-0 z-[9999]` overlay; close with ESC or click-outside. `createPortal` to `document.body`.
- **Message grouping** — consecutive messages from the same author collapse avatar/name; group-start padding `pt-3`; compact timestamp appears on hover in the spacer.
- **Typing indicator** — three `animate-bounce` dots with staggered delays; resolves user IDs to display names: "Roman is typing…" / "Roman and Jane are typing…" / "Roman, Jane and 2 more are typing…"
- **Invite TTL + usage limits** — `invite_expires_at`, `invite_max_uses`, `invite_used_count` columns added via migration; TTL selector (1d / 7d / ∞) and max-uses selector (1 / 5 / 10 / ∞) in `InviteUserModal`; expired/exhausted codes shown with strikethrough + red badge.
- **Message list virtualisation** — `@tanstack/react-virtual` replaces full DOM list; dynamic heights via `measureElement`; scroll-to-bottom only when near bottom; scroll restoration on load-more; `scrollToMessage` with highlight flash.
- **GIN full-text index** — `supabase/migrations/20260528_messages_gin_index.sql` adds `CREATE INDEX CONCURRENTLY` on `to_tsvector('russian', content)`.

### Changed
- **Screen share frame-skip** — `capture_screen_frame` now hashes the raw BGRA frame (sampled FNV-64a, every 64th byte) and returns `None` when the screen hasn't changed. Eliminates JPEG encode + IPC round-trip on idle frames; typical CPU usage near-zero between user actions.
- **Screen share resize** — `FilterType::Triangle` replaced with `FilterType::Nearest`; 720p→360p downscale ~5 ms → ~1-2 ms.
- **server-slice.ts split** — messages INSERT/UPDATE and reactions realtime handlers moved to `message-slice.ts` (`initMessageRealtime`). `server-slice.ts`: 570 → 478 lines. Unblocks threads feature without merge conflicts.
- **Screen share default resolution** — `screenShareResolution` default `"1080p"` → `"720p"` (`max_width 1920 → 1280`); 1080p GDI encode estimated ~28 ms/frame in release, tight for 30 fps.

### Tests
- 55 Rust tests (up from 31): +3 `frame_hash` tests + 3 routing tests migrated to `capture_raw_frame` + 21 NS/EC/screen-share tests.
- 312 JS tests (up from 303): +9 invite TTL tests.

---

## [0.3.0] — 2026-05-27

### Added
- **Single-instance** — second launch via shortcut no longer spawns a duplicate tray icon. `tauri-plugin-single-instance` intercepts the second process at OS level; the first instance receives focus (`show → unminimize → set_focus`).
- **Test suite (P1–P4)** — 303 JS tests (Vitest + jsdom) and 31 Rust tests (cargo test), all green. New coverage:
  - `useUpdater.test.ts` — check / retry backoff / dismiss / installUpdate / cleanup
  - `useChatInput.test.ts` — canSend / send / keydown / emoji / mention / attach / gif
  - `App.smoke.test.tsx` — mount / AuthScreen after init
  - `native-voice-engine.test.ts`, `sounds.test.ts` — audio engine, sound effects
  - `server-slice-realtime.test.ts` — all 7 postgres_changes handlers (messages INSERT/UPDATE, reactions, servers, profiles, channels)
  - `voice-engine.test.ts` frame section — WebRTC DataChannel pipeline, roundtrip encoder/decoder
  - `updater-endpoint.test.ts` — live network check (skipped by default, `TEST_UPDATER=1`)
  - Component tests: `update-banner`, `auth-screen`, `incoming-call-banner`, `offline-banner`, `message-bubble` (51 tests, 5 mutation-verified)
- **E2E infrastructure scaffold** — `desktop/e2e/` with WebdriverIO + tauri-driver; `specs/app.e2e.ts` (launch → auth → navigation → logout) and `specs/single-instance.e2e.ts`. Run with `npm run test:e2e` after `npm run tauri build`.
- **CI BOM guard** — `release.yml` now verifies `latest.json` has no UTF-8 BOM (reads first 3 bytes, fails with `exit 1`) before publishing to `blok-releases`.

---

## [0.2.19] — 2026-05-24

### Fixed
- **Auto-update non-functional** — root cause: `pompei1i/blok` is private; the Tauri updater was doing an anonymous GET and receiving 403, silently showing "up to date". Auto-update had never worked. Fix: created public `pompei1i/blok-releases`; CI now builds in the private repo → downloads artifacts → rewrites URLs in `latest.json` → publishes to `blok-releases`.
- **`latest.json` UTF-8 BOM** — PowerShell `[System.Text.Encoding.UTF8].GetBytes()` writes an EF BB BF BOM; the Tauri updater silently rejected the JSON on Windows. Replaced with `new System.Text.UTF8Encoding($false)` (no-BOM variant).
- **`gh release download` collision** — added `--clobber` to overwrite `latest.json` already present from the `tauri-action` build step.

---

## [0.2.18] — 2026-05-22

### Fixed
- **Screen share drag lag** — GDI `BitBlt` capture competes with DWM (Windows compositor) during window moves, causing visible stuttering. Now listens to `tauri://move` events; capture is skipped while the window is being dragged and resumes 150 ms after movement stops.

---

## [0.2.17] — 2026-05-22

### Fixed
- **Auto-updater signature mismatch** — `tauri.key` and the configured `pubkey` were from different key generations; the `latest.json` signature was silently rejected at runtime. Regenerated a consistent key pair; `pubkey` in `tauri.conf.json` and signing secrets updated to match.

---

## [0.2.16] — 2026-05-22

### Fixed
- **Auto-updater `latest.json` never generated** — root cause: `productName: "$blok"` contains `$` which GitHub strips from release asset names on upload. `tauri-action` looked up the `.sig` file by the original name (with `$`), got a mismatch against the uploaded name (without `$`), and skipped `latest.json` silently. Fixed by renaming `productName` to `blok`. Window title remains `$blok` (set separately in `app.windows[0].title`).

---

## [0.2.15] — 2026-05-22

### Fixed
- **DataChannel buffer overflow** — `_sendFrameViaDC` now checks `bufferedAmount` before each send; frames are dropped when the DC buffer exceeds 256 KB, preventing SCTP overflow on slow networks.

---

## [0.2.14] — 2026-05-22

### Changed
- **Screen share now uses WebRTC Data Channels (P2P)** — frames no longer go through Supabase Realtime. After `screenshare_start`, each viewer negotiates a direct `RTCPeerConnection` with the sharer via offer/answer/ICE exchanged over Supabase (10–20 messages total). Frames are sent as binary (`[w:u32][h:u32][JPEG bytes]`) with no base64 overhead and no per-frame Supabase messages. Eliminates the ~100 msg/sec Supabase rate-limit ceiling entirely for screen share at any FPS.
- STUN: `stun.l.google.com:19302` (free, no new infrastructure needed). TURN not required for most networks.
- `screen_frame` broadcast message type removed from the signaling protocol.

---

## [0.2.13] — 2026-05-21

### Added
- **Multi-streamer picker** — when two or more peers are sharing their screen simultaneously, a tab bar appears above the video so the local user can click to choose which stream to watch. Auto-selects the first sharer; switches to the next remaining sharer if the watched peer stops.

### Fixed
- **Screen share drag lag** — added an in-flight guard (`_captureInFlight`) in the GDI capture loop so that if a previous invoke + broadcast hasn't resolved yet, the next tick is deferred rather than stacked on top, preventing GDI pressure during window moves.
- **Multi-stop wipe bug** — `onScreenShareStop` no longer wipes viewer state when any unrelated sharer stops; viewer is only switched when the currently-watched peer stops.

### Changed
- Voice store state: `screenShareUserId` / `remoteScreenStream` replaced with `screenSharers: Record<userId, MediaStream>` and `watchingUserId: string | null`.
- Screen capture loop now logs `console.time("capture")` per frame for FPS/latency measurement in DevTools.

---

## [0.2.12] — 2026-05-21

### Fixed
- **Build error** — `installDir` is not a valid Tauri 2.x NSIS config field; removed it. `installMode: currentUser` alone is sufficient — Tauri correctly resolves `%LocalAppData%` at install time.

---

## [0.2.11] — 2026-05-21

### Fixed
- **Installer default path showed wrong drive** — `$blok` product name contains `$` which NSIS treats as a variable prefix, causing the default install path to resolve incorrectly. Fixed by explicitly setting `installDir` to `$LOCALAPPDATA\blok`.

---

## [0.2.10] — 2026-05-21

### Changed
- **Per-user installation** — NSIS installer now uses `currentUser` mode: installs to `%AppData%\Local\$blok` without requiring administrator elevation (UAC). Auto-updates also apply silently without UAC. **Existing users:** uninstall the old version from Program Files before installing this release.

---

## [0.2.9] — 2026-05-21

### Added
- **Native noise suppression** — adaptive spectral gate implemented in Rust: estimates a running noise floor from quiet frames; signals near the floor (~26 dB suppression) pass through a smooth gain envelope while clear speech passes unmodified. Enabled by default for all users.
- **Playback-aware echo cancellation** — when peers are actively sending audio (output buffers non-empty), the microphone gate threshold is raised 4× so that speaker bleed cannot be re-transmitted. Fast-close / slow-open smoothing prevents choppy speech. Enabled by default for all users.
- Both features are wired to the existing Noise Suppression / Echo Cancellation toggles in Audio Settings and take effect instantly via new `audio_set_noise_suppression` / `audio_set_echo_cancellation` Tauri commands.

### Changed
- `ui-settings-store` bumped to version 2; existing users migrated to NS/EC = `true` (native Rust implementation, no Windows communications endpoint switching)

---

## [0.2.8] — 2026-05-21

### Fixed
- **CI release conflict** — bumped version to avoid duplicate asset error on force-pushed tag

---

## [0.2.7] — 2026-05-20

### Fixed
- **Auto-updater non-functional** — `updater:default` and `process:allow-restart` permissions were missing from `capabilities/default.json`; every `check()` and `relaunch()` IPC call was blocked at the Tauri permission boundary, so no update notification was ever shown
- **CI release workflow** — removed unrecognised `updaterJsonKeepUniversal` input (no-op in `tauri-action@v0`); added `updaterJsonPreferNsis: true` so the updater JSON correctly references the NSIS bundle rather than a non-existent MSI/WiX artifact

---

## [0.2.6] — 2026-05-20

### Fixed
- **Screen share hang under load** — replaced `setInterval` with a self-scheduling `setTimeout` loop; next frame is only queued after the previous capture + Supabase broadcast fully completes, eliminating unbounded Tauri invocation pile-up
- **Audio thread infinite loop** — `Cmd::AddSamples` used a one-pop-at-a-time `while` loop that deadlocked when an incoming batch exceeded the 2-second buffer cap; replaced with bulk `drain()` + tail truncation (O(1))
- **GDI capture timer leaked after leaving voice** — `leave()` checked `_screenVideoEl` only, which is never set in the Tauri GDI path; capture kept running post-leave, allocating bitmaps and encoding JPEG indefinitely; now checks `_screenCaptureTimer !== null`
- `isScreenSharing()` returned `false` while GDI capture was active; fixed to include `_screenCaptureTimer` in the check
- Audio capture listeners left orphaned when Supabase channel subscription failed (CHANNEL_ERROR / TIMED_OUT); added cleanup in the rejection path of `join()`

### Security
- **Canvas DoS** — incoming `screen_frame` dimensions clamped to 3840 × 2160 and payload to 400 KB before touching the canvas; prevented memory-exhaustion crash from a malicious peer
- **MediaStreamTrack leak** — duplicate `screenshare_start` from the same peer now calls `_clearRemoteCanvas` first, stopping the old track before creating a new entry
- **`onScreenShareStop` ignored `userId`** — any peer stopping their share wiped the local viewer state for everyone; now only clears state when `screenShareUserId` matches
- **Double-join guard** — `join()` now returns early if `realtimeCh !== null`, preventing duplicate subscriptions and dual audio engines
- **Invite code CSPRNG** — replaced `Math.random()` (PRNG, ~41 bits, enumerable) with `crypto.getRandomValues` producing a 10-character hex code

---

## [0.2.5] — 2026-05-20

### Added
- **Configurable screen share quality** — new "Screen Share" section in Video settings lets users choose frame rate (1/5/10/15/30 FPS), resolution (720p/1080p/1440p/native), and JPEG quality (Low/Medium/High)
- **Rust-side configurable JPEG quality** — `capture_screen_frame` and GDI monitor/window capture commands accept `max_width` and `jpeg_quality` parameters; uses `JpegEncoder::new_with_quality` and `Triangle` resize filter
- Screen share settings persisted via Zustand `ui-settings-store`; i18n keys added to all 6 locales

### Fixed
- **"Failed to access microphone"** on stereo WASAPI devices — audio engine now reads native channel count and downmixes to mono in the capture callback instead of forcing `channels: 1`
- Error messages from Tauri `audio_start` now surface to the UI instead of always showing the generic fallback string

---

## [0.2.3] — 2026-05-20

### Added
- **Presence dot on message avatars** — colored status ring overlays each author's avatar in chat: green (online), yellow (AFK), red (offline / DND). Own messages always show online
- **Friends count in right sidebar** — the Friends tab now displays the live friend count badge alongside the member count
- **Integration tests** — `generateInviteCode`, `joinByInviteCode`, and `loadMoreMessages` covered by Vitest integration tests; Supabase query mock extended with `.lt` / `.lte` / `.gt` / `.gte` / `.in` filter methods

### Fixed
- Own user was incorrectly displayed as offline in the server members list — now always treated as online
- **"In voice" badge** was leaking across servers — it now only shows for voice channels belonging to the currently active server
- Removed duplicate `messagesLoading` destructure in `chat-area.tsx` that caused a compilation error
- Update-check errors after all retries are now silently swallowed; background errors no longer surface as banners

### Changed
- CI release workflow now runs `node scripts/gen-nsis-assets.mjs` before the Tauri build step to generate NSIS installer graphics
- Offline presence dot colour changed from grey to red for clearer visual distinction
- Added missing translation keys (`channel.delete`, `channel.deleteConfirm`, `offline.noConnection`, all `invite.*`) to ru, uk, pl, de, es locales

---

## [0.2.2] — 2026-05-20

### Added
- **Invite links** — server owners can generate an 8-character invite code (`generateInviteCode`) and share it; anyone can join via "Join by Code" in the top bar (`joinByInviteCode`)
- **Supabase Storage file uploads** — attachments are uploaded to the `attachments` bucket instead of being base64-encoded inline; max file size enforced at 10 MB
- **Message pagination** — scrolling to the top of any channel fetches the previous page of 30 messages (`loadMoreMessages`); scroll position is preserved via `useLayoutEffect`

### Changed
- Invite User modal rebuilt with two tabs: "By Username" (existing flow) and "Invite Code" (new)

---

## [0.2.1] — 2026-05-20

### Added
- **DB-based presence heartbeat** — new `online_at TIMESTAMPTZ` column in `user_presence`; client sends a heartbeat every 30 s so online/offline status is derived from recency of the field, not brittle JS lifecycle events
- **"Last seen X ago"** — offline friends show time since last heartbeat in the friends sidebar
- **Custom screen share source picker** — replaces the OS system dialog; sources listed directly inside the app
- **GDI screen capture** (`capture_screen_frame` Tauri command) — captures monitor or window via Windows GDI API, encodes as JPEG, streams frames over Supabase Realtime at 1 fps without ever invoking `getDisplayMedia`
- **Auto-update retry backoff** — updater now retries on failure: 3 s → 30 s → 5 min; persistent failure surfaces in the update banner

### Fixed
- Mute / deafen icons now update instantly in the voice participant list (no longer waiting for a Supabase presence round-trip)
- Presence reconnect — channel re-subscribe re-asserts `online` status so stale offline rows don't persist after a network blip
- `effectiveStatus` helper unifies online/offline detection across all sidebar components (friends, members, DM popup, mention picker)

### Changed
- `Cargo.toml` version synced to match `tauri.conf.json` (`0.2.1`)

---

## [0.2.0] — 2025-XX-XX

Web app (Next.js), WebRTC voice, i18n.

## [0.1.9] — 2025-XX-XX

Drag-and-drop file upload, native screen share picker, voice audio fixes.

## [0.1.6] — 2025-XX-XX

Pronouns, reply system, pinned messages, UI improvements, voice fixes.
