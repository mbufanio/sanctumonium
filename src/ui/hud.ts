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
import { PLACEABLES, type Placeable } from "../sim/realtime/catalog.ts";
import type { GameState } from "../sim/state.ts";

export interface HudCallbacks {
  onSelectPlaceable(id: string): void;
  onStartWave(): void;
  onSell(deviceId: string): void;
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
  showBuild(state: GameState, nextLabel: string): void {
    this.ensureBar();
    this.dock?.remove();
    const dock = el("div", "build-dock");

    const hint = el("div", "build-hint");
    hint.textContent = state.selectedPlaceable
      ? "Tap the field to place · tap a placed device to sell"
      : "Pick a device, then tap the field to place it";
    dock.append(hint);

    const palette = el("div", "palette");
    for (const p of PLACEABLES) {
      palette.append(this.paletteCard(p, state));
    }
    dock.append(palette);

    const start = el("button", "btn-start") as HTMLButtonElement;
    start.innerHTML = `<span>${nextLabel}</span><span class="start-arrow">▶</span>`;
    start.onclick = () => this.cb.onStartWave();
    dock.append(start);

    this.root.append(dock);
    this.dock = dock;
  }

  hideBuild(): void {
    this.dock?.remove();
    this.dock = null;
  }

  private paletteCard(p: Placeable, state: GameState): HTMLElement {
    const afford = state.currency >= p.cost;
    const sel = state.selectedPlaceable === p.id;
    const card = el("button", "pal-card" + (sel ? " sel" : "") + (afford ? "" : " poor") + ` k-${p.kind}`) as HTMLButtonElement;
    card.disabled = !afford;
    card.onclick = () => this.cb.onSelectPlaceable(p.id);
    card.innerHTML = `
      <div class="pal-top"><span class="pal-code ${p.kind}">${p.code}</span><span class="pal-cost">$${p.cost}</span></div>
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
