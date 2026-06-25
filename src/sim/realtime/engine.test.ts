import { describe, expect, it } from "vitest";
import { Rng } from "../rng.ts";
import { hexToPlane } from "../hex.ts";
import { stepWave, type StepEnv } from "./engine.ts";
import { RANGE_SCALE } from "./catalog.ts";
import { createRealtimeState, type PlacedDevice, type WaveDef } from "./types.ts";

const ENV: StepEnv = { spawnRadius: 300 };

function device(kind: "sensor" | "effector", placeableId: string, q: number, r: number): PlacedDevice {
  const radius = (placeableId === "radar" ? 4 : placeableId === "rf-df" ? 3.2 : placeableId === "net-drone" ? 2.2 : 3.5) * RANGE_SCALE;
  return { id: `${placeableId}-${q}-${r}`, kind, placeableId, hex: { q, r }, pos: hexToPlane({ q, r }), radius, cooldown: 0 };
}

function singleSpawnWave(typeId: "rf-quad" | "autonomy" | "low-observable"): WaveDef {
  return { index: 1, kind: "normal", label: "t", spawns: [{ at: 0, typeId, bearing: 0 }], stipend: 0 };
}

/** Run the sim until the wave completes or a step cap is hit. */
function runToCompletion(placed: PlacedDevice[], wave: WaveDef, seed = 1) {
  const rt = createRealtimeState();
  const rng = new Rng(seed);
  let kills = 0;
  let leaks = 0;
  for (let i = 0; i < 4000; i++) {
    const res = stepWave(rt, placed, wave, 1 / 60, rng, ENV);
    kills += res.kills.length;
    leaks += res.leaks.length;
    if (res.waveComplete) break;
  }
  return { kills, leaks };
}

describe("real-time auto-defense", () => {
  it("an undefended drone leaks into the asset", () => {
    const { kills, leaks } = runToCompletion([], singleSpawnWave("rf-quad"));
    expect(kills).toBe(0);
    expect(leaks).toBe(1);
  });

  it("radar + net-drone reliably stops an RF quad before it leaks", () => {
    const placed = [device("sensor", "radar", 0, 0), device("effector", "net-drone", 1, 0)];
    let stops = 0;
    for (let seed = 1; seed <= 40; seed++) {
      if (runToCompletion(placed, singleSpawnWave("rf-quad"), seed).kills === 1) stops++;
    }
    expect(stops).toBeGreaterThan(35);
  });

  it("an RF jammer never even engages an autonomy drone (it leaks)", () => {
    // Jammer + radar: radar tracks the autonomy drone, but the jammer has zero
    // effect on it, so it is never targeted and sails through to the asset.
    const placed = [device("sensor", "radar", 0, 0), device("effector", "rf-jammer", 1, 0)];
    const { kills, leaks } = runToCompletion(placed, singleSpawnWave("autonomy"));
    expect(kills).toBe(0);
    expect(leaks).toBe(1);
  });

  it("a net-drone DOES stop an autonomy drone (right tool)", () => {
    const placed = [device("sensor", "radar", 0, 0), device("effector", "net-drone", 1, 0)];
    let stops = 0;
    for (let seed = 1; seed <= 40; seed++) {
      if (runToCompletion(placed, singleSpawnWave("autonomy"), seed).kills === 1) stops++;
    }
    expect(stops).toBeGreaterThan(34);
  });
});

describe("brain coordination (spec §12 face 1 — same hardware, better used)", () => {
  // Four overlapping net-drones around the centre, all tracked by a central
  // radar, against a dense wave. Without coordination they dogpile the most
  // central drone and waste shots; with it they deconflict and spread fire.
  const placed: PlacedDevice[] = [
    device("sensor", "radar", 0, 0),
    device("effector", "net-drone", 1, 0),
    device("effector", "net-drone", -1, 0),
    device("effector", "net-drone", 0, 1),
    device("effector", "net-drone", 0, -1),
  ];

  function denseWave(): WaveDef {
    // A saturating swarm so the chokepoint near the centre is overwhelmed —
    // that's when wasted (dogpiled) shots turn into leaks.
    const spawns = Array.from({ length: 48 }, (_, i) => ({
      at: i * 0.08,
      typeId: "rf-quad" as const,
      bearing: (i * 47) % 360,
    }));
    return { index: 1, kind: "normal", label: "dense", spawns, stipend: 0 };
  }

  function run(coordinated: boolean, seed: number) {
    const rt = createRealtimeState();
    const rng = new Rng(seed);
    let kills = 0;
    let leaks = 0;
    const wave = denseWave();
    for (const d of placed) d.cooldown = 0;
    for (let i = 0; i < 4000; i++) {
      const res = stepWave(rt, placed, wave, 1 / 60, rng, { spawnRadius: ENV.spawnRadius, coordinated });
      kills += res.kills.length;
      leaks += res.leaks.length;
      if (res.waveComplete) break;
    }
    return { kills, leaks };
  }

  it("coordinated fire kills more and leaks less than uncoordinated, same hardware", () => {
    let coKills = 0;
    let unKills = 0;
    let coLeaks = 0;
    let unLeaks = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const co = run(true, seed);
      const un = run(false, seed);
      coKills += co.kills; coLeaks += co.leaks;
      unKills += un.kills; unLeaks += un.leaks;
    }
    expect(coKills).toBeGreaterThan(unKills);
    expect(coLeaks).toBeLessThan(unLeaks);
  });
});
