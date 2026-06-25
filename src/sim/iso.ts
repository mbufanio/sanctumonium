/**
 * Isometric projection helpers (spec §3/§4).
 *
 * The world is a grid in "tile space" (gx, gy). We project to 2:1 isometric
 * screen space. This lives in sim-adjacent code because both the renderer and
 * input/hit-testing need a single source of truth for the mapping.
 *
 * Pure math, no rendering dependency.
 */

/** A point in logical world/tile coordinates. */
export interface WorldPoint {
  gx: number;
  gy: number;
}

/** A point in screen/pixel space (before camera offset). */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** Half-width and half-height of one tile in pixels (2:1 isometric diamond). */
export const TILE_W = 64;
export const TILE_H = 32;

/** World grid → screen (relative to the world origin at 0,0). */
export function worldToScreen(p: WorldPoint): ScreenPoint {
  return {
    x: (p.gx - p.gy) * (TILE_W / 2),
    y: (p.gx + p.gy) * (TILE_H / 2),
  };
}

/** Screen → world grid (inverse of worldToScreen). */
export function screenToWorld(s: ScreenPoint): WorldPoint {
  const a = s.x / (TILE_W / 2);
  const b = s.y / (TILE_H / 2);
  return {
    gx: (a + b) / 2,
    gy: (b - a) / 2,
  };
}

/** Depth key for painter's-algorithm sprite sorting (back-to-front). */
export function depth(p: WorldPoint): number {
  return p.gx + p.gy;
}

export function dist(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(a.gx - b.gx, a.gy - b.gy);
}
