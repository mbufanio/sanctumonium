/**
 * Leaderboard persistence (spec §10) — a small JSON-file store.
 *
 * Single hosted instance serving all kiosks = one shared board, which is the
 * requirement. Kept dependency-free (no native DB build) and swappable: the
 * surface is just add() / all(), so a SQLite or Postgres adapter can drop in
 * later behind the same interface.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ScoreEntry } from "../src/leaderboard/rules.ts";

export class Store {
  private entries: ScoreEntry[] = [];
  private dirty = false;
  private path: string;

  constructor(path: string) {
    this.path = path;
    this.load();
    // Debounced background flush so writes don't block requests.
    setInterval(() => this.flush(), 2000).unref?.();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8"));
      if (Array.isArray(parsed)) this.entries = parsed;
    } catch {
      this.entries = [];
    }
  }

  add(entry: ScoreEntry): void {
    this.entries.push(entry);
    this.dirty = true;
  }

  all(): ScoreEntry[] {
    return this.entries;
  }

  flush(): void {
    if (!this.dirty) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.entries));
    this.dirty = false;
  }
}
