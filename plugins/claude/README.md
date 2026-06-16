# Learn While Coding — Claude Code Plugin

Hooks for Claude Code CLI and VS Code extension.

## Install

### Option A: Merge into `~/.claude/settings.json`

Copy the `hooks` section from `settings.json` in this directory into your global Claude settings. Update the `command` paths to point to your installed `hook.sh`.

### Option B: Project-level

Copy `settings.json` hooks into `.claude/settings.json` in your project and ensure `scripts/hook.sh` is available.

### Option C: Install script

Run from repo root:

```bash
./scripts/install.sh --claude
```

## Requirements

- Node.js 20+
- `@learnwhile/hook-runner` (`npm i -g @learnwhile/hook-runner`)
- Learn While Coding VS Code extension (sidebar UI)
- API key in `~/.learnwhile/config.json`

## Hooks

| Event | Purpose |
|-------|---------|
| `UserPromptSubmit` | Capture user prompt |
| `PostToolUse` (Edit/Write) | Capture file edits |
| `Stop` | Generate learning tips |
| `SessionEnd` | Optional session cleanup |
