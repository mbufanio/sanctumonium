# Counter-UAS Trade-Show Game

An interactive booth game that makes a visitor *feel*, in a few minutes, that
**a pile of counter-drone devices is not enough — what wins is a coordinating
intelligence** that places, assigns, and adapts. Built company-agnostic: no
real branding, product names, model numbers, or performance figures. See
[`CUAS_TRADESHOW_GAME_SPEC.md`](./CUAS_TRADESHOW_GAME_SPEC.md) for the full
design intent — it is the source of truth.

## Status — Phases 0, 1 & 2

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
`npm run preview` (serve the build), `npm test` (engine unit tests),
`npm run typecheck`.

### Booth / staff controls

- Press **`B`** during a boss fight (after the brain is unlocked) to toggle the
  coordination brain off/on — the staff "watch your odds go dark" sales tool
  (spec §6.2). A toast confirms the state.

## Architecture

The simulation is kept strictly separate from rendering so the game logic is
testable headless (spec §4).

```
src/
  sim/                 # pure TypeScript — no Pixi, deterministic
    rng.ts             # seedable PRNG (fair, reproducible scoring)
    hex.ts             # hexagonal grid math (axial coords, asset-centred 360°)
    level.ts           # site/level data (Level 1 = military facility)
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
      *.test.ts        # engine + schedule + boss-wiring tests
  render/
    world.ts           # PixiJS world: hex ground + dynamic layer (devices,
                       #   coverage, drones, fx)
  ui/
    bossConsole.ts     # the interactive DOM/SVG assignment console
    hud.ts             # build/wave HUD (palette, economy, integrity, score)
    screens.ts         # title / unlock / summary narrative overlays
  theme.ts             # the color & signal language (spec §3)
  game.ts              # controller: state, loop, transitions, staff toggle
  main.ts              # entry point
```

## Resolved design decisions (spec §13)

Following the spec's recommendations: between-waves building only (Phase 2),
**no early loss on Boss #1**, brain permanent after unlock plus the staff
toggle, per-level leaderboards (Phase 5), and suggest-and-accept layout
recommendations (Phase 3).

## Not yet built

Phases 3–7: the adaptive enemy and the brain's other two faces (real-time
coordination + between-round layout recommendations), the tech gradient +
finale, the persistent leaderboard + takeaway, additional sites, and booth
hardening (attract mode, auto-reset, kiosk lock). See the spec for the full
plan.
