-- Grant missing from 20260604_roles.sql — RLS was enabled but authenticated
-- role had no table-level permissions, causing 403 on all roles API calls.
grant select, insert, update, delete on public.roles to authenticated;

-- server_members.role_id column was added in the same migration; make sure
-- authenticated can still read/write the full row (inherits from existing grant
-- on server_members, but explicit is safer).
grant select, update on public.server_members to authenticated;
