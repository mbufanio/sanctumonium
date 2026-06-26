/**
 * Full-screen narrative overlays (spec §2 emotional arc): the title, the site
 * select, the brain "call for help / unlock" beat, and the end summary. Kept
 * deliberately spare and large-type for a busy show floor (spec §3).
 */
import type { LevelDef } from "../sim/level.ts";

export interface ScreenCallbacks {
  onStart(): void;
  onUnlockContinue(): void;
  onActBreakContinue(): void;
  onArcadeOverContinue(): void;
  onRestart(): void;
}

export class Screens {
  private root: HTMLElement;
  private cb: ScreenCallbacks;

  constructor(root: HTMLElement, cb: ScreenCallbacks) {
    this.root = root;
    this.cb = cb;
  }

  clear(): void {
    this.root.innerHTML = "";
  }

  title(): void {
    this.clear();
    const s = screen("title-screen");
    s.innerHTML = `
      <div class="screen-kicker">COUNTER-UAS · LIVE DEFENSE</div>
      <h1 class="screen-h1">Hostile drones inbound.</h1>
      <h2 class="screen-h2">Match the right sensor and effector to each threat.</h2>
      <p class="screen-body">
        A coordinated strike is closing on the site. Track each drone and pick
        the effector that beats it — before it reaches the asset.
      </p>
    `;
    const btn = button("Begin", "screen-cta");
    btn.onclick = () => this.cb.onStart();
    s.append(btn);
    this.root.append(s);
  }

  /** Site select (spec §9) — pick a scenario; each teaches a different wrinkle. */
  levelSelect(levels: LevelDef[], onPick: (level: LevelDef) => void): void {
    this.clear();
    const s = screen("levelselect-screen");
    s.innerHTML = `
      <div class="screen-kicker">SELECT A SITE</div>
      <h1 class="screen-h1">Where are you defending?</h1>
    `;
    const grid = document.createElement("div");
    grid.className = "site-grid";
    for (const lvl of levels) {
      const card = document.createElement("button");
      card.className = "site-card";
      card.innerHTML = `
        <div class="site-name">${lvl.name}</div>
        <div class="site-blurb">${lvl.blurb}</div>
        <div class="site-wrinkle"><span class="wrinkle-tag">WRINKLE</span> ${lvl.wrinkle}</div>
      `;
      card.onclick = () => onPick(lvl);
      grid.append(card);
    }
    s.append(grid);
    this.root.append(s);
  }

  /** The "wall → call for help → unlock" beat between Boss 1 and Boss 2. */
  unlock(): void {
    this.clear();
    const s = screen("unlock-screen");
    s.innerHTML = `
      <div class="op-line op-1">"We held. Barely."</div>
      <div class="op-line op-2">"Patch the units into the coordination layer —
        let them share tracks and call their shots together."</div>
      <div class="op-line op-3">"Coordination online. Re-engage."</div>
      <div class="brain-boot">
        <div class="boot-ring"></div>
        <div class="boot-label">◈ COORDINATION ONLINE</div>
        <div class="boot-sub">Shared tracks · deconflicted fire · live hit odds</div>
      </div>
    `;
    const btn = button("Re-engage", "screen-cta accent-cta");
    btn.onclick = () => this.cb.onUnlockContinue();
    s.append(btn);
    this.root.append(s);
  }

  /**
   * The act break after Boss #2: coordination is proven, so the brief shifts
   * from "sell the value" to "now field the next generation". Unlocks tier-3
   * fictional gear and arcade rules (build on the fly).
   */
  actBreak(): void {
    this.clear();
    const s = screen("actbreak-screen");
    s.innerHTML = `
      <div class="screen-kicker accent-kicker">◈ COORDINATION PROVEN</div>
      <h1 class="screen-h1">Future Systems Online.</h1>
      <h2 class="screen-h2">The coordination layer is cleared to drive the next-gen arsenal.</h2>
      <div class="future-grid">
        <div class="future-card"><div class="fc-h">DIRECTED-ENERGY &amp; PLASMA</div><div class="fc-b">High-end effectors come online — area weapons that clear whole clusters.</div></div>
        <div class="future-card"><div class="fc-h">FIELD ON THE FLY</div><div class="fc-b">No more waiting between waves — deploy reinforcements live as the fight unfolds.</div></div>
        <div class="future-card"><div class="fc-h">OVERWHELM INBOUND</div><div class="fc-b">The threat scales to a swarm. Your coordinated grid scales to meet it.</div></div>
      </div>
      <p class="screen-body">You proved the brain. Now see what it can really do.</p>
    `;
    const btn = button("Go loud", "screen-cta accent-cta");
    btn.onclick = () => this.cb.onActBreakContinue();
    s.append(btn);
    this.root.append(s);
  }

  /** Arcade overwhelm beat — the run only ever ends here (survived to Wave N). */
  arcadeOver(wave: number, score: number): void {
    this.clear();
    const s = screen("arcadeover-screen");
    s.innerHTML = `
      <div class="screen-kicker" style="color:var(--bad)">SYSTEM OVERWHELMED</div>
      <h1 class="screen-h1">The swarm broke through.</h1>
      <div class="arcade-stat">
        <div class="as-block"><div class="as-k">SURVIVED TO</div><div class="as-v">WAVE ${wave}</div></div>
        <div class="as-block"><div class="as-k">SCORE</div><div class="as-v">${score.toLocaleString()}</div></div>
      </div>
      <p class="screen-body">No grid holds forever — but a coordinated one holds longest.</p>
    `;
    const btn = button("Log the run", "screen-cta");
    btn.onclick = () => this.cb.onArcadeOverContinue();
    s.append(btn);
    this.root.append(s);
  }

  summary(info: { victory: boolean; score: number; boss1: string; boss2: string }): void {
    this.clear();
    const s = screen("summary-screen");
    s.innerHTML = `
      <div class="screen-kicker">${info.victory ? "SITE HELD" : "ASSET OVERRUN"}</div>
      <h1 class="screen-h1">${info.victory ? "You held the line." : "The site fell."}</h1>
      <div class="final-score">
        <div class="fs-k">FINAL SCORE</div>
        <div class="fs-v">${Math.floor(info.score).toLocaleString()}</div>
      </div>
      <div class="compare">
        <div class="compare-col off">
          <div class="compare-h">BOSS · MANUAL</div>
          <div class="compare-v">${info.boss1}</div>
          <div class="compare-note">Odds hidden</div>
        </div>
        <div class="compare-col on">
          <div class="compare-h">BOSS · COORDINATED</div>
          <div class="compare-v">${info.boss2}</div>
          <div class="compare-note">Odds visible · fire deconflicted</div>
        </div>
      </div>
      <p class="screen-body">Ask the team about the system behind it.</p>
    `;
    const btn = button("Run it again", "screen-cta");
    btn.onclick = () => this.cb.onRestart();
    s.append(btn);
    this.root.append(s);
  }
}

function screen(cls: string): HTMLElement {
  const e = document.createElement("div");
  e.className = "screen " + cls;
  return e;
}

function button(text: string, cls: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.textContent = text;
  return b;
}
