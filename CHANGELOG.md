# Changelog

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
