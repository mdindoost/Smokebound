# SMOKE

*A messenger that delivers texts by virtual smoke signal. Slower than pigeons. Weather is real. Sometimes the sky wins.*

The design documents are the source of truth, in this order of authority:

| Document | Owns |
|---|---|
| [SPEC.md](SPEC.md) | Product scope, feature cut list, positioning |
| [MECHANICS.md](MECHANICS.md) | **Every gameplay number** |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Stack, data model, services, milestones |
| [REDTEAM.md](REDTEAM.md) | Decisions already litigated — do not re-open |

**Current milestone: M1 — Foundations (complete).** Monorepo, cell math, shared types,
Supabase schema + RLS, `mechanics_config` seeding. No weather, no routing, no UI yet;
those are M2–M5 (ARCHITECTURE §10).

---

## Layout

```
smoke/
  apps/mobile/          # Expo + TypeScript + Expo Router (scaffold only in M1)
  services/engine/      # Node + TypeScript: migrations, seeding; router/crons land in M2/M3
  packages/shared/      # cell math, data-model types, the MECHANICS.md transcription
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
npm test                              # shared + engine
npm test --workspace packages/shared  # cell math, mechanics, data model  (90 tests)
npm test --workspace services/engine  # migrations, RLS, seeding          (61 tests)
npm run typecheck                     # all workspaces
```

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
   ```

If you use the Supabase CLI instead, `supabase link` + `supabase db push` applies the
same files — the migrations directory is in the CLI's standard layout. Seeding still
goes through `npm run db:seed`.

Both commands are safe to re-run. `npm run db:seed -- --prune` additionally deletes
config keys this build no longer knows about.

### What the schema gives you

Tables exactly as ARCHITECTURE §3 specifies: `profiles`, `flock`, `blocks`, `messages`,
`reports`, `weather_cells`, `mechanics_config`, `events`. RLS is on for all of them:

- **profiles** — readable by yourself and your flock (pending or accepted); a block
  hides you from the other party in both directions. Handle search for adding friends
  goes through `find_profile_by_handle()`, which returns identity but never `home_cell`.
- **messages** — the sender always sees their own message. The recipient sees *nothing*
  until `state = 'DELIVERED'`, which is both the privacy rule from ARCHITECTURE §3 and
  the product rule from SPEC §4 ("you get nothing until the smoke arrives").
- **flock** — only the addressee can flip a request from `pending` to `accepted`; either
  party can unfriend.
- **blocks** — visible to the blocker only.
- **weather_cells / mechanics_config** — readable by any signed-in user (the map and the
  compose screen need them), writable only by the engine.
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

## Running the app

```bash
npm start --workspace apps/mobile
```

M1 ships the Expo Router scaffold and a placeholder route only — enough to boot, nothing
to look at. Screens are M4/M5.

## What is next

- **M2 — Engine core:** NWS weather cache (mocked in tests), A* router, storm fixtures.
- **M3 — Lifecycle:** send/preview endpoints, crons, full state machine, garble, dissipation.
- **M4 — Client shell**, **M5 — The Sky**, **M6 — Ship prep**. See ARCHITECTURE §10.
