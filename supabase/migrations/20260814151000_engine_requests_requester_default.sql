-- ============================================================================
-- SMOKE — a request knows who asked, without being told
--
-- `engine_requests.requester` had no default, so a client that inserted only
-- {kind, payload} — which is exactly what the app did — left it NULL and was
-- refused by its own RLS policy (`requester = auth.uid()`). The failure looked
-- like a permissions bug rather than a missing column.
--
-- Defaulting to auth.uid() makes the honest thing automatic: the policy still
-- decides, but a caller can no longer forget to identify itself. The client
-- sends it explicitly too, so the intent is readable at both ends.
-- ============================================================================

alter table public.engine_requests
  alter column requester set default auth.uid();

comment on column public.engine_requests.requester is
  'Who asked. Defaults to auth.uid() and is enforced by RLS — the engine trusts '
  'this column exactly as much as it would trust a verified JWT.';
