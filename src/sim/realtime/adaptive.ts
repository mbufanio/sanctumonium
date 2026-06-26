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
  hexKey,
  hexRing,
  hexToPlane,
  planeDist,
  planeLen,
  type Hex,
  type Px,
} from "../hex.ts";
import { LEAK_RADIUS, deviceStats, placeableById } from "./catalog.ts";
import { losClear, type TerrainMap } from "../terrain.ts";
import type { PlacedDevice, WaveDef } from "./types.ts";

const BINS = 24; // bearing buckets (15° each)
const NO_TERRAIN: TerrainMap = new Map();

function pointAt(bearingDeg: number, r: number): Px {
  const rad = ((bearingDeg - 90) * Math.PI) / 180;
  return { x: Math.cos(rad) * r, y: Math.sin(rad) * r };
}

/** Is point `p` tracked by some sensor with clear sight (terrain-aware)? */
function trackedAt(p: Px, sensors: PlacedDevice[], terrain: TerrainMap): boolean {
  // Use the best-case (rf-quad) trackability for a coverage estimate.
  return sensors.some((s) => s.track["rf-quad"] > 0 && planeDist(s.pos, p) <= s.radius && losClear(s.pos, p, terrain, false));
}

/** Is point `p` inside some effector's reach with a clear firing line? */
function inEffectorReach(p: Px, effectors: PlacedDevice[], terrain: TerrainMap): boolean {
  return effectors.some((e) => planeDist(e.pos, p) <= e.radius && losClear(e.pos, p, terrain, true));
}

/**
 * Fraction of the approach path along `bearing` that is "kill-covered" (an
 * effector can reach it AND a sensor tracks it, both with clear LOS). 1 = fully
 * defended, 0 = a wide-open seam.
 */
export function bearingStrength(placed: PlacedDevice[], spawnRadius: number, bearing: number, terrain: TerrainMap = NO_TERRAIN): number {
  const sensors = placed.filter((p) => p.kind === "sensor");
  const effectors = placed.filter((p) => p.kind === "effector");
  let covered = 0;
  let total = 0;
  for (let r = spawnRadius; r >= LEAK_RADIUS; r -= 18) {
    total++;
    const p = pointAt(bearing, r);
    if (inEffectorReach(p, effectors, terrain) && trackedAt(p, sensors, terrain)) covered++;
  }
  return total ? covered / total : 0;
}

/** Per-bin weakness (1 - strength) around the full 360°. */
export function seamWeakness(placed: PlacedDevice[], spawnRadius: number, terrain: TerrainMap = NO_TERRAIN): number[] {
  const out: number[] = [];
  for (let i = 0; i < BINS; i++) {
    out.push(1 - bearingStrength(placed, spawnRadius, (360 / BINS) * i, terrain));
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
export function adaptWave(wave: WaveDef, placed: PlacedDevice[], spawnRadius: number, rng: Rng, terrain: TerrainMap = NO_TERRAIN): WaveDef {
  const adaptiveness = waveAdaptiveness(wave.index);
  const weak = seamWeakness(placed, spawnRadius, terrain);
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
 * Soft per-bearing coverage in [0..1]: along the approach, the average of
 * "an effector can reach here" (weighted 0.55 — the actual killer) and "a
 * sensor tracks here" (0.45). Unlike the strict AND in bearingStrength, this
 * rewards PARTIAL progress, so the brain can give sound incremental advice:
 * a seam with neither gets an effector first, then a sensor next round.
 */
function bearingCoverageSoft(placed: PlacedDevice[], spawnRadius: number, bearing: number, terrain: TerrainMap): number {
  const sensors = placed.filter((p) => p.kind === "sensor");
  const effectors = placed.filter((p) => p.kind === "effector");
  let sum = 0;
  let total = 0;
  for (let r = spawnRadius; r >= LEAK_RADIUS; r -= 18) {
    total++;
    const p = pointAt(bearing, r);
    if (inEffectorReach(p, effectors, terrain)) sum += 0.55;
    if (trackedAt(p, sensors, terrain)) sum += 0.45;
  }
  return total ? sum / total : 0;
}

/** Total soft coverage over a set of bearing bins (the seam + its neighbours). */
function windowCoverage(placed: PlacedDevice[], spawnRadius: number, bins: number[], terrain: TerrainMap): number {
  let s = 0;
  for (const b of bins) s += bearingCoverageSoft(placed, spawnRadius, (360 / BINS) * b, terrain);
  return s;
}

/** A throwaway placed device (level 0) for evaluating a candidate placement. */
function simDevice(placeableId: string, hex: Hex): PlacedDevice {
  const pl = placeableById(placeableId)!;
  const st = deviceStats(pl, 0);
  return {
    id: `sim-${placeableId}`,
    kind: pl.kind,
    placeableId,
    hex,
    pos: hexToPlane(hex),
    level: 0,
    radius: st.radius,
    fireInterval: st.fireInterval,
    magazine: st.magazine,
    reloadTime: st.reloadTime,
    ammo: st.magazine,
    reloadCd: 0,
    aoe: st.aoe,
    effect: st.effect,
    track: st.track,
    cooldown: 0,
  };
}

/**
 * The brain's single best between-round suggestion, or null if the layout is
 * solid / nothing affordable.
 *
 * It finds the genuinely weakest approach bearing, then SEARCHES candidate
 * placements (a basic device on a free hex near that bearing, at several rings)
 * and recommends the one that most improves coverage of that seam and its
 * neighbours. Because it's measured by actual coverage gain, it never tells you
 * to stack gear where you're already strong (that yields ~0 gain) — it always
 * points at your real weak spot and the device that closes it.
 */
export function recommendPlacement(
  placed: PlacedDevice[],
  currency: number,
  spawnRadius: number,
  maxRings: number,
  terrain: TerrainMap = NO_TERRAIN,
  occupiedExtra: Set<string> = new Set(),
): Recommendation | null {
  const occupied = new Set([...placed.map((d) => hexKey(d.hex)), ...occupiedExtra]);

  // Locate the weakest bearing (highest kill-coverage seam).
  const weak = seamWeakness(placed, spawnRadius, terrain);
  let worstBin = 0;
  for (let i = 1; i < weak.length; i++) if (weak[i] > weak[worstBin]) worstBin = i;
  if (weak[worstBin] < 0.3) return null; // layout is solid — don't nag

  const worstBearing = (360 / BINS) * worstBin;
  // Value the seam plus its immediate neighbours, so a recommendation that
  // covers a swath beats one that plugs a single hairline gap.
  const window = [worstBin, (worstBin + 1) % BINS, (worstBin + BINS - 1) % BINS, (worstBin + 2) % BINS, (worstBin + BINS - 2) % BINS];
  const base = windowCoverage(placed, spawnRadius, window, terrain);

  // Candidates the brain suggests: basic, affordable gear (a shooter and eyes).
  const candIds = ["net-drone", "radar", "rf-jammer", "rf-df"].filter((id) => {
    const p = placeableById(id);
    return p && currency >= p.cost;
  });
  if (!candIds.length) return null;

  let best: { id: string; hex: Hex } | null = null;
  let bestGain = 0;
  for (const id of candIds) {
    for (const ring of [2, 3, 4, 5]) {
      const hex = freeHexOnBearing(worstBearing, ring, occupied, maxRings);
      if (!hex) continue;
      const gain = windowCoverage([...placed, simDevice(id, hex)], spawnRadius, window, terrain) - base;
      if (gain > bestGain + 1e-6) {
        bestGain = gain;
        best = { id, hex };
      }
    }
  }

  if (!best || bestGain < 0.04) return null; // nothing meaningfully helps here

  const p = placeableById(best.id)!;
  const compass = compassOf(worstBearing);
  const reason =
    p.kind === "sensor"
      ? `Threats from the ${compass} aren't being tracked — add a ${p.name} there to lock them.`
      : `The ${compass} approach is weakly covered — add a ${p.name} there to close it.`;
  return { placeableId: best.id, hex: best.hex, compass, reason };
}
