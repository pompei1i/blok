-- Drop the redundant profiles.email column (PII leak from the F1 review).
--
-- The authoritative email lives in auth.users; profiles.email was just a copy made
-- at signup for early convenience. Because every authenticated user can read all
-- profile rows, that copy exposed everyone's email. The desktop app only ever needs
-- the *current* user's own email, which it now reads from the auth session instead.
--
-- Steps: stop the signup trigger from copying email, then drop the column.
-- Idempotent: safe to replay.

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  raw_username text;
  clean_username text;
begin
  raw_username := coalesce(
    new.raw_user_meta_data->>'username',
    split_part(new.email, '@', 1)        -- reads auth.users.email (still exists there)
  );

  clean_username := substring(
    regexp_replace(
      regexp_replace(lower(trim(raw_username)), '\s+', '_', 'g'),
      '[^a-z0-9_]', '', 'g'
    )
    from 1 for 24
  );

  if clean_username = '' then
    clean_username := 'user';
  end if;

  insert into public.profiles (id, username, display_name, status_message, accent_color, created_at)
  values (
    new.id,
    clean_username,
    coalesce(new.raw_user_meta_data->>'display_name', clean_username),
    'Online',
    '#c0392b',
    now()
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

alter table public.profiles drop column if exists email;

commit;
