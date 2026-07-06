/**
 * Learn While Coding — hosted tips API
 */

const { GROQ_MODELS, getGroqApiKeys, resolveModels, callGroqWithFallbacks } = require("./lib/groq");
const { get: cacheGet, set: cacheSet, cacheKeyForTips } = require("./lib/cache");

const SYSTEM_PROMPT = `You are a senior engineering mentor. Given an AI coding session, return 1-2 learning tips as a JSON array only.

[{"concept":"name","summary":"2 sentences","paragraphs":["p1","p2","p3","p4","p5"],"codeExample":{"language":"text","code":""},"category":"other","whyNow":"why","whatAiDid":"what agent did","keyPoints":["a","b","c","d"],"watchOut":"","learnMore":["https://example.com"],"depth":"intermediate"}]

Rules: max 2 items, valid JSON only, [] if nothing to learn.`;

const FALLBACK_PROMPT = `Return 1 learning tip as JSON array: [{"concept":"name","summary":"2 sentences","paragraphs":["p1","p2","p3"],"codeExample":{"language":"text","code":""},"category":"other","whyNow":"why","whatAiDid":"what agent did","keyPoints":["a","b"],"watchOut":"","learnMore":["https://example.com"],"depth":"intermediate"}]`;

const VALID_CATEGORIES = new Set(["pattern", "api", "tooling", "architecture", "security", "other"]);
const VALID_DEPTHS = new Set(["beginner", "intermediate", "advanced"]);

function parseStringArray(value, max = 6) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, max);
}

function buildBodyFromItem(item) {
  const paragraphs = parseStringArray(item.paragraphs, 8);
  let body = paragraphs.length > 0 ? paragraphs.join("\n\n") : String(item.body ?? "").trim();
  const codeEx = item.codeExample;
  if (codeEx && typeof codeEx === "object" && codeEx.code) {
    const code = String(codeEx.code).trim();
    if (code) {
      const lang = String(codeEx.language ?? "text");
      body += `${body ? "\n\n" : ""}\`\`\`${lang}\n${code}\n\`\`\``;
    }
  }
  return body || String(item.detail ?? "").trim();
}

function parseTips(raw, maxTips) {
  let json = String(raw).trim();
  const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) json = fenceMatch[1].trim();

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    const arrayMatch = json.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return { tips: [], parseFailed: true };
    try {
      parsed = JSON.parse(arrayMatch[0]);
    } catch {
      return { tips: [], parseFailed: true };
    }
  }

  if (!Array.isArray(parsed)) return { tips: [], parseFailed: true };

  const tips = parsed
    .slice(0, maxTips)
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const summary = String(item.summary ?? "");
      const resolvedBody = buildBodyFromItem(item) || summary;
      const watchOut = String(item.watchOut ?? "").trim();
      return {
        concept: String(item.concept ?? "Unknown concept"),
        summary,
        body: resolvedBody,
        detail: String(item.detail ?? "") || summary,
        category: VALID_CATEGORIES.has(item.category) ? item.category : "other",
        whyNow: String(item.whyNow ?? ""),
        whatAiDid: String(item.whatAiDid ?? ""),
        keyPoints: parseStringArray(item.keyPoints),
        watchOut: watchOut || undefined,
        learnMore: parseStringArray(item.learnMore, 3),
        depth: VALID_DEPTHS.has(item.depth) ? item.depth : "intermediate",
      };
    })
    .filter((tip) => tip.concept && tip.summary);

  return { tips, parseFailed: false };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-LearnWhile-Client");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const groqKeys = getGroqApiKeys();
  if (!groqKeys.length) {
    return res.status(503).json({ error: "API not configured. Set GROQ_API_KEYS on Vercel." });
  }

  const expectedClient = process.env.LEARNWHILE_CLIENT_KEY;
  if (expectedClient && req.headers["x-learnwhile-client"] !== expectedClient) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { prompt, maxTips = 2, model, systemPrompt } = req.body ?? {};
  if (!prompt || typeof prompt !== "string") return res.status(400).json({ error: "Missing prompt" });

  const trimmedPrompt = prompt.length > 10000 ? prompt.slice(0, 10000) + "\n...[truncated]" : prompt;
  const models = resolveModels(model);
  const tipLimit = Math.min(Number(maxTips) || 2, 3);

  try {
    const primarySystem = typeof systemPrompt === "string" ? systemPrompt : SYSTEM_PROMPT;
    const cacheKey = cacheKeyForTips(trimmedPrompt, primarySystem, tipLimit);
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.status(200).json({ tips: cached, cached: true });
    }

    let raw = await callGroqWithFallbacks(groqKeys, models, primarySystem, trimmedPrompt);
    let { tips } = parseTips(raw, tipLimit);

    if (tips.length === 0) {
      raw = await callGroqWithFallbacks(groqKeys, models, FALLBACK_PROMPT, trimmedPrompt);
      ({ tips } = parseTips(raw, tipLimit));
    }

    // 8b is quota-friendly but sometimes returns empty — retry with larger models
    if (tips.length === 0) {
      const qualityModels = ["llama-3.3-70b-versatile"];
      raw = await callGroqWithFallbacks(groqKeys, qualityModels, primarySystem, trimmedPrompt);
      ({ tips } = parseTips(raw, tipLimit));
      if (tips.length === 0) {
        raw = await callGroqWithFallbacks(groqKeys, qualityModels, FALLBACK_PROMPT, trimmedPrompt);
        ({ tips } = parseTips(raw, tipLimit));
      }
    }

    if (tips.length > 0) {
      cacheSet(cacheKey, tips);
    }

    return res.status(200).json({ tips });
  } catch (err) {
    console.error("Tips API error:", err);
    return res.status(503).json({
      error: "LLM provider unavailable",
      detail: String(err?.message ?? err).slice(0, 300),
    });
  }
};
