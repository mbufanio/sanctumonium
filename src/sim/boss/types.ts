/**
 * Boss assignment minigame — domain types (spec §6).
 *
 * The lesson lives here: for each incoming threat the player assigns WHICH
 * SENSOR tracks it and WHICH EFFECTOR engages it. Hit odds depend on three
 * *legible* factors — effector-vs-threat-type matchup, whether it is tracked,
 * and range — so the brain's optimal pick reads as insight, never magic.
 *
 * Pure data/logic. No rendering, no Pixi.
 */

/** Kind of incoming drone. The matchups below teach the player the matrix. */
export type ThreatTypeId = "rf-quad" | "autonomy" | "low-observable";

/** Sensor categories the player can assign to track a threat. */
export type SensorTypeId = "radar" | "rf-df";

/** Effector categories the player can assign to engage a threat. */
export type EffectorTypeId = "net-drone" | "rf-jammer";

export interface ThreatType {
  id: ThreatTypeId;
  name: string;
  /** Short uppercase tag shown on the scope (e.g. "RF", "AUTO", "STEALTH"). */
  code: string;
  /** One-line "why it's tricky" shown to the player so matchups are learnable. */
  blurb: string;
  icon: string;
}

export interface SensorType {
  id: SensorTypeId;
  name: string;
  /** Short uppercase tag shown on the scope (e.g. "RADAR", "RF-DF"). */
  code: string;
  icon: string;
  /** One-line role, e.g. "Detects & tracks most drones". */
  role: string;
  /** Max effective tracking range in abstract km. */
  range: number;
  /** Tracking quality [0..1] per threat type (0 = cannot track at all). */
  track: Record<ThreatTypeId, number>;
}

export interface EffectorType {
  id: EffectorTypeId;
  name: string;
  /** Short uppercase tag shown on the scope (e.g. "NET", "JAMMER"). */
  code: string;
  icon: string;
  /** One-line role, e.g. "Captures drones with a net". */
  role: string;
  /** Max effective engagement range in abstract km. */
  range: number;
  /** Base single-shot effectiveness [0..1] per threat type when well tracked. */
  effect: Record<ThreatTypeId, number>;
}

/** A concrete sensor/effector unit available in this encounter. */
export interface DeviceUnit {
  id: string;
  typeId: SensorTypeId | EffectorTypeId;
  /** Display position around the asset (bearing in degrees, 0 = north). */
  bearing: number;
}

/** A concrete incoming threat in this encounter. */
export interface ThreatUnit {
  id: string;
  typeId: ThreatTypeId;
  label: string;
  /** Distance from the protected asset, abstract km. */
  distance: number;
  /** Approach bearing in degrees (0 = north), for placement around the asset. */
  bearing: number;
}

/** Player's (or brain's) choice for a single threat. */
export interface Assignment {
  sensorId: string | null;
  effectorId: string | null;
}

/** Map of threatId → assignment. */
export type AssignmentMap = Record<string, Assignment>;

/** A reason string contributing to a probability, for the legible breakdown. */
export interface OddsFactor {
  label: string;
  /** Multiplier applied (1 = neutral). */
  mult: number;
}

/** Fully-explained hit probability for one threat's current assignment. */
export interface Odds {
  threatId: string;
  /** Final hit probability [0..1]. */
  p: number;
  factors: OddsFactor[];
  /** Human-readable warnings (untracked, ineffective matchup, unengaged). */
  warnings: string[];
  /** True if no effector is engaging this threat at all (a coverage seam). */
  unengaged: boolean;
}

export interface BossConfig {
  id: string;
  title: string;
  /** Number of leaks (missed threats) the asset can absorb and still "win". */
  leakTolerance: number;
  /** If false, a losing roll is floored to a narrow win (spec §6.1/§13). */
  allowLoss: boolean;
  threats: ThreatUnit[];
  sensors: DeviceUnit[];
  effectors: DeviceUnit[];
}

/** Outcome for a single threat after resolution. */
export interface ThreatResult {
  threatId: string;
  p: number;
  stopped: boolean;
}

export interface EncounterResult {
  results: ThreatResult[];
  stopped: number;
  leaked: number;
  /** True if leaked <= leakTolerance (or floored by allowLoss=false). */
  won: boolean;
  /** True when a losing roll was rescued by allowLoss=false (narrow win). */
  rescued: boolean;
}
