-- ============================================================================
-- SMOKE — REDTEAM F20: the body bound is a sanity guard, not the cap
--
-- MECHANICS §5 caps a message at 280 *grapheme clusters* — what a reader calls a
-- character. Postgres counts code points, and a legal 280-cluster message can be
-- several times longer in those units (280 family emoji are 1,960 code points).
-- The old `char_length(body) <= 280` therefore rejected messages the rules
-- allow, and quietly penalised every script that uses combining marks.
--
-- So: the engine is the authoritative 280-grapheme gate, and the database keeps
-- a generous bound whose only job is to stop absurd payloads.
-- ============================================================================

alter table public.messages drop constraint if exists messages_body_check;

alter table public.messages
  add constraint messages_body_check check (char_length(body) <= 2000);

comment on column public.messages.body is
  'Original text. The gameplay cap is 280 grapheme clusters, enforced by the engine '
  '(mechanics_config.message.char_cap); this column bounds storage only. '
  'Visible to the sender always, to the recipient only once state = DELIVERED (RLS).';
