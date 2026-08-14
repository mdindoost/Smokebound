-- ============================================================================
-- LOCAL TEST HARNESS ONLY — never apply this to a real Supabase project.
--
-- It is deliberately outside `supabase/migrations/`, so `supabase db push` will
-- not pick it up. Its job is to provide the pieces a hosted Supabase project
-- already has, so the real migrations can be applied to a bare Postgres (PGlite)
-- in tests: the `auth` schema, an `auth.users` table, `auth.uid()`, and the
-- anon / authenticated / service_role roles.
-- ============================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now()
);

-- Mirrors Supabase's auth.uid(): the `sub` claim of the request's JWT, which
-- PostgREST exposes as the `request.jwt.claims` GUC.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant select on auth.users to service_role;
