# SMOKE — Mechanics Specification v2.0

**Status: ruled and cleared for implementation.** Red-teamed as REDTEAM F32–F43; every
open question in §8 has an answer and the amendments are folded in below. Numbers marked
TUNE remain tunable; everything else is decided.

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

**Correction to the brief, and the ruling on it** (REDTEAM F32). The V2 brief referred to
"the same computation the M5.5 cosmetic layer already uses." **No such layer existed.**
M5.5 shipped no day/night rendering — a grep for night/dusk/dawn/solar logic across
`services/engine/src`, `packages/shared/src` and the app returned nothing but a Keeper
flavour line and a comment. It was proposed in an input list, never built, never ruled.

So the shared module is **new work in v2**, and F32 rules that the sun's physics and its
theater **ship together in one milestone**: `packages/shared/src/geo/sun.ts` first, then
both consumers. Written once and consumed twice, rather than reconciled later.

**Theater runs ahead of mechanics, deliberately.** A separate flag
`night.visuals_enabled` defaults to **true** — the map may show fire-at-night from day
one, because the app should always be honest about what the sky looks like, and what the
sky looks like does not depend on whether we have switched on a multiplier.

The line that must not be crossed: **no copy anywhere may claim speed** — "travels faster
as fire" and every cousin of it — unless `night.enabled` is true. Showing a fire is a
description of the world. Saying it goes faster is a claim about the model, and until the
flag is on it is a false one.

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

### 2.1.1 Transmission time is unchanged at night

Working a fire shutter and puffing smoke are different physical acts, and the difference
is **below the resolution of a model that charges 3 s per four characters** (REDTEAM F36).
MECHANICS §3 stands unamended and there is no new key. One flavour line is permitted at a
night-time origin — *"The fire speaks in flashes"* — carrying zero mechanics.

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

### 3.1.1 Two axes: integrity is information, speed is operations

The draft of this document left `wind_mult` fully active at night and was rightly
challenged: if wind cannot reach a beacon, why does it still slow one? The answer
(REDTEAM F33) is that the question conflates two different things, and the draft's own
wording invited it.

**Integrity is information.** Garbling destroys the *shape* that carries the meaning. A
fire's meaning is its presence, so there is no shape to destroy, so darkness is immunity.
This is why `garble.daylight_only` exists.

**Speed is operations.** `wind_mult` was never modelling information at all. It is the
drag of running a signal station: keeping a fire lit, fed, banked and sightable through a
gale is slow, dangerous work, and a crew fighting the wind is a slower crew whatever they
are burning. Wind therefore applies to time in both regimes, always.

Two axes, two rules, no contradiction. Approved flavour for a night gale:
*"The fire bends in the wind, but holds."*

### 3.2 Fog and heavy precipitation blind both regimes

The night bonus applies only when the air is clear enough to see a fire at range. The
blinding set:

```
night.blinding_conditions = [fog, mist, snow, heavy_rain, thunderstorm]      (TUNE)
```

**Snow stays in the set, undivided** (REDTEAM F35). Heavy snow certainly blinds and
flurries arguably do not, but NWS condition text does not reliably separate them, and a
list an operator can explain beats a distinction the data cannot support. **Explicit
revisit condition:** if beta logs show snow-blinding firing on flurries in a way testers
notice, revisit against real NWS strings — not against intuition.

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

**A never-fetched cell gets the night bonus** (ruled, REDTEAM F34). Under F29 an
unlooked-at cell prices at 1.15 — like overcast — and overcast is not blinding, so
consistency demands the bonus applies. Denying it would make unexplored terrain *doubly*
expensive after dark, reintroducing exactly the routing bias F29 was written to remove,
with the sign flipped.

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
may say "the fastest route"; the approved words are *"the route"* and *"the way the sky is
open"*.

**This is public posture, not an internal caveat** (REDTEAM F41). One FAQ sentence carries
it, in the Ledger voice:

> *"The sky does not certify shortest paths."*

The §4.2 sweep — leave ten minutes later, arrive thirteen minutes earlier — is recorded in
LAUNCH.md as launch-thread material. A product whose premise is that the weather is in
charge can afford to be interesting about the one place that premise bites the router.

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

**Confirmed v2.1, and designed after v2.0 beta data** (REDTEAM F40). The beta measures the
empirical size of the FIFO gap — how often a replan corrects a frozen plan, and by how
much. Designing a time-expanded graph before knowing whether the prize is thirteen minutes
or three hours is speculation with a data source already on the calendar.

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

giving five candidates: now, +2 h, +4 h, **next dusk at the origin**, next dawn at the
origin.

**Dusk means the sender's own sky** (REDTEAM F37) — the one out their window. The
route-relative alternative (dusk at the route's first dark cell) is mechanically purer and
completely invisible to the person being advised. Where intuition and purity conflict in
advisory copy, intuition wins. Counsel says *"at dusk"*, **never a clock time** — the same
philosophy as F30's bands.

No new algorithm, no time-expanded graph, no waiting semantics — each candidate is an
ordinary v2.0 frozen-cost plan (§4.4) with a different start instant. This is the entire
reason counsel is cheap: the sun is free to evaluate (§1.2), so the only cost is the
weather.

### 5.3 The weather it needs, and the product to fetch it from

A plan starting four hours from now must price cells by the weather **then**, not now. v1
stores only current conditions, so counsel needs hourly forecasts.

**Every candidate prices from the same product, including "now"** (REDTEAM F42). The draft
priced the "now" candidate from `weather_cells` and every later candidate from
`forecast_hours` — two products with different biases, which makes the comparison measure
the products rather than the sky. Hourly forecasts are smoothed; if they run systematically
milder than current-condition readings, counsel would recommend waiting for reasons that
are entirely an artefact of which table was read, and the advice would look plausible every
single time.

So when counsel evaluates, **all five candidates read `forecast_hours`**, the "now"
candidate taking the hour-0 row. `weather_cells` remains the router's authority for actual
sends and replans — this is a comparison instrument, not a change to how messages fly.

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

**The table needs a janitor** (REDTEAM F43a). Rows whose `valid_hour` has passed are dead
weight and nothing in the draft ever deleted them. They are swept by the existing
dissipation-cadence cron family — hourly is ample for hourly data — and the growth bound
is worth stating because it is the reassuring part:

```
max rows = forecast.horizon_hours × (cells ever warmed for counsel)
```

**never the whole grid.** Under F31 discipline only corridors with recent traffic are
warmed, so a single active pair costs ~60 cells × 156 hours ≈ 9,400 rows. The bound scales
with use, not with geography.

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
flight to save 20 minutes is noise wearing the costume of wisdom.

**Counsel speaks only when the best candidate beats sending now by at least** (REDTEAM F38):

```
max( counsel.min_abs_minutes , counsel.min_fraction × send_now_eta_hours )
counsel.min_abs_minutes = 30      (TUNE)
counsel.min_fraction    = 0.05    (TUNE)
```

**And counsel never proposes waiting longer than the time it saves.** Advice to wait four
hours to arrive three hours sooner is not advice.

Together with §2.3's finding, these two rules make counsel **confident on short routes and
silent on long ones by construction** rather than by a tuned guess. On Newark→Pittsburgh
(~15 h) the bar is 45 minutes and dusk clears it easily. On Newark→Denver (~80 h) the bar
is four hours, which the sun cannot deliver on a route that long — so counsel says nothing,
which is the correct thing to say.

---

## 6. Config flags and the rollout

### 6.1 Every mechanic behind its own flag, all default off

| Key | Default | What it gates |
|---|---|---|
| `night.enabled` | **false** | The whole sun model: §2 traversal, §3 interactions |
| `night.visuals_enabled` | **true** | Fire-at-night rendering (F32). Theater only; never gates copy that claims speed |
| `night.time_mult` | 0.75 | Night traversal multiplier (TUNE) |
| `night.twilight_elevation_deg` | −6.0 | Civil twilight threshold (§1.1) |
| `night.blinding_conditions` | `[fog, mist, snow, heavy_rain, thunderstorm]` | Conditions that deny the bonus (§3.2) |
| `garble.daylight_only` | **false** | Night garble immunity (§3.1) |
| `counsel.enabled` | **false** | Counsel copy on compose (§5) |
| `counsel.candidate_offsets_hours` | `[0, 2, 4]` | Candidate departure times (§5.2) |
| `counsel.include_dusk_dawn` | true | Add next dusk and dawn as candidates |
| `counsel.min_forecast_coverage` | 0.8 | Below this, counsel says nothing (§5.4) |
| `counsel.min_abs_minutes` | 30 | Counsel stays quiet below this saving (F38, TUNE) |
| `counsel.min_fraction` | 0.05 | …or below this fraction of the send-now ETA (F38, TUNE) |
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

**"Atomic" has an exact operator meaning** (REDTEAM F39): the guard evaluates a config
snapshot **as a set**, so the flip must be **one SQL transaction touching all three keys**.

```sql
begin;
  update mechanics_config set value = 'true'  where key = 'night.enabled';
  update mechanics_config set value = 'true'  where key = 'garble.daylight_only';
  update mechanics_config set value = '0.525' where key = 'routing.heuristic_max_speed_factor';
commit;
```

Flip them in three separate statements and the engine may load an intermediate snapshot —
night enabled against a 0.7 heuristic — which it will refuse to adopt, keeping the previous
config and logging loudly. Nothing breaks, but the flip silently does not take effect,
which is a worse kind of confusion than a failure.

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

**The hole, and how it is closed** (REDTEAM F39). F19's guard ran only at **boot**, while
`mechanics_config` is a live table — so flipping `night.enabled` on a running engine would
enable the mechanic against an unchecked heuristic, which is the exact silent degradation
F19 exists to prevent.

Restart-required was **rejected**: "restart the server to change config" defeats the point
of having a config table.

**The engine guards adoption, not boot.** Every config snapshot it loads — at boot and on
reload, by the same code path — is validated as a set. An invalid snapshot is **not
adopted**: the engine keeps the **last good config**, logs loudly, and fires the dead-man
alert channel.

This is the only correct semantics given the operator reality, and the reason is worth
stating: **config writes are raw SQL.** The engine cannot refuse the write. It can only
refuse to believe it. So the guarantee is not "invalid config cannot exist" but "invalid
config cannot take effect" — and the loud log is what turns the second into something an
operator finds out about.

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

**Both assertions hold only under fixture weather held constant** (REDTEAM F43b). If the
sky legitimately worsens mid-flight, a replan *should* return a later arrival, and a test
that forbids it would be asserting something false about the world. The fixture condition
is therefore part of the obligation, not an implementation detail — state it in the test,
or the suite eventually teaches everyone to distrust a failure that was honest.

Without this test, "replan-corrected" is a claim rather than a mechanism. With it, the
honest label in §4.4 is backed by something.

---

## 8. The questions, and their rulings

All ten were answered in the V2 red-team (REDTEAM F32–F41), and two further findings —
F42 and F43 — were raised against the draft itself. Kept here as the record of what was
asked and what was decided.

1. **Shared sun module and the missing cosmetic layer** → **F32.** Confirmed: no layer
   existed, the brief was wrong, the record now says so. Physics and theater ship in one
   milestone, `sun.ts` first. New flag `night.visuals_enabled` (default true) lets the map
   show fire from day one; no copy may claim *speed* unless `night.enabled` is true.

2. **Does wind still act on time at night?** → **F33.** Yes, fully. The apparent
   inconsistency was a category error in the draft's wording: integrity is information
   (immune), speed is operations (never immune). See §3.1.1.

3. **Do never-fetched cells get the night bonus?** → **F34.** Yes, as drafted. Denying it
   reintroduces F29's bias with the sign flipped.

4. **Is snow blinding?** → **F35.** Stays in the set, undivided, marked TUNE with an
   explicit revisit condition against real NWS strings.

5. **Does night change transmission time?** → **F36.** No. Below the model's resolution.
   One flavour line, zero mechanics.

6. **Whose dusk does counsel mean?** → **F37.** The origin's — the sender's own sky.

7. **Counsel's speaking threshold** → **F38.** `max(30 min, 5% of the send-now ETA)`, and
   never propose waiting longer than the saving.

8. **The boot-guard hole** → **F39.** Guard adoption rather than boot; last-good-config
   semantics; the week-2 flip is one SQL transaction.

9. **Waiting at towers** → **F40.** v2.1 confirmed, designed *after* beta data measures the
   real size of the FIFO gap.

10. **Is "not provably optimal" public?** → **F41.** Yes. *"The sky does not certify
    shortest paths."*

**F42 — counsel was comparing two different weathers.** Raised against the draft: pricing
"now" from `weather_cells` and later candidates from `forecast_hours` measures the
products, not the sky. All candidates now read `forecast_hours`. §5.3.

**F43 — two omissions.** `forecast_hours` had no janitor (§5.3), and §7.3's
replan-correction assertion is only true under constant fixture weather (§7.3).

## 9. Provenance of the numbers

The figures in §2.3, §2.4 and §4.2 were computed against the real committed grid, the real
land mask and the real cell geometry — not estimated. The Newark→Denver route really is 60
cells, really does cross the terminator six times, and the FIFO violation in §4.2 was found
by sweeping departure times at ten-minute resolution rather than by argument.

They remain *claims about a model*. The model is now ruled (REDTEAM F32–F43) and
implemented behind flags that default off, which means the beta — not this document — gets
the last word on whether 0.75 is the right number.
