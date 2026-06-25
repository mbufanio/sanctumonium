/**
 * Adaptive enemy + layout analysis (spec §2, §6, §12 face 3).
 *
 * Two jobs that share one piece of geometry — "how well is each approach
 * bearing defended?":
 *   1. The adaptive enemy biases wave spawns toward the player's coverage
 *      SEAMS (weakly-defended bearings), so messy layouts get punished and the
 *      bosses feel like they hit weak spots.
 *   2. The brain's between-round RECOMMENDATIONS use the same weakness map to
 *      suggest one concrete fix (cover this approach / this effector is blind).
 *
 * "Defended" means a drone on that approach can actually be KILLED: an effector
 * in range AND a sensor tracking it (untracked fire barely works — see engine).
 *
 * Pure logic, no rendering.
 */
import { Rng } from "../rng.ts";
import {
  HEX_SIZE,
  hexKey,
  hexRing,
  hexToPlane,
  planeDist,
  planeLen,
  type Hex,
  type Px,
} from "../hex.ts";
import { SENSOR_TYPES } from "../boss/data.ts";
import { LEAK_RADIUS, placeableById } from "./catalog.ts";
import type { PlacedDevice, WaveDef } from "./types.ts";
import type { SensorTypeId } from "../boss/types.ts";

const BINS = 24; // bearing buckets (15° each)

function pointAt(bearingDeg: number, r: number): Px {
  const rad = ((bearingDeg - 90) * Math.PI) / 180;
  return { x: Math.cos(rad) * r, y: Math.sin(rad) * r };
}

/** Is point `p` tracked by some sensor that can see a generic drone there? */
function trackedAt(p: Px, sensors: PlacedDevice[]): boolean {
  return sensors.some((s) => {
    const sen = SENSOR_TYPES[s.placeableId as SensorTypeId];
    // Use the best-case (rf-quad) trackability for a coverage estimate.
    return sen.track["rf-quad"] > 0 && planeDist(s.pos, p) <= s.radius;
  });
}

/** Is point `p` inside some effector's reach? */
function inEffectorReach(p: Px, effectors: PlacedDevice[]): boolean {
  return effectors.some((e) => planeDist(e.pos, p) <= e.radius);
}

/**
 * Fraction of the approach path along `bearing` that is "kill-covered" (an
 * effector can reach it AND a sensor tracks it). 1 = fully defended, 0 = a
 * wide-open seam.
 */
export function bearingStrength(placed: PlacedDevice[], spawnRadius: number, bearing: number): number {
  const sensors = placed.filter((p) => p.kind === "sensor");
  const effectors = placed.filter((p) => p.kind === "effector");
  let covered = 0;
  let total = 0;
  for (let r = spawnRadius; r >= LEAK_RADIUS; r -= 18) {
    total++;
    const p = pointAt(bearing, r);
    if (inEffectorReach(p, effectors) && trackedAt(p, sensors)) covered++;
  }
  return total ? covered / total : 0;
}

/** Per-bin weakness (1 - strength) around the full 360°. */
export function seamWeakness(placed: PlacedDevice[], spawnRadius: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < BINS; i++) {
    out.push(1 - bearingStrength(placed, spawnRadius, (360 / BINS) * i));
  }
  return out;
}

/** Adaptiveness [0..1] of a wave by index — later waves probe seams harder. */
export function waveAdaptiveness(index: number): number {
  return Math.min(0.7, 0.2 + index * 0.07);
}

/**
 * Reassign each spawn's bearing toward the player's seams (spec adaptive enemy).
 * adaptiveness 0 → unchanged/uniform; 1 → strongly concentrated on weak bins.
 * Returns a NEW WaveDef so the template stays pure.
 */
export function adaptWave(wave: WaveDef, placed: PlacedDevice[], spawnRadius: number, rng: Rng): WaveDef {
  const adaptiveness = waveAdaptiveness(wave.index);
  const weak = seamWeakness(placed, spawnRadius);
  // Weight bins by weakness, sharpened by adaptiveness. The floor keeps the
  // enemy from funnelling 100% at the single weakest bin (a bit of spread).
  const exp = 1 + adaptiveness * 4;
  const weights = weak.map((w) => Math.pow(w + 0.08, exp));
  const spawns = wave.spawns.map((s) => ({ ...s, bearing: sampleBearing(weights, rng) }));
  return { ...wave, spawns };
}

function sampleBearing(weights: number[], rng: Rng): number {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let t = rng.next() * total;
  let bin = 0;
  for (let i = 0; i < weights.length; i++) {
    t -= weights[i];
    if (t <= 0) {
      bin = i;
      break;
    }
  }
  // Jitter within the bin so spawns aren't perfectly stacked.
  return ((360 / BINS) * (bin + rng.next())) % 360;
}

// ---- brain recommendation (face 3) ---------------------------------------

export interface Recommendation {
  placeableId: string;
  hex: Hex;
  /** Player-facing one-liner. */
  reason: string;
  /** Compass label of the approach this addresses. */
  compass: string;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
function compassOf(bearing: number): string {
  return COMPASS[Math.round(bearing / 45) % 8];
}

/** Bearing (deg, 0 = north) of a hex around the centre. */
function bearingOfHex(h: Hex): number {
  const p = hexToPlane(h);
  if (planeLen(p) < 1e-6) return 0;
  return ((Math.atan2(p.x, -p.y) * 180) / Math.PI + 360) % 360;
}

/** Nearest free hex to a target bearing at a given ring radius. */
function freeHexOnBearing(bearing: number, ring: number, occupied: Set<string>, maxRings: number): Hex | null {
  let best: Hex | null = null;
  let bestErr = Infinity;
  for (const h of hexRing(ring)) {
    if (occupied.has(hexKey(h))) continue;
    let err = Math.abs(((bearingOfHex(h) - bearing + 540) % 360) - 180);
    if (err < bestErr) {
      bestErr = err;
      best = h;
    }
  }
  if (best) return best;
  // Fall back to an adjacent ring if this one is full.
  if (ring + 1 <= maxRings) return freeHexOnBearing(bearing, ring + 1, occupied, maxRings);
  return null;
}

/**
 * The brain's single best between-round suggestion, or null if the layout is
 * solid / nothing affordable. Prefers closing the worst kill-coverage seam;
 * failing that, giving a blind effector a sensor.
 */
export function recommendPlacement(
  placed: PlacedDevice[],
  currency: number,
  spawnRadius: number,
  maxRings: number,
): Recommendation | null {
  const occupied = new Set(placed.map((d) => hexKey(d.hex)));
  const effectors = placed.filter((p) => p.kind === "effector");
  const sensors = placed.filter((p) => p.kind === "sensor");

  // 1. Worst seam — is there an approach an effector can't even reach?
  const weak = seamWeakness(placed, spawnRadius);
  let worstBin = 0;
  for (let i = 1; i < weak.length; i++) if (weak[i] > weak[worstBin]) worstBin = i;
  const worstBearing = (360 / BINS) * worstBin;

  if (weak[worstBin] > 0.45) {
    // Does that bearing lack effector reach, or just tracking?
    const effReach = effectors.some((e) =>
      planeDist(e.pos, pointAt(worstBearing, e.radius)) <= e.radius && bearingNear(e.hex, worstBearing),
    );
    const placeable = effReach ? "radar" : "net-drone";
    const p = placeableById(placeable)!;
    if (currency >= p.cost) {
      const hex = freeHexOnBearing(worstBearing, effReach ? 4 : 3, occupied, maxRings);
      if (hex) {
        return {
          placeableId: placeable,
          hex,
          compass: compassOf(worstBearing),
          reason: effReach
            ? `Threats from the ${compassOf(worstBearing)} aren't being tracked — add a Radar to lock them.`
            : `The ${compassOf(worstBearing)} approach is wide open — drop a Net-Drone to cover it.`,
        };
      }
    }
  }

  // 2. A blind effector (no sensor overlap) — give it eyes.
  const blind = effectors.find((e) => !sensors.some((s) => planeDist(s.pos, e.pos) <= s.radius));
  if (blind) {
    const p = placeableById("radar")!;
    if (currency >= p.cost) {
      const hex = freeHexOnBearing(bearingOfHex(blind.hex), Math.max(2, Math.round(planeLen(blind.pos) / (HEX_SIZE * 1.5))), occupied, maxRings);
      if (hex) {
        return {
          placeableId: "radar",
          hex,
          compass: compassOf(bearingOfHex(blind.hex)),
          reason: `Your ${placeableById(blind.placeableId)?.name} is firing blind — add a Radar nearby to track for it.`,
        };
      }
    }
  }

  return null;
}

function bearingNear(hex: Hex, bearing: number): boolean {
  const err = Math.abs(((bearingOfHex(hex) - bearing + 540) % 360) - 180);
  return err < 40;
}
