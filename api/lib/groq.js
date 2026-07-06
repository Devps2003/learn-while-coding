/**
 * Groq client with model fallback and multi-key rotation on 429.
 * Uses smaller models first to maximize free-tier quota.
 */

const GROQ_MODELS = [
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
];

function getGroqApiKeys() {
  const keys = [];

  if (process.env.GROQ_API_KEYS) {
    for (const part of process.env.GROQ_API_KEYS.split(",")) {
      const trimmed = part.trim();
      if (trimmed) keys.push(trimmed);
    }
  }

  // Legacy single key — only used when GROQ_API_KEYS is not set
  if (!keys.length) {
    const primary = process.env.GROQ_API_KEY?.trim();
    if (primary) keys.push(primary);
  }

  return keys;
}

function maskKey(key) {
  if (!key || key.length < 12) return "???";
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

function resolveModels(preferred) {
  if (!preferred) return GROQ_MODELS;
  return [preferred, ...GROQ_MODELS.filter((m) => m !== preferred)];
}

async function callGroq(groqKey, model, systemPrompt, userPrompt, maxTokens = 1024) {
  const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${groqKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.35,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!groqRes.ok) {
    const err = await groqRes.text();
    const error = new Error(`Groq ${model} ${groqRes.status}: ${err.slice(0, 200)}`);
    error.status = groqRes.status;
    throw error;
  }

  const data = await groqRes.json();
  return data.choices?.[0]?.message?.content ?? "[]";
}

/**
 * For each model, try every API key. On 429, rotate to the next key.
 */
async function callGroqWithFallbacks(keys, models, systemPrompt, userPrompt, maxTokens = 1024) {
  if (!keys.length) {
    throw new Error("No Groq API keys configured");
  }

  let lastError = null;

  for (const model of models) {
    for (const key of keys) {
      try {
        return await callGroq(key, model, systemPrompt, userPrompt, maxTokens);
      } catch (err) {
        lastError = err;
        const status = err?.status ?? 0;

        if (status === 429) {
          console.error(`Groq 429 on ${model} with key ${maskKey(key)}, trying next key`);
          continue;
        }

        console.error(`Groq ${status} on ${model} with key ${maskKey(key)}:`, err.message);
      }
    }
    console.error(`All keys exhausted for model ${model}, trying next model`);
  }

  throw lastError ?? new Error("All Groq keys and models failed");
}

/** Minimal ping — uses smallest model, fewest tokens */
async function pingGroq(keys) {
  const models = ["llama-3.1-8b-instant"];
  await callGroqWithFallbacks(keys, models, "Reply with exactly: ok", "ping", 5);
  return true;
}

module.exports = {
  GROQ_MODELS,
  getGroqApiKeys,
  resolveModels,
  callGroqWithFallbacks,
  pingGroq,
};
