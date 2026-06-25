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
    blurb: "Radio-controlled. Trackable and jammable — the textbook target.",
    icon: "✕",
  },
  autonomy: {
    id: "autonomy",
    name: "Autonomy Drone",
    blurb: "Flies pre-programmed. Ignores RF — jammers do NOTHING to it.",
    icon: "◆",
  },
  "low-observable": {
    id: "low-observable",
    name: "Low-Observable",
    blurb: "Tiny radar signature. Radar barely sees it; RF-DF tracks it best.",
    icon: "▲",
  },
};

export const SENSOR_TYPES: Record<SensorTypeId, SensorType> = {
  radar: {
    id: "radar",
    name: "Radar",
    icon: "((•))",
    range: 4.0,
    track: { "rf-quad": 0.95, autonomy: 0.95, "low-observable": 0.4 },
  },
  "rf-df": {
    id: "rf-df",
    name: "RF Direction-Finder",
    icon: "≈",
    range: 3.2,
    // No RF emissions from an autonomy drone → cannot be tracked at all.
    track: { "rf-quad": 1.0, autonomy: 0.0, "low-observable": 0.92 },
  },
};

export const EFFECTOR_TYPES: Record<EffectorTypeId, EffectorType> = {
  "net-drone": {
    id: "net-drone",
    name: "Net-Drone",
    icon: "⊕",
    range: 2.2,
    // Reliable generalist soft-kill, but short-ranged.
    effect: { "rf-quad": 0.88, autonomy: 0.88, "low-observable": 0.86 },
  },
  "rf-jammer": {
    id: "rf-jammer",
    name: "RF Jammer",
    icon: ")))",
    range: 3.5,
    // Devastating vs RF control, useless vs autonomy, solid vs RF low-observable.
    effect: { "rf-quad": 0.95, autonomy: 0.0, "low-observable": 0.7 },
  },
};

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
  title: "Coordinated Strike — Sector East",
  leakTolerance: 1,
  allowLoss: false,
  threats: [
    { id: "t1", typeId: "rf-quad", label: "Bandit-1", distance: 2.6, bearing: 35 },
    { id: "t2", typeId: "rf-quad", label: "Bandit-2", distance: 1.8, bearing: 70 },
    { id: "t3", typeId: "autonomy", label: "Bandit-3", distance: 3.0, bearing: 110 },
    { id: "t4", typeId: "low-observable", label: "Bandit-4", distance: 2.2, bearing: 150 },
  ],
  sensors: [
    { id: "s-radar-1", typeId: "radar", bearing: 20 },
    { id: "s-radar-2", typeId: "radar", bearing: 100 },
    { id: "s-rfdf-1", typeId: "rf-df", bearing: 160 },
  ],
  effectors: [
    { id: "e-net-1", typeId: "net-drone", bearing: 50 },
    { id: "e-net-2", typeId: "net-drone", bearing: 130 },
    { id: "e-jam-1", typeId: "rf-jammer", bearing: 90 },
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
  allowLoss: true,
  threats: [
    { id: "t1", typeId: "rf-quad", label: "Bandit-1", distance: 2.0, bearing: 25 },
    { id: "t2", typeId: "autonomy", label: "Bandit-2", distance: 1.8, bearing: 65 },
    { id: "t3", typeId: "low-observable", label: "Bandit-3", distance: 1.6, bearing: 115 },
    { id: "t4", typeId: "rf-quad", label: "Bandit-4", distance: 2.6, bearing: 155 },
  ],
  sensors: [
    { id: "s-radar-1", typeId: "radar", bearing: 20 },
    { id: "s-radar-2", typeId: "radar", bearing: 95 },
    { id: "s-rfdf-1", typeId: "rf-df", bearing: 140 },
    { id: "s-rfdf-2", typeId: "rf-df", bearing: 170 },
  ],
  effectors: [
    { id: "e-net-1", typeId: "net-drone", bearing: 45 },
    { id: "e-net-2", typeId: "net-drone", bearing: 125 },
    { id: "e-jam-1", typeId: "rf-jammer", bearing: 80 },
    { id: "e-net-3", typeId: "net-drone", bearing: 160 },
  ],
};
