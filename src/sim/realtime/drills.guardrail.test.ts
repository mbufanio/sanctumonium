/**
 * Drill & boss GUARDRAILS for the overlapping-effector Act-1 design.
 *
 * The coordination gap in the raids is fully honest — the engine runs the same
 * dice as the arcade, with NO drill-only accuracy penalty. These tests pin that
 * property: against the real Act-1 laydown and the real raid schedule,
 * uncoordinated must leak (>=1 avg) and coordinated must sweep (0, every seed).
 * The boss checks pin the puzzle quality: the computed optimal plan must
 * clearly beat the naive nearest-pair plan (non-trivial) and reliably win.
 */
import { describe, it, expect } from "vitest";
import { Rng } from "../rng.ts";
import { makePlaced } from "../state.ts";
import { getLevel, act1Laydown } from "../level.ts";
import { stepWave } from "./engine.ts";
import { createRealtimeState } from "./types.ts";
import { diagnoseDrill, drillFreezeReady } from "./diagnose.ts";
import { BOSS_1, BOSS_2 } from "../boss/data.ts";
import { computeOptimal, computeOdds, emptyAssignment, resolveEncounter, expectedStopped } from "../boss/engine.ts";

const lvl = getLevel("energy");
const waves = lvl.schedule.filter((e) => e.type === "wave").map((e) => (e as { wave: import("./types.ts").WaveDef }).wave);

function run(w: import("./types.ts").WaveDef, coordinated: boolean, seed: number) {
  const placed = act1Laydown(lvl).map((it) => makePlaced(it.placeableId, it.hex));
  const rt = createRealtimeState();
  const rng = new Rng(seed);
  const env = { spawnRadius: w.spawnRadius ?? 300, coordinated, terrain: new Map(), drill: true } as const;
  const leaked: string[] = [];
  for (let i = 0; i < 9000; i++) {
    const res = stepWave(rt, placed, w, 1 / 60, rng, env);
    for (const lk of res.leaks) leaked.push(lk.typeId);
    if (res.waveComplete) break;
  }
  return leaked;
}

function tags(w: import("./types.ts").WaveDef, coordinated: boolean): string {
  const placed = act1Laydown(lvl).map((it) => makePlaced(it.placeableId, it.hex));
  const rt = createRealtimeState();
  const rng = new Rng(7);
  const env = { spawnRadius: w.spawnRadius ?? 300, coordinated, terrain: new Map(), drill: true } as const;
  for (let i = 0; i < 9000; i++) {
    const res = stepWave(rt, placed, w, 1 / 60, rng, env);
    if (!res.waveComplete && drillFreezeReady(rt, coordinated, rt.spawnCursor >= w.spawns.length)) {
      return diagnoseDrill(rt, placed, coordinated, new Map()).map((x) => `${x.code}:${x.tag}`).join(" | ");
    }
    if (res.waveComplete) break;
  }
  return "(no freeze)";
}

describe("drill & boss guardrails (overlap design)", () => {
  it("uncoord leaks honestly, coord sweeps (real laydown, real schedule, no thumb)", () => {
    for (const w of waves.slice(0, 2)) {
      const un = [1, 2, 3, 4, 5].map((s) => run(w, false, s));
      const co = [1, 2, 3, 4, 5].map((s) => run(w, true, s));
      console.log(`${w.label}: uncoord=[${un.map((r) => r.length).join(",")}] coord=[${co.map((r) => r.length).join(",")}]`);
      console.log(`  tags uncoord: ${tags(w, false)}`);
      console.log(`  tags coord:   ${tags(w, true)}`);
      expect(Math.max(...co.map((r) => r.length))).toBe(0);
      expect(un.reduce((a, r) => a + r.length, 0) / un.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("boss puzzles: optimal is strong and clearly beats the naive nearest-pair plan", () => {
    for (const [name, cfg] of [["BOSS_1", BOSS_1] as const, ["BOSS_2", BOSS_2] as const]) {
      const opt = computeOptimal(cfg);
      // Naive plan: pair each threat with the bearing-nearest sensor + effector.
      const naive = emptyAssignment(cfg);
      const angDiff = (a: number, b: number) => 180 - Math.abs(((a - b + 540) % 360) - 180);
      for (const t of cfg.threats) {
        const nearSen = [...cfg.sensors].sort((a, b) => angDiff(a.bearing, t.bearing) - angDiff(b.bearing, t.bearing))[0];
        const nearEff = [...cfg.effectors].sort((a, b) => angDiff(a.bearing, t.bearing) - angDiff(b.bearing, t.bearing))[0];
        naive[t.id] = { sensorId: nearSen.id, effectorId: nearEff.id };
      }
      const optExp = expectedStopped(cfg, opt);
      const naiveExp = expectedStopped(cfg, naive);
      let optWins = 0;
      for (let s = 1; s <= 40; s++) {
        if (resolveEncounter(cfg, opt, new Rng(s)).won) optWins++;
      }
      const perThreat = cfg.threats.map((t) => `${t.typeId}@${t.bearing}:${computeOdds(cfg, t, opt[t.id]?.sensorId ?? null, opt[t.id]?.effectorId ?? null).p.toFixed(2)}`);
      console.log(`${name}: optimalExp=${optExp.toFixed(2)} naiveExp=${naiveExp.toFixed(2)} optWinRate=${optWins}/40 odds=[${perThreat.join(" ")}]`);
      expect(optExp).toBeGreaterThan(naiveExp + 0.3); // the puzzle is non-trivial
      expect(optWins / 40).toBeGreaterThan(0.75); // solving it reliably wins
    }
  });
});
