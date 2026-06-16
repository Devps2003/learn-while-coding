#!/usr/bin/env bash
export LEARNWHILE_PLATFORM=cursor
export LEARNWHILE_EVENT=afterAgentResponse
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/../../../scripts/hook.sh"
