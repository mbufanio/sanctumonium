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
import { HEX_SIZE, hexRing, type Hex } from "./hex.ts";
import { makeDrill, type ScheduleEntry } from "./realtime/schedule.ts";
import { cells, hexCluster, hexLine, type TerrainCell } from "./terrain.ts";
import type { ThreatTypeId } from "./boss/types.ts";

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

// ---- Act-1 coordination drills (the value-prop demo) ---------------------
// Two hand-authored scenarios, each played TWICE: once before Boss #1 (no
// coordination) and again after (coordinated). Identical spawns each time, so
// "same threats — the brain is the difference" is literally true. Drills are
// level-agnostic (the lesson is universal); per-site flavour lives in terrain,
// laydown and the endless arcade act.
//
// Each scenario is a CONCENTRATED push — a cluster of drones bearing in from one
// sector, so several sensors see the same targets. UNCOORDINATED, each sensor
// independently locks its own nearest few, so they REDUNDANTLY double-track the
// front of the cluster and their finite track capacity fills — the drones behind
// are dropped, untracked, and a shooter can't get a solution on them, so more
// leak. COORDINATED, the network fuses one shared picture: capacity is pooled and
// deduped, so far more of the cluster is held and engaged, and fewer get through.
// Same six devices — the fused net just drops fewer tracks. (Real mechanics; the
// difference is honest, not scripted.)
const DRILL_RADIUS = 1.8 * HEX_SIZE * Math.sqrt(3); // inside the sensor-overlap zone

/** A concentrated cluster of `n` RF quads bearing in across `arc` degrees. */
function concentratedBurst(n: number, arc = 120): Array<[number, ThreatTypeId, number]> {
  const out: Array<[number, ThreatTypeId, number]> = [];
  for (let i = 0; i < n; i++) {
    const bearing = Math.round(((-arc / 2 + (arc / Math.max(1, n - 1)) * i) + 360) % 360);
    out.push([0.5 + i * 0.12, "rf-quad", bearing]);
  }
  return out;
}

const DRILL_A = concentratedBurst(8); // the intro push
const DRILL_B = concentratedBurst(10); // the bigger one

function act1DrillSchedule(): ScheduleEntry[] {
  return [
    { type: "wave", wave: makeDrill(1, "DRILL 1 · NO COORDINATION", DRILL_A, DRILL_RADIUS) },
    { type: "wave", wave: makeDrill(2, "DRILL 2 · NO COORDINATION", DRILL_B, DRILL_RADIUS) },
    BOSS_1,
    { type: "wave", wave: makeDrill(3, "DRILL 3 · COORDINATED", DRILL_A, DRILL_RADIUS) },
    { type: "wave", wave: makeDrill(4, "DRILL 4 · COORDINATED", DRILL_B, DRILL_RADIUS) },
    BOSS_2,
  ];
}

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
  // Act 1 is the scripted coordination demo — identical drills at every site
  // (the lesson is universal). Per-site character lives in terrain/laydown and
  // the endless arcade act after Boss #2.
  schedule: act1DrillSchedule(),
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
  schedule: act1DrillSchedule(),
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
  schedule: act1DrillSchedule(),
};

/** Level 4 — Stadium. Dense, crowd-protection; the SWARM wrinkle (arcade act). */
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
  schedule: act1DrillSchedule(),
};

// Energy leads: flat open ground is the cleanest place to learn placement, so
// it's the booth's opener (terrain complexity ramps up across the other sites).
export const LEVELS: LevelDef[] = [ENERGY, MILITARY, AIRPORT, STADIUM];

export function getLevel(id: string): LevelDef {
  return LEVELS.find((l) => l.id === id) ?? ENERGY;
}

/** The default / starter level (flat, clean — the booth's opener). */
export const LEVEL_1 = ENERGY;

/** One placement in the fixed Act-1 laydown. */
export interface LaydownItem {
  placeableId: string;
  hex: Hex;
}

/**
 * The FIXED Act-1 laydown (the scripted-demo redesign). Act 1 proves the brain,
 * not the budget, so the gear is the SAME from wave 1 through Boss #2 — only
 * coordination changes. A deliberately rich grid: several radars (for track
 * FUSION and hand-off between them), an RF-DF (the only thing that classifies a
 * non-emitting drone), and a ring of net-drones + jammers (whose magazines and
 * reloads coordination staggers). Spread 360° on overlapping rings. The
 * controller filters any hex blocked by a site's terrain.
 */
export function act1Laydown(level: LevelDef): LaydownItem[] {
  const sensorRing = hexRing(3); // 18 cells
  const effRing = hexRing(2); // 12 cells
  const out: LaydownItem[] = [];
  // A deliberately SMALL, legible grid (6 devices) so the coordination drills
  // read clearly: two radars whose coverage overlaps (they can end up tracking
  // the SAME drone) plus an RF-DF; two net-drones that can both reach a central
  // target (they can DOGPILE) plus a jammer. Placement order interleaves sensors
  // and effectors so the guided deploy teaches "eyes then shooters".
  const sensors: Array<[number, string]> = [[0, "radar"], [6, "radar"], [12, "rf-df"]];
  for (const [idx, id] of sensors) out.push({ placeableId: id, hex: sensorRing[idx % sensorRing.length] });
  const effectors: Array<[number, string]> = [[0, "net-drone"], [4, "net-drone"], [8, "rf-jammer"]];
  for (const [idx, id] of effectors) {
    if (level.restrictedPlaceables.includes(id)) continue;
    out.push({ placeableId: id, hex: effRing[idx % effRing.length] });
  }
  return out;
}
