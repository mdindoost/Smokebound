# SMOKE — the sky-scenario backlog

Ideas about what the weather could *do* to a message, held in one place so they
stop being remembered and start being reviewed.

An entry here is not a commitment. It is a claim that something would be
interesting, written down precisely enough to argue with.

**Format**

| field | meaning |
|---|---|
| **Scenario** | what a player would experience |
| **Mechanical effect** | what changes in the model — or explicitly *nothing* |
| **Data needed** | what we would have to fetch or compute that we do not already |
| **Status** | `idea` → `red-teamed` → `scheduled` |

**Status meanings.** `idea` is unreviewed and may be wrong. `red-teamed` has
survived an architect pass and has a ruling behind it. `scheduled` is going into
a named milestone. Nothing leaves this file except by graduating.

**The standing constraint.** Every scenario has to survive the same question:
*does it make the sky more legible, or only more complicated?* SMOKE's fairness
story is that every failure is weather-caused and inspectable on the map
(MECHANICS §6.3). A mechanic a player cannot see coming, or cannot see the cause
of afterwards, is a bug wearing a feature's clothes.

---

## The night chain

**Scenario.** After dark the drifting ember disappears and the route's towers
kindle in sequence — passed towers lit, the current one blazing, the rest dark
stone. The position of a signal at night is *which tower is burning*.

**Mechanical effect.** None. Purely how position is rendered.

**Data needed.** None beyond the sun model, which is closed-form.

**Status.** `scheduled` — shipped in M5.7 §1, ruled as DESIGN.md V11. Kept here
as the record of where it came from: device evidence at 3:29 AM of a fire
drifting across a map like a dot, which no restyling could fix because the idiom
was wrong, not the pixels.

---

## Tower voices

**Scenario.** The stations along a route speak into the sender's Ledger in the
first person: *"The Bloomsburg tower reports: signal sighted, passing north."*
*"Cloud between us and the Trenton light."*

**Mechanical effect.** None. Narration only.

**Data needed.** Weather *change* detection along the route — two observations at
two times, which is the one thing client-side arithmetic cannot do.

**Status.** `scheduled` — shipped in M5.7 §2. Throttled to one voice per
`narration.min_interval_hours`; sender-side by RLS, not by convention.

---

## Redirect narration

**Scenario.** A replan is told as a decision the stations made rather than a
state a server changed: *"Redirecting the fire along the ridge."*

**Mechanical effect.** None — it renames an existing `RESUMED` event.

**Data needed.** None.

**Status.** `scheduled` — shipped with M5.7 §2.

---

## Low ceiling at night joins the blinding set

**Scenario.** A low overcast deck at night blinds the chain even though it is not
fog and not raining. A player watching a clear-looking forecast sees their signal
crawl, and the Ledger explains it: the cloud base is below the ridge line.

**Mechanical effect.** `night.blinding_conditions` becomes a predicate rather
than a list — a cell is blinding if its condition is in the set **or** its cloud
ceiling is below a threshold. This is the first thing that would make the set
non-enumerable, which is exactly why it needs an argument before an
implementation.

**Data needed.** NWS ceiling / sky-cover, which the gridpoint product carries but
we do not currently parse. Adds a field to `weather_cells` and to the hourly
forecast rows.

**Status.** `idea`. The interesting question is whether it is *legible*: fog is
something a player can see on the radar, and a 900-foot ceiling is not. It may
need its own map affordance before it can be allowed to cost time.

---

## The dusk gambit

**Scenario.** On a short route, holding a message until dusk lands it
meaningfully sooner, and counsel says so. The player learns to send at nightfall
the way you learn to post before the last collection.

**Mechanical effect.** None new — it is the existing counsel (MECHANICS-V2 §5)
being *used*, on the routes where §2.3 showed the sun is actually worth
something.

**Data needed.** Hourly forecasts along the corridor, already specified.

**Status.** `red-teamed` — the mechanism is ruled (F37, F38) and shipped behind
`counsel.enabled`, which is off. What remains is a product question: does anyone
notice? That is a beta observation, not a design task.

---

## The fog siege

**Scenario.** Fog closes over a whole region for a day. Every link is blind, the
chain stops kindling, and messages queue behind the wall — visibly, on the map,
with their towers dark. When it lifts, a dozen signals move at once.

**Mechanical effect.** Nothing new is *needed*: blinding conditions already deny
the night bonus, and severe weather already strands. The scenario is a question
about whether the existing rules compose into something dramatic or just slow.

**Data needed.** None. It is a simulation study against recorded weather, not a
feature.

**Status.** `idea`. Worth running as an offline replay before anything is built —
if the existing rules already produce it, the correct amount of new mechanics is
zero.

---

## The gale run

**Scenario.** A corridor with a strong tailwind is the fastest way across the
country and the most likely to garble. The player chooses: fast and damaged, or
slow and intact.

**Mechanical effect.** None new — tailwind already speeds travel (MECHANICS §2.2)
and gales already roll garble (§6.2). What is missing is that the player cannot
*see* the trade before committing, so it is currently luck rather than a choice.

**Data needed.** None. It needs a preview affordance: the route summary would
have to name the gale risk it is accepting.

**Status.** `idea`. The strongest candidate in this file, because it turns an
existing mechanic into an actual decision — and because a mechanic the player
cannot see coming is the exact thing the standing constraint forbids.

---

## Hurricane × sober mode

**Scenario.** A named hurricane crosses the launch region. Large parts of the map
are impassable, many messages strand, and the app is being cute about weather
while people are being evacuated.

**Mechanical effect.** `severe_event_sober_mode`: on a qualifying NWS event,
flavour copy is suppressed in the affected region — no jokes about the sky
eating your message, no "the sky took this one" memorial — and stranding copy
becomes plain. The mechanics do not change; the voice does.

**Data needed.** NWS event *types* rather than just severity, to distinguish a
hurricane or tornado emergency from a routine severe-thunderstorm warning.

**Status.** `idea`, and the one with a deadline: it needs a ruling before any
public beta that spans a hurricane season, not after. Interacts with SPEC §2's
tone rules and with the cultural-respect rule (REDTEAM F7) — the same instinct
applies, which is that a joke landing on somebody's bad day is not a joke.

---

## Moonlight softens the night bonus

**Scenario.** A full moon makes a smoke column faintly readable after dark, so
the fire's advantage narrows. New moon, the fire wins outright.

**Mechanical effect.** `night.time_mult` becomes a function of lunar phase rather
than a constant — a small modulation, on the order of a few percent.

**Data needed.** Lunar phase, which is closed-form like the sun and needs no API.
Cloud cover would matter too, and that reopens the ceiling question above.

**Status.** `idea`, and honestly filed under *someday*. It is the most charming
thing in this document and the least legible: a player who notices their message
is 4% slower this week and correctly attributes it to the moon does not exist.
Worth building only if it can be *told* — a Ledger line, not a hidden
coefficient.

---

## Notes for whoever adds the next one

- Say what a **player experiences** first. If the entry starts with a config key,
  it is a change, not a scenario.
- Be explicit when the mechanical effect is **none**. Several of the best entries
  here are narration, and pretending otherwise inflates the model.
- If it needs data we do not fetch, say **which product** and what it costs under
  the F31 warming discipline. "We would need ceiling data" is an idea; "the
  gridpoint product already carries it, and it is one more column" is a plan.
- Answer the standing constraint. If a mechanic cannot be seen coming or
  explained afterwards, it makes the sky less legible, and this product's whole
  fairness story is legibility.
