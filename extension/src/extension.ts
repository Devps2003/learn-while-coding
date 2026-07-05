import * as vscode from "vscode";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { LearnPanelProvider, outputChannel } from "./panel/LearnPanelProvider.js";
import { SESSIONS_DIR, TipWatcher, type TipTurn } from "./watcher/TipWatcher.js";
import { TranscriptWatcher } from "./watcher/TranscriptWatcher.js";
import {
  ensureHooks,
  getHookInstallStatus,
  installHooksForEnvironment,
  registerWorkspaceHookRefresh,
  type HookInstallStatus,
} from "./install/HookInstaller.js";
import { generateTipsFromEditor } from "./tips/generateManualTips.js";
import { registerAutoCopilotTips } from "./tips/autoCopilot.js";
import { createStatusBar } from "./status/StatusBar.js";
import { runHealthCheck } from "./setup/healthCheck.js";

const CONFIG_PATH = join(homedir(), ".learnwhile", "config.json");

interface LearnWhileConfig {
  provider: string;
  apiKey: string;
  model: string;
  maxTipsPerTurn: number;
  enabled: boolean;
  showNotifications: boolean;
  hostedApiUrl?: string;
  clientKey?: string;
}

const DEFAULT_HOSTED_CONFIG: LearnWhileConfig = {
  provider: "hosted",
  apiKey: "",
  model: "llama-3.3-70b-versatile",
  maxTipsPerTurn: 3,
  enabled: true,
  showNotifications: true,
  hostedApiUrl: "https://ai-learning-ten-rose.vercel.app/api/tips",
  clientKey: "learnwhile-v1",
};

let hookStatus: HookInstallStatus = {
  appName: "Unknown",
  isCursor: false,
  isVsCode: true,
  cursorHooksInstalled: false,
  claudeHooksInstalled: false,
  claudeProjectSettingsPath: null,
  hooksInstalled: false,
  autoTipsMode: "manual",
  hooksDir: "",
  configExists: false,
  sessionsDir: SESSIONS_DIR,
  sessionCount: 0,
};

async function loadConfigFile(): Promise<LearnWhileConfig | null> {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(await readFile(CONFIG_PATH, "utf-8")) as LearnWhileConfig;
  } catch {
    return null;
  }
}

async function saveConfigFile(config: LearnWhileConfig): Promise<void> {
  await mkdir(join(homedir(), ".learnwhile"), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

async function syncConfigFromSettings(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("learnwhile");
  const existing = (await loadConfigFile()) ?? { ...DEFAULT_HOSTED_CONFIG };
  await saveConfigFile({
    ...existing,
    provider: cfg.get<string>("provider") ?? existing.provider,
    model: cfg.get<string>("model") ?? existing.model,
    hostedApiUrl: cfg.get<string>("hostedApiUrl") ?? existing.hostedApiUrl,
    maxTipsPerTurn: cfg.get<number>("maxTipsPerTurn") ?? existing.maxTipsPerTurn,
    enabled: cfg.get<boolean>("enabled") ?? existing.enabled,
    showNotifications: cfg.get<boolean>("showNotifications") ?? existing.showNotifications,
  });
}

async function ensureDefaultConfig(): Promise<void> {
  if (!existsSync(CONFIG_PATH)) {
    await saveConfigFile({ ...DEFAULT_HOSTED_CONFIG });
  }
}

async function refreshStatus(
  extensionUri: vscode.Uri,
  panelProvider: LearnPanelProvider,
  statusBarRefresh: () => void
): Promise<void> {
  hookStatus = await getHookInstallStatus();
  statusBarRefresh();
  await panelProvider.refresh();
  outputChannel.appendLine(
    `Ready: ${hookStatus.appName} | mode=${hookStatus.autoTipsMode} | hooks=${hookStatus.hooksInstalled}`
  );
}

async function runSetup(): Promise<void> {
  const provider = await vscode.window.showQuickPick(
    [
      { label: "Hosted (shared API — no key needed)", value: "hosted" },
      { label: "Groq (your own key)", value: "groq" },
      { label: "Anthropic", value: "anthropic" },
      { label: "OpenAI", value: "openai" },
      { label: "OpenRouter", value: "openrouter" },
    ],
    { placeHolder: "Select LLM provider" }
  );
  if (!provider) return;

  if (provider.value === "hosted") {
    await saveConfigFile({ ...DEFAULT_HOSTED_CONFIG });
    await vscode.workspace.getConfiguration("learnwhile").update("provider", "hosted", vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage("Learn While Coding ready — hosted API, no key needed.");
    return;
  }

  const apiKey = await vscode.window.showInputBox({ prompt: "API key", password: true, ignoreFocusOut: true });
  if (!apiKey) return;

  const models: Record<string, string> = {
    groq: "llama-3.3-70b-versatile",
    anthropic: "claude-haiku-4-5",
    openai: "gpt-4o-mini",
    openrouter: "anthropic/claude-haiku-4.5",
  };

  const model = await vscode.window.showInputBox({
    prompt: "Model",
    value: models[provider.value],
    ignoreFocusOut: true,
  });

  await saveConfigFile({
    provider: provider.value,
    apiKey,
    model: model ?? models[provider.value],
    maxTipsPerTurn: 3,
    enabled: true,
    showNotifications: true,
  });

  vscode.window.showInformationMessage("Learn While Coding configured.");
}

export function activate(context: vscode.ExtensionContext): void {
  outputChannel.appendLine("Learn While Coding v0.4.1 activated");

  const panelProvider = new LearnPanelProvider(context.extensionUri, () => hookStatus);
  const { item: statusBar, refresh: statusBarRefresh } = createStatusBar(() => hookStatus);
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(LearnPanelProvider.viewType, panelProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  let lastNotifiedTurnId = "";

  const watcher = new TipWatcher((turn) => {
    void panelProvider.refresh();
    const show = vscode.workspace.getConfiguration("learnwhile").get<boolean>("showNotifications", true);
    if (show && turn.turnId !== lastNotifiedTurnId) {
      lastNotifiedTurnId = turn.turnId;
      void vscode.window
        .showInformationMessage(
          `${turn.tips.length} new concept${turn.tips.length === 1 ? "" : "s"} to learn`,
          "View Tips"
        )
        .then((a) => {
          if (a === "View Tips") void vscode.commands.executeCommand("learnwhile.tipsPanel.focus");
        });
    }
  });

  void watcher.start().then(() => panelProvider.refresh());
  context.subscriptions.push({ dispose: () => watcher.dispose() });

  // VS Code: Claude hooks often don't fire — watch transcript files directly
  const transcriptWatcher = new TranscriptWatcher((turn) => {
    void panelProvider.refresh();
    const show = vscode.workspace.getConfiguration("learnwhile").get<boolean>("showNotifications", true);
    if (show && turn.turnId !== lastNotifiedTurnId) {
      lastNotifiedTurnId = turn.turnId;
      void vscode.window
        .showInformationMessage(
          `${turn.tips.length} new concept${turn.tips.length === 1 ? "" : "s"} to learn`,
          "View Tips"
        )
        .then((a) => {
          if (a === "View Tips") void vscode.commands.executeCommand("learnwhile.tipsPanel.focus");
        });
    }
  });
  context.subscriptions.push({ dispose: () => transcriptWatcher.dispose() });

  registerAutoCopilotTips(context, () => hookStatus.autoTipsMode);

  registerWorkspaceHookRefresh(context, () => {
    void refreshStatus(context.extensionUri, panelProvider, statusBarRefresh);
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("learnwhile.openPanel", () =>
      vscode.commands.executeCommand("learnwhile.tipsPanel.focus")
    ),
    vscode.commands.registerCommand("learnwhile.setup", () => runSetup()),
    vscode.commands.registerCommand("learnwhile.refresh", () => panelProvider.refresh()),
    vscode.commands.registerCommand("learnwhile.resetLearned", async () => {
      panelProvider.clearLearned();
      await panelProvider.refresh();
    }),
    vscode.commands.registerCommand("learnwhile.installHooks", async () => {
      const result = await installHooksForEnvironment(context.extensionUri);
      await refreshStatus(context.extensionUri, panelProvider, statusBarRefresh);
      if (result.cursor || result.claude) {
        vscode.window.showInformationMessage(
          "Hooks installed. Reload the editor, then finish an AI chat turn.",
          "Reload"
        ).then((a) => {
          if (a === "Reload") void vscode.commands.executeCommand("workbench.action.reloadWindow");
        });
      } else {
        vscode.window.showWarningMessage("Hook install failed — see Output → Learn While Coding");
      }
    }),
    vscode.commands.registerCommand("learnwhile.generateFromEditor", async () => {
      try {
        const turn = await generateTipsFromEditor();
        if (turn) {
          await panelProvider.refresh();
          void vscode.commands.executeCommand("learnwhile.tipsPanel.focus");
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Learn While Coding: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
    vscode.commands.registerCommand("learnwhile.debug", async () => {
      const report = await runHealthCheck(hookStatus);
      const lines = [
        `Health: ${report.ok ? "OK" : "ISSUES"}`,
        `Node: ${report.nodeVersion || "missing"}`,
        `Mode: ${hookStatus.autoTipsMode}`,
        `Hooks: ${report.hooksOk}`,
        ...report.issues.map((i) => `! ${i}`),
        ...report.tips.map((t) => `→ ${t}`),
      ];
      outputChannel.appendLine(lines.join("\n"));
      outputChannel.show();
      vscode.window.showInformationMessage(report.ok ? "All checks passed" : `${report.issues.length} issue(s) — see Output`);
      await panelProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("learnwhile")) void syncConfigFromSettings();
    }),
    outputChannel
  );

  void (async () => {
    await mkdir(SESSIONS_DIR, { recursive: true });
    await ensureDefaultConfig();
    await syncConfigFromSettings();
    hookStatus = await ensureHooks(context.extensionUri);
    statusBarRefresh();
    await panelProvider.refresh();

    if (!hookStatus.isCursor) {
      await transcriptWatcher.start();
      outputChannel.appendLine("TranscriptWatcher active (VS Code Claude + Copilot fallback)");
    }

    const report = await runHealthCheck(hookStatus);
    if (!report.ok) {
      outputChannel.appendLine(`Setup issues: ${report.issues.join("; ")}`);
    }

    const show = vscode.workspace.getConfiguration("learnwhile").get<boolean>("showNotifications", true);
    if (!show || hookStatus.sessionCount > 0) return;

    const messages: Record<string, string> = {
      cursor: "Learn While Coding ready — finish a Cursor Agent turn for learning cards.",
      claude: "Learn While Coding ready — Claude chat is watched automatically. Finish a turn, wait ~5s, cards appear.",
      manual: "Learn While Coding ready — Copilot tips generate automatically when you save files.",
    };
    vscode.window.showInformationMessage(messages[hookStatus.autoTipsMode] ?? "Learn While Coding ready.", "Open Panel");
  })();
}

export function deactivate(): void {}
