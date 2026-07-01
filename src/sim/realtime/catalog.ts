/**
 * Real-time catalog (spec §5, §7, §8) — the tech gradient.
 *
 * Devices carry their OWN combat stats here (effect/track/aoe/range/cooldown),
 * so the real-time engine reads from the placed device, not the boss tables.
 * That decoupling is what lets the tier-2/3 gear and within-class upgrades
 * exist without touching the tier-1 boss-teaching data.
 *
 * The gradient (spec §7): Tier 1 grounded & real → Tier 2 near-future →
 * Tier 3 gloriously fictional. Fewer, more memorable devices per tier. The
 * scoring guardrail still rewards coordination at every tier (validated in the
 * balance harness).
 *
 * Pure data. No rendering.
 */
import { EFFECTOR_TYPES, SENSOR_TYPES } from "../boss/data.ts";
import type { ThreatTypeId } from "../boss/types.ts";

/** Plane-units per abstract "km" of device range (tunes coverage on the field). */
export const RANGE_SCALE = 52;

/** Distance (plane units) from centre at which a drone has leaked into the asset. */
export const LEAK_RADIUS = 30;

/**
 * Score multiplier for a kill made while the drone was sensor-tracked (spec §8
 * guardrail: coordinated, well-tracked defense must outscore brute force). An
 * untracked kill scores ×1.
 */
export const TRACKED_KILL_BONUS = 2.0;

export type DeviceKind = "sensor" | "effector";
export type Tier = 1 | 2 | 3;

export interface UpgradeStep {
  cost: number;
  label: string;
  rangeMul?: number;
  cooldownMul?: number;
  /** Added to every effect value (clamped below 1). */
  effectAdd?: number;
  /** Added to the AOE radius (plane units). */
  aoeAdd?: number;
  /** Added to specific track qualities (clamped to 1). */
  trackAdd?: Partial<Record<ThreatTypeId, number>>;
}

export interface Placeable {
  id: string;
  kind: DeviceKind;
  tier: Tier;
  name: string;
  code: string;
  role: string;
  cost: number;
  /** Effective radius in plane units (km × RANGE_SCALE). */
  radius: number;
  /** Effectors: seconds between shots (0 for sensors). */
  cooldown: number;
  /** Effectors: shots before a reload is required (magazine depth). */
  magazine?: number;
  /** Effectors: seconds to reload an empty magazine. */
  reloadTime?: number;
  /** Effectors: area-of-effect radius in plane units (0 = single target). */
  aoe: number;
  /** Effectors: base single-shot effectiveness per threat type when tracked. */
  effect?: Record<ThreatTypeId, number>;
  /** Sensors: tracking quality per threat type (0 = cannot track). */
  track?: Record<ThreatTypeId, number>;
  /** Sensors: how many simultaneous fire-control tracks it can hold. A saturated
   *  sensor drops the overflow; a fused (coordinated) network POOLS capacity and
   *  shares tracks, so nothing gets dropped — the core value of coordination. */
  trackCapacity?: number;
  /** Short within-class upgrade path (spec §7 — 2–4 steps). */
  upgrades: UpgradeStep[];
}

function km(n: number): number {
  return n * RANGE_SCALE;
}

// ---- Tier 1 — grounded / real (mirrors the boss-teaching gear) -----------

const RADAR: Placeable = {
  id: "radar",
  kind: "sensor",
  tier: 1,
  name: "Radar",
  code: "RADAR",
  role: "Detects & tracks drones by radar return.",
  cost: 60,
  radius: km(4.0),
  cooldown: 0,
  aoe: 0,
  track: { ...SENSOR_TYPES.radar.track },
  trackCapacity: 4,
  upgrades: [
    { cost: 70, label: "Extended Range", rangeMul: 1.3 },
    { cost: 110, label: "Multi-Track", trackAdd: { "low-observable": 0.35 }, rangeMul: 1.15 },
  ],
};

const RF_DF: Placeable = {
  id: "rf-df",
  kind: "sensor",
  tier: 1,
  name: "RF Direction-Finder",
  code: "RF-DF",
  role: "Locates drones by their radio emissions.",
  cost: 50,
  radius: km(3.2),
  cooldown: 0,
  aoe: 0,
  track: { ...SENSOR_TYPES["rf-df"].track },
  trackCapacity: 3,
  upgrades: [
    { cost: 60, label: "Extended Range", rangeMul: 1.3 },
    { cost: 100, label: "Wideband", trackAdd: { "low-observable": 0.08 }, rangeMul: 1.2 },
  ],
};

const NET_DRONE: Placeable = {
  id: "net-drone",
  kind: "effector",
  tier: 1,
  name: "Net-Drone",
  code: "NET",
  role: "Captures a drone with a launched net.",
  cost: 80,
  radius: km(2.2),
  cooldown: 1.6,
  magazine: 6,
  reloadTime: 2.4,
  aoe: 0,
  effect: { ...EFFECTOR_TYPES["net-drone"].effect },
  upgrades: [
    { cost: 70, label: "Rapid Reload", cooldownMul: 0.7 },
    { cost: 120, label: "Long-Line Net", rangeMul: 1.4, effectAdd: 0.05 },
  ],
};

const RF_JAMMER: Placeable = {
  id: "rf-jammer",
  kind: "effector",
  tier: 1,
  name: "RF Jammer",
  code: "JAMMER",
  role: "Severs a drone's radio control link.",
  cost: 90,
  radius: km(3.5),
  cooldown: 1.1,
  magazine: 10,
  reloadTime: 1.8,
  aoe: 0,
  effect: { ...EFFECTOR_TYPES["rf-jammer"].effect },
  upgrades: [
    { cost: 80, label: "Wider Beam", rangeMul: 1.3 },
    { cost: 130, label: "Protocol Break", effectAdd: 0.04, cooldownMul: 0.8 },
  ],
};

// ---- Tier 2 — near-future plausible --------------------------------------

const AESA: Placeable = {
  id: "aesa",
  kind: "sensor",
  tier: 2,
  name: "AESA Array",
  code: "AESA",
  role: "Phased-array radar — tracks everything, even the quiet ones.",
  cost: 150,
  trackCapacity: 12,
  radius: km(5.0),
  cooldown: 0,
  aoe: 0,
  track: { "rf-quad": 1.0, autonomy: 1.0, "low-observable": 0.9 },
  upgrades: [
    { cost: 120, label: "Long-Range Mode", rangeMul: 1.3 },
    { cost: 180, label: "Quantum Filter", trackAdd: { "low-observable": 0.1 } },
  ],
};

const HPM: Placeable = {
  id: "hpm",
  kind: "effector",
  tier: 2,
  name: "HPM Emitter",
  code: "HPM",
  role: "High-power microwave — fries a whole cluster's electronics at once.",
  cost: 170,
  radius: km(3.0),
  cooldown: 2.2,
  magazine: 3,
  reloadTime: 3.0,
  aoe: km(1.4),
  // Electronics-frying: works on autonomy drones too (unlike a jammer).
  effect: { "rf-quad": 0.8, autonomy: 0.78, "low-observable": 0.78 },
  upgrades: [
    { cost: 140, label: "Wider Cone", aoeAdd: km(0.6) },
    { cost: 200, label: "Faster Charge", cooldownMul: 0.7, effectAdd: 0.05 },
  ],
};

const LASER: Placeable = {
  id: "laser",
  kind: "effector",
  tier: 2,
  name: "Directed-Energy Laser",
  code: "LASER",
  role: "Precision beam — fast, long-ranged, deadly to a single target.",
  cost: 190,
  radius: km(4.6),
  cooldown: 0.7,
  magazine: 14,
  reloadTime: 1.3,
  aoe: 0,
  effect: { "rf-quad": 0.95, autonomy: 0.95, "low-observable": 0.95 },
  upgrades: [
    { cost: 150, label: "Beam Focus", cooldownMul: 0.7 },
    { cost: 220, label: "Adaptive Optics", rangeMul: 1.2, effectAdd: 0.03 },
  ],
};

// ---- Tier 3 — gloriously fictional (the reward) --------------------------

const PLASMA: Placeable = {
  id: "plasma",
  kind: "effector",
  tier: 3,
  name: "Plasma Cannon",
  code: "PLASMA",
  role: "Lobs a plasma burst that vaporizes everything in a wide radius.",
  cost: 340,
  radius: km(4.2),
  cooldown: 2.6,
  magazine: 2,
  reloadTime: 2.6,
  aoe: km(2.4),
  effect: { "rf-quad": 0.92, autonomy: 0.92, "low-observable": 0.9 },
  upgrades: [
    { cost: 260, label: "Containment Field", aoeAdd: km(0.9) },
    { cost: 360, label: "Overcharge", cooldownMul: 0.7, effectAdd: 0.05 },
  ],
};

const BEAM: Placeable = {
  id: "beam",
  kind: "effector",
  tier: 3,
  name: "Beam Array",
  code: "BEAM",
  role: "Rapid sweeping beams that blast swarms out of the sky.",
  cost: 320,
  radius: km(5.2),
  cooldown: 0.5,
  magazine: 24,
  reloadTime: 0.9,
  aoe: km(0.9),
  effect: { "rf-quad": 0.88, autonomy: 0.88, "low-observable": 0.88 },
  upgrades: [
    { cost: 250, label: "Cycle Boost", cooldownMul: 0.7 },
    { cost: 340, label: "Phase Lattice", aoeAdd: km(0.6), effectAdd: 0.04 },
  ],
};

export const PLACEABLES: Placeable[] = [RADAR, RF_DF, NET_DRONE, RF_JAMMER, AESA, HPM, LASER, PLASMA, BEAM];

export function placeableById(id: string): Placeable | undefined {
  return PLACEABLES.find((p) => p.id === id);
}

export function placeablesForTier(maxTier: Tier): Placeable[] {
  return PLACEABLES.filter((p) => p.tier <= maxTier);
}

const THREAT_KEYS: ThreatTypeId[] = ["rf-quad", "autonomy", "low-observable"];

function emptyMatrix(): Record<ThreatTypeId, number> {
  return { "rf-quad": 0, autonomy: 0, "low-observable": 0 };
}

export interface DeviceStats {
  radius: number;
  fireInterval: number;
  aoe: number;
  /** Magazine depth (shots before reload); 0 for sensors / unlimited weapons. */
  magazine: number;
  /** Seconds to reload an empty magazine. */
  reloadTime: number;
  effect: Record<ThreatTypeId, number>;
  track: Record<ThreatTypeId, number>;
  /** Sensors: simultaneous fire-control tracks it can hold (0 for effectors). */
  trackCapacity: number;
}

/** Resolve a placeable's stats at a given upgrade level (applies steps 0..level-1). */
export function deviceStats(p: Placeable, level: number): DeviceStats {
  let radius = p.radius;
  let fireInterval = p.cooldown;
  let aoe = p.aoe;
  const magazine = p.magazine ?? 0;
  let reloadTime = p.reloadTime ?? 0;
  const effect = { ...emptyMatrix(), ...(p.effect ?? {}) };
  const track = { ...emptyMatrix(), ...(p.track ?? {}) };
  for (let i = 0; i < level && i < p.upgrades.length; i++) {
    const u = p.upgrades[i];
    if (u.rangeMul) radius *= u.rangeMul;
    if (u.cooldownMul) { fireInterval *= u.cooldownMul; reloadTime *= u.cooldownMul; }
    if (u.aoeAdd) aoe += u.aoeAdd;
    if (u.effectAdd) {
      // Only boost matchups that already work — never make a jammer hurt an
      // autonomy drone (keep the lesson intact).
      for (const k of THREAT_KEYS) if (effect[k] > 0) effect[k] = Math.min(0.98, effect[k] + u.effectAdd);
    }
    if (u.trackAdd) {
      for (const k of THREAT_KEYS) if (u.trackAdd[k]) track[k] = Math.min(1, track[k] + u.trackAdd[k]!);
    }
  }
  return { radius, fireInterval, aoe, magazine, reloadTime, effect, track, trackCapacity: p.trackCapacity ?? 0 };
}

/** Cost to take a device from its current level to the next, or null if maxed. */
export function nextUpgrade(p: Placeable, level: number): UpgradeStep | null {
  return level < p.upgrades.length ? p.upgrades[level] : null;
}

/** Device ids the boss minigame understands (tier-1 teaching gear only). */
export const BOSS_KNOWN = new Set(["radar", "rf-df", "net-drone", "rf-jammer"]);

// ---- drones --------------------------------------------------------------

export interface DroneSpec {
  typeId: ThreatTypeId;
  name: string;
  speed: number;
  hp: number;
  bounty: number;
  leakDamage: number;
}

// Speeds are scaled to the larger field so wave pacing stays brisk (~15s).
export const DRONE_SPECS: Record<ThreatTypeId, DroneSpec> = {
  "rf-quad": { typeId: "rf-quad", name: "RF Quadcopter", speed: 42, hp: 1, bounty: 12, leakDamage: 10 },
  autonomy: { typeId: "autonomy", name: "Autonomy Drone", speed: 48, hp: 1, bounty: 18, leakDamage: 14 },
  "low-observable": { typeId: "low-observable", name: "Low-Observable", speed: 36, hp: 1, bounty: 20, leakDamage: 12 },
};
