import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { TipTurn } from "../watcher/TipWatcher.js";
import { healthUrl, requestJson } from "./httpClient.js";

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

export interface ApiTip {
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

const TIP_SYSTEM = `Return 1-2 learning tips as a JSON array only:
[{"concept":"name","summary":"2 sentences","paragraphs":["p1","p2","p3"],"codeExample":{"language":"text","code":""},"category":"other","whyNow":"why","whatAiDid":"what agent did","keyPoints":["a","b"],"watchOut":"","learnMore":["https://example.com"],"depth":"intermediate"}]`;

function parseTipsFromRaw(raw: string): ApiTip[] {
  let json = raw.trim();
  const fence = json.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) json = fence[1].trim();
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is ApiTip => t && typeof t === "object" && "concept" in t && "summary" in t);
  } catch {
    const m = json.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try {
      const parsed = JSON.parse(m[0]) as unknown;
      return Array.isArray(parsed) ? (parsed as ApiTip[]) : [];
    } catch {
      return [];
    }
  }
}

async function callGroqDirect(config: LearnWhileConfig, prompt: string): Promise<ApiTip[]> {
  const keys = config.apiKey.split(",").map((k) => k.trim()).filter(Boolean);
  const models = ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"];
  let lastErr: Error | null = null;

  for (const model of models) {
    for (const key of keys) {
      try {
        const res = await requestJson("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            temperature: 0.35,
            messages: [
              { role: "system", content: TIP_SYSTEM },
              { role: "user", content: prompt.slice(0, 8000) },
            ],
          }),
        });
        if (res.status === 429) continue;
        if (res.status >= 400) {
          lastErr = new Error(`Groq ${res.status}: ${res.body.slice(0, 120)}`);
          continue;
        }
        const data = JSON.parse(res.body) as { choices?: Array<{ message?: { content?: string } }> };
        const content = data.choices?.[0]?.message?.content ?? "[]";
        const tips = parseTipsFromRaw(content);
        if (tips.length > 0) return tips;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
      }
    }
  }
  throw lastErr ?? new Error("Direct Groq call failed");
}

export async function loadTipConfig(): Promise<LearnWhileConfig> {
  const configPath = join(homedir(), ".learnwhile", "config.json");
  const defaults: LearnWhileConfig = {
    provider: "hosted",
    apiKey: "",
    model: "llama-3.1-8b-instant",
    maxTipsPerTurn: 3,
    enabled: true,
    hostedApiUrl: DEFAULT_HOSTED_API_URL,
    clientKey: DEFAULT_CLIENT_KEY,
  };

  try {
    const raw = await readFile(configPath, "utf-8");
    const merged = { ...defaults, ...(JSON.parse(raw) as Partial<LearnWhileConfig>) };
    if (!merged.hostedApiUrl?.startsWith("http")) {
      merged.hostedApiUrl = DEFAULT_HOSTED_API_URL;
    }
    return merged;
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

  const trimmed = prompt.length > 8000 ? prompt.slice(0, 8000) + "\n...[truncated]" : prompt;

  try {
    const res = await requestJson(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: trimmed, maxTips: config.maxTipsPerTurn }),
    });

    if (!res.status || res.status >= 400) {
      throw new Error(`Hosted API error ${res.status}: ${res.body.slice(0, 200)}`);
    }

    const data = JSON.parse(res.body) as { tips?: ApiTip[] };
    return Array.isArray(data.tips) ? data.tips : [];
  } catch (hostedErr) {
    // Fallback: user's own Groq key (bypasses blocked Vercel on corporate networks)
    const hasGroqKey = Boolean(config.apiKey.trim());

    if (hasGroqKey) {
      try {
        return await callGroqDirect(config, trimmed);
      } catch {
        // fall through to original error
      }
    }

    throw hostedErr;
  }
}

export async function pingHostedApi(config: LearnWhileConfig): Promise<{ ok: boolean; detail: string }> {
  const url = healthUrl(config.hostedApiUrl ?? DEFAULT_HOSTED_API_URL);
  const headers: Record<string, string> = {};
  if (config.clientKey) {
    headers["X-LearnWhile-Client"] = config.clientKey;
  }

  try {
    const res = await requestJson(url, { method: "GET", headers });
    if (res.status >= 400) {
      return { ok: false, detail: `API ${res.status} at ${url}: ${res.body.slice(0, 120)}` };
    }
    const data = JSON.parse(res.body) as { ok?: boolean; keys?: number; message?: string };
    if (data.ok) {
      return {
        ok: true,
        detail: `API OK at ${url} (${data.keys ?? "?"} Groq keys)`,
      };
    }
    return { ok: false, detail: res.body.slice(0, 120) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (config.apiKey.trim()) {
      return { ok: true, detail: `Hosted API blocked (${msg}) — will use your Groq key directly` };
    }
    return { ok: false, detail: `API unreachable (${url}): ${msg}` };
  }
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
