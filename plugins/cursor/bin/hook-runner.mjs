#!/usr/bin/env node

// packages/core/dist/config.js
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

// packages/core/dist/types.js
var DEFAULT_CONFIG = {
  provider: "hosted",
  apiKey: "",
  model: "llama-3.3-70b-versatile",
  maxTipsPerTurn: 3,
  enabled: true,
  showNotifications: true,
  hostedApiUrl: "https://ai-learning-ten-rose.vercel.app/api/tips",
  clientKey: "learnwhile-v1"
};

// packages/core/dist/config.js
var LEARNWHILE_DIR = join(homedir(), ".learnwhile");
var CONFIG_PATH = join(LEARNWHILE_DIR, "config.json");
var SESSIONS_DIR = join(LEARNWHILE_DIR, "sessions");
var LOGS_DIR = join(LEARNWHILE_DIR, "logs");
async function ensureDirs() {
  await mkdir(LEARNWHILE_DIR, { recursive: true });
  await mkdir(SESSIONS_DIR, { recursive: true });
  await mkdir(LOGS_DIR, { recursive: true });
}
function sessionDir(sessionId) {
  return join(SESSIONS_DIR, sanitizeId(sessionId));
}
function tipsPath(sessionId) {
  return join(sessionDir(sessionId), "tips.jsonl");
}
function latestPath(sessionId) {
  return join(sessionDir(sessionId), "latest.json");
}
function indexPath(sessionId) {
  return join(sessionDir(sessionId), "index.json");
}
function contextPath(sessionId) {
  return join(sessionDir(sessionId), "context.json");
}
function sanitizeId(id) {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128);
}
async function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
async function logError(message, error) {
  await ensureDirs();
  const line = `[${(/* @__PURE__ */ new Date()).toISOString()}] ${message}${error ? ` ${String(error)}` : ""}
`;
  const logFile = join(LOGS_DIR, "hook-runner.log");
  await writeFile(logFile, line, { flag: "a" });
}

// packages/core/dist/constants.js
var DEFAULT_HOSTED_API_URL = "https://ai-learning-ten-rose.vercel.app/api/tips";
var DEFAULT_CLIENT_KEY = "learnwhile-v1";

// packages/core/dist/redact.js
var SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|token|password|auth)\s*[:=]\s*['"]?[\w-]{8,}/gi,
  /sk-[a-zA-Z0-9]{20,}/g,
  /ghp_[a-zA-Z0-9]{20,}/g,
  /Bearer\s+[a-zA-Z0-9._-]+/gi,
  /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END/gi
];
function redactSecrets(text) {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

// packages/core/dist/prompt.js
var TIP_SYSTEM_PROMPT = `You are a senior engineering mentor writing mini-tutorials for developers who use AI to code but want to actually UNDERSTAND what happened.

Given context from an AI-assisted coding session, identify 1-2 concepts worth deep learning (prefer quality over quantity).

Each tip is a short technical article \u2014 NOT a one-liner flashcard.

Respond with ONLY a valid JSON array (no markdown fences). Use this exact schema:

[
  {
    "concept": "Short name (2-5 words)",
    "summary": "2-3 sentences for card preview \u2014 hook the reader, explain why this matters now",
    "paragraphs": [
      "Paragraph 1: Definition in plain English. Use **bold** for key terms.",
      "Paragraph 2: How it works technically \u2014 mechanisms, comparisons (e.g. RAM vs disk).",
      "Paragraph 3: Engineering mental model \u2014 how to think about it in practice.",
      "Paragraph 4: Concrete example or workflow tied to this session.",
      "Paragraph 5: Tradeoffs, pitfalls, durability, or scaling concerns.",
      "Paragraph 6: Real-world use cases engineers use this for."
    ],
    "codeExample": { "language": "text", "code": "optional short code snippet, or empty string" },
    "category": "pattern|api|tooling|architecture|security|other",
    "whyNow": "Why this concept appeared in THIS agent turn (2 sentences)",
    "whatAiDid": "What the AI agent did in the codebase related to this (2 sentences)",
    "keyPoints": ["4-6 bullets: concrete things to verify or remember"],
    "watchOut": "Gotcha or tradeoff (1 sentence, or empty string)",
    "learnMore": ["https://official-docs-url"],
    "depth": "beginner|intermediate|advanced"
  }
]

Rules:
- paragraphs MUST have 5-7 strings, each 2-4 sentences, educational and specific
- Write like a technical blog post, not a dictionary definition
- Be specific to the session context when possible
- Return [] if nothing worth learning
- Max 2 items
- Output MUST be valid JSON (escape quotes inside strings)`;
var TIP_FALLBACK_PROMPT = `You are an engineering mentor. Given an AI coding session, return 1-2 learning tips as a JSON array only:

[{"concept":"name","summary":"2 sentences","paragraphs":["paragraph1","paragraph2","paragraph3"],"codeExample":{"language":"text","code":""},"category":"other","whyNow":"why now","whatAiDid":"what agent did","keyPoints":["point1","point2"],"watchOut":"","learnMore":["https://example.com"],"depth":"intermediate"}]

Each paragraphs entry must be 2-3 full sentences. Return [] if nothing to learn.`;

// packages/core/dist/llm.js
function buildUserPrompt(context) {
  const parts = [];
  if (context.seenConcepts.length > 0) {
    parts.push(`Already covered this session (skip these): ${context.seenConcepts.join(", ")}`);
  }
  if (context.userPrompt) {
    parts.push(`User prompt:
${redactSecrets(context.userPrompt)}`);
  }
  if (context.agentResponse) {
    const truncated = context.agentResponse.length > 4e3 ? context.agentResponse.slice(0, 4e3) + "\n...[truncated]" : context.agentResponse;
    parts.push(`Agent response:
${redactSecrets(truncated)}`);
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
var VALID_CATEGORIES = [
  "pattern",
  "api",
  "tooling",
  "architecture",
  "security",
  "other"
];
var VALID_DEPTHS = ["beginner", "intermediate", "advanced"];
function parseStringArray(value, max = 5) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, max);
}
function buildBodyFromItem(item) {
  const paragraphs = parseStringArray(item.paragraphs, 8);
  let body = paragraphs.length > 0 ? paragraphs.join("\n\n") : String(item.body ?? "").trim();
  const codeEx = item.codeExample;
  if (codeEx && typeof codeEx === "object") {
    const codeObj = codeEx;
    const code = String(codeObj.code ?? "").trim();
    if (code) {
      const lang = String(codeObj.language ?? "text");
      body += `${body ? "\n\n" : ""}\`\`\`${lang}
${code}
\`\`\``;
    }
  }
  const detail = String(item.detail ?? "").trim();
  return body || detail;
}
function parseTips(raw, maxTips) {
  let json = raw.trim();
  const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    json = fenceMatch[1].trim();
  }
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    const arrayMatch = json.match(/\[[\s\S]*\]/);
    if (!arrayMatch)
      return [];
    parsed = JSON.parse(arrayMatch[0]);
  }
  if (!Array.isArray(parsed))
    return [];
  return parsed.slice(0, maxTips).filter((item) => item && typeof item === "object").map((item) => {
    const summary = String(item.summary ?? "");
    const detail = String(item.detail ?? "");
    const whatAiDid = String(item.whatAiDid ?? "");
    const watchOut = String(item.watchOut ?? "").trim();
    const keyPoints = parseStringArray(item.keyPoints, 6);
    const resolvedBody = buildBodyFromItem(item) || summary;
    return {
      concept: String(item.concept ?? "Unknown concept"),
      summary,
      body: resolvedBody,
      detail: detail || summary,
      category: VALID_CATEGORIES.includes(item.category) ? item.category : "other",
      whyNow: String(item.whyNow ?? ""),
      whatAiDid,
      keyPoints,
      watchOut: watchOut || void 0,
      learnMore: parseStringArray(item.learnMore, 3),
      depth: VALID_DEPTHS.includes(item.depth) ? item.depth : "intermediate"
    };
  }).filter((tip) => tip.concept && tip.summary);
}
async function callAnthropic(config, userPrompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      system: TIP_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }]
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.content?.find((c) => c.type === "text")?.text ?? "[]";
}
async function callHosted(config, userPrompt) {
  const url = config.hostedApiUrl ?? DEFAULT_HOSTED_API_URL;
  const clientKey = config.clientKey ?? DEFAULT_CLIENT_KEY;
  const headers = {
    "Content-Type": "application/json"
  };
  if (clientKey) {
    headers["X-LearnWhile-Client"] = clientKey;
  }
  async function request(systemPrompt) {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt: userPrompt,
        maxTips: config.maxTipsPerTurn,
        model: config.model,
        systemPrompt
      })
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Hosted API error ${res.status}: ${err}`);
    }
    const data = await res.json();
    if (Array.isArray(data.tips) && data.tips.length > 0) {
      return data.tips;
    }
    if (typeof data.raw === "string") {
      return parseTips(data.raw, config.maxTipsPerTurn);
    }
    return [];
  }
  const primary = await request(TIP_SYSTEM_PROMPT);
  if (primary.length > 0) {
    return primary;
  }
  return request(TIP_FALLBACK_PROMPT);
}
async function callGroq(config, userPrompt, systemPrompt = TIP_SYSTEM_PROMPT) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "[]";
}
async function callOpenAI(config, userPrompt, baseUrl = "https://api.openai.com/v1") {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      messages: [
        { role: "system", content: TIP_SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "[]";
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed))
      return content;
    if (Array.isArray(parsed.tips))
      return JSON.stringify(parsed.tips);
    if (Array.isArray(parsed.concepts))
      return JSON.stringify(parsed.concepts);
  } catch {
  }
  return content;
}
async function generateTipsFromContext(config, context) {
  const userPrompt = buildUserPrompt({
    ...context,
    maxTips: config.maxTipsPerTurn
  });
  if (config.provider === "hosted") {
    return callHosted(config, userPrompt);
  }
  if (!config.apiKey) {
    throw new Error("API key not configured. Use provider 'hosted' (default) or set ~/.learnwhile/config.json");
  }
  let raw;
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
  let tips = parseTips(raw, config.maxTipsPerTurn);
  if (tips.length === 0 && config.provider === "groq") {
    raw = await callGroq(config, userPrompt, TIP_FALLBACK_PROMPT);
    tips = parseTips(raw, config.maxTipsPerTurn);
  }
  return tips;
}

// packages/core/dist/storage.js
import { readFile as readFile2, writeFile as writeFile2, appendFile, mkdir as mkdir2 } from "node:fs/promises";
import { existsSync as existsSync2 } from "node:fs";
function normalizeConcept(concept) {
  return concept.toLowerCase().trim().replace(/\s+/g, " ");
}
async function loadSeenConcepts(sessionId) {
  const path = indexPath(sessionId);
  if (!existsSync2(path)) {
    return /* @__PURE__ */ new Set();
  }
  try {
    const raw = await readFile2(path, "utf-8");
    const data = JSON.parse(raw);
    return new Set(data.seenConcepts ?? []);
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
async function saveSeenConcepts(sessionId, concepts) {
  await mkdir2(sessionDir(sessionId), { recursive: true });
  const data = { seenConcepts: [...concepts] };
  await writeFile2(indexPath(sessionId), JSON.stringify(data, null, 2), "utf-8");
}
function dedupeTips(tips, seenConcepts) {
  const result = [];
  for (const tip of tips) {
    const key = normalizeConcept(tip.concept);
    if (!seenConcepts.has(key)) {
      seenConcepts.add(key);
      result.push(tip);
    }
  }
  return result;
}
async function appendTipTurn(turn) {
  await ensureDirs();
  await mkdir2(sessionDir(turn.sessionId), { recursive: true });
  const line = JSON.stringify(turn) + "\n";
  await appendFile(tipsPath(turn.sessionId), line, "utf-8");
}
async function writeLatest(turn) {
  await ensureDirs();
  await mkdir2(sessionDir(turn.sessionId), { recursive: true });
  const tmp = latestPath(turn.sessionId) + ".tmp";
  await writeFile2(tmp, JSON.stringify(turn, null, 2), "utf-8");
  const { rename } = await import("node:fs/promises");
  await rename(tmp, latestPath(turn.sessionId));
}

// packages/core/dist/context.js
import { readFile as readFile3, writeFile as writeFile3, mkdir as mkdir3 } from "node:fs/promises";
import { existsSync as existsSync3 } from "node:fs";
async function loadAccumulatedContext(sessionId) {
  const path = contextPath(sessionId);
  if (!existsSync3(path)) {
    return { sessionId, fileEdits: [], toolsUsed: [] };
  }
  try {
    const raw = await readFile3(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { sessionId, fileEdits: [], toolsUsed: [] };
  }
}
async function saveAccumulatedContext(ctx) {
  await mkdir3(sessionDir(ctx.sessionId), { recursive: true });
  await writeFile3(contextPath(ctx.sessionId), JSON.stringify(ctx, null, 2), "utf-8");
}
async function mergeIntoContext(sessionId, partial) {
  const existing = await loadAccumulatedContext(sessionId);
  const merged = {
    sessionId,
    userPrompt: partial.userPrompt ?? existing.userPrompt,
    agentResponse: partial.agentResponse ?? existing.agentResponse,
    fileEdits: [...existing.fileEdits, ...partial.fileEdits ?? []],
    toolsUsed: [...existing.toolsUsed, ...partial.toolsUsed ?? []]
  };
  await saveAccumulatedContext(merged);
  return merged;
}
async function clearAccumulatedContext(sessionId) {
  const cleared = {
    sessionId,
    fileEdits: [],
    toolsUsed: []
  };
  await saveAccumulatedContext(cleared);
  return cleared;
}

// packages/core/dist/index.js
async function generateTipsForTurn(context) {
  const config = await loadConfig();
  if (!config.enabled) {
    return null;
  }
  if (config.provider !== "hosted" && !config.apiKey) {
    await logError("Skipping tip generation: no API key configured (use provider 'hosted' for shared API)");
    return null;
  }
  const hasContext = context.agentResponse || context.userPrompt || context.fileEdits.length > 0 || context.toolsUsed.length > 0;
  if (!hasContext) {
    return null;
  }
  try {
    const seenConcepts = await loadSeenConcepts(context.sessionId);
    const rawTips = await generateTipsFromContext(config, {
      userPrompt: context.userPrompt,
      agentResponse: context.agentResponse,
      fileEdits: context.fileEdits,
      toolsUsed: context.toolsUsed,
      seenConcepts: [...seenConcepts]
    });
    const tips = dedupeTips(rawTips, seenConcepts);
    if (tips.length === 0) {
      return null;
    }
    await saveSeenConcepts(context.sessionId, seenConcepts);
    const turn = {
      sessionId: context.sessionId,
      turnId: context.turnId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      platform: context.platform,
      tips
    };
    await appendTipTurn(turn);
    await writeLatest(turn);
    return turn;
  } catch (error) {
    await logError("Failed to generate tips", error);
    return null;
  }
}

// packages/hook-runner/src/normalize.ts
function getString(obj, key) {
  const val = obj[key];
  return typeof val === "string" ? val : void 0;
}
function cursorSessionId(payload) {
  return getString(payload, "conversation_id") ?? getString(payload, "session_id") ?? "cursor-default";
}
function cursorTurnId(payload) {
  return getString(payload, "generation_id") ?? getString(payload, "turn_id") ?? `turn-${Date.now()}`;
}
function claudeSessionId(payload) {
  return getString(payload, "session_id") ?? "claude-default";
}
function claudeTurnId(payload) {
  return getString(payload, "turn_id") ?? `turn-${Date.now()}`;
}
function normalizeCursorHook(event, payload) {
  const sessionId = cursorSessionId(payload);
  const turnId = cursorTurnId(payload);
  switch (event) {
    case "beforeSubmitPrompt":
      return {
        sessionId,
        turnId,
        platform: "cursor",
        userPrompt: getString(payload, "prompt")
      };
    case "afterAgentResponse":
      return {
        sessionId,
        turnId,
        platform: "cursor",
        agentResponse: getString(payload, "text")
      };
    case "afterFileEdit": {
      const filePath = getString(payload, "file_path") ?? "";
      const edits = Array.isArray(payload.edits) ? payload.edits.map(
        (e) => ({
          oldText: e.old_string,
          newText: e.new_string
        })
      ) : [];
      return {
        sessionId,
        turnId,
        platform: "cursor",
        fileEdits: [{ filePath, edits }]
      };
    }
    case "stop":
      return {
        sessionId,
        turnId,
        platform: "cursor",
        agentResponse: getString(payload, "text"),
        transcriptPath: getString(payload, "transcript_path") ?? null
      };
    default:
      return null;
  }
}
function normalizeClaudeHook(event, payload) {
  const sessionId = claudeSessionId(payload);
  const turnId = claudeTurnId(payload);
  const hookEventName = getString(payload, "hook_event_name") ?? event;
  switch (hookEventName) {
    case "UserPromptSubmit":
    case "beforeSubmitPrompt":
      return {
        sessionId,
        turnId,
        platform: "claude",
        userPrompt: getString(payload, "prompt")
      };
    case "Stop":
    case "stop":
      return {
        sessionId,
        turnId,
        platform: "claude",
        agentResponse: getString(payload, "response") ?? getString(payload, "text")
      };
    case "PostToolUse":
    case "postToolUse": {
      const toolName = getString(payload, "tool_name") ?? getString(payload, "tool") ?? "";
      const toolInput = payload.tool_input;
      const filePath = toolInput?.file_path ?? toolInput?.filePath ?? "";
      const partial = {
        sessionId,
        turnId,
        platform: "claude",
        toolsUsed: [{ name: toolName, input: toolInput }]
      };
      if (filePath && /edit|write/i.test(toolName)) {
        partial.fileEdits = [{ filePath }];
      }
      return partial;
    }
    case "SessionEnd":
    case "sessionEnd":
      return {
        sessionId,
        turnId,
        platform: "claude"
      };
    default:
      return null;
  }
}
function normalizeHook(input) {
  if (input.platform === "cursor") {
    return normalizeCursorHook(input.event, input.payload);
  }
  return normalizeClaudeHook(input.event, input.payload);
}
function isGenerateEvent(platform, event) {
  if (platform === "cursor") {
    return event === "stop";
  }
  return event === "stop" || event === "sessionEnd";
}
function isAccumulateEvent(platform, event) {
  const accumulateEvents = [
    "afterAgentResponse",
    "afterFileEdit",
    "beforeSubmitPrompt",
    "postToolUse"
  ];
  return accumulateEvents.includes(event);
}

// packages/hook-runner/src/cli.ts
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}
function parseArgs(argv) {
  let platform = "cursor";
  let event = "stop";
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--platform" && argv[i + 1]) {
      platform = argv[i + 1];
      i++;
    } else if (argv[i] === "--event" && argv[i + 1]) {
      event = argv[i + 1];
      i++;
    }
  }
  return { platform, event };
}
async function main() {
  const { platform, event } = parseArgs(process.argv);
  let payload = {};
  const stdin = await readStdin();
  if (stdin.trim()) {
    try {
      payload = JSON.parse(stdin);
    } catch {
      process.stderr.write("learnwhile-hook: invalid JSON on stdin\n");
      process.exit(0);
    }
  }
  const partial = normalizeHook({ platform, event, payload });
  if (!partial || !partial.sessionId) {
    process.exit(0);
  }
  const sessionId = partial.sessionId;
  if (isAccumulateEvent(platform, event)) {
    await mergeIntoContext(sessionId, {
      userPrompt: partial.userPrompt,
      agentResponse: partial.agentResponse,
      fileEdits: partial.fileEdits,
      toolsUsed: partial.toolsUsed
    });
    process.exit(0);
  }
  if (!isGenerateEvent(platform, event)) {
    process.exit(0);
  }
  const accumulated = await loadAccumulatedContext(sessionId);
  const context = {
    sessionId,
    turnId: partial.turnId ?? `turn-${Date.now()}`,
    platform: partial.platform ?? platform,
    userPrompt: partial.userPrompt ?? accumulated.userPrompt,
    agentResponse: partial.agentResponse ?? accumulated.agentResponse,
    fileEdits: [...accumulated.fileEdits, ...partial.fileEdits ?? []],
    toolsUsed: [...accumulated.toolsUsed, ...partial.toolsUsed ?? []],
    transcriptPath: partial.transcriptPath
  };
  await generateTipsForTurn(context);
  await clearAccumulatedContext(sessionId);
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(`learnwhile-hook error: ${String(err)}
`);
  process.exit(0);
});
