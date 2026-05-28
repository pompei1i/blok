-- Full-text search index on messages.content.
-- CONCURRENTLY avoids locking the table during creation; safe on existing data.
-- Uses Russian language config — add more configs or switch to 'simple' if multilingual search is needed.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_content_gin
  ON messages USING gin(to_tsvector('russian', content))
  WHERE content IS NOT NULL;
