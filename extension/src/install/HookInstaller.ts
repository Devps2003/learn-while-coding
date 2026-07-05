import * as vscode from "vscode";
import { homedir } from "node:os";
import { join } from "node:path";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { outputChannel } from "../panel/LearnPanelProvider.js";

const HOOK_MARKER = "learnwhile-hook-runner.mjs";
const HOOK_SCRIPT_NAMES = [
  "cursor-accumulate.sh",
  "cursor-accumulate-response.sh",
  "cursor-accumulate-edit.sh",
  "cursor-generate.sh",
];

export interface HookInstallStatus {
  isCursor: boolean;
  hooksInstalled: boolean;
  hooksDir: string;
  configExists: boolean;
  sessionsDir: string;
  sessionCount: number;
}

function isCursorApp(): boolean {
  return /cursor/i.test(vscode.env.appName);
}

export async function getHookInstallStatus(): Promise<HookInstallStatus> {
  const hooksDir = join(homedir(), ".cursor", "hooks");
  const runnerPath = join(hooksDir, HOOK_MARKER);
  const configPath = join(homedir(), ".learnwhile", "config.json");
  const sessionsDir = join(homedir(), ".learnwhile", "sessions");

  let sessionCount = 0;
  if (existsSync(sessionsDir)) {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(sessionsDir, { withFileTypes: true });
    sessionCount = entries.filter((e) => e.isDirectory()).length;
  }

  return {
    isCursor: isCursorApp(),
    hooksInstalled: existsSync(runnerPath),
    hooksDir,
    configExists: existsSync(configPath),
    sessionsDir,
    sessionCount,
  };
}

async function mergeHooksJson(hooksJsonPath: string): Promise<void> {
  const learnwhileHooks = {
    beforeSubmitPrompt: [{ command: "./hooks/cursor-accumulate.sh" }],
    afterAgentResponse: [{ command: "./hooks/cursor-accumulate-response.sh" }],
    afterFileEdit: [{ command: "./hooks/cursor-accumulate-edit.sh" }],
    stop: [{ command: "./hooks/cursor-generate.sh" }],
  };

  let existing: { version?: number; hooks?: Record<string, unknown> } = { version: 1, hooks: {} };

  if (existsSync(hooksJsonPath)) {
    try {
      const raw = await readFile(hooksJsonPath, "utf-8");
      existing = JSON.parse(raw) as typeof existing;
      existing.hooks ??= {};
    } catch {
      existing = { version: 1, hooks: {} };
    }
  }

  const hooks = existing.hooks ?? {};
  for (const [event, commands] of Object.entries(learnwhileHooks)) {
    const current = Array.isArray(hooks[event]) ? hooks[event] : [];
    const alreadyHas = current.some(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        "command" in entry &&
        String((entry as { command: string }).command).includes("cursor-")
    );
    if (!alreadyHas) {
      hooks[event] = [...current, ...commands];
    }
  }

  await writeFile(
    hooksJsonPath,
    JSON.stringify({ version: 1, hooks }, null, 2) + "\n",
    "utf-8"
  );
}

export async function installCursorHooks(extensionUri: vscode.Uri): Promise<boolean> {
  if (!isCursorApp()) {
    outputChannel.appendLine("Hook install skipped: not running in Cursor");
    return false;
  }

  const resourcesDir = join(extensionUri.fsPath, "resources");
  const runnerSrc = join(resourcesDir, "hook-runner.mjs");
  const hooksSrcDir = join(resourcesDir, "hooks");

  if (!existsSync(runnerSrc)) {
    outputChannel.appendLine(`Hook install failed: missing ${runnerSrc}`);
    return false;
  }

  const cursorDir = join(homedir(), ".cursor");
  const hooksDir = join(cursorDir, "hooks");
  const hooksJsonPath = join(cursorDir, "hooks.json");

  await mkdir(hooksDir, { recursive: true });

  const runnerDest = join(hooksDir, HOOK_MARKER);
  await copyFile(runnerSrc, runnerDest);
  await chmod(runnerDest, 0o755);

  for (const script of HOOK_SCRIPT_NAMES) {
    const src = join(hooksSrcDir, script);
    if (!existsSync(src)) {
      outputChannel.appendLine(`Hook install warning: missing ${src}`);
      continue;
    }
    const dest = join(hooksDir, script);
    await copyFile(src, dest);
    await chmod(dest, 0o755);
  }

  await mergeHooksJson(hooksJsonPath);

  outputChannel.appendLine(`Cursor hooks installed to ${hooksDir}`);
  return true;
}

export async function ensureCursorHooks(extensionUri: vscode.Uri): Promise<HookInstallStatus> {
  const status = await getHookInstallStatus();

  if (status.isCursor && !status.hooksInstalled) {
    const installed = await installCursorHooks(extensionUri);
    if (installed) {
      return getHookInstallStatus();
    }
  }

  return status;
}
