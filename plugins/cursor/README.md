# Learn While Coding — Cursor Plugin

Hooks that observe AI agent sessions and generate learning tips.

## Requirements

- Node.js 20+
- [Learn While Coding VS Code extension](https://marketplace.visualstudio.com/items?itemName=learnwhile.learn-while-coding) (sidebar UI)
- API key configured at `~/.learnwhile/config.json`

## Setup

1. Install the VS Code extension in Cursor
2. Run `../../scripts/install.sh` from the repo root, or install hooks globally:

```bash
npm install -g @learnwhile/hook-runner
```

3. Configure your API key:

```bash
learnwhile-hook --help  # or use install.sh
```

4. Install this plugin from the Cursor Marketplace or copy to `~/.cursor/plugins/`

## Hooks

| Event | Purpose |
|-------|---------|
| `beforeSubmitPrompt` | Capture user prompt |
| `afterAgentResponse` | Capture assistant response |
| `afterFileEdit` | Capture file changes |
| `stop` | Generate learning tips via LLM |

Tips are written to `~/.learnwhile/sessions/<sessionId>/latest.json` and displayed in the sidebar.
