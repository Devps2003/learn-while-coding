import { homedir } from "node:os";
import { basename, join } from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { FSWatcher } from "node:fs";
import type { TipTurn } from "./TipWatcher.js";
import { outputChannel } from "../panel/LearnPanelProvider.js";
import { apiTipsToTurn, callHostedApi, loadTipConfig, writeTipTurn } from "../tips/tipApi.js";

const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");
const DEBOUNCE_MS = 4000;
const POLL_MS = 5000;

export type TranscriptTipCallback = (turn: TipTurn) => void;

interface ParsedTurn {
  sessionId: string;
  turnId: string;
  userPrompt: string;
  agentResponse: string;
  fingerprint: string;
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
      const text = (block as { text?: string }).text;
      if (typeof text === "string" && text.trim()) {
        parts.push(text.trim());
      }
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

    if (typeof entry.sessionId === "string") {
      sessionId = entry.sessionId;
    }

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

  if (!lastUser || !lastAssistant || lastAssistant.length < 20) {
    return null;
  }

  const turnId = lastAssistantUuid || lastUserUuid || `turn-${lines.length}`;
  const fingerprint = `${turnId}:${lastUser.slice(0, 80)}:${lastAssistant.slice(-120)}`;

  return {
    sessionId,
    turnId,
    userPrompt: lastUser.slice(0, 4000),
    agentResponse: lastAssistant.slice(0, 6000),
    fingerprint,
  };
}

async function findTranscriptFiles(): Promise<string[]> {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) {
    return [];
  }

  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "subagents" || entry.name === "memory") continue;
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl") && !full.includes("/subagents/")) {
        files.push(full);
      }
    }
  }

  await walk(CLAUDE_PROJECTS_DIR);
  return files;
}

export class TranscriptWatcher {
  private watchers: FSWatcher[] = [];
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastFingerprint = new Map<string, string>();
  private generating = new Set<string>();
  private callback: TranscriptTipCallback;

  constructor(callback: TranscriptTipCallback) {
    this.callback = callback;
  }

  async start(): Promise<void> {
    await this.scanAll();

    if (existsSync(CLAUDE_PROJECTS_DIR)) {
      const { watch } = await import("node:fs");
      const watcher = watch(CLAUDE_PROJECTS_DIR, { recursive: true }, () => {
        void this.scanAll();
      });
      this.watchers.push(watcher);
    }

    this.pollInterval = setInterval(() => void this.scanAll(), POLL_MS);
    outputChannel.appendLine(`TranscriptWatcher watching ${CLAUDE_PROJECTS_DIR}`);
  }

  dispose(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    if (this.pollInterval) clearInterval(this.pollInterval);
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
  }

  private async scanAll(): Promise<void> {
    try {
      const files = await findTranscriptFiles();
      for (const file of files) {
        await this.scheduleCheck(file);
      }
    } catch (err) {
      outputChannel.appendLine(`TranscriptWatcher scan error: ${String(err)}`);
    }
  }

  private async scheduleCheck(filePath: string): Promise<void> {
    try {
      const fileStat = await stat(filePath);
      const key = `${filePath}:${fileStat.mtimeMs}:${fileStat.size}`;
      const prev = this.lastFingerprint.get(`mtime:${filePath}`);
      if (prev === key) return;

      const existing = this.debounceTimers.get(filePath);
      if (existing) clearTimeout(existing);

      this.debounceTimers.set(
        filePath,
        setTimeout(() => {
          this.debounceTimers.delete(filePath);
          void this.processFile(filePath, key);
        }, DEBOUNCE_MS)
      );
    } catch {
      // file may have been deleted
    }
  }

  private async processFile(filePath: string, mtimeKey: string): Promise<void> {
    if (this.generating.has(filePath)) return;

    try {
      const raw = await readFile(filePath, "utf-8");
      const parsed = parseTranscript(raw, filePath);
      if (!parsed) return;

      const prevFp = this.lastFingerprint.get(`fp:${filePath}`);
      if (prevFp === parsed.fingerprint) {
        this.lastFingerprint.set(`mtime:${filePath}`, mtimeKey);
        return;
      }

      this.generating.add(filePath);
      outputChannel.appendLine(`Transcript turn detected: ${parsed.sessionId} (${filePath})`);

      const config = await loadTipConfig();
      if (!config.enabled) return;

      const prompt = [
        `User prompt:\n${parsed.userPrompt}`,
        `Agent response:\n${parsed.agentResponse}`,
        "Generate learning tips for this Claude Code VS Code chat turn.",
      ].join("\n\n");

      const tips = await callHostedApi(config, prompt);
      if (tips.length === 0) {
        this.lastFingerprint.set(`fp:${filePath}`, parsed.fingerprint);
        this.lastFingerprint.set(`mtime:${filePath}`, mtimeKey);
        return;
      }

      const turn = apiTipsToTurn(tips, `claude-${parsed.sessionId}`, "claude", parsed.turnId);
      await writeTipTurn(turn);

      this.lastFingerprint.set(`fp:${filePath}`, parsed.fingerprint);
      this.lastFingerprint.set(`mtime:${filePath}`, mtimeKey);

      outputChannel.appendLine(`Generated ${tips.length} tips from transcript ${parsed.sessionId}`);
      this.callback(turn);
    } catch (err) {
      outputChannel.appendLine(`TranscriptWatcher process error: ${String(err)}`);
    } finally {
      this.generating.delete(filePath);
    }
  }
}
