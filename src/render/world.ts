/**
 * Pixi world renderer (spec §3/§4) — the stylized 2.5D isometric site.
 *
 * The defended asset sits at the CENTER of a hexagonal field; play radiates
 * 360°. This layer draws the static hex ground + centred asset, and a DYNAMIC
 * layer for Phase 2: coverage footprints, placed devices, live drones, and
 * combat effects. It reads from GameState and never mutates it (except draining
 * the transient fx queue). The boss console is a DOM/SVG overlay on top.
 */
import { Application, Container, Graphics, Text } from "pixi.js";
import { COLORS } from "../theme.ts";
import {
  HEX_SIZE,
  ISO_SQUASH,
  hexCorners,
  hexToPixel,
  hexToPlane,
  hexesWithin,
  planeToPixel,
  pixelToHex,
  ringDistance,
  type Hex,
  type Px,
} from "../sim/hex.ts";
import { placeableById } from "../sim/realtime/catalog.ts";
import type { Fx } from "../sim/realtime/types.ts";
import type { GameState } from "../sim/state.ts";

interface ActiveFx {
  fx: Fx;
  age: number;
  ttl: number;
}

interface Ghost {
  placeableId: string;
  hex: Hex;
  radius: number;
  kind: "sensor" | "effector";
  valid: boolean;
}

export class WorldRenderer {
  readonly app: Application;
  private world = new Container();
  private ground = new Graphics();
  private rings = new Graphics();
  private coverage = new Graphics();
  private assetGfx = new Graphics();
  private sweep = new Graphics();
  private ghostGfx = new Graphics();
  private dronesGfx = new Graphics();
  private fxGfx = new Graphics();
  private labelLayer = new Container();
  private labels = new Map<string, Text>();
  private activeFx: ActiveFx[] = [];
  private ghost: Ghost | null = null;
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
    this.world.addChild(
      this.ground,
      this.rings,
      this.coverage,
      this.ghostGfx,
      this.assetGfx,
      this.sweep,
      this.dronesGfx,
      this.fxGfx,
      this.labelLayer,
    );
    this.mounted = true;
    this.layout();
    window.addEventListener("resize", () => this.layout());
  }

  private layout(): void {
    if (!this.mounted) return;
    const { width, height } = this.app.screen;
    this.world.position.set(width / 2, height / 2);
  }

  /** Plane radius just beyond the field edge — where drones spawn. */
  spawnRadius(state: GameState): number {
    return state.level.rings * HEX_SIZE * Math.sqrt(3) + HEX_SIZE * 1.5;
  }

  /** Convert a screen (canvas) point to the hex under it. */
  screenToHex(sx: number, sy: number): Hex {
    return pixelToHex({ x: sx - this.world.x, y: sy - this.world.y });
  }

  setGhost(ghost: Ghost | null): void {
    this.ghost = ghost;
  }

  drawStatic(state: GameState): void {
    const lvl = state.level;
    this.ground.clear();
    for (const h of hexesWithin(lvl.rings)) {
      const c = hexToPixel(h);
      const band = ringDistance(h) % 2 === 0 ? COLORS.groundFill : COLORS.groundLight;
      this.hexTile(this.ground, c, band, COLORS.groundLine);
    }
  }

  /** Per-frame dynamic draw: rings, sweep, coverage, devices, drones, fx. */
  update(state: GameState): void {
    if (!this.mounted) return;
    const lvl = state.level;
    const c = hexToPixel(lvl.asset.pos);

    // Concentric coverage rings + radar sweep.
    this.rings.clear();
    for (let ring = 2; ring <= lvl.rings; ring += 2) {
      this.ellipse(this.rings, c.x, c.y, ring * HEX_SIZE * 1.5, COLORS.coverage, 0.08);
    }
    const r = lvl.rings * HEX_SIZE * 1.5;
    const ang = state.time * 0.7;
    this.sweep.clear();
    this.sweep.moveTo(c.x, c.y).arc(c.x, c.y, r, ang, ang + 0.4).lineTo(c.x, c.y).fill({ color: COLORS.coverage, alpha: 0.06 });
    this.sweep.scale.set(1, ISO_SQUASH);
    this.sweep.position.set(0, c.y * (1 - ISO_SQUASH));

    this.drawCoverage(state);
    this.drawAsset(state);
    this.drawGhost();
    this.syncDeviceLabels(state);
    this.drawDrones(state);
    this.drawFx(state);
  }

  // ---- coverage & devices ------------------------------------------------

  private drawCoverage(state: GameState): void {
    this.coverage.clear();
    for (const d of state.placed) {
      const s = planeToPixel(d.pos);
      const color = d.kind === "sensor" ? COLORS.coverage : COLORS.friendly;
      this.coverage
        .ellipse(s.x, s.y, d.radius, d.radius * ISO_SQUASH)
        .fill({ color, alpha: 0.05 })
        .stroke({ color, width: 1, alpha: 0.22 });
    }
  }

  private drawAsset(state: GameState): void {
    this.assetGfx.clear();
    const ac = hexToPixel(state.level.asset.pos);
    // Integrity ring: shrinks/reddens as the asset takes damage.
    const frac = Math.max(0, state.integrity / state.maxIntegrity);
    const ringColor = frac > 0.5 ? COLORS.asset : frac > 0.25 ? COLORS.seam : COLORS.bad;
    this.assetGfx.ellipse(ac.x, ac.y, HEX_SIZE * 1.4, HEX_SIZE * 1.4 * ISO_SQUASH).stroke({ color: ringColor, width: 2, alpha: 0.5 });
    this.isoBlock(this.assetGfx, ac.x, ac.y, 1.0, 30, COLORS.friendlyDim, COLORS.friendly);
    this.assetGfx.circle(ac.x, ac.y - 34, 4).fill(COLORS.assetCore);

    // Device markers: sensors = teal rings, effectors = blue squares.
    for (const d of state.placed) {
      const s = planeToPixel(d.pos);
      if (d.kind === "sensor") {
        this.assetGfx.circle(s.x, s.y, 7).fill({ color: COLORS.panel }).stroke({ color: COLORS.coverage, width: 2 });
      } else {
        this.assetGfx.rect(s.x - 7, s.y - 7, 14, 14).fill({ color: COLORS.panel }).stroke({ color: COLORS.friendly, width: 2 });
      }
    }
  }

  private drawGhost(): void {
    this.ghostGfx.clear();
    if (!this.ghost) return;
    const s = hexToPixel(this.ghost.hex);
    const color = this.ghost.valid ? (this.ghost.kind === "sensor" ? COLORS.coverage : COLORS.friendly) : COLORS.bad;
    this.ghostGfx
      .ellipse(s.x, s.y, this.ghost.radius, this.ghost.radius * ISO_SQUASH)
      .fill({ color, alpha: 0.06 })
      .stroke({ color, width: 1, alpha: 0.5 });
    this.hexTile(this.ghostGfx, s, color, color, 0.18);
  }

  private syncDeviceLabels(state: GameState): void {
    const seen = new Set<string>();
    for (const d of state.placed) {
      seen.add(d.id);
      let t = this.labels.get(d.id);
      if (!t) {
        const code = placeableById(d.placeableId)?.code ?? labelCode(d.placeableId);
        t = new Text({
          text: code,
          style: { fontFamily: "monospace", fontSize: 10, fill: d.kind === "sensor" ? COLORS.coverage : COLORS.friendly, fontWeight: "700" },
        });
        t.anchor.set(0.5, 0);
        this.labels.set(d.id, t);
        this.labelLayer.addChild(t);
      }
      const s = planeToPixel(d.pos);
      t.position.set(s.x, s.y + 9);
    }
    for (const [id, t] of this.labels) {
      if (!seen.has(id)) {
        t.destroy();
        this.labels.delete(id);
      }
    }
  }

  // ---- drones & fx -------------------------------------------------------

  private drawDrones(state: GameState): void {
    this.dronesGfx.clear();
    const rt = state.rt;
    if (!rt) return;
    for (const d of rt.drones) {
      const s = planeToPixel(d.pos);
      // Tracked drones get a cyan lock ring (brain accent reserved for boss;
      // here a neutral track ring in coverage teal).
      if (d.tracked) this.dronesGfx.circle(s.x, s.y, 9).stroke({ color: COLORS.coverage, width: 1, alpha: 0.7 });
      this.triangle(this.dronesGfx, s.x, s.y, 6, COLORS.threatDeep, COLORS.threat);
    }
  }

  private drawFx(state: GameState): void {
    // Drain newly-produced fx from the sim into the animated buffer.
    const rt = state.rt;
    if (rt && rt.fx.length) {
      for (const fx of rt.fx) {
        const ttl = fx.kind === "shot" ? 0.12 : fx.kind === "handoff" ? 0.22 : fx.kind === "aoe" ? 0.45 : fx.kind === "kill" ? 0.3 : 0.4;
        this.activeFx.push({ fx, age: 0, ttl });
      }
      rt.fx = [];
    }

    this.fxGfx.clear();
    const dt = this.app.ticker.deltaMS / 1000;
    const survivors: ActiveFx[] = [];
    for (const a of this.activeFx) {
      a.age += dt;
      const k = 1 - a.age / a.ttl;
      if (k <= 0) continue;
      survivors.push(a);
      if (a.fx.kind === "shot") {
        const from = planeToPixel(a.fx.from);
        const to = planeToPixel(a.fx.to);
        const color = a.fx.hit ? (a.fx.effector === "rf-jammer" ? COLORS.brain : COLORS.friendly) : COLORS.textDim;
        this.fxGfx.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ color, width: a.fx.effector === "rf-jammer" ? 2 : 1.5, alpha: 0.5 + 0.5 * k });
      } else if (a.fx.kind === "kill") {
        const at = planeToPixel(a.fx.at);
        this.fxGfx.circle(at.x, at.y, 6 + (1 - k) * 14).stroke({ color: COLORS.good, width: 2, alpha: k });
      } else if (a.fx.kind === "leak") {
        const at = planeToPixel(a.fx.at);
        this.fxGfx.circle(at.x, at.y, 8 + (1 - k) * 18).stroke({ color: COLORS.bad, width: 2.5, alpha: k });
      } else if (a.fx.kind === "handoff") {
        // Brain coordination: a track being handed from sensor to effector.
        const from = planeToPixel(a.fx.from);
        const to = planeToPixel(a.fx.to);
        this.fxGfx.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ color: COLORS.brain, width: 1, alpha: 0.55 * k });
      } else if (a.fx.kind === "aoe") {
        // Area blast — an expanding, fading filled ring (the high-tier spectacle).
        const at = planeToPixel(a.fx.at);
        const col = aoeColor(a.fx.effector);
        const rr = a.fx.radius * (0.5 + 0.5 * (1 - k));
        this.fxGfx
          .ellipse(at.x, at.y, rr, rr * ISO_SQUASH)
          .fill({ color: col, alpha: 0.12 * k })
          .stroke({ color: col, width: 2, alpha: 0.7 * k });
      }
    }
    this.activeFx = survivors;
  }

  // ---- primitives --------------------------------------------------------

  private hexTile(g: Graphics, c: Px, fill: number, line: number, fillAlpha = 0.92): void {
    const pts = hexCorners(c);
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath().fill({ color: fill, alpha: fillAlpha }).stroke({ color: line, width: 1, alpha: 0.4 });
  }

  private ellipse(g: Graphics, x: number, y: number, radius: number, color: number, alpha: number): void {
    g.ellipse(x, y, radius, radius * ISO_SQUASH).stroke({ color, width: 1, alpha });
  }

  private triangle(g: Graphics, x: number, y: number, size: number, fill: number, stroke: number): void {
    g.moveTo(x, y - size).lineTo(x + size * 0.9, y + size * 0.7).lineTo(x - size * 0.9, y + size * 0.7).closePath().fill(fill).stroke({ color: stroke, width: 1 });
  }

  private isoBlock(g: Graphics, x: number, y: number, scale: number, h: number, side: number, top: number): void {
    const hw = HEX_SIZE * 0.7 * scale;
    const hh = HEX_SIZE * 0.7 * ISO_SQUASH * scale;
    g.moveTo(x - hw, y).lineTo(x, y + hh).lineTo(x, y + hh - h).lineTo(x - hw, y - h).closePath().fill({ color: side, alpha: 0.85 });
    g.moveTo(x + hw, y).lineTo(x, y + hh).lineTo(x, y + hh - h).lineTo(x + hw, y - h).closePath().fill({ color: side, alpha: 0.65 });
    g.moveTo(x, y - hh - h).lineTo(x + hw, y - h).lineTo(x, y + hh - h).lineTo(x - hw, y - h).closePath().fill({ color: top, alpha: 0.95 });
  }

  /** Screen position (canvas px) of a hex centre — for DOM overlay anchoring. */
  hexToScreen(h: Hex): Px {
    const p = hexToPixel(h);
    return { x: this.world.x + p.x, y: this.world.y + p.y };
  }

  /** Plane position helper exposed for callers that need world geometry. */
  planeOf(h: Hex): Px {
    return hexToPlane(h);
  }
}

/** Spectacle colour for an area-blast by weapon (spec §7 — escalating wow). */
function aoeColor(effector: string): number {
  switch (effector) {
    case "plasma":
      return 0xff5cf0; // magenta plasma
    case "beam":
      return COLORS.brain; // cyan beam
    case "hpm":
      return 0x8be9ff; // pale microwave
    default:
      return COLORS.friendly;
  }
}

function labelCode(placeableId: string): string {
  switch (placeableId) {
    case "net-drone":
      return "NET";
    case "rf-jammer":
      return "JAMMER";
    case "rf-df":
      return "RF-DF";
    case "radar":
      return "RADAR";
    default:
      return placeableId.toUpperCase();
  }
}
