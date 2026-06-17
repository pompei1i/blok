# Migrations

The live Supabase schema is defined **entirely** by the `.sql` files in this folder.
Don't hand-edit the production schema in the dashboard — it drifts, and we've been
burned by it (missing `has_server_perm`, a missing quest trigger).

## How they're applied
`.github/workflows/db-migrate.yml` replays **every** migration in filename order on
each push to `main` that touches this folder (or via *Run workflow* / `workflow_dispatch`).
Because every migration is **idempotent**, replaying the whole folder is safe and
always brings the DB into sync — there's no migration-tracking table to get out of step.

**One-time setup:** add the repo secret `SUPABASE_DB_URL` = the **direct** Postgres
URI (Supabase → Settings → Database → Connection string → URI, the 5432 one, not the
pooler), then run the workflow once to reconcile.

Locally you can do the same:
```bash
for f in $(ls supabase/migrations/*.sql | sort); do
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

## The one rule: every migration must be idempotent
Running it twice (or against a DB where it's half-applied) must not error. Use:

| Instead of | Write |
|---|---|
| `create table x (…)` | `create table if not exists x (…)` |
| `create index i …` | `create index if not exists i …` |
| `alter table x add column c …` | `alter table x add column if not exists c …` |
| `create policy "p" on x …` | `drop policy if exists "p" on x;` then `create policy "p" on x …` |
| `create trigger t …` | `drop trigger if exists t on x;` then `create trigger t …` |
| `create function f …` | `create or replace function f …` |
| `create type e as enum (…)` | wrap in `do $$ begin create type … exception when duplicate_object then null; end $$;` |
| `insert into seed …` | `insert … on conflict do nothing` (or `do update`) |
| `alter publication supabase_realtime add table x` | guard with `if not exists (select 1 from pg_publication_tables where …)` |

## Naming
`YYYYMMDD_short_description.sql`. Order is by filename, so same-day migrations apply
alphabetically — keep them independent or prefix to force order. (We replay all files
every run, so we don't need unique 14-digit timestamps the Supabase CLI would want.)

## RPC / SECURITY DEFINER conventions
Privileged writes (bypassing RLS) go through `security definer` functions scoped to
`auth.uid()`, with `set search_path = public`. Permission checks reuse
`public.has_server_perm(server_id, bit)` (owner always passes). See
`20260607_rename_permissions.sql` and `20260615_moderation.sql` for the pattern.
