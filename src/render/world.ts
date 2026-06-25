/**
 * Pixi world renderer (spec §3/§4) — the stylized 2.5D isometric site.
 *
 * Revised architecture: the defended asset sits at the CENTER of a hexagonal
 * field and the playfield radiates 360° around it. This layer draws the hex
 * ground, the centred protected asset, concentric coverage rings, and a slow
 * command-radar sweep. It reads from GameState and never mutates it. The
 * interactive boss console is a DOM/SVG overlay on top (ui/bossConsole.ts).
 */
import { Application, Container, Graphics } from "pixi.js";
import { COLORS } from "../theme.ts";
import {
  HEX_SIZE,
  ISO_SQUASH,
  hexCorners,
  hexToPixel,
  hexesWithin,
  ringDistance,
  type Hex,
} from "../sim/hex.ts";
import type { GameState } from "../sim/state.ts";

export class WorldRenderer {
  readonly app: Application;
  private world = new Container();
  private ground = new Graphics();
  private assetGfx = new Graphics();
  private rings = new Graphics();
  private sweep = new Graphics();
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
    this.world.addChild(this.ground, this.rings, this.assetGfx, this.sweep);
    this.mounted = true;
    this.layout();
    window.addEventListener("resize", () => this.layout());
  }

  /** Center the hex field on screen (origin hex = screen centre). */
  private layout(): void {
    if (!this.mounted) return;
    const { width, height } = this.app.screen;
    this.world.position.set(width / 2, height / 2);
  }

  drawStatic(state: GameState): void {
    const lvl = state.level;
    this.ground.clear();

    // Hex ground, banded by ring so the 360° concentric structure reads.
    for (const h of hexesWithin(lvl.rings)) {
      const c = hexToPixel(h);
      const d = ringDistance(h);
      const band = d % 2 === 0 ? COLORS.groundFill : COLORS.groundLight;
      this.hexTile(this.ground, c, band, COLORS.groundLine);
    }

    // Protected asset, dead centre.
    this.assetGfx.clear();
    const ac = hexToPixel(lvl.asset.pos);
    this.assetGfx
      .circle(ac.x, ac.y, lvl.asset.radius * HEX_SIZE * 1.5)
      .stroke({ color: COLORS.asset, width: 2, alpha: 0.35 });
    this.isoBlock(this.assetGfx, ac.x, ac.y, 1.0, 30, COLORS.friendlyDim, COLORS.friendly);
    this.assetGfx.circle(ac.x, ac.y - 34, 4).fill(COLORS.assetCore);
  }

  /** Animate the concentric coverage rings + slow radar sweep over the asset. */
  update(state: GameState): void {
    if (!this.mounted) return;
    const lvl = state.level;
    const c = hexToPixel(lvl.asset.pos);

    // Faint concentric coverage rings (polar-plot feel, spec §3).
    this.rings.clear();
    for (let ring = 2; ring <= lvl.rings; ring += 2) {
      const rad = ring * HEX_SIZE * 1.5;
      this.ring(this.rings, c.x, c.y, rad, COLORS.coverage, 0.1);
    }

    // Sweeping wedge over the whole field.
    const r = lvl.rings * HEX_SIZE * 1.5;
    const ang = state.time * 0.7;
    this.sweep.clear();
    this.sweep
      .moveTo(c.x, c.y)
      .arc(c.x, c.y, r, ang, ang + 0.45)
      .lineTo(c.x, c.y)
      .fill({ color: COLORS.coverage, alpha: 0.08 });
    this.sweep.scale.set(1, ISO_SQUASH);
    this.sweep.position.set(0, c.y * (1 - ISO_SQUASH));
  }

  // ---- primitives --------------------------------------------------------

  private hexTile(g: Graphics, c: { x: number; y: number }, fill: number, line: number): void {
    const pts = hexCorners(c);
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath()
      .fill({ color: fill, alpha: 0.92 })
      .stroke({ color: line, width: 1, alpha: 0.4 });
  }

  /** A flattened (iso-squashed) circle for the radial coverage rings. */
  private ring(g: Graphics, x: number, y: number, radius: number, color: number, alpha: number): void {
    g.ellipse(x, y, radius, radius * ISO_SQUASH).stroke({ color, width: 1, alpha });
  }

  private isoBlock(g: Graphics, x: number, y: number, scale: number, h: number, side: number, top: number): void {
    const hw = HEX_SIZE * 0.7 * scale;
    const hh = HEX_SIZE * 0.7 * ISO_SQUASH * scale;
    // Left face.
    g.moveTo(x - hw, y).lineTo(x, y + hh).lineTo(x, y + hh - h).lineTo(x - hw, y - h).closePath().fill({ color: side, alpha: 0.85 });
    // Right face.
    g.moveTo(x + hw, y).lineTo(x, y + hh).lineTo(x, y + hh - h).lineTo(x + hw, y - h).closePath().fill({ color: side, alpha: 0.65 });
    // Top face.
    g.moveTo(x, y - hh - h).lineTo(x + hw, y - h).lineTo(x, y + hh - h).lineTo(x - hw, y - h).closePath().fill({ color: top, alpha: 0.95 });
  }

  /** Exposed for later phases that need to place sprites on the hex field. */
  hexToScreen(h: Hex): { x: number; y: number } {
    const p = hexToPixel(h);
    return { x: this.world.x + p.x, y: this.world.y + p.y };
  }
}
