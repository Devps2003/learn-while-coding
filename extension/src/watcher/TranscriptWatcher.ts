import * as vscode from "vscode";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { FSWatcher } from "node:fs";
import type { TipTurn } from "./TipWatcher.js";
import { readLatestForSession } from "./TipWatcher.js";
import { outputChannel } from "../panel/LearnPanelProvider.js";
import { apiTipsToTurn, callHostedApi, loadTipConfig, writeTipTurn } from "../tips/tipApi.js";

const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");
const STATE_PATH = join(homedir(), ".learnwhile", "transcript-state.json");
const DEBOUNCE_MS = 5000;
const POLL_MS = 4000;
const API_COOLDOWN_MS = 3000;

export type TranscriptTipCallback = (turn: TipTurn) => void;

interface ParsedTurn {
  sessionId: string;
  turnId: string;
  userPrompt: string;
  agentResponse: string;
  fingerprint: string;
}

interface TranscriptState {
  fingerprints: Record<string, string>;
}

let apiChain: Promise<void> = Promise.resolve();
let lastApiCall = 0;

/** Matches Claude Code's project folder naming: non-alphanumeric → hyphen */
export function encodeClaudeProjectPath(workspacePath: string): string {
  return workspacePath.replace(/\\/g, "/").replace(/[^a-zA-Z0-9-]/g, "-");
}

export function claudeProjectDirForWorkspace(workspacePath: string): string {
  return join(CLAUDE_PROJECTS_DIR, encodeClaudeProjectPath(workspacePath));
}

async function resolveClaudeProjectDir(): Promise<string | null> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return null;

  const expected = claudeProjectDirForWorkspace(folder.uri.fsPath);
  if (existsSync(expected)) return expected;

  if (!existsSync(CLAUDE_PROJECTS_DIR)) return null;

  const encoded = encodeClaudeProjectPath(folder.uri.fsPath);
  const folderName = basename(folder.uri.fsPath).toLowerCase();
  const entries = await readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name === encoded || name.endsWith(`-${folderName}`) || name.includes(folderName)) {
      const candidate = join(CLAUDE_PROJECTS_DIR, name);
      if (existsSync(candidate)) return candidate;
    }
  }

  return null;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
      const text = (block as { text?: string }).text;
      if (typeof text === "string" && text.trim()) parts.push(text.trim());
    }
  }
  return parts.join("\n");
}

function parseTranscript(raw: string, filePath: string): ParsedTurn | null {
  const lines = raw.split("\n").filter((l) => l.trim());
  let sessionId = basename(filePath, ".jsonl");
  let lastUser = "";
  let lastAssistant = "";
  let lastUserUuid = "";
  let lastAssistantUuid = "";

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (typeof entry.sessionId === "string") sessionId = entry.sessionId;
    const message = entry.message as Record<string, unknown> | undefined;
    if (!message) continue;

    const role = message.role as string | undefined;
    const content = message.content;

    if (entry.type === "user" || role === "user") {
      const text = extractText(content);
      if (text) {
        lastUser = text;
        lastUserUuid = typeof entry.uuid === "string" ? entry.uuid : lastUserUuid;
      }
      continue;
    }

    if (role === "assistant") {
      const text = extractText(content);
      if (text) {
        lastAssistant = text;
        lastAssistantUuid = typeof entry.uuid === "string" ? entry.uuid : lastAssistantUuid;
      }
    }
  }

  if (!lastUser || !lastAssistant || lastAssistant.length < 10) return null;

  const turnId = lastAssistantUuid || lastUserUuid || `turn-${lines.length}`;
  return {
    sessionId,
    turnId,
    userPrompt: lastUser.slice(0, 4000),
    agentResponse: lastAssistant.slice(0, 6000),
    fingerprint: `${turnId}:${lastUser.slice(0, 80)}:${lastAssistant.slice(-120)}`,
  };
}

async function loadState(): Promise<TranscriptState> {
  if (!existsSync(STATE_PATH)) return { fingerprints: {} };
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf-8")) as TranscriptState;
  } catch {
    return { fingerprints: {} };
  }
}

async function saveState(state: TranscriptState): Promise<void> {
  await mkdir(join(homedir(), ".learnwhile"), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

async function findWorkspaceTranscripts(): Promise<string[]> {
  const projectDir = await resolveClaudeProjectDir();
  if (!projectDir) return [];

  const files: string[] = [];
  const entries = await readdir(projectDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(join(projectDir, entry.name));
    }
  }
  return files;
}

function enqueueApi<T>(fn: () => Promise<T>): Promise<T> {
  const run = apiChain.then(async () => {
    const wait = API_COOLDOWN_MS - (Date.now() - lastApiCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastApiCall = Date.now();
    return fn();
  });
  apiChain = run.then(() => undefined, () => undefined);
  return run;
}

async function sessionHasTips(sessionId: string): Promise<boolean> {
  const turn = await readLatestForSession(`claude-${sessionId}`);
  return Boolean(turn?.tips?.length);
}

export class TranscriptWatcher {
  private watchers: FSWatcher[] = [];
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastMtime = new Map<string, string>();
  private fingerprints = new Map<string, string>();
  private generating = new Set<string>();
  private seeded = false;
  private projectDir: string | null = null;
  private callback: TranscriptTipCallback;

  constructor(callback: TranscriptTipCallback) {
    this.callback = callback;
  }

  async start(): Promise<void> {
    const state = await loadState();
    for (const [file, fp] of Object.entries(state.fingerprints)) {
      this.fingerprints.set(file, fp);
    }

    this.projectDir = await resolveClaudeProjectDir();
    await this.seedCurrentTranscripts();

    if (existsSync(CLAUDE_PROJECTS_DIR)) {
      const { watch } = await import("node:fs");
      const watcher = watch(CLAUDE_PROJECTS_DIR, { recursive: true }, () => {
        void this.scanWorkspace();
      });
      this.watchers.push(watcher);
    }

    this.pollInterval = setInterval(() => void this.scanWorkspace(), POLL_MS);

    const ws = vscode.workspace.workspaceFolders?.[0]?.name ?? "none";
    const expected = vscode.workspace.workspaceFolders?.[0]
      ? encodeClaudeProjectPath(vscode.workspace.workspaceFolders[0].uri.fsPath)
      : "none";
    outputChannel.appendLine(
      `TranscriptWatcher: workspace=${ws} encoded=${expected} projectDir=${this.projectDir ?? "not found"}`
    );
  }

  dispose(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    if (this.pollInterval) clearInterval(this.pollInterval);
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
  }

  private async seedCurrentTranscripts(): Promise<void> {
    const files = await findWorkspaceTranscripts();
    let queued = 0;

    for (const file of files) {
      try {
        const raw = await readFile(file, "utf-8");
        const parsed = parseTranscript(raw, file);
        const fileStat = await stat(file);
        const mtimeKey = `${fileStat.mtimeMs}:${fileStat.size}`;
        this.lastMtime.set(file, mtimeKey);

        if (!parsed) continue;

        const prevFp = this.fingerprints.get(file);
        const hasTips = await sessionHasTips(parsed.sessionId);

        if (prevFp === parsed.fingerprint && hasTips) continue;

        if (!hasTips || prevFp !== parsed.fingerprint) {
          queued++;
          void this.processFile(file, mtimeKey);
        } else if (!this.fingerprints.has(file)) {
          this.fingerprints.set(file, parsed.fingerprint);
        }
      } catch {
        // ignore
      }
    }

    await this.persistState();
    this.seeded = true;
    outputChannel.appendLine(
      `TranscriptWatcher: ${files.length} transcript(s), ${queued} queued for tip generation`
    );
  }

  private async persistState(): Promise<void> {
    const fingerprints: Record<string, string> = {};
    for (const [k, v] of this.fingerprints) fingerprints[k] = v;
    await saveState({ fingerprints });
  }

  private async scanWorkspace(): Promise<void> {
    if (!this.seeded) return;

    if (!this.projectDir) {
      this.projectDir = await resolveClaudeProjectDir();
      if (this.projectDir) {
        outputChannel.appendLine(`TranscriptWatcher: found project dir ${this.projectDir}`);
      }
    }

    try {
      const files = await findWorkspaceTranscripts();
      for (const file of files) await this.scheduleCheck(file);
    } catch (err) {
      outputChannel.appendLine(`TranscriptWatcher scan error: ${String(err)}`);
    }
  }

  private async scheduleCheck(filePath: string): Promise<void> {
    try {
      const fileStat = await stat(filePath);
      const mtimeKey = `${fileStat.mtimeMs}:${fileStat.size}`;
      if (this.lastMtime.get(filePath) === mtimeKey) return;

      const existing = this.debounceTimers.get(filePath);
      if (existing) clearTimeout(existing);

      this.debounceTimers.set(
        filePath,
        setTimeout(() => {
          this.debounceTimers.delete(filePath);
          void this.processFile(filePath, mtimeKey);
        }, DEBOUNCE_MS)
      );
    } catch {
      // deleted
    }
  }

  private async processFile(filePath: string, mtimeKey: string): Promise<void> {
    if (this.generating.has(filePath)) return;

    try {
      const raw = await readFile(filePath, "utf-8");
      const parsed = parseTranscript(raw, filePath);
      if (!parsed) {
        this.lastMtime.set(filePath, mtimeKey);
        return;
      }

      const prevFp = this.fingerprints.get(filePath);
      const hasTips = await sessionHasTips(parsed.sessionId);
      if (prevFp === parsed.fingerprint && hasTips) {
        this.lastMtime.set(filePath, mtimeKey);
        return;
      }

      this.generating.add(filePath);
      outputChannel.appendLine(`Transcript turn detected: ${parsed.sessionId}`);

      const config = await loadTipConfig();
      if (!config.enabled) {
        outputChannel.appendLine("Tips disabled in config — enable learnwhile.enabled");
        return;
      }

      const prompt = [
        `User prompt:\n${parsed.userPrompt}`,
        `Agent response:\n${parsed.agentResponse}`,
        "Generate learning tips for this Claude Code chat turn.",
      ].join("\n\n");

      const tips = await enqueueApi(() => callHostedApi(config, prompt));

      this.fingerprints.set(filePath, parsed.fingerprint);
      this.lastMtime.set(filePath, mtimeKey);
      await this.persistState();

      if (tips.length === 0) {
        outputChannel.appendLine(`No tips generated for ${parsed.sessionId} (API returned empty)`);
        return;
      }

      const turn = apiTipsToTurn(tips, `claude-${parsed.sessionId}`, "claude", parsed.turnId);
      await writeTipTurn(turn);

      outputChannel.appendLine(`Generated ${tips.length} tips for ${parsed.sessionId}`);
      this.callback(turn);
    } catch (err) {
      outputChannel.appendLine(`TranscriptWatcher error: ${String(err)}`);
    } finally {
      this.generating.delete(filePath);
    }
  }
}

export async function getTranscriptDiagnostics(): Promise<string[]> {
  const lines: string[] = [];
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    lines.push("! No workspace folder open");
    return lines;
  }

  const encoded = encodeClaudeProjectPath(folder.uri.fsPath);
  const projectDir = await resolveClaudeProjectDir();
  lines.push(`Workspace path: ${folder.uri.fsPath}`);
  lines.push(`Encoded Claude dir: ${encoded}`);
  lines.push(`Resolved project dir: ${projectDir ?? "NOT FOUND"}`);

  if (projectDir) {
    const files = await findWorkspaceTranscripts();
    lines.push(`Transcript files: ${files.length}`);
    for (const file of files.slice(0, 3)) {
      try {
        const raw = await readFile(file, "utf-8");
        const parsed = parseTranscript(raw, file);
        lines.push(`  ${basename(file)}: ${parsed ? "parseable" : "unparseable"}`);
      } catch {
        lines.push(`  ${basename(file)}: read error`);
      }
    }
  } else if (existsSync(CLAUDE_PROJECTS_DIR)) {
    const dirs = await readdir(CLAUDE_PROJECTS_DIR);
    lines.push(`Available Claude project dirs (${dirs.length}): ${dirs.slice(0, 5).join(", ")}${dirs.length > 5 ? "…" : ""}`);
  } else {
    lines.push("! ~/.claude/projects does not exist — chat in Claude Code first");
  }

  return lines;
}
