/**
 * Game controller (spec §2, §5, §6) — owns the authoritative state, the
 * fixed-timestep loop, and the phase transitions that drive the run:
 *
 *   title → build → wave → build → … → boss(off) → unlock → … → boss(on)
 *         → … → summary (score), or summary early if the asset is overrun.
 *
 * It wires the Pixi world, the real-time engine, the build/wave HUD, the boss
 * console, and the narrative screens. Boss fights are built from the layout the
 * player placed (spec §14 Phase 2).
 */
import { Application } from "pixi.js";
import { Rng, timeSeed } from "./sim/rng.ts";
import { ringDistance, hexKey, hexRing, type Hex } from "./sim/hex.ts";
import { LEVEL_1, LEVELS, type LevelDef } from "./sim/level.ts";
import { buildTerrain, isBlockedForBuild, type TerrainMap } from "./sim/terrain.ts";
import {
  createInitialState,
  makePlaced,
  upgradeDevice,
  type BossSession,
  type GameState,
} from "./sim/state.ts";
import { placeableById, nextUpgrade, TRACKED_KILL_BONUS } from "./sim/realtime/catalog.ts";
import { createRealtimeState } from "./sim/realtime/types.ts";
import { stepWave } from "./sim/realtime/engine.ts";
import { bossConfigFromLayout, makeArcadeWave, offsetWave, tierForBosses } from "./sim/realtime/schedule.ts";
import { adaptWave, recommendPlacement, type Recommendation } from "./sim/realtime/adaptive.ts";
import { computeOptimal, emptyAssignment, resolveEncounter } from "./sim/boss/engine.ts";
import { WorldRenderer } from "./render/world.ts";
import { BossConsole } from "./ui/bossConsole.ts";
import { Screens, type BeforeAfter } from "./ui/screens.ts";
import { Hud } from "./ui/hud.ts";
import { Operator } from "./ui/operator.ts";
import { LeaderboardUI } from "./ui/leaderboard.ts";
import type { RunStats } from "./leaderboard/rules.ts";

const FIXED_DT = 1 / 60;
const SELL_REFUND = 0.6;

export class Game {
  private state: GameState;
  private world: WorldRenderer;
  private console: BossConsole;
  private screens: Screens;
  private hud: Hud;
  private operator = new Operator();
  private leaderboard: LeaderboardUI;
  /** Scripted Act-1 operator lines fire once per run (guard against replays). */
  private said = new Set<string>();
  private rng: Rng;
  private accumulator = 0;
  private currentBossIndex: 1 | 2 | null = null;
  private pointerHex: Hex | null = null;
  private currentRec: Recommendation | null = null;
  private recDismissed = false;
  private terrain: TerrainMap = new Map();

  // Booth hardening (spec §14 Phase 7).
  private overlay: HTMLElement;
  private attract = false;
  private lastInput = 0;
  private attractTimer: number | null = null;
  private fullscreenArmed = false;
  private attractLevelCursor = 0;
  private staffPanel: HTMLElement | null = null;
  private static readonly IDLE_MS = 35_000;
  private static readonly ATTRACT_STEP_MS = 1100;

  constructor(overlay: HTMLElement) {
    this.overlay = overlay;
    this.state = createInitialState(LEVEL_1);
    this.rng = new Rng(timeSeed());
    this.world = new WorldRenderer();
    this.console = new BossConsole(overlay, {
      onSelectThreat: (id) => this.bossSelectThreat(id),
      onAssignSensor: (id) => this.bossAssign("sensor", id),
      onAssignEffector: (id) => this.bossAssign("effector", id),
      onApplyOptimal: () => this.bossApplyOptimal(),
      onEngage: () => this.bossEngage(),
      onContinue: () => this.afterBoss(),
    });
    this.screens = new Screens(overlay, {
      onStart: () => this.startRun(),
      onUnlockContinue: () => this.afterUnlock(),
      onActBreakContinue: () => this.afterActBreak(),
      onArcadeOverContinue: () => this.proceedToSubmit(),
      onRestart: () => this.restart(),
    });
    this.hud = new Hud(overlay, {
      onSelectPlaceable: (id) => this.selectPlaceable(id),
      onStartWave: () => this.startScheduleEntry(),
      onSell: (id) => this.sell(id),
      onAcceptRec: () => this.acceptRecommendation(),
      onDismissRec: () => this.dismissRecommendation(),
      onUpgradeDevice: () => this.upgradeSelectedDevice(),
      onSellDevice: () => this.sellSelectedDevice(),
      onCloseDevice: () => this.closeDevicePanel(),
    });
    this.leaderboard = new LeaderboardUI(overlay, { onRestart: () => this.restart() });
  }

  async start(host: HTMLElement): Promise<void> {
    await this.world.init(host);
    this.world.drawStatic(this.state);
    this.installLoop(this.world.app);
    this.installInput();
    this.installBooth();
    // Dedicated second-screen attract display: index.html?display=board
    if (new URLSearchParams(location.search).get("display") === "board") {
      this.state.phase = "summary"; // park the sim; just show the live board
      this.leaderboard.showLive(this.state.level.id);
      return;
    }
    this.goTitle();
  }

  // ---- fixed-timestep loop ----------------------------------------------

  private installLoop(app: Application): void {
    app.ticker.add((ticker) => {
      this.accumulator += ticker.deltaMS / 1000;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < 5) {
        this.fixedStep(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }
      this.world.setSelected(this.state.selectedDeviceId);
      this.world.update(this.state);
      if (this.state.phase === "build" || this.state.phase === "wave") {
        this.hud.update(this.state);
        // Arcade mid-wave dock: keep weapon affordability live as kills pay out.
        if (this.state.phase === "wave" && this.state.act === "arcade") this.hud.refreshAffordability(this.state);
      }
    });
  }

  private fixedStep(dt: number): void {
    this.state.time += dt;
    if (this.state.phase === "wave") this.stepWavePhase(dt);
  }

  private stepWavePhase(dt: number): void {
    const s = this.state;
    if (!s.rt || !s.activeWave) return;
    const coordinated = s.brainUnlocked && !s.brainStaffDisabled;
    const res = stepWave(s.rt, s.placed, s.activeWave, dt, this.rng, { spawnRadius: this.world.spawnRadius(s), coordinated, terrain: this.terrain });

    for (const k of res.kills) {
      s.currency += k.bounty;
      // Scoring rewards coordination: a tracked kill is worth more (spec §8).
      s.score += k.bounty * (k.tracked ? TRACKED_KILL_BONUS : 1.0);
      s.kills++;
    }
    for (const lk of res.leaks) {
      s.integrity -= lk.damage;
      s.leaked++;
      // Airport wrinkle (spec §9): a leak also disrupts operations → score hit.
      s.score = Math.max(0, s.score - s.level.leakScorePenalty);
    }
    // Bucket the kill-chain tallies by coordination state (ACT1 spec §3) — only
    // through Act 1 (the arcade is out of scope for the before/after proof).
    if (s.act === "ops") {
      const w = s.brainUnlocked ? s.coordStats.post : s.coordStats.pre;
      w.leaks += res.leaks.length;
      w.shotsFired += res.shotsFired;
      w.shotsWasted += res.shotsWasted;
      for (const t of res.idTimes) { w.idSum += t; w.idCount++; }
    }
    if (s.integrity <= 0) {
      s.integrity = 0;
      this.endRun(false);
      return;
    }
    if (s.act === "arcade") {
      // Endless rolling escalation: the instant the current batch has finished
      // SPAWNING, the next (harder) batch is queued — so pressure never lets up
      // and the only way out is to be overwhelmed.
      if (s.rt.spawnCursor >= s.activeWave.spawns.length) this.rollArcadeWave();
    } else if (res.waveComplete) {
      this.completeWave();
    }
  }

  // ---- phase transitions -------------------------------------------------

  private goTitle(): void {
    this.state.phase = "title";
    this.state.boss = null;
    this.state.rt = null;
    this.console.clear();
    this.hud.clear();
    this.operator.reset();
    this.leaderboard.clear();
    this.screens.title();
  }

  /** Title "Begin" → choose a site (spec §9 — sites are the progression). */
  private startRun(): void {
    this.showLevelSelect();
  }

  private showLevelSelect(): void {
    this.console.clear();
    this.hud.clear();
    this.leaderboard.clear();
    this.screens.levelSelect(LEVELS, (lvl) => this.startRunOnLevel(lvl));
  }

  private startRunOnLevel(level: LevelDef): void {
    const staffDisabled = this.state.brainStaffDisabled;
    this.state = createInitialState(level);
    this.state.brainStaffDisabled = staffDisabled;
    this.terrain = buildTerrain(level.terrain);
    this.currentBossIndex = null;
    this.said.clear();
    this.world.drawStatic(this.state);
    this.screens.clear();
    // VEGA comes on station: site + stakes (ACT1 spec §2).
    this.operator.reset();
    this.operator.setSitrep(level.name, "grid online");
    this.operator.say(level.stakes);
    this.enterBuild();
  }

  /** Fire a scripted operator line at most once per run. */
  private sayOnce(key: string, text: string, opts: { ms?: number; accent?: boolean } = {}): void {
    if (this.said.has(key)) return;
    this.said.add(key);
    this.operator.say(text, opts);
  }

  /** Between-waves build phase (spec §13: between-waves only). */
  private enterBuild(): void {
    const s = this.state;
    s.phase = "build";
    s.rt = null;
    s.activeWave = null;
    this.console.clear();
    s.maxTier = tierForBosses(s.bossesBeaten);
    s.selectedDeviceId = null;
    // Arcade act: there is no fixed schedule left — this is the single PREP
    // window before the endless onslaught begins. (No recommendation card; the
    // arcade is reflex, not planning.)
    if (s.act === "arcade") {
      this.recDismissed = true;
      this.operator.setSitrep(s.level.name, "arsenal hot · deploy");
      this.refreshBuildDock();
      return;
    }
    if (s.scheduleIndex >= s.level.schedule.length) {
      this.endRun(true);
      return;
    }
    this.recDismissed = false;
    this.operator.setSitrep(s.level.name, s.brainUnlocked ? "coordination active · build" : "grid hot · build");
    this.refreshBuildDock();
  }

  /** Recompute the brain recommendation (after unlock) and (re)render the dock. */
  private refreshBuildDock(): void {
    const s = this.state;
    const midWave = s.phase === "wave" && s.act === "arcade";
    if (s.phase !== "build" && !midWave) return;
    // Recommendations are a between-waves planning aid only (not mid-fight).
    this.currentRec =
      !midWave && s.brainUnlocked && !s.brainStaffDisabled && !this.recDismissed
        ? recommendPlacement(s.placed, s.currency, this.world.spawnRadius(s), s.level.rings, this.terrain, new Set(this.terrain.keys()))
        : null;
    this.hud.showBuild(s, this.nextEntryLabel(), this.currentRec, midWave);
  }

  private nextEntryLabel(): string {
    if (this.state.act === "arcade") return "◆ BEGIN THE ONSLAUGHT";
    const entry = this.state.level.schedule[this.state.scheduleIndex];
    if (!entry) return "Finish";
    if (entry.type === "boss") return `⚠ Boss attack — Step ${this.state.scheduleIndex + 1}`;
    return `Start ${entry.wave.label}`;
  }

  /** Player pressed "start" in the build dock → run the next schedule entry. */
  private startScheduleEntry(): void {
    const s = this.state;
    if (s.act === "arcade") {
      this.startArcade();
      return;
    }
    const entry = s.level.schedule[s.scheduleIndex];
    if (!entry) {
      this.endRun(true);
      return;
    }
    if (entry.type === "wave") {
      s.phase = "wave";
      s.rt = createRealtimeState();
      // Adaptive enemy: bias this wave's spawns toward the layout's seams.
      s.activeWave = adaptWave(entry.wave, s.placed, this.world.spawnRadius(s), this.rng, this.terrain);
      for (const d of s.placed) d.cooldown = 0;
      s.selectedDeviceId = null;
      s.selectedPlaceable = null;
      this.world.setGhost(null);
      // Ops act builds between waves only — the dock closes for the fight.
      this.hud.hideBuild();
      this.operator.setSitrep(s.level.name, "threat inbound");
      // Beat 3 — name the raggedness on the very first wave (plants the problem
      // the unlock will answer). Post-unlock, name the lived difference once.
      if (!s.brainUnlocked) {
        this.sayOnce("ragged", "Units are doing their best, but they're not talking to each other. It's messy.");
      } else {
        this.sayOnce("fused", "Tracks are fused — every shooter's working off one picture now.", { accent: true });
        this.sayOnce("samegear", "Same units. Now they're one system. Feel the difference.");
      }
    } else {
      this.startBoss(entry.bossIndex);
    }
  }

  private completeWave(): void {
    const s = this.state;
    if (s.activeWave) {
      s.currency += s.activeWave.stipend;
      s.score += s.activeWave.stipend * 0.4;
      s.wavesSurvived++;
    }
    s.scheduleIndex++;
    this.enterBuild();
  }

  // ---- arcade survival (post-Boss-#2 endless mode) -----------------------

  /** Kick off the endless arcade: the first wave, then it rolls forever. */
  private startArcade(): void {
    const s = this.state;
    s.phase = "wave";
    s.arcadeWave = 1;
    s.rt = createRealtimeState();
    s.activeWave = adaptWave(makeArcadeWave(1), s.placed, this.world.spawnRadius(s), this.rng, this.terrain);
    for (const d of s.placed) d.cooldown = 0;
    s.selectedDeviceId = null;
    this.world.setGhost(null);
    this.refreshBuildDock(); // mid-wave reinforce dock
    this.flashThreatLevel(1);
  }

  /** Queue the next, harder arcade batch (offset so it spawns from "now"). */
  private rollArcadeWave(): void {
    const s = this.state;
    if (!s.rt) return;
    s.arcadeWave++;
    s.wavesSurvived++;
    // Survival payout so the player can keep buying tier-3 mid-fight (income
    // deliberately can't outrun the escalation forever).
    const reward = 30 + s.arcadeWave * 10;
    s.currency += reward;
    s.score += reward * 0.5;
    const next = adaptWave(makeArcadeWave(s.arcadeWave), s.placed, this.world.spawnRadius(s), this.rng, this.terrain);
    s.activeWave = offsetWave(next, s.rt.time + 0.3);
    s.rt.spawnCursor = 0;
    this.flashThreatLevel(s.arcadeWave);
    this.refreshBuildDock();
  }

  /** A brief centre-screen "THREAT LEVEL N" pulse as each arcade wave rolls in. */
  private flashThreatLevel(n: number): void {
    let el = document.getElementById("threat-flash");
    if (!el) {
      el = document.createElement("div");
      el.id = "threat-flash";
      document.body.append(el);
    }
    el.innerHTML = `<div class="tf-k">THREAT LEVEL</div><div class="tf-n">${n}</div>`;
    el.classList.remove("show");
    void el.offsetWidth; // restart the animation
    el.classList.add("show");
  }

  // ---- boss flow (Phase 1 console, on the built layout) ------------------

  private startBoss(bossIndex: 1 | 2): void {
    const s = this.state;
    const cfg = bossConfigFromLayout(s.placed, bossIndex);
    const brain = bossIndex === 2 && s.brainUnlocked && !s.brainStaffDisabled;
    const session: BossSession = {
      cfg,
      brain,
      map: emptyAssignment(cfg),
      optimal: brain ? computeOptimal(cfg) : null,
      result: null,
      selectedThreatId: cfg.threats[0]?.id ?? null,
    };
    this.currentBossIndex = bossIndex;
    s.phase = "boss";
    s.boss = session;
    this.hud.clear();
    this.operator.setSitrep(s.level.name, bossIndex === 1 ? "coordinated strike — manual" : "coordinated strike — brain online");
    this.console.render(session);
  }

  private afterBoss(): void {
    const s = this.state;
    const session = s.boss;
    if (!session) return;
    // Boss performance feeds the score (clean assignments score higher).
    if (session.result) {
      s.score += session.result.stopped * 120;
    }
    s.bossesBeaten++;
    // Full-screen narrative beats carry their own copy — quiet the operator HUD.
    this.operator.clearLines();
    this.operator.hideSitrep();
    if (this.currentBossIndex === 1) {
      s.log.boss1 = session.result ?? undefined;
      s.phase = "unlock";
      this.console.clear();
      this.screens.unlock();
    } else {
      // Boss #2 cleared → coordination is proven. Cross the act break into the
      // fictional arcade act (tier-3 gear + build-on-the-fly).
      s.log.boss2 = session.result ?? undefined;
      this.console.clear();
      this.hud.clear();
      s.act = "arcade";
      s.phase = "actbreak";
      this.screens.actBreak(this.beforeAfterStats());
    }
  }

  /** The player's own pre/post-coordination numbers for the act-break panel. */
  private beforeAfterStats(): BeforeAfter {
    const { pre, post } = this.state.coordStats;
    const wasted = (w: { shotsFired: number; shotsWasted: number }) =>
      w.shotsFired > 0 ? `${Math.round((100 * w.shotsWasted) / w.shotsFired)}%` : "—";
    const ttid = (w: { idSum: number; idCount: number }) =>
      w.idCount > 0 ? `${(w.idSum / w.idCount).toFixed(1)}s` : "—";
    return {
      leaks: [String(pre.leaks), String(post.leaks)],
      wasted: [wasted(pre), wasted(post)],
      timeToId: [ttid(pre), ttid(post)],
    };
  }

  private afterUnlock(): void {
    const s = this.state;
    s.brainUnlocked = true;
    this.screens.clear();
    s.scheduleIndex++;
    this.enterBuild();
  }

  /** Continue out of the "Future Systems Online" act break into the arcade act. */
  private afterActBreak(): void {
    this.screens.clear();
    this.state.scheduleIndex++;
    this.enterBuild();
  }

  private endRun(victory: boolean): void {
    const s = this.state;
    s.victory = victory;
    const arcade = s.act === "arcade";
    s.phase = "summary";
    s.rt = null;
    // In the attract demo, don't prompt for a score — just loop to the next run.
    if (this.attract) {
      this.startAttractDemo();
      return;
    }
    this.console.clear();
    this.hud.clear();
    this.operator.reset();
    this.world.setGhost(null);
    // Arcade ends only by being overwhelmed — show the "you survived to Wave N"
    // beat first, then the score submission.
    if (arcade) {
      this.screens.arcadeOver(s.arcadeWave, Math.floor(s.score));
      return;
    }
    this.proceedToSubmit();
  }

  /** Build the run stats and open the score-submission flow. */
  private proceedToSubmit(): void {
    const s = this.state;
    this.screens.clear();
    const stats: RunStats = {
      levelId: s.level.id,
      score: s.score,
      wavesSurvived: s.wavesSurvived,
      kills: s.kills,
      leaked: s.leaked,
      spent: s.spent,
      integrity: Math.max(0, Math.round(s.integrity)),
      victory: s.victory,
      boss1Stopped: s.log.boss1?.stopped ?? 0,
      boss2Stopped: s.log.boss2?.stopped ?? 0,
    };
    this.leaderboard.showSubmit(stats);
  }

  /** "Play again" → back to site select (replayability, spec §9). */
  private restart(): void {
    this.world.setGhost(null);
    this.showLevelSelect();
  }

  // ---- build input (place / sell on the hex field) -----------------------

  private selectPlaceable(id: string): void {
    this.state.selectedPlaceable = this.state.selectedPlaceable === id ? null : id;
    this.state.selectedDeviceId = null;
    this.refreshBuildDock();
  }

  /** Upgrade the currently-selected placed device (spec §7 within-class path). */
  private upgradeSelectedDevice(): void {
    const s = this.state;
    const dev = s.placed.find((d) => d.id === s.selectedDeviceId);
    if (!dev) return;
    const p = placeableById(dev.placeableId);
    const step = p ? nextUpgrade(p, dev.level) : null;
    if (!step || s.currency < step.cost) return;
    s.currency -= step.cost;
    s.spent += step.cost;
    upgradeDevice(dev);
    this.refreshBuildDock();
  }

  private sellSelectedDevice(): void {
    const s = this.state;
    const dev = s.placed.find((d) => d.id === s.selectedDeviceId);
    if (dev) {
      this.sell(dev.id);
      s.selectedDeviceId = null;
    }
    this.refreshBuildDock();
  }

  private closeDevicePanel(): void {
    this.state.selectedDeviceId = null;
    this.refreshBuildDock();
  }

  /** Accept the brain's suggestion: place the recommended device (spec §12 face 3). */
  private acceptRecommendation(): void {
    const s = this.state;
    const rec = this.currentRec;
    if (!rec) return;
    const p = placeableById(rec.placeableId);
    if (!p || s.currency < p.cost) return;
    if (s.placed.some((d) => hexKey(d.hex) === hexKey(rec.hex))) return;
    s.currency -= p.cost;
    s.spent += p.cost;
    s.placed.push(makePlaced(p.id, rec.hex));
    this.refreshBuildDock();
  }

  private dismissRecommendation(): void {
    this.recDismissed = true;
    this.refreshBuildDock();
  }

  /**
   * Can the player place/manage devices right now? Between waves always; DURING
   * a wave only in the arcade act (build-on-the-fly is the late-game payoff —
   * the realistic ops act keeps building to the planning window on purpose).
   */
  private canBuild(): boolean {
    const p = this.state.phase;
    return p === "build" || (p === "wave" && this.state.act === "arcade");
  }

  private installInput(): void {
    const canvas = this.world.app.canvas;
    const toHex = (e: PointerEvent): Hex => {
      const rect = canvas.getBoundingClientRect();
      return this.world.screenToHex(e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener("pointerdown", (e) => {
      if (!this.canBuild()) return;
      this.handleFieldTap(toHex(e as PointerEvent));
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.canBuild()) return;
      this.pointerHex = toHex(e as PointerEvent);
      this.updateGhost();
    });
    canvas.addEventListener("pointerleave", () => {
      this.pointerHex = null;
      this.world.setGhost(null);
    });
  }

  private handleFieldTap(hex: Hex): void {
    if (this.attract) return; // attract taps exit the demo, never place
    const s = this.state;
    const occupant = s.placed.find((d) => hexKey(d.hex) === hexKey(hex));
    if (occupant) {
      // Tap a placed device → open its upgrade/sell panel (toggle).
      s.selectedDeviceId = s.selectedDeviceId === occupant.id ? null : occupant.id;
      s.selectedPlaceable = null;
      this.world.setGhost(null);
      this.refreshBuildDock();
      return;
    }
    if (s.selectedDeviceId) {
      s.selectedDeviceId = null;
      this.refreshBuildDock();
      return;
    }
    if (!s.selectedPlaceable) return;
    if (!this.isPlaceable(hex)) return;
    const p = placeableById(s.selectedPlaceable);
    if (!p || s.currency < p.cost) return;
    s.currency -= p.cost;
    s.spent += p.cost;
    s.placed.push(makePlaced(p.id, hex));
    // Deselect if the next one is no longer affordable, else keep placing.
    if (s.currency < p.cost) s.selectedPlaceable = null;
    this.refreshBuildDock();
    this.updateGhost();
  }

  private sell(deviceId: string): void {
    const s = this.state;
    const idx = s.placed.findIndex((d) => d.id === deviceId);
    if (idx < 0) return;
    const dev = s.placed[idx];
    const p = placeableById(dev.placeableId);
    if (p) {
      // Refund a fraction of everything invested — base + applied upgrades.
      let invested = p.cost;
      for (let i = 0; i < dev.level && i < p.upgrades.length; i++) invested += p.upgrades[i].cost;
      s.currency += Math.floor(invested * SELL_REFUND);
    }
    s.placed.splice(idx, 1);
    this.refreshBuildDock();
  }

  private isPlaceable(hex: Hex): boolean {
    const s = this.state;
    if (ringDistance(hex) === 0) return false; // centre is the asset
    if (ringDistance(hex) > s.level.rings) return false; // off-field
    if (isBlockedForBuild(this.terrain, hex)) return false; // structure / no-fire zone
    return !s.placed.some((d) => hexKey(d.hex) === hexKey(hex));
  }

  private updateGhost(): void {
    const s = this.state;
    if (!this.canBuild() || !s.selectedPlaceable || !this.pointerHex) {
      this.world.setGhost(null);
      return;
    }
    const p = placeableById(s.selectedPlaceable);
    if (!p) return;
    const occupied = s.placed.some((d) => hexKey(d.hex) === hexKey(this.pointerHex!));
    this.world.setGhost({
      placeableId: p.id,
      hex: this.pointerHex,
      radius: p.radius,
      kind: p.kind,
      valid: this.isPlaceable(this.pointerHex) && !occupied && s.currency >= p.cost,
    });
  }

  // ---- boss interactions (delegate to the session) -----------------------

  private renderBoss(): void {
    if (this.state.boss) this.console.render(this.state.boss);
  }

  private bossSelectThreat(id: string): void {
    if (!this.state.boss) return;
    this.state.boss.selectedThreatId = this.state.boss.selectedThreatId === id ? null : id;
    this.renderBoss();
  }

  private bossAssign(kind: "sensor" | "effector", deviceId: string): void {
    const s = this.state.boss;
    if (!s || !s.selectedThreatId) return;
    const sel = s.selectedThreatId;
    const cur = s.map[sel];
    const field = kind === "sensor" ? "sensorId" : "effectorId";
    if (cur[field] === deviceId) {
      cur[field] = null;
    } else {
      for (const t of s.cfg.threats) if (s.map[t.id][field] === deviceId) s.map[t.id][field] = null;
      cur[field] = deviceId;
    }
    this.renderBoss();
  }

  private bossApplyOptimal(): void {
    const s = this.state.boss;
    if (!s || !s.optimal) return;
    for (const t of s.cfg.threats) s.map[t.id] = { ...s.optimal[t.id] };
    this.renderBoss();
  }

  private bossEngage(): void {
    const s = this.state.boss;
    if (!s || s.result) return;
    s.result = resolveEncounter(s.cfg, s.map, this.rng);
    this.renderBoss();
  }

  // ---- booth hardening (spec §14 Phase 7) --------------------------------

  private installBooth(): void {
    this.lastInput = Date.now();
    // Any input refreshes the idle clock and exits the attract demo. Capture
    // phase so it runs before the canvas placement handler.
    window.addEventListener("pointerdown", () => this.onUserInput(), true);
    window.addEventListener("keydown", (e) => this.onBoothKey(e), true);
    // Kiosk input hardening: no right-click menu, pinch-zoom, or double-tap zoom.
    window.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("gesturestart", (e) => e.preventDefault());
    document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });
    window.setInterval(() => this.checkIdle(), 2000);
  }

  private onUserInput(): void {
    this.lastInput = Date.now();
    this.armFullscreen();
    if (this.attract) this.exitAttract();
  }

  private onBoothKey(e: KeyboardEvent): void {
    this.lastInput = Date.now();
    const k = e.key.toLowerCase();
    if (this.attract) {
      this.exitAttract();
      return;
    }
    if (k === "l" && (this.state.phase === "title" || this.leaderboard.liveActive)) {
      if (this.leaderboard.liveActive) this.goTitle();
      else this.leaderboard.showLive(this.state.level.id);
    } else if (k === "b") {
      this.toggleBrain();
    } else if (k === "s") {
      this.toggleStaffPanel();
    }
  }

  /** Kiosk fullscreen + landscape lock — requested on the first user gesture. */
  private armFullscreen(): void {
    if (this.fullscreenArmed) return;
    this.fullscreenArmed = true;
    document.documentElement.requestFullscreen?.().catch(() => {});
    try {
      (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.("landscape").catch(() => {});
    } catch {
      /* desktop / unsupported — ignore */
    }
  }

  private checkIdle(): void {
    if (this.attract) return;
    if (Date.now() - this.lastInput > Game.IDLE_MS) this.enterAttract();
  }

  // ---- attract mode (auto-playing demo) ----------------------------------

  private enterAttract(): void {
    if (this.attract) return;
    this.attract = true;
    this.attractLevelCursor = 0;
    this.operator.setMuted(true); // the bot doesn't need a voice
    this.startAttractDemo();
    this.attractTimer = window.setInterval(() => this.attractTick(), Game.ATTRACT_STEP_MS);
  }

  private exitAttract(): void {
    if (!this.attract) return;
    this.attract = false;
    this.operator.setMuted(false);
    if (this.attractTimer !== null) {
      window.clearInterval(this.attractTimer);
      this.attractTimer = null;
    }
    this.hideAttractOverlay();
    this.state.rt = null;
    this.state.phase = "title"; // so the same tap can't also place a device
    this.showLevelSelect();
  }

  private startAttractDemo(): void {
    const level = LEVELS[this.attractLevelCursor % LEVELS.length];
    this.attractLevelCursor++;
    this.startRunOnLevel(level);
    this.showAttractOverlay();
  }

  /** One step of the bot: advance whatever phase the demo is in. */
  private attractTick(): void {
    if (!this.attract) return;
    switch (this.state.phase) {
      case "build":
        this.attractBuild();
        break;
      case "boss":
        this.attractBoss();
        break;
      case "unlock":
        this.afterUnlock();
        break;
      case "actbreak":
        this.afterActBreak();
        break;
      case "title":
      case "summary":
        this.startAttractDemo();
        break;
      // "wave" → just watch it play out.
    }
    this.showAttractOverlay(); // keep the badge on top through re-renders
  }

  private attractBuild(): void {
    if (this.currentRec) this.acceptRecommendation();
    this.attractPlace("radar");
    this.attractPlace("net-drone");
    this.attractPlace("net-drone");
    this.startScheduleEntry();
  }

  private attractPlace(id: string): boolean {
    const s = this.state;
    const p = placeableById(id);
    if (!p || s.currency < p.cost) return false;
    for (const ring of [2, 3, 4]) {
      for (const h of hexRing(ring)) {
        if (this.isPlaceable(h)) {
          s.currency -= p.cost;
          s.spent += p.cost;
          s.placed.push(makePlaced(id, h));
          return true;
        }
      }
    }
    return false;
  }

  private attractBoss(): void {
    const s = this.state.boss;
    if (!s) return;
    if (s.result) {
      this.afterBoss();
      return;
    }
    if (s.brain && s.optimal) {
      this.bossApplyOptimal();
    } else {
      const sensors = [...s.cfg.sensors];
      const effs = [...s.cfg.effectors];
      for (const t of s.cfg.threats) {
        s.map[t.id] = { sensorId: sensors.shift()?.id ?? null, effectorId: effs.shift()?.id ?? null };
      }
    }
    this.bossEngage();
  }

  private showAttractOverlay(): void {
    let o = document.getElementById("attract-overlay");
    if (!o) {
      o = document.createElement("div");
      o.id = "attract-overlay";
      o.innerHTML = `<div class="attract-badge">◈ AUTO-DEMO</div><div class="attract-cta">TAP TO PLAY</div>`;
    }
    this.overlay.append(o); // re-append → stays on top of fresh renders
  }

  private hideAttractOverlay(): void {
    document.getElementById("attract-overlay")?.remove();
  }

  // ---- staff panel (spec §6.2, §14 Phase 7) ------------------------------

  private toggleBrain(): void {
    this.state.brainStaffDisabled = !this.state.brainStaffDisabled;
    const s = this.state.boss;
    if (s && this.state.brainUnlocked && !s.result && this.currentBossIndex === 2) {
      s.brain = !this.state.brainStaffDisabled;
      s.optimal = s.brain ? computeOptimal(s.cfg) : null;
      this.renderBoss();
    }
    this.flashStaffToast();
    this.refreshStaffPanel();
  }

  private toggleStaffPanel(): void {
    if (this.staffPanel) {
      this.staffPanel.remove();
      this.staffPanel = null;
      return;
    }
    const panel = document.createElement("div");
    panel.id = "staff-panel";
    document.body.append(panel);
    this.staffPanel = panel;
    this.refreshStaffPanel();
  }

  private refreshStaffPanel(): void {
    if (!this.staffPanel) return;
    const cb = document.body.classList.contains("cb");
    this.staffPanel.innerHTML = `
      <div class="sp-head">STAFF PANEL</div>
      <button data-act="brain">Brain: ${this.state.brainStaffDisabled ? "OFF" : "ON"}</button>
      <button data-act="cb">Colorblind: ${cb ? "ON" : "OFF"}</button>
      <button data-act="full">Fullscreen</button>
      <button data-act="panic" class="sp-panic">Panic reset</button>
      <button data-act="close">Close</button>
    `;
    this.staffPanel.querySelectorAll("button").forEach((b) => {
      (b as HTMLButtonElement).onclick = () => {
        const act = (b as HTMLElement).dataset.act;
        if (act === "brain") this.toggleBrain();
        else if (act === "cb") this.toggleColorblind();
        else if (act === "full") {
          this.fullscreenArmed = false;
          this.armFullscreen();
        } else if (act === "panic") this.panicReset();
        else if (act === "close") this.toggleStaffPanel();
      };
    });
  }

  private toggleColorblind(): void {
    document.body.classList.toggle("cb");
    this.refreshStaffPanel();
  }

  /** Panic reset for booth staff — abandon everything, back to a clean title. */
  private panicReset(): void {
    this.attract = false;
    if (this.attractTimer !== null) {
      window.clearInterval(this.attractTimer);
      this.attractTimer = null;
    }
    this.hideAttractOverlay();
    this.staffPanel?.remove();
    this.staffPanel = null;
    this.operator.setMuted(false);
    this.state.rt = null;
    this.world.setGhost(null);
    this.goTitle();
  }

  private flashStaffToast(): void {
    let toast = document.getElementById("staff-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "staff-toast";
      document.body.append(toast);
    }
    toast.textContent = this.state.brainStaffDisabled ? "STAFF: brain FORCED OFF" : "STAFF: brain ON";
    toast.classList.add("show");
    window.setTimeout(() => toast?.classList.remove("show"), 1400);
  }
}
