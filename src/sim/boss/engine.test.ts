import { describe, expect, it } from "vitest";
import { Rng } from "../rng.ts";
import { BOSS_1, BOSS_2 } from "./data.ts";
import {
  computeOdds,
  computeOptimal,
  expectedStopped,
  resolveEncounter,
} from "./engine.ts";
import type { AssignmentMap } from "./types.ts";

describe("matchup legibility (spec §6)", () => {
  it("an RF jammer does nothing to an autonomy drone", () => {
    const autonomy = BOSS_1.threats.find((t) => t.typeId === "autonomy")!;
    const o = computeOdds(BOSS_1, autonomy, "s-radar-1", "e-jam-1");
    expect(o.p).toBe(0);
    expect(o.warnings.join(" ")).toMatch(/NO effect/i);
  });

  it("an RF direction-finder cannot track an autonomy drone", () => {
    const autonomy = BOSS_1.threats.find((t) => t.typeId === "autonomy")!;
    const o = computeOdds(BOSS_1, autonomy, "s-rfdf-1", "e-net-1");
    expect(o.warnings.join(" ")).toMatch(/cannot track/i);
  });

  it("a tracked, in-matchup engagement beats an untracked one", () => {
    const quad = BOSS_1.threats.find((t) => t.typeId === "rf-quad")!;
    const tracked = computeOdds(BOSS_1, quad, "s-radar-1", "e-jam-1");
    const blind = computeOdds(BOSS_1, quad, null, "e-jam-1");
    expect(tracked.p).toBeGreaterThan(blind.p);
  });

  it("an unengaged threat reports a seam and zero odds", () => {
    const t = BOSS_1.threats[0];
    const o = computeOdds(BOSS_1, t, "s-radar-1", null);
    expect(o.unengaged).toBe(true);
    expect(o.p).toBe(0);
  });
});

describe("optimal assignment (the brain)", () => {
  it("never assigns the jammer to the autonomy drone", () => {
    const opt = computeOptimal(BOSS_1);
    const autonomy = BOSS_1.threats.find((t) => t.typeId === "autonomy")!;
    expect(opt[autonomy.id].effectorId).not.toBe("e-jam-1");
  });

  it("is at least as good as any naive assignment", () => {
    const opt = computeOptimal(BOSS_1);
    const naive: AssignmentMap = {
      t1: { sensorId: "s-radar-1", effectorId: "e-net-1" },
      t2: { sensorId: "s-radar-2", effectorId: "e-jam-1" },
      t3: { sensorId: "s-rfdf-1", effectorId: "e-net-2" },
      t4: { sensorId: null, effectorId: null },
    };
    expect(expectedStopped(BOSS_1, opt)).toBeGreaterThanOrEqual(
      expectedStopped(BOSS_1, naive) - 1e-9,
    );
  });
});

describe("resolution & no-early-loss rescue (spec §6.1/§13)", () => {
  it("boss #1 can never be an outright loss", () => {
    // A deliberately terrible assignment: jammer on the autonomy drone, others blind.
    const bad: AssignmentMap = {
      t1: { sensorId: null, effectorId: null },
      t2: { sensorId: null, effectorId: null },
      t3: { sensorId: "s-radar-1", effectorId: "e-jam-1" }, // useless
      t4: { sensorId: null, effectorId: null },
    };
    for (let seed = 1; seed <= 50; seed++) {
      const res = resolveEncounter(BOSS_1, bad, new Rng(seed));
      expect(res.won).toBe(true);
    }
  });

  it("boss #2 with the optimal plan wins cleanly across seeds", () => {
    const opt = computeOptimal(BOSS_2);
    let wins = 0;
    for (let seed = 1; seed <= 100; seed++) {
      if (resolveEncounter(BOSS_2, opt, new Rng(seed)).won) wins++;
    }
    expect(wins).toBeGreaterThan(90);
  });
});
