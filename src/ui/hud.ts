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
import { placeablesForTier, placeableById, nextUpgrade, type Placeable } from "../sim/realtime/catalog.ts";
import type { Recommendation } from "../sim/realtime/adaptive.ts";
import type { GameState } from "../sim/state.ts";

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
  private refs: Record<string, HTMLElement> = {};

  constructor(root: HTMLElement, cb: HudCallbacks) {
    this.root = root;
    this.cb = cb;
  }

  clear(): void {
    this.bar?.remove();
    this.dock?.remove();
    this.bar = null;
    this.dock = null;
    this.refs = {};
  }

  /** Create the persistent status bar (idempotent). */
  private ensureBar(): void {
    if (this.bar) return;
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
    const entry = state.scheduleIndex;
    this.refs.stage.textContent = state.phase === "wave" && state.activeWave ? state.activeWave.label : `Step ${entry + 1}`;
    this.refs.funds.textContent = `$${Math.floor(state.currency)}`;
    this.refs.score.textContent = String(Math.floor(state.score));
    const coordActive = state.brainUnlocked && !state.brainStaffDisabled;
    this.refs.coord.classList.toggle("on", coordActive);
    const frac = Math.max(0, state.integrity / state.maxIntegrity);
    this.refs.integfill.style.width = `${frac * 100}%`;
    this.refs.integfill.className = "integ-fill " + (frac > 0.5 ? "ok" : frac > 0.25 ? "warn" : "crit");
    this.refs.integnum.textContent = String(Math.max(0, Math.ceil(state.integrity)));
    // Live drones-remaining hint during a wave.
    if (state.phase === "wave" && state.rt && state.activeWave) {
      const remaining = state.activeWave.spawns.length - state.rt.spawnCursor + state.rt.drones.length;
      this.refs.stage.textContent = `${state.activeWave.label} · ${remaining} inbound`;
    }
  }

  /** Show the between-waves build dock. */
  showBuild(state: GameState, nextLabel: string, rec: Recommendation | null): void {
    this.ensureBar();
    this.dock?.remove();
    const dock = el("div", "build-dock");

    const selDev = state.selectedDeviceId ? state.placed.find((d) => d.id === state.selectedDeviceId) ?? null : null;
    if (selDev) {
      // Selected a placed device → its upgrade/sell panel (spec §7).
      dock.append(this.devicePanel(selDev, state));
    } else {
      // Brain recommendation (face 3) — suggest-and-accept, only after unlock.
      if (rec) dock.append(this.recCard(rec, state));

      const hint = el("div", "build-hint");
      hint.textContent = state.selectedPlaceable
        ? "Tap the field to place · tap a placed device to upgrade it"
        : "Pick a device to place, or tap a placed device to upgrade";
      dock.append(hint);

      const palette = el("div", "palette");
      for (const p of placeablesForTier(state.maxTier)) {
        if (state.level.restrictedPlaceables.includes(p.id)) continue; // e.g. urban → no laser
        palette.append(this.paletteCard(p, state));
      }
      dock.append(palette);
    }

    const start = el("button", "btn-start") as HTMLButtonElement;
    start.innerHTML = `<span>${nextLabel}</span><span class="start-arrow">▶</span>`;
    start.onclick = () => this.cb.onStartWave();
    dock.append(start);

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
    card.disabled = !afford;
    card.onclick = () => this.cb.onSelectPlaceable(p.id);
    card.innerHTML = `
      <div class="pal-top"><span class="pal-code ${p.kind}">${p.code}</span><span class="pal-tier t${p.tier}">T${p.tier}</span><span class="pal-cost">$${p.cost}</span></div>
      <div class="pal-name">${p.name}</div>
      <div class="pal-role">${p.role}</div>
    `;
    return card;
  }
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
