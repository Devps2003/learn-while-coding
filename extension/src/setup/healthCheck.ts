import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { HookInstallStatus } from "../install/HookInstaller.js";
import { RUNNER_NAME } from "../install/hookCommands.js";
import { readAllLatestTips, listSessionIds } from "../watcher/TipWatcher.js";
import { getTranscriptDiagnostics } from "../watcher/TranscriptWatcher.js";
import { loadTipConfig, pingHostedApi } from "../tips/tipApi.js";

export interface HealthReport {
  ok: boolean;
  nodeAvailable: boolean;
  nodeVersion: string;
  configOk: boolean;
  runnerOk: boolean;
  hooksOk: boolean;
  apiOk: boolean;
  claudeSettingsValid: boolean;
  sessionCount: number;
  tipCount: number;
  issues: string[];
  tips: string[];
  diagnostics: string[];
}

function tryNodeVersion(): string {
  try {
    return execSync("node --version", { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

async function validateJsonFile(path: string): Promise<boolean> {
  if (!existsSync(path)) {
    return true;
  }
  try {
    const raw = await readFile(path, "utf-8");
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

async function testHostedApi(): Promise<{ ok: boolean; detail: string }> {
  const config = await loadTipConfig();
  return pingHostedApi(config);
}

export async function runHealthCheck(status: HookInstallStatus): Promise<HealthReport> {
  const issues: string[] = [];
  const tips: string[] = [];
  const diagnostics: string[] = [];

  const nodeVersion = tryNodeVersion();
  const nodeAvailable = Boolean(nodeVersion);
  if (!nodeAvailable) {
    issues.push("Node.js not found in PATH — hooks need Node 20+.");
    tips.push("Install Node.js from https://nodejs.org and reload the editor.");
  }

  const configPath = join(homedir(), ".learnwhile", "config.json");
  const configOk = existsSync(configPath);
  if (!configOk) {
    issues.push("Config missing at ~/.learnwhile/config.json");
  }

  const runnerPath = join(status.hooksDir, RUNNER_NAME);
  const runnerOk = existsSync(runnerPath);
  if (!runnerOk) {
    issues.push(`Hook runner missing: ${runnerPath}`);
    tips.push("Run: Learn While Coding: Install Hooks");
  }

  const globalClaude = join(homedir(), ".claude", "settings.json");
  const projectClaude = status.claudeProjectSettingsPath;
  const claudePaths = [projectClaude, globalClaude].filter((p): p is string => Boolean(p));

  let claudeSettingsValid = true;
  for (const path of claudePaths) {
    if (existsSync(path) && !(await validateJsonFile(path))) {
      claudeSettingsValid = false;
      issues.push(`Invalid JSON: ${path}`);
      tips.push("Run: Learn While Coding: Install Hooks to repair settings.");
    }
  }

  const hooksOk = status.isCursor ? status.cursorHooksInstalled : status.claudeHooksInstalled;

  if (status.isCursor && !status.cursorHooksInstalled) {
    issues.push("Cursor hooks not installed.");
    tips.push("Reload Cursor — hooks auto-install on startup.");
  }

  // VS Code Claude uses TranscriptWatcher — hooks are optional
  if (status.isVsCode && !status.isCursor && !status.claudeHooksInstalled) {
    tips.push("Claude hooks not installed — using transcript file watcher instead (normal for VS Code).");
  }

  if (status.autoTipsMode === "manual") {
    tips.push("Copilot mode: tips auto-generate on file save, or run Generate Tips from Editor.");
  }

  const apiResult = await testHostedApi();
  diagnostics.push(apiResult.detail);
  if (!apiResult.ok) {
    issues.push("Hosted tips API unreachable");
    tips.push("Corporate network may block Vercel. Run Setup → add your Groq API key (works without hosted API).");
    tips.push("Or set VS Code Settings → http.proxy if your company uses a proxy.");
  }

  const sessionIds = await listSessionIds();
  const allTurns = await readAllLatestTips();
  const tipCount = allTurns.reduce((n, t) => n + t.tips.length, 0);
  diagnostics.push(`Sessions with tips: ${allTurns.length}/${sessionIds.length} (${tipCount} cards total)`);

  if (status.isVsCode && !status.isCursor) {
    const transcriptLines = await getTranscriptDiagnostics();
    diagnostics.push(...transcriptLines);
    if (transcriptLines.some((l) => l.includes("NOT FOUND"))) {
      issues.push("Claude transcript project dir not found for this workspace");
      tips.push("Open the same folder you use with Claude Code, then chat once to create transcripts.");
    }
  }

  const needsHooks = status.isCursor;
  const hasGroqFallback = Boolean((await loadTipConfig()).apiKey.trim());
  const ok =
    issues.filter((i) => !(hasGroqFallback && i === "Hosted tips API unreachable")).length === 0 &&
    nodeAvailable &&
    runnerOk &&
    (apiResult.ok || hasGroqFallback) &&
    claudeSettingsValid &&
    (!needsHooks || hooksOk);

  return {
    ok,
    nodeAvailable,
    nodeVersion,
    configOk,
    runnerOk,
    hooksOk,
    apiOk: apiResult.ok,
    claudeSettingsValid,
    sessionCount: sessionIds.length,
    tipCount,
    issues,
    tips,
    diagnostics,
  };
}
