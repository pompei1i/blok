# $blok Desktop

Tauri 2 desktop client. Full documentation: [root README](../README.md) · Changelog: [CHANGELOG](../CHANGELOG.md) · Tasks: [TODO](TODO.md)

## Quick start

```bash
npm install
npm run tauri dev    # dev window (http://localhost:1420)
npm run tauri build  # NSIS installer (.exe)
```

Or via the build script (installs Rust automatically):

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
```

### Linux

Install the system packages Tauri needs before `npm install`/`tauri dev`/`tauri build` (same list the `release-linux` CI job uses):

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev \
  libayatana-appindicator3-dev patchelf
```

`npm run tauri build` produces `.deb`, `.rpm`, and `.AppImage` under `src-tauri/target/release/bundle/`.

## Environment (`desktop/.env.local`)

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_TENOR_API_KEY=...        # optional — GIF search
# b.ai.t no longer uses a client-side key. The Anthropic key lives in the
# Supabase Edge Function "bait" (supabase/functions/bait): set it server-side with
#   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
#   supabase functions deploy bait
# and apply the 20260616_bait_rate_limit migration.

# TURN relay for screen share / camera (across strict NATs). blok fetches short-lived
# Cloudflare TURN creds at runtime from the `turn` Edge Function (set CF_TURN_KEY_ID /
# CF_TURN_API_TOKEN as function secrets), so these are an OPTIONAL static fallback only.
# VITE_TURN_URLS=turn:host:3478,turns:host:5349?transport=tcp
# VITE_TURN_USERNAME=...
# VITE_TURN_CREDENTIAL=...
```

## Tests

```bash
npm run test          # run once
npm run test:watch    # watch mode
npm run test:ui       # browser UI
```
