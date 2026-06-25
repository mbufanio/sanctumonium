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
import { ringDistance, hexKey, type Hex } from "./sim/hex.ts";
import { LEVEL_1, LEVELS, type LevelDef } from "./sim/level.ts";
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
import { bossConfigFromLayout, tierForBosses } from "./sim/realtime/schedule.ts";
import { adaptWave, recommendPlacement, type Recommendation } from "./sim/realtime/adaptive.ts";
import { computeOptimal, emptyAssignment, resolveEncounter } from "./sim/boss/engine.ts";
import { WorldRenderer } from "./render/world.ts";
import { BossConsole } from "./ui/bossConsole.ts";
import { Screens } from "./ui/screens.ts";
import { Hud } from "./ui/hud.ts";
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
  private leaderboard: LeaderboardUI;
  private rng: Rng;
  private accumulator = 0;
  private currentBossIndex: 1 | 2 | null = null;
  private pointerHex: Hex | null = null;
  private currentRec: Recommendation | null = null;
  private recDismissed = false;

  constructor(overlay: HTMLElement) {
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
    this.installStaffToggle();
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
      this.world.update(this.state);
      if (this.state.phase === "build" || this.state.phase === "wave") this.hud.update(this.state);
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
    const res = stepWave(s.rt, s.placed, s.activeWave, dt, this.rng, { spawnRadius: this.world.spawnRadius(s), coordinated });

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
    if (s.integrity <= 0) {
      s.integrity = 0;
      this.endRun(false);
      return;
    }
    if (res.waveComplete) this.completeWave();
  }

  // ---- phase transitions -------------------------------------------------

  private goTitle(): void {
    this.state.phase = "title";
    this.state.boss = null;
    this.state.rt = null;
    this.console.clear();
    this.hud.clear();
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
    this.currentBossIndex = null;
    this.world.drawStatic(this.state);
    this.screens.clear();
    this.enterBuild();
  }

  /** Between-waves build phase (spec §13: between-waves only). */
  private enterBuild(): void {
    const s = this.state;
    s.phase = "build";
    s.rt = null;
    s.activeWave = null;
    this.console.clear();
    if (s.scheduleIndex >= s.level.schedule.length) {
      this.endRun(true);
      return;
    }
    this.recDismissed = false;
    s.selectedDeviceId = null;
    s.maxTier = tierForBosses(s.bossesBeaten);
    this.refreshBuildDock();
  }

  /** Recompute the brain recommendation (after unlock) and (re)render the dock. */
  private refreshBuildDock(): void {
    const s = this.state;
    if (s.phase !== "build") return;
    this.currentRec =
      s.brainUnlocked && !s.brainStaffDisabled && !this.recDismissed
        ? recommendPlacement(s.placed, s.currency, this.world.spawnRadius(s), s.level.rings)
        : null;
    this.hud.showBuild(s, this.nextEntryLabel(), this.currentRec);
  }

  private nextEntryLabel(): string {
    const entry = this.state.level.schedule[this.state.scheduleIndex];
    if (!entry) return "Finish";
    if (entry.type === "boss") return `⚠ Boss attack — Step ${this.state.scheduleIndex + 1}`;
    return `Start ${entry.wave.label}`;
  }

  /** Player pressed "start" in the build dock → run the next schedule entry. */
  private startScheduleEntry(): void {
    const s = this.state;
    const entry = s.level.schedule[s.scheduleIndex];
    if (!entry) {
      this.endRun(true);
      return;
    }
    if (entry.type === "wave") {
      s.phase = "wave";
      s.rt = createRealtimeState();
      // Adaptive enemy: bias this wave's spawns toward the layout's seams.
      s.activeWave = adaptWave(entry.wave, s.placed, this.world.spawnRadius(s), this.rng);
      for (const d of s.placed) d.cooldown = 0;
      s.selectedPlaceable = null;
      s.selectedDeviceId = null;
      this.world.setGhost(null);
      this.hud.hideBuild();
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
    if (this.currentBossIndex === 1) {
      s.log.boss1 = session.result ?? undefined;
      s.phase = "unlock";
      this.console.clear();
      this.screens.unlock();
    } else {
      s.log.boss2 = session.result ?? undefined;
      this.console.clear();
      s.scheduleIndex++;
      this.enterBuild();
    }
  }

  private afterUnlock(): void {
    const s = this.state;
    s.brainUnlocked = true;
    this.screens.clear();
    s.scheduleIndex++;
    this.enterBuild();
  }

  private endRun(victory: boolean): void {
    const s = this.state;
    s.victory = victory;
    s.phase = "summary";
    s.rt = null;
    this.console.clear();
    this.hud.clear();
    this.world.setGhost(null);
    const stats: RunStats = {
      levelId: s.level.id,
      score: s.score,
      wavesSurvived: s.wavesSurvived,
      kills: s.kills,
      leaked: s.leaked,
      spent: s.spent,
      integrity: Math.max(0, Math.round(s.integrity)),
      victory,
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

  private installInput(): void {
    const canvas = this.world.app.canvas;
    const toHex = (e: PointerEvent): Hex => {
      const rect = canvas.getBoundingClientRect();
      return this.world.screenToHex(e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener("pointerdown", (e) => {
      if (this.state.phase !== "build") return;
      this.handleFieldTap(toHex(e as PointerEvent));
    });
    canvas.addEventListener("pointermove", (e) => {
      if (this.state.phase !== "build") return;
      this.pointerHex = toHex(e as PointerEvent);
      this.updateGhost();
    });
    canvas.addEventListener("pointerleave", () => {
      this.pointerHex = null;
      this.world.setGhost(null);
    });
  }

  private handleFieldTap(hex: Hex): void {
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
    return !s.placed.some((d) => hexKey(d.hex) === hexKey(hex));
  }

  private updateGhost(): void {
    const s = this.state;
    if (s.phase !== "build" || !s.selectedPlaceable || !this.pointerHex) {
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

  // ---- staff sales toggle (spec §6.2) ------------------------------------

  private installStaffToggle(): void {
    window.addEventListener("keydown", (e) => {
      // Staff: 'L' toggles the live leaderboard from the title screen.
      if (e.key.toLowerCase() === "l" && (this.state.phase === "title" || this.leaderboard.liveActive)) {
        if (this.leaderboard.liveActive) this.goTitle();
        else this.leaderboard.showLive(this.state.level.id);
        return;
      }
      if (e.key.toLowerCase() !== "b") return;
      this.state.brainStaffDisabled = !this.state.brainStaffDisabled;
      const s = this.state.boss;
      if (s && this.state.brainUnlocked && !s.result && this.currentBossIndex === 2) {
        s.brain = !this.state.brainStaffDisabled;
        s.optimal = s.brain ? computeOptimal(s.cfg) : null;
        this.renderBoss();
      }
      this.flashStaffToast();
    });
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
