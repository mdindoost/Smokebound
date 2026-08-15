# SMOKE

*A messenger that delivers texts by virtual smoke signal. Slower than pigeons. Weather is real. Sometimes the sky wins.*

The design documents are the source of truth, in this order of authority:

| Document | Owns |
|---|---|
| [SPEC.md](SPEC.md) | Product scope, feature cut list, positioning |
| [MECHANICS.md](MECHANICS.md) | **Every gameplay number** |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Stack, data model, services, milestones |
| [REDTEAM.md](REDTEAM.md) | Decisions already litigated — do not re-open |
| [DESIGN.md](DESIGN.md) | The design system, and which visual decisions are closed |

**Current milestone: M5 — The Sky (complete).** M1 built the monorepo, cell math, schema
and config seeding; M2 the weather cache and A* router; M3 the message lifecycle; M4 the
client shell; M5 the map — the sky panel, NWS radar, live flight view, the tower layer,
the loss screen, and the bundled serif. What remains is M6: push wiring, settings polish,
icons and splash, EAS build, TestFlight.

---

## Layout

```
smoke/
  apps/mobile/          # Expo + TypeScript + Expo Router: the client shell and design system
  services/engine/      # Node + TypeScript: migrations, seeding, weather cache, A* router
  packages/shared/      # cell math, land mask, data-model types, the MECHANICS.md transcription
  supabase/migrations/  # SQL migrations (Supabase CLI layout)
  supabase/local/       # test-harness SQL — never applied to a real project
```

npm workspaces; Node 20+ (developed on 22).

## Install

```bash
npm install
```

## Run the tests

```bash
npm test                              # every workspace
npm test --workspace packages/shared  # cell math, land mask, mechanics, model    (101 tests)
npm test --workspace services/engine  # schema, RLS, weather, router, lifecycle   (292 tests)
npm test --workspace apps/mobile      # client logic + two-client end-to-end       (40 tests)
npm run typecheck                     # all workspaces
```

The mobile suite includes a **two-client end-to-end run**: two `DataGateway`s (the same
interface the screens use) against real migrations, real RLS and the real engine, with a
shortened config so a Newark→Chicago flight takes minutes. It covers send → transmitting →
in flight → delivered from both sides, a wind-damaged delivery, the block flow and the
Keeper's reply.

The engine tests boot a real Postgres in-process ([PGlite](https://pglite.dev)), apply
the actual migration files, and then probe the RLS policies as each party — so
"migrations apply cleanly" and "the recipient cannot read the body early" are
statements the suite proves rather than assumes. No Docker, no database server needed.

## Apply the schema to a Supabase project

1. Create a project at [supabase.com](https://supabase.com) (any region; the launch
   region is CONUS but that only affects weather data, not hosting).
2. Grab the connection string: **Project Settings → Database → Connection string → URI**.
   Use the direct connection rather than the pooler for DDL.
3. ```bash
   cp .env.example .env      # then fill in DATABASE_URL
   set -a && source .env && set +a
   npm run db:migrate        # applies supabase/migrations in order, idempotently
   npm run db:seed           # fills mechanics_config from MECHANICS.md
   npm run seed -w services/engine -- --keeper   # adds The Keeper + its flavour lines
   ```

If you use the Supabase CLI instead, `supabase link` + `supabase db push` applies the
same files — the migrations directory is in the CLI's standard layout. Seeding still
goes through `npm run db:seed`.

Both commands are safe to re-run. `npm run db:seed -- --prune` additionally deletes
config keys this build no longer knows about.

### What the schema gives you

Tables as ARCHITECTURE §3 specifies — `profiles`, `flock`, `blocks`, `messages`,
`reports`, `weather_cells`, `mechanics_config`, `events` — plus `keeper_lines` and the
`engine_requests`/`engine_responses` pair the table transport runs on. RLS is on for all
of them:

- **profiles** — readable by yourself and your flock (pending or accepted); a block
  hides you from the other party in both directions. Handle search for adding friends
  goes through `find_profile_by_handle()`, which returns identity but never `home_cell`.
- **messages** — the sender always sees their own message. The recipient sees *nothing*
  until `state = 'DELIVERED'`, which is both the privacy rule from ARCHITECTURE §3 and
  the product rule from SPEC §4 ("you get nothing until the smoke arrives").
- **flock** — only the addressee can flip a request from `pending` to `accepted`; either
  party can unfriend.
- **blocks** — visible to the blocker only, who can still see the profile of anyone they
  blocked (you already know who they are; the block hides *you* from *them*).
- **weather_cells / mechanics_config** — readable by any signed-in user (the map and the
  compose screen need them), writable only by the engine.
- **engine_requests / engine_responses** — a client may queue a request under its own id
  and watch its own answers; it can never write a response or read someone else's.
- Clients may insert a message, a flock request, a block or a report. Every state
  transition after that belongs to the engine service, which writes with the
  service-role key (ARCHITECTURE §4: single writer, no client races).

## The one rule about numbers

> **ARCHITECTURE §10:** any gameplay number found hardcoded outside `mechanics_config`
> seeding is a bug.

How that is enforced here:

1. `packages/shared/src/mechanics/defaults.ts` is the only file allowed to contain a
   gameplay number. Each entry carries its `source` (document + section) and whether
   MECHANICS.md marks it **TUNE**.
2. `npm run db:seed` copies those values into `mechanics_config`.
3. At runtime the engine reads the **table**, through `MechanicsConfig.fromRows()`, which
   throws if a key is missing rather than substituting a compiled-in default. There is no
   fallback path, on purpose.
4. `packages/shared/src/mechanics/no-hardcoded-numbers.test.ts` scans the source tree for
   the distinctive MECHANICS literals and fails the build if one reappears anywhere else.

So tuning base speed in beta is `update mechanics_config set value = '18' where key =
'speed.base_mph';` — no client release, exactly as MECHANICS.md requires.

**One deliberate exception:** grid geometry (`grid.cell_km`, `grid.bbox`) is read from
compiled defaults by the cell-math module, because cell ids are persisted identifiers
(`profiles.home_cell`, `messages.route`, `weather_cells.cell`). Re-gridding is a data
migration, not a tuning knob. `assertGridMatchesConfig()` makes the engine refuse to
start if the table and the code ever disagree.

## packages/shared

The cell math (ARCHITECTURE §5) over the CONUS grid (MECHANICS §1): 24°N–49.5°N,
125°W–66°W in ~50 km cells → a 57 × 106 grid, 6,042 cells covering the ~3,200 land cells
the spec expects.

```ts
import { cellId, cellCenter, neighbors, cellsAlongGreatCircle } from '@smoke/shared';

cellId({ lat: 40.7357, lng: -74.1724 });        // 'r037c090'  (Newark)
cellCenter('r037c090');                          // { lat: …, lng: … }
neighbors('r037c090');                           // 8-connected, clipped at the border
cellsAlongGreatCircle('r037c090', 'r039c066');   // 27 contiguous cells, Newark → Chicago
```

Conventions: row 0 is the southernmost row, column 0 the westernmost; ids are
`r%03dc%03d`. Cells are 50 km tall everywhere and 50 km wide at the bbox's centre
latitude (57 km at the southern edge, 40 km at the northern one). The grid is the
smallest cell-aligned rectangle covering the bbox, so `cellId(cellCenter(id)) === id`
holds for every cell including edge ones. Coordinates outside the grid throw
`OutOfGridError` — v1 is CONUS-only, and "smoke can't cross the sea" is the in-fiction
rule (MECHANICS §1).

`cellsAlongGreatCircle` is resolution-independent: it samples the great circle and then
bisects wherever the sampling produced a diagonal jump, so the returned path is
contiguous (every consecutive pair is 8-connected) and identical at any sampling rate.

### The land mask

`packages/shared/src/geo/generated/landMask.ts` is generated data: a per-cell land/water
bitmap rasterised from Natural Earth 1:10m polygons (MECHANICS §1.1). It exists because
fail-open weather would otherwise make the Atlantic the cheapest terrain on the map and
route coastal messages out to sea (REDTEAM F13). Traversable = land, or within one cell of
land; everything else is open ocean and permanently impassable.

Regenerate it only when the grid changes — the mask records the grid signature it was
built against and refuses to load against a different one:

```bash
npm run generate:land-mask --workspace packages/shared
```

## services/engine

```ts
import { WeatherCache, HttpNwsClient, SqlWeatherStore, planRoute } from '@smoke/engine';

const cache = new WeatherCache({
  client: new HttpNwsClient({ userAgent: '(smoke, you@example.com)' }), // NWS requires contact info
  store: new SqlWeatherStore(db),
  config,                                    // loaded from mechanics_config
});

const weather = await cache.getCorridorWeather(originCell, destCell);
const route = planRoute({ origin: originCell, dest: destCell, weather, config });
// → { status: 'OK', route, waypoints, totalHours, unknownCells, expanded } | { status: 'NO_ROUTE', reason }
```

**Weather cache** (ARCHITECTURE §6.1): TTL from config, batched and jittered fetches, and
fail-open everywhere — stale data is served for up to 2×TTL during an NWS outage, and past
that a cell is treated as clear and flagged `weather_unknown`. A cell is impassable only
under an *active severe warning or watch*; an ordinary thunderstorm is 6.0× slow and
passable (REDTEAM F2). Open ocean is never fetched at all. All NWS access sits behind the
`NwsClient` interface; no test touches the network.

**Router** (ARCHITECTURE §6.2): 8-connected A*, pure function of
(origin, dest, weather, config). Edge cost is
`(hop_km / speed.base_kmh) × weather_mult × wind_mult` — every multiplier acts on *time*
(REDTEAM F11) — and the heuristic is `great_circle_km × 0.7 / speed.base_kmh`, the distance
flown at full tailwind, which the test suite checks against a Dijkstra reference on random
weather fields.

### Running the engine

```bash
DATABASE_URL=...  PREVIEW_TOKEN_SECRET=...  npm start -w services/engine
```

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string (required) |
| `PREVIEW_TOKEN_SECRET` | HMAC secret for preview tokens (required) |
| `ENGINE_TRANSPORT` | `table` (default), `http`, `both`, `none` |
| `SUPABASE_JWT_SECRET` | Required when the HTTP transport is on |
| `NWS_USER_AGENT` | Contact string NWS asks every client to send |

**Transports** (ARCHITECTURE §6.4). The same `preview` / `send` / `resend` handlers are
served two ways. Over **HTTP** the caller authenticates with a Supabase access token. Over
the **table transport** the client inserts a row into `engine_requests` and reads the
answer from `engine_responses` — RLS stamps `requester = auth.uid()`, so the engine can
trust that column exactly as much as a verified JWT. The table transport is the launch
configuration, not a fallback: the beta engine runs on a home server behind NAT and must
work fully outbound. A parity test sends the same message all three ways and compares.

**Crons** (ARCHITECTURE §6.3), all reading their cadence from `mechanics_config`:

- **delivery-check** (1 min) — `TRANSMITTING → IN_FLIGHT`, advances legs against the
  segment ETAs, rolls garble in gale cells, and materialises `body_delivered` on arrival.
- **replan** (15 min) — strands a message when the next cell closes, and gets stranded
  ones moving again when it opens. A send with no route at all strands *at its origin*
  and is retried here (REDTEAM F17): a walled-off sky is never a send failure.
- **dissipation** (1 h) — after 24 h stranded, rolls the 5%/day loss. The per-day chance is
  converted to the cron's cadence, so changing the schedule cannot change the game.
- **The Keeper** — answers a first message about half an hour after it lands, rotating
  through `keeper_lines`. Its fire is always one cell from yours, per user (REDTEAM F5).

Garble (MECHANICS §6.2) is derived, not stored: `body` keeps the original, each gale is
recorded in `garble_events`, and the delivered text is replayed from that log with a seed
built from the message id — so a mangled message can always be explained afterwards. It
operates on whole grapheme clusters, tested against Latin, Arabic, CJK, Devanagari and
emoji fixtures.

## The Sky (M5)

The map is a **dark panel inset in a parchment app** (DESIGN.md V1), drawn with
react-native-maps and the default providers so it runs inside Expo Go. On it:

- **Radar** — NWS precipitation tiles through `UrlTile`, toggleable, at a fixed opacity
  ceiling so weather never out-shouts the smoke (V2).
- **The Sky (home)** — your signals in the air, each with its flown trail in ember and the
  road ahead dashed and cool. Tap one to follow it.
- **Flight view** — the committed route, the smoke's position interpolated client-side
  from `segment_etas` (server truth; the interpolation is cosmetic and decides nothing),
  the event timeline in Ledger style, the sheltering state in calm storm-grey, and a
  hollow ring on any cell whose weather we are guessing (MECHANICS §2.1 fail-open).
- **Towers** — every routable cell has a beacon tower named after the nearest place, from
  a generated table (`npm run generate:tower-names -w packages/shared`). Cosmetic only:
  the timeline says "passed the Toledo tower" and nothing in the router knows they exist.
- **Loss screen** — where it died, why, how far from home, and "light a new fire".

## apps/mobile

```bash
cp .env.example .env      # EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY
npm start --workspace apps/mobile
```

The app is linked to the existing Expo project (`mdindoosts-team/smokebound`), so
`npx expo start` and EAS pick it up without `eas init`.

### Watching a flight on a real phone

The map needs a device — Expo Go on an iPhone is enough, no dev client required.

1. Point the engine at your Supabase project and start it:
   `DATABASE_URL=… PREVIEW_TOKEN_SECRET=… npm start -w services/engine`
   (transport `table` by default, so the phone reaches it through the database and the
   engine needs no inbound port).
2. Speed the sky up so a flight fits in a coffee break — 32 km/h becomes 3,200:
   `update mechanics_config set value = '3200' where key = 'speed.base_kmh';`
   Reset it to `32` afterwards; nothing needs a redeploy either way.
3. `npm start -w apps/mobile`, scan the QR code, sign in, and send something far —
   Newark to Seattle crosses most of the map.
4. To watch a stranding, put a severe warning over the next cell (the alert set is
   re-read every pass, so it takes effect within a replan cycle), then clear it and watch
   the route replace itself from where it waited.

Screens (ARCHITECTURE §7): sign-in → handle → fire → the Keeper, then the Ledger, a
thread, compose, flock and settings. The route preview is **text** in M4 — distance, time
in the air, storms dodged, and the "you could just walk over" line when the two fires are
close enough (MECHANICS §7.1). M5 turns those same numbers into a map.

**Transport.** The app talks to the engine through `engine_requests` / `engine_responses`
by default (realtime, with a polling fallback), because the beta engine runs on a home
server behind NAT. `EXPO_PUBLIC_ENGINE_TRANSPORT=http` swaps in the HTTP client behind the
same interface.

**Design system.** `src/design/tokens.ts` holds the whole palette — parchment (ground),
ember (fire, the only colour that raises its voice), sky (distance and weather) — plus the
type scale and the component set the screens are assembled from. It is deliberately the
base M5 draws the map inside. SPEC §2's cultural design rule is binding on all of it: the
identity comes from material and light, never from the iconography of a people, and the
in-app history page credits the practice the app borrows from.

**One thing the client cannot do:** show a recipient that something is on its way. RLS
hides an undelivered message from its recipient entirely (ARCHITECTURE §3), which is also
the product (SPEC §4.4 — "you get nothing until the smoke arrives"). An ambient "a signal
is in the sky toward you" hint would need a deliberate design decision about what to
expose, so it is an open M5 question rather than something M4 quietly weakened a policy
for.

## What is next

- **M5 — The Sky:** map, radar overlay, flight animation, loss screen. The demo milestone.
- **M6 — Ship prep:** push wiring, settings, icons, EAS build, TestFlight. See ARCHITECTURE §10.
