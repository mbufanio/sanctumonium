/**
 * Boss assignment console (spec §6) — the interactive DOM/SVG overlay where the
 * lesson is taught. A radial command-scope shows the asset, the incoming
 * threats (by bearing & distance) and the available sensors/effectors. The
 * player taps a threat, then taps a sensor and an effector to cover it.
 *
 * Two visual modes, driven by session.brain:
 *   • brain OFF (Boss #1): odds are hidden ("?"), no optimal hint, no warnings.
 *   • brain ON  (Boss #2): odds visible, optimal pick highlightable, handoff
 *     lines glow in the brain accent, deconfliction warnings appear.
 *
 * Rendering only — all rules come from sim/boss/engine.ts. Re-renders wholesale
 * on each change (the roster is tiny, so this is simple and fast).
 */
import { COLORS, css, rgba } from "../theme.ts";
import { computeOdds, expectedStopped } from "../sim/boss/engine.ts";
import { THREAT_TYPES } from "../sim/boss/data.ts";
import type { DeviceUnit, ThreatUnit } from "../sim/boss/types.ts";
import type { BossSession } from "../sim/state.ts";

export interface BossConsoleCallbacks {
  onSelectThreat(threatId: string): void;
  onAssignSensor(sensorId: string): void;
  onAssignEffector(effectorId: string): void;
  onApplyOptimal(): void;
  onEngage(): void;
  onContinue(): void;
}

const NS = "http://www.w3.org/2000/svg";

export class BossConsole {
  private root: HTMLElement;
  private host: HTMLElement;
  private cb: BossConsoleCallbacks;
  /** Which boss has already played its threats-fly-in animation. */
  private animatedBoss: string | null = null;

  constructor(root: HTMLElement, cb: BossConsoleCallbacks) {
    // Own a dedicated container so clearing the console never wipes sibling
    // overlays (the HUD bar lives in the same root). display:contents keeps it
    // layout-neutral when empty so it can't intercept field taps.
    this.root = root;
    this.host = document.createElement("div");
    this.host.className = "boss-host";
    root.append(this.host);
    this.cb = cb;
  }

  /** Re-attach the host if a sibling overlay wiped the shared root (innerHTML). */
  private ensureHost(): void {
    if (!this.host.isConnected) this.root.append(this.host);
  }

  clear(): void {
    this.ensureHost();
    this.host.innerHTML = "";
    this.animatedBoss = null; // next boss shown should fly its threats in again
  }

  render(s: BossSession): void {
    // Animate the inbound threats only the first time we show a given boss
    // (not on every re-render when the player taps an assignment).
    const animateIn = !s.result && this.animatedBoss !== s.cfg.id;
    if (!s.result) this.animatedBoss = s.cfg.id;

    this.ensureHost();
    this.host.innerHTML = "";
    const panel = el("div", "boss");
    panel.append(this.header(s));
    if (s.result) {
      panel.append(this.scope(s, false), this.resultPanel(s));
    } else {
      panel.append(this.scope(s, animateIn), this.controls(s));
    }
    this.host.append(panel);
  }

  // ---- header ------------------------------------------------------------

  private header(s: BossSession): HTMLElement {
    const h = el("div", "boss-header");
    const title = el("div", "boss-title");
    title.textContent = s.cfg.title;
    const mode = el("div", "boss-mode " + (s.brain ? "on" : "off"));
    mode.textContent = s.brain ? "◈ COORDINATION ONLINE" : "⚠ NO COORDINATION — MANUAL";
    h.append(title, mode);
    return h;
  }

  // ---- the radial scope --------------------------------------------------

  private scope(s: BossSession, animateIn: boolean): SVGSVGElement {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.classList.add("boss-scope");

    const cx = 50;
    const cy = 50;
    const maxDist = Math.max(...s.cfg.threats.map((t) => t.distance), 1);
    const maxDevDist = Math.max(...[...s.cfg.sensors, ...s.cfg.effectors].map((d) => d.distance ?? 2), 1);

    // Range rings.
    for (const rr of [16, 26, 36, 44]) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", String(cx));
      c.setAttribute("cy", String(cy));
      c.setAttribute("r", String(rr));
      c.setAttribute("fill", "none");
      c.setAttribute("stroke", rgba(COLORS.coverage, 0.12));
      c.setAttribute("stroke-width", "0.4");
      svg.append(c);
    }

    // Position helpers. Threats sit on the outer band by distance; devices on
    // an inner band, spread by their real distance from the asset so a big
    // roster doesn't collapse onto one ring.
    const threatPos = (t: ThreatUnit) => polar(cx, cy, 18 + (t.distance / maxDist) * 26, t.bearing);
    const devPos = (d: DeviceUnit) => polar(cx, cy, 7.5 + ((d.distance ?? 2) / maxDevDist) * 7.5, d.bearing);
    const rimPos = (t: ThreatUnit) => polar(cx, cy, 47, t.bearing);

    // Assignment lines (drawn under the markers).
    for (const t of s.cfg.threats) {
      const a = s.map[t.id];
      if (!a) continue;
      const tp = threatPos(t);
      if (a.sensorId) {
        const d = s.cfg.sensors.find((x) => x.id === a.sensorId);
        if (d) this.line(svg, devPos(d), tp, s.brain ? COLORS.brain : COLORS.friendlyDim, true, s.brain);
      }
      if (a.effectorId) {
        const d = s.cfg.effectors.find((x) => x.id === a.effectorId);
        if (d) this.line(svg, devPos(d), tp, s.brain ? COLORS.brain : COLORS.friendly, false, s.brain);
      }
    }

    // Asset core.
    this.dot(svg, cx, cy, 3.2, COLORS.asset, COLORS.assetCore);
    this.label(svg, cx, cy + 6.5, "ASSET", COLORS.textDim, 2.6);

    // Devices. Sensors = teal circles, effectors = blue squares — distinct
    // shapes plus a short code tag. Each marker is TAPPABLE: with a threat
    // selected, tapping a device assigns it (sensor→track, effector→engage),
    // so the player can plan straight on the scope (in addition to the trays).
    for (const d of [...s.cfg.sensors, ...s.cfg.effectors]) {
      const p = devPos(d);
      const isSensor = d.kind === "sensor";
      const color = isSensor ? COLORS.coverage : COLORS.friendly;
      const sel = s.selectedThreatId ? s.map[s.selectedThreatId] : null;
      const assigned = sel && (isSensor ? sel.sensorId : sel.effectorId) === d.id;
      const g = document.createElementNS(NS, "g");
      g.classList.add("scope-dev");
      if (s.selectedThreatId) g.classList.add("tappable");
      if (assigned) {
        const ring = document.createElementNS(NS, "circle");
        ring.setAttribute("cx", String(p.x));
        ring.setAttribute("cy", String(p.y));
        ring.setAttribute("r", "3.6");
        ring.setAttribute("fill", "none");
        ring.setAttribute("stroke", css(s.brain ? COLORS.brain : color));
        ring.setAttribute("stroke-width", "0.6");
        g.append(ring);
      }
      if (isSensor) this.dotEl(g, p.x, p.y, 1.9, COLORS.panel, color);
      else this.squareEl(g, p.x, p.y, 3.4, COLORS.panel, color);
      const out = p.y < cy ? -3.0 : 3.4;
      this.labelEl(g, p.x, p.y + out, d.code, color, 2.1);
      // Generous transparent hit target for touch.
      this.hitCircle(g, p.x, p.y, 5.5);
      g.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (isSensor) this.cb.onAssignSensor(d.id);
        else this.cb.onAssignEffector(d.id);
      });
      svg.append(g);
    }

    // Threats. Red triangles + a type code; tapping one selects it.
    for (const t of s.cfg.threats) {
      const p = threatPos(t);
      const sel = s.selectedThreatId === t.id;
      const tt = THREAT_TYPES[t.typeId];
      const g = document.createElementNS(NS, "g");
      g.classList.add("scope-threat", "tappable");
      if (sel) {
        const ring = document.createElementNS(NS, "circle");
        ring.setAttribute("cx", String(p.x));
        ring.setAttribute("cy", String(p.y));
        ring.setAttribute("r", "4.6");
        ring.setAttribute("fill", "none");
        ring.setAttribute("stroke", css(COLORS.brainGold));
        ring.setAttribute("stroke-width", "0.7");
        g.append(ring);
      }
      this.triangleEl(g, p.x, p.y, 3.0, COLORS.threatDeep, COLORS.threat);
      this.labelEl(g, p.x, p.y - 3.6, t.label, COLORS.threatTrack, 2.1);
      this.labelEl(g, p.x, p.y + 4.0, tt.code, COLORS.threat, 2.1);
      this.hitCircle(g, p.x, p.y, 5.5);
      g.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.cb.onSelectThreat(t.id);
      });
      // Fly-in: start at the outer rim and slide to the resting position.
      if (animateIn) {
        const r = rimPos(t);
        const at = document.createElementNS(NS, "animateTransform");
        at.setAttribute("attributeName", "transform");
        at.setAttribute("type", "translate");
        at.setAttribute("values", `${(r.x - p.x).toFixed(1)} ${(r.y - p.y).toFixed(1)};0 0`);
        at.setAttribute("keyTimes", "0;1");
        at.setAttribute("dur", "0.85s");
        at.setAttribute("begin", `${(0.06 * s.cfg.threats.indexOf(t)).toFixed(2)}s`);
        at.setAttribute("calcMode", "spline");
        at.setAttribute("keySplines", "0.2 0.7 0.2 1");
        at.setAttribute("fill", "freeze");
        g.append(at);
      }
      svg.append(g);
    }

    return svg;
  }

  // ---- controls (pre-resolution) -----------------------------------------

  private controls(s: BossSession): HTMLElement {
    const wrap = el("div", "boss-controls");

    // Threat strip with odds badges.
    const threats = el("div", "threat-strip");
    for (const t of s.cfg.threats) {
      const a = s.map[t.id];
      const odds = computeOdds(s.cfg, t, a?.sensorId ?? null, a?.effectorId ?? null);
      const tt = THREAT_TYPES[t.typeId];
      const chip = el("button", "threat-chip" + (s.selectedThreatId === t.id ? " sel" : ""));
      chip.onclick = () => this.cb.onSelectThreat(t.id);

      const top = el("div", "chip-top");
      top.innerHTML = `<span class="chip-icon">${tt.icon}</span><span class="chip-name">${t.label}</span>`;
      const badge = el("div", "chip-badge " + oddsClass(odds.p, odds.unengaged, s.brain));
      badge.textContent = s.brain ? (odds.unengaged ? "OPEN" : pct(odds.p)) : odds.unengaged ? "—" : "?";
      const sub = el("div", "chip-sub");
      sub.textContent = tt.name;
      chip.append(top, badge, sub);
      threats.append(chip);
    }
    wrap.append(this.sectionLabel("Incoming"), threats);

    // Selected-threat assignment trays.
    const sel = s.selectedThreatId ? s.cfg.threats.find((t) => t.id === s.selectedThreatId) ?? null : null;
    wrap.append(this.deviceTray(s, sel, "sensor"), this.deviceTray(s, sel, "effector"));

    // Brain extras + actions.
    if (s.brain) wrap.append(this.brainPanel(s));
    wrap.append(this.actions(s));
    return wrap;
  }

  private deviceTray(s: BossSession, sel: ThreatUnit | null, kind: "sensor" | "effector"): HTMLElement {
    const tray = el("div", "device-tray");
    const list = kind === "sensor" ? s.cfg.sensors : s.cfg.effectors;
    tray.append(this.sectionLabel(kind === "sensor" ? "Sensors" : "Effectors"));
    const row = el("div", "device-row");
    for (const d of list) {
      // Is this device used by some threat already?
      let usedBy: string | null = null;
      for (const t of s.cfg.threats) {
        const a = s.map[t.id];
        if (!a) continue;
        if ((kind === "sensor" ? a.sensorId : a.effectorId) === d.id) usedBy = t.label;
      }
      const assignedToSel = sel && (kind === "sensor" ? s.map[sel.id]?.sensorId : s.map[sel.id]?.effectorId) === d.id;
      const btn = el("button", "device-btn" + (assignedToSel ? " active" : "") + (usedBy && !assignedToSel ? " busy" : "")) as HTMLButtonElement;
      btn.disabled = !sel;
      btn.onclick = () => (kind === "sensor" ? this.cb.onAssignSensor(d.id) : this.cb.onAssignEffector(d.id));

      // VATS-style pre-commit prediction: with the brain on, show the success
      // % this device WOULD give the selected threat if chosen — computed
      // against the threat's other current assignment. The 0% on a bad matchup
      // (e.g. jammer vs an autonomy drone) teaches the lesson without words.
      let preview = "";
      if (s.brain && sel) {
        const cur = s.map[sel.id] ?? { sensorId: null, effectorId: null };
        const odds =
          kind === "sensor"
            ? computeOdds(s.cfg, sel, d.id, cur.effectorId)
            : computeOdds(s.cfg, sel, cur.sensorId, d.id);
        // A sensor's value only shows once an effector is firing; otherwise "—".
        const showable = kind === "effector" || cur.effectorId;
        const cls = showable ? oddsClass(odds.p, false, true) : "hidden";
        const txt = showable ? pct(odds.p) : "—";
        preview = `<span class="dev-pred ${cls}">${txt}</span>`;
      }

      const right = usedBy
        ? `<span class="dev-used">→ ${usedBy}</span>`
        : `<span class="dev-rng">${d.range.toFixed(1)} km</span>`;
      btn.innerHTML =
        `<span class="dev-code">${d.code}</span>` +
        `<span class="dev-name">${d.name}</span>` +
        `<span class="dev-role">${d.role}</span>` +
        right +
        preview;
      row.append(btn);
    }
    tray.append(row);
    return tray;
  }

  private brainPanel(s: BossSession): HTMLElement {
    const p = el("div", "brain-panel");
    const head = el("div", "brain-head");
    head.innerHTML = `<span class="brain-dot">◈</span> Coordination`;
    p.append(head);

    const exp = expectedStopped(s.cfg, s.map);
    const optExp = s.optimal ? expectedStopped(s.cfg, s.optimal) : exp;
    const stat = el("div", "brain-stat");
    stat.innerHTML =
      `Projected: <b>${exp.toFixed(1)}</b> / ${s.cfg.threats.length} stopped` +
      (optExp > exp + 0.05
        ? ` &nbsp;·&nbsp; <span class="brain-opt-hint">best plan: ${optExp.toFixed(1)}</span>`
        : ` &nbsp;·&nbsp; <span class="brain-ok">optimal</span>`);
    p.append(stat);

    const apply = el("button", "brain-apply");
    apply.textContent = "◈ Apply optimal plan";
    apply.onclick = () => this.cb.onApplyOptimal();
    p.append(apply);
    return p;
  }

  private actions(s: BossSession): HTMLElement {
    const a = el("div", "boss-actions");
    const assignedCount = s.cfg.threats.filter((t) => s.map[t.id]?.effectorId).length;
    const engage = el("button", "btn-engage");
    engage.textContent = `ENGAGE (${assignedCount}/${s.cfg.threats.length} covered)`;
    engage.onclick = () => this.cb.onEngage();
    a.append(engage);
    return a;
  }

  // ---- result panel ------------------------------------------------------

  private resultPanel(s: BossSession): HTMLElement {
    const r = s.result!;
    const wrap = el("div", "boss-result");
    const verdict = el("div", "result-verdict " + (r.won ? (r.rescued ? "narrow" : "win") : "loss"));
    verdict.textContent = r.rescued
      ? "BARELY HELD — the post took damage"
      : r.won
        ? s.brain
          ? "CLEAN SWEEP"
          : "HELD THE LINE"
        : "ASSET LOST";
    wrap.append(verdict);

    const tally = el("div", "result-tally");
    for (const tr of r.results) {
      const t = s.cfg.threats.find((x) => x.id === tr.threatId)!;
      const row = el("div", "result-row " + (tr.stopped ? "stopped" : "leaked"));
      row.innerHTML = `<span>${t.label}</span><span class="r-p">${pct(tr.p)}</span><span class="r-out">${tr.stopped ? "STOPPED" : "LEAKED"}</span>`;
      tally.append(row);
    }
    wrap.append(tally);

    const sub = el("div", "result-sub");
    sub.textContent = s.brain ? "Every shot pre-checked." : "Odds hidden. Outcome left to chance.";
    wrap.append(sub);

    const cont = el("button", "btn-continue");
    cont.textContent = s.brain ? "Continue" : "Continue";
    cont.onclick = () => this.cb.onContinue();
    wrap.append(cont);
    return wrap;
  }

  // ---- svg primitives ----------------------------------------------------

  private line(svg: SVGSVGElement, a: P, b: P, color: number, dashed: boolean, glow: boolean): void {
    const l = document.createElementNS(NS, "line");
    l.setAttribute("x1", String(a.x));
    l.setAttribute("y1", String(a.y));
    l.setAttribute("x2", String(b.x));
    l.setAttribute("y2", String(b.y));
    l.setAttribute("stroke", css(color));
    l.setAttribute("stroke-width", dashed ? "0.4" : "0.7");
    if (dashed) l.setAttribute("stroke-dasharray", "1.2 1.0");
    l.setAttribute("opacity", glow ? "0.95" : "0.7");
    if (glow) l.setAttribute("filter", "url(#brainglow)");
    svg.append(l);
    if (glow) this.ensureGlow(svg);
  }

  private ensureGlow(svg: SVGSVGElement): void {
    if (svg.querySelector("#brainglow")) return;
    const defs = document.createElementNS(NS, "defs");
    defs.innerHTML =
      `<filter id="brainglow" x="-50%" y="-50%" width="200%" height="200%">` +
      `<feGaussianBlur stdDeviation="0.7" result="b"/>` +
      `<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
    svg.insertBefore(defs, svg.firstChild);
  }

  private dot(svg: Element, x: number, y: number, r: number, fill: number, stroke: number): void {
    this.dotEl(svg, x, y, r, fill, stroke);
  }
  private dotEl(parent: Element, x: number, y: number, r: number, fill: number, stroke: number): void {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", String(x));
    c.setAttribute("cy", String(y));
    c.setAttribute("r", String(r));
    c.setAttribute("fill", css(fill));
    c.setAttribute("stroke", css(stroke));
    c.setAttribute("stroke-width", "0.6");
    parent.append(c);
  }

  private squareEl(parent: Element, x: number, y: number, size: number, fill: number, stroke: number): void {
    const r = document.createElementNS(NS, "rect");
    r.setAttribute("x", String(x - size / 2));
    r.setAttribute("y", String(y - size / 2));
    r.setAttribute("width", String(size));
    r.setAttribute("height", String(size));
    r.setAttribute("rx", "0.6");
    r.setAttribute("fill", css(fill));
    r.setAttribute("stroke", css(stroke));
    r.setAttribute("stroke-width", "0.6");
    parent.append(r);
  }

  private triangleEl(parent: Element, x: number, y: number, size: number, fill: number, stroke: number): void {
    const h = size;
    const pts = `${x},${y - h} ${x + h * 0.9},${y + h * 0.7} ${x - h * 0.9},${y + h * 0.7}`;
    const t = document.createElementNS(NS, "polygon");
    t.setAttribute("points", pts);
    t.setAttribute("fill", css(fill));
    t.setAttribute("stroke", css(stroke));
    t.setAttribute("stroke-width", "0.6");
    parent.append(t);
  }

  /** A transparent oversized circle so touch taps land easily on a marker. */
  private hitCircle(parent: Element, x: number, y: number, r: number): void {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", String(x));
    c.setAttribute("cy", String(y));
    c.setAttribute("r", String(r));
    c.setAttribute("fill", "transparent");
    c.setAttribute("pointer-events", "all");
    parent.append(c);
  }

  private label(svg: Element, x: number, y: number, text: string, color: number, size: number): void {
    this.labelEl(svg, x, y, text, color, size);
  }
  private labelEl(parent: Element, x: number, y: number, text: string, color: number, size: number): void {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", String(x));
    t.setAttribute("y", String(y));
    t.setAttribute("fill", css(color));
    t.setAttribute("font-size", String(size));
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("dominant-baseline", "middle");
    t.classList.add("scope-label");
    t.textContent = text;
    parent.append(t);
  }

  private sectionLabel(text: string): HTMLElement {
    const s = el("div", "section-label");
    s.textContent = text;
    return s;
  }
}

// ---- helpers -------------------------------------------------------------

interface P {
  x: number;
  y: number;
}

function polar(cx: number, cy: number, r: number, bearingDeg: number): P {
  const rad = ((bearingDeg - 90) * Math.PI) / 180; // 0deg = north (up)
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function pct(p: number): string {
  return Math.round(p * 100) + "%";
}

function oddsClass(p: number, unengaged: boolean, brain: boolean): string {
  if (!brain) return "hidden";
  if (unengaged) return "open";
  if (p >= 0.75) return "good";
  if (p >= 0.45) return "mid";
  return "bad";
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
