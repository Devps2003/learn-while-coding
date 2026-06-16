#!/usr/bin/env bash
# Symlink target: repo scripts/hook.sh
# When installed globally, copy this file and set LEARNWHILE_HOOK_RUNNER to your hook-runner path
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/../../../scripts/hook.sh"
