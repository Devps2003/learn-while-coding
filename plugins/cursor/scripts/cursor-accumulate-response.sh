#!/usr/bin/env bash
export LEARNWHILE_PLATFORM=cursor
export LEARNWHILE_EVENT=afterAgentResponse
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LEARNWHILE_HOOK_RUNNER="${LEARNWHILE_HOOK_RUNNER:-${SCRIPT_DIR}/../../../packages/hook-runner/dist/cli.js}"
exec "${SCRIPT_DIR}/../../../scripts/hook.sh"
