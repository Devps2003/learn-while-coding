import * as vscode from "vscode";
import type { HookInstallStatus } from "../install/HookInstaller.js";

export function createStatusBar(getStatus: () => HookInstallStatus): {
  item: vscode.StatusBarItem;
  refresh: () => void;
} {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = "learnwhile.openPanel";

  const refresh = (): void => {
    const s = getStatus();
    const labels: Record<string, string> = {
      cursor: "$(sparkle) Learn",
      claude: "$(book) Learn",
      manual: "$(lightbulb) Learn",
    };
    item.text = labels[s.autoTipsMode] ?? "$(circle-outline) Learn";
    item.tooltip =
      s.autoTipsMode === "cursor"
        ? "Learn While Coding — Cursor Agent tips (automatic)"
        : s.autoTipsMode === "claude"
          ? "Learn While Coding — Claude Code tips (automatic)"
          : "Learn While Coding — Copilot tips (automatic on file save)";
    item.show();
  };

  refresh();
  return { item, refresh };
}
