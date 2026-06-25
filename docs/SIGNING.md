# Auto-Update Signing

blok's auto-updater (Tauri's updater plugin) verifies every downloaded installer against a public key baked into `tauri.conf.json`. The matching private key must sign the installer at build time, or updates silently fail to verify.

## Key files

- `desktop/.tauri-key` — private key (gitignored, never commit). No passphrase.
- `desktop/.tauri-key.pub` — public key, same value as `tauri.conf.json#plugins.updater.pubkey`.
- `desktop/src-tauri/tauri.conf.json` — `plugins.updater.pubkey` must match the private key used in CI.

## v0.9.27 incident: an unnecessary, irreversible key rotation

The key pair shipped since v0.2.17 (commit `92b145f`) was correctly set up and had been signing every release fine through v0.9.26 — `TAURI_SIGNING_PRIVATE_KEY` lived only as a GitHub Actions secret (correctly; private keys are never committed).

During a v0.9.27 changeset, a *local* `npm run tauri build` printed the routine warning `"A public key has been found, but no private key"` — expected on a machine without the CI secret available locally. This was misdiagnosed as evidence the CI secret itself was broken. Without verifying that assumption (e.g. checking recent release run logs, or that `latest.json` already had valid signatures from prior releases), a new key pair was generated and `gh secret set TAURI_SIGNING_PRIVATE_KEY` **overwrote the working secret**. GitHub Secrets have no version history — the old private key is gone.

**Effect:** anyone running v0.9.26 or earlier cannot auto-update past v0.9.27; they need one manual reinstall. From v0.9.27 onward, the new key is consistent between `tauri.conf.json` and the CI secret, so auto-update resumes normally. This is the identical failure mode (and identical fix) as the original v0.2.17 incident.

**Lesson:** never rotate `TAURI_SIGNING_PRIVATE_KEY` without first confirming the *current* key is actually broken — e.g. check that the latest published `latest.json` already has a non-empty `signature` field, or look at whether recent CI release runs succeeded without warnings. A local-build-only warning about a missing private key is normal and does not imply anything about the CI secret.

## Current keys

- `desktop/.tauri-key` — private key (gitignored, never commit). No passphrase.
- `desktop/.tauri-key.pub` — public key, same value as `tauri.conf.json#plugins.updater.pubkey`.
- `desktop/src-tauri/tauri.conf.json` — `plugins.updater.pubkey` must match the private key used in CI.

## Rotating the key in future

```bash
cd desktop
npx tauri signer generate --ci --write-keys .tauri-key --force
```

Update `plugins.updater.pubkey` in `tauri.conf.json` with the new public key, update the `TAURI_SIGNING_PRIVATE_KEY` GitHub secret with the new private key contents, then cut a release. Clients on the old key will get one final update (signed under the old key, since the binary that ships still trusts it) — after that, rotation is complete and old clients must already have the new pubkey baked in before the next rotation, or they'll be stuck.

## Verifying it actually works

After a release ships, check `latest.json` at the public releases endpoint and confirm `signature` is non-empty, then install an old build and confirm it picks up the update.
