-- ============================================================================
-- SMOKE — M1 schema (ARCHITECTURE §3)
--
-- Supabase `auth.users` is the identity root. Everything gameplay-related is
-- written by the engine service (service_role); clients read through RLS and may
-- only insert a message, a flock request, a block or a report.
--
-- No gameplay numbers live here except the one the spec puts in the schema
-- itself: the 280-char body cap (MECHANICS §5), mirrored from
-- `mechanics_config -> message.char_cap`. Changing the cap is therefore a
-- migration + a config update, on purpose: the DB is the last line of defence
-- against an oversized body, and transmission time is bounded by it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- @name, 3-20 chars (SPEC §3). Handles are compared case-insensitively.
  handle text unique not null
    check (char_length(handle) between 3 and 20 and handle ~ '^[A-Za-z0-9_]+$'),
  display_name text check (char_length(display_name) <= 40),
  -- Coarse cell id only — never raw lat/lng (ARCHITECTURE §8, SPEC §8).
  home_cell text not null check (home_cell ~ '^r[0-9]{3}c[0-9]{3}$'),
  last_active_at timestamptz,
  expo_push_token text,
  created_at timestamptz not null default now()
);

create unique index profiles_handle_lower_idx on public.profiles (lower(handle));
comment on column public.profiles.home_cell is
  'Cell id from packages/shared cell math. Coarse by design: ~50 km resolution.';

-- ---------------------------------------------------------------------------
-- flock — symmetric friendships, one row per pair, always stored with a < b
-- ---------------------------------------------------------------------------
create table public.flock (
  a uuid not null references public.profiles (id) on delete cascade,
  b uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  requested_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (a, b),
  constraint flock_canonical_order check (a < b),
  constraint flock_requester_is_party check (requested_by in (a, b))
);

create index flock_b_idx on public.flock (b);
create index flock_pending_idx on public.flock (requested_by) where status = 'pending';

-- ---------------------------------------------------------------------------
-- blocks — App Store guideline 1.2 (REDTEAM F1)
-- ---------------------------------------------------------------------------
create table public.blocks (
  blocker uuid not null references public.profiles (id) on delete cascade,
  blocked uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  constraint blocks_not_self check (blocker <> blocked)
);

create index blocks_blocked_idx on public.blocks (blocked);

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null references public.profiles (id) on delete cascade,
  recipient uuid not null references public.profiles (id) on delete cascade,
  -- MECHANICS §5: 280-char cap, mirrored from mechanics_config.message.char_cap.
  body text not null check (char_length(body) <= 280),
  -- Post-garble text; null until DELIVERED (MECHANICS §6.2).
  body_delivered text,
  state text not null default 'TRANSMITTING'
    check (state in ('TRANSMITTING', 'IN_FLIGHT', 'STRANDED', 'DELIVERED', 'LOST')),
  origin_cell text not null check (origin_cell ~ '^r[0-9]{3}c[0-9]{3}$'),
  dest_cell text not null check (dest_cell ~ '^r[0-9]{3}c[0-9]{3}$'),
  route jsonb,                            -- ordered cell ids
  segment_etas jsonb,                     -- cumulative eta per waypoint (server truth)
  current_leg int not null default 0 check (current_leg >= 0),
  departed_at timestamptz,
  eta timestamptz,
  stranded_since timestamptz,
  stranded_cell text check (stranded_cell ~ '^r[0-9]{3}c[0-9]{3}$'),
  garble_events jsonb not null default '[]',   -- [{cell, at, chars_hit}]
  lost_at timestamptz,
  lost_cell text check (lost_cell ~ '^r[0-9]{3}c[0-9]{3}$'),
  lost_reason text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  -- Terminal states carry their evidence (ARCHITECTURE §4).
  constraint messages_delivered_has_body
    check (state <> 'DELIVERED' or (body_delivered is not null and delivered_at is not null)),
  constraint messages_lost_has_reason
    check (state <> 'LOST' or lost_at is not null)
);

create index messages_recipient_state_idx on public.messages (recipient, state);
create index messages_sender_created_idx on public.messages (sender, created_at desc);
create index messages_thread_idx on public.messages (sender, recipient, created_at desc);
-- The engine's cron working set: everything not yet terminal.
create index messages_in_flight_idx on public.messages (state, eta)
  where state in ('TRANSMITTING', 'IN_FLIGHT', 'STRANDED');

comment on column public.messages.body is
  'Original text. Visible to the sender always, to the recipient only once state = DELIVERED (RLS).';

-- ---------------------------------------------------------------------------
-- reports — App Store guideline 1.2 (REDTEAM F1)
-- Declared after `messages` because of the FK; ARCHITECTURE §3 lists it earlier.
-- ---------------------------------------------------------------------------
create table public.reports (
  id bigserial primary key,
  reporter uuid not null references public.profiles (id) on delete cascade,
  message_id uuid references public.messages (id) on delete set null,
  reason text check (char_length(reason) <= 500),
  created_at timestamptz not null default now()
);

create index reports_created_idx on public.reports (created_at desc);
create index reports_message_idx on public.reports (message_id);

-- ---------------------------------------------------------------------------
-- weather_cells — per-cell weather cache (MECHANICS §1, §2.1)
-- ---------------------------------------------------------------------------
create table public.weather_cells (
  cell text primary key check (cell ~ '^r[0-9]{3}c[0-9]{3}$'),
  condition text,
  wind_mph int check (wind_mph >= 0),
  wind_dir int check (wind_dir >= 0 and wind_dir < 360),
  time_mult numeric check (time_mult > 0),   -- precomputed from the MECHANICS §2.1 table
  -- True only while an NWS severe warning/watch is active (REDTEAM F2).
  impassable boolean not null default false,
  -- Fail-open flag: stale/unfetchable weather is treated as clear (REDTEAM F4).
  weather_unknown boolean not null default false,
  fetched_at timestamptz
);

create index weather_cells_fetched_idx on public.weather_cells (fetched_at);

-- ---------------------------------------------------------------------------
-- mechanics_config — EVERY number from MECHANICS.md (ARCHITECTURE §10)
-- ---------------------------------------------------------------------------
create table public.mechanics_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.mechanics_config is
  'Single source of gameplay numbers. Seeded by services/engine (npm run db:seed). '
  'Any gameplay number hardcoded outside that seed is a bug (ARCHITECTURE §10).';

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger mechanics_config_touch
  before update on public.mechanics_config
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- events — notification/event log per message
-- ---------------------------------------------------------------------------
create table public.events (
  id bigserial primary key,
  message_id uuid not null references public.messages (id) on delete cascade,
  kind text not null
    check (kind in ('SENT', 'DEPARTED', 'STRANDED', 'RESUMED', 'GARBLED', 'DELIVERED', 'LOST')),
  payload jsonb,
  created_at timestamptz not null default now()
);

create index events_message_idx on public.events (message_id, created_at);
