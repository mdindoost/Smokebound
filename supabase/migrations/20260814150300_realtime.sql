-- ============================================================================
-- SMOKE — Realtime publication (ARCHITECTURE §2, §6.4)
--
-- The client subscribes to `messages` and `events` to follow a flight without
-- polling. Realtime honours RLS, so a recipient still receives nothing until the
-- message is DELIVERED.
--
-- Guarded so the migration also applies to a plain Postgres instance (local
-- tests), where the `supabase_realtime` publication does not exist.
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.messages;
    exception when duplicate_object then null;
    end;

    begin
      alter publication supabase_realtime add table public.events;
    exception when duplicate_object then null;
    end;
  end if;
end;
$$;
