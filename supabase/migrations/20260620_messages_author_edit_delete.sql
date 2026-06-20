-- Fix message edit/delete RLS gaps found during the F1 live test.
--
-- `messages` had only one UPDATE policy ("server owner can pin messages") and NO
-- DELETE policy at all. Effects:
--   • editing your own message worked only if you were the server owner (the pin
--     policy gates the row, not the column); regular authors were silently blocked
--     and their edit reverted on reload.
--   • deleting any message was blocked for everyone — the optimistic UI hid it
--     until a refresh brought the message back.
--
-- Add: authors may edit/delete their own messages; the server owner may delete any
-- message in their server (moderation).
--
-- Idempotent: safe to replay.

begin;

-- author can edit own message (coexists with the owner pin/update policy, OR'd)
drop policy if exists "author can update own message" on public.messages;
create policy "author can update own message" on public.messages
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- delete: the author, or the server owner of the message's channel
drop policy if exists "author or owner can delete message" on public.messages;
create policy "author or owner can delete message" on public.messages
  for delete to authenticated
  using (
    author_id = auth.uid()
    or exists (
      select 1 from channels c
      join servers s on s.id = c.server_id
      where c.id = messages.channel_id and s.owner_id = auth.uid()
    )
  );

commit;
