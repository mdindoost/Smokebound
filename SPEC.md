# SMOKE — Product Specification v0.1

*A messenger that delivers texts by virtual smoke signal. Slower than pigeons. Weather is real. Sometimes the sky wins.*

**Status:** Draft for review · **Owner:** Mohammad · **Target:** iOS launch late Sept 2026, Android +3 weeks

---

## 1. One-line pitch

Your message travels across a live map as a smoke signal, routed around real storms using real weather data. Distance, message length, and the actual sky between you and your friend determine when — and whether — it arrives.

## 2. Positioning

- Direct genre-mate of Carrier Pidge / Roost / Pidgin ("slow social"), launched while the trend is hot.
- Differentiators (in priority order):
  1. **Real weather affects delivery** — not a dice roll; a storm over Pittsburgh actually delays NJ→Chicago.
  2. **Weather-aware routing** — smoke visibly bends around storms on a radar-overlaid map.
  3. **Message length matters** — longer messages take longer to "transmit" (puff-by-puff), pushing users toward terse, telegraphic writing.
  4. (v1.1) **Relays** — other users' locations speed your smoke; friends are infrastructure.
- Tone: parchment, ember, and sky. Self-aware pointlessness. We say "genuinely no practical use" before anyone else can.
- **Cultural design rule (binding):** smoke signaling is living heritage for Native American nations and others. Visual identity and copy draw on the *worldwide* history (Chinese beacon towers, Polybius' torch telegraph, Aboriginal and Native American practice) with an in-app history page crediting all of it. Never: feather/teepee iconography, faux-"Indian" naming, caricature copy. The historical research is a credibility asset — use it respectfully.

## 3. Feature cut list (non-negotiable boundaries)

### v1 (launch)
- Phone/Apple auth
- **Flock**: add friends by handle or invite link (friend request arrives as a drifting smoke wisp)
- **Compose & send**: text only, 280-char hard cap (see MECHANICS §5 for why)
- **Weather-routed delivery**: grid A* over live weather costs; route committed at send, replan-on-block (MECHANICS §4)
- **Flight view**: live map — smoke trail, planned route, precipitation radar overlay, ETA
- **Failure & drama states**: stranded-at-storm, garbled-by-wind, lost-to-the-sky (MECHANICS §6)
- **Push notifications**: sent / stranded / delivered / lost
- **Aviary → "The Ledger"**: conversation history, parchment-styled
- **Proximity flavor**: same/adjacent-cell sends get "you could just walk over" preview copy + "on foot: Y min" delivery footnote (MECHANICS §7.1)
- Launch region: full continental US (weather via free NWS API)
- **Safety (App Store 1.2 — required)**: block user, unfriend, report message, moderation contact on landing page
- **The Keeper**: system flock member one cell away; guarantees every new user a full send→track→deliver loop (~10–60 min) on day one
- Settings, privacy policy, coarse-location-only

### v1.1 (2–4 weeks post-launch — second press beat)
- **Relays / signal hills**: active users' cells discount routing; "a signal is passing through your territory" notification; tend-the-fire tap to boost
- **"Come to the fire"**: textless summons for nearby flock — "[handle] has lit a fire nearby. Come." + map pin; the campus/meetup mechanic (great for GSA/NJIT beta events)
- Android release

### v2 (only if traction)
- Transmission modes: Express (Morse-style, wind can corrupt characters) vs. Certified (Polybius-style, slow but robust)
- Public **signal fires** (broadcast visible to all users within radius)
- Pair-defined private signal codes ("three puffs means what we say it means")
- Premium fuels (colored smoke, dry cedar = speed) — monetization, cosmetic-first
- **International expansion**: paid global weather provider + ocean-crossing fiction (coastal beacons / ship carriers TBD); architecture is already global-ready (grid + lazy cache), gated on traction, not tech. Message bodies are Unicode (any language) from v1; UI is English-only until a market justifies localization.

### Explicitly cut forever (v1 scope guard)
Group chats, media attachments, read receipts, typing indicators, E2E encryption claims, precise/background location, web client.

## 4. Core user stories (v1)

1. As a sender, I write a short message, see the planned route and ETA *before* confirming, and send.
2. As a sender, I can open the flight view anytime and watch my smoke's position, the weather it's dodging, and its updated ETA.
3. As a sender, when a new storm blocks my smoke, I get a push ("Your signal is sheltering at the edge of a storm over Ohio") and can watch it wait.
4. As a recipient, I get nothing until the smoke arrives — then a push and the message, with a flight summary (distance, duration, storms survived).
5. As a user, if my smoke is lost, I see where and why it died, and can re-send with one tap ("light a new fire").

## 5. Platform decision (locked)

- **React Native + Expo (TypeScript)**, single codebase.
- iOS first (trend audience + press precedent), Android at v1.1.
- Builds via EAS (no local Mac required). Maps: react-native-maps + NWS radar tile overlay.

## 6. Screenshot-able moments (marketing is a design requirement)

Every one of these must look good enough to post:
1. Smoke trail arcing around a green radar blob.
2. "Sheltering from a thunderstorm over Ohio — 6h 12m stranded."
3. A garbled delivered message ("HEEP! THE CAR BROKE DOWN") with wind-damage note.
4. The lost-smoke memorial screen ("The sky took this one. 412 miles from home.")
5. Pre-send route preview: "Southern route via Virginia — avoiding a storm system over Pittsburgh. ETA 9:40 PM."

## 7. Success criteria & tripwires

- Beta: ≥60% of testers send a message on 3+ separate days in week one; delivery-time complaints ≤ "it's part of the joke" threshold (tune MECHANICS numbers otherwise).
- Kill/pause tripwire: if implementation exceeds 5 weeks or starts displacing thesis deadlines (ANS revisions), freeze at whatever milestone is complete and ship that or shelve.

## 8. Privacy & store-review posture

- Coarse location, foreground-only, at send/registration time; declared in App Store privacy labels.
- Messages stored server-side (not E2E) — say so plainly in policy.
- Guideline 4.2 defense: live routing, real weather integration, custom map experience = demonstrably more than "minimum functionality."

## 9. Open questions (to resolve in red-team)

- GPS spoofing: does teleporting yourself matter? (Probably harmless-fun; decide.) → **Closed** (REDTEAM F9): unmitigated in v1.
- Home-location vs live-location for routing endpoints (privacy vs realism). → **Closed** (REDTEAM F6): manual-refresh `home_cell`, never live location.
- What happens when recipient has no location set (never opened app after invite)? → **Closed:** it cannot happen. `home_cell` is set during onboarding, before a flock request can be accepted, and a message can only be sent to *accepted* flock. Every recipient therefore has a cell by construction; the schema enforces it (`profiles.home_cell NOT NULL`). A stale cell is fine — the registration cell is the documented fallback (MECHANICS §4).
- Server cost ceiling before monetization exists. → **Closed** (REDTEAM F9, MECHANICS §9): inside hobby tiers; Supabase Pro ($25/mo) is the pressure valve.
