# Changelog

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
