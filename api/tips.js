/**
 * Learn While Coding — hosted tips API
 * Deploy to Vercel with env: GROQ_API_KEY, LEARNWHILE_CLIENT_KEY
 */

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

const VALID_CATEGORIES = new Set([
  "pattern",
  "api",
  "tooling",
  "architecture",
  "security",
  "other",
]);
const VALID_DEPTHS = new Set(["beginner", "intermediate", "advanced"]);

function parseTips(raw, maxTips) {
  let json = String(raw).trim();
  const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) json = fenceMatch[1].trim();

  let parsed;
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
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      concept: String(item.concept ?? "Unknown concept"),
      summary: String(item.summary ?? ""),
      category: VALID_CATEGORIES.has(item.category) ? item.category : "other",
      whyNow: String(item.whyNow ?? ""),
      learnMore: Array.isArray(item.learnMore)
        ? item.learnMore.filter((u) => typeof u === "string").slice(0, 3)
        : [],
      depth: VALID_DEPTHS.has(item.depth) ? item.depth : "intermediate",
    }))
    .filter((tip) => tip.concept && tip.summary);
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-LearnWhile-Client");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return res.status(503).json({ error: "API not configured. Set GROQ_API_KEY on Vercel." });
  }

  const expectedClient = process.env.LEARNWHILE_CLIENT_KEY;
  if (expectedClient) {
    const clientKey = req.headers["x-learnwhile-client"];
    if (clientKey !== expectedClient) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const { prompt, maxTips = 3, model = "llama-3.3-70b-versatile" } = req.body ?? {};
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Missing prompt" });
  }

  if (prompt.length > 12000) {
    return res.status(400).json({ error: "Prompt too long" });
  }

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      console.error("Groq error:", err);
      return res.status(502).json({ error: "LLM provider error" });
    }

    const data = await groqRes.json();
    const raw = data.choices?.[0]?.message?.content ?? "[]";
    const tips = parseTips(raw, Math.min(Number(maxTips) || 3, 5));

    return res.status(200).json({ tips });
  } catch (err) {
    console.error("Tips API error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
