#!/usr/bin/env bash
# Publish all Learn While Coding artifacts (requires credentials)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

echo "=== Building ==="
npm install typescript@5.7.2 --save-dev 2>/dev/null || true
(cd packages/core && npm install && npx tsc -p tsconfig.json)
(cd packages/hook-runner && npm install file:../core && npx tsc -p tsconfig.json)
(cd extension && npm install && npm run build && npx @vscode/vsce package --no-dependencies)

echo ""
echo "=== npm packages ==="
echo "To publish @learnwhile/core and @learnwhile/hook-runner:"
echo "  cd packages/core && npm publish --access public"
echo "  cd packages/hook-runner && npm publish --access public"
echo ""

echo "=== VS Code Marketplace ==="
echo "  cd extension && npx @vscode/vsce publish -p <VSCE_PAT>"
echo "  VSIX ready: extension/learn-while-coding-extension-0.1.0.vsix"
echo ""

echo "=== Cursor Marketplace ==="
echo "  Push to GitHub, then submit: https://cursor.com/marketplace/publish"
echo "  Repo must include .cursor-plugin/marketplace.json"
echo ""

echo "=== Open VSX (optional) ==="
echo "  npx ovsx publish extension/learn-while-coding-extension-0.1.0.vsix -p <OVSX_TOKEN>"
echo ""

echo "Build complete. See PUBLISH.md for full checklist."
