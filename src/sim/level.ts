/**
 * Level / site definitions (spec §9). Levels are DATA over one engine so new
 * sites are cheap. Phase 0 ships Level 1 — the military facility — as the lead.
 */
import type { WorldPoint } from "./iso.ts";

export interface AssetDef {
  id: string;
  name: string;
  pos: WorldPoint;
  /** Footprint radius in tiles, for the protected-asset ring. */
  radius: number;
}

export interface LevelDef {
  id: string;
  name: string;
  /** Grid size in tiles. */
  cols: number;
  rows: number;
  assets: AssetDef[];
  /** Tile coords that read as the perimeter / approach corridors (cosmetic). */
  perimeter: WorldPoint[];
}

/** Level 1 — Military facility (BUILD FIRST, the lead — spec §9). */
export const LEVEL_1: LevelDef = {
  id: "mil-facility",
  name: "Forward Operating Base",
  cols: 14,
  rows: 14,
  assets: [{ id: "command", name: "Command Post", pos: { gx: 7, gy: 7 }, radius: 2 }],
  perimeter: [],
};
