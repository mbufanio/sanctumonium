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
import { losClear, type TerrainMap } from "../terrain.ts";
import type { ThreatTypeId } from "../boss/types.ts";
import { DRONE_SPECS, LEAK_RADIUS } from "./catalog.ts";
import type { Drone, PlacedDevice, RealtimeState, SpawnEntry, WaveDef } from "./types.ts";

const NO_TERRAIN: TerrainMap = new Map();

/**
 * Effectiveness multiplier when firing on an untracked drone. Deliberately
 * harsh: firing without a fire-control track is a coin-flip at best, so sensor
 * coverage (coordination) is what actually wins — not spamming effectors.
 */
const UNTRACKED_PENALTY = 0.2;

/** Coordinated shots are more reliable (fused tracks + timing), capped below 1. */
const COORD_ACCURACY = 1.25;

// ---- kill chain (spec: detect → classify/ID → track → engage) ------------
/** Classification confidence needed for a fire-control track. */
const ID_THRESHOLD = 0.55;
/** Classification gained per second per unit of capable sensor quality. */
const ID_GAIN = 1.6;
/** Confidence lost per second once no sensor has any return on the drone. */
const ID_DECAY = 0.7;

export interface StepEnv {
  /** Plane radius at which drones spawn (just beyond the field edge). */
  spawnRadius: number;
  /** The site's terrain (blockers + no-fire zones) for line-of-sight. */
  terrain?: TerrainMap;
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
  const terrain = env.terrain ?? NO_TERRAIN;

  // 1. Spawn any drones whose scheduled time has arrived.
  while (rt.spawnCursor < wave.spawns.length && wave.spawns[rt.spawnCursor].at <= rt.time) {
    const s = wave.spawns[rt.spawnCursor++];
    rt.drones.push(spawnDrone(rt, s, env.spawnRadius));
  }

  const sensors = placed.filter((p) => p.kind === "sensor");
  const effectors = placed.filter((p) => p.kind === "effector");

  // 2. Move drones toward the centre and advance their KILL CHAIN.
  //    detect → classify/ID → track. Detection is any return; classification
  //    requires a sensor that can actually work the type (an RF-DF can detect
  //    nothing on a non-emitting autonomy drone, radar barely sees a stealth
  //    body). WITH the brain, every capable sensor's read is FUSED — IDs land
  //    fast. WITHOUT it, each effector leans on the single best sensor, so the
  //    picture is slower and patchier.
  for (const d of rt.drones) {
    if (d.state !== "alive") continue;
    const len = planeLen(d.pos) || 1;
    d.pos = { x: d.pos.x - (d.pos.x / len) * d.speed * dt, y: d.pos.y - (d.pos.y / len) * d.speed * dt };

    let detected = false;
    let fused = 0; // sum of capable sensors (coordinated)
    let best = 0; // best single capable sensor (uncoordinated)
    for (const s of sensors) {
      if (planeDist(s.pos, d.pos) > s.radius) continue;
      if (!losClear(s.pos, d.pos, terrain, false)) continue;
      detected = true; // a return, even if the sensor can't classify the type
      const q = s.track[d.typeId];
      if (q > 0) {
        fused += q;
        if (q > best) best = q;
      }
    }
    const classRate = env.coordinated ? fused : best;
    if (classRate > 0) d.idConf = Math.min(1, d.idConf + classRate * ID_GAIN * dt);
    else if (!detected) d.idConf = Math.max(0, d.idConf - ID_DECAY * dt);
    d.detected = detected;
    d.tracked = detected && d.idConf >= ID_THRESHOLD;

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
      rt.fx.push({ kind: "kill", at: d.pos, bounty: d.bounty });
    }
  };

  for (const e of effectors) {
    e.cooldown = Math.max(0, e.cooldown - dt);
    if (e.cooldown > 0) continue;
    const target = pickTarget(rt.drones, e, claimed, terrain, !!env.coordinated);
    if (!target) continue;
    if (claimed) claimed.add(target.id);
    // Uncoordinated, a unit can't classify before it shoots — so it fires even
    // at a drone its weapon can't beat (a jammer at an autonomy drone), burning
    // the cooldown for nothing. The fx shows the miss; the lesson lands.
    const wasted = e.effect[target.typeId] <= 0;
    if (wasted) {
      e.cooldown = e.fireInterval;
      rt.fx.push({ kind: "shot", from: e.pos, to: target.pos, effector: e.placeableId, hit: false });
      continue;
    }

    e.cooldown = e.fireInterval;
    // Coordination handoff: show the sensor passing the track to this effector.
    if (env.coordinated && target.tracked) {
      const s = trackingSensor(target, sensors, terrain);
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

/**
 * Best target for an effector: in range with a clear FIRING line (blockers and
 * no-fire zones both obstruct fire).
 *
 * COORDINATED: the grid hands each effector a confirmed track of a type it can
 * actually beat — so it only considers good-matchup drones (effect > 0),
 * deconflicts (skips drones already claimed this step), and prioritises
 * fire-control tracks then the most central threat. Every shot counts.
 *
 * UNCOORDINATED: the unit shoots what's closest in its own range, with no fused
 * classification and no deconfliction — it may pile onto a drone another unit
 * already has, or open up on one its weapon can't touch (wasted upstream).
 */
function pickTarget(
  drones: Drone[],
  e: PlacedDevice,
  claimed: Set<number> | null,
  terrain: TerrainMap,
  coordinated: boolean,
): Drone | null {
  let best: Drone | null = null;
  let bestScore = -Infinity;
  for (const d of drones) {
    if (d.state !== "alive") continue;
    if (claimed?.has(d.id)) continue; // coordinated: already being engaged this step
    if (coordinated && e.effect[d.typeId] <= 0) continue; // grid won't task a useless shot
    if (planeDist(e.pos, d.pos) > e.radius) continue;
    if (!losClear(e.pos, d.pos, terrain, true)) continue; // building or no-fire zone in the way
    // Prefer fire-control tracks, then whatever is closest to the asset.
    const score = (d.tracked ? 1000 : 0) - planeLen(d.pos);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** The nearest in-range sensor that can actually track this drone (for handoff fx). */
function trackingSensor(d: Drone, sensors: PlacedDevice[], terrain: TerrainMap): PlacedDevice | null {
  let best: PlacedDevice | null = null;
  let bestDist = Infinity;
  for (const s of sensors) {
    if (s.track[d.typeId] <= 0) continue;
    const dist = planeDist(s.pos, d.pos);
    if (dist <= s.radius && dist < bestDist && losClear(s.pos, d.pos, terrain, false)) {
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
  const id = rt.nextDroneId++;
  return {
    id,
    typeId: s.typeId,
    pos: { x: Math.cos(rad) * spawnRadius, y: Math.sin(rad) * spawnRadius },
    speed: spec.speed * (m.speedMul ?? 1),
    hp: Math.max(1, Math.round(spec.hp * (m.hpMul ?? 1))),
    bounty: Math.round(spec.bounty * (m.bountyMul ?? 1)),
    leakDamage: spec.leakDamage * (m.leakMul ?? 1),
    state: "alive",
    detected: false,
    idConf: 0,
    tracked: false,
    trackId: id,
    size: m.size ?? 1,
  };
}
