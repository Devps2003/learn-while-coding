# Deploy & Publish — Learn While Coding

Friends use **your Groq API key** via a hosted API. They never see or configure the key.

## Step 1: Deploy the API (5 min)

### A. Push to GitHub

```bash
cd /Users/devps/Desktop/ai-learning
git init
git add .
git commit -m "Learn While Coding v0.2.0 — hosted API"
# Create repo at github.com/new → learn-while-coding
git remote add origin https://github.com/YOUR_USERNAME/learn-while-coding.git
git branch -M main
git push -u origin main
```

### B. Deploy on Vercel (free)

1. Go to [vercel.com](https://vercel.com) → **Add New Project** → import your GitHub repo
2. **Environment Variables** (Production):
   - `GROQ_API_KEY` = your Groq key (from console.groq.com)
   - `LEARNWHILE_CLIENT_KEY` = `learnwhile-v1` (must match extension default)
3. Click **Deploy**
4. Copy your URL, e.g. `https://learn-while-coding-abc123.vercel.app`

### C. Update the API URL in the codebase

Replace `learn-while-coding-api.vercel.app` with your real Vercel URL in:

- `packages/core/src/constants.ts`
- `packages/core/src/types.ts` (DEFAULT_CONFIG.hostedApiUrl)

Then rebuild and commit:

```bash
cd packages/core && npx tsc -p tsconfig.json
cd ../hook-runner && npx tsc -p tsconfig.json
cd ../../extension && npm run build && npm run package
git add -A && git commit -m "Point to production API URL" && git push
```

### D. Test the API

```bash
curl -X POST https://YOUR-URL.vercel.app/api/tips \
  -H "Content-Type: application/json" \
  -H "X-LearnWhile-Client: learnwhile-v1" \
  -d '{"prompt":"User added React useMemo for list filtering","maxTips":2}'
```

You should get JSON with `tips` array.

---

## Step 2: Publish VS Code extension (sidebar UI)

1. Create publisher: https://marketplace.visualstudio.com/manage → **Create publisher** (e.g. `learnwhile`)
2. Create PAT: https://dev.azure.com → Personal Access Token → **Marketplace** → **Publish**
3. Publish:

```bash
cd extension
npx @vscode/vsce publish -p YOUR_AZURE_PAT
```

Friends install: **Extensions** → search **Learn While Coding**

Works in **Cursor** and **VS Code**.

---

## Step 3: Publish Cursor plugin (hooks)

1. Go to https://cursor.com/marketplace/publish
2. Submit your GitHub repo URL
3. Wait for Cursor review (open source, MIT license — you're good)

Friends install: Cursor → **Plugins** → search **learn-while-coding**

---

## Step 4: What friends do (no API key needed)

```bash
# 1. Install extension (from marketplace after you publish)
#    Cursor/VS Code → Extensions → "Learn While Coding"

# 2. Install Cursor plugin (from marketplace after you publish)
#    OR run hooks installer:
curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/learn-while-coding/main/scripts/install.sh | bash -s -- --cursor

# 3. Reload IDE
# 4. Open "Learn While Coding" sidebar
# 5. Start AI coding — tips appear automatically
```

Default config uses `provider: "hosted"` — no setup wizard, no API key.

---

## Cost & abuse protection

- **Your Groq bill** scales with friend usage (~1 cheap call per agent turn)
- `LEARNWHILE_CLIENT_KEY` blocks random bots (key is in the extension, not secret — good enough for friends beta)
- Groq free tier has rate limits; monitor at console.groq.com
- Optional: add Vercel rate limiting or upgrade Groq plan if many users

---

## Quick deploy script

```bash
./scripts/deploy-api.sh
```

Requires [Vercel CLI](https://vercel.com/cli): `npm i -g vercel`

---

## Checklist

- [ ] GitHub repo public
- [ ] Vercel deployed with `GROQ_API_KEY` + `LEARNWHILE_CLIENT_KEY`
- [ ] API URL updated in `constants.ts` and rebuilt
- [ ] VS Code extension published
- [ ] Cursor plugin submitted
- [ ] Tested end-to-end on a fresh machine (no local config)
