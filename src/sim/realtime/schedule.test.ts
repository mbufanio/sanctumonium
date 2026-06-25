import { describe, expect, it } from "vitest";
import { computeOptimal, resolveEncounter } from "../boss/engine.ts";
import { Rng } from "../rng.ts";
import { makePlaced } from "../state.ts";
import { SCHEDULE, bossConfigFromLayout } from "./schedule.ts";
import type { PlacedDevice } from "./types.ts";

function dev(_kind: "sensor" | "effector", placeableId: string, q: number, r: number): PlacedDevice {
  return makePlaced(placeableId, { q, r });
}

describe("wave schedule", () => {
  it("interleaves both bosses between normal waves", () => {
    const bosses = SCHEDULE.filter((e) => e.type === "boss");
    expect(bosses.map((b) => (b as { bossIndex: number }).bossIndex)).toEqual([1, 2]);
    expect(SCHEDULE[0].type).toBe("wave"); // never opens on a boss
  });
});

describe("boss built from the player's layout (spec §14 Phase 2)", () => {
  // A plausible by-boss-#2 buildout: enough sensors to track the threats and a
  // mix of effectors (the lesson still bites — the lone jammer can't help the
  // autonomy drone, so nets must cover it).
  const layout: PlacedDevice[] = [
    dev("sensor", "radar", 0, -2),
    dev("sensor", "radar", 2, -2),
    dev("sensor", "rf-df", 2, 0),
    dev("sensor", "rf-df", -2, 2),
    dev("effector", "net-drone", -2, 1),
    dev("effector", "net-drone", 1, 1),
    dev("effector", "net-drone", -1, -1),
    dev("effector", "rf-jammer", 0, 2),
  ];

  it("uses the player's placed sensors and effectors", () => {
    const cfg = bossConfigFromLayout(layout, 1);
    expect(cfg.sensors.map((s) => s.typeId).sort()).toEqual(["radar", "radar", "rf-df", "rf-df"]);
    expect(cfg.effectors.filter((e) => e.typeId === "net-drone").length).toBe(3);
    expect(cfg.effectors.some((e) => e.typeId === "rf-jammer")).toBe(true);
  });

  it("falls back to the canned roster when the player has no devices of a kind", () => {
    const sensorsOnly = layout.filter((d) => d.kind === "sensor");
    const cfg = bossConfigFromLayout(sensorsOnly, 1);
    expect(cfg.effectors.length).toBeGreaterThan(0); // canned fallback, still playable
  });

  it("produces a solvable encounter the brain can optimise and win", () => {
    const cfg = bossConfigFromLayout(layout, 2);
    const opt = computeOptimal(cfg);
    let wins = 0;
    for (let seed = 1; seed <= 60; seed++) {
      if (resolveEncounter(cfg, opt, new Rng(seed)).won) wins++;
    }
    expect(wins).toBeGreaterThan(30);
  });
});
