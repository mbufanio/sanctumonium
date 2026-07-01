/**
 * Real-time entity & state types (spec §5). The simulation runs in plane space
 * (unsquashed); the renderer applies the iso squash. Pure data.
 */
import type { Hex, Px } from "../hex.ts";
import type { ThreatTypeId } from "../boss/types.ts";
import type { DeviceKind } from "./catalog.ts";

/**
 * A device the player has placed on the hex field. It carries its OWN combat
 * stats (so upgrades and tier-2/3 gear work without the boss tables): radius,
 * fire interval, AOE, and the effect/track matrices, plus its upgrade level.
 */
export interface PlacedDevice {
  id: string;
  kind: DeviceKind;
  placeableId: string;
  hex: Hex;
  pos: Px;
  /** Upgrade level (0 = base; each step in the placeable's upgrade path is +1). */
  level: number;
  radius: number;
  /** Effectors: seconds between shots. */
  fireInterval: number;
  /** Effectors: magazine depth (shots before reload); 0 = unlimited. */
  magazine: number;
  /** Effectors: seconds to reload an empty magazine. */
  reloadTime: number;
  /** Effectors: shots left in the current magazine. */
  ammo: number;
  /** Effectors: seconds remaining in a reload (0 = ready / not reloading). */
  reloadCd: number;
  /** Effectors: area-of-effect radius in plane units (0 = single target). */
  aoe: number;
  /** Effectors: effectiveness per threat type. */
  effect: Record<ThreatTypeId, number>;
  /** Sensors: tracking quality per threat type. */
  track: Record<ThreatTypeId, number>;
  /** Effectors: remaining seconds until the next shot may fire. */
  cooldown: number;
}

export type DroneState = "alive" | "killed" | "leaked";

/** A live drone attacking the asset. */
export interface Drone {
  id: number;
  typeId: ThreatTypeId;
  pos: Px;
  speed: number;
  hp: number;
  bounty: number;
  leakDamage: number;
  state: DroneState;
  // ---- kill chain (spec: detect → classify/ID → track → engage) ----------
  /** A sensor has a return on it (a blip), even if it can't classify it. */
  detected: boolean;
  /** Sim time of first detection (-1 until detected) — for time-to-track stats. */
  detectedAt: number;
  /** Classification confidence [0..1]; rises while a CAPABLE sensor covers it. */
  idConf: number;
  /** Fire-control track: detected AND classified past threshold. The thing an
   *  effector needs for a clean shot. */
  tracked: boolean;
  /** Stable per-drone track number for the telemetry readout (e.g. 0147). */
  trackId: number;
  /** Device ids of the sensors ASSIGNED to track it this step (drill mode uses
   *  finite track capacity, so this can be empty — a seam — or doubled-up — a
   *  waste). Drives the coordination-failure callouts. */
  trackerIds: string[];
  /** Visual scale (1 = normal; smaller for swarm drones). */
  size: number;
}

/** Transient visual events produced by a sim step (consumed by the renderer). */
export type Fx =
  | { kind: "shot"; from: Px; to: Px; effector: string; hit: boolean }
  | { kind: "kill"; at: Px; bounty: number }
  | { kind: "leak"; at: Px; damage: number }
  // Brain coordination: a sensor handing a track to the effector engaging it.
  | { kind: "handoff"; from: Px; to: Px }
  // Area effector blast (HPM / plasma / beam): a ring expanding at `at`.
  | { kind: "aoe"; at: Px; radius: number; effector: string }
  // ---- drill callouts (Act-1 coordination-failure demo) ------------------
  // Two+ effectors piled onto the same drone in a step (wasted, uncoordinated).
  | { kind: "dogpile"; at: Px }
  // An UNTRACKED drone reached the asset — the seam nobody was watching.
  | { kind: "seam"; at: Px };

/**
 * Per-spawn stat modifiers — how a level expresses its threat "wrinkle" without
 * inventing new threat types (a swarm is just fast/cheap/small RF quads, etc.).
 */
export interface SpawnMods {
  speedMul?: number;
  bountyMul?: number;
  leakMul?: number;
  /** Hit points multiplier (>1 = hardened drones that survive a single hit —
   *  the late-arcade escalation that defeats one-shot area weapons). */
  hpMul?: number;
  /** Visual scale (1 = normal; <1 for swarm micro-drones). */
  size?: number;
}

/** A queued spawn: emit a drone of `typeId` at sim time `at`, bearing `bearing`. */
export interface SpawnEntry {
  at: number;
  typeId: ThreatTypeId;
  bearing: number;
  mods?: SpawnMods;
}

export type WaveKind = "normal" | "boss";

export interface WaveDef {
  index: number;
  kind: WaveKind;
  label: string;
  /** normal waves: the spawn script. boss waves: empty (handled by the console). */
  spawns: SpawnEntry[];
  /** Currency granted when the wave is cleared. */
  stipend: number;
  /** Act-1 coordination drill: sensors run FINITE track capacity (so they can
   *  waste effort double-tracking), the field draws failure callouts, and the
   *  sim runs in slow-motion. Absent/false for normal + arcade waves. */
  drill?: boolean;
  /** Slow-motion factor for a drill (0.5 = half speed). 1 / undefined = normal. */
  timeScale?: number;
  /** Drill spawn radius override (plane units). Drills spawn drones just outside
   *  the ring-3 sensor line so they engage the small grid together, rather than
   *  from the far field edge. Absent = use the level's normal spawn radius. */
  spawnRadius?: number;
}

/** The live real-time simulation state for the current wave. */
export interface RealtimeState {
  /** Seconds elapsed in the current wave. */
  time: number;
  drones: Drone[];
  nextDroneId: number;
  /** Index into the active wave's spawn list. */
  spawnCursor: number;
  /** Pending visual events since the last render read. */
  fx: Fx[];
  /** Tallies for scoring/economy. */
  killed: number;
  leaked: number;
  /** Drill mode only: sticky sensor→drone locks. Uncoordinated sensors HOLD a
   *  target once acquired (so two can stay stuck on one drone while another
   *  slips in untracked); the coordinated manager reallocates every step. */
  sensorLocks: Record<string, number>;
}

export function createRealtimeState(): RealtimeState {
  return { time: 0, drones: [], nextDroneId: 1, spawnCursor: 0, fx: [], killed: 0, leaked: 0, sensorLocks: {} };
}
