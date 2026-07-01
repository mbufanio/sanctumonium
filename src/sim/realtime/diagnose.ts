/**
 * Act-1 drill "freeze frame" diagnosis (the teaching pause).
 *
 * Twice per pass the controller PAUSES a drill just before the leading threats
 * reach the asset and, for each drone in the crunch, VEGA explains — in the same
 * kill-chain terms the rest of the demo uses — WHY it is (or isn't) being
 * stopped. Uncoordinated: dropped tracks, mismatched or dog-piled shooters.
 * Coordinated: the same push, now each threat fused and assigned. Pure logic
 * over the live sim state; no rendering, no mutation.
 */
import { planeDist, planeLen } from "../hex.ts";
import { losClear, type TerrainMap } from "../terrain.ts";
import { THREAT_TYPES } from "../boss/data.ts";
import type { Drone, PlacedDevice, RealtimeState } from "./types.ts";

/** Plane radius of the "reckoning" ring — the front has pressed deep inside the
 *  grid (well outside the 30-unit leak radius, so the pause is always BEFORE
 *  contact). */
const RING_NEAR = 135;
/** Whole-field radius, for the coordinated fallback snapshot at the spawn peak. */
const RING_FIELD = 260;
/** How many drones must be in the crunch before we freeze. */
const MIN_CLUSTER = 3;
/** Most cards to show at once (the closest threats win the slots). */
export const MAX_DIAG = 5;

export type DiagTone = "bad" | "warn" | "good";

export interface DrillDiag {
  droneId: number;
  trackId: number;
  icon: string;
  code: string;
  bearingDeg: number;
  /** Short status tag, e.g. "OFF THE PICTURE". */
  tag: string;
  /** One-sentence VEGA explanation. */
  detail: string;
  tone: DiagTone;
}

/** Should the drill pause NOW? Uncoordinated fires as the front presses in;
 *  coordinated also accepts the spawn-complete peak so the "all handled"
 *  snapshot lands even though nothing ever leaks. */
export function drillFreezeReady(rt: RealtimeState, coordinated: boolean, spawnsExhausted: boolean): boolean {
  let near = 0;
  let field = 0;
  for (const d of rt.drones) {
    if (d.state !== "alive") continue;
    const r = planeLen(d.pos);
    if (r <= RING_NEAR) near++;
    if (r <= RING_FIELD) field++;
  }
  // Uncoordinated primary: freeze the moment the front has pressed in — the crunch
  // where the failure is legible (one dog-piled, the rest leaking untouched).
  if (near >= MIN_CLUSTER) return true;
  // Coordinated clears too fast to ever bunch up at the front, so freeze at the
  // full-push peak (all spawned, most still up) — the "whole push, every one
  // already accounted for" snapshot that answers the uncoordinated pass.
  if (coordinated && spawnsExhausted && field >= MIN_CLUSTER) return true;
  // Tail safety so a pass ALWAYS pauses once: grab the last survivors.
  if (spawnsExhausted && field >= 1 && field <= 3) return true;
  return false;
}

/** Sensors that could CLASSIFY this drone right now (capable type, in range + LOS
 *  — ignoring finite capacity, which is the very thing that fails uncoordinated). */
function capableSensors(d: Drone, sensors: PlacedDevice[], terrain: TerrainMap): PlacedDevice[] {
  return sensors.filter(
    (s) => s.track[d.typeId] > 0 && planeDist(s.pos, d.pos) <= s.radius && losClear(s.pos, d.pos, terrain, false),
  );
}

/** Effectors that could KILL this drone if it were tracked (right matchup, in
 *  range + a clear firing line). */
function readyShooters(d: Drone, effectors: PlacedDevice[], terrain: TerrainMap): PlacedDevice[] {
  return effectors.filter(
    (e) => e.effect[d.typeId] > 0 && planeDist(e.pos, d.pos) <= e.radius && losClear(e.pos, d.pos, terrain, true),
  );
}

/** Compass bearing (0° = north/up) of a drone's position, for the card label. */
function bearingOf(d: Drone): number {
  return Math.round((Math.atan2(d.pos.y, d.pos.x) * 180) / Math.PI + 90 + 360) % 360;
}

/**
 * Diagnose the drones in the crunch, front-to-back (pin #1 = nearest the asset).
 * Uncoordinated names each failure; coordinated names each fix.
 *
 * The signature uncoordinated failure with this grid isn't dropped tracks (the
 * push is smaller than total capacity) — it's fire DISCIPLINE: with no plan,
 * every shooter locks the single most-central threat and overkills it while the
 * rest walk past untouched. So we single out that dog-pile MAGNET and mark the
 * others as starved of a shooter — the real, legible lesson.
 */
export function diagnoseDrill(
  rt: RealtimeState,
  placed: PlacedDevice[],
  coordinated: boolean,
  terrain: TerrainMap,
): DrillDiag[] {
  const sensors = placed.filter((p) => p.kind === "sensor");
  const effectors = placed.filter((p) => p.kind === "effector");
  const cluster = rt.drones
    .filter((d) => d.state === "alive" && planeLen(d.pos) <= RING_FIELD)
    .sort((a, b) => planeLen(a.pos) - planeLen(b.pos))
    .slice(0, MAX_DIAG);

  // The magnet every uncoordinated shooter piles onto: the most-central TRACKED
  // drone that at least one ready shooter covers (they all make the same call).
  const magnet = coordinated
    ? null
    : cluster.find((d) => d.tracked && readyShooters(d, effectors, terrain).length > 0) ?? null;

  const out: DrillDiag[] = [];
  for (const d of cluster) {
    const t = THREAT_TYPES[d.typeId];
    const base = {
      droneId: d.id,
      trackId: d.trackId,
      icon: t?.icon ?? "✚",
      code: t?.code ?? d.typeId,
      bearingDeg: bearingOf(d),
    };
    const shooters = readyShooters(d, effectors, terrain);

    if (coordinated) {
      if (d.tracked && shooters.length) {
        out.push({ ...base, tag: "ASSIGNED", tone: "good", detail: "Fused track from every capable radar, and a shooter that beats it is already assigned — it's down well before it's close." });
      } else if (d.tracked) {
        out.push({ ...base, tag: "TRACKED", tone: "good", detail: "Locked in the one shared picture; the fire plan hands it a shooter the instant it's in range." });
      } else {
        out.push({ ...base, tag: "IN THE NET", tone: "good", detail: "Capacity is pooled, so — unlike the solo grid that dropped its overflow — this one is held, not lost. It gets a shooter as it closes. No seam." });
      }
      continue;
    }

    // Uncoordinated: name why it's leaking.
    if (!d.tracked) {
      const seen = capableSensors(d, sensors, terrain).length > 0;
      out.push({
        ...base,
        tag: "OFF THE PICTURE",
        tone: "bad",
        detail: seen
          ? "Every radar redundantly locked the leaders and filled its track capacity — this one was dropped and, with nobody re-tasking, never re-acquired. A shooter can't fire on what isn't tracked."
          : "No sensor has a track on it — just a raw blip. Without a fire-control track, no shooter can take the shot.",
      });
    } else if (shooters.length === 0) {
      out.push({ ...base, tag: "MISMATCH", tone: "bad", detail: "It's tracked, but no shooter in range carries a weapon that defeats this type — the wrong tool for this bird." });
    } else if (d.id === magnet?.id) {
      out.push({ ...base, tag: "DOG-PILED", tone: "warn", detail: "Every shooter locked the same target — the closest one — and they're overkilling it in lockstep, emptying their magazines together. Meanwhile the rest of the push walks in behind it." });
    } else {
      out.push({ ...base, tag: "NO SHOOTER FREE", tone: "bad", detail: "Tracked and inside a shooter's range — but every effector is fixed on the drone ahead, so nothing is engaging this one. It leaks untouched." });
    }
  }

  return out;
}
