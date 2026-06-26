# Pre-Arcade Storyboard — the value-prop acts

> **Purpose of this document.** The game is two acts. **Act 2** is an endless
> arcade shoot-em-up (the fun reward). **Act 1** — everything *before* the
> "Future Systems Online" act break — is the **sales pitch**: a few minutes that
> must make a trade-show visitor *feel*, not just hear, the core message:
>
> > **It isn't how many counter-drone devices you own. It's the brain that
> > coordinates them — placing, fusing, assigning, and adapting in real time.**
>
> This file describes the pre-arcade experience qualitatively (the story), how
> that story is currently executed in-game (beats, mechanics, screens), and how
> it is wired in code (files, functions, data). It is written to be handed to
> Claude AI (chat) so it can help us **restructure and script Act 1 to make the
> sales point land harder**. The last two sections — "Where the story is thin"
> and "Levers to pull" — are the most important for that conversation.

---

## 0. TL;DR for the collaborator

- **The product being sold (fictionally):** a *coordination layer / C2 brain* that
  sits on top of a mixed bag of counter-UAS sensors and effectors and makes them
  work as one system. Everything is **company-agnostic** — no real brand, model
  numbers, or performance figures.
- **The proof we stage:** the player first fights **without** the brain (devices
  act in isolation — wasted shots, slow IDs, leaks, a painful boss). Then the
  brain comes online and the **same hardware** suddenly wins clean. Same kit,
  better outcome → the value is the brain.
- **Act 1 runtime:** ~3–5 minutes. Structure (per site): `2 real-time waves →
  Boss #1 (brain OFF) → unlock beat → 3 real-time waves → Boss #2 (brain ON) →
  act break → Act 2 arcade`.
- **The ask:** Act 1's *mechanics* already encode the message, but the *narrative
  scripting* (copy, framing, the operator/customer fiction, the explicit
  before/after callouts) is thin. Help us script it.

---

## 1. The emotional arc we are going for (spec §2)

Five beats, in order:

1. **Competent but strained.** "I have real gear and I can hold — but it's
   messy." The opening waves are winnable yet leaky; you feel friction.
2. **The wall.** Boss #1 is a deliberately hard, *odds-hidden*, no-help puzzle.
   You scrape a narrow win and it feels lucky, not earned. Slight frustration —
   "there has to be a better way to run this."
3. **The call for help / the unlock.** An operator line: "patch the units into
   the coordination layer." The brain boots. This is the turn.
4. **The catharsis.** Boss #2 is the *same class of fight*, now with the brain:
   odds visible, the optimal assignment highlighted, fire deconflicted. It
   becomes a clean, confident win. Relief + "oh — *that's* the difference."
5. **Earned escalation (hand-off to Act 2).** Coordination proven, the game says
   "now see what it can really do" and unlocks the fictional arsenal + arcade.
   The sales point is already made; Act 2 is the dopamine reward that keeps them
   at the booth (and on the leaderboard) long enough to talk.

The **whole point** is the *contrast* between beats 2 and 4 — and, underneath,
the moment-to-moment contrast in the real-time waves before vs. after the unlock.

---

## 2. Beat-by-beat storyboard (what the visitor sees / does / feels)

Each beat lists: **Screen/phase**, **what's on screen**, **what the player
does**, **what it's teaching**, and **how it's executed in code**.

### Beat 0 — Attract / Title
- **Screen:** `title` (and, after 35s idle, an auto-playing attract demo).
- **On screen:** "Hostile drones inbound. Match the right sensor and effector to
  each threat." A single **Begin** button. (Booth idles into an auto-demo bot.)
- **Player:** taps Begin.
- **Teaching:** sets the frame — this is about *matching* the right tool to the
  right threat, i.e. a coordination problem, not a volume problem.
- **Code:** `Screens.title()` (`src/ui/screens.ts`); idle/attract in
  `src/game.ts` (`checkIdle`, `enterAttract`, `attractTick`).

### Beat 1 — Site select
- **Screen:** `levelSelect`.
- **On screen:** four sites, each with a one-line "wrinkle" (Substation =
  jammer-immune drones; Airport = a leak also tanks your score; Stadium =
  urban/no-laser swarm; FOB = balanced). Energy/Substation is the intended
  opener.
- **Player:** picks a site.
- **Teaching:** different operational contexts → different right answers (a
  jammer is useless where the threat is fiber/autonomy controlled). Seeds the
  idea that there's no single silver-bullet device.
- **Code:** `Screens.levelSelect()`; site data in `src/sim/level.ts` (`LevelDef`).

### Beat 2 — Opening build (the first "lay-down")
- **Phase:** `build`.
- **On screen:** the hex field with the protected **asset at the centre**, a
  starting **radar + net-drone**, and a bottom **build dock** (palette of
  affordable devices, a "start wave" button). You tap the field to place.
- **Player:** spends a small starting budget placing a few sensors/effectors
  around 360°, then starts the wave.
- **Teaching:** you're the operator laying down a defensive grid. Money is tight
  → you can't buy everything → placement and matchup choices matter.
- **Code:** `Game.enterBuild()` / `refreshBuildDock()`; `Hud.showBuild()`;
  placement in `Game.handleFieldTap()`; economy + catalog in
  `src/sim/realtime/catalog.ts`.

### Beat 3 — The first real-time waves (friction, pre-coordination)
- **Phase:** `wave` (waves 1–2, **brain OFF**).
- **On screen:** drones spawn at the field edge and fly toward the asset from all
  bearings. Each drone shows its **kill chain** live: a bare red triangle
  (undetected) → an **amber arc that fills** as your sensors *classify* it → a
  **cyan lock ring** once it's a fire-control track. Your effectors auto-engage;
  kills throw gold "coins" up to the funds counter; leaks damage asset integrity.
- **Player:** watches, sweats the seams, can't build mid-wave (ops act = build
  between waves only — deliberate planning is part of the lesson).
- **Teaching (THE CORE, lived):** *without coordination*, the grid is dumb. Units
  fire at whatever's closest in their own range with **no fused picture**, so
  they **dogpile** one drone while others leak, and they **open fire on threats
  their weapon can't beat** (a jammer firing on an autonomy drone — a wasted
  shot, drawn as a miss). IDs are **slow** because each effector leans on a
  single sensor. It works… badly. That raggedness is the setup.
- **Code:** `stepWave()` in `src/sim/realtime/engine.ts` — the kill-chain
  (`detect → idConf → tracked`), the `coordinated` flag toggling fused vs.
  single-sensor classification and disciplined vs. wasteful targeting
  (`pickTarget`). Adaptive enemy biases spawns toward your weak bearings
  (`adaptWave` in `src/sim/realtime/adaptive.ts`). Render in
  `src/render/world.ts` (`drawDrones` draws the chain states).

### Beat 4 — Boss #1, "the wall" (brain OFF — the proof, part 1)
- **Phase:** `boss` (bossIndex 1).
- **On screen:** a full-screen **assignment console** (radial scope): the asset
  centred, **your placed devices ringed around it**, and 3–4 inbound threats in
  the outer band flying in. Mode banner reads **"⚠ NO COORDINATION — MANUAL."**
  Hit odds are **hidden ("?")**; there is **no optimal hint and no deconfliction
  warning**. You select a threat (tap it or its chip), then assign one sensor +
  one effector to it (tap the icons on the scope, or the side trays).
- **Player:** assigns under-informed, hits **Engage**, watches dice resolve.
- **The trap (spec §6.1):** there are fewer effectors than threats, and one
  threat is an **autonomy drone the jammer can't touch**. A cold player wastes
  the jammer on it and/or leaves a net-killable threat unengaged. Calibrated so a
  *reasonable* assignment **narrowly** wins and a blunder is **rescued to a
  narrow win** (`allowLoss: false`) — we never knock a visitor out cold, but it
  feels like luck, not mastery.
- **Teaching:** doing this *by hand, blind* is hard and unsatisfying. You want
  help. (This is the deliberate low before the turn.)
- **Code:** `Game.startBoss()`, `bossConfigFromLayout()`
  (`src/sim/realtime/schedule.ts` — builds the boss from the player's real
  layout, every device with its real stats). Console: `src/ui/bossConsole.ts`.
  Odds/resolution: `src/sim/boss/engine.ts` (`computeOdds`, `resolveEncounter`).

### Beat 5 — The unlock beat ("call for help")
- **Phase:** `unlock`.
- **On screen:** three operator lines rising in sequence — *"We held. Barely." →
  "Patch the units into the coordination layer — let them share tracks and call
  their shots together." → "Coordination online. Re-engage."* — then a
  **◈ COORDINATION ONLINE** boot graphic (shared tracks · deconflicted fire ·
  live hit odds).
- **Player:** taps **Re-engage**.
- **Teaching:** names the product. This is the explicit "here is the thing we
  sell" moment. It is currently **the single most important sales line in the
  game** and it is ~3 short strings.
- **Code:** `Screens.unlock()`; `Game.afterUnlock()` sets `brainUnlocked = true`.

### Beat 6 — Real-time waves, post-unlock (the lived contrast)
- **Phase:** `wave` (waves 3–5, **brain ON**).
- **On screen:** same field, but now classification snaps fast (fused sensors),
  effectors **deconflict** (brain-accent handoff lines flash sensor→effector),
  every shot is a good matchup, leaks drop, score climbs. A **"COORDINATION
  ACTIVE"** readout is lit.
- **Player:** builds between waves (recommendations now appear — see §3), fights.
- **Teaching:** **same hardware, better used.** The raggedness from Beat 3 is
  gone. This is the before/after the visitor *feels* in their hands.
- **Code:** same `stepWave()` with `coordinated = true`; handoff fx; brain
  recommendation card in the build dock (`recommendPlacement`).

### Beat 7 — Boss #2, "the catharsis" (brain ON — the proof, part 2)
- **Phase:** `boss` (bossIndex 2).
- **On screen:** the same console, mode banner **"◈ COORDINATION ONLINE."** Now:
  hit **odds are visible as %** on every option (VATS/XCOM-style pre-commit
  prediction), an **"Apply optimal plan"** button highlights the brain's
  provably-best assignment, deconfliction warnings call out double-tasked units,
  and a projected "X / N stopped" readout updates live.
- **Player:** sees the odds, applies (or beats) the optimal, engages → a **clean
  sweep**.
- **Teaching:** *the same class of fight you barely survived is now a confident
  win — because the brain shows you the odds, picks the optimal matchup, and
  deconflicts your fire.* This is the payoff of the whole pitch.
- **Code:** `computeOptimal()` (brute-forces the best assignment, bounded for
  speed); `computeOdds()` surfaces the legible factor breakdown; console renders
  the % previews + optimal highlight when `session.brain` is true.

### Beat 8 — The act break (hand-off to Act 2)
- **Phase:** `actbreak`.
- **On screen:** **"◈ COORDINATION PROVEN / Future Systems Online."** Three cards
  (directed-energy & plasma online · field on the fly · overwhelm inbound) and a
  **"Go loud"** button.
- **Player:** taps in; one prep build; then the endless arcade begins.
- **Teaching:** the sale is made; this is the explicit boundary between "product
  demo" and "fictional fun." Tier-3 weapons and mid-wave building unlock here.
- **Code:** `Screens.actBreak()`; `Game.afterBoss()` (boss #2 branch) sets
  `state.act = "arcade"`; `afterActBreak()` → prep build → `startArcade()`.

---

## 3. The systems that carry the message (and how each maps to the pitch)

The story is told mostly through **mechanics that behave differently with the
brain on**. Each system below is a place the sales point is (or could be) made.

### 3a. The kill chain — *detect → classify/ID → track → engage*
- Every threat has `detected` (a return), `idConf` (0..1 classification
  confidence), and `tracked` (fire-control track once `idConf ≥ 0.55`).
- **Classification only advances while a *capable* sensor covers the type** — an
  RF direction-finder cannot classify a non-emitting autonomy drone; radar barely
  sees a low-observable body. This is the legible matchup truth, now time-based.
- **Coordination fuses** every capable sensor's read (IDs land fast); without it,
  each effector leans on the single best sensor (slow, patchy).
- **Code:** `stepWave()` sensing loop; constants `ID_THRESHOLD/ID_GAIN/ID_DECAY`
  in `engine.ts`. Drone fields in `src/sim/realtime/types.ts`.
- **Sales mapping:** *a pile of sensors is not a picture.* The brain turns
  scattered returns into one fused, classified track — the precondition for a
  clean shot.

### 3b. Coordinated vs. uncoordinated engagement
- **Uncoordinated:** fire at the closest in-range drone, **no fused
  classification, no deconfliction** → dogpiling + wasted shots on bad matchups
  (drawn as misses).
- **Coordinated:** the grid hands each effector a confirmed track of a type it
  can beat → good-matchup only, deconflicted, more accurate. *Same hardware.*
- **Code:** `pickTarget(..., coordinated)`, the `claimed` deconfliction set, and
  the wasted-shot branch in `stepWave()`.
- **Guardrail:** the headless balance harness asserts coordinated play kills
  more, leaks less, and scores far ahead of brute-force/effectors-only spam
  (`balance.harness.test.ts`).

### 3c. The boss assignment minigame — the *explicit* proof
- Strips the real-time chaos down to a turn-based "which sensor tracks / which
  effector engages each threat" puzzle, fought on the player's actual layout.
- Boss #1 (brain off): odds hidden, no help → the wall.
  Boss #2 (brain on): odds visible, optimal highlighted, deconfliction → clean.
- **The teaching matchups (legible, never random):** RF jammer is devastating vs
  the RF quadcopter but **useless vs the autonomy drone** (ignores RF); RF-DF
  **cannot track** the autonomy drone; radar **barely sees** the low-observable
  (RF-DF tracks it best); the net-drone is the **reliable generalist** but
  short-ranged. So you never have enough of the right thing → prioritization
  bites → coordination is what wins.
- **Code:** `src/sim/boss/{data.ts,engine.ts,types.ts}`, `src/ui/bossConsole.ts`.

### 3d. The brain's three faces (spec §12)
1. **Real-time coordination** (waves, post-unlock): fused tracks + deconflicted
   fire — same hardware, better used.
2. **Boss optimization** (Boss #2): shows odds, picks the provably-optimal
   assignment, warns on conflicts.
3. **Between-round recommendations** (build, post-unlock): reads your layout and
   suggests the single best concrete fix ("the N approach is weakly covered —
   add a Net-Drone there"), measured by actual coverage gain. Suggest-and-accept.
- **Code:** `recommendPlacement()` in `adaptive.ts`; the rec card in `Hud`.

### 3e. Supporting systems
- **Economy / tiers:** Tier 1 grounded (radar, RF-DF, net, jammer) from the
  start; **Tier 2 near-future** (AESA, HPM, laser) unlocks after Boss #1; Tier 3
  fictional is gated to the arcade. `tierForBosses()`, `catalog.ts`.
- **Adaptive enemy:** waves bias spawns toward the player's coverage **seams**,
  ramping with wave index — messy layouts get punished; bosses feel like they hit
  weak spots. `seamWeakness()/adaptWave()`.
- **Terrain / line-of-sight:** blockers (structures) and no-fire zones (runways,
  crowds) make placement a spatial puzzle; sensors/effectors need clear LOS.
  `src/sim/terrain.ts`.
- **Score & leaderboard:** tracked (coordinated) kills score double; per-site
  boards; a printable one-page takeaway with a conversion handoff.

---

## 4. Code backend / architecture (for precise editing)

Pure, deterministic **simulation** is kept separate from **rendering** so the
logic is testable headless.

```
src/
  game.ts                  # CONTROLLER: state machine, fixed-timestep loop,
                           #   phase transitions, boss flow, build/wave, attract.
                           #   Key methods: enterBuild, startScheduleEntry,
                           #   stepWavePhase, startBoss/afterBoss, afterUnlock,
                           #   afterActBreak, startArcade/rollArcadeWave, endRun.
  sim/                     # pure TS, no Pixi, deterministic (seedable RNG)
    state.ts               # GameState + AppPhase (title|build|wave|boss|unlock|
                           #   actbreak|summary) + Act ("ops"|"arcade").
    level.ts               # the four sites as data, incl. the ops SCHEDULE:
                           #   wave,wave,BOSS_1,wave,wave,wave,BOSS_2,(→arcade)
    hex.ts / terrain.ts    # grid math; blockers + no-fire LOS sampling
    boss/
      data.ts              # threat/sensor/effector tables + BOSS_1 / BOSS_2
      engine.ts            # computeOdds, computeOptimal, resolveEncounter
      types.ts             # boss domain types (DeviceUnit carries resolved stats)
    realtime/
      catalog.ts           # devices (stats, tiers, upgrades), drone specs
      engine.ts            # stepWave: spawn, move, KILL CHAIN, engage, leaks
      schedule.ts          # makeWave, ScheduleEntry, bossConfigFromLayout,
                           #   tierForBosses, makeArcadeWave/offsetWave (Act 2)
      adaptive.ts          # seam map: adaptWave (enemy) + recommendPlacement
      types.ts             # Drone/PlacedDevice/SpawnMods/WaveDef/RealtimeState
  render/world.ts          # PixiJS world: hex ground, asset, coverage, devices,
                           #   drones (kill-chain visuals), fx, coins, vignette
  ui/
    screens.ts             # title, levelSelect, unlock, actBreak, arcadeOver, summary
    bossConsole.ts         # the radial assignment console (tap-to-assign)
    hud.ts                 # status bar + build/reinforce dock + rec card
    leaderboard.ts / takeaway.ts
  theme.ts                 # colour & signal language (friendly=cool, threat=warm,
                           #   brain=cyan/gold used ONLY for coordination)
```

**State machine (Act 1):**
`title → levelSelect → build ⇄ wave (×2) → boss(1, brain off) → unlock →
build ⇄ wave (×3) → boss(2, brain on) → actbreak → [Act 2 arcade]`

- `brainUnlocked` flips **true** in `afterUnlock()` (after Boss #1). It gates the
  real-time `coordinated` flag, the boss #2 brain features, and recommendations.
- `state.act` flips to `"arcade"` in `afterBoss()` (Boss #2 branch).
- Per-frame: `installLoop()` runs `fixedStep()` (sim) then `world.update()` +
  `hud.update()`.

**Determinism:** `mulberry32` RNG (`sim/rng.ts`); the sim never reads wall-clock.
Headless tests in `*.test.ts` (engine matchups, boss calibration, balance
guardrails, kill-chain, recommendations).

---

## 5. Where the story is THIN today (the real work)

The mechanics encode the message, but the **scripted narrative is minimal**. Honest gaps:

1. **The value prop is shown but barely *narrated*.** The only story copy is the
   title, the 3-line unlock beat, and the act break. A visitor who isn't paying
   close attention may feel "I lost, then I won" without articulating *why*
   ("because the brain fused my sensors and called my shots"). There is no
   explicit, in-the-moment "look what just changed" callout.
2. **No operator/customer fiction.** There's no named operator, no "your sector
   is under attack" framing, no stakes beyond an abstract "asset." The pitch
   would hit harder with a thin human/operational wrapper (a voice, a sit-rep).
3. **The before/after in the real-time waves is implicit.** The contrast between
   Beat 3 (ragged) and Beat 6 (clean) is *felt* but never *stated*. A side-by-side
   stat ("pre-coordination: 8 leaks / 40% wasted shots → post: 1 leak / 0 wasted")
   would convert the feeling into a claim.
4. **The boss is a context-switch.** It's the clearest proof but it yanks the
   player out of the map into an abstract console. The link "this is *your*
   layout being fought" is stated once and easy to miss.
5. **Two bosses, similar framing.** Boss #1 and #2 are deliberately the same
   fight; the script doesn't dramatize the *stakes* rising or personalize the
   wall→catharsis turn beyond three lines.
6. **The conversion hand-off is light.** The end/takeaway nods at "ask the team"
   but there's no crisp, repeatable one-liner the visitor walks away repeating.
7. **Pacing of the message vs. the toys.** Tier-2 gear unlocks mid-Act-1, which
   is fun but slightly muddies "Act 1 = realistic pitch." Worth deciding whether
   Act 1 should stay strictly grounded.

## 6. Levers available to sharpen Act 1 (what Claude AI can help script)

These are the knobs/surfaces that exist or are cheap to add:

- **Narrative screens** (`src/ui/screens.ts`): title, unlock, act break — copy is
  trivial to rewrite/extend; new interstitials are cheap. Timed line reveals
  already supported (see `.op-line` animation).
- **In-wave callouts / toasts:** we can flash short operator lines or stat banners
  at scripted moments (e.g., the instant coordination turns on) — there's already
  a toast/flash pattern (`flashThreatLevel`, staff toast).
- **A before/after panel:** the engine already tallies kills/leaks and we can
  cheaply tally *wasted shots* and *avg time-to-track*; surfacing a
  pre-/post-coordination comparison is a data+UI task, not new simulation.
- **Boss framing copy:** the console header/subtext and result verdicts
  (`bossConsole.ts`) are free text; we can make the wall→catharsis turn explicit.
- **Operator fiction:** a lightweight "sit-rep" line per beat (site, threat axis,
  status) would wrap the abstract asset in stakes — pure copy + a HUD slot.
- **Tutorialization:** the first build/wave could include a one-tap guided
  placement so a cold visitor doesn't flail (currently they're dropped in).
- **Pacing knobs:** ops wave counts/mix per site (`level.ts`), tier-unlock timing
  (`tierForBosses`), boss calibration (`boss/data.ts`).
- **Theme/signal language** (`theme.ts`): the brain accent (cyan/gold) is reserved
  for coordination — leaning on it harder visually reinforces "this is the brain."

### Good questions for the scripting pass
- What is the **single sentence** we want every visitor to repeat afterward?
- Who is the **operator** (if any), and how thin can the fiction be while still
  raising stakes?
- Do we **state** the before/after (stats/copy) or keep it felt?
- Should Act 1 stay **strictly grounded** (defer all near-future gear to a
  mid-point) to keep "realistic pitch" clean?
- How much **tutorial** does a 30-second-attention booth visitor need?
- What's the **conversion CTA** at the end — and is it on the takeaway, the
  screen, or both?

---

*Source of truth for intent: `CUAS_TRADESHOW_GAME_SPEC.md`. This storyboard
reflects the implementation as of the arcade-survival build.*
