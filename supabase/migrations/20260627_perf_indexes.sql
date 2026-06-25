-- Performance indexes for the hottest query paths.
--
-- Base tables (messages, server_members, channels, categories,
-- user_relationships) were created outside the migration files, so none of
-- these composite/FK indexes existed. Postgres does NOT auto-index foreign
-- keys, and the RLS membership helpers (is_server_member / has_server_perm)
-- probe server_members on essentially every message/channel/category read.
--
-- Plain CREATE INDEX (not CONCURRENTLY) is used deliberately: beta tables are
-- small so the brief lock is negligible, and this lets the whole file run as a
-- single statement batch in the Supabase SQL Editor. On a large production
-- table, switch the relevant index to CREATE INDEX CONCURRENTLY run OUTSIDE a
-- transaction.

-- ── Hottest query: load a channel's messages newest-first, paginated ──────────
-- message-slice.ts: .eq("channel_id", x).order("created_at", desc).limit(n)
create index if not exists idx_messages_channel_created
  on messages (channel_id, created_at desc);

-- author_id is an FK with no index; patchUser / author lookups and any
-- per-author moderation scan benefit.
create index if not exists idx_messages_author
  on messages (author_id);

-- ── RLS hot path: is_server_member / has_server_perm probe server_members ─────
-- PK is `id`, so neither of these lookups was indexed.
create index if not exists idx_server_members_user
  on server_members (user_id);
create index if not exists idx_server_members_server
  on server_members (server_id);

-- ── Per-server child loads (initData / joinByInviteCode .eq("server_id")) ─────
create index if not exists idx_channels_server
  on channels (server_id);
create index if not exists idx_categories_server
  on categories (server_id);

-- ── Friends: relationship lookups by either side ─────────────────────────────
create index if not exists idx_user_relationships_requester
  on user_relationships (requester_id);
create index if not exists idx_user_relationships_target
  on user_relationships (target_id);
