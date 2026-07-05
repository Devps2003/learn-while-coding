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

// Shell hook scripts for extension resources (installed to ~/.cursor/hooks/)
const hookScripts = {
  "cursor-accumulate.sh": "beforeSubmitPrompt",
  "cursor-accumulate-response.sh": "afterAgentResponse",
  "cursor-accumulate-edit.sh": "afterFileEdit",
  "cursor-generate.sh": "stop",
};

const extHooksDir = join(root, "extension/resources/hooks");
await mkdir(extHooksDir, { recursive: true });

for (const [filename, event] of Object.entries(hookScripts)) {
  const content = `#!/usr/bin/env bash
set -euo pipefail
export LEARNWHILE_PLATFORM=cursor
export LEARNWHILE_EVENT=${event}
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
exec node "\${SCRIPT_DIR}/learnwhile-hook-runner.mjs" --platform "\${LEARNWHILE_PLATFORM}" --event "\${LEARNWHILE_EVENT}"
`;
  const dest = join(extHooksDir, filename);
  await import("node:fs/promises").then((fs) => fs.writeFile(dest, content, { mode: 0o755 }));
  console.log(`Wrote ${dest}`);
}

// Plugin scripts (installed from Cursor marketplace — paths relative to plugin dir)
const pluginScriptsDir = join(root, "plugins/cursor/scripts");
for (const [filename, event] of Object.entries(hookScripts)) {
  const content = `#!/usr/bin/env bash
set -euo pipefail
export LEARNWHILE_PLATFORM=cursor
export LEARNWHILE_EVENT=${event}
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
exec node "\${SCRIPT_DIR}/../bin/hook-runner.mjs" --platform "\${LEARNWHILE_PLATFORM}" --event "\${LEARNWHILE_EVENT}"
`;
  const dest = join(pluginScriptsDir, filename);
  await import("node:fs/promises").then((fs) => fs.writeFile(dest, content, { mode: 0o755 }));
  console.log(`Wrote ${dest}`);
}
