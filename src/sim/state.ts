/**
 * Top-level application state & phase machine (spec §2 emotional arc).
 *
 * Phase 0+1 implements the spine end-to-end at minigame scale:
 *   TITLE → BOSS1 (brain off, the wall) → UNLOCK (call for help) →
 *   BOSS2 (brain on, the catharsis) → SUMMARY.
 *
 * The single authoritative state object; the renderer and DOM overlay read
 * from it, the controller mutates it. No Pixi here.
 */
import type { AssignmentMap, BossConfig, EncounterResult } from "./boss/types.ts";
import type { LevelDef } from "./level.ts";

export type AppPhase =
  | "title"
  | "boss" // an active assignment minigame (brain flag decides off/on)
  | "unlock" // the brain unlock beat between boss 1 and boss 2
  | "summary";

export interface BossSession {
  cfg: BossConfig;
  /** Whether the coordinating brain is active for THIS session. */
  brain: boolean;
  /** Current player/brain assignment. */
  map: AssignmentMap;
  /** The brain's optimal assignment (computed once when brain is on). */
  optimal: AssignmentMap | null;
  /** Result once resolved, else null. */
  result: EncounterResult | null;
  /** Which threat the player is currently assigning, if any. */
  selectedThreatId: string | null;
}

export interface GameState {
  phase: AppPhase;
  level: LevelDef;
  /** Sim time in seconds (fixed-timestep accumulator output). */
  time: number;
  /** Has the brain been unlocked in this run (persists across boss 2+). */
  brainUnlocked: boolean;
  /** Staff sales toggle: force brain off even when unlocked (spec §6.2). */
  brainStaffDisabled: boolean;
  boss: BossSession | null;
  /** Outcome records for the end summary. */
  log: { boss1?: EncounterResult; boss2?: EncounterResult };
}

export function createInitialState(level: LevelDef): GameState {
  return {
    phase: "title",
    level,
    time: 0,
    brainUnlocked: false,
    brainStaffDisabled: false,
    boss: null,
    log: {},
  };
}
