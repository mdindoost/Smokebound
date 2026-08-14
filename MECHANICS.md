# SMOKE — Mechanics Specification v0.1

All gameplay numbers live here and ONLY here. Implementation must read these from a server-side config table (`mechanics_config`) so beta tuning requires zero client releases.

**TUNE = expect to change in beta.**

---

## 1. The grid

- Square cells, **50 km × 50 km** (v1; consider H3 res 4 later). Launch region: **full continental US (CONUS)**, bounding box 24°N–49.5°N, 125°W–66°W ≈ **~3,200 land cells** out of 6,042 cells in the box. Still a trivially small graph; lazy weather fetching means empty regions cost nothing. No AK/HI/international in v1 (no NWS land data over ocean; "smoke can't cross the sea" is the in-fiction rule).
- Each cell carries: `weather_condition`, `wind_speed`, `wind_dir`, `fetched_at`.
- Weather source: **NWS API** (free, no key, US-only — fine for v1). Cache TTL: **30 min** (TUNE).
- Cells fetched lazily: only cells inside the bounding boxes of in-flight routes (+1 cell padding).

### 1.1 The ocean rule (land mask)

The fail-open rule (§2.1) has a hole over water: an unfetched ocean cell would be
treated as permanently clear, making the Atlantic the cheapest highway in the graph.
A* would then route Newark→Miami straight out to sea around every storm. So:

- A **static per-cell `is_land` mask** is generated at build time from Natural Earth
  land polygons and committed as generated data in `packages/shared`. It is data, not a
  tunable — it changes only when the grid changes.
- **Traversable = `is_land` OR 8-adjacent to a land cell.** That one-cell skirt keeps
  coastal routing natural (Newark, Miami and Seattle all sit on the coast) without
  opening the open ocean.
- **Open-ocean cells are impassable, always** — no weather fetch, no cost, no route.
  In fiction: smoke cannot cross open water. This is a hard structural rule, not a
  weather condition, and it is never overridden by fail-open.
- Weather for traversable coastal-water cells is fetched normally; NWS marine zones do
  return data near shore, and fail-open covers the cells where they do not.

## 2. Speed model

- **Base smoke speed: `speed.base_kmh` = 32 km/h** (TUNE — the single most important number
  in the app). This key is **canonical**: every computation uses km/h. "20 mph" is UI
  flavor copy only; no code may compute from an mph value. (`speed.base_mph` is deprecated
  and kept solely so display strings have somewhere to read it from.)
- **All multipliers are TIME multipliers — higher means slower.** The traversal cost of a
  cell is:

  ```
  hours = (cell_km / speed.base_kmh) × weather_mult × wind_mult
  ```

  There is no "effective speed = base × mult" anywhere in the system: multiplying speed by
  a time multiplier inverts every one of them (a thunderstorm would make smoke six times
  faster). If you find that phrasing in code or docs, it is a bug.

### 2.1 Weather multipliers (on time, higher = slower)

| Condition (NWS mapped) | time_mult | Notes |
|---|---|---|
| Clear / few clouds | 1.0 | |
| Overcast | 1.15 | |
| Fog / mist | 1.6 | visibility penalty |
| Light rain / drizzle | 2.0 | |
| Snow | 2.5 | |
| Heavy rain | 4.0 | |
| Thunderstorm | 6.0 | slow and dramatic, but passable |
| **NWS severe warning/watch active** | **IMPASSABLE** | cell cost = ∞; triggers detour or stranding |

**Fail-open rule:** cells with missing/unfetchable/stale-beyond-2×TTL weather are treated as clear (1.0×) and flagged `weather_unknown`. Never strand a message on missing data — only on confirmed severe weather.

### 2.2 Wind

- Component of wind along travel direction: tailwind → `wind_mult = max(0.7, 1 − 0.01×mph_along)`; headwind → `wind_mult = min(1.6, 1 + 0.015×mph_against)`. (TUNE)
- `wind_mult` multiplies **time**, like every other multiplier, and is clamped to
  **[0.7, 1.6]**. A full tailwind is therefore the fastest the sky ever gets: 0.7× time,
  i.e. `base_kmh / 0.7` effective — which is the number the A* heuristic divides by (§4).
- **Gale rule:** sustained wind > 40 mph in a cell → each traversal rolls **garble** (§6.2) regardless of route.

## 3. Transmission time (message length matters)

- Before travel begins, the fire "transmits" the message puff-by-puff:
  `transmission_time = 3 s × ceil(chars / 4)` → 280 chars ≈ **3.5 min** of visible puffing at the origin. (TUNE)
- v1: purely time + animation (no encoding choice). v2 splits into Express/Certified modes.
- Design intent: nudges terse, telegram-style writing; makes long messages feel costly without being punitive.

## 4. Routing

- **Algorithm:** A* on the 8-connected cell grid.
  - Edge weight (hours) = `(cell_km / speed.base_kmh) × weather_mult × wind_mult`, with
    `cell_km` the length of that hop (×1.414 on a diagonal).
  - Heuristic = `great_circle_km × 0.7 / speed.base_kmh` — the straight-line distance at
    the fastest the sky can ever be (full tailwind, §2.2). Admissible, because no real
    path can beat 0.7× time over a distance no shorter than the great circle.
  - Impassable cells (severe alert, or open ocean per §1.1) are pruned, not costed.
- **Endpoints:** sender's and recipient's **last-known coarse location**, snapped to cell centers. Recipient location defaults to their registration cell if stale.
- **Commit-with-replan-on-block:**
  - Route computed and shown at send; smoke follows it.
  - Replan job runs **every 15 min** (TUNE) per in-flight message: if the *next* cell on the route has become impassable → message state = `STRANDED`; A* replans from current position. If no finite-cost route exists → remain `STRANDED`, retry each cycle.
  - Stranded smoke visibly waits at the storm edge (drama, push notification).
- **Position model:** server stores `route[]`, `departed_at`, per-segment durations; current position is derived, not ticked. Client animates between server-confirmed waypoints. (No per-second server work.)
- v1.1 relays: a cell containing a user active in the last 24 h gets `relay_mult = 0.5` on traversal time; "tend the fire" tap within 30 min of smoke entering → `relay_mult = 0.1` for that hop. (TUNE)

## 5. Message constraints

- **280-char cap.** Rationale: bounds transmission time (§3), bounds garble damage (§6.2), fits parchment UI, and is an on-brand joke (a tweet by smoke).

## 6. Failure & drama states

### 6.1 Stranded
- Trigger: next cell impassable (§4). No message loss from stranding itself for the first **24 h**.
- After 24 h continuously stranded: **5%/day dissipation roll** → `LOST`. (TUNE — keep rare; losing messages must be memorable, not routine.)

### 6.2 Garbled (wind damage)
- Trigger: traversing a gale cell (§2.2). Roll once per gale cell: **35%** chance to garble. (TUNE)
- Effect: replace `ceil(chars × U(0.03, 0.10))` random characters with wind-swept variants (spaces, dropped letters, `~`). **Script-safe rule:** operate on whole Unicode grapheme clusters only (never partial/diacritic manipulation) so garbling degrades gracefully in any language (Latin, Arabic, CJK, emoji). Message still delivers, marked "wind-damaged," original NOT recoverable (that's the bit).
- Never garble below legibility: max 10% of characters.

### 6.3 Lost
- Only via §6.1 dissipation (v1 has NO random spontaneous loss — unlike Carrier Pidge's 0.2% coin flip, all our failures are weather-caused and inspectable on the map; that's the differentiator and the fairness story).
- Loss screen shows where/why it died + one-tap re-send ("light a new fire"), which reuses the text and recomputes a route.

## 7. Worked examples (base numbers above, launch-region)

**A. Newark → Chicago (~1,150 km ≈ 715 mi, ~23 cells)**
- Clear skies whole route: (1,150 km / 32 km/h) × 1.0 ≈ **36 h** + 3.5 min transmission. (Slower than Carrier Pidge's ~22 h LA→NYC over 2.4× the distance — we are meaningfully slower per-mile than the pigeon. On-brand.)
- Thunderstorm line over western PA, clear detour via WV/OH valley (+180 km): (1,330 km / 32 km/h) ≈ **41.5 h**, route preview shows the southern arc around the radar blob.
- Storm forms mid-flight over Ohio, no finite route for 5 h, then clears: 36 h + **5 h sheltering** ≈ 41 h, with a "sheltering" push at hour ~14.

**B. Newark → Philadelphia (~130 km, ~3 cells)**
- Clear: ≈ **4 h**. Same-cell friends (< 50 km): minimum delivery time floor = **10 min** (TUNE — never instant; anticipation is the product).

### 7.1 Proximity flavor (same-cell / adjacent-cell)
- Pre-send preview adds: "They're close enough to see your smoke directly. You could just walk over. Send anyway?"
- Delivered footnote: "This signal traveled X mi. On foot: Y min." (walking est = distance / 3 mph)
- v1.1 **"Come to the fire"**: textless summons signal for same/adjacent-cell flock members — recipient gets "[handle] has lit a fire nearby. Come." + map pin. 10-min floor waived (TUNE); designed for campus use.

**C. Newark → Miami (~1,750 km) in light rain half the route**
- (875/32) + (875/32 × 2.0) ≈ 27 + 55 ≈ **82 h (~3.4 days)**. Long-haul messages are multi-day events. Intended.

## 8. Numbers most likely to need beta tuning, in order
1. Base speed (`speed.base_kmh` = 32) — sets the entire feel.
2. Minimum delivery floor (10 min) & same-city times.
3. Garble probability/severity.
4. Replan cadence vs server cost.
5. Dissipation rate.

## 9. Server-cost envelope (sanity check)
- 1,000 in-flight messages, replan every 15 min = 96 k light A* runs/day — negligible CPU.
- Weather: ≤ 3,200 CONUS cells × 48 fetches/day absolute worst case ≈ 154 k NWS calls/day, but lazy fetching (active-route cells only) keeps realistic volume far below that — free API, jittered caching; if throttled, degrade TTL to 60 min. Open-ocean cells (§1.1) are never fetched at all.
- Push: ~4 pushes/message avg. All comfortably inside free/hobby tiers until real traction.
