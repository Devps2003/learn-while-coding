const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|token|password|auth)\s*[:=]\s*['"]?[\w-]{8,}/gi,
  /sk-[a-zA-Z0-9]{20,}/g,
  /ghp_[a-zA-Z0-9]{20,}/g,
  /Bearer\s+[a-zA-Z0-9._-]+/gi,
  /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END/gi,
];

export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

export function redactObject<T>(obj: T): T {
  if (typeof obj === "string") {
    return redactSecrets(obj) as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item)) as T;
  }
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      out[key] = redactObject(value);
    }
    return out as T;
  }
  return obj;
}
