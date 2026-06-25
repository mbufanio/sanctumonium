/**
 * Deterministic, seedable PRNG (mulberry32).
 *
 * The whole simulation must be reproducible so scoring is fair and the
 * boss-fight calibration ("painful narrow win") is repeatable. Never use
 * Math.random() in sim code — thread an Rng through instead.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Avoid a zero state which would lock mulberry32 to a degenerate stream.
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** True with probability p in [0, 1]. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** A fresh independent stream derived from this one (for sub-systems). */
  fork(): Rng {
    return new Rng((this.state ^ 0x85ebca6b) >>> 0);
  }
}

/** Produce a seed from the wall clock (call sites in render/UI only, never sim). */
export function timeSeed(): number {
  return (Date.now() ^ (performance.now() * 1000)) >>> 0;
}
