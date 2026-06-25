/**
 * Top-level application state & phase machine (spec §2 emotional arc, §5 loop).
 *
 * Phase 0/1 built the boss minigame; Phase 2 wraps it in the real-time tower-
 * defense loop on the centred hex field:
 *   title → build → wave → build → … → boss(off) → unlock → … → boss(on) →
 *   … → summary (score), or summary early if the asset falls.
 *
 * The single authoritative state object; renderer + DOM read it, the
 * controller mutates it. No Pixi here.
 */
import { hexToPlane, type Hex } from "./hex.ts";
import type { AssignmentMap, BossConfig, EncounterResult } from "./boss/types.ts";
import type { LevelDef } from "./level.ts";
import { placeableById } from "./realtime/catalog.ts";
import type { PlacedDevice, RealtimeState, WaveDef } from "./realtime/types.ts";

export type AppPhase =
  | "title"
  | "build" // between-waves placement (spec §13: between-waves only)
  | "wave" // a real-time auto-defense wave is running
  | "boss" // an active assignment minigame (brain flag decides off/on)
  | "unlock" // the brain unlock beat between boss 1 and boss 2
  | "summary"; // run over — final score

export interface BossSession {
  cfg: BossConfig;
  brain: boolean;
  map: AssignmentMap;
  optimal: AssignmentMap | null;
  result: EncounterResult | null;
  selectedThreatId: string | null;
}

export interface GameState {
  phase: AppPhase;
  level: LevelDef;
  /** Sim time in seconds (fixed-timestep accumulator output). */
  time: number;

  // Layout & economy (spec §8).
  placed: PlacedDevice[];
  nextDeviceId: number;
  currency: number;
  score: number;
  integrity: number;
  maxIntegrity: number;

  // Schedule / waves.
  scheduleIndex: number;
  rt: RealtimeState | null;
  activeWave: WaveDef | null;
  /** Build palette selection (placeable id) or null. */
  selectedPlaceable: string | null;

  // Brain.
  brainUnlocked: boolean;
  brainStaffDisabled: boolean;
  boss: BossSession | null;

  // Run outcome.
  victory: boolean;
  log: { boss1?: EncounterResult; boss2?: EncounterResult };
}

let deviceSeq = 0;

export function makePlaced(placeableId: string, hex: Hex): PlacedDevice {
  const p = placeableById(placeableId)!;
  return {
    id: `dev-${deviceSeq++}`,
    kind: p.kind,
    placeableId,
    hex,
    pos: hexToPlane(hex),
    radius: p.radius,
    cooldown: 0,
  };
}

export function createInitialState(level: LevelDef): GameState {
  // Spec §8: the player starts poor — one basic radar + one basic net-drone.
  const placed: PlacedDevice[] = [
    makePlaced("radar", { q: 0, r: -1 }),
    makePlaced("net-drone", { q: 0, r: 1 }),
  ];
  return {
    phase: "title",
    level,
    time: 0,
    placed,
    nextDeviceId: placed.length,
    currency: 120,
    score: 0,
    integrity: 100,
    maxIntegrity: 100,
    scheduleIndex: 0,
    rt: null,
    activeWave: null,
    selectedPlaceable: null,
    brainUnlocked: false,
    brainStaffDisabled: false,
    boss: null,
    victory: false,
    log: {},
  };
}
