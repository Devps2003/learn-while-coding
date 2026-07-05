import * as vscode from "vscode";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { outputChannel } from "../panel/LearnPanelProvider.js";
import { nodeHookCommand, RUNNER_NAME } from "./hookCommands.js";

const CURSOR_EVENTS = [
  { event: "beforeSubmitPrompt", key: "beforeSubmitPrompt" },
  { event: "afterAgentResponse", key: "afterAgentResponse" },
  { event: "afterFileEdit", key: "afterFileEdit" },
  { event: "stop", key: "stop" },
] as const;

const CLAUDE_EVENTS = [
  { event: "beforeSubmitPrompt", key: "UserPromptSubmit" },
  { event: "postToolUse", key: "PostToolUse", matcher: "Edit|Write" },
  { event: "stop", key: "Stop" },
  { event: "sessionEnd", key: "SessionEnd" },
] as const;

export type AutoTipsMode = "cursor" | "claude" | "manual";

export interface HookInstallStatus {
  appName: string;
  isCursor: boolean;
  isVsCode: boolean;
  cursorHooksInstalled: boolean;
  claudeHooksInstalled: boolean;
  claudeProjectSettingsPath: string | null;
  hooksInstalled: boolean;
  autoTipsMode: AutoTipsMode;
  hooksDir: string;
  configExists: boolean;
  sessionsDir: string;
  sessionCount: number;
}

interface ClaudeHookHandler {
  type: "command";
  command: string;
  timeout?: number;
}

interface ClaudeHookGroup {
  matcher?: string;
  hooks: ClaudeHookHandler[];
}

function isCursorApp(): boolean {
  return /cursor/i.test(vscode.env.appName);
}

function sharedHooksDir(): string {
  return join(homedir(), ".learnwhile", "hooks");
}

function cursorHooksDir(): string {
  return join(homedir(), ".cursor", "hooks");
}

function projectClaudeSettingsPath(): string | null {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? join(folder.uri.fsPath, ".claude", "settings.json") : null;
}

function buildLearnwhileClaudeHooks(hooksDir: string): Record<string, ClaudeHookGroup[]> {
  const cmd = (platform: "claude", event: string, timeout?: number): ClaudeHookHandler => ({
    type: "command",
    command: nodeHookCommand(hooksDir, platform, event),
    ...(timeout ? { timeout } : {}),
  });

  return {
    UserPromptSubmit: [{ hooks: [cmd("claude", "beforeSubmitPrompt", 30)] }],
    PostToolUse: [{ matcher: "Edit|Write", hooks: [cmd("claude", "postToolUse")] }],
    Stop: [{ hooks: [cmd("claude", "stop")] }],
    SessionEnd: [{ hooks: [cmd("claude", "sessionEnd")] }],
  };
}

function isLearnwhileCommand(command: string): boolean {
  return command.includes(RUNNER_NAME) || command.includes("learnwhile");
}

function stripLearnwhileGroups(groups: unknown[]): unknown[] {
  const cleaned: unknown[] = [];

  for (const group of groups) {
    if (!group || typeof group !== "object") {
      cleaned.push(group);
      continue;
    }

    const entry = { ...(group as Record<string, unknown>) };

    if (typeof entry.command === "string" && isLearnwhileCommand(entry.command)) {
      continue;
    }

    if (Array.isArray(entry.hooks)) {
      const handlers = (entry.hooks as ClaudeHookHandler[]).filter(
        (h) => !isLearnwhileCommand(h.command ?? "")
      );
      if (handlers.length === 0) {
        continue;
      }
      entry.hooks = handlers;
    }

    cleaned.push(entry);
  }

  return cleaned;
}

function normalizePermissions(settings: Record<string, unknown>): Record<string, unknown> {
  const permissions = settings.permissions;
  if (!permissions || typeof permissions !== "object") {
    return settings;
  }

  const perms = { ...(permissions as Record<string, unknown>) };
  if (!Array.isArray(perms.allow)) perms.allow = [];
  if (!Array.isArray(perms.deny)) perms.deny = [];
  if (!Array.isArray(perms.ask)) perms.ask = [];

  return { ...settings, permissions: perms };
}

function claudeHooksInSettings(raw: string): boolean {
  return raw.includes(RUNNER_NAME) || raw.includes("learnwhile");
}

async function readSettingsJson(path: string): Promise<Record<string, unknown>> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
  } catch {
    outputChannel.appendLine(`WARN: could not parse ${path}, will repair`);
    return {};
  }
}

async function backupFile(path: string): Promise<void> {
  if (!existsSync(path)) return;
  try {
    await copyFile(path, `${path}.learnwhile.bak`);
  } catch {
    // non-fatal
  }
}

async function writeValidatedJson(path: string, data: Record<string, unknown>): Promise<void> {
  const text = JSON.stringify(data, null, 2) + "\n";
  JSON.parse(text);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf-8");
}

async function mergeClaudeSettingsAtPath(settingsPath: string, hooksDir: string): Promise<void> {
  await backupFile(settingsPath);

  const existing = normalizePermissions(await readSettingsJson(settingsPath));
  const hooks =
    existing.hooks && typeof existing.hooks === "object"
      ? { ...(existing.hooks as Record<string, unknown>) }
      : {};

  const learnwhileHooks = buildLearnwhileClaudeHooks(hooksDir);

  for (const [event, newGroups] of Object.entries(learnwhileHooks)) {
    const current = Array.isArray(hooks[event]) ? [...(hooks[event] as unknown[])] : [];
    hooks[event] = [...stripLearnwhileGroups(current), ...newGroups];
  }

  await writeValidatedJson(settingsPath, { ...existing, hooks });
}

async function copyHookRunner(extensionUri: vscode.Uri, destDir: string): Promise<boolean> {
  const runnerSrc = join(extensionUri.fsPath, "resources", "hook-runner.mjs");
  if (!existsSync(runnerSrc)) {
    outputChannel.appendLine(`Hook install failed: missing ${runnerSrc}`);
    return false;
  }

  await mkdir(destDir, { recursive: true });
  const runnerDest = join(destDir, RUNNER_NAME);
  await copyFile(runnerSrc, runnerDest);
  await chmod(runnerDest, 0o755);
  return true;
}

async function mergeCursorHooksJson(hooksJsonPath: string, hooksDir: string): Promise<void> {
  await backupFile(hooksJsonPath);

  const learnwhileHooks: Record<string, Array<{ command: string }>> = {};
  for (const { event, key } of CURSOR_EVENTS) {
    learnwhileHooks[key] = [{ command: nodeHookCommand(hooksDir, "cursor", event) }];
  }

  let existing: { version?: number; hooks?: Record<string, unknown> } = { version: 1, hooks: {} };

  if (existsSync(hooksJsonPath)) {
    try {
      existing = JSON.parse(await readFile(hooksJsonPath, "utf-8")) as typeof existing;
      existing.hooks ??= {};
    } catch {
      existing = { version: 1, hooks: {} };
    }
  }

  const hooks = existing.hooks ?? {};

  for (const [event, commands] of Object.entries(learnwhileHooks)) {
    const current = Array.isArray(hooks[event]) ? (hooks[event] as Array<{ command?: string }>) : [];
    const stripped = current.filter((e) => !e.command?.includes(RUNNER_NAME));
    hooks[event] = [...stripped, ...commands];
  }

  await writeValidatedJson(hooksJsonPath, { version: 1, hooks });
}

export async function getHookInstallStatus(): Promise<HookInstallStatus> {
  const isCursor = isCursorApp();
  const configPath = join(homedir(), ".learnwhile", "config.json");
  const sessionsDir = join(homedir(), ".learnwhile", "sessions");
  const hooksDir = isCursor ? cursorHooksDir() : sharedHooksDir();
  const projectSettings = projectClaudeSettingsPath();

  const cursorHooksInstalled = existsSync(join(cursorHooksDir(), RUNNER_NAME));
  let claudeHooksInstalled = existsSync(join(sharedHooksDir(), RUNNER_NAME));

  for (const path of [projectSettings, join(homedir(), ".claude", "settings.json")].filter(Boolean)) {
    if (path && existsSync(path)) {
      try {
        if (claudeHooksInSettings(await readFile(path, "utf-8"))) {
          claudeHooksInstalled = true;
          break;
        }
      } catch {
        // ignore
      }
    }
  }

  let sessionCount = 0;
  if (existsSync(sessionsDir)) {
    const { readdir } = await import("node:fs/promises");
    sessionCount = (await readdir(sessionsDir, { withFileTypes: true })).filter((e) =>
      e.isDirectory()
    ).length;
  }

  const autoTipsMode: AutoTipsMode = isCursor ? "cursor" : claudeHooksInstalled ? "claude" : "manual";

  return {
    appName: vscode.env.appName,
    isCursor,
    isVsCode: !isCursor,
    cursorHooksInstalled,
    claudeHooksInstalled,
    claudeProjectSettingsPath: projectSettings,
    hooksInstalled: isCursor ? cursorHooksInstalled : claudeHooksInstalled,
    autoTipsMode,
    hooksDir,
    configExists: existsSync(configPath),
    sessionsDir,
    sessionCount,
  };
}

export async function installCursorHooks(extensionUri: vscode.Uri): Promise<boolean> {
  const hooksDir = cursorHooksDir();
  if (!(await copyHookRunner(extensionUri, hooksDir))) return false;

  await mergeCursorHooksJson(join(homedir(), ".cursor", "hooks.json"), hooksDir);
  outputChannel.appendLine(`Cursor hooks installed (node, cross-platform): ${hooksDir}`);
  return true;
}

export async function installClaudeHooks(extensionUri: vscode.Uri): Promise<boolean> {
  const hooksDir = sharedHooksDir();
  if (!(await copyHookRunner(extensionUri, hooksDir))) return false;

  const projectSettings = projectClaudeSettingsPath();
  if (projectSettings) {
    await mergeClaudeSettingsAtPath(projectSettings, hooksDir);
    outputChannel.appendLine(`Claude project hooks: ${projectSettings}`);
  }

  await mergeClaudeSettingsAtPath(join(homedir(), ".claude", "settings.json"), hooksDir);
  outputChannel.appendLine(`Claude global hooks repaired`);
  return true;
}

export async function installHooksForEnvironment(extensionUri: vscode.Uri): Promise<{
  cursor: boolean;
  claude: boolean;
}> {
  if (isCursorApp()) {
    return { cursor: await installCursorHooks(extensionUri), claude: false };
  }
  return { cursor: false, claude: await installClaudeHooks(extensionUri) };
}

/** Idempotent setup — safe to run on every activation and workspace change. */
export async function ensureHooks(extensionUri: vscode.Uri): Promise<HookInstallStatus> {
  try {
    if (isCursorApp()) {
      await installCursorHooks(extensionUri);
    } else {
      await installClaudeHooks(extensionUri);
    }
  } catch (err) {
    outputChannel.appendLine(`Hook setup error: ${String(err)}`);
  }
  return getHookInstallStatus();
}

export function registerWorkspaceHookRefresh(
  context: vscode.ExtensionContext,
  onRefresh: () => void
): void {
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void ensureHooks(context.extensionUri).then(() => onRefresh());
    })
  );
}
