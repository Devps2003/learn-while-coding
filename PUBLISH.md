# Publishing Guide

## npm packages

Publish `@learnwhile/core` and `@learnwhile/hook-runner`:

```bash
cd packages/core
npm login
npm publish --access public

cd ../hook-runner
npm publish --access public
```

Ensure versions in `package.json` match before publishing.

## VS Code Marketplace

1. Create publisher at https://marketplace.visualstudio.com/manage
2. Generate PAT with Marketplace publish scope
3. Package extension:

```bash
cd extension
pnpm install
pnpm run package
```

4. Publish:

```bash
npx @vscode/vsce publish -p <YOUR_PAT>
```

5. Open VSX (optional):

```bash
npx ovsx publish learn-while-coding-0.1.0.vsix -p <OPEN_VSX_TOKEN>
```

## Cursor Marketplace (separate from Open VSX)

**Important:** `ovsx publish` only puts the VS Code **extension** on Open VSX.  
The **Cursor plugin** (hooks) is a different product and must be submitted separately.

1. Push repo to public GitHub (must include `.cursor-plugin/marketplace.json`)
2. Ensure `plugins/cursor/.cursor-plugin/plugin.json` and bundled `plugins/cursor/bin/hook-runner.mjs` are committed
3. Submit at https://cursor.com/marketplace/publish
4. Wait for manual Cursor team review (typically a few days, not automatic)
5. Checklist:
   - Open source (MIT)
   - Valid kebab-case plugin name: `learn-while-coding`
   - Logo at `plugins/cursor/assets/logo.svg`
   - README with setup instructions
   - Hooks tested locally via `~/.cursor/plugins/local`

Friends install after approval: Cursor → **Customize** → search **learn-while-coding**

Until the plugin is approved, users can run **Learn While Coding: Install Hooks** from the extension (auto-installs hooks on Cursor).

- Document install via `scripts/install.sh --claude`
- Users merge `plugins/claude/settings.json` hooks into `~/.claude/settings.json`
- Future: publish as Claude plugin when registry is available

## Version bumps

When releasing, bump versions in:
- `packages/core/package.json`
- `packages/hook-runner/package.json`
- `extension/package.json`
- `plugins/cursor/.cursor-plugin/plugin.json`
