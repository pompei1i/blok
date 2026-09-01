# Release guide

## 1. Preparation

Bump the version in three files (e.g. `0.9.7` → `0.9.8`):

```
desktop/package.json              "version": "0.9.8"
desktop/src-tauri/tauri.conf.json "version": "0.9.8"
CHANGELOG.md                      add a ## [0.9.8] — YYYY-MM-DD section
```

## 2. Commit

```powershell
git add CHANGELOG.md desktop/package.json desktop/src-tauri/tauri.conf.json
git commit -m "feat: v0.9.8 — change description"
```

For hotfixes (non-release changes):

```powershell
git add <files>
git commit -m "fix: short description"
```

## 3. Tag and deploy

```powershell
git tag v0.9.8
git push origin main
git push origin v0.9.8
```

Pushing the tag automatically triggers GitHub Actions → builds the NSIS installer → publishes the release to `pompei1i/blok-releases`.

## 4. Verify the build

GitHub → repository → **Actions** → latest run → check that all steps are green.

If the **"Inject build secrets into .env"** step shows `VITE_BAIT_DEFAULT_KEY=***`, the key was embedded correctly.

## Commit message format

```
feat:  new functionality
fix:   bug fix
chore: dependency/config updates
docs:  documentation only
```

## GitHub Secrets (Settings → Secrets → Actions)

| Secret | Purpose |
|--------|---------|
| `VITE_BAIT_DEFAULT_KEY` | Anthropic API key for b.ai.t |
| `VITE_SUPABASE_URL` | Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_GIPHY_API_KEY` | GIPHY GIF search API |
| `TAURI_SIGNING_PRIVATE_KEY` | Update signing |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Key password |
| `RELEASES_PAT` | PAT for writing to `blok-releases` |
