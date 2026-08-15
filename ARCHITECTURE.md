# SMOKE — Technical Architecture v0.1

Companion to SPEC.md (product) and MECHANICS.md (all gameplay numbers — never hardcode them).
Audience: Claude Code. Build milestone by milestone (§10); each milestone is independently runnable and testable.

---

## 1. Stack (locked)

| Layer | Choice | Why |
|---|---|---|
| Client | React Native + **Expo** (TypeScript), Expo Router | Single codebase, EAS cloud builds (no Mac needed), strong Claude Code support |
| Maps | react-native-maps + NWS radar tile overlay (`https://mapservices.weather.noaa.gov` tiles) | Free radar imagery |
| Backend | **Supabase** (Postgres + Auth + Realtime) | Auth, DB, realtime subscriptions with minimal glue |
| Routing/Jobs service | Small **Node (TypeScript) service** on Fly.io or Railway | A*, weather cache, replan cron, delivery cron, push dispatch |
| Push | Expo Push Notifications | Simplest path with Expo |
| Weather | NWS API (`api.weather.gov`) — free, keyless, US-only | v1 launch region |

Monorepo layout:
```
smoke/
  apps/mobile/          # Expo app
  services/engine/      # Node routing+jobs service
  packages/shared/      # shared TS types, mechanics types, cell math
  SPEC.md  MECHANICS.md  ARCHITECTURE.md
```

## 2. System overview

```
[Expo client] ──auth/CRUD/realtime──> [Supabase Postgres]
      │                                     ▲
      │ (read-only flight state)            │ writes: routes, positions, states
      ▼                                     │
[MapView + radar tiles]            [engine service (Node)]
                                      ├─ weather cache (NWS, per-cell, TTL 30m)
                                      ├─ A* router
                                      ├─ cron: replan (15m), delivery-check (1m), dissipation (1h)
                                      └─ Expo push dispatch
```
Client never computes game state; it renders server truth. Position between waypoints is interpolated client-side from `segment_etas` for smooth animation — cosmetic only.

## 3. Data model (Postgres)

```sql
-- Supabase auth.users is the identity root
create table profiles (
  id uuid primary key references auth.users,
  handle text unique not null,          -- @name, 3-20 chars
  display_name text,
  home_cell text not null,              -- cell id, e.g. "r037c090" = Newark (coarse!)
  last_active_at timestamptz,
  expo_push_token text,
  created_at timestamptz default now()
);

create table flock (                     -- friendships, symmetric
  a uuid references profiles(id),
  b uuid references profiles(id),
  status text check (status in ('pending','accepted')),
  requested_by uuid,
  created_at timestamptz default now(),
  primary key (a, b)                     -- store with a < b
);

create table blocks (                    -- App Store 1.2 requirement
  blocker uuid references profiles(id),
  blocked uuid references profiles(id),
  created_at timestamptz default now(),
  primary key (blocker, blocked)
);

create table reports (                   -- App Store 1.2 requirement
  id bigserial primary key,
  reporter uuid references profiles(id),
  message_id uuid references messages(id),
  reason text,
  created_at timestamptz default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  sender uuid references profiles(id),
  recipient uuid references profiles(id),
  body text not null check (char_length(body) <= 4000),  -- sanity bound, not the cap;
                                         -- the 280-GRAPHEME cap is enforced by the engine
                                         -- (MECHANICS §5, REDTEAM F20)
  body_delivered text,                   -- post-garble text; null until delivered
  state text not null default 'TRANSMITTING'
    check (state in ('TRANSMITTING','IN_FLIGHT','STRANDED','DELIVERED','LOST')),
  origin_cell text not null,
  dest_cell text not null,
  route jsonb,                           -- ordered cell ids
  segment_etas jsonb,                    -- cumulative eta per waypoint (server truth)
  current_leg int default 0,
  departed_at timestamptz,
  eta timestamptz,
  stranded_since timestamptz,
  stranded_cell text,
  garble_events jsonb default '[]',      -- [{cell, at, chars_hit}]
  lost_at timestamptz, lost_cell text, lost_reason text,
  delivered_at timestamptz,
  created_at timestamptz default now()
);

create table weather_cells (
  cell text primary key,
  condition text, wind_mph int, wind_dir int,
  time_mult numeric,                     -- precomputed from MECHANICS table
  impassable boolean default false,
  fetched_at timestamptz
);

create table mechanics_config (          -- EVERY number from MECHANICS.md
  key text primary key, value jsonb, updated_at timestamptz default now()
);

create table events (                    -- notification/event log per message
  id bigserial primary key,
  message_id uuid references messages(id),
  kind text,                             -- SENT|DEPARTED|STRANDED|RESUMED|GARBLED|DELIVERED|LOST
  payload jsonb, created_at timestamptz default now()
);
```

RLS: profiles readable by flock members; messages readable by sender+recipient only; `body_delivered`/`body` visible to recipient **only after** `state='DELIVERED'` (sender always sees own body). weather_cells readable by all authenticated (needed for map rendering).

## 4. Message state machine

```
TRANSMITTING ──(transmission_time elapsed, route exists)──> IN_FLIGHT
TRANSMITTING ──(transmission_time elapsed, NO_ROUTE)─────> STRANDED  [stranded_cell = origin]
IN_FLIGHT ──(next cell impassable @replan)──> STRANDED
STRANDED ──(finite route found @replan)─────> IN_FLIGHT   [route replaced from current cell]
STRANDED ──(dissipation roll succeeds)──────> LOST
IN_FLIGHT ──(final waypoint eta reached)────> DELIVERED   [apply garbles → body_delivered]
```

**Stranded at the origin is a special case.** A message that never left its own fire
(`stranded_cell = origin_cell`) is exempt from dissipation and waits indefinitely — a
tended fire never dies (MECHANICS §6.1). Only smoke stranded out in the weather can be
taken by it.

**A send never fails for want of a route.** If the router returns `NO_ROUTE` — the sky is
walled off, or the recipient's own cell is under a severe warning — the message is still
created and still transmits; it simply strands at its origin and the replan cron retries
it every cycle like any other stranded message. `NO_ROUTE` is a state of the weather, not
an error of the API: the user lit the fire, and the fire is lit. The 24 h dissipation
grace (MECHANICS §6.1) starts when it strands, wherever it stranded.
- All transitions happen ONLY in the engine service crons — single writer, no client races.
- `DELIVERED` and `LOST` are terminal. Re-send creates a new message row (thread by (sender,recipient)).

## 5. Cell math (packages/shared)

- **Uniform equirectangular** 50 km grid over the launch bbox (MECHANICS §1): `cellId(lat,lng)`, `cellCenter(id)`, `neighbors(id)` (8-connected), `cellsAlongGreatCircle(a,b)` for lazy weather prefetch.
- **Locked geometry.** The grid is 57 rows × 106 columns = 6,042 cells; row 0 is the southernmost, column 0 the westernmost; ids are `r%03dc%03d`, e.g. **`r037c090`** (Newark) or `r039c066` (Chicago). Cells are 50 km tall everywhere and 50 km wide at the bbox's centre latitude (57 km at 24°N, 40 km at 49.5°N). The grid is the smallest cell-aligned rectangle covering the bbox, so `cellId(cellCenter(id)) === id` holds for edge cells too.
- **Cell ids are persisted identifiers** (`profiles.home_cell`, `messages.route`, `weather_cells.cell`, the land mask). Re-gridding is a data migration, never a config edit — which is why grid geometry is compiled in and only *checked* against `mechanics_config` at startup, not read from it.
- **Land mask (MECHANICS §1.1).** Two static per-cell bitmaps generated at build time from Natural Earth and committed as generated data alongside the cell math: `is_land` (1:10m land) and `is_us` (1:10m admin-0, United States), rasterised identically, with border cells resolved by majority sample. `isTraversable(cell)` = (`is_us` OR 8-adjacent to a US-land cell) AND NOT foreign land. Open ocean and foreign land are permanently impassable — the first because smoke cannot cross water, the second because our weather source stops at the border and fail-open would otherwise make Canada and Mexico the cheapest terrain on the map. Regenerating both layers is part of any grid change.
- Deterministic, pure, fully unit-tested — this module is the foundation everything trusts.

## 6. Engine service

### 6.1 Weather cache
- `getCellWeather(cells[])`: serve from `weather_cells` if `fetched_at` < TTL; else fetch NWS gridpoint forecast for cell center, map condition → `time_mult`/`impassable` per MECHANICS §2.1, upsert. Batch, jittered, rate-limit aware. **Fail-open:** on 429/5xx/timeout serve stale; beyond 2×TTL treat as clear + `weather_unknown` (MECHANICS §2.1). Impassable requires an *active NWS severe warning/watch* (alerts endpoint), not just a stormy forecast.
- **Never fetch a non-traversable cell** (MECHANICS §1.1): open ocean and foreign land have no weather because they have no route. Fail-open must not turn the Atlantic — or Ontario — into a clear-sky highway.
- **Alerts are fetched in bulk, not per cell.** One active-alerts request per pass covers the whole launch region; cells are matched against alert geometry locally. Per-cell alert lookups multiply request volume by the size of the corridor for no extra information.
- **An alerts outage un-walls the sky, on purpose.** If the alerts endpoint is down past the stale window we assume no alerts rather than freezing every route (fail-open, REDTEAM F4) — the failure mode we refuse is "our dependency stranded the whole network". The cost is that during such an outage nothing is impassable, so the engine records **alert staleness** (how old the newest usable alert list is) as a metric and surfaces it in the nightly report. Silent un-walling is the thing to avoid; visible un-walling is acceptable.

### 6.2 Router
- A* over the 8-connected grid.
- **Edge cost (hours) = `(cell_km / speed.base_kmh) × weather_mult × wind_mult`**, where `cell_km` is the hop length (diagonal = ×1.414). Every multiplier acts on **time**: higher = slower (MECHANICS §2, §2.1, §2.2). The older "`cell_km / (base × mult)`" phrasing was inverted — under it a thunderstorm made smoke 6× faster — and is retired.
- **Heuristic = `great_circle_km × 0.7 / speed.base_kmh`** — the distance flown at the fastest the sky ever allows (full tailwind, `wind_mult` floor 0.7). Admissible: no path can beat 0.7× time over a distance no shorter than the great circle.
- **v1.1 rule (binding when relays ship):** `routing.heuristic_max_speed_factor` must equal the *product of every multiplier floor the router can apply*. With the Tower model that is `wind.tailwind_min_mult × relay.tend_mult` = 0.7 × 0.1 = **0.07**. Ship the factor change in the same release as the relay mechanic, not after — the startup guard (§6.2 below) will refuse to boot otherwise, which is the intended failure: a tuned-open heuristic degrades routes silently, a refused boot does not.
- **Traversability:** a cell is pruned if it is impassable (active severe alert) or non-traversable (open ocean or foreign land, MECHANICS §1.1). Never costed, never entered.
- **Startup guard:** the engine asserts on boot that `routing.heuristic_max_speed_factor` is ≤ the smallest time multiplier the config can produce (today `wind.tailwind_min_mult` × the minimum weather multiplier). If a tuning edit ever makes the heuristic optimistic, A* stops being optimal *silently* — so this is a boot failure, not a warning. When v1.1 relays ship, `relay_mult` enters the same computation.
- Returns `{route, segment_etas, total_hours}` or `NO_ROUTE`.
- Pure function of (origin, dest, weather snapshot) → property-testable with synthetic storm fixtures.

### 6.3 Crons
- **send pipeline** (on insert via Supabase webhook or poll): reject if either party blocks the other; compute route, set TRANSMITTING with `departed_at = now + transmission_time`.
- **The Keeper** (F5): system profile, `home_cell` computed as adjacent to each new user at onboarding (per-user virtual position). First-run flow prompts a message to The Keeper; engine auto-replies with rotating era-flavored lines ~30 min after delivery. Plain data + one cron branch — no LLM, no cost.
- **delivery-check (1 min):** promote TRANSMITTING→IN_FLIGHT when departed; advance `current_leg` past due waypoints; on gale-cell traversal roll garble (record event); on final eta → DELIVERED, apply garbles to produce `body_delivered`, push.
  - **One transition per pass.** A message promoted to IN_FLIGHT in a pass is not also advanced or delivered in that pass — the batch was read before it changed state. At a one-minute cadence this is invisible in production; it matters only to time-travelling tests, which must therefore tick twice per step. Do not "optimise" it by re-reading inside the loop: one pass, one transition, is what keeps the cron reasoning about a stable snapshot.
- **replan (15 min):** for IN_FLIGHT, check next cell impassable → STRANDED (+push). For STRANDED, attempt reroute from `stranded_cell`; success → IN_FLIGHT (+push "skies cleared").
- **dissipation (1 h):** STRANDED > 24 h **and stranded away from its origin** → roll per MECHANICS §6.1 → LOST (+push, loss screen payload). Origin-stranded messages are skipped: a tended fire never dies.

### 6.4 API surface (thin — most reads go straight to Supabase)
```
POST /preview   {recipient, body}
                → {route, eta, storms_avoided[], preview_token}   preview_token valid 10 min

POST /send      {recipient, body, preview_token}
                → engine revalidates flock/blocks, recomputes the route if the weather
                  snapshot behind the token has changed, and warns the client when the
                  new ETA differs from the previewed one by more than 20%

POST /resend    {message_id} → new message row, fresh route
```

**Preview resolves its own unknowns.** A first pass may route through cells whose weather
we have never fetched — and under fail-open those cells are priced as clear, which makes
them *attractive*. So `/preview` fetches the weather for every unknown cell on its
candidate route and re-routes once before returning. A committed route is never priced on
a guess. (In-flight replanning keeps the plain fail-open behaviour: mid-flight we favour
availability over precision, per REDTEAM F4.)

**Transports.** The same handlers are exposed two ways, chosen by config: as HTTP
endpoints, and as a Supabase table-polling worker where the client inserts a request row
and the engine writes a response row. The beta runs from a home server behind NAT, so it
must be able to operate fully outbound — the table transport is not a fallback, it is the
launch configuration.
Everything else (flock CRUD, message list, flight state) = Supabase client + RLS + realtime subscription on `messages` and `events`.

## 7. Client screens (maps to UX spec, forthcoming)

1. **Sky (home):** map, your flock's smoke in flight, radar overlay toggle.
2. **Compose:** recipient picker → text (280 live counter, counting grapheme clusters) → **route preview** (route line, storms, ETA) → confirm "Light the fire."
3. **Flight view:** per-message map, animated smoke along route, event timeline (parchment ledger), ETA.
4. **The Ledger:** conversation history; wind-damaged text rendered with ember styling.
5. **Flock:** add by handle / invite link; pending requests as drifting wisps.
6. **Loss screen:** where it died, why, "light a new fire" re-send.
7. Settings: location (coarse, on registration + manual refresh only), notifications, privacy, about.

## 8. Privacy & security decisions

- Location: request **coarse/approximate, when-in-use** only; store cell id only, never raw lat/lng. Endpoint = home_cell, refreshable manually ("move your fire").
- GPS spoofing: unmitigated in v1 (harmless in a friends-only messenger; revisit if public signal fires ship).
- No E2E claim anywhere; privacy policy states server-side storage plainly.
- Rate limits: 30 sends/user/day (abuse + push-cost guard), 5 pending flock requests outbound.

## 9. Testing strategy

- `packages/shared`: exhaustive unit tests (cell math edge-of-bbox, antimeridian N/A for v1).
- Router: fixture storms (wall, pocket, full blockade) → assert detour/strand behavior; property test: eta monotonic in weather severity.
- Engine crons: time-travel tests with mocked clock (vitest fake timers) through full state machine.
- Client: minimal — manual + Expo dev; the server owns all truth.
- End-to-end happy path script: seed 2 users, send, fast-forward clock, assert DELIVERED with correct eta.

## 10. Implementation milestones (Claude Code order)

1. **M1 – Foundations:** monorepo, shared cell math + mechanics types, Supabase schema + RLS, config seeding from MECHANICS.md. *Test: cell math suite green; schema migrates clean.*
2. **M2 – Engine core:** weather cache (NWS mocked in tests), A* router + storm fixtures. *Test: NJ→Chicago detours around synthetic PA storm wall.*
3. **M3 – Lifecycle:** send/preview endpoints, crons, full state machine, garble/dissipation. *Test: e2e time-travel script.*
4. **M4 – Client shell:** auth, profiles, flock, compose w/ preview, ledger (no map yet). *Test: two simulators exchange a fast-forwarded message.*
5. **M5 – The Sky:** map, radar overlay, flight animation from segment_etas, loss screen. *The demo milestone.*
6. **M6 – Ship prep:** push wiring end-to-end, settings/privacy, empty states, app icons/splash, EAS build profile, TestFlight upload.

Rule for Claude Code: any gameplay number found hardcoded outside `mechanics_config` seeding is a bug.
