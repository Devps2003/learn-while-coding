import { homedir } from "node:os";
import { join } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { FSWatcher } from "node:fs";

export interface Tip {
  concept: string;
  summary: string;
  category: string;
  whyNow: string;
  learnMore: string[];
  depth: string;
}

export interface TipTurn {
  sessionId: string;
  turnId: string;
  timestamp: string;
  platform: string;
  tips: Tip[];
}

export const SESSIONS_DIR = join(homedir(), ".learnwhile", "sessions");

export async function listSessionIds(): Promise<string[]> {
  if (!existsSync(SESSIONS_DIR)) {
    return [];
  }
  const entries = await readdir(SESSIONS_DIR);
  return entries.filter((e) => !e.starts("."));
}

export async function readLatestForSession(sessionId: string): Promise<TipTurn | null> {
  const path = join(SESSIONS_DIR, sessionId, "latest.json");
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as TipTurn;
  } catch {
    return null;
  }
}

export async function readAllLatestTips(): Promise<TipTurn[]> {
  const sessionIds = await listSessionIds();
  const turns: TipTurn[] = [];

  for (const id of sessionIds) {
    const turn = await readLatestForSession(id);
    if (turn && turn.tips.length > 0) {
      turns.push(turn);
    }
  }

  return turns.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

export async function getLatestTurn(): Promise<TipTurn | null> {
  const turns = await readAllLatestTips();
  return turns[0] ?? null;
}

export type TipChangeCallback = (turn: TipTurn) => void;

export class TipWatcher {
  private watchers: FSWatcher[] = [];
  private lastSeen = new Map<string, string>();
  private callback: TipChangeCallback;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(callback: TipChangeCallback) {
    this.callback = callback;
  }

  async start(): Promise<void> {
    await this.scanAll();

    if (existsSync(SESSIONS_DIR)) {
      const { watch } = await import("node:fs");
      const watcher = watch(SESSIONS_DIR, { recursive: true }, () => {
        void this.scanAll();
      });
      this.watchers.push(watcher);
    }

    this.pollInterval = setInterval(() => void this.scanAll(), 3000);
  }

  dispose(): void {
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async scanAll(): Promise<void> {
    if (!existsSync(SESSIONS_DIR)) {
      return;
    }

    const sessionIds = await listSessionIds();
    for (const sessionId of sessionIds) {
      const latestPath = join(SESSIONS_DIR, sessionId, "latest.json");
      if (!existsSync(latestPath)) {
        continue;
      }

      try {
        const fileStat = await stat(latestPath);
        const mtime = fileStat.mtimeMs.toString();
        const prev = this.lastSeen.get(sessionId);

        if (prev === mtime) {
          continue;
        }

        this.lastSeen.set(sessionId, mtime);
        const turn = await readLatestForSession(sessionId);
        if (turn && turn.tips.length > 0) {
          this.callback(turn);
        }
      } catch {
        // ignore read errors
      }
    }
  }
}
