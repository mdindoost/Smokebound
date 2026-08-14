# SMOKEBOUND — Launch Kit v1.0

Owner: Mohammad · All copy is draft-final: edit voice to taste, keep the structure.
Rule inherited from SPEC: cultural design rule is binding in every asset (worldwide signaling history; zero caricature).

---

## 1. App Store listing

**Name:** Smokebound
**Subtitle (30 chars max):** `Messages by signal fire` (23 ✓)

**Promo text (170 chars, editable without review):**
`Your text travels the map as a smoke signal — routed around real storms by real weather. Slowest messenger ever made. On purpose.` (129 ✓)

**Description:**

Send a message. Watch it fly. Hope the sky cooperates.

Smokebound delivers your texts as smoke signals crossing a live map of the United States at the speed of drifting smoke. Real weather stands in the way: rain slows your signal, severe storms stop it cold, and the wind sometimes eats a word or two. A message across town takes minutes. Across the country? Check back tomorrow.

THE SKY IS REAL
• Routes are computed around live weather — your smoke visibly bends around storms on radar
• Severe weather strands your signal; watch it shelter at the storm's edge and wait for clear skies
• High winds can garble your words — what arrives is what survived
• Every failure has a reason you can see on the map; nothing is a dice roll

SLOW ON PURPOSE
• No read receipts. No typing indicators. No instant anything.
• Message length matters — your fire transmits puff by puff before the smoke departs
• A minimum ten-minute wait even for your roommate. Anticipation is the product.
• The Keeper — a patient correspondent one hill away — awaits your first signal

YOUR FLOCK
• Add friends; requests drift in as smoke wisps
• The Ledger keeps your correspondence in parchment and ember
• Nearby friend? "You could just walk over. Send anyway?"

Smoke signaling belongs to the whole human story — Chinese beacon towers relaying warnings along the Great Wall, Polybius' torch telegraph, Aboriginal and Native American practice across continents. Smokebound is a small, sincere joke built on that history, with respect. There's a history page inside.

Genuinely no practical use. That's the point.

**Keywords (100 chars):** `smoke,signal,slow,messenger,weather,map,pigeon,letter,snail mail,fire,beacon,texting,friends` (93 ✓)

**Privacy nutrition highlights (must match policy):** coarse location at onboarding only; messages stored server-side; no tracking, no ads, no third-party analytics.

## 2. Launch tweet + thread (X)

**Tweet 1 (the hook):**
Spent my summer building a messenger slower than the mail.

Your text crosses the US as a smoke signal at 20 mph, routed around REAL storms with live weather data. Rain delays it. Severe weather strands it. Wind can eat your words.

NJ → Chicago: ~36 hours. If the sky allows.

**Tweet 2:** The routing is real: A* over a weather-weighted grid of ~6,000 cells, live NWS data, admissibility-tested against Dijkstra. I put more graph theory into a joke app than into some of my actual research. [screenshot: route bending around radar blob]

**Tweet 3:** Failure is part of the product. Your smoke can shelter at a storm's edge for hours. Gale winds garble text — "HELP THE CAR BROKE DOWN" arrives as "HE~P THE CAR BR KE DOWN." Nothing is random; every delay has a visible cause on the map. [screenshot: stranded smoke]

**Tweet 4:** It cannot cross open water. It cannot enter Canada (no passport). Your roommate across the hall still waits 10 minutes. There is a system contact called The Keeper who lives one hill away and answers your first signal. Genuinely no practical use.

**Tweet 5:** Built in ~5 weeks: specs first, then Claude Code milestone by milestone, red-teamed before a line of code. iOS today, Android soon. Free. [App Store link]

## 3. Reddit posts

**r/SideProject (primary — the maker story):**
Title: `I built a messenger where real weather delays your texts. NJ→Chicago takes 36 hours, longer if it rains.`
Body: what it is (3 sentences) → why (couldn't stop thinking about how smoke signals actually worked — the research surprised me: no universal code, pre-arranged signals only, Polybius built a torch telegraph in 150 BC) → the build (specs-first workflow, one technical nugget: the A* heuristic had to account for tailwind or routing silently broke) → honest admission (no practical use) → link. Reply to every comment for 6 hours.

**r/InternetIsBeautiful:** lead with the map GIF — smoke arcing around a storm on live radar. One paragraph, no maker story.

**r/iosapps:** short, feature-list voice, screenshots.

Stagger: SideProject on launch day, the others day 2–3 (fresh waves, not one spike).

## 4. Press outreach

Targets: the exact reporters who covered Carrier Pidge and the slow-social trend (Dexerto entertainment desk, Yahoo Tech apps desk, thenews/aryn aggregator desks pick up wires — skip them, they'll follow). Find 3–5 by author byline the week of launch.

**Email template (subject: `The pigeon app has a rival — this one loses to weather`):**
Hi [name] — you covered Carrier Pidge's virtual pigeons last month. I built the escalation: Smokebound sends texts as smoke signals routed around real storms using live NWS weather. A storm over Pennsylvania actually delays NJ→Chicago delivery (36+ hours). Smoke can't cross oceans or the Canadian border, wind garbles words mid-flight, and every delay is visible on a live radar map. Built by a CS PhD student who put genuine graph theory into a deliberately pointless app. Press kit + TestFlight: [link]. Happy to talk about the slow-messaging trend or the routing math. — Mohammad

Angle bank (one per outlet, don't reuse): ① the rivalry/escalation story, ② "a PhD student's revenge: real algorithms in a joke app," ③ the research angle — how smoke signals actually worked vs Hollywood, ④ the slow-social trend's second wave.

## 5. Product Hunt

Launch Tue–Thu, 12:01 AM PT. Tagline: `The messenger that loses to weather.` First comment (maker): the why + the Polybius history nugget + one honest limitation ("US only for now — smoke can't cross the ocean and I can't afford global weather data yet"). Gallery: 5 screenshots matching SPEC §6's screenshot-able moments, in that order. The stranded-smoke radar shot is the hero image everywhere.

## 6. Landing page (one pager, smokebound.app)

Hero: the radar-detour map animation, one line — "Your message. The sky's schedule." — App Store button. Below: three moments (stranded / garbled / delivered footnote), the history section (worldwide credit, links), moderation contact (App Store 1.2 requirement — support@ address), privacy policy link. Build: static HTML, Claude Code side-task during M6, hosted on GitHub Pages.

## 7. Sequencing (launch week)

Day 0 (Tue): App Store live → X thread 9 AM ET → r/SideProject 10 AM → press emails 11 AM.
Day 1: Product Hunt 12:01 AM PT → engage all day → PH result posted to X.
Day 2–3: r/InternetIsBeautiful + r/iosapps → any press replies get same-hour responses + TestFlight/screenshots.
Day 5: "week one numbers" post on X (downloads, longest flight, number of garbled messages, most-stranded route) — the transparency post is its own second wave.
Standing rule: every viral reply window is 6 hours; block launch-day calendar accordingly. Android announcement is beat two, ~3 weeks later, with "come to the fire" as beat three if v1.1 lands.
