import { describe, expect, it } from "vitest";
import { diagnoseDrill, drillFreezeReady } from "./diagnose.ts";
import { createRealtimeState, type Drone, type PlacedDevice } from "./types.ts";
import type { ThreatTypeId } from "../boss/types.ts";

const NO_TERRAIN = new Map();

function drone(id: number, x: number, y: number, opts: Partial<Drone> = {}): Drone {
  return {
    id,
    typeId: "rf-quad",
    pos: { x, y },
    speed: 40,
    hp: 1,
    bounty: 10,
    leakDamage: 10,
    state: "alive",
    detected: true,
    detectedAt: 0,
    idConf: 1,
    tracked: true,
    trackId: id,
    trackerIds: [],
    size: 1,
    ...opts,
  };
}

/** A wide-open device (huge range) so diagnosis turns on kill-chain state, not
 *  geometry — range/LOS are exercised by the engine tests. */
function sensor(id: string, track: Partial<Record<ThreatTypeId, number>>): PlacedDevice {
  return {
    id, kind: "sensor", placeableId: "radar", hex: { q: 0, r: 0 }, pos: { x: 0, y: 0 }, level: 0,
    radius: 9999, fireInterval: 0, magazine: 0, reloadTime: 0, ammo: 0, reloadCd: 0, aoe: 0,
    effect: { "rf-quad": 0, autonomy: 0, "low-observable": 0 },
    track: { "rf-quad": 0, autonomy: 0, "low-observable": 0, ...track },
    trackCapacity: 4, cooldown: 0,
  };
}

function effector(id: string, effect: Partial<Record<ThreatTypeId, number>>): PlacedDevice {
  return {
    id, kind: "effector", placeableId: "net-drone", hex: { q: 1, r: 0 }, pos: { x: 10, y: 0 }, level: 0,
    radius: 9999, fireInterval: 1, magazine: 0, reloadTime: 0, ammo: 0, reloadCd: 0, aoe: 0,
    effect: { "rf-quad": 0, autonomy: 0, "low-observable": 0, ...effect },
    track: { "rf-quad": 0, autonomy: 0, "low-observable": 0 },
    trackCapacity: 0, cooldown: 0,
  };
}

describe("drill freeze trigger", () => {
  it("does not fire on an empty or sparse field", () => {
    const rt = createRealtimeState();
    expect(drillFreezeReady(rt, false, false)).toBe(false);
    rt.drones = [drone(1, 20, 0), drone(2, 25, 0)]; // only two in the crunch
    expect(drillFreezeReady(rt, false, false)).toBe(false);
  });

  it("fires when the front presses in (three near the asset)", () => {
    const rt = createRealtimeState();
    rt.drones = [drone(1, 20, 0), drone(2, 25, 0), drone(3, 30, 0)];
    expect(drillFreezeReady(rt, false, false)).toBe(true);
  });

  it("coordinated fires at the full-push peak even when nothing is close yet", () => {
    const rt = createRealtimeState();
    // A full push, all far out (beyond the near ring) but spawned. More than the
    // tail-safety count, so only the coordinated peak fires.
    rt.drones = [drone(1, 240, 0), drone(2, 0, 240), drone(3, -240, 0), drone(4, 0, -240)];
    expect(drillFreezeReady(rt, false, true)).toBe(false); // uncoordinated waits for the crunch
    expect(drillFreezeReady(rt, true, true)).toBe(true);
  });
});

describe("drill diagnosis", () => {
  const sensors = [sensor("s1", { "rf-quad": 0.9 })];
  const nets = [effector("e1", { "rf-quad": 0.9 })];

  it("uncoordinated singles out one dog-piled magnet; the rest leak untouched", () => {
    const rt = createRealtimeState();
    rt.drones = [drone(1, 20, 0), drone(2, 40, 0), drone(3, 60, 0)];
    const diag = diagnoseDrill(rt, [...sensors, ...nets], false, NO_TERRAIN);
    expect(diag.map((d) => d.tag)).toEqual(["DOG-PILED", "NO SHOOTER FREE", "NO SHOOTER FREE"]);
    expect(diag[0].tone).toBe("warn");
    expect(diag[1].tone).toBe("bad");
  });

  it("uncoordinated flags an untracked overflow drone as off the picture", () => {
    const rt = createRealtimeState();
    rt.drones = [drone(1, 20, 0), drone(2, 40, 0, { tracked: false })];
    const diag = diagnoseDrill(rt, [...sensors, ...nets], false, NO_TERRAIN);
    const off = diag.find((d) => d.droneId === 2);
    expect(off?.tag).toBe("OFF THE PICTURE");
    expect(off?.tone).toBe("bad");
  });

  it("coordinated marks every threat handled (held, never dropped)", () => {
    const rt = createRealtimeState();
    rt.drones = [drone(1, 20, 0), drone(2, 40, 0, { tracked: false })];
    const diag = diagnoseDrill(rt, [...sensors, ...nets], true, NO_TERRAIN);
    expect(diag.every((d) => d.tone === "good")).toBe(true);
    // The untracked one is reassured as held in the pooled net, not dropped.
    expect(diag.find((d) => d.droneId === 2)?.tag).toBe("IN THE NET");
  });
});
