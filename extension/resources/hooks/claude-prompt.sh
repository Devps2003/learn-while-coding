#!/usr/bin/env bash
set -euo pipefail
export LEARNWHILE_PLATFORM=claude
export LEARNWHILE_EVENT=beforeSubmitPrompt
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "${SCRIPT_DIR}/learnwhile-hook-runner.mjs" --platform "${LEARNWHILE_PLATFORM}" --event "${LEARNWHILE_EVENT}"
