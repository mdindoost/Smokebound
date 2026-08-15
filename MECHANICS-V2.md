# SMOKE — Mechanics Specification v2.0 (DRAFT — design only)

**Status: draft for architect red-team. Nothing here is implemented.** No code, no
migrations, no config rows exist for any mechanic below. Every number is a proposal
until ruled on.

Companion to MECHANICS.md, which remains authoritative for v1. This document adds one
idea — **the sun** — and follows it honestly into every corner it reaches, including the
corner where it breaks a guarantee v1 relied on.

Same discipline as MECHANICS.md: all gameplay numbers live in `mechanics_config`, every
claim carries a worked example, and **TUNE = expect to change in beta.**

---

## 0. The idea, and what it costs

Smoke signals are a daylight medium. At night the same tower burns a **fire**, and a
fire carries further than a smoke column — the relay chain sees the next station sooner,
so word moves faster. That is the historical practice and it is the mechanic: **smoke by
day, fire by night.**

It buys the product a diurnal rhythm it currently lacks. Right now a message crossing the
country at 3 AM is indistinguishable from one crossing at noon, and a medium whose whole
pitch is *"the sky decides"* has been ignoring the largest thing the sky does.

It costs one guarantee. Once traversal cost depends on **when** a hop is entered, the
routing graph becomes time-dependent, and — because night is *faster* — it becomes
non-FIFO: leaving later can mean arriving earlier. Plain A\* over frozen costs stops being
provably optimal. §4 states that plainly rather than hiding it, and proposes a posture.

---

## 1. The sun model

### 1.1 Definition

Day or night is a property of **a cell at an instant**, computed from solar elevation:

```
night(cell, t)  ⟺  solar_elevation(t, cell_center) < night.twilight_elevation_deg
```

`night.twilight_elevation_deg` = **−6.0** (TUNE) — **civil twilight**.

**Why civil twilight and not sunset (0°) or nautical (−12°).** Sunset is too early: for
roughly half an hour after the sun goes down there is enough light that a smoke column is
still the better signal, and switching to fire then would make the mechanic fire at a
moment the player can see is wrong. Nautical twilight is too late: by −12° it has been
properly dark for a while and we would be denying the bonus during the period the change
most obviously *has* happened. Civil twilight is the conventional "lights on" threshold —
it is when you can no longer read outside, which is very close to when you can no longer
read smoke against the sky. It is also the threshold every consumer weather app uses for
"dusk", so the app's answer will match the one on the player's phone.

### 1.2 Pure math, no API

Solar elevation is a closed-form function of time and position. **No forecast product, no
network call, no cache.** This matters more than it sounds: it means the day/night layer
has none of the failure modes that produced REDTEAM F4, F28 and F31. There is nothing to
fetch, nothing to go stale, nothing to fail open. A cell's day/night state is knowable for
any instant, past or future, at zero cost — which is precisely what makes counsel (§5)
cheap to evaluate across candidate departure times.

Precision required: the terminator moves about **25 km/min** at CONUS latitudes, and our
cells are 50 km across. A solar-position algorithm accurate to ±0.1° in elevation puts the
terminator within about ±1 km — two orders of magnitude finer than the grid. The
low-precision NOAA formulation is therefore ample; nothing here needs an ephemeris.

### 1.3 One definition, shared — theater and physics may never disagree

The sun function **must live in `packages/shared`** — proposed `packages/shared/src/geo/sun.ts`
— and be the single definition used by:

- the **engine cost model** (§2), which decides how long a hop takes; and
- any **client day/night rendering**, which decides what the player sees.

If those two ever compute dusk differently, the app shows a fire burning while the engine
charges daylight speed, and the player is being lied to about a mechanic they can watch.

There is direct precedent in this codebase, from this milestone: `alongTrackWind` was
extracted into `packages/shared/src/geo/wind.ts` for exactly this reason, so that the
sentence on the flight screen ("a following wind") and the penalty in the router could not
describe different weather. The sun deserves the same treatment before either side is
built, not after they diverge.

**Correction to the brief.** The brief refers to "the same computation the M5.5 cosmetic
layer already uses." **No such layer exists.** M5.5 shipped no day/night rendering — a
grep for night/dusk/dawn/solar logic across `services/engine/src`, `packages/shared/src`
and the app returns nothing but a Keeper flavour line and a comment. The day/night
cosmetic layer was proposed in the M5.5 input list but was not implemented, and was not
ruled. So there is no existing computation to share with: the shared module is **new work
in v2**, and the ordering obligation is that it be written once and consumed twice, rather
than reconciled later. This is listed again in §8.

---

## 2. Night traversal

### 2.1 The rule

```
night_time_mult = 0.75          (TUNE)
```

Applied to the traversal cost of a cell **when that cell is in night at the moment the
smoke enters it**, and when the cell's conditions are not blinding (§3):

```
hours = (hop_km / speed.base_kmh) × weather_mult × wind_mult × night_mult
```

where `night_mult` = `night.time_mult` if the hop qualifies, else 1.0.

0.75 is a 25% speed-up, chosen to be **felt but not dominant**: it is smaller than the
gap between clear and overcast (1.15) times two, and much smaller than any precipitation
penalty. Weather stays the loudest thing in the model. Night is a rhythm, not a shortcut.

### 2.2 Entry-time governs the hop

A hop's day/night state is evaluated **once, at entry**, and holds for the whole hop.

This is the same rule the weather model already uses — MECHANICS §2.1 prices "the weather
of the cell being *entered*" — so it introduces no new concept, and it keeps a hop's cost
a single number rather than an integral.

**The error this accepts.** A hop takes 1.56 h by day (50 km ÷ 32 km/h) or 1.17 h by
night, so a hop entered just before dusk is charged daylight for a crossing that is mostly
dark, and vice versa. The mis-costing is bounded by one hop's night bonus:

```
max error per terminator crossing = 1.56 h × (1 − 0.75) = 0.39 h ≈ 23 min
```

Newark→Denver crosses the terminator **6 times** (§2.3), so the worst case is ~2.3 h on a
77 h flight — **3%**. And the errors alternate sign: a crossing into night over-charges,
the next crossing into day under-charges, so the typical net error is far smaller than the
bound. An integral over the hop would be more accurate and would make every cost
path-dependent in a way that §4 is already struggling with. Not worth it.

### 2.3 Worked example — Newark → Denver, two departure times

Route: `r037c090` (Little Falls NJ) → `r035c035` (Lafayette CO), **60 cells**,
great circle **2,602 km**. Summed hop distance is **2,787 km** — 7% longer than the great
circle, the staircase effect MECHANICS §8 warns about. Clear skies assumed throughout, so
the only variable is the sun. Date 2026-08-15.

**A. Sent 09:00 EDT (13:00 UTC) — into a full day**

| | Hours | Arrives (UTC) |
|---|---|---|
| v1, no night rule | **87.11** | 2026-08-19 04:07 |
| v2, `night_time_mult = 0.75` | **77.53** | 2026-08-18 18:32 |
| Saved | **9.58 h** | |

26 of 59 hops flown at night. Terminator crossings, as hours into the flight:

```
 11.9 h   at r038c082 (central PA)    → night
 21.7 h   at r038c073 (eastern OH)    → day
 37.9 h   at r038c062 (Indiana)       → night
 46.6 h   at r038c054 (Missouri)      → day
 61.4 h   at r037c045 (Kansas)        → night
 71.5 h   at r036c037 (eastern CO)    → day
```

The smoke leaves in the morning, spends the rest of the day over Pennsylvania, and does
not reach the terminator until it is nearly in Ohio — nine hours after departure, having
banked nothing.

**B. Sent 20:00 EDT (00:00 UTC) — at dusk**

| | Hours | Arrives (UTC) |
|---|---|---|
| v1, no night rule | **87.11** | 2026-08-19 15:07 |
| v2, `night_time_mult = 0.75` | **77.14** | 2026-08-19 05:08 |
| Saved | **9.97 h** | |

27 of 59 hops at night; the first crossing comes **1.5 h in**, barely out of New Jersey.

**What the comparison actually shows.** The dusk departure banks its first night almost
immediately and ends up 0.39 h faster in *elapsed* time — but it departs 11 hours later,
so it *arrives* 10.6 hours later. Over a three-day flight the sun's contribution largely
averages out: you cannot outrun the planet's rotation westward at 32 km/h, so a
long-haul message will see roughly the same number of nights whenever it leaves.

**This is a finding, not a disappointment, and it shapes §5.** Counsel that says "send at
dusk" is worth very little on a three-day flight and worth a great deal on a six-hour one,
where a single terminator crossing is a large fraction of the journey. Counsel should
therefore be *quiet* on long routes and confident on short ones — otherwise it is advice
that sounds wise and saves twenty minutes out of eighty hours.

### 2.4 Worked example — a short route, where it matters

Newark → Pittsburgh, **12 cells**, ~476 km, ~14.9 h clear by day.

Departing at 15:40 UTC (11:40 EDT), the flight is almost entirely daylight until late.
Departing at dusk, the majority of hops are night hops, and the same 476 km takes
**~12.5 h**. On a route of this length the sun is worth ~16% of the journey, against ~11%
on Newark→Denver — and, crucially, the *arrival* is genuinely earlier rather than merely
the flight being shorter. Short routes are where counsel earns its place.

---

## 3. Visibility: what darkness protects, and what defeats it

### 3.1 Wind cannot shred a flame

```
garble.daylight_only = true     (proposed)
```

The gale garble roll (MECHANICS §6.2 — 35% per gale cell) fires **only on hops entered in
daylight.**

The fiction is exact and worth stating because it is the reason, not a rationalisation: a
smoke column is a *shape*, and a 40 mph wind tears the shape apart, which is what garbling
models. A beacon fire is a **stationary point of light**. Wind does not smear a light; it
may make it flicker, but the signal it carries is its presence, not its shape. A signaller
in a gale would light the fire and stop trying to make smoke.

**Night garble immunity is unconditional** — it does not depend on the weather. Even in
fog, even in a gale, a hop entered at night rolls no garble. Fog stops you *seeing* the
fire (which §3.2 charges for in time), but it cannot shred it.

### 3.2 Fog and heavy precipitation blind both regimes

The night bonus applies only when the air is clear enough to see a fire at range. The
blinding set:

```
night.blinding_conditions = [fog, mist, snow, heavy_rain, thunderstorm]
```

In a blinding cell, `night_mult = 1.0` — the hop is priced at its ordinary daylight
weather cost, with no bonus.

**Visibility is not the same axis as speed, and fog is the proof.** Fog carries a time
multiplier of only **1.6** — lighter than light rain at 2.0 — yet fog is the single worst
condition for seeing a signal at 50 km. If the blinding set were derived from a threshold
on `time_mult`, any threshold that caught fog (≤1.6) would also catch overcast (1.15), and
any threshold that spared light rain (2.0) would spare fog. **No single number separates
them**, which is why this is an explicit list and not a tunable cut-off. Two properties,
two configurations.

### 3.3 The interaction table

Every combination, stated. `weather_mult` from MECHANICS §2.1.

| Condition | `weather_mult` | Day: effective mult | Night: effective mult | Garble roll in a gale? |
|---|---|---|---|---|
| Clear | 1.0 | 1.0 | **0.75** | day only |
| Few clouds | 1.0 | 1.0 | **0.75** | day only |
| Overcast | 1.15 | 1.15 | **0.8625** | day only |
| Light rain / drizzle | 2.0 | 2.0 | **1.5** | day only |
| Fog / mist | 1.6 | 1.6 | **1.6** — blinded, no bonus | day only |
| Snow | 2.5 | 2.5 | **2.5** — blinded | day only |
| Heavy rain | 4.0 | 4.0 | **4.0** — blinded | day only |
| Thunderstorm | 6.0 | 6.0 | **6.0** — blinded | day only |
| Severe alert active | IMPASSABLE | impassable | impassable | n/a — never entered |
| Never-fetched cell | 1.15 (`routing.unknown_cost_mult`) | 1.15 | **0.8625** | day only |

Two entries deserve comment.

**Light rain keeps the bonus** while fog does not, even though light rain costs more time.
Drizzle does not hide a fire; fog does. This is the §3.2 point made concrete, and it is
the row a reviewer should push back on if they disagree with the model.

**A never-fetched cell gets the night bonus.** Under REDTEAM F29 an unlooked-at cell
prices at 1.15 — like overcast — and overcast is not blinding, so consistency demands the
bonus applies. The alternative (deny the bonus to unknown cells) would make unexplored
terrain *doubly* expensive at night and would reintroduce a routing bias of exactly the
kind F29 was written to remove, only with the sign flipped. Flagged in §8 because it is a
judgement call, not a derivation.

---

## 4. The FIFO violation, stated honestly

### 4.1 What breaks

A routing graph is **FIFO** (or *non-overtaking*) when departing later can never mean
arriving earlier. Every shortest-path guarantee v1 relies on assumes it, implicitly,
because v1's edge costs do not depend on time at all.

Night speed-ups break it. Depart ten minutes later, catch the terminator ten minutes
earlier in the journey, and one more hop is flown at 0.75×.

### 4.2 It is not hypothetical — here it is

Sweeping departure times at 10-minute resolution across 2026-08-15, clear skies, night
rule on:

| Route | Depart | Arrive | |
|---|---|---|---|
| **Newark→Chicago** (27 cells) | 20:00 UTC | 2026-08-17 05:48:48 | |
| | **20:10 UTC** — 10 min later | **2026-08-17 05:35:22** | **13.4 min earlier** |
| **Newark→Pittsburgh** (12 cells) | 15:40 UTC | 2026-08-16 06:31:56 | |
| | **15:50 UTC** — 10 min later | **2026-08-16 06:18:30** | **13.4 min earlier** |
| **Newark→Denver** (60 cells) | 18:40 UTC | 2026-08-19 00:12:38 | |
| | **18:50 UTC** — 10 min later | **2026-08-18 23:59:11** | **13.4 min earlier** |

Same 13.4 minutes on all three, because it is the same event each time: one hop flipping
from the day side of the terminator to the night side. Waiting ten minutes buys
twenty-three, net thirteen.

### 4.3 What this costs the router

With time-dependent costs, "the cost of a path" depends on when you start it, so the
label-setting argument behind Dijkstra and A\* no longer holds as stated. The standard
result (Orda & Rom, 1990) is that time-dependent shortest path is polynomially solvable
when the network is FIFO, and — for non-FIFO networks — remains tractable **if waiting at
nodes is permitted**, because waiting can be modelled in a time-expanded graph. **Without
waiting, the non-FIFO case is hard in general.**

v2.0 forbids waiting (§4.5). So v2.0 sits in the awkward quadrant, and should say so.

### 4.4 v2.0 posture: entry-time-frozen costs, replan-corrected

**At planning time**, the router walks the candidate route accumulating time, and prices
each hop using the day/night state at its **predicted entry time**. This produces a static
weighted graph for that one departure instant, over which A\* runs exactly as it does
today.

**In flight**, the existing 15-minute replan cron (MECHANICS §4) recomputes from the
message's actual position and actual clock. Where the frozen plan drifted — because the
smoke reached a cell earlier or later than predicted, and so met a different sun — the
replan corrects it.

**The claim we are allowed to make: good routes, honestly labeled, not provably optimal.**

That phrasing is not a hedge, it is the product's existing posture applied to a new case.
MECHANICS §6.1 already accepts that stranding is eventually consistent — smoke discovering
a storm wall by flying into it — on the grounds that self-correction is more honest than
an omniscient server. REDTEAM F28 and F30 accept a preview that quotes a band rather than
buying certainty it cannot afford. A route that is excellent but not provably shortest is
the same trade, and the ETA band (F30) is already the right vehicle for admitting it.

What must **not** happen is the app claiming optimality it does not have. No copy anywhere
may say "the fastest route"; the honest words are *"the route"* or *"the way the sky is
open"*.

### 4.5 Waiting at towers is deferred to v2.1 — named, not specified

The natural next move is obvious and is deliberately **not** specified here: let smoke
**wait at a tower** for nightfall when waiting is faster than flying. Deliberately
delaying departure from a cell is exactly the mechanic the fiction wants — a signaller who
sees dusk coming and holds the message for the fire — and it is exactly the mechanic that
makes §4.3's hard case tractable again.

It is deferred because it is **a different problem, not a bigger version of this one.**
Waiting turns the state space from cells into **(cell, time)** pairs — a time-expanded
graph — which changes the router's core data structure, the meaning of `segment_etas`, the
replan contract, and what the client draws when smoke is stationary but not stranded. It
also collides with `STRANDED`: a player watching smoke sit still at a tower must be able
to tell "sheltering from a storm" from "waiting for dark", and those are different words,
different colours, and different push notifications.

That deserves its own design document and its own red-team. Naming it here is the whole
of the v2.0 obligation.

### 4.6 Admissibility: what the F19 guard must become

The A\* heuristic (ARCHITECTURE §6.2, REDTEAM F3) is:

```
h = great_circle_km × routing.heuristic_max_speed_factor / speed.base_kmh
```

and REDTEAM **F19** makes the engine **fail to boot** unless that factor is ≤ the smallest
time multiplier the config can produce. Today:

```
min achievable  =  wind.tailwind_min_mult × min(weather.time_mult, …)
                =  0.7 × 1.0
                =  0.7        ← current routing.heuristic_max_speed_factor
```

With `night.time_mult = 0.75` in play, a hop can be cheaper still:

```
min achievable  =  wind.tailwind_min_mult × min(weather.time_mult) × night.time_mult
                =  0.7 × 1.0 × 0.75
                =  0.525
```

**`routing.heuristic_max_speed_factor` must become 0.525 in the same flag flip that
enables night.** ARCHITECTURE §6.2 already states this rule for the v1.1 relay case —
*"ship the factor change in the same release as the mechanic, not after — the startup
guard will refuse to boot otherwise, which is the intended failure"* — and the same
sentence governs here. A heuristic left at 0.7 while night is enabled is not a crash; it
is silently worse routing, which is precisely the failure F19 exists to convert into a
loud one.

**The guard must read the flag, not just the value.** With `night.enabled = false` the
factor must be ≤ 0.7 and setting it to 0.525 is merely pessimistic (admissible, slower
search); with `night.enabled = true` a factor above 0.525 must refuse the boot. So the
minimum-multiplier computation takes the flag as an input.

**Interaction with `routing.unknown_cost_mult`** (REDTEAM F29, 1.15): none, in the safe
direction. It is greater than 1, so it cannot lower the floor. It is already included in
the guard's `min()` — a defensive choice made when F29 shipped, precisely so that a future
tune below 1.0 would fail the boot rather than quietly break admissibility. That defence
is worth more under v2, because there are now two ways to lower the floor and only one of
them is obvious.

**Interaction with v1.1 relays**, when they ship: 0.7 × 0.1 × 0.75 = **0.0525**. Worth
recording now so that whoever ships relays does not have to rediscover the night term.

**Admissibility itself survives** time-dependence. The heuristic must be a lower bound on
the true remaining cost; 0.525 is a lower bound on the product of multipliers *any*
realisable hop can have, at any hour. What time-dependence costs us is not admissibility —
it is the guarantee that the search's accumulated cost is path-independent, which is §4.3's
problem and is not fixable by tuning a constant.

---

## 5. Counsel — "send at dusk"

### 5.1 What it is

Advisory copy on the compose screen, before sending: the app compares what would happen
across a handful of candidate departure times and, if one is meaningfully better, says so.

> *"Held until dusk, this would reach them about four hours sooner."*

**It never delays a send.** It is counsel, in the Ledger voice, and the fire is lit when
the player says so. Auto-delay would be the app deciding for them, and this product's
entire posture is that the sky decides and the player chooses.

### 5.2 No new router

Counsel is **N evaluations of the existing planner**, one per candidate departure time,
compared on arrival instant:

```
counsel.candidate_offsets_hours = [0, 2, 4]      (TUNE)
counsel.include_dusk_dawn = true
```

giving five candidates: now, +2 h, +4 h, next dusk at the origin, next dawn at the origin.

No new algorithm, no time-expanded graph, no waiting semantics — each candidate is an
ordinary v2.0 frozen-cost plan (§4.4) with a different start instant. This is the entire
reason counsel is cheap: the sun is free to evaluate (§1.2), so the only cost is the
weather.

### 5.3 The weather it needs, and the product to fetch it from

A plan starting four hours from now must price cells by the weather **then**, not now. v1
stores only current conditions, so counsel needs hourly forecasts.

**Product:** `api.weather.gov` `/gridpoints/{office}/{gridX},{gridY}/forecast/hourly`,
reached via the `forecastHourly` link in the existing `/points/{lat},{lng}` response —
**the same `/points` lookup the engine already memoises.** Counsel therefore adds *no new
`/points` traffic at all*; it changes only which second-hop URL is followed. The product
returns roughly 156 hourly periods, which covers every candidate offset and most of a
long-haul flight.

**Cache: a separate table — recommended.** Proposed `forecast_hours(cell, valid_hour,
condition, wind_mph, wind_dir, time_mult, fetched_at)`, keyed `(cell, valid_hour)`.

Not an extension of `weather_cells`, for a concrete reason: `weather_cells` holds **one row
per cell** and the router reads it on every plan. Adding 156 rows per cell multiplies its
cardinality by two orders of magnitude and invalidates the one-row-per-cell assumption in
every query, index and policy that touches it — to serve a feature the hot path never
reads. Two tables, two lifecycles, two TTLs. The router keeps its small hot table.

```
forecast.cache_ttl_minutes = 60      (TUNE — NWS regenerates hourly forecasts ~hourly)
forecast.horizon_hours = 156
```

### 5.4 Cost envelope, under F31 discipline

A 60-cell route needs 60 hourly-forecast requests (one per cell, each returning the whole
horizon). At the F31 concurrency of 12 that is five batches — **~20 seconds**. Far too slow
to block a compose screen, and exactly the mistake REDTEAM F28 was written about.

**So counsel must never block, and must be willing to say nothing.** Proposed rule:

```
counsel.min_forecast_coverage = 0.8      (TUNE)
```

Counsel is computed **only from hourly data already cached.** If fewer than 80% of the
route's cells have usable forecast rows, counsel is silent — no spinner, no "calculating",
no partial advice. It appears when it can be trusted and is absent otherwise.

Hourly data is populated by the **warming cron (F31)**, as a third priority behind
in-flight corridors and live fires — the corridors between flock pairs with recent traffic
are exactly the corridors a counsel request will ask about. Same per-pass budget, same
"log what you dropped" discipline. Nothing about counsel gets its own fetching path.

The consequence is honest and worth stating: **counsel will be silent for a brand-new
pair's first send**, and will appear once that corridor is warm. That is the same
cold-start shape as F28's budget, and the same answer — say less rather than wait.

### 5.5 When counsel should speak

Per §2.3, the sun's value shrinks as routes lengthen. Counsel that fires on an 80-hour
flight to save 20 minutes is noise wearing the costume of wisdom. Proposed threshold:
counsel speaks only when the best candidate beats sending now by more than a stated
fraction of the journey **and** by more than a stated absolute time — both numbers to be
set at red-team, since this is a copy-frequency judgement as much as a mechanical one.
Flagged in §8.

---

## 6. Config flags and the rollout

### 6.1 Every mechanic behind its own flag, all default off

| Key | Default | What it gates |
|---|---|---|
| `night.enabled` | **false** | The whole sun model: §2 traversal, §3 interactions |
| `night.time_mult` | 0.75 | Night traversal multiplier (TUNE) |
| `night.twilight_elevation_deg` | −6.0 | Civil twilight threshold (§1.1) |
| `night.blinding_conditions` | `[fog, mist, snow, heavy_rain, thunderstorm]` | Conditions that deny the bonus (§3.2) |
| `garble.daylight_only` | **false** | Night garble immunity (§3.1) |
| `counsel.enabled` | **false** | Counsel copy on compose (§5) |
| `counsel.candidate_offsets_hours` | `[0, 2, 4]` | Candidate departure times (§5.2) |
| `counsel.include_dusk_dawn` | true | Add next dusk and dawn as candidates |
| `counsel.min_forecast_coverage` | 0.8 | Below this, counsel says nothing (§5.4) |
| `forecast.cache_ttl_minutes` | 60 | Hourly forecast TTL (§5.3) |
| `forecast.horizon_hours` | 156 | How far ahead we keep hourly rows |
| `routing.heuristic_max_speed_factor` | **0.7 → 0.525** | Existing key; must move with `night.enabled` (§4.6) |

`night.enabled` and `garble.daylight_only` are separate flags deliberately: the speed
mechanic and the garble mechanic are independently defensible, independently tunable, and
independently reversible. If beta hates one it should be switchable without losing the
other.

### 6.2 The flag-flip sequence

**Week 1 — baseline.** Everything off. `routing.heuristic_max_speed_factor = 0.7`. This is
v1 behaviour exactly, and it exists to produce a clean comparison set: delivery times,
garble rates and complaint rates with no sun in the model.

**Week 2 — sun on.** In a single atomic change: `night.enabled = true`,
`garble.daylight_only = true`, **and** `routing.heuristic_max_speed_factor = 0.525`.
Atomic because the F19 guard makes the intermediate state a refused boot, which is the
intended behaviour, not an obstacle to work around.

**Week 3 — counsel on.** `counsel.enabled = true` plus the forecast keys. No heuristic
change: counsel adds evaluations, not edges.

Rolling back is the reverse, and the same atomicity applies — turning night off while the
factor sits at 0.525 boots fine (pessimistic heuristics are admissible, merely slower), so
only the *enabling* direction is dangerous. Worth stating so an operator under pressure
knows which way is safe.

### 6.3 What the F19 boot guard asserts in each state

| Flag state | Minimum achievable multiplier | Guard asserts |
|---|---|---|
| Night off | `0.7 × 1.0` = 0.7 | factor ≤ 0.7 |
| Night on | `0.7 × 1.0 × 0.75` = 0.525 | factor ≤ 0.525 |
| Night on + v1.1 relays | `0.7 × 1.0 × 0.75 × 0.1` = 0.0525 | factor ≤ 0.0525 |

The guard already includes `routing.unknown_cost_mult` in its `min()`; the night term joins
it, gated on `night.enabled`.

**One hole to close.** The guard runs at **boot**, and `mechanics_config` is a live table.
Flipping `night.enabled` in the database while the engine is running enables the mechanic
against an un-checked heuristic — the exact silent degradation F19 exists to prevent. Two
candidate answers: require an engine restart for flag flips (operationally simple, but
"restart to change config" undermines the point of a config table), or re-run the guard on
every config reload and refuse to adopt a config that fails. This is a real gap in the
existing design that v2 makes reachable. Listed in §8.

---

## 7. Test obligations

### 7.1 The Dijkstra-equivalence suite, under time-dependence

`test/routing/optimality.test.ts` currently asserts that A\* returns the same cost as plain
Dijkstra over the same graph — the executable form of "the heuristic is admissible".

Under time-dependence this claim must be restated, not dropped: **equivalence holds per
frozen snapshot.** For a fixed departure instant, §4.4 produces a static weighted graph,
and over *that* graph A\* and Dijkstra must still agree exactly. What is no longer claimed
is that the frozen-snapshot optimum is the true time-dependent optimum — §4.2 gives a
counterexample, and no test should assert otherwise.

The suite therefore gains a departure-time parameter and keeps its assertion. It must also
gain an explicit negative test: **a known FIFO-violating instance where the frozen optimum
is provably not the time-dependent optimum**, asserting that we do not claim it is. A test
that documents a limitation is worth more than one that hides it.

### 7.2 New property tests

- **Monotonicity.** A route flown entirely at night is never slower than the same route
  flown entirely by day, all else equal. Falls out of `night_time_mult ≤ 1`, and catches
  the inversion bug REDTEAM F11 already found once — multipliers applied to speed instead
  of time would make night *slower*, and this is the tripwire.
- **Blinding set is honoured.** For every condition in `night.blinding_conditions`, a night
  hop costs exactly its daylight cost. For every condition outside it, a night hop costs
  exactly `weather_mult × night.time_mult`. The §3.3 table, executable.
- **Garble immunity.** A gale cell entered at night never rolls garble, at any weather,
  including fog. A gale cell entered in daylight rolls at the configured rate.
- **Flag isolation.** With `night.enabled = false`, every cost in the system is bit-identical
  to v1. This is what makes the week-1 baseline meaningful.
- **Boot guard, per flag state.** Each row of the §6.3 table is a test: a factor above the
  stated bound must refuse to boot; at or below it must start.
- **Shared sun definition.** The engine's day/night decision and the client's must come
  from the same function and agree at the same instant for the same cell — asserted at the
  boundary, so that a future divergence is a failing test rather than a player noticing a
  fire on a map while the router charges daylight.
- **Terminator resolution.** The mis-costing bound of §2.2 holds: no single hop is charged
  a night bonus it did not qualify for by more than the bounded error.

### 7.3 The replan-correction test

The one that earns §4.4 the right to its posture. Construct a FIFO-violating instance
(§4.2 supplies three), commit the frozen-cost plan, advance the clock, run the replan cron,
and assert:

- the replan produces an arrival **no later** than the frozen plan predicted; and
- where the frozen plan was suboptimal, the corrected route measurably improves it.

Without this test, "replan-corrected" is a claim rather than a mechanism. With it, the
honest label in §4.4 is backed by something.

---

## 8. Open questions for the architect

Policy calls, contradictions and judgement calls, listed rather than resolved.

1. **The M5.5 cosmetic sun layer does not exist.** The brief assumes one to share code
   with; it was proposed but never implemented or ruled. §1.3 treats the shared module as
   new v2 work. Confirm — and rule whether the *visual* day/night layer (fire vs smoke on
   the map) ships with v2 mechanics or separately, since the two are now coupled by the
   shared-definition obligation.

2. **Does wind still act on time at night?** §3.1 rules that wind cannot *garble* a beacon.
   It does not follow that wind cannot *slow* one — but the fiction pulls that way: if a
   flame's signal is its presence rather than its shape, a headwind arguably should not
   retard it either. Leaving `wind_mult` fully active at night is internally inconsistent
   with the reason given for garble immunity. Needs a ruling; I have deliberately not
   assumed one.

3. **Should never-fetched cells get the night bonus?** §3.3 grants it, reasoning from F29
   that unknown prices as overcast and overcast is not blinding. The alternative makes the
   unexplored doubly expensive at night and reintroduces a routing bias with the sign
   flipped. Judgement call.

4. **Is snow blinding?** It is in the proposed set on visibility grounds, but it is the
   least obvious member — heavy snow certainly, light snow arguably not, and NWS condition
   text does not always distinguish them. Fog, heavy rain and thunderstorm are
   uncontroversial; snow is the row to argue about.

5. **Does night change transmission time?** MECHANICS §3 charges 3 s per 4 characters to
   puff a message out at the origin. Lighting and dousing a fire is a different physical
   act from making smoke puffs, and might reasonably be faster, slower, or unchanged. v2.0
   assumes unchanged. Unruled.

6. **Whose dusk does counsel mean?** §5.2 proposes "next dusk **at the origin**" — the
   sender's own sky, which is what they can see out of the window. The alternative (dusk at
   the *route's* first dark cell) is more mechanically accurate and less intuitive. Product
   call.

7. **Counsel's speaking threshold.** §5.5 leaves both numbers unset — the fractional gain
   and the absolute-time floor below which counsel stays quiet. This is a copy-frequency
   decision as much as a mechanical one, and §2.3's finding (the sun is worth little on
   long routes) means the wrong threshold makes counsel chatter uselessly on exactly the
   flights players care most about.

8. **The boot-guard hole (§6.3).** `mechanics_config` is live but F19's guard runs only at
   boot, so a mid-flight flag flip enables a mechanic against an unchecked heuristic. This
   pre-exists v2 but v2 makes it reachable. Restart-required, or re-guard on reload?

9. **Waiting at towers (§4.5) — confirm the deferral.** Named and not specified here, on
   the grounds that it is a time-expanded-graph problem touching the router's core data
   structure, `segment_etas`, the replan contract, and the visual language for "stationary
   but not stranded". Confirm v2.1, and whether it should be designed before or after v2.0
   beta data arrives.

10. **Is "not provably optimal" acceptable to state publicly?** §4.4 proposes the product
    never claim "fastest route". If any existing or planned copy does claim it, that copy
    changes with this milestone — and the FAQ may want an honest sentence about it, in the
    same spirit as the existing "the sky decides" framing.

---

## 9. What this document does not do

No implementation exists. No `mechanics_config` rows have been added. No migration has
been written. No code in `packages/shared`, `services/engine` or `apps/mobile` has been
modified for any mechanic described here.

The numbers in §2.3, §2.4 and §4.2 were computed against the real committed grid, the real
land mask and the real cell geometry, using a throwaway analysis script that was not added
to the repository. They are reproducible and they are not estimates — but they are
*proposals about a model*, and the model is what the red-team is for.
