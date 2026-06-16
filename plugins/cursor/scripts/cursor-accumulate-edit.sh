#!/usr/bin/env bash
export LEARNWHILE_PLATFORM=cursor
export LEARNWHILE_EVENT=afterFileEdit
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/../../../scripts/hook.sh"
