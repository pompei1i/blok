# Contributing to blok

Thanks for taking a look. blok is a solo project that grew large, so the most useful
contributions are the small, sharp ones: a bug with clear repro steps, a fix for
something that annoys you, a translation that reads like a human wrote it.

## Before you write code

**Open an issue first for anything substantial.** A feature that doesn't fit the
direction of the project is a bad afternoon for both of us. Small fixes — a crash, a
typo, a wrong translation string, a broken link — need no discussion; just send the PR.

Good first areas:

- **Translations.** Six locales live in [`desktop/src/locales/`](desktop/src/locales/).
  They must all carry the exact same key set — `npm run i18n:check` enforces it.
- **Bugs with a repro.** Especially voice, screen share, and anything Linux.
- **Tests.** The suite is Vitest; store logic and pure helpers are the easy wins.

## Setting up

```bash
git clone https://github.com/pompei1i/blok.git
cd blok/desktop
npm install
cp .env.example .env.local   # then fill in your Supabase keys
npm run tauri dev
```

You need your own Supabase project — the backend is not shared. The full walkthrough
(schema, Edge Functions, secrets, TURN) is in [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md).
Linux also needs system packages; see [`desktop/README.md`](desktop/README.md).

## The checks

Everything below must pass before a PR is ready. They're fast — run them locally.

```bash
cd desktop
npm run build         # tsc (strict) + vite build
npm run test          # Vitest
npm run i18n:check    # locale key parity
```

## House style

The codebase has a consistent voice. Match the file you're editing rather than your own
defaults:

- **TypeScript strict**, no `any` you can avoid, no `@ts-ignore` without a comment
  explaining what it's hiding.
- **Comments explain *why*, not *what*.** If a line looks odd but is deliberate, say what
  goes wrong without it. That's the norm across the repo — keep it.
- **State lives in Zustand stores** under [`desktop/src/lib/store/`](desktop/src/lib/store/),
  split into slices. Components read from stores; they don't own domain state.
- **Never widen the client's database powers.** Privileged writes go through
  `SECURITY DEFINER` RPCs, not new client-side grants. See below.
- **Every user-facing string goes through i18n** — all six locales, no exceptions.

## Database changes

The live schema is defined **entirely** by the SQL files in
[`supabase/migrations/`](supabase/migrations/). There is no migration-tracking table:
the whole folder is replayed in filename order, so **every migration must be
idempotent** — `create table if not exists`, `drop policy if exists` before
`create policy`, `create or replace function`. The rules and the reasoning are in
[`supabase/migrations/README.md`](supabase/migrations/README.md); read it before adding a file.

Row-Level Security is on for every table. A PR that adds a table without policies, or
that grants clients direct write access to something an RPC should own, will be sent back.

## Commits and PRs

- Conventional-commit prefixes: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`,
  `test:`, optionally scoped — `feat(voice):`, `fix(ci):`.
- One logical change per PR. A refactor bundled with a feature is two PRs.
- Say what you tested and on which OS. "Works on my machine" is fine as long as you
  name the machine.
- Screenshots or a short clip for anything visual.

## Reporting security problems

Don't open a public issue. See [`SECURITY.md`](SECURITY.md).

## License

blok is [AGPL-3.0](LICENSE). By contributing you agree your work ships under that
license — including the requirement that a modified version run as a network service
must offer its source to users.
