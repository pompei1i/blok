-- Full-text search index on messages.content.
-- (Plain CREATE INDEX, not CONCURRENTLY, so it can run inside the migration
-- transaction / SQL editor; the table is small and superseded by the 'simple'
-- index in 20260605 anyway.)
-- Uses Russian language config — add more configs or switch to 'simple' if multilingual search is needed.
CREATE INDEX IF NOT EXISTS idx_messages_content_gin
  ON messages USING gin(to_tsvector('russian', content))
  WHERE content IS NOT NULL;
