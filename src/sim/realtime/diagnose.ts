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

/** Effectors in range + LOS regardless of matchup — including ones whose weapon
 *  does nothing to this type (a jammer on an autonomy drone). */
function inRangeShooters(d: Drone, effectors: PlacedDevice[], terrain: TerrainMap): PlacedDevice[] {
  return effectors.filter((e) => planeDist(e.pos, d.pos) <= e.radius && losClear(e.pos, d.pos, terrain, true));
}

/** Sensors covering the drone (in range + LOS) that CANNOT classify its type —
 *  the "wrong eyes" case (an RF-DF staring at a silent autonomy drone). */
function blindSensors(d: Drone, sensors: PlacedDevice[], terrain: TerrainMap): PlacedDevice[] {
  return sensors.filter(
    (s) => s.track[d.typeId] <= 0 && planeDist(s.pos, d.pos) <= s.radius && losClear(s.pos, d.pos, terrain, false),
  );
}

/** Friendly short name for a placed device (for the matchup prose). */
function devName(placeableId: string): string {
  switch (placeableId) {
    case "rf-df": return "RF-DF";
    case "radar": return "radar";
    case "aesa": return "AESA";
    case "rf-jammer": return "jammer";
    case "net-drone": return "net";
    default: return placeableId;
  }
}

/** Compass bearing (0° = north/up) of a drone's position, for the card label. */
function bearingOf(d: Drone): number {
  return Math.round((Math.atan2(d.pos.y, d.pos.x) * 180) / Math.PI + 90 + 360) % 360;
}

/** Why an UNTRACKED drone has no fire-control track (matchup-specific). */
function untrackedFail(d: Drone, sensors: PlacedDevice[], terrain: TerrainMap): { tag: string; detail: string } {
  const capable = capableSensors(d, sensors, terrain);
  const blind = blindSensors(d, sensors, terrain);
  // Covered only by eyes that can't classify this type (RF-DF vs a silent drone).
  if (capable.length === 0 && blind.length > 0) {
    if (d.typeId === "autonomy") {
      return { tag: "WRONG EYES", detail: `The only sensor watching this sector is the ${devName(blind[0].placeableId)} — and an autonomy drone emits no radio to find. To it, this is empty sky. Only a radar can see it, and none is looking here.` };
    }
    return { tag: "WRONG EYES", detail: `The sensor covering this sector (${devName(blind[0].placeableId)}) can't classify a ${d.typeId} — wrong eyes for the type, so it stays an unclassified blip no shooter can engage.` };
  }
  if (d.typeId === "low-observable") {
    return { tag: "OFF THE PICTURE", detail: "Only the RF-DF can hold a contact this faint — the radars barely return on a low-observable. With the RF-DF's capacity already full, it slipped the picture and no radar can re-acquire it." };
  }
  if (d.typeId === "autonomy") {
    return { tag: "OFF THE PICTURE", detail: "The RF-DF nearest this sector is blind to an autonomy drone, so it leans entirely on the radars across the field — and they're saturated on the leaders. Dropped, and nothing re-tasks to it." };
  }
  return { tag: "OFF THE PICTURE", detail: "Every radar redundantly locked the leaders and filled its track capacity — this one was dropped and, with nobody re-tasking, never re-acquired. A shooter can't fire on what isn't tracked." };
}

/** Tracked, but the only shooter in reach carries the wrong weapon for the type. */
function wrongWeaponFail(d: Drone, effectors: PlacedDevice[], terrain: TerrainMap): { tag: string; detail: string } {
  const useless = inRangeShooters(d, effectors, terrain)[0];
  if (d.typeId === "autonomy") {
    return { tag: "WRONG WEAPON", detail: `It's tracked — but the only shooter in reach is the ${devName(useless?.placeableId ?? "rf-jammer")}, and severing a radio link does nothing to an autonomy drone. It needs a net, and none is in position.` };
  }
  return { tag: "WRONG WEAPON", detail: `Tracked, but the only shooter in range (${devName(useless?.placeableId ?? "")}) has no effect on a ${d.typeId}. Wrong tool; the one that beats it is out of position.` };
}

/** Tracked, a capable shooter exists but is busy — type-aware (for the autonomy,
 *  the only FREE shooter in reach is the jammer, which can't touch it). */
function noShooterDetail(d: Drone, effectors: PlacedDevice[], terrain: TerrainMap): string {
  if (d.typeId === "autonomy") {
    const jammerCovers = inRangeShooters(d, effectors, terrain).some((e) => e.effect[d.typeId] <= 0);
    return jammerCovers
      ? "A net could take it — but the nets are tied up on the crowd, and the only free shooter covering it is the jammer, which does nothing to an autonomy drone. It walks straight in."
      : "A net could take it, but every net is committed to the drones ahead. Nothing was freed for the jammer-proof bird, so it leaks.";
  }
  if (d.typeId === "low-observable") {
    return "The RF-DF has it, and a shooter is in range — but every effector is locked on the drones ahead. Nothing was freed for the faint one, and it slips in.";
  }
  return "Tracked and inside a shooter's range — but every effector is fixed on the drone ahead, so nothing is engaging this one. It leaks untouched.";
}

/** The dog-pile magnet's copy: every shooter chose the same closest threat. */
const DOG_PILE_DETAIL =
  "Every shooter locked the same target — the closest one — and they're overkilling it in lockstep, emptying their magazines together. Meanwhile the rest of the push walks in behind it.";

/** Coordinated: how the fused grid resolves this threat (matchup-specific). */
function coordFix(d: Drone, hasShooter: boolean): { tag: string; detail: string } {
  if (d.tracked && hasShooter) {
    if (d.typeId === "autonomy") {
      return { tag: "ASSIGNED", detail: "The fused picture put a radar on it — the RF-DF can't — and the plan assigned a net, never the useless jammer. Down clean." };
    }
    if (d.typeId === "low-observable") {
      return { tag: "ASSIGNED", detail: "The RF-DF — the one sensor that sees a low-observable well — holds it in the shared picture, and a shooter that beats it is already assigned." };
    }
    return { tag: "ASSIGNED", detail: "Fused track from every capable radar, and a shooter that beats it is already assigned — it's down well before it's close." };
  }
  if (d.tracked) {
    return { tag: "TRACKED", detail: "Locked in the one shared picture; the fire plan hands it a shooter the instant it's in range." };
  }
  if (d.typeId === "autonomy") {
    return { tag: "IN THE NET", detail: "Held in the pooled picture by a radar the solo grid never tasked to it. As it closes, the plan hands it a net — never the jammer that can't touch it." };
  }
  if (d.typeId === "low-observable") {
    return { tag: "IN THE NET", detail: "The RF-DF has it in the shared picture; pooled capacity means it isn't dropped the way the solo grid dropped it. A shooter's routed as it closes." };
  }
  return { tag: "IN THE NET", detail: "Capacity is pooled, so — unlike the solo grid that dropped its overflow — this one is held, not lost. It gets a shooter as it closes. No seam." };
}

/**
 * Diagnose the drones in the crunch, front-to-back (pin #1 = nearest the asset).
 * Uncoordinated names each failure; coordinated names each fix. The mixed drill
 * threat set makes the failures matchup-specific, so the prose is per type:
 *   • fire DISCIPLINE (any type): with no plan every shooter locks the closest
 *     threat and overkills it while the rest walk past (DOG-PILED / NO SHOOTER FREE).
 *   • WRONG EYES (autonomy): the RF-DF nearest the front is blind to a silent
 *     autonomy drone, so it never gets a track.
 *   • WRONG WEAPON (autonomy): tracked, but the only shooter in reach is the
 *     jammer — which does nothing to it.
 *   • DROPPED (low-observable): only the RF-DF holds a contact that faint, and
 *     when it saturates the radars can't re-acquire it.
 * Coordinated resolves each: fused eyes (a radar for the autonomy, the RF-DF for
 * the stealth body) and a fire plan that assigns the RIGHT shooter.
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
      out.push({ ...base, tone: "good", ...coordFix(d, shooters.length > 0) });
      continue;
    }

    // Uncoordinated: name why it's leaking.
    if (!d.tracked) {
      out.push({ ...base, tone: "bad", ...untrackedFail(d, sensors, terrain) });
    } else if (shooters.length === 0 && inRangeShooters(d, effectors, terrain).length > 0) {
      out.push({ ...base, tone: "bad", ...wrongWeaponFail(d, effectors, terrain) });
    } else if (d.id === magnet?.id) {
      out.push({ ...base, tag: "DOG-PILED", tone: "warn", detail: DOG_PILE_DETAIL });
    } else {
      out.push({ ...base, tag: "NO SHOOTER FREE", tone: "bad", detail: noShooterDetail(d, effectors, terrain) });
    }
  }

  return out;
}
