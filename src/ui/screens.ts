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
      <div class="screen-kicker">COUNTER-UAS · COMMAND DEMONSTRATION</div>
      <h1 class="screen-h1">It isn't how many devices you have.</h1>
      <h2 class="screen-h2">It's the <span class="accent">brain</span> coordinating them.</h2>
      <p class="screen-body">
        A coordinated drone strike is inbound on your facility. Assign your
        sensors and effectors to stop it — first on your own, then with the
        coordination system online. Feel the difference.
      </p>
    `;
    const btn = button("Begin the defense", "screen-cta");
    btn.onclick = () => this.cb.onStart();
    s.append(btn);
    this.root.append(s);
  }

  /** The "wall → call for help → unlock" beat between Boss 1 and Boss 2. */
  unlock(): void {
    this.clear();
    const s = screen("unlock-screen");
    s.innerHTML = `
      <div class="op-line op-1">"We held — but only just. The post is hurt."</div>
      <div class="op-line op-2">"Our systems aren't talking to each other.
        Radars, jammers, nets — all fighting alone."</div>
      <div class="op-line op-3">"We need them <em>coordinated</em>. Bringing the
        coordination brain online now."</div>
      <div class="brain-boot">
        <div class="boot-ring"></div>
        <div class="boot-label">◈ COORDINATION SYSTEM ONLINE</div>
        <div class="boot-sub">Tracks shared · Fire deconflicted · Odds visible · Seams flagged</div>
      </div>
    `;
    const btn = button("Re-engage — same threat, smarter defense", "screen-cta accent-cta");
    btn.onclick = () => this.cb.onUnlockContinue();
    s.append(btn);
    this.root.append(s);
  }

  summary(brain1: string, brain2: string): void {
    this.clear();
    const s = screen("summary-screen");
    s.innerHTML = `
      <div class="screen-kicker">DEMONSTRATION COMPLETE</div>
      <h1 class="screen-h1">Same hardware. Two different outcomes.</h1>
      <div class="compare">
        <div class="compare-col off">
          <div class="compare-h">WITHOUT THE BRAIN</div>
          <div class="compare-v">${brain1}</div>
          <div class="compare-note">Blind odds · wasted shots · barely held</div>
        </div>
        <div class="compare-col on">
          <div class="compare-h">WITH THE BRAIN</div>
          <div class="compare-v">${brain2}</div>
          <div class="compare-note">Visible odds · optimal assignment · clean win</div>
        </div>
      </div>
      <p class="screen-body">
        The coordinating intelligence is real. Ask our team to show you the
        actual model behind it.
      </p>
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
