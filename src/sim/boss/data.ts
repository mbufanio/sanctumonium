/**
 * Boss minigame data tables (spec §6, §7-tier-1).
 *
 * Everything here is generic/fictional-friendly — no real model numbers. The
 * matchup matrix is tuned so the teaching moments are crisp:
 *   • RF jammer is EXCELLENT vs the RF quad but USELESS vs the autonomy drone
 *     (it ignores RF) — the signature "ah, right" lesson.
 *   • The RF direction-finder cannot track the autonomy drone (no RF to find).
 *   • Radar struggles to track the low-observable threat.
 * The net-drone is the reliable generalist — but short-ranged and you don't
 * have enough of everything, so prioritization bites.
 */
import type {
  BossConfig,
  DeviceUnit,
  EffectorType,
  EffectorTypeId,
  SensorType,
  SensorTypeId,
  ThreatType,
  ThreatTypeId,
} from "./types.ts";

export const THREAT_TYPES: Record<ThreatTypeId, ThreatType> = {
  "rf-quad": {
    id: "rf-quad",
    name: "RF Quadcopter",
    code: "RF",
    blurb: "Radio-controlled. Trackable and jammable — the textbook target.",
    icon: "✚",
  },
  autonomy: {
    id: "autonomy",
    name: "Autonomy Drone",
    code: "AUTO",
    blurb: "Flies pre-programmed. Ignores RF — jammers do NOTHING to it.",
    icon: "◆",
  },
  "low-observable": {
    id: "low-observable",
    name: "Low-Observable",
    code: "STEALTH",
    blurb: "Tiny radar signature. Radar barely sees it; RF-DF tracks it best.",
    icon: "▲",
  },
};

export const SENSOR_TYPES: Record<SensorTypeId, SensorType> = {
  radar: {
    id: "radar",
    name: "Radar",
    code: "RADAR",
    icon: "📡",
    role: "Detects & tracks drones by radar return.",
    range: 4.0,
    track: { "rf-quad": 0.95, autonomy: 0.95, "low-observable": 0.4 },
  },
  "rf-df": {
    id: "rf-df",
    name: "RF Direction-Finder",
    code: "RF-DF",
    icon: "🛰",
    role: "Locates drones by their radio emissions.",
    range: 3.2,
    // No RF emissions from an autonomy drone → cannot be tracked at all.
    track: { "rf-quad": 1.0, autonomy: 0.0, "low-observable": 0.92 },
  },
};

export const EFFECTOR_TYPES: Record<EffectorTypeId, EffectorType> = {
  "net-drone": {
    id: "net-drone",
    name: "Net-Drone",
    code: "NET",
    icon: "🕸",
    role: "Captures a drone with a launched net.",
    range: 2.2,
    // Reliable generalist soft-kill, but short-ranged.
    effect: { "rf-quad": 0.88, autonomy: 0.88, "low-observable": 0.86 },
  },
  "rf-jammer": {
    id: "rf-jammer",
    name: "RF Jammer",
    code: "JAMMER",
    icon: "📶",
    role: "Severs a drone's radio control link.",
    range: 3.5,
    // Devastating vs RF control, useless vs autonomy, solid vs RF low-observable.
    effect: { "rf-quad": 0.95, autonomy: 0.0, "low-observable": 0.7 },
  },
};

/** Build a sensor unit (canned fallback roster) with its resolved stats. */
function sUnit(id: string, typeId: SensorTypeId, bearing: number, distance = 2): DeviceUnit {
  const t = SENSOR_TYPES[typeId];
  return { id, typeId, kind: "sensor", name: t.name, code: t.code, role: t.role, range: t.range, bearing, distance, track: { ...t.track } };
}

/** Build an effector unit (canned fallback roster) with its resolved stats. */
function eUnit(id: string, typeId: EffectorTypeId, bearing: number, distance = 2): DeviceUnit {
  const t = EFFECTOR_TYPES[typeId];
  return { id, typeId, kind: "effector", name: t.name, code: t.code, role: t.role, range: t.range, bearing, distance, effect: { ...t.effect } };
}

/**
 * BOSS #1 — "the wall" (spec §6.1). Played WITHOUT the brain: odds hidden.
 *
 * The trap: 4 threats, only 3 effectors and 3 sensors, and one threat is an
 * autonomy drone the jammer can't touch. A cold player tends to (a) waste the
 * jammer on the autonomy drone and/or (b) leave a net-killable threat
 * unengaged. Calibrated so a *reasonable* assignment narrowly wins and a
 * blunder is rescued to a painful narrow win (allowLoss=false).
 */
export const BOSS_1: BossConfig = {
  id: "boss-1",
  title: "Coordinated Strike — Mixed Threats",
  leakTolerance: 1,
  allowLoss: false,
  // Three threats, deliberately NOT solvable by "nearest device to nearest
  // threat" (against the fixed Act-1 laydown: RF-DF + jammer at 0°, radar + net
  // at 120° and 240°). The AUTONOMY drone sits by the RF-DF + jammer — both
  // useless on it (a jammer can't touch a fibre/autonomy bird; an RF-DF can't
  // track a silent one), so its eyes and its shot must come from a radar + net
  // across the field. The RF quad sits next to a radar + net (tempting) but is
  // the ONLY thing the RF-DF + jammer can handle, so it should be left to them —
  // freeing that near net for the low-observable. Matchup drives the plan.
  threats: [
    { id: "t1", typeId: "autonomy", label: "Bandit-1", distance: 2.4, bearing: 5 },
    { id: "t2", typeId: "rf-quad", label: "Bandit-2", distance: 2.2, bearing: 125 },
    { id: "t3", typeId: "low-observable", label: "Bandit-3", distance: 2.0, bearing: 245 },
  ],
  // Canned fallback roster (used only if the player fielded no devices at all);
  // aligned to the threats so it stays cleanly solvable for the guardrail tests.
  sensors: [
    sUnit("s-radar-1", "radar", 5),
    sUnit("s-radar-2", "radar", 245),
    sUnit("s-rfdf-1", "rf-df", 125),
  ],
  effectors: [
    eUnit("e-net-1", "net-drone", 5),
    eUnit("e-net-2", "net-drone", 245),
    eUnit("e-jam-1", "rf-jammer", 125),
  ],
};

/**
 * BOSS #2 — "the catharsis" (spec §6.2). The SAME class of fight, now with the
 * brain active (odds visible, optimal highlighted, deconfliction). Slightly
 * harder roster, but coordination makes it a clean win. Generous tolerance so
 * an optimal-following player wins decisively.
 */
export const BOSS_2: BossConfig = {
  id: "boss-2",
  title: "Coordinated Strike — Multi-Axis",
  leakTolerance: 1,
  // The catharsis: solving the matchup puzzle wins it; a blunder is floored to a
  // narrow win, never an outright loss (the sale, not a game-over).
  allowLoss: false,
  // Same trap, arranged differently: the AUTONOMY sits by the RF-DF + jammer
  // (both useless on it) and must be reached by a net + radar across the field;
  // the RF quad by a radar + net should be handed to the RF-DF + jammer, freeing
  // that net for the autonomy; the low-observable is where a radar + net already
  // are.
  threats: [
    { id: "t1", typeId: "autonomy", label: "Bandit-1", distance: 2.2, bearing: 5 },
    { id: "t2", typeId: "low-observable", label: "Bandit-2", distance: 2.0, bearing: 125 },
    { id: "t3", typeId: "rf-quad", label: "Bandit-3", distance: 2.4, bearing: 245 },
  ],
  sensors: [
    sUnit("s-radar-1", "radar", 5),
    sUnit("s-radar-2", "radar", 125),
    sUnit("s-rfdf-1", "rf-df", 245),
  ],
  effectors: [
    eUnit("e-net-1", "net-drone", 5),
    eUnit("e-net-2", "net-drone", 125),
    eUnit("e-jam-1", "rf-jammer", 245),
  ],
};
