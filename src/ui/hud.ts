/**
 * Build / wave HUD (spec §3 readability, §5 loop, §8 economy).
 *
 * A persistent top status bar (stage · currency · integrity · score) plus a
 * bottom build dock shown only between waves. Big, few numbers; large touch
 * targets. Placement itself happens by tapping the field (handled by the
 * controller) — the dock just selects what to place and starts the wave.
 *
 * The HUD sits at the screen edges so the centre of the field stays open for
 * taps; only the actual controls capture pointer events.
 */
import { placeablesForTier, placeableById, nextUpgrade, deviceStats, type Placeable } from "../sim/realtime/catalog.ts";
import { RANGE_SCALE } from "../sim/realtime/catalog.ts";
import type { Recommendation } from "../sim/realtime/adaptive.ts";
import type { GameState } from "../sim/state.ts";
import type { ThreatTypeId } from "../sim/boss/types.ts";

/** The three threat types a spec card grades a device against. */
const MATCHUP_THREATS: Array<{ id: ThreatTypeId; icon: string; label: string }> = [
  { id: "rf-quad", icon: "✚", label: "RF QUAD" },
  { id: "autonomy", icon: "◆", label: "AUTONOMY" },
  { id: "low-observable", icon: "▲", label: "STEALTH" },
];

/** Grade a matchup value into a booth-legible label + css class. */
function grade(v: number, sensor: boolean): { label: string; cls: string } {
  if (v <= 0) return { label: sensor ? "BLIND" : "NO EFFECT", cls: "g0" };
  if (v < 0.5) return { label: sensor ? "FAINT" : "WEAK", cls: "g1" };
  if (v < 0.9) return { label: "GOOD", cls: "g2" };
  return { label: "EXCELLENT", cls: "g3" };
}

export interface ScriptedDockOpts {
  kind: "deploy" | "locked";
  placed?: number;
  total?: number;
  startLabel: string;
  onStart(): void;
}

export interface HudCallbacks {
  onSelectPlaceable(id: string): void;
  onStartWave(): void;
  onSell(deviceId: string): void;
  onAcceptRec(): void;
  onDismissRec(): void;
  onUpgradeDevice(): void;
  onSellDevice(): void;
  onCloseDevice(): void;
}

export class Hud {
  private root: HTMLElement;
  private cb: HudCallbacks;
  private bar: HTMLElement | null = null;
  private dock: HTMLElement | null = null;
  private info: HTMLElement | null = null;
  private refs: Record<string, HTMLElement> = {};

  constructor(root: HTMLElement, cb: HudCallbacks) {
    this.root = root;
    this.cb = cb;
  }

  clear(): void {
    this.bar?.remove();
    this.dock?.remove();
    this.hideInfoCard();
    this.bar = null;
    this.dock = null;
    this.refs = {};
  }

  // ---- device spec cards (tap a unit → what it is, how it really works) ----

  /** The shared spec-card body: role, real-world grounding, key stats, and a
   *  matchup meter vs each threat type — the same DOM in the floating field
   *  card, the arcade device panel, and the palette-selection preview. */
  private specBody(p: Placeable, level: number): HTMLElement {
    const st = deviceStats(p, level);
    const body = el("div", "spec-body");
    const sensor = p.kind === "sensor";

    const stats: string[] = [`<span class="spec-stat"><b>${(st.radius / RANGE_SCALE).toFixed(1)} km</b> range</span>`];
    if (sensor) {
      stats.push(`<span class="spec-stat"><b>${st.trackCapacity}</b> simultaneous tracks</span>`);
    } else {
      stats.push(`<span class="spec-stat"><b>${st.fireInterval.toFixed(1)}s</b> between shots</span>`);
      if (st.magazine > 0) stats.push(`<span class="spec-stat"><b>${st.magazine}</b>-shot magazine · ${st.reloadTime.toFixed(1)}s reload</span>`);
      if (st.aoe > 0) stats.push(`<span class="spec-stat"><b>${(st.aoe / RANGE_SCALE).toFixed(1)} km</b> blast radius</span>`);
    }

    const rows = MATCHUP_THREATS.map((t) => {
      const v = sensor ? st.track[t.id] : st.effect[t.id];
      const g = grade(v, sensor);
      return `
        <div class="mu-row">
          <span class="mu-threat">${t.icon} ${t.label}</span>
          <span class="mu-bar"><span class="mu-fill ${g.cls}" style="width:${Math.round(Math.max(0.04, v) * 100)}%"></span></span>
          <span class="mu-tag ${g.cls}">${g.label}</span>
        </div>`;
    }).join("");

    body.innerHTML = `
      <div class="spec-info">${p.info}</div>
      <div class="spec-stats">${stats.join("")}</div>
      <div class="spec-mu">
        <div class="mu-head">${sensor ? "CAN IT TRACK…" : "CAN IT STOP…"}</div>
        ${rows}
      </div>
    `;
    return body;
  }

  /** Floating spec card anchored near a tapped field unit (Act-1 / raids). */
  showInfoCard(placeableId: string, level: number, anchor: { x: number; y: number }): void {
    const p = placeableById(placeableId);
    if (!p) return;
    this.hideInfoCard();
    const card = el("div", "spec-card");
    card.id = "spec-card";
    const head = el("div", "spec-head");
    head.innerHTML = `
      <span class="pal-code ${p.kind}">${p.code}</span>
      <span class="spec-name">${p.name}</span>
      <span class="spec-kind">${p.kind === "sensor" ? "SENSOR · the eyes" : "EFFECTOR · the stopper"}</span>
    `;
    const close = el("button", "spec-close") as HTMLButtonElement;
    close.textContent = "✕";
    close.onclick = () => {
      this.hideInfoCard();
      this.cb.onCloseDevice();
    };
    head.append(close);
    card.append(head, this.specBody(p, level));
    document.body.append(card);
    // Anchor beside the unit, clamped on-screen (measure after attach).
    const r = card.getBoundingClientRect();
    const pad = 12;
    let x = anchor.x + 26;
    if (x + r.width + pad > window.innerWidth) x = anchor.x - r.width - 26;
    const y = Math.min(Math.max(pad, anchor.y - r.height / 2), window.innerHeight - r.height - pad);
    card.style.left = `${Math.max(pad, x)}px`;
    card.style.top = `${y}px`;
    requestAnimationFrame(() => card.classList.add("show"));
    this.info = card;
  }

  hideInfoCard(): void {
    this.info?.remove();
    this.info = null;
  }

  /** Create the persistent status bar (idempotent + self-healing).
   *
   * Other overlays (boss console, screens) historically cleared the SHARED
   * overlay root, detaching this bar while we still held a reference — so the
   * money/wave readout silently vanished after the first boss/wave. Guard on
   * isConnected so a detached bar is rebuilt rather than assumed present. */
  private ensureBar(): void {
    if (this.bar && this.bar.isConnected) return;
    this.bar = null;
    this.refs = {};
    const bar = el("div", "hud-bar");
    bar.innerHTML = `
      <div class="hud-stat"><span class="hud-k">STAGE</span><span class="hud-v" data-ref="stage">—</span></div>
      <div class="hud-stat"><span class="hud-k">FUNDS</span><span class="hud-v funds" data-ref="funds">—</span></div>
      <div class="hud-stat integrity"><span class="hud-k">INTEGRITY</span>
        <div class="integ-bar"><div class="integ-fill" data-ref="integfill"></div><span class="integ-num" data-ref="integnum"></span></div>
      </div>
      <div class="hud-stat"><span class="hud-k">SCORE</span><span class="hud-v" data-ref="score">0</span></div>
      <div class="hud-coord" data-ref="coord">◈ COORDINATION ACTIVE</div>
    `;
    this.root.append(bar);
    this.bar = bar;
    bar.querySelectorAll<HTMLElement>("[data-ref]").forEach((n) => (this.refs[n.dataset.ref!] = n));
  }

  /** Update the live values in the status bar (call every frame). */
  update(state: GameState): void {
    this.ensureBar();
    const arcade = state.act === "arcade";
    this.bar?.classList.toggle("arcade", arcade);
    // Act 1 has no economy — the laydown is fixed. Hide FUNDS so the screen
    // never implies the player is buying their way through. It returns in arcade.
    this.bar?.classList.toggle("no-funds", !arcade);
    const entry = state.scheduleIndex;
    this.refs.stage.textContent = state.phase === "wave" && state.activeWave ? state.activeWave.label : `Step ${entry + 1}`;
    this.refs.funds.textContent = `$${Math.floor(state.currency)}`;
    this.refs.score.textContent = String(Math.floor(state.score));
    const coordActive = state.brainUnlocked && !state.brainStaffDisabled;
    this.refs.coord.classList.toggle("on", coordActive);
    // In the arcade act the coordination chip becomes the ARCADE / SURVIVE badge.
    this.refs.coord.textContent = arcade ? "◆ ARCADE · SURVIVE" : "◈ COORDINATION ACTIVE";
    this.refs.coord.classList.toggle("arcade", arcade);
    const frac = Math.max(0, state.integrity / state.maxIntegrity);
    this.refs.integfill.style.width = `${frac * 100}%`;
    this.refs.integfill.className = "integ-fill " + (frac > 0.5 ? "ok" : frac > 0.25 ? "warn" : "crit");
    this.refs.integnum.textContent = String(Math.max(0, Math.ceil(state.integrity)));
    if (arcade) {
      const inbound = state.rt ? (state.activeWave ? state.activeWave.spawns.length - state.rt.spawnCursor : 0) + state.rt.drones.length : 0;
      this.refs.stage.textContent = `◆ ARCADE · WAVE ${state.arcadeWave}${state.phase === "wave" ? ` · ${inbound} inbound` : ""}`;
    } else if (state.phase === "wave" && state.rt && state.activeWave) {
      // Live drones-remaining hint during an ops wave.
      const remaining = state.activeWave.spawns.length - state.rt.spawnCursor + state.rt.drones.length;
      this.refs.stage.textContent = `${state.activeWave.label} · ${remaining} inbound`;
    }
  }

  /**
   * Show the build dock. Between waves it has the "start wave" button and the
   * brain recommendation; mid-wave (arcade act) it's a compact "reinforce" dock
   * — palette only, no start button — so the player deploys live without
   * pausing the fight.
   */
  showBuild(state: GameState, nextLabel: string, rec: Recommendation | null, midWave = false): void {
    this.ensureBar();
    this.dock?.remove();
    const dock = el("div", "build-dock" + (midWave ? " mid-wave" : ""));

    const selDev = state.selectedDeviceId ? state.placed.find((d) => d.id === state.selectedDeviceId) ?? null : null;
    if (selDev) {
      // Selected a placed device → its upgrade/sell panel (spec §7).
      dock.append(this.devicePanel(selDev, state));
    } else {
      // Brain recommendation (face 3) — suggest-and-accept, only after unlock.
      if (rec) dock.append(this.recCard(rec, state));

      const hint = el("div", "build-hint");
      hint.textContent = midWave
        ? "◈ DEPLOY LIVE — tap a weapon, then tap the field to reinforce"
        : state.selectedPlaceable
          ? "Tap the field to place · tap a placed device to upgrade it"
          : "Pick a device to place, or tap a placed device to upgrade";
      dock.append(hint);

      // Palette-selection preview: picking a device to buy shows its full spec
      // card above the palette (between-waves planning only — mid-wave stays lean).
      if (!midWave && state.selectedPlaceable) {
        const sel = placeableById(state.selectedPlaceable);
        if (sel) {
          const preview = el("div", "spec-preview");
          const head = el("div", "spec-head");
          head.innerHTML = `<span class="pal-code ${sel.kind}">${sel.code}</span><span class="spec-name">${sel.name}</span><span class="spec-kind">${sel.kind === "sensor" ? "SENSOR · the eyes" : "EFFECTOR · the stopper"}</span>`;
          preview.append(head, this.specBody(sel, 0));
          dock.append(preview);
        }
      }

      const palette = el("div", "palette");
      for (const p of placeablesForTier(state.maxTier)) {
        if (state.level.restrictedPlaceables.includes(p.id)) continue; // e.g. urban → no laser
        palette.append(this.paletteCard(p, state));
      }
      dock.append(palette);
    }

    if (!midWave) {
      const start = el("button", "btn-start") as HTMLButtonElement;
      start.innerHTML = `<span>${nextLabel}</span><span class="start-arrow">▶</span>`;
      start.onclick = () => this.cb.onStartWave();
      dock.append(start);
    }

    this.root.append(dock);
    this.dock = dock;
  }

  private devicePanel(dev: GameState["placed"][number], state: GameState): HTMLElement {
    const p = placeableById(dev.placeableId)!;
    const step = nextUpgrade(p, dev.level);
    const panel = el("div", "dev-panel");
    panel.innerHTML = `
      <div class="dp-head">
        <span class="pal-code ${dev.kind}">${p.code}</span>
        <span class="dp-name">${p.name}</span>
        <span class="dp-lvl">LVL ${dev.level + 1}</span>
      </div>
    `;
    // Spec card inline: the upgrade decision should be informed by what the
    // device actually is and what it's good against.
    panel.append(this.specBody(p, dev.level));
    const actions = el("div", "dp-actions");
    if (step) {
      const afford = state.currency >= step.cost;
      const up = el("button", "dp-upgrade" + (afford ? "" : " poor")) as HTMLButtonElement;
      up.disabled = !afford;
      up.innerHTML = `<span>▲ ${step.label}</span><span class="dp-cost">$${step.cost}</span>`;
      up.onclick = () => this.cb.onUpgradeDevice();
      actions.append(up);
    } else {
      const maxed = el("div", "dp-maxed");
      maxed.textContent = "Fully upgraded";
      actions.append(maxed);
    }
    const sell = el("button", "dp-sell") as HTMLButtonElement;
    sell.textContent = "Sell";
    sell.onclick = () => this.cb.onSellDevice();
    const close = el("button", "dp-close") as HTMLButtonElement;
    close.textContent = "Close";
    close.onclick = () => this.cb.onCloseDevice();
    actions.append(sell, close);
    panel.append(actions);
    return panel;
  }

  hideBuild(): void {
    this.dock?.remove();
    this.dock = null;
  }

  /**
   * Scripted Act-1 dock. The pre-arcade act has NO economy and a FIXED laydown,
   * so the between-waves dock isn't a shop — it's either a guided deploy prompt
   * ("tap the lit hex / deploy the rest") or a locked "the grid is set, brace"
   * panel with only the start button. This keeps Act 1 honest: same gear the
   * whole way, the only variable is the brain.
   */
  showScriptedDock(_state: GameState, opts: ScriptedDockOpts): void {
    this.ensureBar();
    this.dock?.remove();
    const dock = el("div", "build-dock scripted");

    if (opts.kind === "deploy") {
      const placed = opts.placed ?? 0;
      const total = opts.total ?? placed;
      const panel = el("div", "deploy-panel");
      panel.innerHTML = `
        <div class="deploy-head"><span class="brain-dot">◈</span> STAND UP THE GRID</div>
        <div class="deploy-prog"><span class="deploy-count">${placed}</span> / ${total} placed</div>
      `;
      dock.append(panel);
    } else {
      const start = el("button", "btn-start") as HTMLButtonElement;
      start.innerHTML = `<span>${opts.startLabel}</span><span class="start-arrow">▶</span>`;
      start.onclick = () => opts.onStart();
      dock.append(start);
    }

    this.root.append(dock);
    this.dock = dock;
  }

  private recCard(rec: Recommendation, state: GameState): HTMLElement {
    const p = placeableById(rec.placeableId);
    const afford = !!p && state.currency >= p.cost;
    const card = el("div", "rec-card");
    card.innerHTML = `
      <div class="rec-head"><span class="brain-dot">◈</span> COORDINATION ADVISES</div>
      <div class="rec-reason">${rec.reason}</div>
    `;
    const actions = el("div", "rec-actions");
    const accept = el("button", "rec-accept" + (afford ? "" : " poor")) as HTMLButtonElement;
    accept.disabled = !afford;
    accept.textContent = afford ? `Accept · place ${p!.name} ($${p!.cost})` : `Need $${p?.cost ?? "?"}`;
    accept.onclick = () => this.cb.onAcceptRec();
    const dismiss = el("button", "rec-dismiss") as HTMLButtonElement;
    dismiss.textContent = "Dismiss";
    dismiss.onclick = () => this.cb.onDismissRec();
    actions.append(accept, dismiss);
    card.append(actions);
    return card;
  }

  private paletteCard(p: Placeable, state: GameState): HTMLElement {
    const afford = state.currency >= p.cost;
    const sel = state.selectedPlaceable === p.id;
    const card = el("button", "pal-card" + (sel ? " sel" : "") + (afford ? "" : " poor") + ` k-${p.kind}`) as HTMLButtonElement;
    card.dataset.pid = p.id;
    card.dataset.cost = String(p.cost);
    card.disabled = !afford;
    card.onclick = () => this.cb.onSelectPlaceable(p.id);
    card.innerHTML = `
      <div class="pal-top"><span class="pal-code ${p.kind}">${p.code}</span><span class="pal-tier t${p.tier}">T${p.tier}</span><span class="pal-cost">$${p.cost}</span></div>
      <div class="pal-name">${p.name}</div>
      <div class="pal-role">${p.role}</div>
    `;
    return card;
  }

  /**
   * Cheaply re-sync palette affordability to live currency (no DOM rebuild) so
   * the mid-wave "reinforce" dock lights up cards as kills earn money.
   */
  refreshAffordability(state: GameState): void {
    if (!this.dock) return;
    this.dock.querySelectorAll<HTMLButtonElement>(".pal-card").forEach((card) => {
      const cost = Number(card.dataset.cost ?? "0");
      const afford = state.currency >= cost;
      const selected = card.classList.contains("sel");
      card.disabled = !afford && !selected;
      card.classList.toggle("poor", !afford);
    });
  }
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
