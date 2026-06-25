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
  /** True while at least one capable, in-range sensor is tracking it. */
  tracked: boolean;
  /** Visual scale (1 = normal; smaller for swarm drones). */
  size: number;
}

/** Transient visual events produced by a sim step (consumed by the renderer). */
export type Fx =
  | { kind: "shot"; from: Px; to: Px; effector: string; hit: boolean }
  | { kind: "kill"; at: Px }
  | { kind: "leak"; at: Px; damage: number }
  // Brain coordination: a sensor handing a track to the effector engaging it.
  | { kind: "handoff"; from: Px; to: Px }
  // Area effector blast (HPM / plasma / beam): a ring expanding at `at`.
  | { kind: "aoe"; at: Px; radius: number; effector: string };

/**
 * Per-spawn stat modifiers — how a level expresses its threat "wrinkle" without
 * inventing new threat types (a swarm is just fast/cheap/small RF quads, etc.).
 */
export interface SpawnMods {
  speedMul?: number;
  bountyMul?: number;
  leakMul?: number;
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
}

export function createRealtimeState(): RealtimeState {
  return { time: 0, drones: [], nextDroneId: 1, spawnCursor: 0, fx: [], killed: 0, leaked: 0 };
}
