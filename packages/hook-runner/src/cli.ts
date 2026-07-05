import {
  clearAccumulatedContext,
  generateTipsForTurn,
  loadAccumulatedContext,
  mergeIntoContext,
  type TurnContext,
} from "@learnwhile/core";
import {
  isAccumulateEvent,
  isGenerateEvent,
  normalizeHook,
  type HookEvent,
  type HookPlatform,
} from "./normalize.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function parseArgs(argv: string[]): { platform: HookPlatform; event: HookEvent } {
  let platform: HookPlatform = "cursor";
  let event: HookEvent = "stop";

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--platform" && argv[i + 1]) {
      platform = argv[i + 1] as HookPlatform;
      i++;
    } else if (argv[i] === "--event" && argv[i + 1]) {
      event = argv[i + 1] as HookEvent;
      i++;
    }
  }

  return { platform, event };
}

async function main(): Promise<void> {
  const { platform, event } = parseArgs(process.argv);

  let payload: Record<string, unknown> = {};
  const stdin = await readStdin();

  if (stdin.trim()) {
    try {
      payload = JSON.parse(stdin) as Record<string, unknown>;
    } catch {
      process.stderr.write("learnwhile-hook: invalid JSON on stdin\n");
      process.exit(0);
    }
  }

  const partial = normalizeHook({ platform, event, payload });
  if (!partial || !partial.sessionId) {
    process.exit(0);
  }

  const sessionId = partial.sessionId;

  if (isAccumulateEvent(platform, event)) {
    await mergeIntoContext(sessionId, {
      userPrompt: partial.userPrompt,
      agentResponse: partial.agentResponse,
      fileEdits: partial.fileEdits,
      toolsUsed: partial.toolsUsed,
    });
    process.exit(0);
  }

  if (!isGenerateEvent(platform, event)) {
    process.exit(0);
  }

  const accumulated = await loadAccumulatedContext(sessionId);

  const context: TurnContext = {
    sessionId,
    turnId: partial.turnId ?? `turn-${Date.now()}`,
    platform: partial.platform ?? platform,
    userPrompt: partial.userPrompt ?? accumulated.userPrompt,
    agentResponse: partial.agentResponse ?? accumulated.agentResponse,
    fileEdits: [...accumulated.fileEdits, ...(partial.fileEdits ?? [])],
    toolsUsed: [...accumulated.toolsUsed, ...(partial.toolsUsed ?? [])],
    transcriptPath: partial.transcriptPath,
  };

  await generateTipsForTurn(context);
  await clearAccumulatedContext(sessionId);

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`learnwhile-hook error: ${String(err)}\n`);
  process.exit(0);
});
