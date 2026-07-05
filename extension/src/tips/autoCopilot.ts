import * as vscode from "vscode";
import { generateTipsFromEditor } from "./generateManualTips.js";
import { outputChannel } from "../panel/LearnPanelProvider.js";
import type { AutoTipsMode } from "../install/HookInstaller.js";

const DEBOUNCE_MS = 45_000;
const lastRunByFile = new Map<string, number>();
let running = false;

export function registerAutoCopilotTips(
  context: vscode.ExtensionContext,
  getMode: () => AutoTipsMode
): void {
  const disposable = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.uri.scheme !== "file") {
      return;
    }

    const enabled = vscode.workspace
      .getConfiguration("learnwhile")
      .get<boolean>("autoGenerateOnSave", true);

    if (!enabled || getMode() !== "manual") {
      return;
    }

    const filePath = doc.uri.fsPath;
    const now = Date.now();
    const last = lastRunByFile.get(filePath) ?? 0;
    if (now - last < DEBOUNCE_MS || running) {
      return;
    }

    lastRunByFile.set(filePath, now);
    running = true;

    void generateTipsFromEditor()
      .then((turn) => {
        if (turn) {
          outputChannel.appendLine(
            `Auto-generated ${turn.tips.length} tips after save: ${filePath}`
          );
          void vscode.commands.executeCommand("learnwhile.refresh");
        }
      })
      .catch((err) => {
        outputChannel.appendLine(`Auto Copilot tips failed: ${String(err)}`);
      })
      .finally(() => {
        running = false;
      });
  });

  context.subscriptions.push(disposable);
}
