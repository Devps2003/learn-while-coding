import { join } from "node:path";

export const RUNNER_NAME = "learnwhile-hook-runner.mjs";

/** Cross-platform hook command — works on Windows, macOS, Linux (no bash required). */
export function nodeHookCommand(
  hooksDir: string,
  platform: "cursor" | "claude",
  event: string
): string {
  const runner = join(hooksDir, RUNNER_NAME).replace(/\\/g, "/");
  return `node "${runner}" --platform ${platform} --event ${event}`;
}
