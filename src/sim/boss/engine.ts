/**
 * Boss minigame engine (spec §6) — the lesson core.
 *
 * Responsibilities:
 *   • computeOdds      — explain a single threat's hit probability (legible).
 *   • computeOptimal   — what the BRAIN recommends (best expected outcome).
 *   • deconfliction    — the brain's warnings (untracked / ineffective / seam).
 *   • resolveEncounter — roll the dice deterministically and report the result.
 *
 * Pure logic. Deterministic given an Rng. No rendering.
 */
import { Rng } from "../rng.ts";
import { THREAT_TYPES } from "./data.ts";
import type {
  AssignmentMap,
  BossConfig,
  DeviceUnit,
  EncounterResult,
  Odds,
  OddsFactor,
  ThreatResult,
  ThreatUnit,
} from "./types.ts";

/** Multiplier applied to effectiveness when a threat is engaged but untracked. */
const UNTRACKED_PENALTY = 0.35;

const EMPTY_MATRIX: Record<string, number> = {};

/**
 * Range factor for the boss. Threats fly INWARD to the asset, so any device in
 * their path eventually gets a shot — range is an advantage (it covers more of
 * the approach), never a hard gate. A device whose reach ≥ the threat's distance
 * is fully effective; a shorter-ranged one still engages as the drone closes,
 * down to a floor. This is what makes every placed device usable at the boss
 * (a short-range net is no longer "useless" against a far drone it would happily
 * kill in the real-time wave).
 *
 * Used only as a fallback when a device carries no position (canned rosters that
 * predate positions). When a device HAS a position, engageFactor below supersedes
 * this with real approach geometry.
 */
function rangeFactor(range: number, distance: number): number {
  const cover = Math.min(1, range / Math.max(0.1, distance));
  return 0.5 + 0.5 * cover;
}

/** Every device keeps a little reach even far from a threat (it never reads as
 *  literally useless), but position now dominates — see engageFactor. */
const GEO_FLOOR = 0.12;

/** Plane position (km) for a polar (bearing 0 = north, CW) + radius. Matches the
 *  real-time engine's spawn convention so boss geometry and wave geometry agree. */
function polar(bearing: number, dist: number): { x: number; y: number } {
  const rad = ((bearing - 90) * Math.PI) / 180;
  return { x: Math.cos(rad) * dist, y: Math.sin(rad) * dist };
}

/**
 * Geometry-aware engagement factor: how much of a threat's INBOUND corridor a
 * device can actually work, given where the device physically sits. The threat
 * flies a straight line from its spawn (bearing, distance) to the asset at the
 * centre; we sample that path and measure the fraction of it inside the device's
 * range. A device sitting on the threat's approach covers most of the corridor
 * (≈1); one on the OPPOSITE side only catches the drone as it crosses the centre
 * (near the floor). This is what makes the brain's picks spatially sensible — it
 * no longer tasks a south-side effector onto a north-side threat.
 */
function engageFactor(
  unit: { range: number; bearing: number; distance?: number },
  threat: ThreatUnit,
): number {
  if (unit.distance == null) return rangeFactor(unit.range, threat.distance);
  const a = polar(threat.bearing, threat.distance);
  const p = polar(unit.bearing, unit.distance);
  const N = 12;
  let inRange = 0;
  for (let i = 0; i <= N; i++) {
    const t = i / N; // 0 = spawn edge, 1 = the asset at centre
    const dx = a.x * (1 - t) - p.x;
    const dy = a.y * (1 - t) - p.y;
    if (Math.hypot(dx, dy) <= unit.range) inRange++;
  }
  const coverage = inRange / (N + 1);
  return GEO_FLOOR + (1 - GEO_FLOOR) * coverage;
}

/**
 * Explain the hit probability for one threat under a given (sensor, effector).
 * Returns p plus the multiplicative factors and any warnings, so the UI can
 * show the breakdown that makes the brain's pick feel insightful.
 */
export function computeOdds(
  cfg: BossConfig,
  threat: ThreatUnit,
  sensorId: string | null,
  effectorId: string | null,
): Odds {
  const factors: OddsFactor[] = [];
  const warnings: string[] = [];
  const tt = THREAT_TYPES[threat.typeId];

  const effUnit = effectorId ? cfg.effectors.find((e) => e.id === effectorId) : null;
  if (!effUnit) {
    return {
      threatId: threat.id,
      p: 0,
      factors: [{ label: "No effector assigned", mult: 0 }],
      warnings: [`${threat.label} is unengaged — it will leak.`],
      unengaged: true,
    };
  }

  // 1. Effector-vs-threat-type matchup (the headline factor).
  const matchup = (effUnit.effect ?? EMPTY_MATRIX)[threat.typeId] ?? 0;
  factors.push({ label: `${effUnit.name} vs ${tt.name}`, mult: matchup });
  if (matchup <= 0.001) {
    warnings.push(`${effUnit.name} has NO effect on a ${tt.name}.`);
  }

  // 2. Position vs the threat's inbound corridor (geometry).
  const rf = engageFactor(effUnit, threat);
  factors.push({ label: `Position vs approach`, mult: rf });
  if (rf <= GEO_FLOOR + 0.001) warnings.push(`${effUnit.name} is off ${threat.label}'s approach — poor angle.`);

  // 3. Tracking quality from the assigned sensor.
  let trackMult = UNTRACKED_PENALTY;
  if (sensorId) {
    const senUnit = cfg.sensors.find((s) => s.id === sensorId);
    if (senUnit) {
      const q = (senUnit.track ?? EMPTY_MATRIX)[threat.typeId] ?? 0;
      const senRf = engageFactor(senUnit, threat);
      if (q <= 0.001) {
        warnings.push(`${senUnit.name} cannot track a ${tt.name}.`);
        trackMult = UNTRACKED_PENALTY;
      } else if (senRf <= GEO_FLOOR + 0.001) {
        warnings.push(`${threat.label} is off ${senUnit.name}'s arc — weak track.`);
        trackMult = UNTRACKED_PENALTY;
      } else {
        // Tracking lifts effectiveness from the untracked floor toward 1.0.
        trackMult = UNTRACKED_PENALTY + (1 - UNTRACKED_PENALTY) * q * senRf;
      }
    }
  } else {
    warnings.push(`${threat.label} is being engaged UNTRACKED — odds are poor.`);
  }
  factors.push({ label: sensorId ? "Track quality" : "No track (firing blind)", mult: trackMult });

  const p = clamp01(factors.reduce((acc, f) => acc * f.mult, 1));
  return { threatId: threat.id, p, factors, warnings, unengaged: false };
}

/** Compute odds for every threat under an assignment map. */
export function computeAllOdds(cfg: BossConfig, map: AssignmentMap): Odds[] {
  return cfg.threats.map((t) => {
    const a = map[t.id] ?? { sensorId: null, effectorId: null };
    return computeOdds(cfg, t, a.sensorId, a.effectorId);
  });
}

/**
 * Brain-on deconfliction warnings (spec §6.2 / §12 face 2). Surfaces:
 *   • duplicate effector use (two threats sharing one effector → wasted),
 *   • ineffective matchups, untracked engagements, and unengaged seams.
 */
export function deconfliction(cfg: BossConfig, map: AssignmentMap): string[] {
  const msgs: string[] = [];
  const effUse = new Map<string, string[]>();
  const senUse = new Map<string, string[]>();

  for (const t of cfg.threats) {
    const a = map[t.id];
    if (!a) continue;
    if (a.effectorId) (effUse.get(a.effectorId) ?? effUse.set(a.effectorId, []).get(a.effectorId)!).push(t.label);
    if (a.sensorId) (senUse.get(a.sensorId) ?? senUse.set(a.sensorId, []).get(a.sensorId)!).push(t.label);
  }
  for (const [eid, ts] of effUse) {
    if (ts.length > 1) {
      const e = cfg.effectors.find((x) => x.id === eid)!;
      msgs.push(`${e.name} double-tasked on ${ts.join(" & ")} — split it.`);
    }
  }
  for (const [sid, ts] of senUse) {
    if (ts.length > 1) {
      const s = cfg.sensors.find((x) => x.id === sid)!;
      msgs.push(`${s.name} can't track ${ts.join(" & ")} at once.`);
    }
  }
  return msgs;
}

/**
 * Expected number of threats stopped under an assignment (sum of per-threat p).
 * This is the objective the brain maximizes.
 */
export function expectedStopped(cfg: BossConfig, map: AssignmentMap): number {
  return computeAllOdds(cfg, map).reduce((acc, o) => acc + o.p, 0);
}

/**
 * Brute-force the optimal assignment (spec §6.2 — the brain's highlight).
 *
 * Each sensor and each effector is used at most once. The roster is tiny
 * (≤4 threats, ≤4 of each device), so exhaustive search over effector and
 * sensor permutations is instant and provably optimal. We maximize expected
 * stopped, tie-breaking toward the worst-covered threat being as safe as
 * possible (robustness), which matches how a good operator actually thinks.
 */
/** Best contribution a device could make to ANY threat (for candidate pruning). */
function deviceRelevance(cfg: BossConfig, device: DeviceUnit): number {
  let best = 0;
  for (const t of cfg.threats) {
    const matrix = device.effect ?? device.track ?? EMPTY_MATRIX;
    const q = (matrix[t.typeId] ?? 0) * engageFactor(device, t);
    if (q > best) best = q;
  }
  return best;
}

/** Top-N device ids by relevance — bounds the optimizer when the roster is large. */
function topCandidates(cfg: BossConfig, units: BossConfig["effectors"], n: number): string[] {
  return [...units]
    .sort((a, b) => deviceRelevance(cfg, b) - deviceRelevance(cfg, a))
    .slice(0, n)
    .map((u) => u.id);
}

export function computeOptimal(cfg: BossConfig): AssignmentMap {
  const threats = cfg.threats;
  // Only ≤4 threats can be served, so the few best-matching devices per kind
  // dominate any optimal plan. Capping the candidate pool keeps the exhaustive
  // search instant even when the player has fielded a dozen+ devices.
  const CAP = 6;
  const effIds = cfg.effectors.length > CAP ? topCandidates(cfg, cfg.effectors, CAP) : cfg.effectors.map((e) => e.id);
  const senIds = cfg.sensors.length > CAP ? topCandidates(cfg, cfg.sensors, CAP) : cfg.sensors.map((s) => s.id);

  let best: AssignmentMap | null = null;
  let bestScore = -1;
  let bestMin = -1;

  // Assign effectors first (the scarce, decisive resource), then sensors.
  for (const effChoice of partialAssignments(threats.length, effIds)) {
    for (const senChoice of partialAssignments(threats.length, senIds)) {
      const map: AssignmentMap = {};
      threats.forEach((t, i) => {
        map[t.id] = { sensorId: senChoice[i], effectorId: effChoice[i] };
      });
      const odds = computeAllOdds(cfg, map);
      const score = odds.reduce((a, o) => a + o.p, 0);
      const minP = Math.min(...odds.map((o) => o.p));
      if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) < 1e-9 && minP > bestMin)) {
        bestScore = score;
        bestMin = minP;
        best = map;
      }
    }
  }
  return best ?? emptyAssignment(cfg);
}

/**
 * All ways to assign `slots` threats a distinct device from `ids` (or null).
 * Yields arrays of length `slots`; each entry is an id or null (unengaged).
 */
function* partialAssignments(slots: number, ids: string[]): Generator<(string | null)[]> {
  const used = new Set<string>();
  const acc: (string | null)[] = [];
  function* rec(i: number): Generator<(string | null)[]> {
    if (i === slots) {
      yield acc.slice();
      return;
    }
    // Option: leave this threat without this device class.
    acc.push(null);
    yield* rec(i + 1);
    acc.pop();
    // Option: give it any not-yet-used device.
    for (const id of ids) {
      if (used.has(id)) continue;
      used.add(id);
      acc.push(id);
      yield* rec(i + 1);
      acc.pop();
      used.delete(id);
    }
  }
  yield* rec(0);
}

export function emptyAssignment(cfg: BossConfig): AssignmentMap {
  const map: AssignmentMap = {};
  for (const t of cfg.threats) map[t.id] = { sensorId: null, effectorId: null };
  return map;
}

/**
 * Resolve the encounter: roll each threat against its hit probability.
 * Deterministic given the Rng. Honors allowLoss=false by flooring a losing
 * outcome to a narrow win (spec §6.1/§13 — never knock out a cold booth player).
 */
export function resolveEncounter(
  cfg: BossConfig,
  map: AssignmentMap,
  rng: Rng,
): EncounterResult {
  const odds = computeAllOdds(cfg, map);
  const results: ThreatResult[] = odds.map((o) => ({
    threatId: o.threatId,
    p: o.p,
    stopped: rng.chance(o.p),
  }));

  let stopped = results.filter((r) => r.stopped).length;
  let leaked = results.length - stopped;
  let rescued = false;
  let won = leaked <= cfg.leakTolerance;

  if (!won && !cfg.allowLoss) {
    // Rescue the weakest leak so the player narrowly survives.
    const leakedSorted = results
      .filter((r) => !r.stopped)
      .sort((a, b) => b.p - a.p); // flip the most-likely-to-have-hit first
    while (leaked > cfg.leakTolerance && leakedSorted.length) {
      const r = leakedSorted.shift()!;
      r.stopped = true;
      stopped++;
      leaked--;
      rescued = true;
    }
    won = true;
  }

  return { results, stopped, leaked, won, rescued };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
