-- Scope `servers` SELECT to membership — close the last cross-server read leak.
--
-- Root cause: the F1 hardening (20260619) scoped messages / channels / categories /
-- server_members to membership, but left `servers` itself with an early permissive
-- "Enable read = true" SELECT policy. So `initData`'s `from("servers").select("*")`
-- returned EVERY server in the database to any authenticated user — a logged-in
-- non-member saw all servers in their list (empty, since channels/members are
-- already scoped, but still leaking names/icons/invite codes).
--
-- Fix: a logged-in user may read a server only if they own it or are a member.
-- Joining/creating already happens through SECURITY DEFINER RPCs
-- (create_server, join_server_by_invite) that add the membership row first, so the
-- client's subsequent direct read of that one server (by id) still passes.
--
-- We drop EVERY existing SELECT-command policy on servers by name-agnostic
-- enumeration (the permissive one predates this folder and its name isn't known
-- here), then add the single scoped policy. Write policies (owner-scoped INSERT/
-- UPDATE/DELETE used by generateInviteCode etc.) are left untouched.
--
-- Idempotent: the drop loop is a no-op on replay; the create is drop-then-create.

begin;

-- Drop all SELECT policies currently on public.servers, whatever they're named.
do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'servers'
      and cmd = 'SELECT'
  loop
    execute format('drop policy if exists %I on public.servers', pol.policyname);
  end loop;
end $$;

drop policy if exists "servers_select_member" on public.servers;
create policy "servers_select_member" on public.servers
  for select to authenticated using (
    owner_id = auth.uid() or public.is_server_member(id)
  );

commit;
