#!/usr/bin/env bash
# One-liner for friends — no API key needed
set -euo pipefail
REPO="${LEARNWHILE_REPO:-https://github.com/YOUR_USERNAME/learn-while-coding}"
curl -fsSL "${REPO}/raw/main/scripts/install.sh" | bash -s -- --cursor
echo ""
echo "Install the extension from VS Marketplace: Learn While Coding"
echo "Or: cursor --install-extension learnwhile.learn-while-coding"
echo "Reload Cursor and open the Learn While Coding sidebar."
