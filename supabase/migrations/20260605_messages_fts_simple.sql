-- Switch FTS index from 'russian' to 'simple' (language-neutral, no stemming).
-- 'simple' matches all languages in the app (EN, RU, UK, PL, DE, ES) without
-- language-specific stemming that would drop non-Russian tokens.
--
-- The old 'russian' index is dropped first; IF NOT EXISTS makes this re-runnable.
-- (Plain CREATE/DROP INDEX, not CONCURRENTLY, so it runs inside the migration
-- transaction / SQL editor.)

DROP INDEX IF EXISTS idx_messages_content_gin;

CREATE INDEX IF NOT EXISTS idx_messages_content_fts
  ON messages USING GIN (to_tsvector('simple', content))
  WHERE content IS NOT NULL;
