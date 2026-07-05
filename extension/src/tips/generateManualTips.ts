import * as vscode from "vscode";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { TipTurn } from "../watcher/TipWatcher.js";
import { outputChannel } from "../panel/LearnPanelProvider.js";

const DEFAULT_HOSTED_API_URL = "https://ai-learning-ten-rose.vercel.app/api/tips";
const DEFAULT_CLIENT_KEY = "learnwhile-v1";

interface LearnWhileConfig {
  provider: string;
  apiKey: string;
  model: string;
  maxTipsPerTurn: number;
  enabled: boolean;
  hostedApiUrl?: string;
  clientKey?: string;
}

interface ApiTip {
  concept: string;
  summary: string;
  body?: string;
  detail?: string;
  category: string;
  whyNow: string;
  whatAiDid?: string;
  keyPoints?: string[];
  watchOut?: string;
  learnMore: string[];
  depth: string;
}

async function loadConfig(): Promise<LearnWhileConfig> {
  const configPath = join(homedir(), ".learnwhile", "config.json");
  const defaults: LearnWhileConfig = {
    provider: "hosted",
    apiKey: "",
    model: "llama-3.3-70b-versatile",
    maxTipsPerTurn: 3,
    enabled: true,
    hostedApiUrl: DEFAULT_HOSTED_API_URL,
    clientKey: DEFAULT_CLIENT_KEY,
  };

  try {
    const raw = await readFile(configPath, "utf-8");
    return { ...defaults, ...(JSON.parse(raw) as Partial<LearnWhileConfig>) };
  } catch {
    return defaults;
  }
}

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
    "The developer uses GitHub Copilot or VS Code AI (no chat hooks). Infer 1-2 engineering concepts worth learning from this code context."
  );

  return parts.join("\n\n");
}

async function callHostedApi(config: LearnWhileConfig, prompt: string): Promise<ApiTip[]> {
  const url = config.hostedApiUrl ?? DEFAULT_HOSTED_API_URL;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.clientKey) {
    headers["X-LearnWhile-Client"] = config.clientKey;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt,
      maxTips: config.maxTipsPerTurn,
      model: config.model,
    }),
  });

  if (!res.ok) {
    throw new Error(`Hosted API error ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as { tips?: ApiTip[] };
  return Array.isArray(data.tips) ? data.tips : [];
}

async function writeTipTurn(turn: TipTurn): Promise<void> {
  const sessionDir = join(homedir(), ".learnwhile", "sessions", turn.sessionId);
  await mkdir(sessionDir, { recursive: true });
  const latestPath = join(sessionDir, "latest.json");
  const tmpPath = `${latestPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(turn, null, 2), "utf-8");
  await rename(tmpPath, latestPath);
}

export async function generateTipsFromEditor(): Promise<TipTurn | null> {
  const config = await loadConfig();
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

      const turn: TipTurn = {
        sessionId: workspaceSessionId(),
        turnId: `manual-${Date.now()}`,
        timestamp: new Date().toISOString(),
        platform: "vscode",
        tips: tips.map((t) => ({
          concept: t.concept,
          summary: t.summary,
          body: t.body,
          detail: t.detail,
          category: t.category,
          whyNow: t.whyNow,
          whatAiDid: t.whatAiDid,
          keyPoints: t.keyPoints,
          watchOut: t.watchOut,
          learnMore: t.learnMore ?? [],
          depth: t.depth,
        })),
      };

      await writeTipTurn(turn);
      outputChannel.appendLine(`Wrote ${turn.tips.length} tips → ${turn.sessionId}`);
      return turn;
    }
  );
}
