import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Tip, TipTurn } from "./types.js";
import {
  ensureDirs,
  indexPath,
  latestPath,
  sessionDir,
  tipsPath,
} from "./config.js";

interface SessionIndex {
  seenConcepts: string[];
}

function normalizeConcept(concept: string): string {
  return concept.toLowerCase().trim().replace(/\s+/g, " ");
}

export async function loadSeenConcepts(sessionId: string): Promise<Set<string>> {
  const path = indexPath(sessionId);
  if (!existsSync(path)) {
    return new Set();
  }
  try {
    const raw = await readFile(path, "utf-8");
    const data = JSON.parse(raw) as SessionIndex;
    return new Set(data.seenConcepts ?? []);
  } catch {
    return new Set();
  }
}

export async function saveSeenConcepts(
  sessionId: string,
  concepts: Set<string>
): Promise<void> {
  await mkdir(sessionDir(sessionId), { recursive: true });
  const data: SessionIndex = { seenConcepts: [...concepts] };
  await writeFile(indexPath(sessionId), JSON.stringify(data, null, 2), "utf-8");
}

export function dedupeTips(tips: Tip[], seenConcepts: Set<string>): Tip[] {
  const result: Tip[] = [];
  for (const tip of tips) {
    const key = normalizeConcept(tip.concept);
    if (!seenConcepts.has(key)) {
      seenConcepts.add(key);
      result.push(tip);
    }
  }
  return result;
}

export async function appendTipTurn(turn: TipTurn): Promise<void> {
  await ensureDirs();
  await mkdir(sessionDir(turn.sessionId), { recursive: true });
  const line = JSON.stringify(turn) + "\n";
  await appendFile(tipsPath(turn.sessionId), line, "utf-8");
}

export async function writeLatest(turn: TipTurn): Promise<void> {
  await ensureDirs();
  await mkdir(sessionDir(turn.sessionId), { recursive: true });
  const tmp = latestPath(turn.sessionId) + ".tmp";
  await writeFile(tmp, JSON.stringify(turn, null, 2), "utf-8");
  const { rename } = await import("node:fs/promises");
  await rename(tmp, latestPath(turn.sessionId));
}

export async function readLatest(sessionId: string): Promise<TipTurn | null> {
  const path = latestPath(sessionId);
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

export async function readAllTips(sessionId: string): Promise<TipTurn[]> {
  const path = tipsPath(sessionId);
  if (!existsSync(path)) {
    return [];
  }
  const raw = await readFile(path, "utf-8");
  return raw
    .split("\n")
    .filter((line: string) => line.trim())
    .map((line: string) => JSON.parse(line) as TipTurn);
}
