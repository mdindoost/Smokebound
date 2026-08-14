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

## Verdict
No unresolved severe findings. F1 and F5 were the two that would have materially hurt launch; both are now v1 scope. Design is cleared for Phase 3 (implementation).
