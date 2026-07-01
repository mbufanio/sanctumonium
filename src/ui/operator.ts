/**
 * The operator (callsign VEGA) — the single human voice of Act 1 (ACT1 spec §2).
 *
 * Two cheap, body-mounted surfaces (so the shared overlay churn can never wipe
 * them):
 *   • a persistent SIT-REP slot (site · status), set once per beat;
 *   • a queued line panel that plays short, timed operator lines with a sigil.
 *
 * Vega speaks in clipped ops cadence — situation and what changed, never
 * marketing. The mechanics make the sales point; Vega makes it legible.
 *
 * Pure presentation: the controller calls setSitrep()/say() at scripted beats.
 */

/** The one line everything in Act 1 ladders toward (ACT1 spec §1). */
export const NORTH_STAR = "Sensors and shooters are commodities. The coordination is the product.";

/** Callsign for the lone operator (ACT1 spec §2). */
export const OPERATOR = "VEGA";

const SIGIL = `<span class="op-sigil" aria-hidden="true">◈</span>`;

/** How many recent lines stay on screen at once (a short rolling transcript). */
const MAX_LINES = 3;
/** Default dwell before a line fades out — long, so VEGA reads as calm, not spammy. */
const DEFAULT_MS = 9000;

interface ActiveLine {
  node: HTMLElement;
  timer: number;
}

export class Operator {
  private sitrep: HTMLElement;
  private panel: HTMLElement;
  private lines: ActiveLine[] = [];
  private muted = false;
  private lastText = "";

  constructor() {
    this.sitrep = document.createElement("div");
    this.sitrep.id = "op-sitrep";
    this.sitrep.hidden = true;
    this.panel = document.createElement("div");
    this.panel.id = "op-line";
    this.panel.hidden = true;
    document.body.append(this.sitrep, this.panel);
  }

  /** Suppress lines (e.g. during the attract demo) without tearing anything down. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.clearLines();
  }

  /** The persistent one-liner: site + status, in Vega's voice. */
  setSitrep(site: string, status: string): void {
    if (this.muted) {
      this.sitrep.hidden = true;
      return;
    }
    this.sitrep.innerHTML = `${SIGIL}<span class="op-cs">${OPERATOR}</span><span class="op-sr-site">${site}</span><span class="op-sr-status">${status}</span>`;
    this.sitrep.hidden = false;
  }

  hideSitrep(): void {
    this.sitrep.hidden = true;
  }

  /**
   * Show an operator line. Lines STACK (up to MAX_LINES) so the last few stay
   * readable instead of one flashing line — and each lingers, so VEGA reads as a
   * calm sit-rep, not a stream of pop-ups. `accent` tints it in the brain colour.
   */
  say(text: string, opts: { ms?: number; accent?: boolean } = {}): void {
    if (this.muted) return;
    if (text === this.lastText) return; // never repeat the same line back-to-back
    this.lastText = text;

    const node = document.createElement("div");
    node.className = "op-entry" + (opts.accent ? " accent" : "");
    node.innerHTML = `${SIGIL}<span class="op-cs">${OPERATOR}</span><span class="op-text">${text}</span>`;
    this.panel.hidden = false;
    this.panel.append(node);
    // Entrance on the next frame so the transition runs.
    requestAnimationFrame(() => node.classList.add("show"));

    const entry: ActiveLine = { node, timer: window.setTimeout(() => this.expire(entry), opts.ms ?? DEFAULT_MS) };
    this.lines.push(entry);
    while (this.lines.length > MAX_LINES) this.expire(this.lines[0], true);
  }

  private expire(entry: ActiveLine, now = false): void {
    const i = this.lines.indexOf(entry);
    if (i < 0) return;
    this.lines.splice(i, 1);
    window.clearTimeout(entry.timer);
    entry.node.classList.remove("show");
    window.setTimeout(() => {
      entry.node.remove();
      if (!this.lines.length) this.panel.hidden = true;
    }, now ? 0 : 320);
  }

  /** Drop any onscreen lines (scene change). */
  clearLines(): void {
    for (const e of this.lines) {
      window.clearTimeout(e.timer);
      e.node.remove();
    }
    this.lines = [];
    this.lastText = "";
    this.panel.hidden = true;
  }

  /** Full reset — back to a clean slate (title / restart). */
  reset(): void {
    this.clearLines();
    this.hideSitrep();
  }
}
