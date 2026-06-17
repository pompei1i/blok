-- roles table + role_id on server_members
create table if not exists roles (
  id          uuid primary key default gen_random_uuid(),
  server_id   uuid not null references servers(id) on delete cascade,
  name        text not null,
  color       text,
  permissions integer not null default 0,
  position    integer not null default 0,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table server_members add column if not exists role_id uuid references roles(id) on delete set null;

alter table roles enable row level security;

drop policy if exists "members can read roles" on roles;
create policy "members can read roles" on roles
  for select using (
    server_id in (
      select server_id from server_members where user_id = auth.uid()
    )
  );

drop policy if exists "owner can manage roles" on roles;
create policy "owner can manage roles" on roles
  for all using (
    server_id in (select id from servers where owner_id = auth.uid())
  )
  with check (
    server_id in (select id from servers where owner_id = auth.uid())
  );
