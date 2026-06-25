/**
 * Real-time auto-defense engine (spec §5) — the live wave simulation.
 *
 * Each fixed step: spawn scheduled drones at the field edge, advance them
 * toward the centred asset, let placed sensors track and placed effectors
 * auto-engage, and resolve leaks into the asset. Deterministic given an Rng.
 *
 * The same matchup truth as the boss minigame applies here: an effector that
 * has no effect on a drone type (jammer vs autonomy) simply never engages it,
 * so that drone sails through the jammer's coverage — the lesson, lived.
 *
 * The engine owns no currency/score/integrity; it reports per-step kills and
 * leaks so the controller can apply economy. Pure logic, no rendering.
 */
import { Rng } from "../rng.ts";
import { planeDist, planeLen, type Px } from "../hex.ts";
import type { ThreatTypeId } from "../boss/types.ts";
import { DRONE_SPECS, LEAK_RADIUS } from "./catalog.ts";
import type { Drone, PlacedDevice, RealtimeState, SpawnEntry, WaveDef } from "./types.ts";

/**
 * Effectiveness multiplier when firing on an untracked drone. Deliberately
 * harsh: firing without a sensor track is a coin-flip at best, so sensor
 * coverage (coordination) is what actually wins — not spamming effectors.
 */
const UNTRACKED_PENALTY = 0.2;

/** Coordinated shots are more reliable (fused tracks + timing), capped below 1. */
const COORD_ACCURACY = 1.25;

export interface StepEnv {
  /** Plane radius at which drones spawn (just beyond the field edge). */
  spawnRadius: number;
  /**
   * Brain coordination active (spec §12 face 1). When true, effectors
   * DECONFLICT — no two waste fire on the same drone in a step — and prioritise
   * the most dangerous tracked threats. Same hardware, better used.
   */
  coordinated?: boolean;
}

export interface KillInfo {
  typeId: ThreatTypeId;
  bounty: number;
  tracked: boolean;
  pos: Px;
}

export interface LeakInfo {
  typeId: ThreatTypeId;
  damage: number;
  pos: Px;
}

export interface StepResult {
  kills: KillInfo[];
  leaks: LeakInfo[];
  /** True once the wave's spawns are exhausted and no drones remain alive. */
  waveComplete: boolean;
}

export function stepWave(
  rt: RealtimeState,
  placed: PlacedDevice[],
  wave: WaveDef,
  dt: number,
  rng: Rng,
  env: StepEnv,
): StepResult {
  rt.time += dt;
  const kills: KillInfo[] = [];
  const leaks: LeakInfo[] = [];

  // 1. Spawn any drones whose scheduled time has arrived.
  while (rt.spawnCursor < wave.spawns.length && wave.spawns[rt.spawnCursor].at <= rt.time) {
    const s = wave.spawns[rt.spawnCursor++];
    rt.drones.push(spawnDrone(rt, s, env.spawnRadius));
  }

  const sensors = placed.filter((p) => p.kind === "sensor");
  const effectors = placed.filter((p) => p.kind === "effector");

  // 2. Move drones toward the centre and refresh their tracked flag.
  for (const d of rt.drones) {
    if (d.state !== "alive") continue;
    const len = planeLen(d.pos) || 1;
    d.pos = { x: d.pos.x - (d.pos.x / len) * d.speed * dt, y: d.pos.y - (d.pos.y / len) * d.speed * dt };
    d.tracked = isTracked(d, sensors);
    if (planeLen(d.pos) <= LEAK_RADIUS) {
      d.state = "leaked";
      rt.leaked++;
      leaks.push({ typeId: d.typeId, damage: d.leakDamage, pos: d.pos });
      rt.fx.push({ kind: "leak", at: d.pos, damage: d.leakDamage });
    }
  }

  // 3. Effectors engage. Each fires at most once per cooldown at the best
  //    target it can actually affect (effect > 0), preferring tracked drones
  //    and then whichever is closest to the asset.
  //
  //    WITHOUT the brain, effectors choose independently — so several pile onto
  //    the same most-central drone and waste shots (drones die in one hit).
  //    WITH the brain (env.coordinated), fire is DECONFLICTED: a drone already
  //    claimed this step is skipped, so the same hardware kills more per volley.
  const claimed = env.coordinated ? new Set<number>() : null;
  const resolveHit = (e: PlacedDevice, d: Drone) => {
    let p = hitChance(e.effect[d.typeId], d.tracked);
    if (env.coordinated && p > 0) p = Math.min(0.98, p * COORD_ACCURACY);
    if (!rng.chance(p)) return;
    d.hp -= 1;
    if (d.hp <= 0) {
      d.state = "killed";
      rt.killed++;
      kills.push({ typeId: d.typeId, bounty: d.bounty, tracked: d.tracked, pos: d.pos });
      rt.fx.push({ kind: "kill", at: d.pos });
    }
  };

  for (const e of effectors) {
    e.cooldown = Math.max(0, e.cooldown - dt);
    if (e.cooldown > 0) continue;
    const target = pickTarget(rt.drones, e, claimed);
    if (!target) continue;
    if (claimed) claimed.add(target.id);

    e.cooldown = e.fireInterval;
    // Coordination handoff: show the sensor passing the track to this effector.
    if (env.coordinated && target.tracked) {
      const s = trackingSensor(target, sensors);
      if (s) rt.fx.push({ kind: "handoff", from: s.pos, to: target.pos });
    }
    rt.fx.push({ kind: "shot", from: e.pos, to: target.pos, effector: e.placeableId, hit: true });

    if (e.aoe > 0) {
      // Area soft-kill: everything affectable within the blast takes the shot.
      rt.fx.push({ kind: "aoe", at: target.pos, radius: e.aoe, effector: e.placeableId });
      for (const d of rt.drones) {
        if (d.state !== "alive") continue;
        if (e.effect[d.typeId] <= 0) continue;
        if (planeDist(target.pos, d.pos) > e.aoe) continue;
        resolveHit(e, d);
      }
    } else {
      resolveHit(e, target);
    }
  }

  // 4. Reap resolved drones.
  rt.drones = rt.drones.filter((d) => d.state === "alive");

  const waveComplete = rt.spawnCursor >= wave.spawns.length && rt.drones.length === 0;
  return { kills, leaks, waveComplete };
}

/** A drone is tracked if any in-range sensor can see its type at all. */
function isTracked(d: Drone, sensors: PlacedDevice[]): boolean {
  for (const s of sensors) {
    if (s.track[d.typeId] <= 0) continue;
    if (planeDist(s.pos, d.pos) <= s.radius) return true;
  }
  return false;
}

/** Best target for an effector: in range, affectable, tracked-first, then nearest the asset.
 *  When `claimed` is provided (coordinated), drones already taken this step are skipped. */
function pickTarget(drones: Drone[], e: PlacedDevice, claimed: Set<number> | null): Drone | null {
  let best: Drone | null = null;
  let bestScore = -Infinity;
  for (const d of drones) {
    if (d.state !== "alive") continue;
    if (claimed?.has(d.id)) continue; // already being engaged this step
    if (e.effect[d.typeId] <= 0) continue; // can't affect this type — ignore it
    if (planeDist(e.pos, d.pos) > e.radius) continue;
    // Prefer tracked drones, then those closest to the asset (smallest radius).
    const score = (d.tracked ? 1000 : 0) - planeLen(d.pos);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** The nearest in-range sensor that can actually track this drone (for handoff fx). */
function trackingSensor(d: Drone, sensors: PlacedDevice[]): PlacedDevice | null {
  let best: PlacedDevice | null = null;
  let bestDist = Infinity;
  for (const s of sensors) {
    if (s.track[d.typeId] <= 0) continue;
    const dist = planeDist(s.pos, d.pos);
    if (dist <= s.radius && dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }
  return best;
}

/** Single-shot hit probability from an effector's matchup value and track state. */
export function hitChance(effectBase: number, tracked: boolean): number {
  return effectBase * (tracked ? 1 : UNTRACKED_PENALTY);
}

function spawnDrone(rt: RealtimeState, s: SpawnEntry, spawnRadius: number): Drone {
  const spec = DRONE_SPECS[s.typeId];
  const m = s.mods ?? {};
  const rad = ((s.bearing - 90) * Math.PI) / 180; // 0° = north (up), matches boss polar
  return {
    id: rt.nextDroneId++,
    typeId: s.typeId,
    pos: { x: Math.cos(rad) * spawnRadius, y: Math.sin(rad) * spawnRadius },
    speed: spec.speed * (m.speedMul ?? 1),
    hp: spec.hp,
    bounty: Math.round(spec.bounty * (m.bountyMul ?? 1)),
    leakDamage: spec.leakDamage * (m.leakMul ?? 1),
    state: "alive",
    tracked: false,
    size: m.size ?? 1,
  };
}
