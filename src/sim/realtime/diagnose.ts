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

/** What "target nearest" actually shoots: for each effector, the tracked drone
 *  physically closest to IT (matchup-blind, in range + LOS) — the real, verifiable
 *  choice the uncoordinated grid makes this step. */
function nearestTargets(effectors: PlacedDevice[], drones: Drone[], terrain: TerrainMap): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of effectors) {
    let best = -1;
    let bd = Infinity;
    for (const d of drones) {
      if (d.state !== "alive" || !d.tracked) continue;
      const dist = planeDist(e.pos, d.pos);
      if (dist <= e.radius && dist < bd && losClear(e.pos, d.pos, terrain, true)) { bd = dist; best = d.id; }
    }
    if (best >= 0) out.set(e.id, best);
  }
  return out;
}

/** Track label for a drone id (e.g. "TRK 0142"), for referencing one card in another. */
function trk(id: number, drones: Drone[]): string {
  const d = drones.find((x) => x.id === id);
  return `TRK ${String(d?.trackId ?? id).padStart(4, "0")}`;
}

/** Why an UNTRACKED drone has no fire-control track (verified from sensor coverage). */
function untrackedFail(d: Drone, sensors: PlacedDevice[], terrain: TerrainMap): { tag: string; detail: string } {
  const capable = capableSensors(d, sensors, terrain);
  const blind = blindSensors(d, sensors, terrain);
  if (capable.length === 0 && blind.length > 0) {
    if (d.typeId === "autonomy") {
      return { tag: "WRONG EYES", detail: `The only sensor on it here is the ${devName(blind[0].placeableId)} — and an autonomy drone emits no radio to find, so to that sensor it's empty sky. Only a radar can see it; none is looking here. No track, no shot.` };
    }
    return { tag: "WRONG EYES", detail: `The sensor covering it (${devName(blind[0].placeableId)}) can't classify a ${d.typeId} — wrong eyes for the type, so it stays an unclassified blip no effector can engage.` };
  }
  if (d.typeId === "low-observable") {
    return { tag: "OFF THE PICTURE", detail: "A low-observable returns almost nothing on radar; only the RF-DF holds it — and with its capacity full it was dropped. Nothing re-acquired it, so no effector has a firing solution." };
  }
  return { tag: "OFF THE PICTURE", detail: "A sensor here filled its track capacity on nearer contacts and dropped this one — and, with no coordinator to re-task, it was never re-acquired. An effector can't fire on what isn't tracked." };
}

/**
 * Coordinated: how the plan handles this threat. At the coordinated freeze the
 * push is caught at its peak (still out near the edge), so this is the plan's
 * INTENT — targeting by urgency + matchup rather than by proximity — which then
 * clears the whole wave (verified 0 leaks).
 */
function coordFix(d: Drone, hasShooter: boolean): { tag: string; detail: string } {
  const netLine =
    d.typeId === "autonomy"
      ? " It's an autonomy drone, so the plan reserves a NET for it — never the jammer that can't touch it."
      : d.typeId === "low-observable"
      ? " The RF-DF holds this faint one in the shared picture, and a matching effector is reserved."
      : "";
  if (d.tracked && hasShooter) {
    return { tag: "ASSIGNED", detail: `Assigned to the effector that beats it, held there until it's down — urgent-first, right tool.${netLine}` };
  }
  return { tag: "PRIORITISED", detail: `In the plan. It's targeted by URGENCY and matchup, not by whatever's nearest a weapon — so as it leads the push it gets the right effector, not a pass-over.${netLine}` };
}

/**
 * Diagnose the drones in the crunch, front-to-back (pin #1 = nearest the asset).
 * Every uncoordinated card states only what is VERIFIABLY true of the live sim
 * this step — computed from each effector's actual "target nearest" choice and
 * each drone's real coverage:
 *   • PASSED OVER — an effector that could kill it has it in range, but it's
 *     firing on the contact physically nearer to itself (named), so this one —
 *     closer to the ASSET — is skipped. The core "nearest, not most-urgent" fault.
 *   • WASTED SHOT — a jammer is firing on it but can't kill the type; no net is on it.
 *   • NO WEAPON HERE — only an effector that can't beat the type is in range.
 *   • OFF THE PICTURE / WRONG EYES — untracked (verified from sensor coverage).
 *   • DOG-PILED — two effectors verified firing on the same drone (redundant).
 * Drones actually being killed this step are omitted (they aren't leaking).
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
    .sort((a, b) => planeLen(a.pos) - planeLen(b.pos));

  const firing = coordinated ? null : nearestTargets(effectors, rt.drones, terrain);

  const out: DrillDiag[] = [];
  for (const d of cluster) {
    if (out.length >= MAX_DIAG) break;
    const t = THREAT_TYPES[d.typeId];
    const base = {
      droneId: d.id,
      trackId: d.trackId,
      icon: t?.icon ?? "✚",
      code: t?.code ?? d.typeId,
      bearingDeg: bearingOf(d),
    };

    if (coordinated) {
      out.push({ ...base, tone: "good", ...coordFix(d, readyShooters(d, effectors, terrain).length > 0) });
      continue;
    }

    // ---- uncoordinated: only verified-true claims ----
    if (!d.tracked) {
      out.push({ ...base, tone: "bad", ...untrackedFail(d, sensors, terrain) });
      continue;
    }
    const inRange = inRangeShooters(d, effectors, terrain);
    const killersInRange = inRange.filter((e) => e.effect[d.typeId] > 0);
    const firingOnD = inRange.filter((e) => firing!.get(e.id) === d.id);
    const killersOnD = firingOnD.filter((e) => e.effect[d.typeId] > 0);

    if (killersOnD.length >= 2) {
      // Verified redundancy: two capable effectors on the same drone.
      out.push({ ...base, tag: "DOG-PILED", tone: "warn", detail: `${killersOnD.map((e) => devName(e.placeableId)).join(" and ")} are BOTH firing on this one — redundant overkill — so a contact only one of them could reach goes unengaged.` });
      continue;
    }
    if (killersOnD.length === 1) continue; // being killed this step — not a leaker

    // Tracked, not being effectively engaged. Why?
    if (killersInRange.length >= 1) {
      // An effector that COULD kill it is in range but firing on a nearer contact.
      const e = killersInRange.reduce((a, b) => (planeDist(a.pos, d.pos) <= planeDist(b.pos, d.pos) ? a : b));
      const tgt = firing!.get(e.id);
      const onName = devName(e.placeableId);
      const autoNote = d.typeId === "autonomy" ? ` And only a net can kill an autonomy drone — the jammer can't — so a pass-over here is a clean leak.` : "";
      const because =
        tgt != null && tgt !== d.id
          ? `the ${onName} is point-blank on ${trk(tgt, rt.drones)} right on top of it`
          : `the ${onName} is servicing the contact nearest itself`;
      out.push({ ...base, tag: "PASSED OVER", tone: "bad", detail: `It's the closest threat to the asset here and in the ${onName}'s range — but on target-nearest, ${because}, so this one is skipped and walks in.${autoNote}` });
      continue;
    }
    // No capable effector in range. Is a useless one (jammer) firing on it?
    const uselessOnD = firingOnD.find((e) => e.effect[d.typeId] <= 0);
    if (uselessOnD) {
      out.push({ ...base, tag: "WASTED SHOT", tone: "bad", detail: `The ${devName(uselessOnD.placeableId)} is locked on it — its nearest contact — but does nothing to a ${d.typeId}. The shot is wasted and no net is on it.` });
      continue;
    }
    if (inRange.length >= 1) {
      out.push({ ...base, tag: "NO WEAPON HERE", tone: "bad", detail: `Only the ${devName(inRange[0].placeableId)} reaches it, and it can't beat a ${d.typeId}. No net covers this lane, so nothing can take the shot.` });
      continue;
    }
    out.push({ ...base, tag: "UNCOVERED", tone: "bad", detail: `No effector's coverage reaches this approach — it's outside every weapon's range as it comes in.` });
  }

  return out;
}
