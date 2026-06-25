import { describe, expect, it } from "vitest";
import { Rng } from "../rng.ts";
import { HEX_SIZE, hexKey, hexToPlane, ringDistance, type Hex } from "../hex.ts";
import { LEVEL_1 } from "../level.ts";
import { adaptWave, recommendPlacement, seamWeakness } from "./adaptive.ts";
import { RANGE_SCALE } from "./catalog.ts";
import type { PlacedDevice, WaveDef } from "./types.ts";

const SPAWN_RADIUS = LEVEL_1.rings * HEX_SIZE * Math.sqrt(3) + HEX_SIZE * 1.5;

function dev(kind: "sensor" | "effector", placeableId: string, hex: Hex): PlacedDevice {
  const km = placeableId === "radar" ? 4 : placeableId === "rf-df" ? 3.2 : placeableId === "net-drone" ? 2.2 : 3.5;
  return { id: hexKey(hex) + placeableId, kind, placeableId, hex, pos: hexToPlane(hex), radius: km * RANGE_SCALE, cooldown: 0 };
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
});
