/**
 * Learn While Coding — health check (no LLM call by default)
 */

const { getGroqApiKeys, pingGroq, GROQ_MODELS } = require("./lib/groq");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-LearnWhile-Client");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const expectedClient = process.env.LEARNWHILE_CLIENT_KEY;
  if (expectedClient && req.headers["x-learnwhile-client"] !== expectedClient) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const keys = getGroqApiKeys();
  if (!keys.length) {
    return res.status(503).json({ ok: false, error: "No Groq keys configured" });
  }

  const verify = req.query?.verify === "1";

  if (!verify) {
    return res.status(200).json({
      ok: true,
      keys: keys.length,
      models: GROQ_MODELS,
      message: "API reachable — Groq keys configured",
    });
  }

  try {
    await pingGroq(keys);
    return res.status(200).json({ ok: true, keys: keys.length, groq: "verified" });
  } catch (err) {
    return res.status(503).json({
      ok: false,
      error: "Groq unavailable",
      detail: String(err?.message ?? err).slice(0, 200),
      keys: keys.length,
    });
  }
};
