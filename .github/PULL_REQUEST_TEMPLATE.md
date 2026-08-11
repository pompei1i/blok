## What this changes

<!-- One or two sentences. If it fixes an issue, write "Fixes #123". -->

## Why

<!-- The problem behind the patch. Skip if it's obvious from the title. -->

## How you tested it

<!-- Name the OS and what you actually clicked through. "Windows 11, joined a voice
     channel with a second account, screen shared for 5 min" is worth more than "works". -->

## Checklist

- [ ] `npm run build` passes (tsc strict + vite)
- [ ] `npm run test` passes
- [ ] `npm run i18n:check` passes — every user-facing string exists in all six locales
- [ ] New DB objects ship as an **idempotent** migration with RLS policies ([rules](../supabase/migrations/README.md))
- [ ] No new client-side write access that belongs in a `SECURITY DEFINER` RPC
- [ ] Screenshots or a clip attached, if anything visual changed
