import "dotenv/config";
import Groq from "groq-sdk";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

async function summarize(text) {
  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: "Summarize in 2 or 3 sentences." },
      { role: "user", content: text },
    ],
  });
  return completion.choices[0].message.content;
}

async function extractArticle(url) {
  try {
    const html = await fetch(url, { signal: AbortSignal.timeout(10000) }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    });
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    return article?.textContent?.slice(0, 15000) || "";
  } catch (err) {
    console.error(`Failed to extract ${url}: ${err.message}`);
    return "";
  }
}

async function main() {
  const response = await fetch(
    "https://hacker-news.firebaseio.com/v0/topstories.json"
  );
  const storyIds = await response.json();
  const selectedIds = storyIds.slice(0, 100);
  const id = selectedIds[10];
  const story = await fetch(
    `https://hacker-news.firebaseio.com/v0/item/${id}.json`
  ).then((r) => r.json());

  console.log(`\nTitle: ${story.title}\n`);

  if (!story.url) {
    console.log("No URL to summarize.");
    return;
  }

  const articleText = await extractArticle(story.url);
  if (!articleText) {
    console.log("Could not extract article.");
    return;
  }

  const summary = await summarize(articleText);
  console.log("Summary:");
  console.log(summary);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
