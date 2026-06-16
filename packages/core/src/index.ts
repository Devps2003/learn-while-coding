import type { TipTurn, TurnContext } from "./types.js";
import { loadConfig, logError } from "./config.js";
import { generateTipsFromContext } from "./llm.js";
import {
  appendTipTurn,
  dedupeTips,
  loadSeenConcepts,
  saveSeenConcepts,
  writeLatest,
} from "./storage.js";

export async function generateTipsForTurn(context: TurnContext): Promise<TipTurn | null> {
  const config = await loadConfig();

  if (!config.enabled) {
    return null;
  }

  if (config.provider !== "hosted" && !config.apiKey) {
    await logError("Skipping tip generation: no API key configured (use provider 'hosted' for shared API)");
    return null;
  }

  // Skip if no meaningful context
  const hasContext =
    context.agentResponse ||
    context.userPrompt ||
    context.fileEdits.length > 0 ||
    context.toolsUsed.length > 0;

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
      seenConcepts: [...seenConcepts],
    });

    const tips = dedupeTips(rawTips, seenConcepts);

    if (tips.length === 0) {
      return null;
    }

    await saveSeenConcepts(context.sessionId, seenConcepts);

    const turn: TipTurn = {
      sessionId: context.sessionId,
      turnId: context.turnId,
      timestamp: new Date().toISOString(),
      platform: context.platform,
      tips,
    };

    await appendTipTurn(turn);
    await writeLatest(turn);

    return turn;
  } catch (error) {
    await logError("Failed to generate tips", error);
    return null;
  }
}

export * from "./constants.js";
export * from "./types.js";
export * from "./config.js";
export * from "./storage.js";
export * from "./llm.js";
export * from "./redact.js";
export * from "./context.js";
