import { describe, expect, it } from "vitest";
import { hexKey, hexToPlane } from "./hex.ts";
import { buildTerrain, losClear } from "./terrain.ts";
import { LEVELS } from "./level.ts";
import { bearingStrength } from "./realtime/adaptive.ts";
import { makePlaced } from "./state.ts";

describe("line-of-sight (terrain)", () => {
  const from = hexToPlane({ q: 0, r: 0 });
  const to = hexToPlane({ q: 4, r: 0 }); // a blocker at {2,0} sits on this segment
  const blocker = buildTerrain([{ hex: { q: 2, r: 0 }, kind: "blocker" }]);
  const nofire = buildTerrain([{ hex: { q: 2, r: 0 }, kind: "nofire" }]);

  it("empty terrain is always clear", () => {
    expect(losClear(from, to, new Map(), true)).toBe(true);
  });
  it("a blocker obstructs both sight and fire", () => {
    expect(losClear(from, to, blocker, false)).toBe(false); // sensor sight
    expect(losClear(from, to, blocker, true)).toBe(false); // effector fire
  });
  it("a no-fire zone blocks fire but not sight", () => {
    expect(losClear(from, to, nofire, false)).toBe(true); // sensors track through it
    expect(losClear(from, to, nofire, true)).toBe(false); // can't fire across it
  });
});

describe("sites never bury the asset or starting devices in terrain", () => {
  it("keeps (0,0) and (0,±1) clear", () => {
    const protectedCells = new Set([hexKey({ q: 0, r: 0 }), hexKey({ q: 0, r: -1 }), hexKey({ q: 0, r: 1 })]);
    for (const lvl of LEVELS) {
      const t = buildTerrain(lvl.terrain);
      for (const cell of protectedCells) expect(t.has(cell), `${lvl.id} buries ${cell}`).toBe(false);
    }
  });
});

describe("terrain collapses kill-coverage along a blocked bearing", () => {
  // The engine and the adaptive enemy share one coverage check (losClear). A
  // blocker on a bearing should tank that bearing's kill-coverage.
  const placed = [makePlaced("radar", { q: 0, r: 0 }), makePlaced("net-drone", { q: 0, r: 0 })];
  const SPAWN = 300;

  it("a blocker on the east bearing crushes its coverage", () => {
    const open = bearingStrength(placed, SPAWN, 90);
    const blocked = bearingStrength(placed, SPAWN, 90, buildTerrain([
      { hex: { q: 1, r: -1 }, kind: "blocker" },
      { hex: { q: 2, r: -1 }, kind: "blocker" },
    ]));
    expect(open).toBeGreaterThan(0.1);
    expect(blocked).toBeLessThan(open * 0.5);
  });

  it("a no-fire zone also reduces coverage (can't fire across it)", () => {
    const open = bearingStrength(placed, SPAWN, 90);
    const nofire = bearingStrength(placed, SPAWN, 90, buildTerrain([
      { hex: { q: 1, r: -1 }, kind: "nofire" },
      { hex: { q: 2, r: -1 }, kind: "nofire" },
    ]));
    expect(nofire).toBeLessThan(open);
  });
});
