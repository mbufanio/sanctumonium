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

function effector(id: string, placeableId: string, x: number, effect: Partial<Record<ThreatTypeId, number>>): PlacedDevice {
  return {
    id, kind: "effector", placeableId, hex: { q: 1, r: 0 }, pos: { x, y: 0 }, level: 0,
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

describe("drill diagnosis (spatially verified)", () => {
  const sensors = [sensor("s1", { "rf-quad": 0.9, autonomy: 0.9 })];

  it("PASSES OVER the drone closer to the asset when the net is on a nearer contact", () => {
    // Net at x=50. Its NEAREST tracked contact is d2 (x=48) — so it fires there.
    // d1 (x=20) is closest to the ASSET and in range, but passed over; d3 (x=70) too.
    const net = effector("e1", "net-drone", 50, { "rf-quad": 0.9, autonomy: 0.9 });
    const rt = createRealtimeState();
    rt.drones = [drone(1, 20, 0), drone(2, 48, 0), drone(3, 70, 0)];
    const diag = diagnoseDrill(rt, [...sensors, net], false, NO_TERRAIN);
    // d2 is being killed (net's nearest) → omitted; d1 and d3 are passed over.
    expect(diag.map((d) => d.droneId).sort()).toEqual([1, 3]);
    expect(diag.every((d) => d.tag === "PASSED OVER")).toBe(true);
    const lead = diag.find((d) => d.droneId === 1)!;
    expect(lead.tone).toBe("bad");
    expect(lead.detail).toContain("closest threat to the asset");
    expect(lead.detail).toContain(`TRK ${String(2).padStart(4, "0")}`); // names the point-blank contact
  });

  it("flags a jammer's WASTED SHOT on an autonomy it can't kill", () => {
    // Only a jammer is in range of the autonomy; it fires (nearest) but can't kill it.
    const jam = effector("j1", "rf-jammer", 40, { "rf-quad": 0.9, autonomy: 0 });
    const rt = createRealtimeState();
    rt.drones = [drone(1, 20, 0, { typeId: "autonomy" })];
    const diag = diagnoseDrill(rt, [...sensors, jam], false, NO_TERRAIN);
    expect(diag[0].tag).toBe("WASTED SHOT");
    expect(diag[0].detail).toContain("jammer");
  });

  it("marks an untracked drone off the picture (verified from sensor coverage)", () => {
    const net = effector("e1", "net-drone", 50, { "rf-quad": 0.9 });
    const rt = createRealtimeState();
    rt.drones = [drone(1, 48, 0), drone(2, 40, 0, { tracked: false })];
    const diag = diagnoseDrill(rt, [...sensors, net], false, NO_TERRAIN);
    const off = diag.find((d) => d.droneId === 2)!;
    expect(off.tag).toBe("OFF THE PICTURE");
    expect(off.tone).toBe("bad");
  });

  it("coordinated frames every threat as prioritised/assigned, not passed over", () => {
    const net = effector("e1", "net-drone", 50, { "rf-quad": 0.9, autonomy: 0.9 });
    const rt = createRealtimeState();
    rt.drones = [drone(1, 20, 0), drone(2, 40, 0, { typeId: "autonomy" })];
    const diag = diagnoseDrill(rt, [...sensors, net], true, NO_TERRAIN);
    expect(diag.every((d) => d.tone === "good")).toBe(true);
    expect(diag.every((d) => d.tag === "ASSIGNED" || d.tag === "PRIORITISED")).toBe(true);
  });
});
