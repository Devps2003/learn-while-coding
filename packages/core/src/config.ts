import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { LearnWhileConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";

export const LEARNWHILE_DIR = join(homedir(), ".learnwhile");
export const CONFIG_PATH = join(LEARNWHILE_DIR, "config.json");
export const SESSIONS_DIR = join(LEARNWHILE_DIR, "sessions");
export const LOGS_DIR = join(LEARNWHILE_DIR, "logs");

export async function ensureDirs(): Promise<void> {
  await mkdir(LEARNWHILE_DIR, { recursive: true });
  await mkdir(SESSIONS_DIR, { recursive: true });
  await mkdir(LOGS_DIR, { recursive: true });
}

export function sessionDir(sessionId: string): string {
  return join(SESSIONS_DIR, sanitizeId(sessionId));
}

export function tipsPath(sessionId: string): string {
  return join(sessionDir(sessionId), "tips.jsonl");
}

export function latestPath(sessionId: string): string {
  return join(sessionDir(sessionId), "latest.json");
}

export function indexPath(sessionId: string): string {
  return join(sessionDir(sessionId), "index.json");
}

export function contextPath(sessionId: string): string {
  return join(sessionDir(sessionId), "context.json");
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128);
}

export async function loadConfig(): Promise<LearnWhileConfig> {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<LearnWhileConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: LearnWhileConfig): Promise<void> {
  await ensureDirs();
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export async function logError(message: string, error?: unknown): Promise<void> {
  await ensureDirs();
  const line = `[${new Date().toISOString()}] ${message}${error ? ` ${String(error)}` : ""}\n`;
  const logFile = join(LOGS_DIR, "hook-runner.log");
  await writeFile(logFile, line, { flag: "a" });
}
