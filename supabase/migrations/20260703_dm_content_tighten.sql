-- Tighten the dm_messages.content cap: 10MB → 16KB.
--
-- The 10MB anti-bomb cap in 20260702_content_limits_rate existed only because
-- DM attachments were embedded as base64 data-URLs inside content. The client
-- now uploads DM files to the "attachments" Storage bucket and content carries
-- only short public URLs (JSON payload ≈ text + a few hundred bytes per file).
--
-- NOT VALID: existing base64-era rows are grandfathered (still readable, never
-- re-checked — the app has no DM edit path that would UPDATE them). New inserts
-- are capped, closing the row-bloat / broken-Realtime-delivery hole for good.

alter table dm_messages drop constraint if exists dm_messages_content_len;
alter table dm_messages add  constraint dm_messages_content_len
  check (char_length(content) <= 16384) not valid;
