-- ════════════════════════════════════════════════════════════════════════════
-- Realtime fixes for live XP + daily-quest progress.
-- The v0.9.14 quests/XP migrations never added these tables to the realtime
-- publication, so the client's subscriptions received no events (progress/XP
-- only refreshed on reload). Add them here. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'daily_quest_progress'
  ) then
    alter publication supabase_realtime add table daily_quest_progress;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'server_members'
  ) then
    alter publication supabase_realtime add table server_members;
  end if;
end $$;
