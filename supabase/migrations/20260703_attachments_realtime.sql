-- Add attachments to the realtime publication.
--
-- The client used to do a full joined refetch of every message it received via
-- postgres_changes INSERT (to pick up attachments, which are inserted right
-- after the message row). That's an N+1 amplified across every online client —
-- each message anyone sends triggered one extra joined SELECT per viewer.
--
-- With attachments streaming over realtime the client patches them into the
-- already-rendered message instead (message-slice `public:attachments` sub),
-- and only fetches the author profile when it's not cached.
--
-- Delivery is RLS-scoped like every postgres_changes event: subscribers only
-- receive rows their existing attachments SELECT policy lets them read.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attachments'
  ) then
    alter publication supabase_realtime add table attachments;
  end if;
end $$;
