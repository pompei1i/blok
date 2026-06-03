# TODO (desktop)

## b.ai.t roadmap

### Phase 0.5 — polish & reliability (text assistant)

- [ ] **Prompt caching** — add `cache_control: { type: "ephemeral" }` to the system prompt block so repeated requests reuse the cached system prompt + tools (cuts cost ~10× on cache hits). See Anthropic prompt caching docs.
- [ ] **Streaming responses** — switch to `client.messages.stream()` and emit tokens to `bait-store` as they arrive; show partial text in BaitView in real time instead of waiting for the full response.
- [ ] **Model routing** — Haiku 4.5 for tool-only requests (poll, create channel, timer); Sonnet 4.6 for analysis/summarization/translation. Detect intent before the first API call.
- [ ] **Rate limiting** — max 10 requests/minute per session; show "slow down" message instead of erroring; queue or drop excess calls.
- [ ] **Smart language detection for translate** — auto-detect message language; only offer "Translate with b.ai.t" context menu item when language ≠ current app locale. If they match → "Already in your language".
- [ ] **Tool: `delete_message(messageId)`** — let bait delete a message by ID (with confirmation in the response).
- [ ] **Tool: `search_messages(query, channelId?)`** — bait can look up messages by keyword and quote them in its reply.
- [ ] **Tool: `set_channel_topic(topic)`** — set the topic of the active channel.
- [ ] **Error resilience** — retry once on Anthropic 529 (overload); surface clear error text for 401 (bad key) and 429 (rate limit) separately.
- [ ] **Per-server history** — persist separate conversation history per `serverId` so switching servers doesn't mix contexts.

---

### Phase 1 — bait in voice (bot service)

> Separate Node.js/Bun service. bait joins a voice channel as a virtual user and streams audio.

- [ ] **DB migration** — `ALTER TABLE profiles ADD COLUMN is_bot BOOLEAN DEFAULT false`; add `bot_session_id UUID` + `bot_session_by UUID` to `voice_channels` for one-bot-per-channel exclusivity.
- [ ] **Bot user seed** — create a `bait` profile row in Supabase with `is_bot = true`; exclude it from member lists and presence displays.
- [ ] **Bot service scaffold** — Node.js/Bun + Hono micro-service; connects to Supabase as the bot user; listens for join/leave commands via Supabase Realtime.
- [ ] **yt-dlp + ffmpeg pipeline** — `yt-dlp` extracts audio URL → `ffmpeg` converts to i16 PCM 48 kHz mono → streamed via Supabase Realtime channel to voice participants.
- [ ] **Music queue** — commands: `play <url|query>`, `skip`, `pause`, `resume`, `stop`, `nowplaying`, `queue`; queue state stored in bot-service memory (or Redis for multi-instance).
- [ ] **BaitSidebar voice controls** — when user is in a voice channel, show Now Playing widget + skip/stop buttons in BaitSidebar.
- [ ] **Soundboard** — 5–10 short sound effects (`airhorn`, `applause`, etc.) stored as static files on the bot service; `soundboard(name)` tool.
- [ ] **Spotify via spotdl** — `spotdl` resolves Spotify track URLs to YouTube equivalents; add disclaimer about ToS.
- [ ] **SoundCloud fallback** — SoundCloud public API as a legal alternative when yt-dlp is blocked.
- [ ] **Deploy** — Railway or Fly.io; health-check endpoint; env vars for Supabase URL + service_role key + Anthropic key.

---

### Phase 2 — advanced AI (after Phase 1 ships)

- [ ] **Voice commands (STT)** — pipe microphone input through Whisper API (or browser `SpeechRecognition`); send transcript to bait instead of typed text.
- [ ] **Thread summarization** — `summarize_thread(threadId)` tool; Claude reads the thread messages and returns a TL;DR.
- [ ] **LFG (party finder)** — `lfg(game, mode, slots)` tool; posts a structured "Looking for Group" message with a join button; tracks who clicked.
- [ ] **In-voice trivia** — `trivia(category, rounds)` tool; bot posts questions in chat, accepts answers in voice channel; keeps score.
- [ ] **Proactive suggestions** — after N messages in a channel, bait optionally surfaces a contextual suggestion in BaitSidebar ("5 people are discussing X — want me to create a poll?").
- [ ] **Multi-tool server bootstrap** — "create a server for a gaming community with 10 channels" → single prompt → bait creates server, channels, and an initial announcement in one tool chain.

---

## Up next

_(none — all shipped in v0.8.0)_

## Done (v0.8.0)

- [x] **Role & permission management** — `roles` DB table (bitfield permissions); `RoleManagerModal` (⚙ gear in sidebar): create/edit roles with name, color, permission checkboxes; assign roles to members via dropdown; kick member; `permission.ts` updated with `Perm` flags — non-owners get permissions from their role.
- [x] **Search by users & channels** — `SearchModal` now has 3 tabs: Messages (in-channel ILIKE, existing), Users (client-side filter on loaded members), Channels (client-side filter, click to navigate). Props: `serverId`, `onSelectChannel`.
- [x] **b.ai.t Phase 1** — context-aware: last 20 channel messages injected into system prompt; `summarize_channel` tool (Claude writes summary from context); `get_channel_members` tool; "summarize channel" quick command in BaitSidebar.

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
