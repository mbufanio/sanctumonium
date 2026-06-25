# Counter-UAS Trade-Show Game — Design & Build Specification

**Document purpose.** This is a build-ready specification for an interactive trade-show game. It is written to be handed directly to Claude Code as the source of truth for implementation. It contains the full design intent, the creative and art direction, the gameplay systems, the technical stack, and a phased build plan structured as independently shippable vertical slices.

**Build it company-agnostic.** No proprietary branding, product names, real device model numbers, or real performance figures anywhere in the build. A separate later pass will skin the generic "coordination system" as the company's real product and may connect real model output. Until then, everything is generic and fictional-friendly.

---

## 1. The one-sentence purpose

The game exists to make a visitor *feel*, in four to five minutes, that **a pile of counter-drone devices is not enough; what wins is a coordinating intelligence that optimizes placement, assigns sensors and effectors correctly, and adapts to the threat.** Every system in this document serves that single lesson. If a design choice does not make a player feel that lesson or have fun on the way to it, cut it.

The player should leave able to say, unprompted: *"It's not about how many devices you have. It's about the brain coordinating them."* That sentence is the win condition for the whole booth.

---

## 2. The player's emotional arc (the experience we are engineering)

This is the spine. Build everything to serve this arc.

1. **Grounded and humble.** Player starts with almost nothing: one basic radar, one basic net-drone. The world looks real and military. Stakes feel real.
2. **Reactive growth.** Player kills drones, earns money, and buys more devices wave by wave, building a layout *reactively and therefore messily*. This messiness is intentional and load-bearing (see §6).
3. **The wall.** A coordinated boss attack hits the player's weak spots. Without the coordinating intelligence, the player must manually assign which radar tracks which threat and which effector engages which threat, with the odds hidden. They pick acceptably but not optimally. They **barely, painfully win.**
4. **The call for help.** An in-world operator/commander character interjects: the devices are not talking to each other, the player needs the systems to be smarter and coordinated.
5. **The unlock (the emotional core).** The player unlocks the **coordination system** ("the brain"). It immediately, visibly changes the game: devices coordinate automatically, the boss-fight assignment odds become *visible and optimized*, and the brain *recommends layout improvements* the player can accept.
6. **The catharsis.** The same class of fight that nearly killed them is now a confident, clean win. The improvement is *felt*, not stated.
7. **Escalation into joy.** The tech climbs from realistic to near-future to gloriously fictional (Bloons-style). Waves get huge and spectacular. The player chases score.
8. **The graceful end.** Eventually the enemy scales past the player and the run ends (genre-standard "see how long you last"). Final score is produced.
9. **The snap back to reality (the conversion).** Booth staff steps in: the coordinating brain was real; here is the actual model/sim tool. The game was the warm-up; the real-model demo is the conversion. **Design the game and the real-model demo as one continuous booth experience.**

---

## 3. Creative & art direction (do not leave this to chance)

**Overall vibe:** clean, confident, "command console" meets stylized tower-defense. Readable first, pretty second. Think a modern military C2 (command-and-control) display that is fun, not a gritty war sim.

**Visual style:** stylized **2.5D isometric**. Depth and polish, but every element must be legible at a glance on a busy show floor from a few feet away. Readability beats realism always.

**Camera:** fixed or gently constrained isometric. No free 3D camera. The player should never be lost in space.

**Color & signal language (consistent throughout):**
- Friendly devices and their coverage: cool blues / teals.
- Coverage footprints: semi-transparent colored wedges/circles on the ground, exactly like polar coverage plots. These are the most important visual in the game — the player must *see* coverage and *see seams*.
- Threats/drones: warm reds / oranges, clearly distinct from friendly.
- The coordination brain's activity: a distinct, "smart" accent color (e.g. bright cyan or gold) used ONLY for brain actions — handoff lines between sensor and effector, deconfliction indicators, optimal-assignment highlights, layout-improvement suggestions. The brain's color should feel special and appear nowhere else, so its arrival is visually unmistakable.
- Seams/gaps in coverage: subtly indicated so a player can learn to see them; the adaptive enemy exploits exactly these.

**Readability rules:**
- Big, clear iconography for device types. A player should distinguish a radar from a jammer from an effector at a glance.
- Numbers on screen are large and few. One prominent score/risk number, currency, wave counter. No dense HUD.
- Animations communicate cause and effect: a detection pings, a track line forms, an effector fires, a hit/miss resolves visibly.

**Tone gradient (the Bloons-style climb):** the art should escalate believably (see §7). Early tiers look like real, grounded gear. Mid tiers look near-future. Top tiers look unapologetically fun and fictional (glowing plasma, swarms of homing micro-munitions). The escalation in visual spectacle should track the escalation in power so the late game feels earned and exciting, not silly.

**Audio (lightweight but present):** punchy, satisfying feedback for kills, a distinct "smart" sound for brain actions, a tonal shift when the brain unlocks (the world should *sound* like it got smarter), escalating intensity as waves grow. Booth audio may be muted, so the game must be fully readable with no sound.

**Accessibility for a booth:** colorblind-safe palette, large touch targets (min ~44px), no reliance on tiny text, no timed reading. Assume a first-time player who has never seen it and may be watching over a stranger's shoulder.

---

## 4. Technical stack & platform

**Recommended stack: a web application.**

- **Rendering:** **PixiJS** (2D WebGL renderer) for the isometric world, sprites, coverage footprints, particles, and animation. Isometric is achieved by sorting sprites by depth and offsetting screen positions; do not use a 3D engine.
- **Language:** **TypeScript** for all game logic, kept cleanly separated from rendering so the simulation is testable without the renderer.
- **UI layer:** lightweight HTML/CSS overlays for menus, score, leaderboard entry, and the takeaway screen, composited over the Pixi canvas.
- **State:** a single authoritative game-state object updated by a fixed-timestep simulation loop; rendering reads from state. Keep the sim deterministic where feasible so scoring is fair and reproducible.

**Why web (rationale, so it is not second-guessed):**
- Runs identically on a **kiosk and a tablet** by opening a browser in kiosk/fullscreen mode — directly satisfies the "adaptable to both" requirement with no separate build targets.
- Fast iteration loop with an AI coding assistant; the whole codebase stays legible.
- No app-store friction; deploys as a URL or local bundle.
- Isometric 2.5D is PixiJS's sweet spot.

**Input:** must support **both touch (kiosk/tablet) and mouse**. Design all interactions as tap/drag-first; mouse is a superset. No hover-dependent mechanics (touch has no hover). No keyboard required.

**Orientation & resolution:** target landscape. Support a primary kiosk resolution (e.g. 1920×1080) and common tablet sizes; layout should scale responsively. Lock orientation to landscape on tablet.

**Persistence / leaderboard backend:** a small hosted backend with a shared database so the leaderboard is **persistent and synced across all kiosks and across show days** (see §10). Local-only storage is explicitly NOT sufficient; the cross-kiosk live board is a core attract feature.

**Performance:** must hold a smooth frame rate with many simultaneous drones and effects on modest kiosk hardware. Use sprite batching and an object pool for drones/projectiles. Budget for the late-game spectacle waves being the heaviest load.

**Attract mode:** when idle for N seconds, the game returns to an auto-playing demo/attract loop (a bot playing, or a looping highlight) plus the live leaderboard, to draw people from across the hall. Any touch/click exits attract into a fresh game.

---

## 5. Core gameplay loop

A single run, ~4–5 minutes, on one **site/level** (see §9). The loop:

1. **Build phase (brief, between waves):** player spends currency to place/upgrade devices on the site. Coverage footprints update live as they place, so they see what they cover and what they leave open.
2. **Wave phase (auto-defense, real-time):** drones spawn from site edges and path toward the protected asset(s). Placed devices **automatically** detect, track, and engage in real time. Player watches, and may place/upgrade if they have currency (or building is locked to between-waves — see open decision in §13). Kills earn currency.
3. **Economy:** small per-wave stipend + currency per kill (see §8). Player reinvests to grow the layout.
4. **Boss waves (turn-based assignment, see §6):** at set points, a coordinated boss attack interrupts the real-time flow and drops into the stripped XCOM-style assignment minigame.
5. **The brain unlock** happens at the first boss wall (see §6). After it, the brain coordinates auto-defense, optimizes boss assignment, and recommends layout improvements.
6. **Escalation:** waves and available tech climb (see §7) until the enemy scales past the player and the run ends.
7. **Scoring & leaderboard:** final score computed (see §8), player enters handle + affiliation, lands on the persistent leaderboard, gets a takeaway (see §11).

**Pacing target (~4–5 min):** roughly 8–12 normal waves punctuated by 2 boss waves (first boss ~⅓ through as the "wall/unlock", second boss near the end as the "catharsis + show off the brain"), then a short spectacular overwhelm finale. Tune wave duration and economy flow so a cold player reliably reaches the end inside ~5 minutes. Build the timings as easily-tunable config constants.

---

## 6. The boss waves — the stripped XCOM assignment mechanic (the lesson core)

This is where the value proposition is taught. Build this carefully; it is the most important system in the game.

**Setup.** A boss wave is a **coordinated attack of several threats hitting the defense's weak spots simultaneously.** Time pauses / slows and the game enters a turn-based assignment mode. The player is presented with the incoming threats and their available sensors and effectors.

**The core decision.** For each incoming threat, the player must assign:
- **which radar/sensor tracks it**, and
- **which effector engages it.**

Constraints that make this a real puzzle:
- A sensor or effector can only handle one (or a limited number of) threats at once, forcing prioritization and creating the possibility of leaving a threat under-covered.
- Different effectors are better or worse against different threat types (e.g. an RF-jammer-equivalent is useless against an autonomy-mode threat that ignores RF — keep this legible so the player can *learn* the matchups).
- Range, whether a threat is properly tracked before engaged, and threat type all factor into success.

**Scale (keep it small for a cold booth player):** target **3–4 simultaneous threats** and a handful of sensors/effectors. Enough that optimal assignment is non-obvious; few enough to read in seconds.

### 6.1 Boss #1 — WITHOUT the brain (the wall)
- Hit percentages for each possible assignment are **hidden**. The player assigns based on intuition.
- They will likely pick *acceptably but not optimally* — overcommit to one threat, leave another barely tracked, mismatch an effector to a threat type.
- **Calibration target: the player should painfully, narrowly win** (not lose outright). They feel the cost of flying blind without being knocked out of the experience. (See §13 open decision on whether a loss is ever allowed.)
- Immediately after, the operator character calls for help → the brain unlocks.

### 6.2 Boss #2+ — WITH the brain (the catharsis)
- The same class of fight, now with the brain active:
  - **Hit percentages are visible** for every possible assignment.
  - The brain **highlights the optimal assignment** (player can follow it or override).
  - The brain **flags which threat is about to exploit which seam.**
  - **Deconfliction is automatic** — the brain prevents two effectors wasting fire on one threat and warns of untracked threats.
- The same fight becomes a confident, clean win. The contrast between 6.1 and 6.2 *is* the product demonstration.

**Design note:** the percentages must depend on *legible* factors (range, tracked-or-not, effector-vs-threat-type matchup) so the brain's optimal pick feels **insightful** ("ah, right — that effector doesn't work on that drone type"), never arbitrary. The player should be able to learn the logic. This legibility is what makes the brain feel smart rather than magic.

**Sales-demo toggle (build this):** after unlock, expose a hidden/staff toggle to turn the brain **off and back on** on demand, so booth staff can show a prospect the exact same hardware with and without coordination ("watch your odds go dark"). This is a deliberate sales tool, not part of the normal player flow.

---

## 7. The tech gradient — Bloons-style realistic-to-fictional climb

The available devices escalate across tiers. Like Bloons: start dead simple, each tier is a clear visual + power jump, support both **new device classes** and **upgrades within a class**, and let the top end get gloriously absurd while the core loop stays readable.

**The gradient must feel earned, not jarring.** Climb a believable ladder so the fiction arrives as "this got awesome," not "this got silly."

**Tier 1 — Grounded / real (where the lesson lands):**
- Basic radar (detection), basic RF detection/direction-finder (sensing).
- Net-drone / net-launcher (soft-kill capture), RF jammer (disrupt).
- Looks and behaves like real, recognizable counter-UAS gear. The value-proposition teaching happens here.

**Tier 2 — Near-future plausible:**
- High-power microwave (area soft-kill), directed-energy / early laser, interceptor drones, better multi-target radar.
- Still credible, on-the-horizon tech.

**Tier 3 — Clearly fictional / fun (the reward):**
- "Plasma cannon," "heat-seeker swarm," homing micro-munition clouds, rapid beam weapons that blast waves out of the sky.
- Unapologetically game-y and spectacular. By now the player has the lesson; this is pure fun and score-chasing.

**Within-class upgrades (Bloons-style):** each device should have a short upgrade path (e.g. radar → longer range → multi-track → networked), so spending currency deepens existing placements, not only adds new ones. Keep upgrade trees short and readable (2–4 steps), not sprawling.

**Scope guidance:** prefer **fewer, more memorable** devices over a giant tech tree. A cold visitor cannot parse fifty devices. Aim for a handful of distinct, iconic devices per tier.

**Scoring guardrail (critical):** the leaderboard/score must still reward the *lesson* even at the fictional high end — coordinated, well-placed, efficient defenses must outscore brute-force spamming the biggest fictional weapon. The fiction is spectacle; the underlying scoring still rewards optimization and coordination, or the leaderboard quietly contradicts the message. Make "the brain-optimized layout scores higher" true at every tier.

---

## 8. Economy & scoring

**Economy (drives progressive, reactive, intentionally-messy layouts):**
- Player starts poor: **one basic radar + one basic net-drone.**
- Income = **small per-wave stipend** (so no one hard-stalls and a struggling cold player can recover) **+ currency per kill** (the skill-expressive part; better play earns more).
- Player spends between/within waves to place new devices and buy upgrades.
- The reactive, under-pressure buying is *intended* to produce sub-optimal layouts the brain later corrects (see §6.2 / §12). Do not "help" the player build optimally before the brain — the mess is the point.

**Scoring (game-y abstracted, but must reward the lesson):**
- Primary score ingredients: **risk neutralized / threats stopped**, **efficiency** (score per dollar spent — rewards geometry-beats-spend), **survival depth** (how many/how hard the waves survived), and **boss performance** (clean optimal assignments score higher).
- A thoughtful, coordinated player must clearly beat a button-masher and a brute-force spender. If the highest score goes to "spent the most" or "spammed the biggest gun," the scoring is wrong and contradicts the message — tune until coordination wins.
- Score must be **hard to cheese.** Because there is a leaderboard, hunt for and close degenerate strategies and pathing exploits; the adaptive enemy must be adaptive enough that balanced, coordinated coverage really is optimal. This is load-bearing for a leaderboard game, not polish.

---

## 9. Levels / sites

Sites are levels, providing progression, replayability, and a showcase of breadth. Each level should teach a *different* wrinkle so they are not reskins.

- **Level 1 — Military facility (BUILD FIRST, the lead).** Clear assets, a perimeter, obvious approach corridors. The clean teacher for "geometry beats spend, coordination beats raw devices."
- **Level 2 — Airport.** Teaches the operational-shutdown angle: threats that cost you by disrupting operations even without a direct hit.
- **Level 3 — Energy facility.** High-value point assets; ties to the company's strongest real demo for booth/model consistency.
- **Level 4 — Stadium / public venue.** Dense, time-bound, crowd-protection dynamics; introduces swarms.

**Each level introduces a new threat wrinkle** (swarms, low-observable/low-RCS threats, autonomy-mode threats that defeat RF, fiber-optic-controlled threats immune to jamming) so progressing through sites also progresses the player's understanding of why coordination/optimization matters.

**Implementation:** build Level 1 as a complete vertical slice. Subsequent levels are **largely data** — a map, an asset layout, a threat mix, a starting budget — over the same engine. Structure levels as config (JSON/TS data) + art, not bespoke code, so new sites are cheap to add.

---

## 10. Persistent leaderboard (the booth's social engine)

The leaderboard turns a one-time demo into competition and follow-up conversation. Treat it as a first-class feature.

**Backend:** small hosted service + shared database. Scores **persist and sync across all kiosks and across all show days.** A struggling local-only board is explicitly not acceptable.

**Score submission:** at run end, player enters a short **handle** and selects an **affiliation** (military branch or company) from a dropdown (plus a free-text option). Keep entry friction tiny — a name and a dropdown — every extra field cuts completion.
- Affiliation makes the competition social ("1st: Reyes, US Army, 94,200") and is valuable lead intelligence (which orgs engaged, how deeply). A rep can later say "your colleague topped our board — want to see the real version?"

**Two boards:** an **all-time** board (lasting rivalry) and a **today/this-show** board (so a day-three player can still top something live). Daily reset keeps it fresh across a multi-day show.

**Per-level boards:** each site has its own board — more "top spot" slots means more people get the thrill of leading something, better for a booth.

**Live display:** a second screen at the booth shows the live board updating as people play — its own attract loop; people watch others compete and want a turn.

**Anti-abuse:** validate scores server-side against plausibility (max achievable given waves), rate-limit submissions, and sanitize handles (profanity filter, length cap). Assume strangers will try to put junk on a public screen.

---

## 11. The takeaway & the snap-back-to-reality handoff

**Takeaway artifact:** at run end, generate a one-page personalized summary ("Your defense — score, rank, branch, how you did") the player can take or have emailed. It mirrors the real product's output style, is a lead-capture mechanism, and extends the booth into their inbox. Email capture is optional, never blocking.

**The handoff (design game + real-model demo as ONE experience):** the run ends having taught the lesson and had fun. Booth staff transitions: *the coordinating brain you unlocked is real — here is the actual model/sim.* The game is the emotional warm-up; the real-model demo is the conversion and the moment the lead qualifies. The spec's job is to make the game end in a state that sets up that transition cleanly (lesson landed, player delighted, brain freshly felt).

---

## 12. The brain's three faces (keep them one coherent intelligence)

The unlockable "coordination system" must read as **one intelligence applied everywhere**, not a grab-bag of features. It has three visible faces; build all three and make them share an identity (one name, one accent color, one sound):

1. **Coordinates (auto-defense):** devices hand off tracks, deconflict fire, and reposition/re-task to close probed seams in real time. The player sees *efficiency* — same hardware, better used, score climbs.
2. **Informs & optimizes (boss assignment):** hidden odds become visible, optimal assignments are highlighted, seams are flagged, double-fire is prevented. The player sees *decision quality*.
3. **Recommends (between rounds):** the brain reviews the player's reactive, messy layout and **suggests concrete improvements** (move this effector, you have an uncovered approach). Player **accepts or rejects** (suggest-and-accept, not silent auto-fix — the player participating in the improvement is more persuasive). Accepted changes visibly improve auto-defense score and boss odds. This is the "geometry beats spend / next-best-addition" idea as a mechanic.

All three are the same brain. That coherence is the message: the coordinating intelligence is one product applied across coordination, decision-making, and optimization.

---

## 13. Open design decisions (resolve before/early in build — do not silently guess)

These are deliberate choices flagged for the team; Claude Code should surface them rather than pick arbitrarily:

- **Building during waves vs. between waves only.** Between-waves-only is calmer and more readable for a cold visitor; building-during-waves is more frantic and fun. Recommendation: start with between-waves-only for clarity, revisit if it feels static.
- **Is an outright loss ever allowed on Boss #1?** Recommendation: **no early loss** — force a painful narrow win so a cold booth visitor is never knocked out before the catharsis. The final overwhelm at the very end is the only "loss," and it is genre-expected. (Staff may optionally trigger a loss for a prospect who wants to see it.)
- **Brain permanent after unlock vs. toggleable.** Normal flow: permanent. Also build the staff-only on/off toggle (§6.2) as a sales tool.
- **Leaderboard score per-level vs. cumulative.** Recommendation: per-level boards (more top-spot slots).
- **How forcefully the brain recommends layout changes.** Recommendation: suggest-and-accept, not auto-apply.

---

## 14. Phased build plan (vertical slices for Claude Code)

Build in thin, independently-playable slices. Each slice ends in something runnable. Do NOT design the whole thing up front in code; build the slice, make it good, then layer the next. This sequencing is deliberately ordered so that **the slice proving the value proposition is built first** — if the project stalls after Phase 2, there is still a compelling booth demo.

**Phase 0 — Skeleton.** Web app shell: PixiJS canvas, fixed-timestep sim loop, TypeScript state object, HTML/CSS overlay, touch+mouse input, landscape responsive scaling. A static isometric military-facility map renders with one protected asset.

**Phase 1 — The boss assignment minigame (THE PROOF — build first).** On a fixed small defense layout, implement the stripped XCOM assignment boss: 3–4 threats, a few sensors/effectors, manual assignment, resolution. Implement BOTH states: brain-off (hidden odds, painful narrow win) and brain-on (visible odds, optimal-pick highlight, deconfliction, clean win). The brain-off → unlock → brain-on contrast must land. *If only this existed, it would still demo the value proposition.*

**Phase 2 — Auto-defense + economy.** Real-time wave defense on the same map: device placement with live coverage footprints, drones spawning and pathing to the asset, devices auto-detecting/tracking/engaging, the per-wave-stipend + per-kill economy, the score. Wire the boss waves from Phase 1 into the wave sequence so the boss is fought *on the layout the player built.*

**Phase 3 — The narrative + the brain's three faces.** Operator character interjection and the call for help; the unlock moment with its tonal/audio shift; the adaptive enemy that probes seams; difficulty escalation that triggers the wall. Implement all three brain faces (§12): real-time coordination, boss optimization (already in Phase 1), and between-round layout recommendations (suggest-and-accept).

**Phase 4 — Tech gradient + escalation + finale.** The Bloons-style tier climb (real → near-future → fictional) with short within-class upgrade paths, escalating waves, and the final overwhelm ending that produces the score. Enforce the scoring guardrail (coordination outscores brute force at every tier).

**Phase 5 — Persistent leaderboard + takeaway.** Hosted backend + shared DB, score submission with handle + affiliation, all-time/today/per-level boards, live board display, server-side anti-abuse, the takeaway artifact, optional email capture.

**Phase 6 — Additional levels.** Airport, energy facility, stadium as config + art over the existing engine, each with its new threat wrinkle.

**Phase 7 — Booth hardening.** Attract/idle mode, auto-reset between players, kiosk fullscreen lock, the staff-only brain on/off sales toggle, performance pass for the heavy late-game waves, colorblind/readability/touch-target audit, and a "panic reset" for booth staff.

---

## 15. Guardrails & non-goals

- **Company-agnostic build.** No real branding, product names, real device models, or real performance numbers. Generic + fictional only until the later proprietary skin pass.
- **Not a realistic combat sim.** Readability and the lesson beat spectacle and realism. (The late-game fiction is spectacle in service of fun, after the lesson has landed.)
- **No web storage anti-pattern reliance for the leaderboard** — the leaderboard must be a real hosted backend, not per-machine local storage.
- **Two-minute-grokkable, four-to-five-minute-complete.** A cold, first-time visitor who may be watching over a stranger's shoulder must understand it fast and finish inside ~5 minutes.
- **The game is the warm-up, not the product.** It exists to make the visitor feel the value proposition and to qualify them for the real-model demo. Every choice serves that.
