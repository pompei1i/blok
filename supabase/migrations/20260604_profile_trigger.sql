-- Automatically create a profiles row when a new auth user is registered.
-- Runs as security definer so it bypasses RLS on the profiles table.

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
    split_part(new.email, '@', 1)
  );

  -- Normalise: lowercase, spaces→underscore, keep only [a-z0-9_], max 24 chars
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

  insert into public.profiles (id, username, email, display_name, status_message, accent_color, created_at)
  values (
    new.id,
    clean_username,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', clean_username),
    'Online',
    '#c0392b',
    now()
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Drop and recreate so the function body is always up to date
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
