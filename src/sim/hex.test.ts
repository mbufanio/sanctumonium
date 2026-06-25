import { describe, expect, it } from "vitest";
import {
  ORIGIN,
  hexDistance,
  hexLength,
  hexRing,
  hexToPixel,
  hexesWithin,
  pixelToHex,
} from "./hex.ts";

describe("hex grid math", () => {
  it("origin maps to pixel (0,0) — the asset is centred", () => {
    expect(hexToPixel(ORIGIN)).toEqual({ x: 0, y: 0 });
  });

  it("a hexagon of radius N has 3N(N+1)+1 cells", () => {
    for (const n of [1, 2, 6]) {
      expect(hexesWithin(n).length).toBe(3 * n * (n + 1) + 1);
    }
  });

  it("ring R has 6R cells (and ring 0 is the centre)", () => {
    expect(hexRing(0).length).toBe(1);
    for (const r of [1, 2, 5]) expect(hexRing(r).length).toBe(6 * r);
  });

  it("every cell on ring R is exactly distance R from the centre", () => {
    for (const h of hexRing(4)) expect(hexLength(h)).toBe(4);
  });

  it("pixel→hex is the inverse of hex→pixel across the field", () => {
    for (const h of hexesWithin(6)) {
      expect(pixelToHex(hexToPixel(h))).toEqual(h);
    }
  });

  it("distance is symmetric and zero to self", () => {
    const a = { q: 2, r: -1 };
    const b = { q: -1, r: 3 };
    expect(hexDistance(a, b)).toBe(hexDistance(b, a));
    expect(hexDistance(a, a)).toBe(0);
  });
});
