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

/** Cap on simultaneously-animated effects (perf for the swarm finale). */
const MAX_FX = 220;
/** Cap on lightweight juice particles (spawn flashes, kill sparks). */
const MAX_SPARKS = 160;
/** How many recent positions a drone's motion trail remembers. */
const TRAIL_LEN = 7;
/** Cap on bounty "coin" particles flying to the bank. */
const MAX_COINS = 70;

/** A bounty coin that zips from a kill up to the FUNDS counter (the bank). */
interface Coin {
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  tx: number;
  ty: number;
  age: number;
  ttl: number;
  amount: number;
  popped: boolean;
}

/** A cheap render-only particle (never touches the sim). */
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  ttl: number;
  color: number;
  size: number;
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
  private ghostGfx = new Graphics();
  private dronesGfx = new Graphics();
  private fxGfx = new Graphics();
  private labelLayer = new Container();
  private labels = new Map<string, Text>();
  private coinGfx = new Graphics();
  private coins: Coin[] = [];
  private fundsEl: HTMLElement | null = null;
  private activeFx: ActiveFx[] = [];
  private sparks: Spark[] = [];
  private trails = new Map<number, Px[]>();
  private seenDrones = new Set<number>();
  private ghost: Ghost | null = null;
  private guideHex: Hex | null = null;
  private mounted = false;
  private dangerEl: HTMLDivElement | null = null;
  private selectedId: string | null = null;

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
      this.dronesGfx,
      this.fxGfx,
      this.labelLayer,
    );
    // Coins live in SCREEN space (above the world transform) so they can fly
    // straight to the DOM funds counter at the top of the HUD.
    this.app.stage.addChild(this.coinGfx);
    // Low-integrity danger vignette — a CSS edge-glow that pulses red as the
    // asset takes damage. Pointer-transparent, behind the overlay UI.
    const danger = document.createElement("div");
    danger.id = "danger-vignette";
    document.body.appendChild(danger);
    this.dangerEl = danger;

    this.mounted = true;
    this.layout();
    window.addEventListener("resize", () => this.layout());
  }

  /** The currently-selected device, so its marker can pulse. */
  setSelected(id: string | null): void {
    this.selectedId = id;
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

  /** Project a plane point to a screen (CSS-pixel) point — for DOM overlays that
   *  sit over a live entity, e.g. the drill freeze-frame pins. */
  projectToScreen(pos: Px): Px {
    const p = planeToPixel(pos);
    return { x: this.world.x + p.x, y: this.world.y + p.y };
  }

  setGhost(ghost: Ghost | null): void {
    this.ghost = ghost;
  }

  /** A pulsing "place here" marker for the guided first placement (ACT1 §4). */
  setGuide(hex: Hex | null): void {
    this.guideHex = hex;
  }

  drawStatic(state: GameState): void {
    const lvl = state.level;
    this.ground.clear();
    for (const h of hexesWithin(lvl.rings)) {
      const c = hexToPixel(h);
      const band = ringDistance(h) % 2 === 0 ? COLORS.groundFill : COLORS.groundLight;
      this.hexTile(this.ground, c, band, COLORS.groundLine);
    }
    // Terrain: structures (blockers) as raised iso blocks; no-fire zones as
    // warm hatched tiles you can't build on or fire across.
    for (const t of lvl.terrain) {
      const c = hexToPixel(t.hex);
      if (t.kind === "blocker") {
        this.hexTile(this.ground, c, 0x1a2735, COLORS.panelEdge, 0.95);
        this.isoBlock(this.ground, c.x, c.y, 0.82, 17, 0x2b3c4f, 0x3c5168);
      } else {
        this.hexTile(this.ground, c, 0x3a241a, COLORS.seam, 0.5);
        // hatch marks
        const pts = hexCorners(c);
        this.ground.moveTo(pts[0].x, pts[0].y).lineTo(pts[3].x, pts[3].y).stroke({ color: COLORS.seam, width: 1, alpha: 0.35 });
        this.ground.moveTo(pts[1].x, pts[1].y).lineTo(pts[4].x, pts[4].y).stroke({ color: COLORS.seam, width: 1, alpha: 0.35 });
      }
    }
  }

  /** Per-frame dynamic draw: radar pings, coverage, devices, drones, fx, coins. */
  update(state: GameState): void {
    if (!this.mounted) return;

    this.drawRadarPings(state);
    this.drawCoverage(state);
    this.drawAsset(state);
    this.drawGhost(state);
    this.syncDeviceLabels(state);
    this.drawDrones(state);
    this.drawFx(state);
    this.drawCoins();
    this.updateDanger(state);
  }

  /**
   * Emitting radars announce themselves with sonar-style ping rings that grow
   * from the device out to its coverage edge (replaces the old central sweep).
   * Only active emitters (radar / AESA) ping; passive sensors stay quiet.
   */
  private drawRadarPings(state: GameState): void {
    this.rings.clear();
    const PERIOD = 2.4; // seconds per ping cycle
    const RINGS = 3;
    for (const d of state.placed) {
      if (d.kind !== "sensor") continue;
      if (d.placeableId !== "radar" && d.placeableId !== "aesa") continue;
      const s = planeToPixel(d.pos);
      for (let i = 0; i < RINGS; i++) {
        const ph = ((state.time / PERIOD) + i / RINGS) % 1;
        const rr = ph * d.radius;
        const a = 0.28 * (1 - ph) * (1 - ph); // bright at the emitter, fades outward
        if (a < 0.01) continue;
        this.rings.ellipse(s.x, s.y, rr, rr * ISO_SQUASH).stroke({ color: COLORS.coverage, width: 1.3, alpha: a });
      }
    }
  }

  /** Pulse a red edge-vignette harder as asset integrity falls. */
  private updateDanger(state: GameState): void {
    if (!this.dangerEl) return;
    const frac = Math.max(0, state.integrity / state.maxIntegrity);
    // Calm above half integrity; ramps in below, with a heartbeat pulse.
    const danger = frac >= 0.5 ? 0 : (0.5 - frac) / 0.5;
    const pulse = 0.75 + 0.25 * Math.sin(state.time * 6);
    this.dangerEl.style.opacity = (danger * pulse).toFixed(3);
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
    // Breathing halo — soft concentric rings that gently pulse, so the thing
    // you're protecting always reads as "alive" and worth defending.
    const breath = 0.5 + 0.5 * Math.sin(state.time * 1.6);
    for (let i = 0; i < 3; i++) {
      const rr = HEX_SIZE * (1.6 + i * 0.32) + breath * 4;
      this.assetGfx.ellipse(ac.x, ac.y, rr, rr * ISO_SQUASH).stroke({ color: COLORS.asset, width: 1, alpha: 0.06 + 0.05 * breath - i * 0.018 });
    }
    this.assetGfx.ellipse(ac.x, ac.y, HEX_SIZE * 1.4, HEX_SIZE * 1.4 * ISO_SQUASH).stroke({ color: ringColor, width: 2, alpha: 0.5 });
    this.isoBlock(this.assetGfx, ac.x, ac.y, 1.0, 30, COLORS.friendlyDim, COLORS.friendly);
    // Beacon core with a pulsing glow.
    this.assetGfx.circle(ac.x, ac.y - 34, 7 + breath * 2.5).fill({ color: COLORS.assetCore, alpha: 0.18 });
    this.assetGfx.circle(ac.x, ac.y - 34, 4).fill(COLORS.assetCore);

    // Device markers: sensors = yellow rings, effectors = blue squares.
    const selPulse = 0.5 + 0.5 * Math.sin(state.time * 5);
    for (const d of state.placed) {
      const s = planeToPixel(d.pos);
      const color = d.kind === "sensor" ? COLORS.coverage : COLORS.friendly;
      // Soft glow halo so devices pop off the ground.
      this.assetGfx.circle(s.x, s.y, 12).fill({ color, alpha: 0.1 });
      if (d.id === this.selectedId) {
        this.assetGfx.circle(s.x, s.y, 13 + selPulse * 4).stroke({ color: COLORS.brainGold, width: 1.5, alpha: 0.4 + 0.4 * selPulse });
      }
      if (d.kind === "sensor") {
        this.assetGfx.circle(s.x, s.y, 7).fill({ color: COLORS.panel }).stroke({ color: COLORS.coverage, width: 2 });
      } else {
        // Reloading effectors dim and show a sweeping reload arc — you can SEE
        // the magazine gap (and, coordinated, how they're staggered).
        const reloading = d.magazine > 0 && d.reloadCd > 0;
        const edge = reloading ? COLORS.seam : COLORS.friendly;
        this.assetGfx.rect(s.x - 7, s.y - 7, 14, 14).fill({ color: COLORS.panel, alpha: reloading ? 0.55 : 1 }).stroke({ color: edge, width: 2 });
        if (reloading) {
          const prog = 1 - d.reloadCd / Math.max(0.001, d.reloadTime);
          this.assetGfx.arc(s.x, s.y, 11, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2).stroke({ color: COLORS.seam, width: 1.6, alpha: 0.9 });
        }
      }
    }
  }

  private drawGhost(state: GameState): void {
    this.ghostGfx.clear();
    // Guided "place here" marker — a pulsing gold target on the suggested hex.
    if (this.guideHex) {
      const g = hexToPixel(this.guideHex);
      const pulse = 0.5 + 0.5 * Math.sin(state.time * 4);
      this.hexTile(this.ghostGfx, g, COLORS.brainGold, COLORS.brainGold, 0.12 + 0.1 * pulse);
      this.ghostGfx
        .ellipse(g.x, g.y, HEX_SIZE * (1.1 + pulse * 0.35), HEX_SIZE * (1.1 + pulse * 0.35) * ISO_SQUASH)
        .stroke({ color: COLORS.brainGold, width: 2, alpha: 0.4 + 0.4 * pulse });
    }
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
    if (!rt) {
      this.trails.clear();
      this.seenDrones.clear();
      return;
    }
    // Drill callouts: draw each sensor's live track LINE to the drone it's
    // working. Redundant coverage (2+ sensors on one drone) glows amber — the
    // "everyone staring at one target" tell — while a drone with NO line is an
    // unwatched seam. Only in Act-1 drills; normal waves stay clean.
    const drill = state.phase === "wave" && !!state.activeWave?.drill;
    const sensorPos = drill
      ? new Map(state.placed.filter((p) => p.kind === "sensor").map((p) => [p.id, planeToPixel(p.pos)] as const))
      : null;
    const pulse = 0.5 + 0.5 * Math.sin(rt.time * 6);

    const live = new Set<number>();
    for (const d of rt.drones) {
      live.add(d.id);
      const s = planeToPixel(d.pos);
      const sz = 6 * d.size; // swarm micro-drones are smaller

      if (drill && sensorPos) {
        const wasteful = d.trackerIds.length >= 2;
        for (const sid of d.trackerIds) {
          const from = sensorPos.get(sid);
          if (!from) continue;
          const col = wasteful ? COLORS.seam : COLORS.coverage;
          this.dronesGfx.moveTo(from.x, from.y).lineTo(s.x, s.y).stroke({ color: col, width: wasteful ? 2 : 1.2, alpha: wasteful ? 0.5 + 0.4 * pulse : 0.5 });
        }
        // Untracked in a drill = the seam nobody is watching: a red warning ring.
        if (d.trackerIds.length === 0) {
          this.dronesGfx.circle(s.x, s.y, sz + 5 + pulse * 3).stroke({ color: COLORS.bad, width: 2, alpha: 0.5 + 0.4 * pulse });
        }
      }

      // Spawn flash — a quick warm pop the first frame a drone appears, so new
      // threats announce themselves at the field edge.
      if (!this.seenDrones.has(d.id)) {
        this.seenDrones.add(d.id);
        this.burst(s.x, s.y, COLORS.threat, 5, 26);
      }

      // Motion trail — a fading comet behind each drone.
      let tr = this.trails.get(d.id);
      if (!tr) { tr = []; this.trails.set(d.id, tr); }
      tr.push(s);
      if (tr.length > TRAIL_LEN) tr.shift();
      for (let i = 1; i < tr.length; i++) {
        const k = i / tr.length;
        this.dronesGfx.moveTo(tr[i - 1].x, tr[i - 1].y).lineTo(tr[i].x, tr[i].y).stroke({ color: COLORS.threat, width: sz * 0.45 * k, alpha: 0.28 * k });
      }

      // Kill-chain readout on each threat: undetected = bare triangle; DETECTED
      // (a return, not yet classified) = amber arc that fills with classification
      // confidence; TRACKED (fire-control) = a closed cyan lock ring. You can
      // literally watch the chain run — fast when coordinated, ragged without.
      if (d.tracked) {
        this.dronesGfx.circle(s.x, s.y, sz + 3).stroke({ color: COLORS.coverage, width: 1.3, alpha: 0.8 });
        // little lock ticks
        for (const a of [0.6, 2.7, 4.3]) {
          this.dronesGfx.moveTo(s.x + Math.cos(a) * (sz + 1), s.y + Math.sin(a) * (sz + 1)).lineTo(s.x + Math.cos(a) * (sz + 4.5), s.y + Math.sin(a) * (sz + 4.5)).stroke({ color: COLORS.coverage, width: 1, alpha: 0.8 });
        }
      } else if (d.detected) {
        const end = -Math.PI / 2 + Math.max(0.08, d.idConf) * Math.PI * 2;
        this.dronesGfx.arc(s.x, s.y, sz + 3, -Math.PI / 2, end).stroke({ color: COLORS.seam, width: 1.2, alpha: 0.85 });
      }
      this.triangle(this.dronesGfx, s.x, s.y, sz, COLORS.threatDeep, COLORS.threat);
    }
    // Drop trails/seen-marks for drones that left the field (killed or leaked).
    for (const id of this.trails.keys()) if (!live.has(id)) this.trails.delete(id);
    for (const id of this.seenDrones) if (!live.has(id)) this.seenDrones.delete(id);
  }

  /** Emit a radial burst of sparks (render-only juice). */
  private burst(x: number, y: number, color: number, count: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (x + y) * 0.013;
      const v = speed * (0.6 + 0.4 * ((i * 7 + 3) % 5) / 5);
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * ISO_SQUASH, age: 0, ttl: 0.4, color, size: 2 });
    }
    if (this.sparks.length > MAX_SPARKS) this.sparks.splice(0, this.sparks.length - MAX_SPARKS);
  }

  // ---- bounty coins (money to the bank) ----------------------------------

  /** Screen-space centre of the FUNDS counter (the bank), with a fallback. */
  private bankTarget(): Px {
    if (!this.fundsEl || !this.fundsEl.isConnected) {
      this.fundsEl = document.querySelector<HTMLElement>(".hud-bar .funds");
    }
    if (this.fundsEl) {
      const r = this.fundsEl.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return { x: this.app.screen.width * 0.22, y: 28 };
  }

  /** Launch a little cluster of coins from a kill toward the funds counter. */
  private spawnCoins(at: Px, bounty: number): void {
    if (bounty <= 0) return;
    const x0 = this.world.x + at.x;
    const y0 = this.world.y + at.y;
    const t = this.bankTarget();
    const n = Math.max(1, Math.min(4, 1 + Math.floor(bounty / 8)));
    const share = bounty / n;
    for (let i = 0; i < n; i++) {
      const sx = x0 + (Math.random() - 0.5) * 22;
      const sy = y0 + (Math.random() - 0.5) * 22;
      // Arc up and over: a control point lifted above both ends.
      const cx = (sx + t.x) / 2 + (Math.random() - 0.5) * 140;
      const cy = Math.min(sy, t.y) - 50 - Math.random() * 70;
      this.coins.push({ x0: sx, y0: sy, cx, cy, tx: t.x, ty: t.y, age: -i * 0.05, ttl: 0.72 + Math.random() * 0.18, amount: share, popped: false });
    }
    if (this.coins.length > MAX_COINS) this.coins.splice(0, this.coins.length - MAX_COINS);
  }

  private drawCoins(): void {
    this.coinGfx.clear();
    if (!this.coins.length) return;
    const dt = this.app.ticker.deltaMS / 1000;
    const live: Coin[] = [];
    for (const c of this.coins) {
      c.age += dt;
      if (c.age < 0) { live.push(c); continue; } // staggered launch delay
      const t = Math.min(1, c.age / c.ttl);
      if (t >= 1) {
        if (!c.popped) { c.popped = true; this.bankPop(); }
        continue;
      }
      // Quadratic bezier from kill → control → bank, easing toward the bank.
      const e = t * t * (3 - 2 * t); // smoothstep
      const u = 1 - e;
      const x = u * u * c.x0 + 2 * u * e * c.cx + e * e * c.tx;
      const y = u * u * c.y0 + 2 * u * e * c.cy + e * e * c.ty;
      const shrink = 1 - 0.45 * e;
      // A small gold coin with a brighter rim — reads as money in flight.
      this.coinGfx.circle(x, y, 5 * shrink).fill({ color: COLORS.brainGold, alpha: 0.95 });
      this.coinGfx.circle(x, y, 5 * shrink).stroke({ color: 0xfff1c2, width: 1, alpha: 0.9 });
      this.coinGfx.circle(x - 1.4, y - 1.4, 1.6 * shrink).fill({ color: 0xfff7e0, alpha: 0.9 }); // glint
      live.push(c);
    }
    this.coins = live;
  }

  /** A quick scale-bounce on the FUNDS counter as money lands. */
  private bankPop(): void {
    const el = this.fundsEl;
    if (!el || !el.isConnected || typeof el.animate !== "function") return;
    el.animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.32)", offset: 0.35 }, { transform: "scale(1)" }],
      { duration: 300, easing: "ease-out" },
    );
  }

  private drawFx(state: GameState): void {
    // Drain newly-produced fx from the sim into the animated buffer.
    const rt = state.rt;
    if (rt && rt.fx.length) {
      for (const fx of rt.fx) {
        const ttl = fx.kind === "shot" ? 0.12 : fx.kind === "handoff" ? 0.22 : fx.kind === "aoe" ? 0.45 : fx.kind === "kill" ? 0.3 : fx.kind === "seam" ? 0.9 : 0.4;
        this.activeFx.push({ fx, age: 0, ttl });
        // One-time juice as effects arrive (so bursts fire once, not per frame).
        if (fx.kind === "kill") {
          const at = planeToPixel(fx.at);
          this.burst(at.x, at.y, COLORS.good, 8, 60);
          this.spawnCoins(at, fx.bounty);
        } else if (fx.kind === "shot" && fx.hit) {
          const to = planeToPixel(fx.to);
          this.burst(to.x, to.y, fx.effector === "rf-jammer" ? COLORS.brain : COLORS.friendly, 3, 22);
        } else if (fx.kind === "aoe") {
          const at = planeToPixel(fx.at);
          this.burst(at.x, at.y, aoeColor(fx.effector), 10, 90);
        }
      }
      rt.fx = [];
      // Perf cap for the heavy swarm finale: keep only the newest effects so
      // the draw list can't balloon when hundreds of shots fire at once.
      if (this.activeFx.length > MAX_FX) this.activeFx.splice(0, this.activeFx.length - MAX_FX);
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
        // Muzzle flash at the effector for the first instant of the shot.
        if (k > 0.6) this.fxGfx.circle(from.x, from.y, 2 + (k - 0.6) * 10).fill({ color, alpha: (k - 0.6) * 1.6 });
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
      } else if (a.fx.kind === "seam") {
        // A drill leak that got through UNTRACKED: a hard red crosshair burst —
        // the seam nobody was watching, punched home.
        const at = planeToPixel(a.fx.at);
        const r = 10 + (1 - k) * 26;
        this.fxGfx
          .ellipse(at.x, at.y, r, r * ISO_SQUASH)
          .stroke({ color: COLORS.bad, width: 3, alpha: k })
          .moveTo(at.x - r, at.y).lineTo(at.x + r, at.y)
          .moveTo(at.x, at.y - r * ISO_SQUASH).lineTo(at.x, at.y + r * ISO_SQUASH)
          .stroke({ color: COLORS.bad, width: 1.5, alpha: 0.7 * k });
      } else if (a.fx.kind === "dogpile") {
        // Two+ effectors wasted on one drone: an amber "WASTED" burst ring.
        const at = planeToPixel(a.fx.at);
        const r = 6 + (1 - k) * 16;
        this.fxGfx.ellipse(at.x, at.y, r, r * ISO_SQUASH).stroke({ color: COLORS.seam, width: 2, alpha: 0.8 * k });
      }
    }
    this.activeFx = survivors;

    // Spark particles (spawn flashes, kill bursts) — drift out and fade.
    const live: Spark[] = [];
    for (const p of this.sparks) {
      p.age += dt;
      const k = 1 - p.age / p.ttl;
      if (k <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      live.push(p);
      this.fxGfx.circle(p.x, p.y, p.size * k + 0.5).fill({ color: p.color, alpha: 0.85 * k });
    }
    this.sparks = live;
  }

  // ---- primitives --------------------------------------------------------

  private hexTile(g: Graphics, c: Px, fill: number, line: number, fillAlpha = 0.92): void {
    const pts = hexCorners(c);
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath().fill({ color: fill, alpha: fillAlpha }).stroke({ color: line, width: 1, alpha: 0.4 });
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
