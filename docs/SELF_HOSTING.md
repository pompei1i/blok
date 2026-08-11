# Self-hosting blok

blok has no server of its own — it runs on **your** Supabase project. This walks through
standing one up from nothing to a working build, in the order the pieces depend on each other.

Budget about 30 minutes. Supabase's free tier is enough to run a small community.

## What you need

- **Node 22** and **npm**
- **Rust** stable (`rustup`; the build scripts install it if missing)
- A **Supabase** project — [supabase.com](https://supabase.com), free tier is fine
- The **Supabase CLI** — [install guide](https://supabase.com/docs/guides/local-development/cli/getting-started)
- On Linux, the system packages listed in [`desktop/README.md`](../desktop/README.md)

Optional, per feature:

| Feature | Needs |
|---|---|
| b.ai.t (AI assistant) | A Google **Gemini** API key ([free tier](https://aistudio.google.com/apikey)) |
| Auto-translate messages | The same Gemini key |
| GIF picker | A **Tenor** API key ([developers.google.com/tenor](https://developers.google.com/tenor)) |
| Screen share / video across strict NATs | **Cloudflare TURN** keys, or self-hosted coturn |

Everything else — text, voice, servers, roles, moderation, economy — works with just Supabase.

## 1. Create the Supabase project

New project → note the **Project URL** and **anon key** (Project Settings → API), and the
**database password** you set. In Authentication → Providers, keep **Email** enabled.

For a private community, turn *off* "Enable email confirmations" only if you understand
that anyone can then sign up with an unverified address. Leave it on otherwise.

## 2. Apply the schema

The entire schema — tables, RLS policies, RPCs, triggers, storage buckets — lives in
[`supabase/migrations/`](../supabase/migrations/). There is **no migration-tracking
table**: you replay every file, in filename order, and every file is idempotent, so
replaying is always safe and always brings the database in sync.

The easiest path for a first run is the SQL Editor: open each file in order and run it.
For 46 files you'll want `psql` instead — grab the **direct** connection URI (Project
Settings → Database → Connection string → URI, port **5432**, not the pooler):

```bash
export SUPABASE_DB_URL='postgresql://postgres:[YOUR-PASSWORD]@db.[REF].supabase.co:5432/postgres'

for f in $(ls supabase/migrations/*.sql | sort); do
  echo "→ $f"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

This also creates the `attachments` and `avatars` storage buckets with their policies —
no dashboard clicking required.

> **Adding your own migration later?** Read
> [`supabase/migrations/README.md`](../supabase/migrations/README.md) first. Idempotency
> isn't a style preference here; a non-idempotent file breaks every future replay.

## 3. Deploy the Edge Functions

Three functions, each holding a secret that must never ship inside a desktop binary.
Skip the ones you don't want — the app degrades gracefully.

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

**b.ai.t + translation** (both run on Gemini):

```bash
supabase secrets set GEMINI_API_KEY=...
supabase functions deploy bait
supabase functions deploy translate
```

**TURN credentials** — get a Key ID and API token from Cloudflare dashboard → Realtime →
TURN Keys:

```bash
supabase secrets set CF_TURN_KEY_ID=... CF_TURN_API_TOKEN=...
supabase functions deploy turn
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected into the
function runtime automatically — don't set them by hand.

Verify a deploy landed:

```bash
supabase functions list
curl -s -X POST "https://YOUR_REF.supabase.co/functions/v1/translate" \
  -H "Authorization: Bearer YOUR_ANON_KEY" -H 'content-type: application/json' \
  -d '{"scope":"channel","lang":"ru","ids":[]}'
# → {"error":"unauthorized"}  ← correct: the anon key is not a user session
```

## 4. Configure the client

```bash
cd desktop
cp .env.example .env.local
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The anon key is *meant* to ship
in the client — RLS is what protects your data, not the secrecy of that key.

## 5. Run it

```bash
npm install
npm run tauri dev      # dev window on localhost:1420
npm run tauri build    # installer: NSIS on Windows; .deb/.rpm/.AppImage on Linux
```

Register an account in the app. The first user is nobody special — see below.

## 6. Create the first server

Sign up, then create a server from the UI. If you want **every new account to land
somewhere** instead of an empty sidebar, mark that server as a default:

```sql
update public.servers set is_default = true where name = 'Your Server Name';
```

A trigger (`auto_join_default_servers`, from `20260628_default_server_autojoin.sql`) adds
each new signup to every server flagged this way. The migration ships flagging a server
named `blok off` — harmless if you don't have one.

Server ownership carries all permissions; everything else is a role bitfield you manage in
the app (Server settings → Roles).

## Optional pieces

### Self-hosted TURN instead of Cloudflare

[`infra/coturn/`](../infra/coturn/) has a docker-compose coturn setup. Point the client at
it with the static fallback vars in `.env.local` (`VITE_TURN_URLS`, `VITE_TURN_USERNAME`,
`VITE_TURN_CREDENTIAL`) and skip the `turn` function. Static credentials in a client binary
are weaker than minted ones — fine for a private deployment, not for a public build.

### Releases and auto-update for your fork

The release workflow tags → builds Windows + Linux → publishes to a separate public repo,
and clients update themselves via the Tauri updater. To run your own:

1. Generate a signing keypair: `npm run tauri signer generate`
2. Put the public key in `desktop/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`)
3. Point `plugins.updater.endpoints` at your own releases repo
4. Add repository secrets: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`,
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and a `RELEASES_PAT` that can write to it

Details in [`SIGNING.md`](SIGNING.md) and [`RELEASE.md`](../RELEASE.md).

## Troubleshooting

| Symptom | Cause |
|---|---|
| Login works, but every list is empty | Migrations not fully replayed — RLS helpers (`is_channel_member`) missing |
| Attachments never appear | `attachments` bucket missing; re-run `20260616_attachments_bucket.sql` |
| b.ai.t answers "rate limit reached" immediately | `bait_rate_check` missing or the daily cap is hit — see `20260616_bait_rate_limit.sql` |
| Translation returns `cache_read_failed` | `20260810_message_translations.sql` not applied |
| Voice connects but nobody hears anyone | No TURN reachable, or `libasound2-dev` missing at build time on Linux |
| Screen share shows a black frame | Same — TURN. Check the `turn` function is deployed and its Cloudflare secrets are set |
| `PGRST203` on an RPC | Two overloads of the same function in the database; drop the stale signature |

Still stuck? Open a [Discussion](https://github.com/pompei1i/blok/discussions) with your
Supabase region, what you ran, and the exact error.
