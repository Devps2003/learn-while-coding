#!/usr/bin/env bash
# Learn While Coding — hook wrapper for Cursor and Claude Code
set -euo pipefail

PLATFORM="${LEARNWHILE_PLATFORM:-cursor}"
EVENT="${LEARNWHILE_EVENT:-stop}"

resolve_runner() {
  if command -v learnwhile-hook >/dev/null 2>&1; then
    echo "learnwhile-hook"
    return
  fi

  if [ -n "${LEARNWHILE_HOOK_RUNNER:-}" ] && [ -f "${LEARNWHILE_HOOK_RUNNER}" ]; then
    if [[ "${LEARNWHILE_HOOK_RUNNER}" == *.js ]]; then
      echo "node ${LEARNWHILE_HOOK_RUNNER}"
    else
      echo "${LEARNWHILE_HOOK_RUNNER}"
    fi
    return
  fi

  # Local dev fallback (repo checkout)
  local repo_runner="/Users/devps/Desktop/ai-learning/packages/hook-runner/dist/cli.js"
  if [ -f "${repo_runner}" ]; then
    echo "node ${repo_runner}"
    return
  fi

  echo "npx --yes @learnwhile/hook-runner@0.1.0"
}

RUNNER=$(resolve_runner)
# shellcheck disable=SC2086
exec ${RUNNER} --platform "${PLATFORM}" --event "${EVENT}"
