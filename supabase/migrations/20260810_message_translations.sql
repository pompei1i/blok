-- Realtime message translation: a shared, cross-user translation cache plus its
-- own rate limiter.
--
-- Why a cache table: every client with auto-translate on would otherwise re-pay
-- for the same message. Translations are per (message, target language) and are
-- identical for everyone, so the first reader pays and the rest read the row.
-- With N members of a channel sharing a locale that's an N-fold cut in API calls
-- — which matters because the "translate" Edge Function runs on one shared
-- Gemini free-tier key.
--
-- Why no client write policy: only the Edge Function (service role) inserts, the
-- same way bait_requests is only touched by its SECURITY DEFINER RPC. Clients can
-- read a translation exactly when they can read the underlying message.

begin;

-- ── Cache ─────────────────────────────────────────────────────────────────────

-- scope tells which table message_id points at ('channel' → messages,
-- 'dm' → dm_messages). No FK: one column can't reference two tables — the
-- purge triggers below take the place of ON DELETE CASCADE.
create table if not exists message_translations (
  scope       text not null check (scope in ('channel', 'dm')),
  message_id  uuid not null,
  target_lang text not null check (char_length(target_lang) between 2 and 8),
  content     text not null,
  source_lang text,
  created_at  timestamptz not null default now(),
  primary key (scope, message_id, target_lang)
);

create index if not exists idx_message_translations_created
  on message_translations (created_at);

alter table message_translations enable row level security;
grant select on public.message_translations to authenticated;

-- Readable exactly when the source message is readable (mirrors
-- messages_select_member / "participants can read dm messages").
drop policy if exists "message_translations_select_visible" on public.message_translations;
create policy "message_translations_select_visible" on public.message_translations
  for select to authenticated using (
    case scope
      when 'channel' then exists (
        select 1 from public.messages m
        where m.id = message_translations.message_id
          and public.is_channel_member(m.channel_id)
      )
      when 'dm' then exists (
        select 1 from public.dm_messages dm
        join public.dm_channels dc on dc.id = dm.dm_channel_id
        where dm.id = message_translations.message_id
          and (
            dc.user_a_id = auth.uid()
            or dc.user_b_id = auth.uid()
            -- group DMs, should they start using the participants table
            or exists (
              select 1 from public.dm_participants p
              where p.dm_channel_id = dc.id and p.user_id = auth.uid()
            )
          )
      )
      else false
    end
  );

-- ── Invalidation (stands in for ON DELETE CASCADE, plus edits) ────────────────

-- Deleting a message drops its translations; editing one drops them too, since
-- a cached translation of the old text would otherwise be served forever.
create or replace function public.purge_message_translations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from message_translations
  where scope = tg_argv[0]::text and message_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_purge_translations_messages on public.messages;
create trigger trg_purge_translations_messages
  after delete on public.messages
  for each row execute function public.purge_message_translations('channel');

drop trigger if exists trg_purge_translations_messages_edit on public.messages;
create trigger trg_purge_translations_messages_edit
  after update of content on public.messages
  for each row when (old.content is distinct from new.content)
  execute function public.purge_message_translations('channel');

drop trigger if exists trg_purge_translations_dm on public.dm_messages;
create trigger trg_purge_translations_dm
  after delete on public.dm_messages
  for each row execute function public.purge_message_translations('dm');

drop trigger if exists trg_purge_translations_dm_edit on public.dm_messages;
create trigger trg_purge_translations_dm_edit
  after update of content on public.dm_messages
  for each row when (old.content is distinct from new.content)
  execute function public.purge_message_translations('dm');

-- ── Rate limiting ─────────────────────────────────────────────────────────────

-- Separate from bait_requests on purpose: auto-translate fires far more often
-- than b.ai.t prompts, and mixing them would let a busy channel eat the
-- assistant's daily budget. Counted in *messages* (units), not calls, so a batch
-- of 20 costs 20 — batching stays free of charge but can't dodge the cap.
create table if not exists translate_requests (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references profiles(id) on delete cascade,
  units      integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists idx_translate_requests_user_time
  on translate_requests (user_id, created_at desc);

alter table translate_requests enable row level security;
-- No client policies — only the SECURITY DEFINER RPC below touches this table.

create or replace function public.translate_rate_check(
  p_units       integer,
  p_max         integer,
  p_window_secs integer,
  p_daily_max   integer default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_window integer;
  v_daily  integer;
begin
  if v_uid is null or p_units <= 0 then
    return false;
  end if;

  -- Keep a day of history (needed for the daily cap); drop older markers.
  delete from translate_requests
  where user_id = v_uid and created_at < now() - interval '1 day';

  select coalesce(sum(units), 0) into v_window from translate_requests
  where user_id = v_uid and created_at >= now() - make_interval(secs => p_window_secs);
  if v_window + p_units > p_max then
    return false;
  end if;

  if p_daily_max is not null then
    select coalesce(sum(units), 0) into v_daily from translate_requests
    where user_id = v_uid;
    if v_daily + p_units > p_daily_max then
      return false;
    end if;
  end if;

  insert into translate_requests (user_id, units) values (v_uid, p_units);
  return true;
end;
$$;

grant execute on function public.translate_rate_check(integer, integer, integer, integer)
  to authenticated;

commit;
