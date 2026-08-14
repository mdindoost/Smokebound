-- ============================================================================
-- SMOKE — M3: message lifecycle support (ARCHITECTURE §6.3, §6.4)
--
-- Adds:
--   * the dual-transport request/response tables — the beta runs from a home
--     server behind NAT, so the engine must be able to work fully outbound:
--     the client inserts a request row, the engine answers with a response row
--   * The Keeper's flavor lines and a `is_system` marker on profiles
-- ============================================================================

-- ---------------------------------------------------------------------------
-- System accounts (The Keeper — SPEC §3, REDTEAM F5)
-- ---------------------------------------------------------------------------
alter table public.profiles add column is_system boolean not null default false;

comment on column public.profiles.is_system is
  'True for engine-operated accounts such as The Keeper. Never a real person.';

create table public.keeper_lines (
  id int primary key,
  line text not null check (char_length(line) <= 280),
  era text
);

comment on table public.keeper_lines is
  'Rotating era-flavoured replies from The Keeper. Plain data, no LLM (ARCHITECTURE §6.3).';

-- ---------------------------------------------------------------------------
-- Dual transport (ARCHITECTURE §6.4)
--
-- The client inserts into engine_requests and waits (realtime or poll) for the
-- matching engine_responses row. Identical handlers serve the HTTP transport;
-- which transport runs is engine configuration, not a client concern.
-- ---------------------------------------------------------------------------
create table public.engine_requests (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('preview', 'send', 'resend')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz
);

create index engine_requests_pending_idx on public.engine_requests (created_at)
  where status = 'pending';
create index engine_requests_requester_idx on public.engine_requests (requester, created_at desc);

create table public.engine_responses (
  request_id uuid primary key references public.engine_requests (id) on delete cascade,
  requester uuid not null references public.profiles (id) on delete cascade,
  ok boolean not null,
  payload jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now()
);

create index engine_responses_requester_idx on public.engine_responses (requester, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.keeper_lines enable row level security;
alter table public.engine_requests enable row level security;
alter table public.engine_responses enable row level security;

revoke all on public.keeper_lines, public.engine_requests, public.engine_responses
  from anon, authenticated;

grant select, insert on public.engine_requests to authenticated;
grant select on public.engine_responses to authenticated;

-- A client may ask, and may watch its own asking. It may never answer.
create policy engine_requests_insert_own on public.engine_requests
  for insert to authenticated
  with check (requester = auth.uid() and status = 'pending');

create policy engine_requests_select_own on public.engine_requests
  for select to authenticated
  using (requester = auth.uid());

create policy engine_responses_select_own on public.engine_responses
  for select to authenticated
  using (requester = auth.uid());

-- keeper_lines is engine-only: the client sees the Keeper's words as messages.

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.engine_responses;
    exception when duplicate_object then null;
    end;
  end if;
end;
$$;
