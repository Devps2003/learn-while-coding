#!/usr/bin/env bash
# Learn While Coding — hook wrapper for Cursor and Claude Code
set -euo pipefail

PLATFORM="${LEARNWHILE_PLATFORM:-cursor}"
EVENT="${LEARNWHILE_EVENT:-stop}"

# Resolve hook-runner: prefer global/local install, then npx
if command -v learnwhile-hook >/dev/null 2>&1; then
  RUNNER="learnwhile-hook"
elif [ -n "${LEARNWHILE_HOOK_RUNNER:-}" ] && [ -x "${LEARNWHILE_HOOK_RUNNER}" ]; then
  RUNNER="${LEARNWHILE_HOOK_RUNNER}"
else
  RUNNER="npx --yes @learnwhile/hook-runner@0.1.0"
fi

exec ${RUNNER} --platform "${PLATFORM}" --event "${EVENT}"
