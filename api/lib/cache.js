/**
 * In-memory response cache — reduces duplicate Groq calls on warm instances.
 */

const { createHash } = require("node:crypto");

const CACHE_TTL_MS = 20 * 60 * 1000;
const CACHE_MAX = 150;
const store = new Map();

function makeKey(parts) {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function set(key, value) {
  if (store.size >= CACHE_MAX) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
  store.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

function cacheKeyForTips(prompt, systemPrompt, maxTips) {
  return makeKey(["tips", systemPrompt, prompt, String(maxTips)]);
}

module.exports = { get, set, cacheKeyForTips };
