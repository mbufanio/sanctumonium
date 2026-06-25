/**
 * Full-screen narrative overlays (spec §2 emotional arc): the title, the brain
 * "call for help / unlock" beat, and the end summary. Kept deliberately spare
 * and large-type for a busy show floor (spec §3 readability rules).
 */
export interface ScreenCallbacks {
  onStart(): void;
  onUnlockContinue(): void;
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
