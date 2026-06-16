#!/usr/bin/env bash
# Learn While Coding — one-command setup
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_CURSOR=false
INSTALL_CLAUDE=false

usage() {
  echo "Usage: $0 [--cursor] [--claude] [--all]"
  echo "  --cursor   Install Cursor hooks to ~/.cursor/hooks.json"
  echo "  --claude   Merge Claude hooks into ~/.claude/settings.json"
  echo "  --all      Install both (default if no flags)"
}

for arg in "$@"; do
  case "$arg" in
    --cursor) INSTALL_CURSOR=true ;;
    --claude) INSTALL_CLAUDE=true ;;
    --all) INSTALL_CURSOR=true; INSTALL_CLAUDE=true ;;
    -h|--help) usage; exit 0 ;;
  esac
done

if [ "$INSTALL_CURSOR" = false ] && [ "$INSTALL_CLAUDE" = false ]; then
  INSTALL_CURSOR=true
  INSTALL_CLAUDE=true
fi

echo "=== Learn While Coding Setup ==="
echo ""

# Build hook-runner if in repo
if [ -f "${REPO_ROOT}/packages/hook-runner/package.json" ]; then
  echo "Building packages..."
  if command -v pnpm >/dev/null 2>&1; then
    (cd "${REPO_ROOT}" && pnpm install && pnpm build)
    export LEARNWHILE_HOOK_RUNNER="${REPO_ROOT}/packages/hook-runner/dist/cli.js"
  elif command -v npm >/dev/null 2>&1; then
    (cd "${REPO_ROOT}/packages/core" && npm install && npm run build)
    (cd "${REPO_ROOT}/packages/hook-runner" && npm install && npm run build)
    export LEARNWHILE_HOOK_RUNNER="${REPO_ROOT}/packages/hook-runner/dist/cli.js"
  fi
fi

# Install hook-runner globally if not built locally
if [ -z "${LEARNWHILE_HOOK_RUNNER:-}" ] || [ ! -f "${LEARNWHILE_HOOK_RUNNER}" ]; then
  echo "Installing @learnwhile/hook-runner globally..."
  npm install -g @learnwhile/hook-runner@0.1.0 2>/dev/null || {
    echo "Note: npm global install failed. Hooks will use npx @learnwhile/hook-runner"
  }
fi

HOOK_SCRIPT="${REPO_ROOT}/scripts/hook.sh"
chmod +x "${HOOK_SCRIPT}" 2>/dev/null || true
chmod +x "${REPO_ROOT}"/plugins/cursor/scripts/*.sh 2>/dev/null || true

# Configure API key
CONFIG_DIR="${HOME}/.learnwhile"
CONFIG_FILE="${CONFIG_DIR}/config.json"
mkdir -p "${CONFIG_DIR}"

if [ ! -f "${CONFIG_FILE}" ]; then
  echo ""
  echo "Using hosted API (no API key needed for friends)."
  cat > "${CONFIG_FILE}" <<'EOF'
{
  "provider": "hosted",
  "apiKey": "",
  "model": "llama-3.3-70b-versatile",
  "maxTipsPerTurn": 3,
  "enabled": true,
  "showNotifications": true,
  "hostedApiUrl": "https://ai-learning-ten-rose.vercel.app/api/tips",
  "clientKey": "learnwhile-v1"
}
EOF
  echo "Config written to ${CONFIG_FILE}"
else
  echo "Config already exists at ${CONFIG_FILE}"
fi

# Cursor hooks
if [ "$INSTALL_CURSOR" = true ]; then
  CURSOR_HOOKS_DIR="${HOME}/.cursor/hooks"
  CURSOR_HOOKS_JSON="${HOME}/.cursor/hooks.json"
  mkdir -p "${CURSOR_HOOKS_DIR}"

  for script in cursor-accumulate cursor-accumulate-response cursor-accumulate-edit cursor-generate; do
    src="${REPO_ROOT}/plugins/cursor/scripts/${script}.sh"
    if [ -f "$src" ]; then
      cp "$src" "${CURSOR_HOOKS_DIR}/${script}.sh"
      chmod +x "${CURSOR_HOOKS_DIR}/${script}.sh"
      # Patch hook script to call repo hook.sh with hook-runner path
      patch_line="export LEARNWHILE_HOOK_RUNNER=\"${LEARNWHILE_HOOK_RUNNER:-${REPO_ROOT}/packages/hook-runner/dist/cli.js}\"\nexec \"${HOOK_SCRIPT}\""
      if sed --version 2>/dev/null | grep -q GNU; then
        sed -i.bak "s|exec \"\${SCRIPT_DIR}/../../../scripts/hook.sh\"|${patch_line}|" "${CURSOR_HOOKS_DIR}/${script}.sh" 2>/dev/null || true
      else
        perl -i.bak -pe "s|exec \"\\\$\{SCRIPT_DIR\}/../../../scripts/hook.sh\"|export LEARNWHILE_HOOK_RUNNER=\"${LEARNWHILE_HOOK_RUNNER:-${REPO_ROOT}/packages/hook-runner/dist/cli.js}\"\nexec \"${HOOK_SCRIPT}\"|" "${CURSOR_HOOKS_DIR}/${script}.sh" 2>/dev/null || \
        sed -i '' "s|exec \"\${SCRIPT_DIR}/../../../scripts/hook.sh\"|export LEARNWHILE_HOOK_RUNNER=\"${LEARNWHILE_HOOK_RUNNER:-${REPO_ROOT}/packages/hook-runner/dist/cli.js}\"\\
exec \"${HOOK_SCRIPT}\"|" "${CURSOR_HOOKS_DIR}/${script}.sh" 2>/dev/null || true
      fi
    fi
  done

  cat > "${CURSOR_HOOKS_JSON}" <<'HOOKEOF'
{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt": [{ "command": "./hooks/cursor-accumulate.sh", "matcher": "UserPromptSubmit" }],
    "afterAgentResponse": [{ "command": "./hooks/cursor-accumulate-response.sh" }],
    "afterFileEdit": [{ "command": "./hooks/cursor-accumulate-edit.sh" }],
    "stop": [{ "command": "./hooks/cursor-generate.sh" }]
  }
}
HOOKEOF
  echo "Cursor hooks installed to ${CURSOR_HOOKS_JSON}"
fi

# Claude hooks
if [ "$INSTALL_CLAUDE" = true ]; then
  CLAUDE_SETTINGS="${HOME}/.claude/settings.json"
  mkdir -p "${HOME}/.claude"

  HOOK_CMD="LEARNWHILE_HOOK_RUNNER=\"${LEARNWHILE_HOOK_RUNNER:-}\" ${HOOK_SCRIPT}"

  if [ -f "${CLAUDE_SETTINGS}" ]; then
    echo "Claude settings exist at ${CLAUDE_SETTINGS}"
    echo "Merge hooks manually from ${REPO_ROOT}/plugins/claude/settings.json"
    echo "Hook command: ${HOOK_CMD}"
  else
    cat > "${CLAUDE_SETTINGS}" <<EOF
{
  "hooks": {
    "UserPromptSubmit": [{ "type": "command", "command": "LEARNWHILE_PLATFORM=claude LEARNWHILE_EVENT=beforeSubmitPrompt ${HOOK_CMD}" }],
    "PostToolUse": [{ "type": "command", "matcher": "Edit|Write", "command": "LEARNWHILE_PLATFORM=claude LEARNWHILE_EVENT=postToolUse ${HOOK_CMD}" }],
    "Stop": [{ "type": "command", "command": "LEARNWHILE_PLATFORM=claude LEARNWHILE_EVENT=stop ${HOOK_CMD}" }]
  }
}
EOF
    echo "Claude hooks installed to ${CLAUDE_SETTINGS}"
  fi
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Install the VS Code extension: Learn While Coding (learnwhile.learn-while-coding)"
echo "  2. Open the 'Learn While Coding' sidebar in your activity bar"
echo "  3. For Cursor: install the plugin from marketplace or reload Cursor"
echo "  4. Start an AI coding session — tips appear after each agent turn"
echo ""
echo "Privacy: turn context is sent to YOUR LLM provider using YOUR API key."
echo "No telemetry is collected by default."
