import { describe, expect, it } from "vitest";
import {
  maxPlausibleScore,
  rankBoard,
  sanitizeHandle,
  startOfDay,
  validateSubmission,
  type ScoreEntry,
  type Submission,
} from "./rules.ts";

function sub(over: Partial<Submission["stats"]> = {}, handle = "PILOT", affiliation = "US Army"): Submission {
  return {
    handle,
    affiliation,
    stats: {
      levelId: "mil-facility",
      score: 3000,
      wavesSurvived: 7,
      kills: 100,
      leaked: 5,
      spent: 1500,
      integrity: 30,
      victory: false,
      boss1Stopped: 3,
      boss2Stopped: 4,
      ...over,
    },
  };
}

describe("handle sanitization (spec §10 — public screen)", () => {
  it("caps length and strips junk", () => {
    expect(sanitizeHandle("  Reyes!!!  ").length).toBeLessThanOrEqual(16);
    expect(sanitizeHandle("a".repeat(50)).length).toBe(16);
    expect(sanitizeHandle("<script>x</script>")).not.toContain("<");
  });
  it("falls back to ANON when empty", () => {
    expect(sanitizeHandle("   ")).toBe("ANON");
    expect(sanitizeHandle("💀💀💀")).toBe("ANON");
  });
  it("masks profanity rather than blocking", () => {
    const out = sanitizeHandle("shitlord");
    expect(out.toLowerCase()).not.toContain("shit");
    expect(out).toContain("*");
  });
});

describe("submission validation & anti-abuse", () => {
  it("accepts a plausible score and returns a cleaned entry", () => {
    const r = validateSubmission(sub());
    expect(r.ok).toBe(true);
    expect(r.clean?.score).toBe(3000);
    expect(r.clean?.handle).toBe("PILOT");
  });
  it("rejects an implausible (cheated) score", () => {
    const r = validateSubmission(sub({ score: maxPlausibleScore("mil-facility") + 1 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/implausible/);
  });
  it("rejects negative / NaN scores and impossible wave counts", () => {
    expect(validateSubmission(sub({ score: -5 })).ok).toBe(false);
    expect(validateSubmission(sub({ score: NaN })).ok).toBe(false);
    expect(validateSubmission(sub({ wavesSurvived: 999 })).ok).toBe(false);
  });
});

describe("board ranking & day split", () => {
  const now = startOfDay(Date.now()) + 5 * 3600_000; // mid-day today
  const day = 86_400_000;
  const entries: ScoreEntry[] = [
    { id: "a", handle: "A", affiliation: "x", levelId: "mil-facility", score: 100, wavesSurvived: 5, ts: now },
    { id: "b", handle: "B", affiliation: "x", levelId: "mil-facility", score: 300, wavesSurvived: 8, ts: now - 3 * day },
    { id: "c", handle: "C", affiliation: "x", levelId: "mil-facility", score: 200, wavesSurvived: 6, ts: now - 30_000 },
    { id: "d", handle: "D", affiliation: "x", levelId: "airport", score: 999, wavesSurvived: 9, ts: now },
  ];

  it("all-time ranks by score, per level", () => {
    const board = rankBoard(entries, "mil-facility", "alltime", now);
    expect(board.map((e) => e.id)).toEqual(["b", "c", "a"]); // 300,200,100; airport excluded
  });
  it("today excludes older entries", () => {
    const board = rankBoard(entries, "mil-facility", "today", now);
    expect(board.map((e) => e.id)).toEqual(["c", "a"]); // b is 3 days old
  });
});
