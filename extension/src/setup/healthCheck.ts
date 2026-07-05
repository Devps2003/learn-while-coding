import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { HookInstallStatus } from "../install/HookInstaller.js";
import { RUNNER_NAME } from "../install/hookCommands.js";

export interface HealthReport {
  ok: boolean;
  nodeAvailable: boolean;
  nodeVersion: string;
  configOk: boolean;
  runnerOk: boolean;
  hooksOk: boolean;
  claudeSettingsValid: boolean;
  issues: string[];
  tips: string[];
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

export async function runHealthCheck(status: HookInstallStatus): Promise<HealthReport> {
  const issues: string[] = [];
  const tips: string[] = [];

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

  if (status.isVsCode && !status.claudeHooksInstalled) {
    issues.push("Claude Code hooks not installed.");
    tips.push("Open a project folder, then run Install Hooks.");
  }

  if (status.autoTipsMode === "manual") {
    tips.push("Copilot mode: tips auto-generate on file save, or run Generate Tips from Editor.");
  }

  return {
    ok: issues.length === 0 && nodeAvailable && runnerOk && hooksOk && claudeSettingsValid,
    nodeAvailable,
    nodeVersion,
    configOk,
    runnerOk,
    hooksOk,
    claudeSettingsValid,
    issues,
    tips,
  };
}
