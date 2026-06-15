-- Realtime publication catch-up.
--
-- Several client subscriptions silently receive nothing unless their table is in
-- the supabase_realtime publication. Two user-visible bugs trace back to this:
--   • A freshly granted role's permission bits don't reach the member's client
--     until a full re-login (roles never streamed).            → add `roles`
--   • A peer flips to "offline" ~90s after load even while active, because their
--     heartbeat online_at updates never arrive.                → add `user_presence`
-- `server_members` is included too so role-assignment / xp changes always stream.
-- All adds are guarded → idempotent and safe if already published.
do $$
declare
  t text;
begin
  foreach t in array array['roles', 'user_presence', 'server_members'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
