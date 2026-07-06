import * as vscode from "vscode";
import * as https from "node:https";
import * as http from "node:http";
import { URL } from "node:url";
import { HttpsProxyAgent } from "https-proxy-agent";

export interface HttpResponse {
  status: number;
  body: string;
}

function getProxyUrl(): string | undefined {
  const fromSettings = vscode.workspace.getConfiguration("http").get<string>("proxy");
  if (fromSettings?.trim()) return fromSettings.trim();
  return process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
}

function getAgent(url: string): http.Agent | undefined {
  const proxy = getProxyUrl();
  if (!proxy) return undefined;
  try {
    return new HttpsProxyAgent(proxy) as unknown as http.Agent;
  } catch {
    return undefined;
  }
}

function requestOnce(url: string, method: string, headers: Record<string, string>, body?: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          ...headers,
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
        agent: getAgent(url),
        timeout: 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error(`Timed out: ${url}`));
    });
    req.on("error", reject);

    if (body) req.write(body);
    req.end();
  });
}

async function requestWithFetch(url: string, method: string, headers: Record<string, string>, body?: string): Promise<HttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    return { status: res.status, body: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

export async function requestJson(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string; retries?: number } = {}
): Promise<HttpResponse> {
  const method = options.method ?? "GET";
  const headers = options.headers ?? {};
  const body = options.body;
  const retries = options.retries ?? 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      try {
        return await requestWithFetch(url, method, headers, body);
      } catch {
        return await requestOnce(url, method, headers, body);
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, attempt * 1000));
      }
    }
  }

  const proxyHint = getProxyUrl() ? " (proxy detected)" : "";
  throw new Error(
    `Network failed to ${url}${proxyHint}: ${lastError?.message ?? "unknown"}. ` +
      "Try: Settings → http.proxy, or run Learn While Coding: Setup → add your Groq API key."
  );
}

export function normalizeHostedBase(hostedApiUrl: string): string {
  return hostedApiUrl.replace(/\/api\/tips\/?$/, "").replace(/\/$/, "");
}

export function healthUrl(hostedApiUrl: string): string {
  return `${normalizeHostedBase(hostedApiUrl)}/api/health`;
}
