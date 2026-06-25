/**
 * Leaderboard + takeaway UI (spec §10, §11). The run-end flow:
 *   1. Submit — final score + handle + affiliation (tiny friction).
 *   2. Result — the persistent board (all-time / today, player highlighted)
 *      alongside the one-page takeaway artifact (downloadable, optional email).
 *
 * Rendering only; all data goes through leaderboard/client (backend or the
 * localStorage demo fallback).
 */
import { AFFILIATIONS, type BoardKind, type RunStats, type ScoreEntry } from "../leaderboard/rules.ts";
import { fetchBoard, submitScore, usingBackend, type SubmitResult } from "../leaderboard/client.ts";
import { drawTakeawayPNG } from "./takeaway.ts";

export interface LeaderboardCallbacks {
  onRestart(): void;
}

export class LeaderboardUI {
  private root: HTMLElement;
  private cb: LeaderboardCallbacks;

  constructor(root: HTMLElement, cb: LeaderboardCallbacks) {
    this.root = root;
    this.cb = cb;
  }

  private liveTimer: number | null = null;

  clear(): void {
    this.stopLive();
    this.root.innerHTML = "";
  }

  /** Live attract board (spec §10) — full-screen, auto-refreshing second screen. */
  showLive(levelId: string): void {
    this.clear();
    const wrap = el("div", "live-board");
    wrap.innerHTML = `<div class="live-title">C-UAS COMMAND · LIVE LEADERBOARD</div>`;
    const cols = el("div", "live-cols");
    const allCol = el("div", "live-col");
    const todayCol = el("div", "live-col");
    cols.append(allCol, todayCol);
    wrap.append(cols);
    if (!usingBackend) wrap.append(demoNote());
    this.root.append(wrap);

    const refresh = async () => {
      const [all, today] = await Promise.all([fetchBoard(levelId, "alltime"), fetchBoard(levelId, "today")]);
      allCol.innerHTML = `<div class="live-col-h">ALL-TIME</div>`;
      allCol.append(this.list(all.slice(0, 10), ""));
      todayCol.innerHTML = `<div class="live-col-h">TODAY</div>`;
      todayCol.append(this.list(today.slice(0, 10), ""));
    };
    refresh();
    this.liveTimer = window.setInterval(refresh, 5000);
  }

  stopLive(): void {
    if (this.liveTimer !== null) {
      window.clearInterval(this.liveTimer);
      this.liveTimer = null;
    }
  }

  get liveActive(): boolean {
    return this.liveTimer !== null;
  }

  /** Step 1 — score submission. */
  showSubmit(stats: RunStats): void {
    this.clear();
    const s = screen("lb-submit");
    s.innerHTML = `
      <div class="screen-kicker">${stats.victory ? "SITE HELD" : "ASSET OVERRUN"} · LOG YOUR SCORE</div>
      <div class="final-score"><div class="fs-k">FINAL SCORE</div><div class="fs-v">${fmt(stats.score)}</div></div>
    `;
    const form = el("div", "submit-form");

    const handle = el("input", "submit-handle") as HTMLInputElement;
    handle.maxLength = 16;
    handle.placeholder = "Call sign";
    handle.autocomplete = "off";
    handle.spellcheck = false;

    const affil = el("select", "submit-affil") as HTMLSelectElement;
    for (const a of AFFILIATIONS) {
      const o = document.createElement("option");
      o.value = a;
      o.textContent = a;
      affil.append(o);
    }

    form.append(labeled("CALL SIGN", handle), labeled("AFFILIATION", affil));
    s.append(form);

    const actions = el("div", "submit-actions");
    const submit = button("Submit score", "screen-cta");
    submit.onclick = () => this.doSubmit(stats, handle.value, affil.value);
    const skip = button("Skip", "lb-skip");
    skip.onclick = () => this.showResult(stats, null);
    actions.append(submit, skip);
    s.append(actions);

    if (!usingBackend) s.append(demoNote());
    this.root.append(s);
    setTimeout(() => handle.focus(), 50);
  }

  private async doSubmit(stats: RunStats, handle: string, affiliation: string): Promise<void> {
    const result = await submitScore({ handle, affiliation, stats });
    this.showResult(stats, result, handle);
  }

  /** Step 2 — the board + takeaway. */
  async showResult(stats: RunStats, submit: SubmitResult | null, handle = ""): Promise<void> {
    this.clear();
    const wrap = el("div", "lb-result");

    wrap.append(this.takeawayCard(stats, submit, handle));
    const board = el("div", "lb-board");
    board.innerHTML = `<div class="lb-loading">Loading board…</div>`;
    wrap.append(board);

    const footer = el("div", "lb-footer");
    const again = button("Play again", "screen-cta");
    again.onclick = () => this.cb.onRestart();
    footer.append(again);
    if (!usingBackend) footer.append(demoNote());
    wrap.append(footer);

    this.root.append(wrap);
    await this.renderBoard(board, stats.levelId, handle, submit);
  }

  private async renderBoard(host: HTMLElement, levelId: string, handle: string, submit: SubmitResult | null): Promise<void> {
    let active: BoardKind = "alltime";
    const [alltime, today] = await Promise.all([fetchBoard(levelId, "alltime"), fetchBoard(levelId, "today")]);

    const render = () => {
      host.innerHTML = "";
      const head = el("div", "lb-head");
      head.innerHTML = `<span class="lb-title">LEADERBOARD</span>`;
      const tabs = el("div", "lb-tabs");
      for (const k of ["alltime", "today"] as BoardKind[]) {
        const t = el("button", "lb-tab" + (active === k ? " on" : ""));
        t.textContent = k === "alltime" ? "All-time" : "Today";
        t.onclick = () => {
          active = k;
          render();
        };
        tabs.append(t);
      }
      head.append(tabs);
      host.append(head);

      const entries = active === "alltime" ? alltime : today;
      host.append(this.list(entries, handle));

      if (submit?.ok && submit.rank && active === "alltime") {
        const chip = el("div", "lb-yourrank");
        chip.innerHTML = `Your rank: <b>#${submit.rank}</b> of ${submit.total ?? entries.length}`;
        host.append(chip);
      }
    };
    render();
  }

  private list(entries: ScoreEntry[], handle: string): HTMLElement {
    const list = el("div", "lb-list");
    if (!entries.length) {
      const empty = el("div", "lb-empty");
      empty.textContent = "No scores yet — be the first.";
      list.append(empty);
      return list;
    }
    entries.forEach((e, i) => {
      const mine = handle && e.handle.toLowerCase() === handle.trim().slice(0, 16).toLowerCase();
      const row = el("div", "lb-row" + (mine ? " mine" : "") + (i < 3 ? " top" : ""));
      row.innerHTML =
        `<span class="lb-rank">${i + 1}</span>` +
        `<span class="lb-handle">${escapeHtml(e.handle)}</span>` +
        `<span class="lb-affil">${escapeHtml(e.affiliation)}</span>` +
        `<span class="lb-score">${fmt(e.score)}</span>`;
      list.append(row);
    });
    return list;
  }

  private takeawayCard(stats: RunStats, submit: SubmitResult | null, handle: string): HTMLElement {
    const card = el("div", "takeaway");
    const eff = stats.spent > 0 ? Math.round(stats.score / stats.spent * 100) / 100 : stats.score;
    card.innerHTML = `
      <div class="tk-head">YOUR DEFENSE</div>
      <div class="tk-score">${fmt(stats.score)}<span class="tk-score-k">pts</span></div>
      ${submit?.ok && submit.rank ? `<div class="tk-rank">Rank #${submit.rank}</div>` : ""}
      <div class="tk-grid">
        ${stat("Waves survived", String(stats.wavesSurvived))}
        ${stat("Threats stopped", String(stats.kills))}
        ${stat("Leaks", String(stats.leaked))}
        ${stat("Efficiency", `${eff} / $`)}
        ${stat("Boss · manual", `${stats.boss1Stopped}/4`)}
        ${stat("Boss · coordinated", `${stats.boss2Stopped}/4`)}
      </div>
      <div class="tk-line">The coordinating intelligence you unlocked is real — ask our team for the live model.</div>
    `;
    const row = el("div", "tk-actions");
    const dl = button("Download report", "tk-download");
    dl.onclick = () => drawTakeawayPNG(stats, submit?.rank ?? null, handle);
    const email = el("input", "tk-email") as HTMLInputElement;
    email.type = "email";
    email.placeholder = "Email my report (optional)";
    const send = button("Send", "tk-send");
    send.onclick = () => {
      if (!email.value) return;
      drawTakeawayPNG(stats, submit?.rank ?? null, handle);
      send.textContent = "Saved ✓";
      // Lead capture: in the real booth this posts to the backend; locally we
      // just stash it so nothing is silently lost.
      try {
        const leads = JSON.parse(localStorage.getItem("cuas_leads") ?? "[]");
        leads.push({ email: email.value, handle, score: stats.score, ts: Date.now() });
        localStorage.setItem("cuas_leads", JSON.stringify(leads));
      } catch {
        /* ignore */
      }
    };
    row.append(dl, email, send);
    card.append(row);
    return card;
  }
}

// ---- helpers -------------------------------------------------------------

function stat(k: string, v: string): string {
  return `<div class="tk-stat"><div class="tk-stat-v">${v}</div><div class="tk-stat-k">${k}</div></div>`;
}

function labeled(label: string, control: HTMLElement): HTMLElement {
  const w = el("label", "submit-field");
  const l = el("span", "submit-label");
  l.textContent = label;
  w.append(l, control);
  return w;
}

function demoNote(): HTMLElement {
  const n = el("div", "demo-note");
  n.textContent = "Demo board (this device only). Set VITE_API_BASE to the hosted API for the live cross-kiosk board.";
  return n;
}

function screen(cls: string): HTMLElement {
  return el("div", "screen " + cls);
}

function button(text: string, cls: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.textContent = text;
  return b;
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

function fmt(n: number): string {
  return Math.floor(n).toLocaleString();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
