/**
 * Leaderboard rules (spec §10) — pure, shared by the server, the client, and
 * the localStorage fallback so validation can't drift between them.
 *
 * Responsibilities: the data shapes, handle/affiliation sanitization, the
 * affiliation list, and the server-side plausibility cap (max achievable score
 * for a level) used to reject junk. No I/O, no rendering.
 */
import { getLevel } from "../sim/level.ts";
import { DRONE_SPECS, TRACKED_KILL_BONUS } from "../sim/realtime/catalog.ts";

export type BoardKind = "alltime" | "today";

/** Run summary submitted with a score — also feeds the takeaway artifact. */
export interface RunStats {
  levelId: string;
  score: number;
  wavesSurvived: number;
  kills: number;
  leaked: number;
  spent: number;
  integrity: number;
  victory: boolean;
  boss1Stopped: number;
  boss2Stopped: number;
}

export interface Submission {
  handle: string;
  affiliation: string;
  stats: RunStats;
}

export interface ScoreEntry {
  id: string;
  handle: string;
  affiliation: string;
  levelId: string;
  score: number;
  wavesSurvived: number;
  /** Epoch ms. */
  ts: number;
}

/** Affiliation dropdown options (spec §10 — lead intelligence + social). */
export const AFFILIATIONS: string[] = [
  "US Army",
  "US Navy",
  "US Air Force",
  "US Marine Corps",
  "US Space Force",
  "US Coast Guard",
  "National Guard",
  "DoD / Civilian",
  "Law Enforcement",
  "Allied / Coalition",
  "Industry / Vendor",
  "Independent",
];

const MAX_HANDLE = 16;
const MAX_AFFIL = 28;

// A tiny, deliberately mild blocklist — a public booth screen needs *some*
// guard. Substrings are masked, not rejected, so play is never blocked.
const BLOCKLIST = ["fuck", "shit", "cunt", "bitch", "nigger", "faggot", "rape", "nazi"];

/** Clean a free-text handle for a public display: safe charset, length cap, mask slurs. */
export function sanitizeHandle(raw: string): string {
  let s = (raw ?? "").normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, "");
  // Allow letters, numbers, space and a few separators; drop the rest.
  s = s.replace(/[^\p{L}\p{N} _.\-]/gu, "");
  s = s.replace(/\s+/g, " ").trim().slice(0, MAX_HANDLE);
  const lower = s.toLowerCase();
  for (const bad of BLOCKLIST) {
    if (lower.includes(bad)) {
      const re = new RegExp(bad, "ig");
      s = s.replace(re, "*".repeat(bad.length));
    }
  }
  return s || "ANON";
}

/** Clean an affiliation (dropdown value or free text). */
export function sanitizeAffiliation(raw: string): string {
  const s = (raw ?? "").normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_AFFIL);
  return s || "Independent";
}

/**
 * Theoretical maximum score for a level's run (every drone a tracked kill,
 * every stipend earned, both bosses cleared 4/4). The per-level anti-abuse cap.
 * Mirrors the scoring in the controller: bounty×TRACKED on kills (with the
 * spawn's bounty modifier), stipend×0.4 per wave, 120 per boss-threat stopped.
 */
export function maxPlausibleScore(levelId: string): number {
  let max = 0;
  for (const entry of getLevel(levelId).schedule) {
    if (entry.type === "wave") {
      for (const s of entry.wave.spawns) {
        max += DRONE_SPECS[s.typeId].bounty * (s.mods?.bountyMul ?? 1) * TRACKED_KILL_BONUS;
      }
      max += entry.wave.stipend * 0.4;
    } else {
      max += 4 * 120; // a perfect 4/4 boss
    }
  }
  return Math.ceil(max * 1.08); // small margin for rounding
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  /** A cleaned, safe-to-store entry (id/ts filled by the caller) when ok. */
  clean?: Omit<ScoreEntry, "id" | "ts">;
}

/** Server-side validation: shape, ranges, and the plausibility cap (spec §10). */
export function validateSubmission(sub: Submission): ValidationResult {
  if (!sub || typeof sub !== "object") return { ok: false, reason: "malformed" };
  const stats = sub.stats;
  if (!stats || typeof stats.score !== "number" || !Number.isFinite(stats.score)) {
    return { ok: false, reason: "bad score" };
  }
  const levelId = typeof stats.levelId === "string" ? stats.levelId.slice(0, 40) : "mil-facility";
  const level = getLevel(levelId);
  const score = Math.floor(stats.score);
  if (score < 0) return { ok: false, reason: "negative score" };
  if (score > maxPlausibleScore(levelId)) return { ok: false, reason: "implausible score" };
  if (typeof stats.wavesSurvived !== "number" || stats.wavesSurvived < 0 || stats.wavesSurvived > level.schedule.length) {
    return { ok: false, reason: "bad waves" };
  }
  return {
    ok: true,
    clean: {
      handle: sanitizeHandle(sub.handle),
      affiliation: sanitizeAffiliation(sub.affiliation),
      levelId,
      score,
      wavesSurvived: Math.floor(stats.wavesSurvived),
    },
  };
}

/** Start-of-today epoch ms (used to split the "today" board). */
export function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Rank entries for a board (desc score, earlier ts wins ties), top N. */
export function rankBoard(entries: ScoreEntry[], levelId: string, board: BoardKind, now: number, limit = 20): ScoreEntry[] {
  const dayStart = startOfDay(now);
  return entries
    .filter((e) => e.levelId === levelId && (board === "alltime" || e.ts >= dayStart))
    .sort((a, b) => b.score - a.score || a.ts - b.ts)
    .slice(0, limit);
}
