import { describe, expect, it } from "vitest";
import { Rng } from "../rng.ts";
import { HEX_SIZE, hexKey, hexToPlane, ringDistance, type Hex } from "../hex.ts";
import { LEVEL_1 } from "../level.ts";
import { makePlaced } from "../state.ts";
import { adaptWave, recommendPlacement, seamWeakness } from "./adaptive.ts";
import type { PlacedDevice, WaveDef } from "./types.ts";

const SPAWN_RADIUS = LEVEL_1.rings * HEX_SIZE * Math.sqrt(3) + HEX_SIZE * 1.5;

function dev(_kind: "sensor" | "effector", placeableId: string, hex: Hex): PlacedDevice {
  return makePlaced(placeableId, hex);
}

function bigWave(n: number): WaveDef {
  const spawns = Array.from({ length: n }, (_, i) => ({ at: i * 0.1, typeId: "rf-quad" as const, bearing: 0 }));
  return { index: 9, kind: "normal", label: "t", spawns, stipend: 0 };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// A layout that only defends the EAST (positive-q) side, leaving the west open.
const eastOnly: PlacedDevice[] = [
  dev("sensor", "radar", { q: 3, r: 0 }),
  dev("effector", "net-drone", { q: 2, r: 0 }),
  dev("effector", "net-drone", { q: 3, r: -1 }),
  dev("effector", "net-drone", { q: 3, r: 1 }),
];

describe("adaptive enemy (spec §2/§6 — probes seams)", () => {
  it("biases spawns toward weaker-than-average bearings", () => {
    const weak = seamWeakness(eastOnly, SPAWN_RADIUS);
    const avg = mean(weak);
    const adapted = adaptWave(bigWave(80), eastOnly, SPAWN_RADIUS, new Rng(7));
    const spawnWeak = adapted.spawns.map((s) => weak[Math.floor(s.bearing / 15) % 24]);
    // The enemy concentrates on seams: its spawns are, on average, weaker spots.
    expect(mean(spawnWeak)).toBeGreaterThan(avg + 0.05);
  });

  it("a fully-open field (no defenses) has uniformly high weakness", () => {
    const weak = seamWeakness([], SPAWN_RADIUS);
    expect(Math.min(...weak)).toBeGreaterThan(0.9);
  });
});

describe("brain recommendation (spec §12 face 3)", () => {
  it("suggests a placement that reduces the worst seam, on a free in-field hex", () => {
    const before = Math.max(...seamWeakness(eastOnly, SPAWN_RADIUS));
    const rec = recommendPlacement(eastOnly, 999, SPAWN_RADIUS, LEVEL_1.rings);
    expect(rec).not.toBeNull();
    // Valid target: empty, on the field.
    expect(eastOnly.some((d) => hexKey(d.hex) === hexKey(rec!.hex))).toBe(false);
    expect(ringDistance(rec!.hex)).toBeLessThanOrEqual(LEVEL_1.rings);
    expect(ringDistance(rec!.hex)).toBeGreaterThan(0);
    // Accepting it actually helps: worst seam shrinks.
    const after = Math.max(...seamWeakness([...eastOnly, dev(rec!.placeableId === "radar" ? "sensor" : "effector", rec!.placeableId, rec!.hex)], SPAWN_RADIUS));
    expect(after).toBeLessThanOrEqual(before);
  });

  it("returns nothing when funds can't afford the fix", () => {
    expect(recommendPlacement(eastOnly, 0, SPAWN_RADIUS, LEVEL_1.rings)).toBeNull();
  });

  it("points at a WEAK bearing, never stacks where already strong", () => {
    // eastOnly defends the east; the seams are everywhere else. The brain must
    // aim away from the defended east — the exact bug the player reported
    // (it was piling devices onto the already-strong side).
    const rec = recommendPlacement(eastOnly, 999, SPAWN_RADIUS, LEVEL_1.rings);
    expect(rec).not.toBeNull();
    // Never the already-strong east half.
    expect(["E", "NE", "SE"]).not.toContain(rec!.compass);
    // The recommended hex is NOT on the strong east side (positive-x).
    expect(hexToPlane(rec!.hex).x).toBeLessThanOrEqual(0);
    // And accepting it does not worsen that bearing's coverage.
    const before = seamWeakness(eastOnly, SPAWN_RADIUS);
    const bin = bearingBin(rec!.hex);
    const after = seamWeakness([...eastOnly, dev("sensor", rec!.placeableId, rec!.hex)], SPAWN_RADIUS);
    expect(after[bin]).toBeLessThanOrEqual(before[bin] + 1e-9);
  });
});

/** Bearing bin (0..23) of a hex around the centre — mirrors adaptive's binning. */
function bearingBin(h: Hex): number {
  const p = hexToPlane(h);
  const deg = ((Math.atan2(p.x, -p.y) * 180) / Math.PI + 360) % 360;
  return Math.floor(deg / 15) % 24;
}
