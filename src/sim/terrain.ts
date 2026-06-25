/**
 * Terrain & line-of-sight (site complexity).
 *
 * Two kinds of obstruction make placement a real spatial puzzle:
 *   • "blocker"  — a structure. Blocks BOTH tracking and engagement LOS: you
 *      can't see or shoot through a building. You can't build on it either.
 *   • "nofire"   — a restricted zone (runway, crowd). Blocks EFFECTOR fire
 *      across it (you can't fire over the runway / into the crowd), but sensors
 *      still track through it. You can't build on it.
 *
 * Line-of-sight is sampled along the plane-space segment between a device and a
 * drone. Area effectors (AOE) ignore per-target LOS — area weapons are exactly
 * what you want when terrain blocks direct fire.
 *
 * Pure logic. No rendering.
 */
import {
  HEX_SIZE,
  hexKey,
  hexRound,
  planeToHex,
  type Hex,
  type Px,
} from "./hex.ts";

export type TerrainKind = "blocker" | "nofire";

export interface TerrainCell {
  hex: Hex;
  kind: TerrainKind;
}

export type TerrainMap = Map<string, TerrainKind>;

export function buildTerrain(cells: TerrainCell[]): TerrainMap {
  const m: TerrainMap = new Map();
  for (const c of cells) m.set(hexKey(c.hex), c.kind);
  return m;
}

export function terrainAt(t: TerrainMap, h: Hex): TerrainKind | undefined {
  return t.get(hexKey(h));
}

/** A device cannot be placed on any terrain cell. */
export function isBlockedForBuild(t: TerrainMap, h: Hex): boolean {
  return t.has(hexKey(h));
}

const SAMPLE = HEX_SIZE * 0.8;

/**
 * Is the straight segment from `from` to `to` clear of obstruction? Blockers
 * always obstruct; no-fire zones obstruct only when `blockNofire` (effector
 * fire). Endpoints are excluded so a device sitting beside terrain still works.
 */
export function losClear(from: Px, to: Px, t: TerrainMap, blockNofire: boolean): boolean {
  if (t.size === 0) return true;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(2, Math.ceil(dist / SAMPLE));
  for (let i = 1; i < steps; i++) {
    const x = from.x + (dx * i) / steps;
    const y = from.y + (dy * i) / steps;
    const k = t.get(hexKey(planeToHex({ x, y })));
    if (k === "blocker") return false;
    if (k === "nofire" && blockNofire) return false;
  }
  return true;
}

// ---- layout authoring helpers --------------------------------------------

/** Cells on a straight line between two hexes (inclusive) — e.g. a runway. */
export function hexLine(a: Hex, b: Hex): Hex[] {
  const dist = (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
  const out: Hex[] = [];
  const n = Math.max(1, dist);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(hexRound({ q: a.q + (b.q - a.q) * t, r: a.r + (b.r - a.r) * t }));
  }
  return out;
}

/** A small filled cluster of cells around a centre (radius in rings). */
export function hexCluster(center: Hex, radius: number): Hex[] {
  const out: Hex[] = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) out.push({ q: center.q + q, r: center.r + r });
  }
  return out;
}

export function cells(hexes: Hex[], kind: TerrainKind): TerrainCell[] {
  return hexes.map((hex) => ({ hex, kind }));
}
