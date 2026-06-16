import type { LearnWhileConfig, Tip, TipCategory, TipDepth } from "./types.js";
import { DEFAULT_CLIENT_KEY, DEFAULT_HOSTED_API_URL } from "./constants.js";
import { redactSecrets } from "./redact.js";

const SYSTEM_PROMPT = `You are an engineering mentor. Given context from an AI-assisted coding session, identify 0-3 concepts the developer should learn to understand what happened — not just what was built.

Focus on:
- Design decisions and tradeoffs
- New libraries, APIs, or patterns introduced
- Security or performance implications
- Concepts they would have researched if building manually

Skip: boilerplate, obvious syntax, trivial renames, formatting.

Respond with ONLY valid JSON array (no markdown):
[
  {
    "concept": "Short concept name",
    "summary": "One sentence explanation",
    "category": "pattern|api|tooling|architecture|security|other",
    "whyNow": "Why this appeared in this specific turn",
    "learnMore": ["https://official-docs-url"],
    "depth": "beginner|intermediate|advanced"
  }
]

Return [] if nothing worth learning. Max 3 items.`;

function buildUserPrompt(context: {
  userPrompt?: string;
  agentResponse?: string;
  fileEdits: Array<{ filePath: string }>;
  toolsUsed: Array<{ name: string }>;
  maxTips: number;
  seenConcepts: string[];
}): string {
  const parts: string[] = [];

  if (context.seenConcepts.length > 0) {
    parts.push(`Already covered this session (skip these): ${context.seenConcepts.join(", ")}`);
  }

  if (context.userPrompt) {
    parts.push(`User prompt:\n${redactSecrets(context.userPrompt)}`);
  }

  if (context.agentResponse) {
    const truncated =
      context.agentResponse.length > 4000
        ? context.agentResponse.slice(0, 4000) + "\n...[truncated]"
        : context.agentResponse;
    parts.push(`Agent response:\n${redactSecrets(truncated)}`);
  }

  if (context.fileEdits.length > 0) {
    const files = context.fileEdits.map((e) => e.filePath).join(", ");
    parts.push(`Files edited: ${files}`);
  }

  if (context.toolsUsed.length > 0) {
    const tools = context.toolsUsed.map((t) => t.name).join(", ");
    parts.push(`Tools used: ${tools}`);
  }

  parts.push(`Return at most ${context.maxTips} tips.`);
  return parts.join("\n\n");
}

const VALID_CATEGORIES: TipCategory[] = [
  "pattern",
  "api",
  "tooling",
  "architecture",
  "security",
  "other",
];
const VALID_DEPTHS: TipDepth[] = ["beginner", "intermediate", "advanced"];

function parseTips(raw: string, maxTips: number): Tip[] {
  let json = raw.trim();
  const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    json = fenceMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    const arrayMatch = json.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return [];
    parsed = JSON.parse(arrayMatch[0]);
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .slice(0, maxTips)
    .filter((item): item is Record<string, unknown> => item && typeof item === "object")
    .map((item) => ({
      concept: String(item.concept ?? "Unknown concept"),
      summary: String(item.summary ?? ""),
      category: VALID_CATEGORIES.includes(item.category as TipCategory)
        ? (item.category as TipCategory)
        : "other",
      whyNow: String(item.whyNow ?? ""),
      learnMore: Array.isArray(item.learnMore)
        ? item.learnMore.filter((u): u is string => typeof u === "string").slice(0, 3)
        : [],
      depth: VALID_DEPTHS.includes(item.depth as TipDepth)
        ? (item.depth as TipDepth)
        : "intermediate",
    }))
    .filter((tip) => tip.concept && tip.summary);
}

async function callAnthropic(
  config: LearnWhileConfig,
  userPrompt: string
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  return data.content?.find((c) => c.type === "text")?.text ?? "[]";
}

async function callHosted(config: LearnWhileConfig, userPrompt: string): Promise<Tip[]> {
  const url = config.hostedApiUrl ?? DEFAULT_HOSTED_API_URL;
  const clientKey = config.clientKey ?? DEFAULT_CLIENT_KEY;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (clientKey) {
    headers["X-LearnWhile-Client"] = clientKey;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt: userPrompt,
      maxTips: config.maxTipsPerTurn,
      model: config.model,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Hosted API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as { tips?: Tip[]; raw?: string };
  if (Array.isArray(data.tips)) {
    return data.tips;
  }
  if (typeof data.raw === "string") {
    return parseTips(data.raw, config.maxTipsPerTurn);
  }
  return [];
}

async function callGroq(config: LearnWhileConfig, userPrompt: string): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 1024,
      temperature: 0.3,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "[]";
}

async function callOpenAI(
  config: LearnWhileConfig,
  userPrompt: string,
  baseUrl = "https://api.openai.com/v1"
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 1024,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "[]";

  // OpenAI json_object mode may wrap in { tips: [...] }
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return content;
    if (Array.isArray(parsed.tips)) return JSON.stringify(parsed.tips);
    if (Array.isArray(parsed.concepts)) return JSON.stringify(parsed.concepts);
  } catch {
    // fall through
  }
  return content;
}

export async function generateTipsFromContext(
  config: LearnWhileConfig,
  context: {
    userPrompt?: string;
    agentResponse?: string;
    fileEdits: Array<{ filePath: string }>;
    toolsUsed: Array<{ name: string }>;
    seenConcepts: string[];
  }
): Promise<Tip[]> {
  const userPrompt = buildUserPrompt({
    ...context,
    maxTips: config.maxTipsPerTurn,
  });

  if (config.provider === "hosted") {
    return callHosted(config, userPrompt);
  }

  if (!config.apiKey) {
    throw new Error(
      "API key not configured. Use provider 'hosted' (default) or set ~/.learnwhile/config.json"
    );
  }

  let raw: string;
  switch (config.provider) {
    case "anthropic":
      raw = await callAnthropic(config, userPrompt);
      break;
    case "openai":
      raw = await callOpenAI(config, userPrompt);
      break;
    case "openrouter":
      raw = await callOpenAI(config, userPrompt, "https://openrouter.ai/api/v1");
      break;
    case "groq":
      raw = await callGroq(config, userPrompt);
      break;
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }

  return parseTips(raw, config.maxTipsPerTurn);
}
