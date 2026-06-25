# Counter-UAS Trade-Show Game

An interactive booth game that makes a visitor *feel*, in a few minutes, that
**a pile of counter-drone devices is not enough — what wins is a coordinating
intelligence** that places, assigns, and adapts. Built company-agnostic: no
real branding, product names, model numbers, or performance figures. See
[`CUAS_TRADESHOW_GAME_SPEC.md`](./CUAS_TRADESHOW_GAME_SPEC.md) for the full
design intent — it is the source of truth.

## Status — Phases 0–7

The build is sequenced so the slice proving the value proposition ships first
(spec §14). Implemented so far:

- **Phase 0 — Skeleton.** PixiJS isometric world — a hexagonal field with the
  protected asset at the CENTER and play radiating 360° around it (concentric
  coverage rings + a radar sweep), fixed-timestep sim loop, a single authoritative
  TypeScript state object, HTML/CSS overlays, touch + mouse input, landscape
  responsive scaling.
- **Phase 1 — The boss assignment minigame (THE PROOF).** The stripped
  XCOM-style assignment boss on a fixed layout: 3–4 threats, a handful of
  sensors/effectors, manual *which-sensor-tracks / which-effector-engages*
  assignment, and dice resolution. Both states are built and the contrast
  lands end-to-end:
  - **Brain OFF** (Boss #1, "the wall") — odds hidden, no optimal hint, no
    deconfliction; calibrated to a *painful narrow win* (never an outright
    loss, per §6.1/§13).
  - **Brain ON** (Boss #2, "the catharsis") — odds visible, the optimal
    assignment highlightable, deconfliction warnings, handoff lines glowing in
    the brain accent. The same class of fight becomes a clean win.

The full arc runs: title → Boss #1 (narrow win) → operator "call for help" →
brain unlock → Boss #2 (clean win) → side-by-side summary + conversion handoff.

- **Phase 2 — Auto-defense + economy.** The boss minigame is now wrapped in the
  real-time tower-defense loop on the centred hex field. Between waves the
  player taps the field to place sensors/effectors (live coverage footprints,
  buy/sell). During a wave, drones spawn at the field edge and path to the
  centre from all 360°; placed sensors track and effectors auto-engage with the
  same matchup truth as the boss (a jammer still does nothing to an autonomy
  drone — it sails through). Kills earn currency; leaks damage asset integrity;
  a per-wave stipend + per-kill bounty drive the economy, and tracked kills
  score higher (coordination is rewarded). The two boss fights are interleaved
  in the wave schedule and **fought on the layout the player actually built**.
  The run ends on a score (site held, or asset overrun).

- **Phase 3 — The narrative + the brain's three faces.** The unlock now changes
  the whole run, not just the boss:
  - **Adaptive enemy** — waves bias their spawns toward the player's coverage
    SEAMS (bearings where no effector-plus-sensor can kill), ramping with wave
    index. Messy layouts get punished; the bosses feel like they hit weak spots.
  - **Face 1 — real-time coordination** (post-unlock): effectors deconflict fire
    and fused tracks make shots more reliable — same hardware, better used, score
    climbs. Shown by brain-accent handoff lines and a "COORDINATION ACTIVE"
    readout.
  - **Face 2 — boss optimization**: already shipped in Phase 1.
  - **Face 3 — between-round recommendations** (post-unlock): the brain reads the
    layout and suggests ONE concrete fix ("the N approach is wide open — drop a
    Net-Drone"), suggest-and-accept. Accepting places it.
  Balance is held by a headless analysis harness: coordinated play wins ~100% and
  scores far ahead; a sensor-less spread is punished by the adaptive enemy
  (~58%); clustered and passive play lose. All asserted as guardrail tests.

- **Phase 4 — Tech gradient + escalation + finale.** The Bloons-style climb
  (spec §7). Devices now carry their own combat stats, so:
  - **Three tiers** unlock with the narrative — Tier 1 grounded (radar, RF-DF,
    net, jammer) → Tier 2 near-future (AESA array, HPM area-emitter, laser) →
    Tier 3 fictional (plasma cannon, beam array). Tier 2 opens after boss #1,
    Tier 3 after boss #2.
  - **Within-class upgrades** — tap a placed device for a short upgrade path
    (range / fire-rate / effect / AOE), spending currency to deepen placements.
  - **Area effectors** (HPM / plasma / beam) blast whole clusters at once — the
    spectacle that pairs with the swarm finale.
  - **Escalation finale** — waves scale up to a swarm overwhelm; the run ends on
    a score (site held, or overrun).
  The scoring guardrail holds at every tier: even with the fictional high-end,
  coordinated play outscores brute-force spam (~5000 vs ~1400 in the harness).

- **Phase 5 — Persistent leaderboard + takeaway.** A real hosted backend plus a
  localStorage fallback so the static demo still works:
  - **Backend** (`server/`, dependency-free Node): `POST /api/scores` and
    `GET /api/leaderboard?level=&board=alltime|today`, JSON-file store, CORS,
    per-IP rate limiting, and server-side anti-abuse (handle sanitization +
    profanity masking, a plausibility cap derived from the schedule). Run with
    `npm run server`.
  - **Client** talks to `VITE_API_BASE`; if unset/unreachable it uses a
    localStorage demo board (seeded so it's not empty). One shared rules module
    (`src/leaderboard/rules.ts`) is used by server, client, and tests so
    validation can't drift.
  - **Run-end flow**: score submission (call sign + affiliation), the board
    (all-time / today tabs, per level, the player highlighted), and a one-page
    **takeaway report** rendered to a downloadable PNG (optional email capture).
  - **Live attract board** (`?display=board`, or press **L** at the title): a
    full-screen, auto-refreshing second-screen display.

- **Phase 6 — Additional sites.** Levels are pure data over the one engine
  (`src/sim/level.ts`): a hex field, a centred asset, a starting budget,
  integrity, a per-level wave schedule, and "wrinkle" flags. A **site-select
  screen** opens the run; each site keeps its own leaderboard. Four sites, each
  teaching a different reason coordination matters:
  - **Forward Operating Base** — balanced teacher (the lead).
  - **International Airport** — *operational shutdown*: every leak also tanks
    your score; you can't tolerate intrusions.
  - **Power Substation** — fragile high-value asset, autonomy/fiber-controlled
    drones that shrug off jammers; you can't jam your way out.
  - **Stadium · Event Day** — *swarms*: dozens of fast, cheap micro-drones at
    once, where area weapons (HPM/plasma/beam) shine.
  Wrinkles are expressed via the threat MIX and per-spawn modifiers
  (speed/bounty/leak/size) plus small level flags — no new threat types.

  **Terrain & line-of-sight** (`src/sim/terrain.ts`) make placement a spatial
  puzzle: **blocker** cells (structures) block both tracking and engagement LOS,
  and **no-fire** zones (runways, crowds) block effector fire across them but not
  tracking. LOS is sampled along the plane-space segment; **area effectors
  ignore per-target LOS**, so they shine where direct fire is blocked. The engine,
  the adaptive enemy's coverage map, the brain's recommendations, and placement
  are all terrain-aware. Per-site layouts: **Energy** flat (the clean starter),
  **Military** mixed blockers + a fire-inhibit zone, **Airport** two runway
  no-fire lines, **Stadium** dense urban blockers (and the line-of-sight laser is
  restricted there). Energy leads as the booth's opener.

- **Phase 7 — Booth hardening.** The unattended-kiosk pass (spec §11) so the
  game survives a trade-show floor with no operator babysitting it:
  - **Attract / idle auto-demo** — after ~35s of no input the game fades up an
    `◈ AUTO-DEMO · TAP TO PLAY` overlay and a bot plays a live run (builds a
    layout, fights waves, resolves the boss) on the attract field. Any tap drops
    straight back to the site-select screen for the next visitor — so the booth
    is always showing motion, never a dead title card.
  - **Auto-reset between players** — runs that end while no one is watching loop
    back into the attract demo instead of parking on a score screen, and the
    attract bot never submits a leaderboard score.
  - **Kiosk lock** — first interaction arms fullscreen and an orientation hint;
    context menu, text selection, pinch-zoom, and accidental drag/scroll are
    suppressed so curious hands can't break the frame.
  - **Staff panel** — press **`S`** for a discreet operator panel (toggle the
    coordination brain for the "watch your odds go dark" pitch, flip colorblind
    mode, and **panic-reset** the booth to a clean title).
  - **Performance pass** — the heavy swarm finale caps live effects so the
    spectacle never tanks the frame rate on booth hardware.
  - **Accessibility** — a colorblind palette mode and a touch-target audit so the
    controls work for everyone walking up.

### The teaching matchups (spec §6)

Odds depend on three *legible* factors — effector-vs-threat-type, whether the
threat is tracked, and range — so the brain's pick reads as insight, not magic:

- The **RF jammer is devastating vs the RF quadcopter but useless vs the
  autonomy drone** (it ignores RF) — the signature "ah, right" lesson.
- The **RF direction-finder cannot track the autonomy drone** (no RF to find).
- **Radar barely sees the low-observable threat**; the RF-DF tracks it best.
- The **net-drone is the reliable generalist** — but short-ranged, and you
  never have enough of everything, so prioritization bites.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts: `npm run build` (typecheck + production bundle),
`npm run preview` (serve the build), `npm test` (engine + balance + leaderboard
tests), `npm run typecheck`.

### Leaderboard backend (optional)

The game runs fine with no backend (it uses a localStorage demo board). For the
real persistent, cross-kiosk board, run the API and point the frontend at it:

```bash
npm run server                       # serves the API on :8787 (Node 22+)
VITE_API_BASE=http://localhost:8787 npm run dev   # frontend uses it
```

The server (`server/index.ts`) is dependency-free and run via Node's TypeScript
support. Deploy it anywhere Node runs; every kiosk sets `VITE_API_BASE` to the
one instance so they share a board. `PORT` and `DATA_PATH` are configurable.

### Booth / staff controls

- Press **`B`** during a boss fight (after the brain is unlocked) to toggle the
  coordination brain off/on — the staff "watch your odds go dark" sales tool
  (spec §6.2). A toast confirms the state.
- Press **`L`** at the title (or open `?display=board`) for the full-screen
  live leaderboard — the second-screen attract display.
- Press **`S`** for the staff panel — toggle the coordination brain, flip
  colorblind mode, or **panic-reset** the booth to a clean title.
- The booth **auto-attracts**: after ~35s idle it runs a hands-free demo with a
  `TAP TO PLAY` overlay, and any tap hands the booth to the next visitor.

## Architecture

The simulation is kept strictly separate from rendering so the game logic is
testable headless (spec §4).

```
src/
  sim/                 # pure TypeScript — no Pixi, deterministic
    rng.ts             # seedable PRNG (fair, reproducible scoring)
    hex.ts             # hexagonal grid math (axial coords, asset-centred 360°)
    level.ts           # the four sites as data (field, asset, budget, schedule, wrinkle, terrain)
    terrain.ts         # blockers + no-fire zones, line-of-sight sampling
    state.ts           # the single authoritative game-state + phase machine
    boss/
      types.ts         # boss-minigame domain types
      data.ts          # threat/sensor/effector tables + Boss #1 / Boss #2
      engine.ts        # odds, optimal-assignment search, resolution
      engine.test.ts   # matchup legibility + calibration tests
    realtime/          # Phase 2 real-time wave defense (pure TS)
      catalog.ts       # placeable devices + drone specs (shared boss stats)
      types.ts         # drone / placed-device / wave / realtime-state types
      engine.ts        # spawn, path, track, auto-engage, leaks (deterministic)
      schedule.ts      # wave schedule + boss-from-the-built-layout wiring
      adaptive.ts      # seam-probing enemy + brain layout recommendations
      *.test.ts        # engine, schedule, adaptive + balance-guardrail tests
  render/
    world.ts           # PixiJS world: hex ground + dynamic layer (devices,
                       #   coverage, drones, fx)
  leaderboard/         # persistent scores (spec §10)
    rules.ts           # shared: sanitize, plausibility cap, ranking (server+client)
    client.ts          # API client with localStorage demo fallback
    rules.test.ts      # validation / anti-abuse / ranking tests
  ui/
    bossConsole.ts     # the interactive DOM/SVG assignment console
    hud.ts             # build/wave HUD (palette, economy, integrity, score)
    screens.ts         # title / unlock / summary narrative overlays
    leaderboard.ts     # submit / board / takeaway / live-board UI
    takeaway.ts        # one-page report rendered to a downloadable PNG
  theme.ts             # the color & signal language (spec §3)
  game.ts              # controller: state, loop, transitions, booth/attract + staff panel
  main.ts              # entry point
server/                # leaderboard backend (run via `npm run server`)
  index.ts             # dependency-free Node HTTP API (validate, rate-limit, CORS)
  store.ts             # JSON-file persistence (swappable for SQLite/Postgres)
```

## Resolved design decisions (spec §13)

Following the spec's recommendations: between-waves building only (Phase 2),
**no early loss on Boss #1**, brain permanent after unlock plus the staff
toggle, per-level leaderboards (Phase 5), and suggest-and-accept layout
recommendations (Phase 3).

## Feature-complete

All phases in the spec's §14 phased plan (0–7) are implemented. The build is a
shippable booth experience end-to-end: the value-proving boss minigame, the
real-time defense loop with the brain's three faces, the tech-gradient climb,
four data-driven sites with terrain/line-of-sight, a persistent leaderboard with
a printable takeaway, and the unattended-kiosk hardening pass.
