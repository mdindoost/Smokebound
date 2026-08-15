-- ============================================================================
-- SMOKE — the migration ledger is nobody's business but the engine's
--
-- `schema_migrations` is created by the migration runner, so it missed the
-- sweep in 20260814150200 that enabled RLS on every application table. On
-- Supabase that means two things: any signed-in client could read the list of
-- migration filenames, and the dashboard's security advisor flags the table.
--
-- RLS on with no policies: the service role (which bypasses RLS) still reads
-- and writes it, and nobody else sees a row.
-- ============================================================================

alter table public.schema_migrations enable row level security;

revoke all on public.schema_migrations from anon, authenticated;
