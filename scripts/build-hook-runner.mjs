#!/usr/bin/env node
/**
 * Bundle @learnwhile/core + hook-runner CLI into a single ESM file.
 * Used by the Cursor plugin and VS Code extension hook installer.
 */
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const require = createRequire(join(root, "extension/package.json"));
const esbuild = require("esbuild");

const outputs = [
  join(root, "plugins/cursor/bin/hook-runner.mjs"),
  join(root, "extension/resources/hook-runner.mjs"),
];

for (const out of outputs) {
  await mkdir(dirname(out), { recursive: true });
}

const build = async (outfile) => {
  await esbuild.build({
    entryPoints: [join(root, "packages/hook-runner/src/cli.ts")],
    bundle: true,
    outfile,
    format: "esm",
    platform: "node",
    target: "node20",
    banner: { js: "#!/usr/bin/env node" },
    sourcemap: false,
    minify: false,
    external: [],
  });
  console.log(`Built ${outfile}`);
};

for (const out of outputs) {
  await build(out);
}

// Shell hook scripts for extension resources
const cursorHookScripts = {
  "cursor-accumulate.sh": { platform: "cursor", event: "beforeSubmitPrompt" },
  "cursor-accumulate-response.sh": { platform: "cursor", event: "afterAgentResponse" },
  "cursor-accumulate-edit.sh": { platform: "cursor", event: "afterFileEdit" },
  "cursor-generate.sh": { platform: "cursor", event: "stop" },
};

const claudeHookScripts = {
  "claude-prompt.sh": { platform: "claude", event: "beforeSubmitPrompt" },
  "claude-tool.sh": { platform: "claude", event: "postToolUse" },
  "claude-stop.sh": { platform: "claude", event: "stop" },
  "claude-session-end.sh": { platform: "claude", event: "sessionEnd" },
};

function shellScript(platform, event, runnerRef) {
  return `#!/usr/bin/env bash
set -euo pipefail
export LEARNWHILE_PLATFORM=${platform}
export LEARNWHILE_EVENT=${event}
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
exec node ${runnerRef} --platform "\${LEARNWHILE_PLATFORM}" --event "\${LEARNWHILE_EVENT}"
`;
}

const extHooksDir = join(root, "extension/resources/hooks");
await mkdir(extHooksDir, { recursive: true });

for (const [filename, meta] of Object.entries(cursorHookScripts)) {
  const content = shellScript(meta.platform, meta.event, '"${SCRIPT_DIR}/learnwhile-hook-runner.mjs"');
  const dest = join(extHooksDir, filename);
  await import("node:fs/promises").then((fs) => fs.writeFile(dest, content, { mode: 0o755 }));
  console.log(`Wrote ${dest}`);
}

for (const [filename, meta] of Object.entries(claudeHookScripts)) {
  const content = shellScript(meta.platform, meta.event, '"${SCRIPT_DIR}/learnwhile-hook-runner.mjs"');
  const dest = join(extHooksDir, filename);
  await import("node:fs/promises").then((fs) => fs.writeFile(dest, content, { mode: 0o755 }));
  console.log(`Wrote ${dest}`);
}

// Plugin scripts — node commands (cross-platform, no bash)
const pluginScriptsDir = join(root, "plugins/cursor/scripts");
const pluginRunner = '"${SCRIPT_DIR}/../bin/hook-runner.mjs"';
const cursorEvents = {
  "cursor-accumulate.sh": "beforeSubmitPrompt",
  "cursor-accumulate-response.sh": "afterAgentResponse",
  "cursor-accumulate-edit.sh": "afterFileEdit",
  "cursor-generate.sh": "stop",
};
for (const [filename, event] of Object.entries(cursorEvents)) {
  const content = `#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
exec node ${pluginRunner.replace("${SCRIPT_DIR}", "${SCRIPT_DIR}")} --platform cursor --event ${event}
`;
  const dest = join(pluginScriptsDir, filename);
  await import("node:fs/promises").then((fs) => fs.writeFile(dest, content, { mode: 0o755 }));
  console.log(`Wrote ${dest}`);
}
