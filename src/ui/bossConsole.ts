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
import { EFFECTOR_TYPES, SENSOR_TYPES, THREAT_TYPES } from "../sim/boss/data.ts";
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
  private cb: BossConsoleCallbacks;

  constructor(root: HTMLElement, cb: BossConsoleCallbacks) {
    this.root = root;
    this.cb = cb;
  }

  clear(): void {
    this.root.innerHTML = "";
  }

  render(s: BossSession): void {
    this.clear();
    const panel = el("div", "boss");
    panel.append(this.header(s));
    if (s.result) {
      panel.append(this.scope(s), this.resultPanel(s));
    } else {
      panel.append(this.scope(s), this.controls(s));
    }
    this.root.append(panel);
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

  private scope(s: BossSession): SVGSVGElement {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.classList.add("boss-scope");

    const cx = 50;
    const cy = 50;
    const maxDist = Math.max(...s.cfg.threats.map((t) => t.distance), 1);

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

    // Position helpers.
    const threatPos = (t: ThreatUnit) => polar(cx, cy, 18 + (t.distance / maxDist) * 26, t.bearing);
    const devPos = (d: DeviceUnit) => polar(cx, cy, 11, d.bearing);

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
    // shapes plus a short code tag so each one is identifiable at a glance.
    for (const d of [...s.cfg.sensors, ...s.cfg.effectors]) {
      const p = devPos(d);
      const isSensor = d.id.startsWith("s-");
      const type = isSensor ? SENSOR_TYPES[d.typeId as keyof typeof SENSOR_TYPES] : EFFECTOR_TYPES[d.typeId as keyof typeof EFFECTOR_TYPES];
      const color = isSensor ? COLORS.coverage : COLORS.friendly;
      if (isSensor) this.dot(svg, p.x, p.y, 1.9, COLORS.panel, color);
      else this.square(svg, p.x, p.y, 3.4, COLORS.panel, color);
      // Code tag, offset outward from the asset so it never sits on the dot.
      const out = p.y < cy ? -3.0 : 3.4;
      this.label(svg, p.x, p.y + out, type.code, color, 2.1);
    }

    // Threats. Red triangles + a type code so the matchup is readable.
    for (const t of s.cfg.threats) {
      const p = threatPos(t);
      const sel = s.selectedThreatId === t.id;
      const tt = THREAT_TYPES[t.typeId];
      if (sel) {
        const ring = document.createElementNS(NS, "circle");
        ring.setAttribute("cx", String(p.x));
        ring.setAttribute("cy", String(p.y));
        ring.setAttribute("r", "4.6");
        ring.setAttribute("fill", "none");
        ring.setAttribute("stroke", css(COLORS.brainGold));
        ring.setAttribute("stroke-width", "0.7");
        svg.append(ring);
      }
      this.triangle(svg, p.x, p.y, 3.0, COLORS.threatDeep, COLORS.threat);
      this.label(svg, p.x, p.y - 3.6, t.label, COLORS.threatTrack, 2.1);
      this.label(svg, p.x, p.y + 4.0, tt.code, COLORS.threat, 2.1);
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
      const type = kind === "sensor" ? SENSOR_TYPES[d.typeId as keyof typeof SENSOR_TYPES] : EFFECTOR_TYPES[d.typeId as keyof typeof EFFECTOR_TYPES];
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
        : `<span class="dev-rng">${type.range} km</span>`;
      btn.innerHTML =
        `<span class="dev-code">${type.code}</span>` +
        `<span class="dev-name">${type.name}</span>` +
        `<span class="dev-role">${type.role}</span>` +
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

  private dot(svg: SVGSVGElement, x: number, y: number, r: number, fill: number, stroke: number): void {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", String(x));
    c.setAttribute("cy", String(y));
    c.setAttribute("r", String(r));
    c.setAttribute("fill", css(fill));
    c.setAttribute("stroke", css(stroke));
    c.setAttribute("stroke-width", "0.6");
    svg.append(c);
  }

  private square(svg: SVGSVGElement, x: number, y: number, size: number, fill: number, stroke: number): void {
    const r = document.createElementNS(NS, "rect");
    r.setAttribute("x", String(x - size / 2));
    r.setAttribute("y", String(y - size / 2));
    r.setAttribute("width", String(size));
    r.setAttribute("height", String(size));
    r.setAttribute("rx", "0.6");
    r.setAttribute("fill", css(fill));
    r.setAttribute("stroke", css(stroke));
    r.setAttribute("stroke-width", "0.6");
    svg.append(r);
  }

  private triangle(svg: SVGSVGElement, x: number, y: number, size: number, fill: number, stroke: number): void {
    const h = size;
    const pts = `${x},${y - h} ${x + h * 0.9},${y + h * 0.7} ${x - h * 0.9},${y + h * 0.7}`;
    const t = document.createElementNS(NS, "polygon");
    t.setAttribute("points", pts);
    t.setAttribute("fill", css(fill));
    t.setAttribute("stroke", css(stroke));
    t.setAttribute("stroke-width", "0.6");
    svg.append(t);
  }

  private label(svg: SVGSVGElement, x: number, y: number, text: string, color: number, size: number): void {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", String(x));
    t.setAttribute("y", String(y));
    t.setAttribute("fill", css(color));
    t.setAttribute("font-size", String(size));
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("dominant-baseline", "middle");
    t.classList.add("scope-label");
    t.textContent = text;
    svg.append(t);
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
