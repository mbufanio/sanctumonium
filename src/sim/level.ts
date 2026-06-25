/**
 * Level / site definitions (spec §9). Levels are DATA over one engine so new
 * sites are cheap. Phase 0/1 ships Level 1 — the military facility — as the
 * lead. Revised architecture: the defended asset sits at the CENTER of a
 * hexagonal field and play happens 360° around it.
 */
import type { Hex } from "./hex.ts";

export interface AssetDef {
  id: string;
  name: string;
  /** The protected asset is always centred at the origin. */
  pos: Hex;
  /** Footprint radius in rings, for the protected-asset ring. */
  radius: number;
}

export interface LevelDef {
  id: string;
  name: string;
  /** Number of hex rings from the centre to the field edge. */
  rings: number;
  /** The single centred asset to defend (spec: asset in the middle, 360°). */
  asset: AssetDef;
}

/** Level 1 — Military facility (BUILD FIRST, the lead — spec §9). */
export const LEVEL_1: LevelDef = {
  id: "mil-facility",
  name: "Forward Operating Base",
  rings: 9,
  asset: { id: "command", name: "Command Post", pos: { q: 0, r: 0 }, radius: 1 },
};
