/**
 * Hexagonal grid system (spec §3/§9, revised architecture).
 *
 * The defended asset sits at the ORIGIN (0,0) and the playfield radiates 360°
 * around it as concentric rings of flat-top hexes. Threats approach from any
 * bearing; coverage is read radially — which matches the boss console's radar
 * scope. A modest vertical squash gives the stylized 2.5D isometric feel
 * without a true 3D camera.
 *
 * Axial coordinates (q, r); cube distance for range. Pure math, no rendering.
 * Reference: redblobgames.com/grids/hexagons (flat-top, axial).
 */

export interface Hex {
  q: number;
  r: number;
}

export interface Px {
  x: number;
  y: number;
}

/** Center-to-corner distance of a hex in pixels, before the iso squash. */
export const HEX_SIZE = 34;

/** Vertical compression applied to screen-Y for the 2.5D isometric look. */
export const ISO_SQUASH = 0.62;

const SQRT3 = Math.sqrt(3);

/** The six flat-top neighbour directions, in axial coords. */
export const HEX_DIRS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export const ORIGIN: Hex = { q: 0, r: 0 };

export function hexAdd(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

/** Stable string key for sets/maps. */
export function hexKey(h: Hex): string {
  return `${h.q},${h.r}`;
}

/** Cube distance from the origin (number of rings out). */
export function hexLength(h: Hex): number {
  return (Math.abs(h.q) + Math.abs(h.q + h.r) + Math.abs(h.r)) / 2;
}

/** Cube distance between two hexes. */
export function hexDistance(a: Hex, b: Hex): number {
  return hexLength({ q: a.q - b.q, r: a.r - b.r });
}

/** Flat-top axial hex → pixel (with iso squash). Origin maps to (0,0). */
export function hexToPixel(h: Hex): Px {
  const x = HEX_SIZE * (1.5 * h.q);
  const y = HEX_SIZE * (SQRT3 * (h.r + h.q / 2)) * ISO_SQUASH;
  return { x, y };
}

/** Pixel → nearest hex (inverse of hexToPixel), for input hit-testing. */
export function pixelToHex(p: Px): Hex {
  const q = ((2 / 3) * p.x) / HEX_SIZE;
  const r = (-(1 / 3) * p.x + (SQRT3 / 3) * (p.y / ISO_SQUASH)) / HEX_SIZE;
  return hexRound({ q, r });
}

/** Round fractional axial coords to the nearest hex (via cube rounding). */
export function hexRound(h: Hex): Hex {
  let rx = Math.round(h.q);
  let ry = Math.round(-h.q - h.r);
  let rz = Math.round(h.r);
  const dx = Math.abs(rx - h.q);
  const dy = Math.abs(ry - (-h.q - h.r));
  const dz = Math.abs(rz - h.r);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

/** All hexes within `radius` rings of the origin (a hexagon-shaped field). */
export function hexesWithin(radius: number): Hex[] {
  const out: Hex[] = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) out.push({ q, r });
  }
  return out;
}

/** The single ring of hexes exactly `radius` out from the origin. */
export function hexRing(radius: number): Hex[] {
  if (radius <= 0) return [{ q: 0, r: 0 }];
  const out: Hex[] = [];
  // Start at the corner `radius` steps in direction 4, then walk the 6 sides.
  let h: Hex = { q: HEX_DIRS[4].q * radius, r: HEX_DIRS[4].r * radius };
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      out.push(h);
      h = hexAdd(h, HEX_DIRS[side]);
    }
  }
  return out;
}

/** The six pixel corners of a hex centred at `c` (flat-top, iso-squashed). */
export function hexCorners(c: Px): Px[] {
  const pts: Px[] = [];
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI / 180) * (60 * i);
    pts.push({ x: c.x + HEX_SIZE * Math.cos(ang), y: c.y + HEX_SIZE * Math.sin(ang) * ISO_SQUASH });
  }
  return pts;
}

/** Painter's-algorithm depth key (draw back-to-front by screen Y). */
export function hexDepth(h: Hex): number {
  return hexToPixel(h).y;
}

/** Unit-ish world distance from the asset, in "rings" — handy for ranges. */
export function ringDistance(h: Hex): number {
  return hexLength(h);
}
