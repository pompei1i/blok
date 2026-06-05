-- The "owner can manage roles" policy used a subquery into `servers`, which is
-- itself protected by RLS. When the policy evaluated `auth.uid()` inside that
-- subquery, Postgres ran it as the row-level user and the servers RLS blocked
-- it, causing a 42501 violation even for the actual server owner.
--
-- Fix: wrap the ownership check in a SECURITY DEFINER function so it always
-- executes as the defining role (bypassing RLS on `servers`).

create or replace function public.is_server_owner(p_server_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.servers
    where id = p_server_id
      and owner_id = auth.uid()
  );
$$;

-- Recreate the policy using the helper function
drop policy if exists "owner can manage roles" on public.roles;

create policy "owner can manage roles" on public.roles
  for all
  using  (public.is_server_owner(server_id))
  with check (public.is_server_owner(server_id));
