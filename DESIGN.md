# SMOKE — Design System v1.0

*Parchment, ember, and sky.*

**Owner:** Mohammad · **Written during M5** · Companion to SPEC.md (§2 tone and the binding
cultural rule), ARCHITECTURE.md (§7 screens), REDTEAM.md (V1–V4 rulings).

This document is for whoever touches the interface next. It says what the system is, what
was decided and why, and which decisions are closed.

---

## 0. The binding rule, first

SPEC §2, unchanged and non-negotiable:

> Smoke signaling is living heritage for Native American nations and others. Visual
> identity and copy draw on the *worldwide* history — Chinese beacon towers, Polybius'
> torch telegraph, Aboriginal and Native American practice — with an in-app history page
> crediting all of it. **Never:** feather/teepee iconography, faux-"Indian" naming,
> caricature copy.

In practice that means the identity is built from **material and light** — parchment,
ash, ember, distance, weather — and never from the iconography of a people. A beacon
tower mark is a tower: a squat trapezoid with a light on top, the same shape that ran the
length of the Great Wall and the same shape Polybius' torch crews stood on. If a symbol
could be read as belonging to one culture rather than to the shared human habit of
talking with fire, it does not ship.

---

## 1. The palette

Three families, and nothing else.

**Parchment** is the ground everything is written on. **Ember** is fire, and the only
colour allowed to raise its voice — if two things on a screen are ember, one of them is
wrong. **Sky** is distance, weather and time.

| Role | Token | Value |
|---|---|---|
| Ground | `parchment` | `#F5EADA` |
| Raised surface | `parchmentRaised` | `#FBF4E9` |
| Sunk surface | `parchmentSunk` | `#EADCC6` |
| Hairline | `parchmentEdge` | `#DCC9AC` |
| Ink | `ink` / `inkSoft` / `inkFaint` | `#2B211A` / `#5A4B3E` / `#8C7A69` |
| Fire | `ember` / `emberBright` / `emberGlow` / `emberDim` | `#C2521C` / `#E2802F` / `#F6C88A` / `#8E3A12` |
| Distance | `sky` / `skyPale` / `skyDeep` | `#4E7593` / `#B7CBDC` / `#2F4657` |
| Weather | `storm` | `#5D6873` |
| Elegy | `ash` | `#7C7269` |
| Growth | `moss` | `#5E7A54` |

Screens never write a hex. They use the semantic layer (`colors.background`,
`colors.accent`, `colors.distance`, …) in `apps/mobile/src/design/tokens.ts`, which is
where a repaint happens.

### V1 — The sky panel (ruled)

**The map is a dark panel inset in a parchment app. It is not a dark theme.**

A night sky needs darkness to read; parchment needs light. Rather than fight, the map is
treated as a lit window: deep-sky tokens (`skyPanel*`) are a **sub-palette** used inside
the map surface only, and the chrome around it — headers, cards, buttons, the Ledger —
stays parchment.

The sub-palette is structured so a future full dark mode is a swap of the *semantic*
layer rather than a rewrite: every deep-sky token has a parchment counterpart by role
(`ground`, `raised`, `line`, `text`, `textFaint`).

| Role | Sky-panel token | Value |
|---|---|---|
| Panel ground | `skyPanelGround` | `#131A21` |
| Panel raised | `skyPanelRaised` | `#1D2831` |
| Panel line | `skyPanelLine` | `#2C3B47` |
| Panel text | `skyPanelText` | `#E8E1D4` |
| Panel faint text | `skyPanelFaint` | `#8FA0AE` |
| Land inside the panel | `skyPanelLand` | `#1A232B` |
| Water inside the panel | `skyPanelWater` | `#0E141A` |

### V2 — Weather is a contained family (ruled)

Radar imagery arrives with its own hues — greens, yellows, reds — and would happily
out-shout ember. The ruling: **weather keeps its own colours, but enters the system
desaturated and under a fixed opacity ceiling.**

- Radar tiles render at **0.55 opacity** over the dark panel, never above it.
- Nothing else on the map may use radar's hues. Route lines are ember, storms the router
  avoided are `storm`, unknown weather is a dotted `skyPanelFaint`.
- The single loudest thing on any screen remains the smoke itself.

### V4 — State semantics stay elegiac (ruled)

| State | Colour | Reading |
|---|---|---|
| Transmitting | `emberBright` | the fire is working |
| In flight | `sky` | distance |
| Sheltering | `storm` | calm, patient, grey — *not* an alarm |
| Arrived | `moss` | quiet good news |
| Lost | `ash` | elegy |

A stranded message is not an error. The drama comes from the map (smoke visibly waiting
at a storm edge) and the copy ("sheltering at the edge of a storm over Ohio"), never from
a red badge. The loss screen is a memorial, not a failure dialog.

---

## 2. Type

### V3 — One bundled serif (ruled)

The app ships **EB Garamond** (400/600) rather than borrowing a platform face, so a
screenshot taken on an iPhone and one taken on a Pixel are the same image. Marketing is a
design requirement (SPEC §6); platform-dependent type undermines it.

| Face | Use |
|---|---|
| Serif (EB Garamond, bundled) | Display, titles, thread bodies, the Keeper's lines — anything that wants to feel written down |
| System sans | Interface furniture: buttons, fields, labels, captions |
| System mono | Flight data: distances, ETAs, cell ids |

Scale, in `tokens.ts`: `display` 30/36, `title` 22/28, `heading` 17/22, `body` 16/23,
`small` 14/19, `caption` 12/16 (uppercase, tracked).

Subsetting is a build step, documented in `apps/mobile/assets/fonts/README.md`. The full
Latin face is ~200 KB per weight; a Latin-1 subset is under 60 KB.

---

## 3. Components

`apps/mobile/src/design/components.tsx` is the whole set. Screens are assembled from it
and add no styling of their own beyond layout.

- **Screen** — parchment ground, standard padding and gap.
- **Card** — raised parchment, hairline border, soft low shadow. Parchment does not float.
- **Button** — `primary` (ember fill), `secondary` (outline), `ghost` (text), `danger`
  (sunk parchment, ember text). One primary per screen.
- **Field** — labelled input, hint or error beneath.
- **Bubble** — thread message; outbound right and warm (`emberGlow`), inbound left and
  cool (raised parchment).
- **StateChip** — small outlined state marker, coloured per V4.
- **Banner** — an inline note: `warn` (ember glow) or `info` (sky pale).
- **EmptyState**, **Divider**, **Row** — layout furniture.
- **GarbledBody** — wind-damaged text, letter-spaced so the scars read as damage rather
  than as a typo.

### Map components (M5)

- **SkyPanel** — the dark inset: rounded, hairline-bordered, `skyPanelGround`.
- **SmokeTrail** — the flown part of a route in ember, the remainder in `skyPanelFaint`.
- **TowerMark** — a beacon tower at a route waypoint. Cosmetic only (SPEC v1.1 note):
  towers name places and carry no mechanics.
- **RadarOverlay** — NWS precipitation tiles, toggleable, per V2.

---

## 4. Voice

Copy lives in `apps/mobile/src/lib/copy.ts`, not in screens, so it can be reviewed as
prose and later translated.

- Plain, unhurried, faintly archaic. "Light the fire", "Read the sky", "Move my fire".
- Say the pointlessness first: *"SMOKE has genuinely no practical use. That is the point."*
- Never cute about the heritage. The history page is written straight.
- Never blame the user or the weather. "The sky closed while you were writing" — not
  "Error: route unavailable".

---

### V5 — The dark panel is two decisions, not one (ruled, M5.5)

**V1 shipped as light stock Apple Maps on every iPhone.** `customMapStyle` is a
Google Maps feature; Apple Maps ignores it without complaint, so the style was
never refused — it was never read. The panel now sets `customMapStyle` *and*
`userInterfaceStyle="dark"`, one per platform, each a no-op on the other.

The ruling: **a cross-platform visual decision is not implemented until it is
implemented twice.** A scrim over the map would have been the wrong fix — it
dims the radar and the route along with the basemap, which is the dark *theme*
V1 exists to refuse.

### V6 — Fires stand in towns, weather sits in cells (ruled, M5.5)

A cell centre is arithmetic. The centroid of the cell covering Little Falls, NJ
lands in the Cedar Grove Reservoir, and the first fire drawn on a real phone
appeared to burn on open water.

Fires, towers and route endpoints draw on **the town the cell is named after**,
guarded so a pin can never leave its own cell. Storm and unforecast marks stay
on **the cell centre** — weather belongs to the whole 50 km cell and has no
address, and moving it onto a townsite would claim a precision the forecast does
not have.

**Drawing only.** Every distance, ETA and route decision still measures centre to
centre. A pin moved a kilometre for the sake of dry land must never move a
number.

### V7 — The app does not narrate past the engine (ruled, M5.5)

With the engine stopped for ninety minutes, the flight view showed `Progress
100%`, drew the whole route in ember, and listed both towers as passed — while
the only authority in the system still said `IN_FLIGHT` with `delivered_at`
null.

Interpolation is cosmetic and is *allowed* to run ahead. Narration is not.
Progress reads **Arriving** rather than 100% until the engine confirms; the list
of towers passed comes from `current_leg`, not from arithmetic; and copy in that
gap admits the wait — *"Over the far tower now. Waiting for word that it was
read."*

The ruling generalises: **the interface may never assert what it has not
verified.** The dead radar layer that drew a NOAA attribution bar over a 404 was
the same failure wearing different clothes.

### V8 — A map is a rectangle; a timeline is a scroll (ruled, M5.5)

Tower density was left open in M5 because a two-cell route to the Keeper cannot
answer it. The first sixty-cell route settled it immediately: sixty marks across
eleven hundred miles of screen tile edge to edge into a beige band lying on top
of the route line they were meant to decorate.

**The map thins its towers; the Ledger keeps all of them.** A scroll can afford
every tower the smoke passed. A fixed rectangle cannot, and a mark that hides
the route is worse than no mark.

Thinning is **evenly spaced, both ends always kept** — not "the largest towns".
The marks exist to show the *path*, and dropping the middle of the country
because Ohio has no big city would draw a line that appears to teleport.

## 5. What is closed, and what is open

**Closed** (V1–V8 above): the sky-panel model, the contained weather family, the bundled
serif, elegiac state semantics, per-platform darkness, towns-for-fires, and the rule that
the app never narrates past the engine, and map marks thin while timelines do not.

**Open, for whoever ships M6:**

- App icon and splash. The icon wants to be a mark, not a scene — ember on parchment.
- A true dark mode for the whole app (the sub-palette is structured for it; nothing else
  is decided).
- Motion. M5 animates one thing — the smoke's position along a route. Whether transitions
  elsewhere get motion at all is undecided, and "no motion" is a legitimate answer for an
  app about waiting.
