import * as vscode from "vscode";
import type { TipTurn } from "../watcher/TipWatcher.js";
import { SESSIONS_DIR, readAllLatestTips } from "../watcher/TipWatcher.js";
import {
  escHtml,
  renderPanelScript,
  renderPanelStyles,
  renderTipsContent,
} from "./cardUi.js";

export const outputChannel = vscode.window.createOutputChannel("Learn While Coding");

export class LearnPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "learnwhile.tipsPanel";

  private view?: vscode.WebviewView;
  private learnedConcepts = new Set<string>();

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    outputChannel.appendLine("Panel opened");

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.buildHtml([], "Loading tips...");

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "ready") {
        void this.pushTipsToWebview();
        return;
      }
      if (msg.type === "markLearned" && typeof msg.concept === "string") {
        this.learnedConcepts.add(msg.concept.toLowerCase());
        void this.refresh();
      }
      if (msg.type === "openLink" && typeof msg.url === "string") {
        void vscode.env.openExternal(vscode.Uri.parse(msg.url));
      }
    });

    void this.loadTips(webviewView);

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void this.loadTips(webviewView);
      }
    });
  }

  private filterTurns(turns: TipTurn[]): TipTurn[] {
    return turns
      .map((turn) => ({
        ...turn,
        tips: (turn.tips ?? []).filter(
          (t) =>
            typeof t.concept === "string" &&
            !this.learnedConcepts.has(t.concept.toLowerCase())
        ),
      }))
      .filter((turn) => turn.tips.length > 0);
  }

  private async loadTips(webviewView?: vscode.WebviewView): Promise<void> {
    const view = webviewView ?? this.view;
    if (!view) {
      return;
    }

    try {
      const raw = await readAllLatestTips();
      const turns = this.filterTurns(raw);
      const totalCards = turns.reduce((n, t) => n + t.tips.length, 0);

      outputChannel.appendLine(
        `Loaded ${totalCards} tips from ${raw.length} sessions (${SESSIONS_DIR})`
      );

      view.webview.html = this.buildHtml(turns);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outputChannel.appendLine(`ERROR loading tips: ${message}`);
      view.webview.html = this.buildHtml([], `Error: ${message}`);
    }
  }

  private async pushTipsToWebview(): Promise<void> {
    if (!this.view) {
      return;
    }
    try {
      const turns = this.filterTurns(await readAllLatestTips());
      this.view.webview.html = this.buildHtml(turns);
    } catch (err) {
      outputChannel.appendLine(`ERROR pushTips: ${err}`);
    }
  }

  async refresh(): Promise<void> {
    await this.loadTips();
  }

  private buildHtml(turns: TipTurn[], statusMessage?: string): string {
    const contentHtml = renderTipsContent(turns);
    const statusHtml = statusMessage
      ? `<div class="status">${escHtml(statusMessage)}</div>`
      : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>${renderPanelStyles()}</style>
</head>
<body>
  <header class="panel-header">
    <h1 class="panel-title">
      <span class="panel-title-icon">◎</span>
      Learn While Coding
    </h1>
    <p class="panel-subtitle">Concepts from your AI sessions</p>
    ${statusHtml}
  </header>
  <div id="content">${contentHtml}</div>
  <script>${renderPanelScript()}</script>
</body>
</html>`;
  }
}
