import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { FileEdit, ToolUse } from "./types.js";
import { contextPath, sessionDir } from "./config.js";

export interface AccumulatedContext {
  sessionId: string;
  userPrompt?: string;
  agentResponse?: string;
  fileEdits: FileEdit[];
  toolsUsed: ToolUse[];
}

export async function loadAccumulatedContext(sessionId: string): Promise<AccumulatedContext> {
  const path = contextPath(sessionId);
  if (!existsSync(path)) {
    return { sessionId, fileEdits: [], toolsUsed: [] };
  }
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as AccumulatedContext;
  } catch {
    return { sessionId, fileEdits: [], toolsUsed: [] };
  }
}

export async function saveAccumulatedContext(ctx: AccumulatedContext): Promise<void> {
  await mkdir(sessionDir(ctx.sessionId), { recursive: true });
  await writeFile(contextPath(ctx.sessionId), JSON.stringify(ctx, null, 2), "utf-8");
}

export async function mergeIntoContext(
  sessionId: string,
  partial: Partial<AccumulatedContext>
): Promise<AccumulatedContext> {
  const existing = await loadAccumulatedContext(sessionId);
  const merged: AccumulatedContext = {
    sessionId,
    userPrompt: partial.userPrompt ?? existing.userPrompt,
    agentResponse: partial.agentResponse ?? existing.agentResponse,
    fileEdits: [...existing.fileEdits, ...(partial.fileEdits ?? [])],
    toolsUsed: [...existing.toolsUsed, ...(partial.toolsUsed ?? [])],
  };
  await saveAccumulatedContext(merged);
  return merged;
}

export async function clearAccumulatedContext(sessionId: string): Promise<AccumulatedContext> {
  const cleared: AccumulatedContext = {
    sessionId,
    fileEdits: [],
    toolsUsed: [],
  };
  await saveAccumulatedContext(cleared);
  return cleared;
}
