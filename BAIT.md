# bait — Blok Artificial Intelligence Toy

An AI assistant built into Blok. Accessible via a dedicated tab in the top bar, communicates in natural language, and executes actions inside the app.

---

## Concept

- Dedicated chat panel with the bot (not a server channel, not a DM)
- Users write freely — bait understands intent via Claude API tool use
- Can connect to the voice channel the user is currently in
- One bait per voice channel at a time (exclusivity)
- Has a personality: responds with character, not error messages

---

## Implementation Phases

### Phase 0 — Text-only (current priority)

No bot service. Everything runs through the Claude API directly from the frontend.

**UI (done in v0.4.0):**
- `bait-store.ts` — Zustand state (`isTabOpen`, `isActive`, `openTab`, `closeTab`, `activate`, `deactivate`)
- `FishHookIcon` — custom SVG icon
- `BaitView` — full-screen placeholder rendered in ChatArea when bait is active
- `BaitSidebar` — left sidebar replacement with context, quick commands, and history sections
- TopBar tab — bait opens as a first-class tab; clicking a server tab deactivates bait
- `RightSidebar` `$Bait` panel — always-visible trigger at the bottom (`h-[82px]`)

**Tools to implement:**
- `create_server(name, description, channels[])` — create a server from a natural language description
- `create_channel(serverId, name, type, category?)` — create a channel
- `translate_message(text, targetLang)` — translate a message via context menu
- `create_poll(channelId, question, options[])` — create a poll in a text channel
- `create_announcement(channelId, text)` — post an announcement

**Example (server creation):**
> "create a server for a Fortnite gaming community with channels split by party size, different game modes, and a rules channel — name it FortniteGaming"

Claude generates the structure → calls tools → server is created automatically.

---

### Phase 1 — bait in voice

Separate Node.js/Bun service. Bot as a virtual user in a voice channel.

**Features:**
- Join the voice channel where the user is sitting
- Play music from YouTube / YouTube Music (yt-dlp + ffmpeg → i16 PCM → Supabase Realtime)
- Track queue (add, skip, shuffle)
- Controls: play, pause, skip, stop, nowplaying
- Timer / Pomodoro in voice
- Soundboard (short sound effects)

**Spotify:** via spotdl (finds the track on YouTube using Spotify metadata). Works in ~85% of cases. See risks below.

---

### Phase 2 — Media & extensions (after Phase 1)

- Video demonstration (WebRTC from Node.js — complex, `node-datachannel`)
- Voice commands (speech recognition)
- Chat history summarization
- LFG (party finder for games)
- In-voice mini-games (trivia, quizzes)

---

## Architecture

### Frontend

```
BaitView              — full-screen tab view (ChatArea)
BaitSidebar           — left sidebar when bait is active (GroupSidebar slot)
RightSidebar $Bait    — always-visible trigger panel
bait-store.ts         — Zustand state (isTabOpen, isActive)
Anthropic SDK         — direct Claude API calls with tool use (Phase 0)
```

### Tools (Phase 0)

```typescript
create_server(name, description, channels[])
create_channel(serverId, name, type, category?)
translate_message(text, targetLang)
create_poll(channelId, question, options[])
create_announcement(channelId, text)
```

### Bot service (Phase 1)

```
Node.js / Bun + Hono
├── Supabase client     — joins voice channel as bot-user
├── yt-dlp              — extracts audio from YouTube
├── ffmpeg              — converts to i16 PCM (48 kHz)
└── PCM stream          — sends via Supabase Realtime
```

**Deploy:** Railway or Fly.io (~$5–7/month)

### DB changes (Phase 1)

```sql
-- bot user flag
ALTER TABLE users ADD COLUMN is_bot BOOLEAN DEFAULT false;

-- bot exclusivity per voice channel
ALTER TABLE voice_channels
  ADD COLUMN bot_session_id UUID,
  ADD COLUMN bot_session_by UUID REFERENCES users(id);
-- INSERT fails if bot_session_id is already taken → one bot per channel
```

---

## Message Translation (standalone feature, Phase 0)

- Detect message language automatically (Claude or `langdetect`)
- "Translate" context menu item shown **only** when message language ≠ app language
- Translates to the app's current interface language
- If languages match → shows "You can already read this" (or localized equivalent)

---

## Models & Cost

| Model | Input | Output | Cache read |
|-------|-------|--------|------------|
| Haiku 4.5 | $0.80/M | $4/M | $0.08/M |
| Sonnet 4.6 | $3/M | $15/M | $0.30/M |

**Per request (with cache):**
- Haiku: ~$0.001
- Sonnet: ~$0.003

**At 100 requests/day:**
- Haiku: ~$3/month
- Sonnet: ~$9/month

**Routing strategy:**
- Haiku → translation, simple commands (play/pause/skip), polls
- Sonnet → server creation, complex intent parsing

System prompt with tools is cached → repeated requests are significantly cheaper.

---

## Risks

### Legal
- **yt-dlp** violates YouTube ToS. YouTube periodically blocks it — need a fallback plan.
- **spotdl / Spotify** — double ToS violation (Spotify + YouTube). Add an explicit disclaimer.
- Low-risk alternatives: SoundCloud API (free tier), Jamendo (CC music, royalty-free).

### Technical
- yt-dlp time-to-first-byte: 2–8 s → UX buffering required.
- Claude API latency p50 ~800 ms, p95 ~2.5 s → typing indicator required.
- ffmpeg processes must be killed on disconnect, otherwise server memory leaks.

### Product
- Claude API cost scales with users → rate limiting required from day one.
- Scope creep — Phase 0 should ship within 2 weeks of implementation start.

---

## Next Steps

1. Anthropic SDK on the frontend, tool schemas for Phase 0
2. `create_server` tool — first WOW moment
3. Message translation via context menu (detect language → translate)
4. After Phase 0: bot-user in seed data, Railway service, yt-dlp pipeline
