-- Abuse guards for the public beta: size caps + message rate limiting.
--
-- 1) CHECK caps on user-writable text columns. A modified client could insert
--    multi-MB payloads (e.g. 50MB base64 into avatar_url) that every other
--    client then downloads on member-list/message fetches — bandwidth DoS.
--    All constraints are NOT VALID: enforced for new writes, existing rows
--    are not scanned (safe to apply on live data).
--
-- 2) Rate limit on messages: 5 per 10s per author per channel (mirrors the
--    slowmode carve-out — MANAGE_CHANNELS bypasses). dm_messages: 15 per 10s
--    per author.
--
-- NOTE: dm_messages.content gets only a generous 10MB anti-bomb cap for now —
-- DM attachments are still legitimately embedded as base64 JSON in content.
-- Tighten to ~8KB after the DM-attachments-to-Storage migration lands.

begin;

-- ── Size caps ────────────────────────────────────────────────────────────────

alter table messages     drop constraint if exists messages_content_len;
alter table messages     add  constraint messages_content_len
  check (char_length(content) <= 4000) not valid;

alter table dm_messages  drop constraint if exists dm_messages_content_len;
alter table dm_messages  add  constraint dm_messages_content_len
  check (char_length(content) <= 10000000) not valid;

alter table profiles     drop constraint if exists profiles_avatar_len;
alter table profiles     add  constraint profiles_avatar_len
  check (avatar_url is null or char_length(avatar_url) <= 200000) not valid;

alter table profiles     drop constraint if exists profiles_banner_len;
alter table profiles     add  constraint profiles_banner_len
  check (banner_url is null or char_length(banner_url) <= 400000) not valid;

alter table profiles     drop constraint if exists profiles_bio_len;
alter table profiles     add  constraint profiles_bio_len
  check (bio is null or char_length(bio) <= 2000) not valid;

alter table profiles     drop constraint if exists profiles_status_len;
alter table profiles     add  constraint profiles_status_len
  check (status_message is null or char_length(status_message) <= 200) not valid;

alter table profiles     drop constraint if exists profiles_username_len;
alter table profiles     add  constraint profiles_username_len
  check (char_length(username) <= 32) not valid;

alter table profiles     drop constraint if exists profiles_display_name_len;
alter table profiles     add  constraint profiles_display_name_len
  check (display_name is null or char_length(display_name) <= 64) not valid;

-- ── Message rate limit (extends the existing moderation trigger) ────────────

create or replace function public.enforce_message_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
  v_slow      integer;
  v_timeout   timestamptz;
  v_last      timestamptz;
  v_recent    integer;
begin
  select c.server_id, c.slow_mode_seconds into v_server_id, v_slow
  from channels c where c.id = new.channel_id;

  -- Channel may belong to no server (DMs use a separate table) — nothing to enforce.
  if v_server_id is null then
    return new;
  end if;

  select sm.timeout_until into v_timeout
  from server_members sm
  where sm.server_id = v_server_id and sm.user_id = new.author_id;

  if v_timeout is not null and v_timeout > now() then
    raise exception 'you are timed out in this server' using errcode = 'check_violation';
  end if;

  if coalesce(v_slow, 0) > 0 and not public.has_server_perm(v_server_id, 4096) then
    select max(created_at) into v_last
    from messages
    where channel_id = new.channel_id and author_id = new.author_id;
    if v_last is not null and v_last > now() - make_interval(secs => v_slow) then
      raise exception 'channel is in slow mode' using errcode = 'check_violation';
    end if;
  end if;

  -- Burst guard: 5 messages / 10s per author per channel, independent of
  -- slowmode. MANAGE_CHANNELS (4096) bypasses, same as slowmode.
  if not public.has_server_perm(v_server_id, 4096) then
    select count(*) into v_recent
    from messages
    where channel_id = new.channel_id
      and author_id  = new.author_id
      and created_at > now() - interval '10 seconds';
    if v_recent >= 5 then
      raise exception 'sending too fast — slow down' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;
-- Trigger trg_enforce_message_rules already exists (20260615) and points at
-- this function name — replacing the function body is enough.

-- ── DM rate limit ────────────────────────────────────────────────────────────

create index if not exists dm_messages_author_created_idx
  on dm_messages (author_id, created_at desc);

create or replace function public.enforce_dm_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent integer;
begin
  select count(*) into v_recent
  from dm_messages
  where author_id = new.author_id
    and created_at > now() - interval '10 seconds';
  if v_recent >= 15 then
    raise exception 'sending too fast — slow down' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_dm_rate on dm_messages;
create trigger trg_enforce_dm_rate
  before insert on dm_messages
  for each row execute function public.enforce_dm_rate();

commit;
