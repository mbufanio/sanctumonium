/**
 * Takeaway artifact (spec §11) — renders a one-page personalized summary to a
 * PNG the visitor can keep, mirroring the product's command-console look. No
 * dependencies: drawn on a 2D canvas and downloaded as a data URL.
 */
import { css, COLORS } from "../theme.ts";
import { NORTH_STAR } from "./operator.ts";
import type { RunStats } from "../leaderboard/rules.ts";

/** Wrap text to a max width on a 2D context, returning the lines. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export function drawTakeawayPNG(stats: RunStats, rank: number | null, handle: string): void {
  const W = 1000;
  const H = 1400;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return;

  // Background.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0b1622");
  g.addColorStop(1, css(COLORS.bgBottom));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Frame.
  ctx.strokeStyle = css(COLORS.panelEdge);
  ctx.lineWidth = 2;
  ctx.strokeRect(40, 40, W - 80, H - 80);

  const cx = W / 2;
  let y = 130;

  ctx.textAlign = "center";
  ctx.fillStyle = css(COLORS.coverage);
  ctx.font = "600 26px monospace";
  ctx.fillText("COUNTER-UAS · DEFENSE REPORT", cx, y);

  y += 90;
  ctx.fillStyle = css(COLORS.text);
  ctx.font = "800 64px Inter, sans-serif";
  ctx.fillText(handle ? handle.toUpperCase() : "OPERATOR", cx, y);

  y += 40;
  ctx.fillStyle = css(COLORS.textDim);
  ctx.font = "400 26px Inter, sans-serif";
  ctx.fillText(stats.victory ? "Site held" : "Asset overrun — held the line as long as possible", cx, y);

  // Score block.
  y += 130;
  ctx.fillStyle = css(COLORS.textDim);
  ctx.font = "600 24px monospace";
  ctx.fillText("FINAL SCORE", cx, y);
  y += 90;
  ctx.fillStyle = css(COLORS.brainGold);
  ctx.font = "800 110px Inter, sans-serif";
  ctx.fillText(Math.floor(stats.score).toLocaleString(), cx, y);
  if (rank) {
    y += 60;
    ctx.fillStyle = css(COLORS.brain);
    ctx.font = "700 34px Inter, sans-serif";
    ctx.fillText(`Leaderboard rank #${rank}`, cx, y);
  }

  // Stat grid (2 columns).
  y += 110;
  const eff = stats.spent > 0 ? Math.round((stats.score / stats.spent) * 100) / 100 : stats.score;
  const rows: Array<[string, string]> = [
    ["Waves survived", String(stats.wavesSurvived)],
    ["Threats stopped", String(stats.kills)],
    ["Leaks", String(stats.leaked)],
    ["Efficiency (pts/$)", String(eff)],
    ["Boss · manual", `${stats.boss1Stopped} / 4`],
    ["Boss · coordinated", `${stats.boss2Stopped} / 4`],
  ];
  ctx.textAlign = "left";
  const colX = [120, 540];
  const rowH = 110;
  rows.forEach((r, i) => {
    const x = colX[i % 2];
    const ry = y + Math.floor(i / 2) * rowH;
    ctx.fillStyle = css(COLORS.text);
    ctx.font = "800 46px Inter, sans-serif";
    ctx.fillText(r[1], x, ry);
    ctx.fillStyle = css(COLORS.textDim);
    ctx.font = "500 22px Inter, sans-serif";
    ctx.fillText(r[0], x, ry + 34);
  });

  // The North Star — the one line the visitor carries back (ACT1 spec §1/§5).
  ctx.textAlign = "center";
  ctx.fillStyle = css(COLORS.brain);
  ctx.font = "700 30px Inter, sans-serif";
  const nsLines = wrap(ctx, NORTH_STAR, W - 200);
  let ny = H - 230;
  for (const ln of nsLines) {
    ctx.fillText(ln, cx, ny);
    ny += 40;
  }
  // The conversion CTA (ACT1 spec §5).
  ctx.fillStyle = css(COLORS.text);
  ctx.font = "600 26px Inter, sans-serif";
  ctx.fillText("The brain you just used is real.", cx, H - 130);
  ctx.fillStyle = css(COLORS.textDim);
  ctx.font = "400 24px Inter, sans-serif";
  ctx.fillText("Ask us to run your actual site.", cx, H - 96);

  // Download.
  const url = c.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = `cuas-defense-report-${handle ? handle.replace(/\s+/g, "_") : "operator"}.png`;
  document.body.append(a);
  a.click();
  a.remove();
}
