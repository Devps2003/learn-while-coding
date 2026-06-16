import type { Tip, TipTurn } from "../watcher/TipWatcher.js";

export function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CATEGORY_META: Record<string, { label: string; icon: string }> = {
  pattern: { label: "Pattern", icon: "◈" },
  api: { label: "API", icon: "⬡" },
  tooling: { label: "Tooling", icon: "⚙" },
  architecture: { label: "Architecture", icon: "▣" },
  security: { label: "Security", icon: "⛨" },
  other: { label: "Concept", icon: "◇" },
};

const DEPTH_META: Record<string, { label: string; bars: number }> = {
  beginner: { label: "Beginner", bars: 1 },
  intermediate: { label: "Intermediate", bars: 2 },
  advanced: { label: "Advanced", bars: 3 },
};

function categoryMeta(category: string) {
  return CATEGORY_META[category.toLowerCase()] ?? CATEGORY_META.other;
}

function depthMeta(depth: string) {
  return DEPTH_META[depth.toLowerCase()] ?? DEPTH_META.intermediate;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function formatLinkLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host || url;
  } catch {
    return url.length > 42 ? url.slice(0, 39) + "…" : url;
  }
}

function renderDepthBars(bars: number): string {
  return [1, 2, 3]
    .map((i) => `<span class="depth-bar${i <= bars ? " filled" : ""}"></span>`)
    .join("");
}

function renderCard(tip: Tip, index: number): string {
  const cat = categoryMeta(tip.category);
  const depth = depthMeta(tip.depth);
  const category = escHtml(tip.category.toLowerCase());

  let linksHtml = "";
  if (tip.learnMore?.length) {
    linksHtml = `<div class="card-section">
      <div class="section-label">Resources</div>
      <div class="link-list">`;
    for (const url of tip.learnMore) {
      linksHtml += `<a class="link-chip" href="#" data-url="${escHtml(url)}" title="${escHtml(url)}">
        <span class="link-icon">↗</span>
        <span class="link-text">${escHtml(formatLinkLabel(url))}</span>
      </a>`;
    }
    linksHtml += `</div></div>`;
  }

  return `<article class="card" data-category="${category}" style="animation-delay: ${index * 40}ms">
    <div class="card-accent"></div>
    <header class="card-header">
      <div class="card-meta">
        <span class="pill pill-category">
          <span class="pill-icon">${cat.icon}</span>
          ${escHtml(cat.label)}
        </span>
        <span class="pill pill-depth" data-depth="${escHtml(tip.depth.toLowerCase())}">
          <span class="depth-bars">${renderDepthBars(depth.bars)}</span>
          ${escHtml(depth.label)}
        </span>
      </div>
      <h2 class="card-title">${escHtml(tip.concept)}</h2>
    </header>
    <div class="card-body">
      <div class="card-section">
        <div class="section-label">Summary</div>
        <p class="card-summary">${escHtml(tip.summary)}</p>
      </div>
      <div class="card-section callout">
        <div class="section-label">Why this turn</div>
        <p class="card-why">${escHtml(tip.whyNow)}</p>
      </div>
      ${linksHtml}
    </div>
    <footer class="card-footer">
      <button class="btn-learned" data-concept="${escHtml(tip.concept)}" type="button">
        <span class="btn-icon">✓</span>
        Mark as learned
      </button>
    </footer>
  </article>`;
}

function renderTurnGroup(turn: TipTurn): string {
  if (!turn.tips?.length) {
    return "";
  }

  const platform = escHtml(turn.platform || "cursor");
  const cards = turn.tips.map((tip, i) => renderCard(tip, i)).join("");

  return `<section class="turn-group">
    <div class="turn-header">
      <div class="turn-time">
        <span class="turn-clock">◷</span>
        ${escHtml(formatTime(turn.timestamp))}
      </div>
      <span class="turn-platform">${platform}</span>
    </div>
    <div class="turn-cards">${cards}</div>
  </section>`;
}

export function renderTipsContent(turns: TipTurn[]): string {
  if (!turns.length) {
    return `<div class="empty-state">
      <div class="empty-icon">◎</div>
      <h2 class="empty-title">No tips yet</h2>
      <p class="empty-desc">Finish an Agent turn in Cursor, then tips will appear here automatically.</p>
      <p class="empty-hint">Or run <strong>Learn While Coding: Refresh Tips</strong></p>
    </div>`;
  }

  const totalCards = turns.reduce((n, t) => n + (t.tips?.length ?? 0), 0);
  const groups = turns.map(renderTurnGroup).join("");

  return `<div class="stats-bar">
      <span class="stat"><strong>${totalCards}</strong> concept${totalCards === 1 ? "" : "s"}</span>
      <span class="stat-dot">·</span>
      <span class="stat">${turns.length} session${turns.length === 1 ? "" : "s"}</span>
    </div>
    ${groups}`;
}

export function renderPanelStyles(): string {
  return `
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      margin: 0;
      padding: 0;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    .panel-header {
      position: sticky;
      top: 0;
      z-index: 10;
      padding: 14px 14px 10px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
      backdrop-filter: blur(8px);
    }
    .panel-title {
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.02em;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .panel-title-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 6px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      font-size: 11px;
    }
    .panel-subtitle {
      margin: 4px 0 0;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .status {
      margin-top: 8px;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
    }
    #content { padding: 12px 12px 20px; }
    .stats-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 14px;
      padding: 8px 10px;
      border-radius: 8px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .stats-bar strong { color: var(--vscode-foreground); font-weight: 600; }
    .stat-dot { opacity: 0.4; }
    .turn-group { margin-bottom: 20px; }
    .turn-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
      padding: 0 2px;
    }
    .turn-time {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      font-weight: 500;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .turn-clock { opacity: 0.7; font-size: 12px; }
    .turn-platform {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .turn-cards { display: flex; flex-direction: column; gap: 10px; }
    .card {
      position: relative;
      border-radius: 10px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.25));
      overflow: hidden;
      animation: cardIn 0.35s ease both;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .card:hover {
      border-color: var(--vscode-focusBorder, rgba(128,128,128,0.45));
      box-shadow: 0 2px 12px rgba(0,0,0,0.12);
    }
    @keyframes cardIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .card-accent {
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 3px;
      background: var(--vscode-textLink-foreground);
    }
    .card[data-category="pattern"] .card-accent { background: #7c6fe0; }
    .card[data-category="api"] .card-accent { background: #3ecf8e; }
    .card[data-category="tooling"] .card-accent { background: #e8a23b; }
    .card[data-category="architecture"] .card-accent { background: #5b9fd4; }
    .card[data-category="security"] .card-accent { background: #e06c75; }
    .card[data-category="other"] .card-accent { background: var(--vscode-descriptionForeground); }
    .card-header { padding: 12px 14px 0 16px; }
    .card-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 8px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      padding: 3px 8px;
      border-radius: 999px;
      border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.25));
      background: var(--vscode-sideBar-background);
      color: var(--vscode-descriptionForeground);
    }
    .pill-icon { font-size: 11px; line-height: 1; }
    .pill-depth { gap: 6px; }
    .depth-bars { display: inline-flex; gap: 2px; align-items: flex-end; height: 10px; }
    .depth-bar {
      display: block;
      width: 3px;
      border-radius: 1px;
      background: var(--vscode-widget-border, rgba(128,128,128,0.3));
    }
    .depth-bar:nth-child(1) { height: 4px; }
    .depth-bar:nth-child(2) { height: 7px; }
    .depth-bar:nth-child(3) { height: 10px; }
    .depth-bar.filled { background: var(--vscode-textLink-foreground); }
    .card-title {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      line-height: 1.35;
      color: var(--vscode-foreground);
      letter-spacing: -0.01em;
    }
    .card-body { padding: 10px 14px 0 16px; }
    .card-section { margin-bottom: 10px; }
    .section-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
      opacity: 0.85;
    }
    .card-summary {
      margin: 0;
      font-size: 12.5px;
      line-height: 1.55;
      color: var(--vscode-foreground);
    }
    .callout {
      padding: 8px 10px;
      border-radius: 6px;
      background: var(--vscode-sideBar-background);
      border-left: 2px solid var(--vscode-textLink-foreground);
    }
    .card-why {
      margin: 0;
      font-size: 12px;
      line-height: 1.5;
      color: var(--vscode-descriptionForeground);
    }
    .link-list { display: flex; flex-direction: column; gap: 5px; }
    .link-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 6px;
      text-decoration: none;
      font-size: 11.5px;
      color: var(--vscode-textLink-foreground);
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
      transition: background 0.12s ease, border-color 0.12s ease;
      cursor: pointer;
    }
    .link-chip:hover {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-focusBorder, rgba(128,128,128,0.4));
    }
    .link-icon { font-size: 10px; opacity: 0.8; }
    .link-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .card-footer {
      padding: 8px 14px 12px 16px;
      display: flex;
      justify-content: flex-end;
    }
    .btn-learned {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
      background: transparent;
      color: var(--vscode-descriptionForeground);
      transition: all 0.12s ease;
    }
    .btn-learned:hover {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
    }
    .btn-icon { font-size: 10px; }
    .empty-state {
      text-align: center;
      padding: 32px 16px;
      color: var(--vscode-descriptionForeground);
    }
    .empty-icon {
      font-size: 28px;
      opacity: 0.35;
      margin-bottom: 12px;
    }
    .empty-title {
      margin: 0 0 8px;
      font-size: 14px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }
    .empty-desc { margin: 0 0 8px; font-size: 12px; line-height: 1.5; }
    .empty-hint { margin: 0; font-size: 11px; opacity: 0.8; }
  `;
}

export function renderPanelScript(): string {
  return `
    (function() {
      var vscode = acquireVsCodeApi();
      var content = document.getElementById('content');

      function bindEvents() {
        var links = content.querySelectorAll('a[data-url]');
        for (var i = 0; i < links.length; i++) {
          links[i].addEventListener('click', function(e) {
            e.preventDefault();
            vscode.postMessage({ type: 'openLink', url: this.getAttribute('data-url') });
          });
        }
        var buttons = content.querySelectorAll('button[data-concept]');
        for (var j = 0; j < buttons.length; j++) {
          buttons[j].addEventListener('click', function() {
            var btn = this;
            btn.disabled = true;
            btn.innerHTML = '<span class="btn-icon">✓</span> Learned';
            btn.style.opacity = '0.6';
            vscode.postMessage({ type: 'markLearned', concept: btn.getAttribute('data-concept') });
          });
        }
      }

      bindEvents();
      vscode.postMessage({ type: 'ready' });
    })();
  `;
}
