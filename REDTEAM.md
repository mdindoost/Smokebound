# SMOKE — Red-Team Review v1.0 (Phase 2)

Adversarial pass over SPEC.md / MECHANICS.md / ARCHITECTURE.md. Each finding: severity, attack, resolution, and where it was patched.

---

## F1 — App Store rejection: missing block/report (SEVERE, would fail review)
**Attack:** SMOKE is a user-generated-content app. Apple guideline 1.2 requires UGC apps to have: a mechanism to report offensive content, a mechanism to block abusive users, and published contact info for moderation. We had none. This is a hard rejection, not a maybe.
**Resolution:** Block user + report message + unfriend are now **v1 requirements** (SPEC §3), `blocks` table + report flow added (ARCHITECTURE §3, §8). Moderation contact goes on the landing page.

## F2 — Summer thunderstorms would break the game (HIGH, gameplay)
**Attack:** MECHANICS made every thunderstorm cell impassable. It's August: mesoscale convective systems routinely wall off multi-state regions daily. Result: most cross-country messages strand repeatedly, many exceed 24 h stranded, dissipation losses become routine. Losing messages must be memorable, not Tuesday.
**Resolution:** Split severity — ordinary thunderstorm = 6.0× slowdown (slow, dramatic, passable); **impassable only when an NWS severe warning/watch is active** for the cell. Storms stay scary, the Midwest stays traversable. (MECHANICS §2.1 patched.)

## F3 — A* heuristic is inadmissible under tailwind (MEDIUM, correctness)
**Attack:** Heuristic was `great_circle / base_speed`, but tailwind allows effective speed up to `base / 0.7` — so the heuristic can overestimate remaining cost, breaking A* optimality (suboptimal routes shown as "the" route).
**Resolution:** Heuristic divides by the max possible speed: `great_circle / (base_speed / 0.7)`. Admissible again. (ARCHITECTURE §6.2 patched.)

## F4 — NWS API flakiness could strand the whole network (HIGH, availability)
**Attack:** api.weather.gov throws 500s and slow responses regularly. If missing weather blocks routing (fail-closed), an NWS outage strands every in-flight message simultaneously — a systemwide event caused by our dependency, not the sky.
**Resolution:** **Fail-open**: stale-beyond-TTL or unfetchable cells are treated as clear (1.0×) and flagged `weather_unknown`; never strand on missing data, only on confirmed severe weather. Serve stale aggressively on 429/5xx. (MECHANICS §1, ARCHITECTURE §6.1 patched.)

## F5 — The first-session dead-air problem (HIGH, retention)
**Attack:** New user installs, adds one friend in another state, sends… and nothing happens for 36 hours. First session ends with zero payoff; day-one churn. Carrier Pidge survives this because cross-town delivery is seconds; our 10-min floor helps only if your friend is nearby.
**Resolution:** **The Keeper** — a system flock member whose fire is always 1 cell away. Onboarding prompts your first message to The Keeper (delivery ≈ 10–60 min) and it replies with era-appropriate flavor. Every user gets a full send→track→deliver loop on day one regardless of where their friends live. (SPEC §3 v1, ARCHITECTURE §7 patched.) Beta must still validate the long-haul feel (MECHANICS §8 tuning order unchanged).

## F6 — Recipient location inference (MEDIUM, privacy — accepted with mitigations)
**Attack:** The route preview reveals the recipient's ~50 km cell to any accepted flock member; "move your fire" updates could let a hostile "friend" coarsely track relocation.
**Resolution (accept + mitigate):** Friends-only by design; endpoint is manual-refresh `home_cell` (never live location); privacy policy states plainly that flock members can see your approximate (city-scale) area — that IS the product. "Come to the fire" (v1.1) will require per-use confirmation before sharing a meet pin. Revisit hard if public signal fires (v2) ship.

## F7 — Cultural respect risk (MEDIUM, reputational)
**Attack:** Smoke signals are living heritage for Native American nations (and others). A joke app that leans on Hollywood-Indian iconography invites a justified backlash story instead of a fun-trend story.
**Resolution:** Explicit design rule (SPEC §2 note): visual identity draws on parchment/ember/sky and the *worldwide* history — Chinese beacon towers, Polybius' torches, Aboriginal and Native American practice — with a respectful "history" page in-app crediting all of it. No feathers, no teepees, no faux-"Indian" naming or broken-English copy anywhere, ever. The research we did becomes the credibility asset.

## F8 — Name clearance (LOW, logistics)
"SMOKE" as an app name: crowded namespace, likely App Store collisions and weak trademark position. Action item (pre-M6): pick launch name + check App Store search, USPTO TESS, domain. Candidates to test: Smoke Signal, Signal Fire, Beacon, Puff. Working title stays SMOKE in docs.

## F9 — Cost/scale spot-checks (LOW, verified fine)
- Supabase free tier realtime caps ~200 concurrent — a viral spike exceeds it. Client already needs a polling fallback for reliability; upgrade to Pro ($25/mo) is the pressure valve. Acceptable.
- Push volume, A* CPU, weather calls: all inside hobby tiers (MECHANICS §9). No blockers.
- GPS spoofing (teleporting your fire): harmless in a friends-only app; consciously unmitigated in v1 (SPEC §9 closed).

## F10 — Invite friction (accepted)
Flock-only messaging means: invite → install → accept → send. Three steps before first real message. Accepted for v1 (The Keeper covers the gap; queued-sends-to-pending adds abuse surface for marginal gain). Revisit if beta shows invite drop-off.

---

# Addendum — M1 architect review (rulings)

Findings raised while implementing M1, ruled on and patched into the docs.

## F11 — Multipliers were applied to speed, not time (SEVERE, correctness)
**Attack:** MECHANICS §2 said `effective speed = base × weather_mult × wind_mult` and ARCHITECTURE §6.2 repeated `hours = cell_km / (base × mult)`. Read literally, a thunderstorm (6.0) makes smoke **six times faster** and a headwind speeds it up. The §7C worked example (light rain doubling the hours) contradicts both.
**Resolution:** The multipliers are **time multipliers**, always: `hours = (cell_km / speed.base_kmh) × weather_mult × wind_mult`, `wind_mult ∈ [0.7, 1.6]`. The "effective speed = base × mult" phrasing is deleted everywhere. The heuristic stays `great_circle_km × 0.7 / speed.base_kmh` and is admissible under this reading. (MECHANICS §2, §2.2, §4; ARCHITECTURE §6.2 patched.)

## F12 — Two base speeds (MEDIUM, correctness)
**Attack:** "20 mph (32 km/h)" gives two different numbers (20 mph = 32.19 km/h); code could compute from either and drift.
**Resolution:** `speed.base_kmh = 32` is **canonical** — all computation is metric. "20 mph" is UI flavor copy; `speed.base_mph` is deprecated and read only by display strings. (MECHANICS §2, §8 patched.)

## F13 — Fail-open turns the ocean into a highway (HIGH, gameplay)
**Attack:** Unfetched ocean cells fail open to clear (1.0×), so the Atlantic and Gulf become the cheapest terrain in the graph. A* would route Newark→Miami offshore around every storm, and coastal messages would sail rather than travel — the exact opposite of "smoke can't cross the sea."
**Resolution:** A static per-cell `is_land` mask generated at build time from Natural Earth land polygons, committed as generated data in `packages/shared`. Traversable = land OR 8-adjacent to land; open ocean is impassable *always*, never fetched, never fail-opened. (MECHANICS §1.1 added; ARCHITECTURE §5, §6.1, §6.2 patched.)

## F14 — The send/preview contract was a note-to-self (LOW, clarity)
**Attack:** ARCHITECTURE §6.4 contained an unresolved thought ("computes route preview? No —") where the API contract should be.
**Resolution:** `POST /preview` returns `{route, eta, storms_avoided, preview_token}` with a 10-minute token; `POST /send` takes the token, recomputes if the weather moved, and warns when the ETA shifted by more than 20%. (ARCHITECTURE §6.4 patched.)

## F15 — Grid geometry was under-specified (LOW, correctness)
**Attack:** "Equirectangular 50 km grid" left uniform-vs-per-row spacing open, and the example id `r041c112` does not exist in any 50 km CONUS grid (there are only 106 columns).
**Resolution:** Uniform equirectangular, locked at 57 × 106; real example ids (`r037c090` Newark, `r039c066` Chicago); cell ids are persisted identifiers and re-gridding is a data migration. (ARCHITECTURE §3, §5 patched.)

---

# Addendum — M2 architect review (rulings)

## F16 — Foreign land is the ocean hole again (HIGH, gameplay)
**Attack:** The land mask closed the water hole but not the border. Natural Earth "land" includes Canada and Mexico, where NWS has no data, so every foreign cell fails open to permanently clear — a free highway around any storm. Detroit→Buffalo would route through Ontario; northern-tier traffic would drift into Canada whenever the weather turned.
**Resolution:** Add an `is_us` mask layer (Natural Earth admin-0, United States), rasterised identically, with border cells decided by **majority sample**. Traversable = `(is_us OR 8-adjacent to US land) AND NOT foreign_land`; non-US land is impassable in v1. This is a launch-region rule tied to our US-only weather source and reopens with international expansion. In-app copy: *"Your smoke cannot cross the border."* (MECHANICS §1.1, ARCHITECTURE §5 patched.)

## F17 — NO_ROUTE was a send failure (MEDIUM, product)
**Attack:** A walled-off sky or a recipient sitting under a severe warning made `/send` fail. The user experience of "the storm is too big" became an error dialog — the one moment the product's whole premise is on screen, rendered as a bug.
**Resolution:** The message is **always** created. `NO_ROUTE` at send means the message transmits and then strands at its origin cell (`TRANSMITTING → STRANDED`), and the replan cron retries it every cycle like any other stranded message. `NO_ROUTE` is never an API failure. (ARCHITECTURE §4 patched.)

## F18 — Preview priced routes on guesses (MEDIUM, correctness)
**Attack:** Fail-open prices unfetched cells as clear, which makes unknown terrain *attractive* to A*. A preview could therefore route confidently through cells nobody had ever looked at, quote an ETA from that, and commit it.
**Resolution:** `/preview` fetches the weather for every unknown cell on its candidate route and re-routes **once** before returning. A committed route is never priced on fail-open guesses. Mid-flight replanning is unchanged: there, availability beats precision (F4). (ARCHITECTURE §6.4 patched.)

## F19 — Silent heuristic breakage, and per-cell alert fetches (LOW, correctness + cost)
**Attack:** `routing.heuristic_max_speed_factor` is a config value; tune it — or the wind floor — the wrong way and A* stops being optimal with no symptom except quietly worse routes. Separately, fetching alerts per cell multiplied NWS traffic by the corridor length for no extra information.
**Resolution:** The engine asserts at boot that the heuristic factor is ≤ the smallest achievable time multiplier from config, and **fails to start** otherwise. Alerts are fetched in bulk per pass and matched to cells locally. (ARCHITECTURE §6.1, §6.2 patched.)

---

# Addendum — M3 architect review (rulings)

## F20 — The 280 cap was defined in two incompatible units (MEDIUM, correctness)
**Attack:** MECHANICS §5 says "280 characters" and §6.2 makes grapheme clusters the unit; the schema said `char_length(body) <= 280`, which counts code points. 280 family emoji are 280 characters to a reader and 1,960 to Postgres, so a legal message could be rejected by a constraint — and the same sentence cost three times as much "length" in Hindi as in English.
**Resolution:** **Grapheme clusters are canonical everywhere user-facing** — validation, the compose counter, transmission time, and garble. The schema bound is raised to **2,000** as a sanity guard on absurd payloads, and the **engine is the authoritative 280-grapheme gate**. (MECHANICS §3, §5; ARCHITECTURE §3, §7 patched; migration `20260814150500_body_sanity_bound.sql`.)

## F21 — Stranding is eventually consistent against unbounded storms (LOW, accepted as intended)
**Attack:** Weather is fetched lazily, so a storm line larger than the fetched corridor lets the router commit toward a gap it has not looked at. The message flies at the wall and strands on approach rather than being held back at once.
**Resolution:** **Intended behaviour, documented rather than fixed.** Smoke discovering a wall by reaching it is more honest than an omniscient server, and each replan cycle fetches more sky, so it is self-correcting. The fix that would remove it — pre-fetching the whole grid every plan — trades the entire lazy-fetch design for a cosmetic gain. (MECHANICS §6.1 patched.)

## F22 — Origin-stranded messages could be eaten by dissipation (MEDIUM, product)
**Attack:** A local storm over the sender's own cell strands the message at home; 24 hours later it starts rolling for loss. The worst outcome in the game — a message destroyed before it ever travelled — was reachable without the smoke going anywhere.
**Resolution:** **A tended fire never dies.** Dissipation applies only when `stranded_cell ≠ origin_cell`; origin-stranded messages wait indefinitely for the sky to open. Someone is standing next to that fire, feeding it. (MECHANICS §6.1, ARCHITECTURE §4, §6.3 patched.)

## F23 — An alerts outage silently un-walls the sky (LOW, observability)
**Attack:** If the alerts endpoint is unreachable past the stale window the engine assumes no alerts, so nothing is impassable and no message strands — correct under fail-open (F4), but invisible.
**Resolution:** Fail-open stays. The engine records **alert staleness** — the age of the newest usable alert list — as a metric surfaced in the nightly report. Silent un-walling is the thing to avoid; visible un-walling is acceptable. (ARCHITECTURE §6.1 patched.)

---

# Addendum — M4 architect review (rulings)

## F24 — Apple sign-in is out of v1 scope (LOW, scope)
**Attack:** SPEC §3 listed "Phone/Apple auth", but Apple sign-in needs an entitlement, a paid developer account and its own review surface — and Apple only *requires* it where other social logins are offered, which SMOKE does not offer. Half-building it costs M6 time for nothing.
**Resolution:** **Phone OTP only in v1.** Apple sign-in is cut from scope and revisited if a second sign-in method ever justifies it. (SPEC §3 patched.)

## F25 — The storage bound had no headroom (LOW, correctness)
**Attack:** The 2,000-code-point sanity bound left 40 characters of margin over a legal 280-family-emoji message (1,960 code points). A body of 280 heavily-combined clusters would be refused despite obeying the cap.
**Resolution:** Bound raised to **4,000** by migration. Still a guard against absurd payloads, now with room for any legal message. The gameplay cap remains 280 grapheme clusters in `mechanics_config`. (MECHANICS §5, ARCHITECTURE §3 patched.)

## F26 — Relays will break the heuristic on the day they ship (MEDIUM, correctness)
**Attack:** The v1.1 Tower model gives human "signal hills" `relay.tend_mult` = 0.1, which drops the smallest achievable time multiplier from 0.7 to 0.07. The boot guard (F19) would refuse to start — correctly — but only *after* the relay mechanic was written, at the worst possible moment.
**Resolution:** Stated as a rule now: `routing.heuristic_max_speed_factor` must equal the product of every multiplier floor the router can apply, and the factor change ships **in the same release** as the relay mechanic. (ARCHITECTURE §6.2 patched.)

## F27 — One cron pass makes one transition (LOW, documentation)
**Attack:** delivery-check reads a batch and then mutates it, so a message promoted to IN_FLIGHT in a pass is never also advanced or delivered in that pass. Invisible at a one-minute cadence, confusing in a time-travelling test, and exactly the kind of thing a future contributor "fixes" into a re-entrancy bug.
**Resolution:** Documented as intended: one pass, one transition, reasoning about a stable snapshot. Tests tick twice per step. (ARCHITECTURE §6.3 patched.)

---

# Addendum — visual identity rulings (V1–V4)

Recorded in full in [DESIGN.md](DESIGN.md); listed here so the design decisions live
alongside the ones they constrain.

- **V1 — Sky-panel model.** The map is a dark panel inset in a parchment app, not a dark
  theme. Deep-sky tokens are a sub-palette; the chrome stays parchment.
- **V2 — Contained weather family.** Radar keeps its own hues but enters the system
  desaturated and under a fixed opacity ceiling, so weather never out-shouts ember.
- **V3 — Bundled serif.** One serif ships with the app rather than borrowing a platform
  face, so screenshots are identical everywhere.
- **V4 — Elegiac state semantics.** Sheltering is calm storm-grey, lost is ash. Drama
  comes from the map and the copy, never from an alarm colour.

## F28 — The preview contract could not survive a cold cache (HIGH, correctness + UX)
**Attack:** F18 made `/preview` resolve every unknown cell on its candidate route before quoting. Measured on hardware, the first cross-country send (New Jersey → Colorado, 60-cell route) fetched the *padded bounding corridor* — 347 traversable cells at 0.94 cells/sec — and was still working ten minutes later against a 45-second client timeout. Every route beyond a neighbouring cell exceeded the timeout on a cold cache; the Keeper worked only because two cells cost nothing. The implementation also ran up to five resolution rounds where F18 authorised one.
**Resolution:** One round was the ruling and five was a bug, but **F29 supersedes the mechanism**. `/preview` now fetches only the candidate route's **own cells** — no bounding box, no padding — under a hard **10-second budget**; whatever is still unknown when the budget expires is priced per F29 and the preview returns. The corridor-padding prefetch moves to the warming cron (F31) and to replan passes, where latency is nobody's wait. (ARCHITECTURE §6.4, MECHANICS §1 patched.)

## F29 — Unknown terrain was *attractive*, not merely unpriced (HIGH, correctness — root cause)
**Attack:** `weather.unknown_time_mult = 1.0` did two unrelated jobs. It was written for F4 — never strand on missing data — but it also made never-fetched cells the **cheapest terrain in the graph**, so A\* actively sought out sky nobody had looked at. F18's expensive prefetch existed only to compensate for this. Nobody had ever ruled that the unexplored should be preferred; it fell out of a rule written for a different purpose.
**Resolution:** Split into two keys. `weather.unknown_time_mult` **stays 1.0** and keeps its F4 meaning — stranding semantics: unknown is never impassable and never strands. A new `routing.unknown_cost_mult = 1.15` applies **in edge costs only**, so unexplored terrain prices like overcast and A\* stops treating it as a highway. F19's boot guard still holds: the heuristic is keyed to the *smallest* achievable multiplier, and raising a middle value is always safe. This is the root-cause fix and it is what allows F28 to stop paying for the corridor. (MECHANICS §2.1, ARCHITECTURE §6.2 patched.)

## F30 — A signal fire does not make appointments (MEDIUM, product + honesty)
**Attack:** `/preview` promised a precise arrival time, which is what forced it to block on weather it did not have. The precision was also a fiction: an ETA reading "arrives 1:53 AM" for a medium that takes two days across a continent claims an accuracy no forecast supports.
**Resolution:** The preview quotes a **band** — "about four hours", "roughly two days", "sometime Tuesday night" — its width scaling with route length and the fraction of the route still unknown, computed **without blocking**. The precise ETA lives in the flight view once the corridor resolves, refined by the replan cron exactly as before. Push timing is unchanged: the server always knows the exact moment. Band phrasing uses the Ledger voice. (SPEC §6.4 and the compose preview copy patched.)

## F31 — Weather warming: yes, prioritised, bounded (MEDIUM, cost + latency)
**Attack:** Weather was fetched lazily, per corridor, synchronously, while a user waited — there was no warming cron at all. But a naive fix is worse: a full-grid sweep is 3,444 traversable cells, ~61 minutes at measured throughput, against a 30-minute TTL. It would finish each lap with half the grid already stale, burning NWS quota forever and never delivering a warm cache.
**Resolution:** A warming cron, **never a full-grid sweep**, in priority order: (1) cells on active flight routes, +1 cell padding; (2) home cells of users active in the last 7 days, and the corridors between flock pairs with recent traffic. Interval and per-priority cell budgets live in `mechanics_config` like every other number. Existing NWS backoff and serve-stale (F4) are respected. Fetch concurrency raised 4 → 12: operational only, it changes no outcome, merely how fast we learn the sky. The preview-failure copy is corrected — it claimed "your signal may still be lit", which is true after a send and false after a preview, where nothing was lit and the Ledger is empty. (ARCHITECTURE §6.1 patched.)

---

## Verdict
No unresolved severe findings. F1 and F5 were the two that would have materially hurt launch; both are now v1 scope. Design is cleared for Phase 3 (implementation).

F28–F31 were found by running v1 on a physical device against the live NWS API — a class of failure no test in the suite could reach, because every test ran against a warm or simulated cache. F29 is the one worth remembering: a value written to satisfy one rule (never strand) had quietly acquired a second, unruled meaning (prefer the unexplored), and an expensive mechanism had been built to compensate for a bug nobody had named.
