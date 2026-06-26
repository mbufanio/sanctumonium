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
import { deviceStats, placeableById, type Tier } from "./realtime/catalog.ts";
import type { PlacedDevice, RealtimeState, WaveDef } from "./realtime/types.ts";

export type AppPhase =
  | "title"
  | "build" // between-waves placement (spec §13: between-waves only)
  | "wave" // a real-time auto-defense wave is running
  | "boss" // an active assignment minigame (brain flag decides off/on)
  | "unlock" // the brain unlock beat between boss 1 and boss 2
  | "actbreak" // "Future Systems Online" beat after boss 2 — into the arcade act
  | "summary"; // run over — final score

/**
 * The run is two acts (spec intent): "ops" is the realistic value-prop phase
 * (grounded + near-future gear, build between waves only) where coordination is
 * the hero; "arcade" is the post-Boss-#2 fictional payoff (tier-3 weapons,
 * build on the fly, pure shoot-em-up). The act break is the transition.
 */
export type Act = "ops" | "arcade";

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
  /** Which act we're in — gates the fictional gear and mid-wave building. */
  act: Act;
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

  // Run tallies (for scoring, the takeaway artifact, and plausibility).
  kills: number;
  leaked: number;
  wavesSurvived: number;
  spent: number;

  /** Highest device tier currently unlocked in the palette (spec §7 climb). */
  maxTier: Tier;
  /** Bosses beaten this run (drives the tech-tier unlocks). */
  bossesBeaten: number;

  // Schedule / waves.
  scheduleIndex: number;
  rt: RealtimeState | null;
  activeWave: WaveDef | null;
  /** Build palette selection (placeable id) or null. */
  selectedPlaceable: string | null;
  /** A placed device currently selected for upgrade/sell, or null. */
  selectedDeviceId: string | null;

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
  const s = deviceStats(p, 0);
  return {
    id: `dev-${deviceSeq++}`,
    kind: p.kind,
    placeableId,
    hex,
    pos: hexToPlane(hex),
    level: 0,
    radius: s.radius,
    fireInterval: s.fireInterval,
    aoe: s.aoe,
    effect: s.effect,
    track: s.track,
    cooldown: 0,
  };
}

/** Apply the next within-class upgrade to a placed device (recomputes stats). */
export function upgradeDevice(dev: PlacedDevice): void {
  const p = placeableById(dev.placeableId);
  if (!p || dev.level >= p.upgrades.length) return;
  dev.level += 1;
  const s = deviceStats(p, dev.level);
  dev.radius = s.radius;
  dev.fireInterval = s.fireInterval;
  dev.aoe = s.aoe;
  dev.effect = s.effect;
  dev.track = s.track;
}

export function createInitialState(level: LevelDef): GameState {
  // Spec §8: the player starts poor — one basic radar + one basic net-drone.
  const placed: PlacedDevice[] = [
    makePlaced("radar", { q: 0, r: -1 }),
    makePlaced("net-drone", { q: 0, r: 1 }),
  ];
  return {
    phase: "title",
    act: "ops",
    level,
    time: 0,
    placed,
    nextDeviceId: placed.length,
    currency: level.startBudget,
    score: 0,
    integrity: level.integrity,
    maxIntegrity: level.integrity,
    kills: 0,
    leaked: 0,
    wavesSurvived: 0,
    spent: 0,
    maxTier: 1,
    bossesBeaten: 0,
    scheduleIndex: 0,
    rt: null,
    activeWave: null,
    selectedPlaceable: null,
    selectedDeviceId: null,
    brainUnlocked: false,
    brainStaffDisabled: false,
    boss: null,
    victory: false,
    log: {},
  };
}
