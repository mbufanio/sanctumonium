/**
 * Wave schedule + boss wiring (spec §5, §14 Phase 2).
 *
 * The run is a sequence of normal real-time waves with the two Phase-1 boss
 * fights interleaved — boss #1 as the "wall" about a third in, boss #2 as the
 * catharsis near the end. Crucially the bosses are fought on the layout the
 * player actually built: bossConfigFromLayout swaps the player's placed
 * sensors/effectors into the boss roster.
 *
 * Timings/compositions are simple, tunable constants here (full pacing is
 * Phase 4). Deterministic — bearings are derived, not random.
 */
import { hexToPlane, planeLen } from "../hex.ts";
import { BOSS_1, BOSS_2 } from "../boss/data.ts";
import { RANGE_SCALE, deviceStats, placeableById } from "./catalog.ts";
import type { BossConfig, DeviceUnit } from "../boss/types.ts";
import type { ThreatTypeId } from "../boss/types.ts";
import type { PlacedDevice, SpawnEntry, SpawnMods, WaveDef } from "./types.ts";

export interface Composition {
  typeId: ThreatTypeId;
  count: number;
  /** Per-spawn modifiers — how a level expresses its wrinkle (swarm, etc.). */
  mods?: SpawnMods;
}

/** Build a normal wave: spread spawns over time and around all 360°. */
export function makeWave(index: number, comps: Composition[], stipend: number, label?: string): WaveDef {
  const spawns: SpawnEntry[] = [];
  let n = 0;
  const total = comps.reduce((a, c) => a + c.count, 0);
  // Swarms spawn faster (tighter gap) so they read as a rush, not a trickle.
  const swarmy = comps.some((c) => (c.mods?.size ?? 1) < 0.8);
  const gap = swarmy ? 0.35 : 0.8;
  for (const c of comps) {
    for (let i = 0; i < c.count; i++) {
      // Even spread around the circle, offset per wave so it isn't static.
      const bearing = (360 / total) * n + index * 47;
      spawns.push({ at: 0.6 + n * gap, typeId: c.typeId, bearing: bearing % 360, mods: c.mods });
      n++;
    }
  }
  return { index, kind: "normal", label: label ?? `Wave ${index}`, spawns, stipend };
}

/** One schedule entry: a real-time wave or a boss fight on the built layout. */
export type ScheduleEntry =
  | { type: "wave"; wave: WaveDef }
  | { type: "boss"; bossIndex: 1 | 2 };

/** Tier unlocked given how many bosses the player has beaten (spec §7 climb). */
export function tierForBosses(bossesBeaten: number): 1 | 2 | 3 {
  return bossesBeaten >= 2 ? 3 : bossesBeaten >= 1 ? 2 : 1;
}

/** Bearing (deg, 0 = north) of a placed device's hex around the centre. */
function bearingOfHex(d: PlacedDevice): number {
  const p = hexToPlane(d.hex);
  if (planeLen(p) < 1e-6) return 0;
  const deg = (Math.atan2(p.x, -p.y) * 180) / Math.PI; // 0 = north, CW
  return (deg + 360) % 360;
}

/**
 * Build a boss DeviceUnit from a placed device, carrying its REAL catalog stats
 * (matchup/track tables, range, upgrades) so the boss fields every device the
 * player built — tier-2/3 gear and upgrades included. Range/distance are in
 * abstract km (plane units / RANGE_SCALE) to match the threat distances.
 */
function unitFromPlaced(p: PlacedDevice, id: string): DeviceUnit {
  const pl = placeableById(p.placeableId)!;
  const st = deviceStats(pl, p.level);
  return {
    id,
    typeId: p.placeableId,
    kind: pl.kind,
    name: pl.name,
    code: pl.code,
    role: pl.role,
    range: st.radius / RANGE_SCALE,
    bearing: bearingOfHex(p),
    distance: planeLen(hexToPlane(p.hex)) / RANGE_SCALE,
    effect: pl.kind === "effector" ? st.effect : undefined,
    track: pl.kind === "sensor" ? st.track : undefined,
  };
}

/**
 * Build a boss encounter from the player's placed layout (spec §14 Phase 2).
 * The threats and tolerance come from the Phase-1 boss config; the sensors and
 * effectors are EVERY device the player actually placed (with their real stats,
 * so a laser or plasma cannon fights the boss just as it does the waves). If the
 * player somehow has none of a kind, fall back to the canned roster so the fight
 * is still playable.
 */
export function bossConfigFromLayout(placed: PlacedDevice[], bossIndex: 1 | 2): BossConfig {
  const base = bossIndex === 1 ? BOSS_1 : BOSS_2;

  const sensors: DeviceUnit[] = placed
    .filter((p) => p.kind === "sensor")
    .map((p, i) => unitFromPlaced(p, `s-${i}`));
  const effectors: DeviceUnit[] = placed
    .filter((p) => p.kind === "effector")
    .map((p, i) => unitFromPlaced(p, `e-${i}`));

  return {
    ...base,
    sensors: sensors.length ? sensors : base.sensors,
    effectors: effectors.length ? effectors : base.effectors,
  };
}
