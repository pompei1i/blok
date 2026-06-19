# blok

**A native desktop chat platform — like Discord, but yours.** Voice, video & screen share, an AI that runs your server, and a loot-box economy. Built solo with Tauri 2 + Rust + React + Supabase.

> 🧪 **Public beta.** Windows-only for now. Voice & text are stable; screen share and video are **experimental**.

![blok](desktop/public/icon.svg)

<!-- TODO: add screenshots / a short demo gif here -->

---

## Highlights

- 🤖 **b.ai.t — an AI that acts.** A built-in assistant (Claude) that creates polls, summarizes channels and translates — on command, right inside the chat. Runs through a server-side proxy; no API key ships in the client.
- 🎙️ **Real voice.** Low-latency audio over a native **Rust** engine (cpal), streamed via Supabase Realtime. Noise suppression, echo cancellation, push-to-talk, per-user volume & local mute.
- 🖥️ **Screen share & video** *(experimental).* `getDisplayMedia` — share a window, a tab or the whole screen, **up to 60 fps with system audio**; camera & video calls over WebRTC.
- 🎰 **A game inside your chat.** XP & levels, daily quests, a gacha **loot box** (server-side RNG with pity), a coin/dust economy and equippable cosmetics (nameplates, avatar frames, badges, banners).
- 🛡️ **Built for communities.** Servers, channels & categories, bitfield **roles & permissions**, moderation (bans, timeouts, slow-mode, audit log), invite codes.
- 💬 **A real messenger.** Realtime messages, attachments & drag-drop, GIFs, emoji & reactions, replies, pins, polls, announcements, in-channel search, `Ctrl+K` quick switcher.
- 🎨 **Make it yours.** Light/dark/custom themes, Custom CSS, custom chat background, 6 languages (EN · RU · UK · PL · DE · ES).

## Tech stack

| Layer | Tech |
|---|---|
| Desktop shell | Tauri 2 (WebView2, NSIS installer) |
| Front-end | React 19, TypeScript (strict), Tailwind CSS 4, Zustand |
| Build | Vite 7 |
| Native audio | Rust + cpal (capture/playback, noise suppression, echo cancellation) |
| Transport | Audio → Supabase Realtime (PCM broadcast); video/screen → WebRTC (STUN/TURN) |
| Backend | Supabase — Auth, Realtime, PostgreSQL (RLS), Storage, Edge Functions |
| AI | Anthropic Claude via a Supabase Edge Function proxy |

## Project layout

```
blok/
├── desktop/              # The product — Tauri 2 desktop app
│   ├── src/              # React + TypeScript front-end
│   │   ├── components/blok/
│   │   ├── lib/
│   │   │   ├── native-voice-engine.ts   # Rust audio over Realtime + WebRTC video/screen
│   │   │   └── store/                    # Zustand slices
│   │   └── locales/                      # 6 languages
│   └── src-tauri/        # Rust backend (audio engine, tray, auto-updater)
├── installer/            # Tauri updater/installer stub
├── supabase/             # DB migrations, RLS policies, Edge Functions (b.ai.t proxy)
├── infra/coturn/         # Self-hosted TURN server (Docker)
└── .github/workflows/    # CI — release builds + DB migrate
```

## Getting started

Prerequisites: Node 18+, Rust toolchain (the build script installs it if missing), and a Supabase project.

```bash
cd desktop
npm install
npm run tauri dev      # dev window (localhost:1420)
npm run tauri build    # NSIS installer (.exe)
```

Configure `desktop/.env.local` (Supabase keys, optional Tenor GIF key, TURN relay for
screen share). **Full environment & build details live in [`desktop/README.md`](desktop/README.md).**

## Backend (Supabase)

The database schema lives in [`supabase/`](supabase/) as **idempotent migrations** (replay-all model — every migration is safe to re-run) plus RLS policies. Security model:

- **Row-Level Security** on every table; helper `has_server_perm(server_id, bit)` / `is_server_owner()`.
- Economy & moderation mutations go through **`SECURITY DEFINER` RPCs** (`open_loot_box`, `buy_item`, `equip_item`, `claim_quest_reward`, `delete_channel_cascade`, …) — clients get `SELECT`-only on the underlying tables.
- **b.ai.t** runs in a Deno Edge Function ([`supabase/functions/bait`](supabase/functions/bait)); the Anthropic key is a server secret and requests are rate-limited per user.

See [`supabase/migrations/README.md`](supabase/migrations/README.md) for the migration discipline.

## Self-hosted TURN

Screen share / video across different networks needs a TURN relay. A ready-to-deploy
**coturn** package (Docker Compose + config + deploy guide) is in
[`infra/coturn/`](infra/coturn/README.md) — runs fine on a free-tier VM.

## Tests

```bash
cd desktop
npm run test          # run once   (Vitest)
npm run test:watch
```

Covers store actions, DM/friends/auth/economy stores, message search, poll logic, i18n and utilities.

## Releases & auto-update

Tagging `v*` triggers a GitHub Actions workflow that builds the NSIS installer and
publishes a GitHub Release. Installed clients silently auto-update via the Tauri updater.

## Contributing

Issues and PRs are welcome — it's a solo project, so expect rough edges. Please open an
issue to discuss anything substantial before a large PR.

## License

[GNU AGPL-3.0](LICENSE). You may use, study, modify and self-host blok freely; if you run
a modified version as a network service, you must make your source available to its users.
