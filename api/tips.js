/**
 * Learn While Coding — hosted tips API
 */

const SYSTEM_PROMPT = `You are a senior engineering mentor writing mini-tutorials for developers who use AI to code but want to actually UNDERSTAND what happened.

Given context from an AI-assisted coding session, identify 1-2 concepts worth deep learning (prefer quality over quantity).

Each tip is a short technical article — NOT a one-liner flashcard.

Respond with ONLY a valid JSON array (no markdown fences). Use this exact schema:

[
  {
    "concept": "Short name (2-5 words)",
    "summary": "2-3 sentences for card preview — hook the reader, explain why this matters now",
    "paragraphs": [
      "Paragraph 1: Definition in plain English. Use **bold** for key terms.",
      "Paragraph 2: How it works technically — mechanisms, comparisons (e.g. RAM vs disk).",
      "Paragraph 3: Engineering mental model — how to think about it in practice.",
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
- Return [] if nothing worth learning
- Max 2 items
- Output MUST be valid JSON`;

const FALLBACK_PROMPT = `Return 1-2 learning tips as JSON array only:
[{"concept":"name","summary":"2 sentences","paragraphs":["p1","p2","p3"],"codeExample":{"language":"text","code":""},"category":"other","whyNow":"why","whatAiDid":"what agent did","keyPoints":["a","b"],"watchOut":"","learnMore":["https://example.com"],"depth":"intermediate"}]
Each paragraph 2-3 full sentences. [] if nothing to learn.`;

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

async function callGroq(groqKey, model, systemPrompt, userPrompt) {
  const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${groqKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0.35,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!groqRes.ok) {
    const err = await groqRes.text();
    console.error("Groq error:", err);
    throw new Error("LLM provider error");
  }

  const data = await groqRes.json();
  return data.choices?.[0]?.message?.content ?? "[]";
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-LearnWhile-Client");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return res.status(503).json({ error: "API not configured. Set GROQ_API_KEY on Vercel." });

  const expectedClient = process.env.LEARNWHILE_CLIENT_KEY;
  if (expectedClient && req.headers["x-learnwhile-client"] !== expectedClient) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { prompt, maxTips = 2, model = "llama-3.3-70b-versatile", systemPrompt } = req.body ?? {};
  if (!prompt || typeof prompt !== "string") return res.status(400).json({ error: "Missing prompt" });
  if (prompt.length > 12000) return res.status(400).json({ error: "Prompt too long" });

  try {
    const primarySystem = typeof systemPrompt === "string" ? systemPrompt : SYSTEM_PROMPT;
    let raw = await callGroq(groqKey, model, primarySystem, prompt);
    let { tips } = parseTips(raw, Math.min(Number(maxTips) || 2, 3));

    if (tips.length === 0) {
      raw = await callGroq(groqKey, model, FALLBACK_PROMPT, prompt);
      ({ tips } = parseTips(raw, Math.min(Number(maxTips) || 2, 3)));
    }

    return res.status(200).json({ tips });
  } catch (err) {
    console.error("Tips API error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
