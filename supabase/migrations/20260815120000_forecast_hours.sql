-- ============================================================================
-- SMOKE — hourly forecasts, for counsel (MECHANICS-V2 §5.3, REDTEAM F42, F43)
--
-- Counsel compares candidate departure times, so it must price cells by the
-- weather *then* rather than now. `weather_cells` cannot answer that: it holds
-- one row per cell, and the router reads it on every plan.
--
-- A separate table, deliberately. Folding 156 hourly rows into `weather_cells`
-- would multiply the cardinality of the router's hot table by two orders of
-- magnitude, and invalidate the one-row-per-cell assumption in every query,
-- index and policy that touches it — to serve a feature the hot path never
-- reads. Two tables, two lifecycles, two TTLs.
--
-- REDTEAM F42: every counsel candidate reads this table, *including* "send
-- now", which takes the hour-0 row. Pricing "now" from `weather_cells` and the
-- later candidates from here would compare two forecast products with different
-- biases, and hourly forecasts are smoothed — counsel would have recommended
-- waiting for reasons that were an artefact of table choice, plausibly, every
-- time. `weather_cells` remains the authority for actual sends and replans.
--
-- REDTEAM F43a: rows expire and are swept hourly. Growth is bounded by
-- forecast.horizon_hours × cells ever warmed for counsel — never the whole
-- grid, because only corridors with recent traffic are warmed at all.
-- ============================================================================

create table public.forecast_hours (
  cell text not null check (cell ~ '^r[0-9]{3}c[0-9]{3}$'),
  -- The hour this forecast is *for*, truncated to the hour.
  valid_hour timestamptz not null,
  condition text,
  wind_mph int check (wind_mph >= 0),
  wind_dir int check (wind_dir >= 0 and wind_dir < 360),
  time_mult numeric check (time_mult > 0),
  fetched_at timestamptz not null default now(),
  primary key (cell, valid_hour)
);

-- The janitor's index: sweeping is "delete where valid_hour < now()".
create index forecast_hours_valid_idx on public.forecast_hours (valid_hour);
-- The staleness check: "which of these cells needs refetching?"
create index forecast_hours_fetched_idx on public.forecast_hours (cell, fetched_at);

comment on table public.forecast_hours is
  'Hourly forecasts for counsel (MECHANICS-V2 §5.3). Every counsel candidate '
  'reads this table including "send now" (REDTEAM F42); weather_cells stays the '
  'authority for real sends and replans.';

-- ---------------------------------------------------------------------------
-- RLS: engine-only.
--
-- Unlike `weather_cells`, which the app reads to mark unforecast cells on a
-- route, nothing on the client has any business with 156 hours of forecast.
-- Counsel is computed server-side and arrives as one sentence. No policy is
-- granted, so RLS denies everyone but the service role.
-- ---------------------------------------------------------------------------
alter table public.forecast_hours enable row level security;

revoke all on public.forecast_hours from anon, authenticated;
