/**
 * Balance & pacing analysis harness (not a guardrail — a measurement tool).
 *
 * Plays out COMPLETE runs headlessly under several strategies across many
 * seeds and prints a report: win rates, score, leaks, and wall-clock pacing.
 * Used to tune the economy/wave constants. The guardrails it informs live in
 * balance.test.ts.
 *
 * Run:  npx vitest run balance.harness --reporter=basic
 */
import { describe, expect, it } from "vitest";
import { Rng } from "../rng.ts";
import { HEX_SIZE, hexRing, type Hex } from "../hex.ts";
import { LEVEL_1 } from "../level.ts";
import { makePlaced } from "../state.ts";
import { placeableById, TRACKED_KILL_BONUS } from "./catalog.ts";
import { createRealtimeState, type PlacedDevice } from "./types.ts";
import { stepWave } from "./engine.ts";
import { bossConfigFromLayout } from "./schedule.ts";
import { adaptWave } from "./adaptive.ts";

const SCHEDULE = LEVEL_1.schedule;
import { computeOptimal, emptyAssignment } from "../boss/engine.ts";
import { resolveEncounter } from "../boss/engine.ts";
import type { AssignmentMap, BossConfig } from "../boss/types.ts";

const SPAWN_RADIUS = LEVEL_1.rings * HEX_SIZE * Math.sqrt(3) + HEX_SIZE * 1.5;
// Estimated player dwell that the sim can't measure, for run-length pacing.
const BUILD_DWELL_S = 9;
const BOSS_DWELL_S = 22;

interface PlacePlan {
  hex: Hex;
  placeableId: string;
}

interface Strategy {
  name: string;
  /** Ordered wishlist of placements; we buy down the list as funds allow. */
  plan: PlacePlan[];
  /** Boss assignment policy. */
  boss: "optimal" | "naive";
}

/** Occupancy-safe ring bearing → hex (pick the n-th cell of a ring). */
function ringCell(radius: number, idx: number): Hex {
  const ring = hexRing(radius);
  return ring[((idx % ring.length) + ring.length) % ring.length];
}

/** A balanced, coordinated wishlist: effectors and sensors on overlapping rings
 *  (sensors track the rings the effectors sit on), bought INTERLEAVED 2:1 so the
 *  economy stays healthy from the first build phase — as a real player builds. */
function coordinatedPlan(): PlacePlan[] {
  const eff: PlacePlan[] = [...hexRing(2), ...hexRing(4)].map((hex) => ({ hex, placeableId: "net-drone" }));
  const sen: PlacePlan[] = [...hexRing(3), ...hexRing(5)].map((hex, i) => ({ hex, placeableId: i % 2 === 0 ? "radar" : "rf-df" }));
  const plan: PlacePlan[] = [];
  let ei = 0;
  let si = 0;
  while (ei < eff.length || si < sen.length) {
    if (ei < eff.length) plan.push(eff[ei++]);
    if (ei < eff.length) plan.push(eff[ei++]);
    if (si < sen.length) plan.push(sen[si++]);
  }
  return plan;
}

/** Brute force: spam nets clustered in ONE arc, barely any sensors. */
function brutePlan(): PlacePlan[] {
  const plan: PlacePlan[] = [];
  for (let radius = 2; radius <= 5; radius++) {
    for (let i = 0; i < 3; i++) plan.push({ hex: ringCell(radius, i), placeableId: "net-drone" });
  }
  return plan;
}

/** Effectors only — no sensors beyond the starting radar (untracked fire). */
function effectorsOnlyPlan(): PlacePlan[] {
  const plan: PlacePlan[] = [];
  hexRing(3).forEach((hex) => plan.push({ hex, placeableId: "net-drone" }));
  hexRing(4).forEach((hex, i) => { if (i % 2 === 0) plan.push({ hex, placeableId: "net-drone" }); });
  return plan;
}

const STRATEGIES: Strategy[] = [
  { name: "no-build", plan: [], boss: "naive" },
  { name: "coordinated", plan: coordinatedPlan(), boss: "optimal" },
  { name: "brute-force", plan: brutePlan(), boss: "naive" },
  { name: "effectors-only", plan: effectorsOnlyPlan(), boss: "naive" },
];

function naiveAssign(cfg: BossConfig): AssignmentMap {
  const map = emptyAssignment(cfg);
  const sensors = [...cfg.sensors];
  const effectors = [...cfg.effectors];
  cfg.threats.forEach((t) => {
    map[t.id] = { sensorId: sensors.shift()?.id ?? null, effectorId: effectors.shift()?.id ?? null };
  });
  return map;
}

interface RunResult {
  won: boolean;
  score: number;
  integrity: number;
  kills: number;
  leaks: number;
  spent: number;
  devices: number;
  waveSeconds: number;
  runMinutes: number;
  wavesSurvived: number;
}

function simulateRun(strat: Strategy, seed: number): RunResult {
  const rng = new Rng(seed);
  let currency = 120;
  let integrity = 100;
  let score = 0;
  let kills = 0;
  let leaks = 0;
  let spent = 0;
  let waveSeconds = 0;
  let buildPhases = 0;
  let bossPhases = 0;
  let brainUnlocked = false; // unlocks after boss #1, like the real run
  let wavesSurvived = 0;

  const placed: PlacedDevice[] = [makePlaced("radar", { q: 0, r: -1 }), makePlaced("net-drone", { q: 0, r: 1 })];
  const occupied = new Set(placed.map((d) => `${d.hex.q},${d.hex.r}`));
  let planCursor = 0;

  const doBuild = () => {
    buildPhases++;
    // Buy down the wishlist while affordable, keeping a small reserve.
    while (planCursor < strat.plan.length) {
      const item = strat.plan[planCursor];
      const key = `${item.hex.q},${item.hex.r}`;
      if (occupied.has(key)) { planCursor++; continue; }
      const p = placeableById(item.placeableId)!;
      if (currency < p.cost) break;
      currency -= p.cost;
      spent += p.cost;
      placed.push(makePlaced(item.placeableId, item.hex));
      occupied.add(key);
      planCursor++;
    }
  };

  for (const entry of SCHEDULE) {
    doBuild();
    if (entry.type === "wave") {
      const rt = createRealtimeState();
      // Adaptive enemy probes this layout's seams; brain coordinates post-unlock.
      const wave = adaptWave(entry.wave, placed, SPAWN_RADIUS, rng);
      let t = 0;
      for (let i = 0; i < 6000 && integrity > 0; i++) {
        const res = stepWave(rt, placed, wave, 1 / 60, rng, { spawnRadius: SPAWN_RADIUS, coordinated: brainUnlocked });
        for (const k of res.kills) { currency += k.bounty; score += k.bounty * (k.tracked ? TRACKED_KILL_BONUS : 1); kills++; }
        for (const l of res.leaks) { integrity -= l.damage; leaks++; }
        t += 1 / 60;
        if (res.waveComplete) break;
      }
      waveSeconds += t;
      if (integrity > 0) { currency += entry.wave.stipend; score += entry.wave.stipend * 0.4; wavesSurvived++; }
    } else {
      bossPhases++;
      const cfg = bossConfigFromLayout(placed, entry.bossIndex);
      const map = strat.boss === "optimal" ? computeOptimal(cfg) : naiveAssign(cfg);
      const res = resolveEncounter(cfg, map, rng);
      score += res.stopped * 120;
      if (entry.bossIndex === 1) brainUnlocked = true;
    }
    if (integrity <= 0) break;
  }

  const runMinutes = (waveSeconds + buildPhases * BUILD_DWELL_S + bossPhases * BOSS_DWELL_S) / 60;
  return { won: integrity > 0, score, integrity, kills, leaks, spent, devices: placed.length, waveSeconds, runMinutes, wavesSurvived };
}

function avg(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0) / ns.length;
}

interface Agg {
  winPct: number;
  score: number;
  leaks: number;
  runMinutes: number;
  wavesSurvived: number;
}

describe("BALANCE & PACING ANALYSIS", () => {
  // Keep this modest — the separations between strategies are large, so a small
  // sample asserts them reliably while keeping the default test run fast.
  const SEEDS = 12;
  const agg: Record<string, Agg> = {};
  const rows: string[] = ["strategy        win%  score   integ  kills  leaks  devices  spent  wave_s  run_min"];
  for (const strat of STRATEGIES) {
    const rs: RunResult[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) rs.push(simulateRun(strat, seed));
    const winPct = (100 * rs.filter((r) => r.won).length) / SEEDS;
    agg[strat.name] = { winPct, score: avg(rs.map((r) => r.score)), leaks: avg(rs.map((r) => r.leaks)), runMinutes: avg(rs.map((r) => r.runMinutes)), wavesSurvived: avg(rs.map((r) => r.wavesSurvived)) };
    rows.push(
      [
        strat.name.padEnd(15),
        winPct.toFixed(0).padStart(4),
        agg[strat.name].score.toFixed(0).padStart(6),
        avg(rs.map((r) => r.integrity)).toFixed(0).padStart(6),
        avg(rs.map((r) => r.kills)).toFixed(0).padStart(6),
        agg[strat.name].leaks.toFixed(0).padStart(6),
        avg(rs.map((r) => r.devices)).toFixed(0).padStart(8),
        avg(rs.map((r) => r.spent)).toFixed(0).padStart(6),
        avg(rs.map((r) => r.waveSeconds)).toFixed(0).padStart(7),
        agg[strat.name].runMinutes.toFixed(1).padStart(8),
      ].join(" "),
    );
  }
  // eslint-disable-next-line no-console
  console.log("\n" + rows.join("\n") + "\n");

  // ---- guardrails (spec §8: coordination must clearly beat the rest) ------

  it("doing nothing loses", () => {
    expect(agg["no-build"].winPct).toBe(0);
  });

  it("clustered brute-force coverage loses (seams get exploited)", () => {
    expect(agg["brute-force"].winPct).toBe(0);
  });

  it("a coordinated layout survives deep into the escalation finale", () => {
    // The finale is meant to overwhelm (spec §7). With magazine discipline now
    // in play (weapons reload), sustained defense is harder — coordinated still
    // wins the majority and dominates every alternative, which is the point.
    expect(agg["coordinated"].winPct).toBeGreaterThanOrEqual(50);
  });

  it("coordinated play survives noticeably deeper than sensor-less spread", () => {
    expect(agg["coordinated"].wavesSurvived).toBeGreaterThan(agg["effectors-only"].wavesSurvived + 1);
  });

  it("coordination scores clearly higher than every alternative (the leaderboard rewards the lesson)", () => {
    expect(agg["coordinated"].score).toBeGreaterThan(agg["effectors-only"].score * 1.2);
    expect(agg["coordinated"].score).toBeGreaterThan(agg["brute-force"].score * 1.2);
    expect(agg["coordinated"].score).toBeGreaterThan(agg["no-build"].score * 1.2);
  });

  it("coordination leaks the least", () => {
    expect(agg["coordinated"].leaks).toBeLessThan(agg["effectors-only"].leaks);
    expect(agg["coordinated"].leaks).toBeLessThan(agg["brute-force"].leaks);
  });

  it("a maximal full run lands in the pacing band (typical runs end sooner)", () => {
    // This is the upper bound — a maximal coordinated player clearing every wave.
    // Cold players get overwhelmed earlier in the finale, finishing well under.
    expect(agg["coordinated"].runMinutes).toBeGreaterThan(3);
    expect(agg["coordinated"].runMinutes).toBeLessThan(7);
  });
});
