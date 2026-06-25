/**
 * Pixi world renderer (spec §3/§4) — the stylized 2.5D isometric site.
 *
 * Phase 0: draws the military-facility ground grid, the protected asset with a
 * slow command-radar sweep, and a subtle vignette. It reads from GameState and
 * never mutates it. The interactive boss console is a DOM/SVG overlay on top
 * (see ui/bossConsole.ts) — this layer is the atmospheric world behind it.
 */
import { Application, Container, Graphics } from "pixi.js";
import { COLORS } from "../theme.ts";
import { TILE_H, TILE_W, worldToScreen, type WorldPoint } from "../sim/iso.ts";
import type { GameState } from "../sim/state.ts";

export class WorldRenderer {
  readonly app: Application;
  private world = new Container();
  private ground = new Graphics();
  private assetGfx = new Graphics();
  private sweep = new Graphics();
  private vignette = new Graphics();
  private mounted = false;

  constructor() {
    this.app = new Application();
  }

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      background: COLORS.bgBottom,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      resizeTo: host,
    });
    host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);
    this.world.addChild(this.ground, this.assetGfx, this.sweep);
    this.app.stage.addChild(this.vignette);
    this.mounted = true;
    this.layout();
    window.addEventListener("resize", () => this.layout());
  }

  /** Center the iso world and draw the static ground for the current level. */
  private layout(): void {
    if (!this.mounted) return;
    const { width, height } = this.app.screen;
    // Center the world container; level origin sits at canvas middle-top-ish.
    this.world.position.set(width / 2, height / 2 - 40);
    this.drawVignette(width, height);
  }

  drawStatic(state: GameState): void {
    const lvl = state.level;
    this.ground.clear();

    // Iso ground diamond grid.
    for (let gx = 0; gx < lvl.cols; gx++) {
      for (let gy = 0; gy < lvl.rows; gy++) {
        const center = this.tileCenter(lvl.cols, lvl.rows, { gx, gy });
        const checker = (gx + gy) % 2 === 0;
        this.diamond(this.ground, center.x, center.y, checker ? COLORS.groundFill : COLORS.groundLight, COLORS.groundLine);
      }
    }

    // Protected asset (spec §3 — clear, distinct, the thing you defend).
    this.assetGfx.clear();
    for (const a of lvl.assets) {
      const c = this.tileCenter(lvl.cols, lvl.rows, a.pos);
      // Footprint ring.
      this.assetGfx
        .circle(c.x, c.y, a.radius * TILE_W * 0.5)
        .stroke({ color: COLORS.asset, width: 2, alpha: 0.4 });
      // Stylized command building (stacked iso block).
      this.isoBlock(this.assetGfx, c.x, c.y, 1.1, 26, COLORS.friendlyDim, COLORS.friendly);
      this.assetGfx.circle(c.x, c.y - 30, 4).fill(COLORS.assetCore);
    }
  }

  /** Animate the slow radar sweep over the asset. */
  update(state: GameState): void {
    if (!this.mounted) return;
    const lvl = state.level;
    const a = lvl.assets[0];
    if (!a) return;
    const c = this.tileCenter(lvl.cols, lvl.rows, a.pos);
    const r = 5 * TILE_W * 0.5;
    const ang = state.time * 0.8;
    this.sweep.clear();
    // Faint coverage circle (polar-plot feel, spec §3).
    this.sweep.circle(c.x, c.y, r).stroke({ color: COLORS.coverage, width: 1, alpha: 0.18 });
    // Sweeping wedge.
    this.sweep
      .moveTo(c.x, c.y)
      .arc(c.x, c.y, r, ang, ang + 0.5)
      .lineTo(c.x, c.y)
      .fill({ color: COLORS.coverage, alpha: 0.1 });
  }

  /** Convert a level tile to centered screen coords within the world container. */
  private tileCenter(cols: number, rows: number, p: WorldPoint): { x: number; y: number } {
    const s = worldToScreen(p);
    // Offset so the grid is centered on the world origin.
    const o = worldToScreen({ gx: (cols - 1) / 2, gy: (rows - 1) / 2 });
    return { x: s.x - o.x, y: s.y - o.y };
  }

  private diamond(g: Graphics, x: number, y: number, fill: number, line: number): void {
    g.moveTo(x, y - TILE_H / 2)
      .lineTo(x + TILE_W / 2, y)
      .lineTo(x, y + TILE_H / 2)
      .lineTo(x - TILE_W / 2, y)
      .closePath()
      .fill({ color: fill, alpha: 0.9 })
      .stroke({ color: line, width: 1, alpha: 0.5 });
  }

  private isoBlock(g: Graphics, x: number, y: number, scale: number, h: number, side: number, top: number): void {
    const hw = (TILE_W / 2) * scale;
    const hh = (TILE_H / 2) * scale;
    // Left face.
    g.moveTo(x - hw, y).lineTo(x, y + hh).lineTo(x, y + hh - h).lineTo(x - hw, y - h).closePath().fill({ color: side, alpha: 0.85 });
    // Right face.
    g.moveTo(x + hw, y).lineTo(x, y + hh).lineTo(x, y + hh - h).lineTo(x + hw, y - h).closePath().fill({ color: side, alpha: 0.65 });
    // Top face.
    g.moveTo(x, y - hh - h).lineTo(x + hw, y - h).lineTo(x, y + hh - h).lineTo(x - hw, y - h).closePath().fill({ color: top, alpha: 0.95 });
  }

  private drawVignette(w: number, h: number): void {
    this.vignette.clear();
    this.vignette.rect(0, 0, w, h).fill({ color: COLORS.bgBottom, alpha: 0 });
    // Darkened corners via four soft rects (cheap vignette).
    const band = Math.min(w, h) * 0.28;
    this.vignette.rect(0, 0, w, band).fill({ color: COLORS.bgBottom, alpha: 0.0 });
  }
}
