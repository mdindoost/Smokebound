# SMOKE — Mechanics Specification v0.1

All gameplay numbers live here and ONLY here. Implementation must read these from a server-side config table (`mechanics_config`) so beta tuning requires zero client releases.

**TUNE = expect to change in beta.**

---

## 1. The grid

- Square cells, **50 km × 50 km** (v1; consider H3 res 4 later). Launch region: **full continental US (CONUS)**, bounding box 24°N–49.5°N, 125°W–66°W ≈ **~3,200 land cells** out of 6,042 cells in the box. Still a trivially small graph; lazy weather fetching means empty regions cost nothing. No AK/HI/international in v1 (no NWS land data over ocean; "smoke can't cross the sea" is the in-fiction rule).
- Each cell carries: `weather_condition`, `wind_speed`, `wind_dir`, `fetched_at`.
- Weather source: **NWS API** (free, no key, US-only — fine for v1). Cache TTL: **30 min** (TUNE).
- Cells fetched lazily: only cells inside the bounding boxes of in-flight routes (+1 cell padding).

### 1.1 The land mask: sea and border rules

The fail-open rule (§2.1) has a hole anywhere NWS has no data. An unfetched cell is
priced as permanently clear, so the Atlantic — and, just as badly, Canada and Mexico —
would be the cheapest terrain in the graph. A* would route Newark→Miami out to sea and
Detroit→Buffalo through Ontario, around every storm. Both holes are closed structurally,
not by weather:

- Two **static per-cell mask layers** are generated at build time from Natural Earth and
  committed as generated data in `packages/shared`: `is_land` (1:10m land polygons) and
  `is_us` (1:10m admin-0, United States), rasterised identically. They are data, not
  tunables — they change only when the grid changes.
- **Border cells are decided by majority sample:** a cell straddling the border is US if
  most of its land sample points are US, and foreign otherwise. Every cell is therefore
  exactly one of: US land, foreign land, or water.
- **Traversable = (`is_us` OR 8-adjacent to a US-land cell) AND NOT foreign land.**
  The one-cell skirt keeps coastal routing natural (Newark, Miami and Seattle all sit on
  the coast); the foreign-land exclusion keeps smoke inside the launch region.
- **Open ocean and foreign land are impassable, always** — no weather fetch, no cost, no
  route. These are hard structural rules, not weather conditions, and fail-open never
  overrides them. In fiction: smoke cannot cross open water, and it cannot cross the
  border. In copy: *"Your smoke cannot cross the border."*
- The border rule is a **v1 launch-region rule, not a permanent one.** It exists because
  our weather source is US-only; it reopens with international expansion (SPEC §3 v2),
  when a global weather provider makes foreign cells routable.
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

**Fail-open rule:** cells with missing/unfetchable/stale-beyond-2×TTL weather are treated as clear (1.0× — `weather.unknown_time_mult`) and flagged `weather_unknown`. Never strand a message on missing data — only on confirmed severe weather.

**Unexplored is not the same as clear** (REDTEAM F29). The fail-open rule above answers one question — *may missing data strand a message?* (no) — and for a long time it was accidentally answering a second one nobody asked: *should the router prefer terrain it has never looked at?* At 1.0× the answer was yes, because a never-fetched cell was the cheapest thing in the graph, and A\* went hunting for it. A cell we have never fetched now costs `routing.unknown_cost_mult` (1.15, the same as overcast) **in edge costs only**. It stays crossable — nothing but an impassable flag may stop a message — it simply stops being inviting.

### 2.2 Wind

- Component of wind along travel direction: tailwind → `wind_mult = max(0.7, 1 − 0.01×mph_along)`; headwind → `wind_mult = min(1.6, 1 + 0.015×mph_against)`. (TUNE)
- `wind_mult` multiplies **time**, like every other multiplier, and is clamped to
  **[0.7, 1.6]**. A full tailwind is therefore the fastest the sky ever gets: 0.7× time,
  i.e. `base_kmh / 0.7` effective — which is the number the A* heuristic divides by (§4).
- **Gale rule:** sustained wind > 40 mph in a cell → each traversal rolls **garble** (§6.2) regardless of route.

## 3. Transmission time (message length matters)

- Before travel begins, the fire "transmits" the message puff-by-puff:
  `transmission_time = 3 s × ceil(chars / 4)` → 280 chars ≈ **3.5 min** of visible puffing at the origin. (TUNE)
- **`chars` means grapheme clusters**, here and everywhere else in this document
  (§5, §6.2). One emoji is one puff; so is one Devanagari cluster. Counting code
  units or code points would make the same message cost three times as long to
  transmit in Hindi as in English.
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
- **A "char" is a grapheme cluster** — what a reader would call a character, and what
  the counter in the compose screen shows. 280 emoji is a legal message; so is 280
  Devanagari syllables. The engine is the authoritative gate: it counts clusters and
  refuses at 281.
- The database stores a **4,000-character sanity bound** rather than 280, because
  Postgres counts code points and a legal 280-cluster message can be several times
  longer in those units — 280 family emoji are 1,960, and a heavily-combined script can
  go further. The bound is a guard against absurd payloads with room to spare, not a
  gameplay rule; the gameplay rule lives in `mechanics_config.message.char_cap`.

## 6. Failure & drama states

### 6.1 Stranded
- Trigger: next cell impassable (§4). No message loss from stranding itself for the first **24 h**.
- After 24 h continuously stranded: **5%/day dissipation roll** → `LOST`. (TUNE — keep rare; losing messages must be memorable, not routine.)

**A tended fire never dies.** Dissipation applies only to smoke stranded *out in the
weather* — `stranded_cell ≠ origin_cell`. A message that never managed to leave its own
fire waits indefinitely: someone is standing next to it, feeding it. Mechanically this
also removes the worst outcome in the game (a local storm eating a message before it ever
travelled); dramatically, it is the difference between smoke lost over Ohio and a fire
still burning in your back yard.

**Stranding is eventually consistent, and that is the intended feel.** Weather is fetched
lazily (§1), so against a storm line larger than the fetched corridor the router will
commit a route toward a gap it has not looked at yet, fly toward it, and strand on
approach when the next cell turns out to be closed. Smoke discovering the wall by
reaching it is more honest than an omniscient server refusing to let it leave — and it
is self-correcting: each replan cycle fetches more of the sky. Do not "fix" this by
pre-fetching the whole grid.

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

**C. Newark → Miami in light rain half the route**
- The great circle is ~1,750 km, but smoke follows the coast: the land-hugging corridor
  the ocean rule (§1.1) forces is **~1,965 km**, about 12% longer.
- Clear the whole way: 1,965 / 32 ≈ **61 h**. Light rain over half of it:
  (982/32) + (982/32 × 2.0) ≈ 31 + 61 ≈ **92 h (~3.8 days)**. Long-haul messages are
  multi-day events. Intended.

## 8. Numbers most likely to need beta tuning, in order

> **Estimating caveat:** great-circle arithmetic under-states real routes. The land mask
> (§1.1) forces coastal and border-adjacent traffic onto longer corridors, so long coastal
> routes run **~10–15% over** a straight-line estimate. Quote ETAs from the router, never
> from distance ÷ speed.

1. Base speed (`speed.base_kmh` = 32) — sets the entire feel.
2. Minimum delivery floor (10 min) & same-city times.
3. Garble probability/severity.
4. Replan cadence vs server cost.
5. Dissipation rate.

## 9. Server-cost envelope (sanity check)
- 1,000 in-flight messages, replan every 15 min = 96 k light A* runs/day — negligible CPU.
- Weather: ≤ 3,200 CONUS cells × 48 fetches/day absolute worst case ≈ 154 k NWS calls/day, but lazy fetching (active-route cells only) keeps realistic volume far below that — free API, jittered caching; if throttled, degrade TTL to 60 min. Open-ocean cells (§1.1) are never fetched at all.
- Push: ~4 pushes/message avg. All comfortably inside free/hobby tiers until real traction.
