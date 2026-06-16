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

## Environment (`desktop/.env.local`)

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_TENOR_API_KEY=...        # optional — GIF search
VITE_BAIT_DEFAULT_KEY=...     # Anthropic API key for b.ai.t

# TURN relay for screen share / camera (required across different NATs — without
# a working relay the viewer sees a black screen; audio is unaffected). Get free
# credentials from metered.ca, Twilio, or a self-hosted coturn. Baked at build time.
VITE_TURN_URLS=turn:host:3478,turns:host:5349?transport=tcp
VITE_TURN_USERNAME=...
VITE_TURN_CREDENTIAL=...
```

## Tests

```bash
npm run test          # run once
npm run test:watch    # watch mode
npm run test:ui       # browser UI
```
