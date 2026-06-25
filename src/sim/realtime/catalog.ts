/**
 * Real-time catalog (spec §5, §7-tier-1, §8) — what the player can place, and
 * what attacks them. Stats are SHARED with the boss minigame (same radar,
 * RF-DF, net-drone, jammer, and the same threat matchups) so the lesson is one
 * coherent world: a jammer that's useless on an autonomy drone in the boss
 * fight is equally useless on it in a live wave.
 *
 * Pure data. No rendering.
 */
import {
  EFFECTOR_TYPES,
  SENSOR_TYPES,
  THREAT_TYPES,
} from "../boss/data.ts";
import type {
  EffectorTypeId,
  SensorTypeId,
  ThreatTypeId,
} from "../boss/types.ts";

/** Plane-units per abstract "km" of device range (tunes coverage on the field). */
export const RANGE_SCALE = 52;

/** Distance (plane units) from centre at which a drone is considered to have
 *  leaked into the protected asset. */
export const LEAK_RADIUS = 30;

export type DeviceKind = "sensor" | "effector";

export interface Placeable {
  id: string;
  kind: DeviceKind;
  /** The shared sensor/effector type id this placeable instantiates. */
  typeId: SensorTypeId | EffectorTypeId;
  name: string;
  code: string;
  role: string;
  cost: number;
  /** Effective radius in plane units (derived from the shared km range). */
  radius: number;
  /** Effectors only: seconds between shots. */
  cooldown: number;
}

function sensorPlaceable(typeId: SensorTypeId, cost: number): Placeable {
  const t = SENSOR_TYPES[typeId];
  return {
    id: typeId,
    kind: "sensor",
    typeId,
    name: t.name,
    code: t.code,
    role: t.role,
    cost,
    radius: t.range * RANGE_SCALE,
    cooldown: 0,
  };
}

function effectorPlaceable(typeId: EffectorTypeId, cost: number, cooldown: number): Placeable {
  const t = EFFECTOR_TYPES[typeId];
  return {
    id: typeId,
    kind: "effector",
    typeId,
    name: t.name,
    code: t.code,
    role: t.role,
    cost,
    radius: t.range * RANGE_SCALE,
    cooldown,
  };
}

/** Tier-1 placeable palette (spec §7 — grounded, recognizable gear). */
export const PLACEABLES: Placeable[] = [
  sensorPlaceable("radar", 60),
  sensorPlaceable("rf-df", 50),
  effectorPlaceable("net-drone", 80, 1.6),
  effectorPlaceable("rf-jammer", 90, 1.1),
];

export function placeableById(id: string): Placeable | undefined {
  return PLACEABLES.find((p) => p.id === id);
}

/** Per-threat-type real-time attributes layered over the shared matchup data. */
export interface DroneSpec {
  typeId: ThreatTypeId;
  name: string;
  /** Plane units per second toward the centre. */
  speed: number;
  /** Shots required (most are one-hit; tougher drones take more). */
  hp: number;
  /** Currency awarded on kill. */
  bounty: number;
  /** Integrity damage if it reaches the asset. */
  leakDamage: number;
}

// Speeds are scaled to the larger field so wave pacing stays brisk (~15s).
export const DRONE_SPECS: Record<ThreatTypeId, DroneSpec> = {
  "rf-quad": { typeId: "rf-quad", name: THREAT_TYPES["rf-quad"].name, speed: 42, hp: 1, bounty: 12, leakDamage: 10 },
  autonomy: { typeId: "autonomy", name: THREAT_TYPES.autonomy.name, speed: 48, hp: 1, bounty: 18, leakDamage: 14 },
  "low-observable": { typeId: "low-observable", name: THREAT_TYPES["low-observable"].name, speed: 36, hp: 1, bounty: 20, leakDamage: 12 },
};
