# Learn While Coding — Cursor Plugin

Hooks that observe AI agent sessions and generate learning tips after each turn.

## Requirements

- **Cursor** (Agent mode)
- **Learn While Coding** VS Code extension (sidebar UI) — install from Open VSX or VS Marketplace
- Node.js 20+

## Quick install

### Option A — Cursor Marketplace (recommended)

1. Open Cursor → **Customize** → search **learn-while-coding**
2. Install the plugin
3. Install the **Learn While Coding** extension (Extensions → search "Learn While Coding")
4. Reload Cursor
5. Open the **Learn While Coding** sidebar — cards appear after each Agent turn

### Option B — Extension auto-install

1. Install the **Learn While Coding** extension in Cursor
2. Run command palette → **Learn While Coding: Install Hooks**
3. Reload Cursor

### Option C — Manual

```bash
curl -fsSL https://raw.githubusercontent.com/Devps2003/learn-while-coding/main/scripts/install.sh | bash -s -- --cursor
```

## How it works

| Event | Purpose |
|-------|---------|
| `beforeSubmitPrompt` | Capture user prompt |
| `afterAgentResponse` | Capture assistant response |
| `afterFileEdit` | Capture file changes |
| `stop` | Generate learning tips via LLM |

Tips are written to `~/.learnwhile/sessions/<sessionId>/latest.json` and displayed in the extension sidebar.

## Configuration

No API key needed by default — uses the hosted API.

To use your own key, run **Learn While Coding: Setup API Key** or edit `~/.learnwhile/config.json`.

## Privacy

Session context is sent to the configured LLM provider. Secrets are redacted. All data stays in `~/.learnwhile/` on your machine.
