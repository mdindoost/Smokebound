# SMOKEBOUND — Beta Plan v1.0

Owner: Mohammad · Architect: Claude · Written during M3 (Aug 14, 2026)
Companion docs: SPEC.md (success criteria §7), MECHANICS.md (§8 tuning order)

---

## 1. Purpose — what the beta must answer

The beta exists to answer five questions, in priority order. Everything in this plan serves one of them.

1. **Does the wait feel like anticipation or abandonment?** (The 20 mph question — MECHANICS §8 item 1.) This decides the product.
2. **Does the first session land?** Does The Keeper loop (send→track→deliver in ~10–60 min) actually hook people, or do they close the app before first delivery?
3. **Do people come back to *watch*?** Flight-view opens per in-flight message is the retention signal — the map is the product between deliveries.
4. **Does delivery infrastructure hold?** Push reliability, home-server uptime, cron correctness over real days with real weather.
5. **Is the drama firing?** Real strandings, garbles, reroutes — do they happen often enough to be seen, rarely enough to stay special?

Non-goals: growth, press, monetization signals, Android. Do not recruit beyond plan; a leaked TestFlight link before launch burns the press angle.

## 2. Shape: two waves, three weeks

### Wave 1 — "The Fire Keepers" (5–8 people, week 1)
Lab mates, close friends, 1–2 people in *other cities/states* (non-negotiable — we need real long-haul flights; an all-Newark beta never tests a stranding). Purpose: catch crashes, broken flows, dead pushes, server faults. High tolerance, direct-line feedback.

### Wave 2 — "The Flock" (25–35 people, weeks 2–3)
GSA network. Two required sub-groups:
- **Campus-dense cluster (15–20 at NJIT):** validates same-cell/proximity flavor, the 10-min floor feel, and social spread inside one cell.
- **Distance pairs (8–12):** grad students with partners/family/friends in other states — Chicago, Texas, California, Florida. Each distance pair is one guaranteed multi-hour or multi-day flight through real weather. Recruit for the *pair*, not the person: the ask is "you AND someone far away."

Ethics note: this is a product beta, not human-subjects research — no IRB needed. Keep it clean anyway: recruit personally, never via any GSA official channel or listserv in your VP capacity (no implied academic pressure, no blurring of the role); frame as "my side project, totally optional."

## 3. Timeline (keyed to milestones, not dates)

| Gate | Action |
|---|---|
| M3 done | Send Wave-1 invites ("it's coming, you're first") — warm the pool now |
| M4 done | Internal dogfood: you + 1, two devices, one full real-time NJ↔somewhere flight before anyone else touches it |
| M6 done + TestFlight approved | Wave 1 in. **48-h hold** — fix anything on fire |
| Wave 1 stable 5 days | Wave 2 in. Tuning window opens (server-config changes only — that's why mechanics_config exists) |
| Wave 2 week 2 ends | Go/no-go review against §6 criteria → launch prep or one more tuning week |

Calendar sketch if M3–M6 hold pace: TestFlight ~Sept 8–12, Wave 2 mid-Sept, go/no-go ~Sept 25, launch end of Sept. One slack week absorbed before the trend-window tripwire (SPEC §7) fires.

## 4. Instrumentation (build into M6, not after)

Decisions come from the `events` table plus a thin analytics layer — no third-party SDK in v1 (privacy posture + review simplicity). Log per user: activation funnel (install → onboard → Keeper send → Keeper delivered → first real send), flight-view opens per in-flight message, session count on days 1/3/7, re-send after LOST. Log per message: route length, planned vs actual duration, strand count/duration, garble events, terminal state. One nightly SQL report ("The Ledger Report") — Claude Code writes it as an M6 task; it runs on the home server and delivers to Mohammad directly (email/terminal — WhatsApp has no clean webhook path); he forwards a daily "yesterday's sky" digest to The Aviary manually.

Weather luck check: if week 1 is meteorologically boring (no strandings anywhere), enable a config-flagged **synthetic storm** ("The Tempest") for 24 h so drama paths get exercised — clearly labeled in-app as a drill, then disabled. Never fake weather silently.

## 5. Feedback channels

- **WhatsApp Community "The Aviary"** (owner's call — the GSA crowd lives on WhatsApp), two linked groups: **#the-sky** (delightful/confusing/boring — vibes and screenshots, soft prefix convention ✨/❓/😴) and **#broken** (bugs only, never drowned by chatter). Two groups, not four: WhatsApp groups need critical mass. Which group people post in — and the prefixes — is the survey.
- **Day-3 and day-10 micro-surveys** (Google Form, 5 questions, 90 seconds): the two that matter — *"When you were waiting for a delivery, did it feel exciting or annoying?"* and *"Show this app to a friend: what's the first sentence you'd say?"* (The second harvests launch copy verbatim.)
- **One 20-min call each with 3 Wave-2 users** (one campus, one distance-pair, one low-engagement) in week 3. The low-engagement interview is the most valuable one.

## 6. Go/no-go criteria (from SPEC §7, made measurable)

**Green (launch):** ≥60% of Wave 2 send on 3+ separate days in their first week; ≥70% Keeper-loop completion; ≥1 flight-view open per in-flight message per day median; at least 3 organic "delightful" posts featuring a stranding/garble/reroute; zero delivery-correctness bugs (wrong time, wrong body, lost-without-cause) in final 7 days; home-server uptime ≥99% over the window.
**Tune-and-extend (one week, once):** wait-feel splits negative → drop base time via config (raise speed / lower floors) and re-measure. Config-only changes; no client resubmission.
**Kill/pause tripwire (unchanged from SPEC §7):** implementation bleeding past 5 weeks of build time or displacing ANS revisions → freeze and shelve without shame; the docs make it resumable.

## 7. Beta comms (ready to send)

**Wave-1 invite (text/DM):** "I built a messenger where your texts travel as smoke signals across a live weather map — a storm over Pennsylvania literally delays your message. It's intentionally the slowest messenger ever made. I need 6 people to break it before anyone else sees it. In?"

**Wave-2 distance-pair ask:** "It only gets good if you have someone far away. Who do you text in another state? Both of you get in."

**TestFlight welcome note (in the build):** "Welcome, Fire Keeper. Rules of the sky: messages are slow on purpose; storms are real; sometimes the wind eats a word. Your first signal goes to The Keeper — watch it fly. Report anything broken in The Aviary. — M."

## 8. Risks specific to the beta

- **Home-server outage during a live beta** makes every flight freeze visibly. Mitigation: systemd auto-restart + a dead-man's-switch that emails/texts Mohammad if crons miss 2 cycles — you find out before the testers do.
- **September weather is a character in this test.** Early fall = fewer severe warnings than August. The Tempest drill (§4) is the hedge; also seed at least one Gulf-coast distance pair — that's where September drama lives (and yes, if a real hurricane enters the map, delivery delays are handled with plain, non-jokey copy; the app must never be glib about a real disaster — add one config flag: `severe_event_sober_mode` swaps flavor text to neutral).
- **Small-n overfitting:** 35 grad students are not the App Store population. Tuning direction (faster/slower) transfers; exact numbers get one more look at launch +2 weeks.
