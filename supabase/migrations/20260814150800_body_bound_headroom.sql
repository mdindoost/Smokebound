-- ============================================================================
-- SMOKE — REDTEAM F25: give the storage bound room for any legal message
--
-- 280 family emoji are 1,960 code points, which left forty characters of margin
-- under the old 2,000 bound — and a body of 280 heavily-combined clusters could
-- exceed it while obeying the 280-grapheme cap exactly.
--
-- The bound is a guard against absurd payloads, not a gameplay rule, so it costs
-- nothing to make it comfortable.
-- ============================================================================

alter table public.messages drop constraint if exists messages_body_check;

alter table public.messages
  add constraint messages_body_check check (char_length(body) <= 4000);
