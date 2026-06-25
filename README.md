# HackerNews Frontend

A self-updating HackerNews reader that pre-commits LLM-powered summaries, discussions, and explanations for each story. Runs entirely on static files — no live API calls from the browser.

## How it works

1. A GitHub Action runs `update.mjs` on a schedule (every 10 minutes).
2. It fetches the latest stories from the HN API, extracts article text, pulls top comments, and generates three LLM fields per story via a multi-provider fallback chain (Groq → Gemini → Mistral → OpenRouter).
3. Images are sourced from page metadata (OG tags), direct page scans, or AI generation (pollinations.ai) as a last resort.
4. Stories accumulate in a rolling queue of the 30 most recent. Older entries are pruned automatically.
5. The generated `data.json` and `images/` are committed back to the repo.
6. GitHub Pages serves the static site — zero server or runtime cost.

## Features

- Magazine-style masonry layout with CSS columns
- Dark theme with geometric background and per-card accent colors
- Featured hero card with gradient overlay
- Inline expand for Discussion and Explain per story
- AI-generated images when no page image is found
- Slack notifications on new data

## Setup

### Prerequisites

- Node.js 20+
- A GitHub repository with Pages enabled
- API keys for at least one LLM provider (Groq recommended)

### Local development

```bash
git clone <repo>
cd hackernews-frontend

# Create .env with your API keys
echo 'GROQ_API_KEY=your_key' >> .env
echo 'GEMINI_API_KEY=your_key' >> .env
echo 'MISTRAL_API_KEY=your_key' >> .env
echo 'OPENROUTER_API_KEY=your_key' >> .env

npm install
node update.mjs
node server.js
```

Open http://localhost:3000 in a browser.

### GitHub Pages

1. Push to `main`.
2. Enable Pages at repo → Settings → Pages → `main` / `(root)`.
3. Add API keys as repo secrets: `GROQ_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`.
4. (Optional) Add `SLACK_WEBHOOK_URL` for Slack notifications on updates.

The workflow runs automatically every 10 minutes. Trigger manually from Actions → Update HN data → Run workflow.

## Project structure

```
├── index.html           Entry point
├── styles.css           Magazine-style CSS
├── hackernews.js        Frontend rendering logic
├── update.mjs           Data pipeline (HN → LLM → images → SQLite → JSON)
├── server.js            Local dev server on port 3000
├── data.json            Generated story data (committed)
├── images/              Generated AI images (committed)
├── bg.jpg               Page background
├── bg_card.png          Card background
└── .github/workflows/   CI/CD workflow
```

## LLM providers

The pipeline tries providers in order. Each story generates three fields:

- **Label** — A one-line summary of what makes the story interesting
- **Discussion** — What commenters are actually saying
- **Explain** — A plain-language explanation of the post's core idea

## License

MIT
