import type { TurnContext } from "@learnwhile/core";

export type HookPlatform = "cursor" | "claude";
export type HookEvent =
  | "stop"
  | "afterAgentResponse"
  | "afterFileEdit"
  | "beforeSubmitPrompt"
  | "postToolUse"
  | "sessionEnd";

export interface HookInput {
  platform: HookPlatform;
  event: HookEvent;
  payload: Record<string, unknown>;
}

function getString(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key];
  return typeof val === "string" ? val : undefined;
}

function cursorSessionId(payload: Record<string, unknown>): string {
  return (
    getString(payload, "conversation_id") ??
    getString(payload, "session_id") ??
    "cursor-default"
  );
}

function cursorTurnId(payload: Record<string, unknown>): string {
  return (
    getString(payload, "generation_id") ??
    getString(payload, "turn_id") ??
    `turn-${Date.now()}`
  );
}

function claudeSessionId(payload: Record<string, unknown>): string {
  return getString(payload, "session_id") ?? "claude-default";
}

function claudeTurnId(payload: Record<string, unknown>): string {
  return getString(payload, "turn_id") ?? `turn-${Date.now()}`;
}

export function normalizeCursorHook(
  event: HookEvent,
  payload: Record<string, unknown>
): Partial<TurnContext> | null {
  const sessionId = cursorSessionId(payload);
  const turnId = cursorTurnId(payload);

  switch (event) {
    case "beforeSubmitPrompt":
      return {
        sessionId,
        turnId,
        platform: "cursor",
        userPrompt: getString(payload, "prompt"),
      };

    case "afterAgentResponse":
      return {
        sessionId,
        turnId,
        platform: "cursor",
        agentResponse: getString(payload, "text"),
      };

    case "afterFileEdit": {
      const filePath = getString(payload, "file_path") ?? "";
      const edits = Array.isArray(payload.edits)
        ? (payload.edits as Array<{ old_string?: string; new_string?: string }>).map(
            (e) => ({
              oldText: e.old_string,
              newText: e.new_string,
            })
          )
        : [];
      return {
        sessionId,
        turnId,
        platform: "cursor",
        fileEdits: [{ filePath, edits }],
      };
    }

    case "stop":
      return {
        sessionId,
        turnId,
        platform: "cursor",
        agentResponse: getString(payload, "text"),
        transcriptPath: getString(payload, "transcript_path") ?? null,
      };

    default:
      return null;
  }
}

export function normalizeClaudeHook(
  event: HookEvent,
  payload: Record<string, unknown>
): Partial<TurnContext> | null {
  const sessionId = claudeSessionId(payload);
  const turnId = claudeTurnId(payload);
  const hookEventName = getString(payload, "hook_event_name") ?? event;

  switch (hookEventName) {
    case "UserPromptSubmit":
    case "beforeSubmitPrompt":
      return {
        sessionId,
        turnId,
        platform: "claude",
        userPrompt: getString(payload, "prompt"),
      };

    case "Stop":
    case "stop":
      return {
        sessionId,
        turnId,
        platform: "claude",
        agentResponse: getString(payload, "response") ?? getString(payload, "text"),
      };

    case "PostToolUse":
    case "postToolUse": {
      const toolName = getString(payload, "tool_name") ?? getString(payload, "tool") ?? "";
      const toolInput = payload.tool_input as Record<string, unknown> | undefined;
      const filePath =
        (toolInput?.file_path as string) ??
        (toolInput?.filePath as string) ??
        "";

      const partial: Partial<TurnContext> = {
        sessionId,
        turnId,
        platform: "claude",
        toolsUsed: [{ name: toolName, input: toolInput }],
      };

      if (filePath && /edit|write/i.test(toolName)) {
        partial.fileEdits = [{ filePath }];
      }

      return partial;
    }

    case "SessionEnd":
    case "sessionEnd":
      return {
        sessionId,
        turnId,
        platform: "claude",
      };

    default:
      return null;
  }
}

export function normalizeHook(input: HookInput): Partial<TurnContext> | null {
  if (input.platform === "cursor") {
    return normalizeCursorHook(input.event, input.payload);
  }
  return normalizeClaudeHook(input.event, input.payload);
}

export function isGenerateEvent(platform: HookPlatform, event: HookEvent): boolean {
  if (platform === "cursor") {
    return event === "stop";
  }
  return event === "stop" || event === "sessionEnd";
}

export function isAccumulateEvent(platform: HookPlatform, event: HookEvent): boolean {
  const accumulateEvents: HookEvent[] = [
    "afterAgentResponse",
    "afterFileEdit",
    "beforeSubmitPrompt",
    "postToolUse",
  ];
  return accumulateEvents.includes(event);
}
