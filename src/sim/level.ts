/**
 * Sites / levels (spec §9). Levels are DATA over one engine, so new sites are
 * cheap: a hex field, a centred asset, a starting budget, a per-level wave
 * schedule, and a "wrinkle" that teaches a different reason coordination
 * matters. Each level keeps its own leaderboard (board filters by id).
 *
 * Wrinkles are expressed through the threat MIX and small per-spawn modifiers
 * (a swarm is fast/cheap/small RF quads; jammer-immune pressure is autonomy-
 * heavy) plus a couple of level flags — no new threat types required.
 */
import type { Hex } from "./hex.ts";
import { makeWave, type ScheduleEntry } from "./realtime/schedule.ts";
import { cells, hexCluster, hexLine, type TerrainCell } from "./terrain.ts";

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
  /** One-line scenario framing for the level-select screen. */
  blurb: string;
  /** The teaching wrinkle, shown to the player (spec §9). */
  wrinkle: string;
  /** One line of operational stakes in the operator's voice (ACT1 spec §2) —
   *  why this asset matters, so a leak feels like a loss, not a number. */
  stakes: string;
  /** Number of hex rings from the centre to the field edge. */
  rings: number;
  asset: AssetDef;
  /** Starting currency (spec §8 — start poor). */
  startBudget: number;
  /** Starting asset integrity (energy facilities are more fragile). */
  integrity: number;
  /** Spec §9 airport wrinkle: a leak also costs score (operations disrupted). */
  leakScorePenalty: number;
  /** Structures (blockers) and no-fire zones that obstruct line-of-sight. */
  terrain: TerrainCell[];
  /** Placeable ids not buildable here (e.g. urban → no line-of-sight laser). */
  restrictedPlaceables: string[];
  /** This site's run schedule (normal waves + the two boss fights). */
  schedule: ScheduleEntry[];
}

const BOSS_1: ScheduleEntry = { type: "boss", bossIndex: 1 };
const BOSS_2: ScheduleEntry = { type: "boss", bossIndex: 2 };

/** Level 1 — Military facility (the lead; balanced teacher). */
const MILITARY: LevelDef = {
  id: "mil-facility",
  name: "Forward Operating Base",
  blurb: "Clear perimeter, obvious approach corridors. The clean teacher.",
  wrinkle: "Balanced threats — learn the matchups and that geometry beats spend.",
  stakes: "Command post for the whole sector. It goes dark, the sector goes blind.",
  rings: 9,
  asset: { id: "command", name: "Command Post", pos: { q: 0, r: 0 }, radius: 1 },
  startBudget: 120,
  integrity: 100,
  leakScorePenalty: 0,
  // Mixed terrain: a couple of structures (blockers) and a fire-inhibit zone.
  terrain: [
    ...cells(hexCluster({ q: -3, r: 3 }, 1), "blocker"),
    ...cells(hexCluster({ q: 4, r: -3 }, 1), "blocker"),
    ...cells(hexLine({ q: -5, r: -1 }, { q: -2, r: -3 }), "nofire"),
  ],
  restrictedPlaceables: [],
  schedule: [
    { type: "wave", wave: makeWave(1, [{ typeId: "rf-quad", count: 4 }], 60) },
    { type: "wave", wave: makeWave(2, [{ typeId: "rf-quad", count: 6 }], 75) },
    BOSS_1,
    { type: "wave", wave: makeWave(3, [{ typeId: "rf-quad", count: 5 }, { typeId: "low-observable", count: 2 }], 90) },
    { type: "wave", wave: makeWave(4, [{ typeId: "rf-quad", count: 6 }, { typeId: "autonomy", count: 2 }], 105) },
    { type: "wave", wave: makeWave(5, [{ typeId: "rf-quad", count: 6 }, { typeId: "autonomy", count: 3 }, { typeId: "low-observable", count: 2 }], 120) },
    BOSS_2,
    { type: "wave", wave: makeWave(6, [{ typeId: "rf-quad", count: 8 }, { typeId: "autonomy", count: 3 }, { typeId: "low-observable", count: 3 }], 140) },
    { type: "wave", wave: makeWave(7, [{ typeId: "rf-quad", count: 9 }, { typeId: "autonomy", count: 4 }, { typeId: "low-observable", count: 4 }], 160) },
    { type: "wave", wave: makeWave(8, [{ typeId: "rf-quad", count: 13 }, { typeId: "autonomy", count: 6 }, { typeId: "low-observable", count: 6 }], 220) },
    { type: "wave", wave: makeWave(9, [{ typeId: "rf-quad", count: 22 }, { typeId: "autonomy", count: 12 }, { typeId: "low-observable", count: 10 }], 320, "FINAL WAVE") },
  ],
};

/** Level 2 — Airport. Operational-shutdown angle: every leak disrupts ops. */
const AIRPORT: LevelDef = {
  id: "airport",
  name: "International Airport",
  blurb: "Live airfield. A single intrusion shuts down operations — leaks cost you.",
  wrinkle: "Every leak also tanks your score — operations can't tolerate intrusions.",
  stakes: "Forty thousand people moving through this airspace. Nothing gets near the runways.",
  rings: 10,
  asset: { id: "tower", name: "Control Tower", pos: { q: 0, r: 0 }, radius: 1 },
  startBudget: 140,
  integrity: 100,
  leakScorePenalty: 140,
  // Two runways crossing the field — no-fire zones you can't engage across.
  terrain: [
    ...cells(hexLine({ q: -8, r: 6 }, { q: 8, r: -2 }), "nofire"),
    ...cells(hexLine({ q: -8, r: 2 }, { q: 8, r: -6 }), "nofire"),
  ],
  restrictedPlaceables: [],
  schedule: [
    { type: "wave", wave: makeWave(1, [{ typeId: "rf-quad", count: 5 }], 70) },
    { type: "wave", wave: makeWave(2, [{ typeId: "rf-quad", count: 5 }, { typeId: "low-observable", count: 2 }], 90) },
    BOSS_1,
    { type: "wave", wave: makeWave(3, [{ typeId: "rf-quad", count: 6 }, { typeId: "low-observable", count: 3 }], 105) },
    { type: "wave", wave: makeWave(4, [{ typeId: "rf-quad", count: 6 }, { typeId: "autonomy", count: 3 }, { typeId: "low-observable", count: 2 }], 120) },
    { type: "wave", wave: makeWave(5, [{ typeId: "rf-quad", count: 7 }, { typeId: "autonomy", count: 3 }, { typeId: "low-observable", count: 3 }], 140) },
    BOSS_2,
    { type: "wave", wave: makeWave(6, [{ typeId: "rf-quad", count: 9 }, { typeId: "autonomy", count: 4 }, { typeId: "low-observable", count: 4 }], 160) },
    { type: "wave", wave: makeWave(7, [{ typeId: "rf-quad", count: 11 }, { typeId: "autonomy", count: 5 }, { typeId: "low-observable", count: 5 }], 200) },
    { type: "wave", wave: makeWave(8, [{ typeId: "rf-quad", count: 16 }, { typeId: "autonomy", count: 8 }, { typeId: "low-observable", count: 8 }], 280, "FINAL WAVE") },
  ],
};

/** Level 3 — Energy facility. High-value, fragile asset; jammer-immune pressure. */
const ENERGY: LevelDef = {
  id: "energy",
  name: "Power Substation",
  blurb: "A fragile high-value asset. Autonomy & fiber-controlled drones shrug off jammers.",
  wrinkle: "Jammer-immune drones dominate — you can't jam your way out; track and kill.",
  stakes: "That substation feeds three counties. We do not let anything through.",
  rings: 8,
  asset: { id: "core", name: "Transformer Yard", pos: { q: 0, r: 0 }, radius: 1 },
  startBudget: 150,
  integrity: 90, // a touch fragile, but it's the approachable opener
  leakScorePenalty: 0,
  // Flat, open ground — the cleanest site, and the booth's opener.
  terrain: [],
  restrictedPlaceables: [],
  schedule: [
    { type: "wave", wave: makeWave(1, [{ typeId: "rf-quad", count: 4 }], 70) },
    { type: "wave", wave: makeWave(2, [{ typeId: "rf-quad", count: 4 }, { typeId: "autonomy", count: 2 }], 90) },
    BOSS_1,
    { type: "wave", wave: makeWave(3, [{ typeId: "autonomy", count: 5 }, { typeId: "low-observable", count: 2 }], 110) },
    { type: "wave", wave: makeWave(4, [{ typeId: "autonomy", count: 6 }, { typeId: "rf-quad", count: 3 }], 130) },
    { type: "wave", wave: makeWave(5, [{ typeId: "autonomy", count: 7 }, { typeId: "low-observable", count: 3 }], 150) },
    BOSS_2,
    { type: "wave", wave: makeWave(6, [{ typeId: "autonomy", count: 8 }, { typeId: "low-observable", count: 3 }, { typeId: "rf-quad", count: 4 }], 180) },
    { type: "wave", wave: makeWave(7, [{ typeId: "autonomy", count: 10 }, { typeId: "low-observable", count: 5 }, { typeId: "rf-quad", count: 5 }], 220) },
    { type: "wave", wave: makeWave(8, [{ typeId: "autonomy", count: 12 }, { typeId: "low-observable", count: 5 }, { typeId: "rf-quad", count: 7 }], 320, "FINAL WAVE") },
  ],
};

/** Swarm modifier — fast, cheap, small commercial drones in big numbers. */
const SWARM = { speedMul: 1.5, bountyMul: 0.45, leakMul: 0.55, size: 0.6 } as const;

/** Level 4 — Stadium. Dense, crowd-protection; the SWARM wrinkle. */
const STADIUM: LevelDef = {
  id: "stadium",
  name: "Stadium · Event Day",
  blurb: "Packed venue. Cheap drone swarms flood the airspace — area weapons shine.",
  wrinkle: "Swarms: dozens of fast, cheap drones at once. Single-shot can't keep up.",
  stakes: "Sixty thousand in the stands. A swarm over that crowd is not an option.",
  rings: 10,
  asset: { id: "field", name: "Center Field", pos: { q: 0, r: 0 }, radius: 1 },
  startBudget: 160,
  integrity: 100,
  leakScorePenalty: 0,
  // Dense urban venue: buildings block line-of-sight; the laser is impractical.
  terrain: [
    ...cells(hexCluster({ q: -4, r: -2 }, 1), "blocker"),
    ...cells(hexCluster({ q: 4, r: 1 }, 1), "blocker"),
    ...cells(hexCluster({ q: -2, r: 5 }, 1), "blocker"),
    ...cells(hexCluster({ q: 5, r: -5 }, 1), "blocker"),
    ...cells(hexCluster({ q: -6, r: 2 }, 1), "blocker"),
  ],
  restrictedPlaceables: ["laser"],
  schedule: [
    { type: "wave", wave: makeWave(1, [{ typeId: "rf-quad", count: 8, mods: SWARM }], 70) },
    { type: "wave", wave: makeWave(2, [{ typeId: "rf-quad", count: 12, mods: SWARM }], 95) },
    BOSS_1,
    { type: "wave", wave: makeWave(3, [{ typeId: "rf-quad", count: 14, mods: SWARM }, { typeId: "low-observable", count: 2 }], 115) },
    { type: "wave", wave: makeWave(4, [{ typeId: "rf-quad", count: 16, mods: SWARM }, { typeId: "autonomy", count: 2 }], 135) },
    { type: "wave", wave: makeWave(5, [{ typeId: "rf-quad", count: 20, mods: SWARM }, { typeId: "autonomy", count: 3 }], 160) },
    BOSS_2,
    { type: "wave", wave: makeWave(6, [{ typeId: "rf-quad", count: 26, mods: SWARM }, { typeId: "autonomy", count: 4 }], 190) },
    { type: "wave", wave: makeWave(7, [{ typeId: "rf-quad", count: 34, mods: SWARM }, { typeId: "autonomy", count: 6 }], 230) },
    { type: "wave", wave: makeWave(8, [{ typeId: "rf-quad", count: 50, mods: SWARM }, { typeId: "autonomy", count: 10 }, { typeId: "low-observable", count: 6 }], 340, "FINAL WAVE") },
  ],
};

// Energy leads: flat open ground is the cleanest place to learn placement, so
// it's the booth's opener (terrain complexity ramps up across the other sites).
export const LEVELS: LevelDef[] = [ENERGY, MILITARY, AIRPORT, STADIUM];

export function getLevel(id: string): LevelDef {
  return LEVELS.find((l) => l.id === id) ?? ENERGY;
}

/** The default / starter level (flat, clean — the booth's opener). */
export const LEVEL_1 = ENERGY;
