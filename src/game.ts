/**
 * Game controller (spec §2, §6) — owns the authoritative state, the
 * fixed-timestep sim loop, and the phase transitions that drive the emotional
 * arc. It wires the Pixi world, the boss console, and the narrative screens.
 *
 * Phase 0+1 arc: title → boss(brain off) → unlock → boss(brain on) → summary.
 */
import { Application } from "pixi.js";
import { Rng, timeSeed } from "./sim/rng.ts";
import { LEVEL_1 } from "./sim/level.ts";
import { createInitialState, type BossSession, type GameState } from "./sim/state.ts";
import { BOSS_1, BOSS_2 } from "./sim/boss/data.ts";
import {
  computeOptimal,
  emptyAssignment,
  resolveEncounter,
} from "./sim/boss/engine.ts";
import type { BossConfig } from "./sim/boss/types.ts";
import { WorldRenderer } from "./render/world.ts";
import { BossConsole } from "./ui/bossConsole.ts";
import { Screens } from "./ui/screens.ts";

const FIXED_DT = 1 / 60; // seconds per sim step

export class Game {
  private state: GameState;
  private world: WorldRenderer;
  private console: BossConsole;
  private screens: Screens;
  private rng: Rng;
  private accumulator = 0;

  constructor(overlay: HTMLElement) {
    this.state = createInitialState(LEVEL_1);
    this.rng = new Rng(timeSeed());
    this.world = new WorldRenderer();
    this.console = new BossConsole(overlay, {
      onSelectThreat: (id) => this.selectThreat(id),
      onAssignSensor: (id) => this.assign("sensor", id),
      onAssignEffector: (id) => this.assign("effector", id),
      onApplyOptimal: () => this.applyOptimal(),
      onEngage: () => this.engage(),
      onContinue: () => this.afterBoss(),
    });
    this.screens = new Screens(overlay, {
      onStart: () => this.startBoss(BOSS_1, false),
      onUnlockContinue: () => this.startBoss(BOSS_2, true),
      onRestart: () => this.restart(),
    });
  }

  async start(host: HTMLElement): Promise<void> {
    await this.world.init(host);
    this.world.drawStatic(this.state);
    this.installLoop(this.world.app);
    this.installStaffToggle();
    this.goTitle();
  }

  // ---- fixed-timestep loop ----------------------------------------------

  private installLoop(app: Application): void {
    app.ticker.add((ticker) => {
      this.accumulator += ticker.deltaMS / 1000;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < 5) {
        this.state.time += FIXED_DT;
        this.accumulator -= FIXED_DT;
        steps++;
      }
      this.world.update(this.state);
    });
  }

  // ---- phase transitions -------------------------------------------------

  private goTitle(): void {
    this.state.phase = "title";
    this.state.boss = null;
    this.console.clear();
    this.screens.title();
  }

  private startBoss(cfg: BossConfig, brainIntended: boolean): void {
    const brain = brainIntended && !this.state.brainStaffDisabled;
    const session: BossSession = {
      cfg,
      brain,
      map: emptyAssignment(cfg),
      optimal: brain ? computeOptimal(cfg) : null,
      result: null,
      selectedThreatId: cfg.threats[0]?.id ?? null,
    };
    this.state.phase = "boss";
    this.state.boss = session;
    this.screens.clear();
    this.renderBoss();
  }

  private afterBoss(): void {
    const s = this.state.boss;
    if (!s) return;
    if (!s.brain && !this.state.brainUnlocked) {
      // Boss #1 done → the unlock beat.
      this.state.log.boss1 = s.result ?? undefined;
      this.state.brainUnlocked = true;
      this.state.phase = "unlock";
      this.console.clear();
      this.screens.unlock();
    } else {
      // Boss #2 done → summary.
      this.state.log.boss2 = s.result ?? undefined;
      this.state.phase = "summary";
      this.console.clear();
      this.screens.summary(this.summaryLine(this.state.log.boss1), this.summaryLine(this.state.log.boss2));
    }
  }

  private summaryLine(r?: { stopped: number; results: { length: number } } | undefined): string {
    if (!r) return "—";
    return `${r.stopped} / ${r.results.length} stopped`;
  }

  private restart(): void {
    const staffDisabled = this.state.brainStaffDisabled;
    this.state = createInitialState(LEVEL_1);
    this.state.brainStaffDisabled = staffDisabled;
    this.world.drawStatic(this.state);
    this.goTitle();
  }

  // ---- boss interactions -------------------------------------------------

  private renderBoss(): void {
    if (this.state.boss) this.console.render(this.state.boss);
  }

  private selectThreat(id: string): void {
    if (!this.state.boss) return;
    this.state.boss.selectedThreatId = this.state.boss.selectedThreatId === id ? null : id;
    this.renderBoss();
  }

  private assign(kind: "sensor" | "effector", deviceId: string): void {
    const s = this.state.boss;
    if (!s || !s.selectedThreatId) return;
    const sel = s.selectedThreatId;
    const cur = s.map[sel];
    const field = kind === "sensor" ? "sensorId" : "effectorId";

    if (cur[field] === deviceId) {
      // Toggle off.
      cur[field] = null;
    } else {
      // Enforce one device → one threat: strip it from anyone else first.
      for (const t of s.cfg.threats) {
        if (s.map[t.id][field] === deviceId) s.map[t.id][field] = null;
      }
      cur[field] = deviceId;
    }
    this.renderBoss();
  }

  private applyOptimal(): void {
    const s = this.state.boss;
    if (!s || !s.optimal) return;
    // Deep copy the optimal into the working map.
    for (const t of s.cfg.threats) {
      s.map[t.id] = { ...s.optimal[t.id] };
    }
    this.renderBoss();
  }

  private engage(): void {
    const s = this.state.boss;
    if (!s || s.result) return;
    s.result = resolveEncounter(s.cfg, s.map, this.rng);
    this.renderBoss();
  }

  // ---- staff sales toggle (spec §6.2) ------------------------------------

  /**
   * Hidden booth-staff control: press "B" to toggle the brain off/on so a rep
   * can show the same hardware with and without coordination. Not part of the
   * normal player flow. Re-renders the current boss if one is active.
   */
  private installStaffToggle(): void {
    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() !== "b") return;
      this.state.brainStaffDisabled = !this.state.brainStaffDisabled;
      const s = this.state.boss;
      if (s && this.state.brainUnlocked && !s.result) {
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
