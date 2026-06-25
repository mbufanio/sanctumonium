/**
 * Leaderboard API server (spec §10) — the persistent, cross-kiosk backend.
 *
 * A dependency-free Node HTTP server. All kiosks point their VITE_API_BASE at
 * one instance, so the board is shared and persists across show days. Endpoints:
 *
 *   GET  /api/health                              → { ok }
 *   GET  /api/leaderboard?level=&board=alltime|today  → ScoreEntry[]
 *   POST /api/scores   { handle, affiliation, stats }  → { ok, id, rank }
 *
 * Server-side anti-abuse: validates + sanitizes every submission (shared rules),
 * enforces the plausibility cap, and rate-limits per IP. Run with:
 *   node --experimental-strip-types server/index.ts
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { Store } from "./store.ts";
import {
  rankBoard,
  validateSubmission,
  type BoardKind,
  type ScoreEntry,
  type Submission,
} from "../src/leaderboard/rules.ts";

const PORT = Number(process.env.PORT ?? 8787);
const DATA_PATH = process.env.DATA_PATH ?? "server/data/scores.json";
const store = new Store(DATA_PATH);

// ---- per-IP rate limit ---------------------------------------------------
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 8;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > RATE_MAX;
}

function cors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res: ServerResponse, code: number, body: unknown): void {
  cors(res);
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

function readBody(req: IncomingMessage, limit = 8192): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > limit) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    return json(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/leaderboard") {
    const level = url.searchParams.get("level") ?? "mil-facility";
    const board = (url.searchParams.get("board") as BoardKind) === "today" ? "today" : "alltime";
    return json(res, 200, { ok: true, board, level, entries: rankBoard(store.all(), level, board, Date.now()) });
  }

  if (req.method === "POST" && url.pathname === "/api/scores") {
    const ip = clientIp(req);
    if (rateLimited(ip)) return json(res, 429, { ok: false, reason: "rate limited" });
    let sub: Submission;
    try {
      sub = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { ok: false, reason: "bad json" });
    }
    const result = validateSubmission(sub);
    if (!result.ok || !result.clean) return json(res, 400, { ok: false, reason: result.reason });

    const entry: ScoreEntry = { ...result.clean, id: randomUUID(), ts: Date.now() };
    store.add(entry);
    const board = rankBoard(store.all(), entry.levelId, "alltime", Date.now(), 10000);
    const rank = board.findIndex((e) => e.id === entry.id) + 1;
    return json(res, 200, { ok: true, id: entry.id, rank, total: board.length });
  }

  json(res, 404, { ok: false, reason: "not found" });
});

// Flush on shutdown so no scores are lost.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    store.flush();
    process.exit(0);
  });
}

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Leaderboard API listening on :${PORT} (data: ${DATA_PATH})`);
});
