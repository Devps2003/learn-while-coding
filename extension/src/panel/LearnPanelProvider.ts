import * as vscode from "vscode";
import type { TipTurn } from "../watcher/TipWatcher.js";

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

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "markLearned" && typeof msg.concept === "string") {
        this.learnedConcepts.add(msg.concept.toLowerCase());
        void this.refresh();
      }
      if (msg.type === "openLink" && typeof msg.url === "string") {
        void vscode.env.openExternal(vscode.Uri.parse(msg.url));
      }
    });
  }

  async updateTips(turns: TipTurn[]): Promise<void> {
    if (!this.view) {
      return;
    }

    const filtered = turns.map((turn) => ({
      ...turn,
      tips: turn.tips.filter(
        (t) => !this.learnedConcepts.has(t.concept.toLowerCase())
      ),
    }));

    await this.view.webview.postMessage({
      type: "updateTips",
      turns: filtered,
    });
  }

  async refresh(): Promise<void> {
    const { readAllLatestTips } = await import("../watcher/TipWatcher.js");
    const turns = await readAllLatestTips();
    await this.updateTips(turns);
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <title>Learning Tips</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      padding: 12px;
      line-height: 1.5;
    }
    h1 { font-size: 1.1em; margin-bottom: 12px; color: var(--vscode-foreground); }
    .empty {
      color: var(--vscode-descriptionForeground);
      padding: 24px 8px;
      text-align: center;
    }
    .turn-meta {
      font-size: 0.75em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
    }
    .card h2 { font-size: 0.95em; margin-bottom: 6px; }
    .badge {
      display: inline-block;
      font-size: 0.7em;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      margin-right: 4px;
      margin-bottom: 6px;
    }
    .summary { margin: 8px 0; font-size: 0.9em; }
    .why { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin: 6px 0; }
    .links { margin-top: 8px; }
    .links a {
      color: var(--vscode-textLink-foreground);
      font-size: 0.8em;
      display: block;
      margin: 4px 0;
      cursor: pointer;
      text-decoration: none;
    }
    .links a:hover { text-decoration: underline; }
    .actions { margin-top: 10px; }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 0.8em;
      cursor: pointer;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <h1>Learn While Coding</h1>
  <div id="content">
    <div class="empty">
      <p>Start an AI coding session with Cursor or Claude Code hooks enabled.</p>
      <p style="margin-top:8px">Tips will appear here after each agent turn.</p>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const content = document.getElementById('content');

    function escapeHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function renderTips(turns) {
      if (!turns || turns.length === 0) {
        content.innerHTML = '<div class="empty"><p>No new tips yet. Keep coding with AI!</p></div>';
        return;
      }

      let html = '';
      for (const turn of turns) {
        if (turn.tips.length === 0) continue;
        html += '<div class="turn-meta">' + escapeHtml(new Date(turn.timestamp).toLocaleString()) +
          ' · ' + escapeHtml(turn.platform) + '</div>';
        for (const tip of turn.tips) {
          html += '<div class="card">';
          html += '<span class="badge">' + escapeHtml(tip.category) + '</span>';
          html += '<span class="badge">' + escapeHtml(tip.depth) + '</span>';
          html += '<h2>' + escapeHtml(tip.concept) + '</h2>';
          html += '<p class="summary">' + escapeHtml(tip.summary) + '</p>';
          html += '<p class="why"><strong>Why now:</strong> ' + escapeHtml(tip.whyNow) + '</p>';
          if (tip.learnMore && tip.learnMore.length) {
            html += '<div class="links">';
            for (const url of tip.learnMore) {
              html += '<a href="#" data-url="' + escapeHtml(url) + '">' + escapeHtml(url) + '</a>';
            }
            html += '</div>';
          }
          html += '<div class="actions"><button data-concept="' + escapeHtml(tip.concept) + '">Mark learned</button></div>';
          html += '</div>';
        }
      }
      content.innerHTML = html || '<div class="empty"><p>All tips marked as learned!</p></div>';

      content.querySelectorAll('a[data-url]').forEach(el => {
        el.addEventListener('click', e => {
          e.preventDefault();
          vscode.postMessage({ type: 'openLink', url: el.dataset.url });
        });
      });
      content.querySelectorAll('button[data-concept]').forEach(el => {
        el.addEventListener('click', () => {
          vscode.postMessage({ type: 'markLearned', concept: el.dataset.concept });
        });
      });
    }

    window.addEventListener('message', e => {
      if (e.data.type === 'updateTips') {
        renderTips(e.data.turns);
      }
    });
  </script>
</body>
</html>`;
  }
}
