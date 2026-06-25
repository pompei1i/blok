# Auto-Update Signing

blok's auto-updater (Tauri's updater plugin) verifies every downloaded installer against a public key baked into `tauri.conf.json`. The matching private key must sign the installer at build time, or updates silently fail to verify.

## Key files

- `desktop/.tauri-key` — private key (gitignored, never commit). No passphrase.
- `desktop/.tauri-key.pub` — public key, same value as `tauri.conf.json#plugins.updater.pubkey`.
- `desktop/src-tauri/tauri.conf.json` — `plugins.updater.pubkey` must match the private key used in CI.

## What was broken

The public key committed in `tauri.conf.json` did not correspond to any private key available in CI (`TAURI_SIGNING_PRIVATE_KEY` secret was unset/stale). Every release built and published successfully, but installed clients could never verify `latest.json`'s signature, so the in-app updater silently did nothing.

## Fix

Regenerated the key pair and synced all three places:

```bash
cd desktop
npx tauri signer generate --ci --write-keys .tauri-key --force
```

Then:
1. Copied the new public key into `desktop/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).
2. Set the GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY` to the contents of `desktop/.tauri-key`.
3. Left `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` unset (key has no password).

## Rotating the key in future

```bash
cd desktop
npx tauri signer generate --ci --write-keys .tauri-key --force
```

Update `plugins.updater.pubkey` in `tauri.conf.json` with the new public key, update the `TAURI_SIGNING_PRIVATE_KEY` GitHub secret with the new private key contents, then cut a release. Clients on the old key will get one final update (signed under the old key, since the binary that ships still trusts it) — after that, rotation is complete and old clients must already have the new pubkey baked in before the next rotation, or they'll be stuck.

## Verifying it actually works

After a release ships, check `latest.json` at the public releases endpoint and confirm `signature` is non-empty, then install an old build and confirm it picks up the update.
