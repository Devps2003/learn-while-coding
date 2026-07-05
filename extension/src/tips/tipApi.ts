import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { TipTurn } from "../watcher/TipWatcher.js";

const DEFAULT_HOSTED_API_URL = "https://ai-learning-ten-rose.vercel.app/api/tips";
const DEFAULT_CLIENT_KEY = "learnwhile-v1";

export interface LearnWhileConfig {
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

export async function loadTipConfig(): Promise<LearnWhileConfig> {
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

export async function callHostedApi(config: LearnWhileConfig, prompt: string): Promise<ApiTip[]> {
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

export async function writeTipTurn(turn: TipTurn): Promise<void> {
  const sessionDir = join(homedir(), ".learnwhile", "sessions", turn.sessionId);
  await mkdir(sessionDir, { recursive: true });
  const latestPath = join(sessionDir, "latest.json");
  const tmpPath = `${latestPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(turn, null, 2), "utf-8");
  await rename(tmpPath, latestPath);
}

export function apiTipsToTurn(
  tips: ApiTip[],
  sessionId: string,
  platform: string,
  turnId?: string
): TipTurn {
  return {
    sessionId,
    turnId: turnId ?? `turn-${Date.now()}`,
    timestamp: new Date().toISOString(),
    platform,
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
}
