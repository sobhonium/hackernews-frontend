# HackerNews Reader

A self-updating reader that fetches top Hacker News stories, reads the linked page/article content, and pre-generates LLM summaries. Runs entirely on static files — no live API calls from the browser.

## How it works

1. A GitHub Action runs `src/update.mjs` on a schedule (every 10 minutes).
2. It fetches the latest stories from the HN API, extracts the linked page/article text, and generates a short label plus a summary via a multi-provider fallback chain (Groq → Gemini → Mistral → OpenRouter).
3. Images are sourced from page metadata (OG tags), direct page scans, or AI generation (pollinations.ai) as a last resort.
4. Stories accumulate in a rolling queue of the 30 most recent. Older entries are pruned automatically.
5. The generated `data.json` and `images/` are committed back to the repo.
6. GitHub Pages serves the static site — zero server or runtime cost.

## Features

- Magazine-style masonry layout with CSS columns
- Dark theme with geometric background and per-card accent colors
- Featured hero card with gradient overlay
- Inline expand for the page/content summary
- AI-generated images when no page image is found
- Slack notifications on new data
- Telegram channel posts: each story goes out as a single post with its image, short label, and summary

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
node src/update.mjs
node src/server.js
```

Open http://localhost:3000 in a browser.

### GitHub Pages

1. Push to `main`.
2. Enable Pages at repo → Settings → Pages → `main` / `(root)`.
3. Add API keys as repo secrets: `GROQ_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`.
4. (Optional) Add `SLACK_WEBHOOK_URL` for Slack notifications on updates.
5. (Optional) Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to post each new story to a Telegram channel — with image, label, discussion recap, and TL;DR. The bot must be an admin of the channel. Works locally too if the same keys are in `.env`.

The workflow runs automatically every 10 minutes. Trigger manually from Actions → Update HN data → Run workflow.

## Project structure

```
├── index.html           Entry point (root for GH Pages)
├── styles.css           Magazine-style CSS
├── hackernews.js        Frontend rendering logic
├── src/
│   ├── update.mjs       Data pipeline (HN → LLM → images → SQLite → JSON)
│   ├── telegram.mjs     Telegram channel posting (photo + content per story)
│   ├── prompt.js        LLM system prompts
│   └── server.js        Local dev server on port 3000
├── data.json            Generated story data (committed)
├── images/              Generated AI images (committed)
├── bg.jpg               Page background
├── bg_card.png          Card background
└── .github/workflows/   CI/CD workflow
```

## LLM providers

The pipeline tries providers in order. Each story generates:

- **Label** — A one-line summary of the page/article
- **Summary** — A clear summary of the page/article content

## License

MIT
