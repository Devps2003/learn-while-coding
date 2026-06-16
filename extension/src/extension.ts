import * as vscode from "vscode";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { LearnPanelProvider, outputChannel } from "./panel/LearnPanelProvider.js";
import { SESSIONS_DIR, TipWatcher, readAllLatestTips, type TipTurn } from "./watcher/TipWatcher.js";

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

async function loadConfigFile(): Promise<LearnWhileConfig | null> {
  if (!existsSync(CONFIG_PATH)) {
    return null;
  }
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as LearnWhileConfig;
  } catch {
    return null;
  }
}

async function saveConfigFile(config: LearnWhileConfig): Promise<void> {
  const dir = join(homedir(), ".learnwhile");
  await mkdir(dir, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

async function syncConfigFromSettings(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("learnwhile");
  const existing = (await loadConfigFile()) ?? { ...DEFAULT_HOSTED_CONFIG };

  const updated: LearnWhileConfig = {
    ...existing,
    provider: cfg.get<string>("provider") ?? existing.provider,
    model: cfg.get<string>("model") ?? existing.model,
    hostedApiUrl: cfg.get<string>("hostedApiUrl") ?? existing.hostedApiUrl,
    maxTipsPerTurn: cfg.get<number>("maxTipsPerTurn") ?? existing.maxTipsPerTurn,
    enabled: cfg.get<boolean>("enabled") ?? existing.enabled,
    showNotifications: cfg.get<boolean>("showNotifications") ?? existing.showNotifications,
  };

  await saveConfigFile(updated);
}

async function ensureDefaultConfig(): Promise<void> {
  if (!existsSync(CONFIG_PATH)) {
    await saveConfigFile({ ...DEFAULT_HOSTED_CONFIG });
  }
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

  if (!provider) {
    return;
  }

  if (provider.value === "hosted") {
    const config: LearnWhileConfig = { ...DEFAULT_HOSTED_CONFIG };
    await saveConfigFile(config);
    const vsConfig = vscode.workspace.getConfiguration("learnwhile");
    await vsConfig.update("provider", "hosted", vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(
      "Learn While Coding ready — using shared hosted API. No API key needed!"
    );
    return;
  }

  const apiKey = await vscode.window.showInputBox({
    prompt: "Enter your API key",
    password: true,
    ignoreFocusOut: true,
  });

  if (!apiKey) {
    return;
  }

  const defaultModels: Record<string, string> = {
    groq: "llama-3.3-70b-versatile",
    anthropic: "claude-haiku-4-5",
    openai: "gpt-4o-mini",
    openrouter: "anthropic/claude-haiku-4.5",
  };

  const model = await vscode.window.showInputBox({
    prompt: "Model name",
    value: defaultModels[provider.value],
    ignoreFocusOut: true,
  });

  const config: LearnWhileConfig = {
    provider: provider.value,
    apiKey,
    model: model ?? defaultModels[provider.value],
    maxTipsPerTurn: 3,
    enabled: true,
    showNotifications: true,
  };

  await saveConfigFile(config);

  const vsConfig = vscode.workspace.getConfiguration("learnwhile");
  await vsConfig.update("provider", config.provider, vscode.ConfigurationTarget.Global);
  await vsConfig.update("model", config.model, vscode.ConfigurationTarget.Global);

  vscode.window.showInformationMessage(
    "Learn While Coding configured! Install Cursor/Claude hooks to start receiving tips."
  );
}

export function activate(context: vscode.ExtensionContext): void {
  outputChannel.appendLine("Extension activated (v0.3.3)");
  outputChannel.appendLine(`Sessions dir: ${SESSIONS_DIR}`);

  const panelProvider = new LearnPanelProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      LearnPanelProvider.viewType,
      panelProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  let lastNotifiedTurnId = "";

  const onNewTips = async (turn: TipTurn): Promise<void> => {
    await panelProvider.refresh();

    const showNotifications = vscode.workspace
      .getConfiguration("learnwhile")
      .get<boolean>("showNotifications", true);

    if (showNotifications && turn.turnId !== lastNotifiedTurnId) {
      lastNotifiedTurnId = turn.turnId;
      const count = turn.tips.length;
      const action = await vscode.window.showInformationMessage(
        `${count} new concept${count === 1 ? "" : "s"} to learn`,
        "View Tips"
      );
      if (action === "View Tips") {
        await vscode.commands.executeCommand("learnwhile.tipsPanel.focus");
      }
    }
  };

  const watcher = new TipWatcher((turn) => {
    void onNewTips(turn);
  });

  void watcher.start().then(() => panelProvider.refresh());
  context.subscriptions.push({ dispose: () => watcher.dispose() });

  context.subscriptions.push(
    vscode.commands.registerCommand("learnwhile.openPanel", async () => {
      await vscode.commands.executeCommand("learnwhile.tipsPanel.focus");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("learnwhile.setup", () => runSetup())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("learnwhile.refresh", () => panelProvider.refresh())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("learnwhile.resetLearned", async () => {
      panelProvider.clearLearned();
      await panelProvider.refresh();
      vscode.window.showInformationMessage("Learn While Coding: restored all hidden tips");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("learnwhile.debug", async () => {
      try {
        const turns = await readAllLatestTips();
        const cards = turns.reduce((n, t) => n + t.tips.length, 0);
        const msg = `Sessions dir: ${SESSIONS_DIR}\nTurns: ${turns.length}\nTip cards: ${cards}`;
        outputChannel.appendLine(msg);
        outputChannel.show();
        await vscode.window.showInformationMessage(
          `Learn While Coding: ${cards} tips in ${turns.length} sessions`,
          "Open Output"
        ).then((action) => {
          if (action === "Open Output") {
            outputChannel.show();
          }
        });
        await panelProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`Learn While Coding debug failed: ${err}`);
      }
    })
  );

  context.subscriptions.push(outputChannel);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("learnwhile")) {
        void syncConfigFromSettings();
      }
    })
  );

  void ensureDefaultConfig().then(() => syncConfigFromSettings());
}

export function deactivate(): void {}
