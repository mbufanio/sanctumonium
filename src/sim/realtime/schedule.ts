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
import type { BossConfig, DeviceUnit, EffectorTypeId, SensorTypeId } from "../boss/types.ts";
import type { ThreatTypeId } from "../boss/types.ts";
import type { PlacedDevice, SpawnEntry, WaveDef } from "./types.ts";

interface Composition {
  typeId: ThreatTypeId;
  count: number;
}

/** Build a normal wave: spread spawns over time and around all 360°. */
function makeWave(index: number, comps: Composition[], stipend: number): WaveDef {
  const spawns: SpawnEntry[] = [];
  let n = 0;
  const total = comps.reduce((a, c) => a + c.count, 0);
  const gap = 0.8; // seconds between spawns
  for (const c of comps) {
    for (let i = 0; i < c.count; i++) {
      // Even spread around the circle, offset per wave so it isn't static.
      const bearing = (360 / total) * n + index * 47;
      spawns.push({ at: 0.6 + n * gap, typeId: c.typeId, bearing: bearing % 360 });
      n++;
    }
  }
  return { index, kind: "normal", label: `Wave ${index}`, spawns, stipend };
}

/** One schedule entry: a real-time wave or a boss fight on the built layout. */
export type ScheduleEntry =
  | { type: "wave"; wave: WaveDef }
  | { type: "boss"; bossIndex: 1 | 2 };

/**
 * The Phase-2 run schedule. ~5 normal waves + 2 bosses. Difficulty and the
 * threat mix climb; the autonomy drone (jammer-immune) and the low-observable
 * (radar-shy) show up after boss #1 so the player feels their coverage gaps.
 */
export const SCHEDULE: ScheduleEntry[] = [
  { type: "wave", wave: makeWave(1, [{ typeId: "rf-quad", count: 4 }], 70) },
  { type: "wave", wave: makeWave(2, [{ typeId: "rf-quad", count: 5 }, { typeId: "low-observable", count: 1 }], 90) },
  { type: "boss", bossIndex: 1 },
  { type: "wave", wave: makeWave(3, [{ typeId: "rf-quad", count: 4 }, { typeId: "autonomy", count: 2 }], 110) },
  { type: "wave", wave: makeWave(4, [{ typeId: "rf-quad", count: 5 }, { typeId: "autonomy", count: 2 }, { typeId: "low-observable", count: 2 }], 130) },
  { type: "boss", bossIndex: 2 },
  { type: "wave", wave: makeWave(5, [{ typeId: "rf-quad", count: 6 }, { typeId: "autonomy", count: 3 }, { typeId: "low-observable", count: 3 }], 160) },
];

/** Bearing (deg, 0 = north) of a placed device's hex around the centre. */
function bearingOfHex(d: PlacedDevice): number {
  const p = hexToPlane(d.hex);
  if (planeLen(p) < 1e-6) return 0;
  const deg = (Math.atan2(p.x, -p.y) * 180) / Math.PI; // 0 = north, CW
  return (deg + 360) % 360;
}

/**
 * Build a boss encounter from the player's placed layout (spec §14 Phase 2).
 * The threats and tolerance come from the Phase-1 boss config; the sensors and
 * effectors are the player's actual placements (capped for readability). If the
 * player somehow has none of a kind, fall back to the canned roster so the
 * fight is still playable.
 */
export function bossConfigFromLayout(placed: PlacedDevice[], bossIndex: 1 | 2): BossConfig {
  const base = bossIndex === 1 ? BOSS_1 : BOSS_2;

  const sensors: DeviceUnit[] = placed
    .filter((p) => p.kind === "sensor")
    .slice(0, 6)
    .map((p, i) => ({ id: `s-${i}`, typeId: p.placeableId as SensorTypeId, bearing: bearingOfHex(p) }));

  const effectors: DeviceUnit[] = placed
    .filter((p) => p.kind === "effector")
    .slice(0, 6)
    .map((p, i) => ({ id: `e-${i}`, typeId: p.placeableId as EffectorTypeId, bearing: bearingOfHex(p) }));

  return {
    ...base,
    sensors: sensors.length ? sensors : base.sensors,
    effectors: effectors.length ? effectors : base.effectors,
  };
}
