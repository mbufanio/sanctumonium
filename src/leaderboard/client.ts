/**
 * Leaderboard client (spec §10). Talks to the hosted API at VITE_API_BASE; if
 * that's unset (or unreachable), it falls back to a localStorage board so the
 * static demo still works end-to-end. The fallback is per-device and clearly
 * NOT the production board — the real booth points every kiosk at one backend.
 */
import {
  rankBoard,
  validateSubmission,
  type BoardKind,
  type ScoreEntry,
  type Submission,
} from "./rules.ts";

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");

/** True when a real backend is configured (vs the local demo fallback). */
export const usingBackend = API_BASE.length > 0;

export interface SubmitResult {
  ok: boolean;
  id?: string;
  rank?: number;
  total?: number;
  reason?: string;
}

export async function submitScore(sub: Submission): Promise<SubmitResult> {
  if (API_BASE) {
    try {
      const res = await fetch(`${API_BASE}/api/scores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      return (await res.json()) as SubmitResult;
    } catch {
      // Backend unreachable — keep the booth flowing on the local fallback.
    }
  }
  return localSubmit(sub);
}

export async function fetchBoard(levelId: string, board: BoardKind): Promise<ScoreEntry[]> {
  if (API_BASE) {
    try {
      const res = await fetch(`${API_BASE}/api/leaderboard?level=${encodeURIComponent(levelId)}&board=${board}`);
      const j = (await res.json()) as { entries?: ScoreEntry[] };
      return j.entries ?? [];
    } catch {
      // fall through to local
    }
  }
  return localBoard(levelId, board);
}

// ---- localStorage fallback ----------------------------------------------

const LS_KEY = "cuas_leaderboard_v1";

function loadLocal(): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as ScoreEntry[]) : [];
  } catch {
    return [];
  }
}

function saveLocal(entries: ScoreEntry[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(entries));
  } catch {
    /* ignore quota errors */
  }
}

function uuid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function localSubmit(sub: Submission): SubmitResult {
  const v = validateSubmission(sub);
  if (!v.ok || !v.clean) return { ok: false, reason: v.reason };
  seedLocalIfEmpty(v.clean.levelId); // give the demo board some competitors
  const entry: ScoreEntry = { ...v.clean, id: uuid(), ts: Date.now() };
  const all = loadLocal();
  all.push(entry);
  saveLocal(all);
  const board = rankBoard(all, entry.levelId, "alltime", Date.now(), 10000);
  return { ok: true, id: entry.id, rank: board.findIndex((e) => e.id === entry.id) + 1, total: board.length };
}

function localBoard(levelId: string, board: BoardKind): ScoreEntry[] {
  seedLocalIfEmpty(levelId);
  return rankBoard(loadLocal(), levelId, board, Date.now());
}

/** Seed a few plausible entries so the demo board isn't empty on first run. */
function seedLocalIfEmpty(levelId: string): void {
  const all = loadLocal();
  if (all.some((e) => e.levelId === levelId)) return;
  const now = Date.now();
  const seed: Array<[string, string, number, number, number]> = [
    ["REYES", "US Army", 4200, 9, 0.2 * 86400000],
    ["VANCE", "US Air Force", 3850, 9, 1.1 * 86400000],
    ["KOWALSKI", "US Marine Corps", 3510, 8, 0.5 * 86400000],
    ["NOVA", "Industry / Vendor", 3120, 8, 2.4 * 86400000],
    ["TERRA", "Allied / Coalition", 2780, 7, 0.05 * 86400000],
  ];
  for (const [handle, affiliation, score, wavesSurvived, ago] of seed) {
    all.push({ id: uuid(), handle, affiliation, levelId, score, wavesSurvived, ts: now - ago });
  }
  saveLocal(all);
}
