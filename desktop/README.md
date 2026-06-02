# $blok Desktop

Tauri 2 desktop client. For full documentation see the [root README](../README.md).

## Quick start

```bash
cd desktop
npm install
npm run dev          # dev server on http://localhost:1420
npm run tauri dev    # Tauri window (dev)
npm run tauri build  # NSIS installer (.exe)
```

Or use the build script (installs Rust automatically if missing):

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
```

## Environment

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_TENOR_API_KEY=...   # optional
```

## Tests

```bash
npm run test          # run once
npm run test:watch    # watch mode
npm run test:ui       # browser UI
```

## Stack

| Layer | Tech |
|---|---|
| UI | React 19, Tailwind CSS 4, Lucide React |
| Build | Vite 7 (port 1420) |
| State | Zustand 4 |
| Backend | Supabase (Auth, Realtime, PostgreSQL) |
| Desktop | Tauri 2 (NSIS, Windows) |
| Audio | cpal (Rust native engine) |
| i18n | 6 languages, 165+ keys |
