#!/usr/bin/env bash
# Deploy hosted API to Vercel (your Groq key stays on the server)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

if ! command -v vercel >/dev/null 2>&1; then
  echo "Install Vercel CLI: npm i -g vercel"
  exit 1
fi

echo "=== Deploy Learn While Coding API to Vercel ==="
echo ""
echo "You will be prompted to set environment variables if not already set:"
echo "  GROQ_API_KEYS         — comma-separated Groq keys (429 rotates to next)"
echo "  LEARNWHILE_CLIENT_KEY — learnwhile-v1 (blocks random abuse)"
echo ""

vercel --prod

echo ""
echo "=== Next steps ==="
echo "1. Copy your Vercel URL (e.g. https://xxx.vercel.app)"
echo "2. Update packages/core/src/constants.ts → DEFAULT_HOSTED_API_URL"
echo "3. Update packages/core/src/types.ts → DEFAULT_CONFIG.hostedApiUrl"
echo "4. Rebuild: cd packages/core && npx tsc && cd ../hook-runner && npx tsc"
echo "5. Republish extension: cd extension && npm run package"
echo "6. See DEPLOY.md for marketplace publish steps"
