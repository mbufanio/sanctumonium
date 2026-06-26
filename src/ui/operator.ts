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

interface QueuedLine {
  text: string;
  ms: number;
  accent: boolean;
}

export class Operator {
  private sitrep: HTMLElement;
  private panel: HTMLElement;
  private queue: QueuedLine[] = [];
  private timer: number | null = null;
  private muted = false;

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

  /** Queue a timed operator line. `accent` tints it in the brain colour. */
  say(text: string, opts: { ms?: number; accent?: boolean } = {}): void {
    if (this.muted) return;
    this.queue.push({ text, ms: opts.ms ?? 4200, accent: !!opts.accent });
    if (this.timer === null) this.pump();
  }

  /** Drop any pending/onscreen lines (scene change). */
  clearLines(): void {
    this.queue = [];
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.panel.classList.remove("show");
    this.panel.hidden = true;
  }

  /** Full reset — back to a clean slate (title / restart). */
  reset(): void {
    this.clearLines();
    this.hideSitrep();
  }

  private pump(): void {
    const next = this.queue.shift();
    if (!next) {
      this.timer = null;
      this.panel.classList.remove("show");
      // brief fade-out before hiding
      this.timer = window.setTimeout(() => {
        this.panel.hidden = true;
        this.timer = null;
      }, 260);
      return;
    }
    this.panel.hidden = false;
    this.panel.classList.toggle("accent", next.accent);
    this.panel.innerHTML = `${SIGIL}<span class="op-cs">${OPERATOR}</span><span class="op-text">${next.text}</span>`;
    // restart the entrance animation
    this.panel.classList.remove("show");
    void this.panel.offsetWidth;
    this.panel.classList.add("show");
    this.timer = window.setTimeout(() => this.pump(), next.ms);
  }
}
