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
// Each raid is a concentrated push down the NORTHERN CORRIDOR — the sector the
// whole laydown overlaps on (see act1Laydown: nets pulled in to a shared core,
// jammer over the top, sensors bracketing the approach). Because every effector
// genuinely covers the same airspace, the coordination contrast is HONEST — the
// engine runs with NO scripted accuracy penalty. What differs between passes is
// only how the shared airspace is used:
//   • Uncoordinated ("systems alone"), every effector picks its own target —
//     whatever's nearest ITSELF — so the two nets bid on the same lead contacts
//     (verified dog-piles), the jammer burns shots on things it can't kill, the
//     saturated single-sensor picture drops the trailers, and the leaders that
//     slip past the crowd are passed over. That's where the leaks come from.
//   • Coordinated ("one system"), capacity is pooled (the trailers stay held),
//     fire is deconflicted (no two effectors on one contact), and assignments
//     are matched (nets for what the jammer can't touch). Same push: clean sweep.
// The raid SHAPE tells the story too: a loud RF screen up front, autonomy
// mid-stream, and low-observables trailing quietly behind the noise — the
// classic decoy-screen profile.
const DRILL_RADIUS = 4 * HEX_SIZE * Math.sqrt(3); // real approach room to engage across

// Intro raid (8): RF screen, one autonomy mid-stream, two stealth trailers.
// Uncoordinated leaks the trailers (~1-2); coordinated sweeps (verified 0).
const DRILL_A: Array<[number, ThreatTypeId, number]> = [
  [0.5, "rf-quad", 345], [0.62, "rf-quad", 15], [0.74, "rf-quad", 0],
  [0.86, "autonomy", 355], [0.98, "rf-quad", 25], [1.1, "rf-quad", 335],
  [1.25, "low-observable", 5], [1.4, "low-observable", 350],
];
// The heavier raid (10): denser screen, two autonomy, stealth pair trailing.
// Uncoordinated leaks ~2-3 across the failure modes; coordinated sweeps.
const DRILL_B: Array<[number, ThreatTypeId, number]> = [
  [0.5, "rf-quad", 340], [0.6, "rf-quad", 5], [0.7, "rf-quad", 20],
  [0.8, "autonomy", 350], [0.9, "rf-quad", 10], [1.0, "autonomy", 330],
  [1.15, "rf-quad", 0], [1.3, "low-observable", 15], [1.45, "low-observable", 355],
  [1.6, "rf-quad", 345],
];

// Act-1 fiction (the coherent version of the industry's real problem): the site
// fields six units from six vendors and NOTHING IS WIRED TOGETHER — classic
// stovepiped C-UAS. The enemy probes that seam with two raids (leaks), hits with
// a coordinated strike (barely held, manual), the coordination layer is patched
// in, and the SAME raid profiles come back and get swept. The wave labels carry
// the story: same raids, the only change is whether the grid is one system.
function act1DrillSchedule(): ScheduleEntry[] {
  return [
    { type: "wave", wave: makeDrill(1, "RAID 1 · SYSTEMS ALONE", DRILL_A, DRILL_RADIUS) },
    { type: "wave", wave: makeDrill(2, "RAID 2 · SYSTEMS ALONE", DRILL_B, DRILL_RADIUS) },
    BOSS_1,
    { type: "wave", wave: makeDrill(3, "RAID 3 · ONE SYSTEM", DRILL_A, DRILL_RADIUS) },
    { type: "wave", wave: makeDrill(4, "RAID 4 · ONE SYSTEM", DRILL_B, DRILL_RADIUS) },
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
  // Mixed terrain: a couple of structures (blockers) and a fire-inhibit zone —
  // placed clear of the fixed Act-1 laydown hexes (northern corridor).
  terrain: [
    ...cells(hexCluster({ q: -3, r: 3 }, 1), "blocker"),
    ...cells(hexCluster({ q: 5, r: -1 }, 1), "blocker"),
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
  // Two parallel runways south of the tower — no-fire zones you can't engage
  // across, kept clear of the fixed Act-1 laydown (northern corridor).
  terrain: [
    ...cells(hexLine({ q: -8, r: 6 }, { q: 8, r: -2 }), "nofire"),
    ...cells(hexLine({ q: -8, r: 10 }, { q: 8, r: 2 }), "nofire"),
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
 * coordination changes. Two radars (track FUSION and hand-off), an RF-DF (the
 * only thing that hears a non-emitting drone is nothing — its blind spot IS the
 * lesson), two net-drones and a jammer whose coverages genuinely overlap on the
 * northern corridor. The controller filters any hex blocked by a site's terrain.
 */
export function act1Laydown(level: LevelDef): LaydownItem[] {
  const coreRing = hexRing(1); // 6 cells, radius ~66 — the interceptor core
  const midRing = hexRing(2); // 12 cells, radius ~132
  const sensorRing = hexRing(3); // 18 cells, radius ~198 — the sensor picket
  const out: LaydownItem[] = [];
  // A deliberately SMALL, legible grid (6 devices) laid out as DEFENSE IN DEPTH
  // around the northern corridor, so the effectors' coverage genuinely OVERLAPS:
  //   • sensors out wide bracketing the approach — radar NW (~300°), radar NE
  //     (~60°), the passive RF-DF dead north (0°);
  //   • both net-drones pulled IN to the core ring (~66 out) where each covers
  //     the centre AND the other's zone — in shared airspace they can genuinely
  //     bid on the same contact (the honest dog-pile) or split the work;
  //   • the jammer on the mid ring due north, its long reach blanketing the
  //     whole corridor over the top of both nets.
  // Every drill pushes into that shared zone, so the coordination contrast is
  // real geometry, not scripting. Placement order stays sensors-then-effectors
  // (the guided deploy teaches "eyes then shooters").
  const sensors: Array<[number, string]> = [[15, "radar"], [9, "radar"], [12, "rf-df"]];
  for (const [idx, id] of sensors) out.push({ placeableId: id, hex: sensorRing[idx % sensorRing.length] });
  out.push({ placeableId: "net-drone", hex: coreRing[5] }); // ~300°
  out.push({ placeableId: "net-drone", hex: coreRing[3] }); // ~60°
  if (!level.restrictedPlaceables.includes("rf-jammer")) {
    out.push({ placeableId: "rf-jammer", hex: midRing[8] }); // 0°
  }
  return out;
}
