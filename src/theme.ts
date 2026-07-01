/**
 * Central color & signal language (spec §3).
 *
 * Consistency here is load-bearing: SENSORS = warm yellow (eyes), EFFECTORS =
 * cool blue (shooters), so a glance separates "who sees" from "who shoots" — and
 * where a sensor's yellow coverage overlaps an effector's blue, the translucent
 * fills blend toward green (shared airspace, watched AND covered). Threats are
 * warm reds; the coordination brain gets ONE special accent (cyan/gold) used
 * nowhere else, so its arrival is visually unmistakable.
 */
export const COLORS = {
  // World / ground
  bgTop: 0x0b1622,
  bgBottom: 0x060d15,
  groundLight: 0x162433,
  groundFill: 0x12202e,
  groundLine: 0x1d3346,
  groundLineWarm: 0x243a4d,

  // Effectors (shooters) = cool blue; sensors (eyes) = warm yellow. Overlapping
  // translucent coverage blends toward green (the shared channel of both).
  friendly: 0x4fc3f7,
  friendlyDim: 0x2a6f8e,
  coverage: 0xf5e14f,
  coverageFill: 0x4a4413,

  // Protected asset
  asset: 0x9be7ff,
  assetCore: 0xe6fbff,

  // Threats (warm reds / oranges)
  threat: 0xff6b4a,
  threatDeep: 0xc2381b,
  threatTrack: 0xffb199,

  // THE BRAIN — special accent, used ONLY for coordination actions.
  brain: 0x00e5ff,
  brainGold: 0xffd166,

  // Seams / gaps in coverage
  seam: 0xffb020,

  // UI neutrals
  panel: 0x0e1a26,
  panelEdge: 0x21384a,
  text: 0xe8f1f8,
  textDim: 0x8aa2b5,
  good: 0x4ade80,
  bad: 0xff5470,
} as const;

/** CSS hex string from a 0xRRGGBB number (for DOM overlays). */
export function css(hex: number): string {
  return "#" + hex.toString(16).padStart(6, "0");
}

/** CSS rgba string with alpha. */
export function rgba(hex: number, a: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgba(${r},${g},${b},${a})`;
}
