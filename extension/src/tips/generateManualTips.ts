import * as vscode from "vscode";
import { apiTipsToTurn, callHostedApi, loadTipConfig, writeTipTurn } from "./tipApi.js";
import { outputChannel } from "../panel/LearnPanelProvider.js";
import type { TipTurn } from "../watcher/TipWatcher.js";

function workspaceSessionId(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]?.name ?? "workspace";
  return `vscode-manual-${folder.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 48)}`;
}

async function gatherEditorContext(): Promise<string> {
  const parts: string[] = [];
  const editor = vscode.window.activeTextEditor;

  if (editor) {
    const doc = editor.document;
    const selection = editor.selection;
    const relativePath = vscode.workspace.asRelativePath(doc.uri, false);

    if (!selection.isEmpty) {
      parts.push(`Selected code in ${relativePath}:\n${doc.getText(selection)}`);
    } else {
      const text = doc.getText();
      const truncated = text.length > 6000 ? text.slice(0, 6000) + "\n...[truncated]" : text;
      parts.push(`Active file: ${relativePath}\n\`\`\`${doc.languageId}\n${truncated}\n\`\`\``);
    }
  }

  const openFiles = vscode.workspace.textDocuments
    .filter((d) => !d.isUntitled && d.uri.scheme === "file")
    .map((d) => vscode.workspace.asRelativePath(d.uri, false))
    .slice(0, 12);

  if (openFiles.length > 0) {
    parts.push(`Open files: ${openFiles.join(", ")}`);
  }

  parts.push(
    "The developer uses GitHub Copilot or VS Code AI. Infer 1-2 engineering concepts worth learning from this code context."
  );

  return parts.join("\n\n");
}

export async function generateTipsFromEditor(): Promise<TipTurn | null> {
  const config = await loadTipConfig();
  if (!config.enabled) {
    vscode.window.showWarningMessage("Learn While Coding is disabled in settings.");
    return null;
  }

  const prompt = await gatherEditorContext();
  if (!prompt.trim()) {
    vscode.window.showWarningMessage("Open a file first, then generate learning tips.");
    return null;
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Generating learning tips…",
      cancellable: false,
    },
    async () => {
      outputChannel.appendLine("Generating tips from editor context…");
      const tips = await callHostedApi(config, prompt);

      if (tips.length === 0) {
        vscode.window.showInformationMessage("No learning concepts found for this context.");
        return null;
      }

      const turn = apiTipsToTurn(tips, workspaceSessionId(), "vscode");
      await writeTipTurn(turn);
      outputChannel.appendLine(`Wrote ${turn.tips.length} tips → ${turn.sessionId}`);
      return turn;
    }
  );
}
