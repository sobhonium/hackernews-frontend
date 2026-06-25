import "dotenv/config";
import sqlite3 from "sqlite3";
import { JSDOM, VirtualConsole } from "jsdom";
const vconsole = new VirtualConsole();
import { Readability } from "@mozilla/readability";
import Groq from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Mistral } from "@mistralai/mistralai";
import fs from "fs";
import {
  LABEL_SYSTEM,
  DISCUSSION_SYSTEM,
  EXPLAIN_SYSTEM,
} from "./prompt.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const mistral = process.env.MISTRAL_API_KEY ? new Mistral({ apiKey: process.env.MISTRAL_API_KEY }) : null;
const DB_PATH = "HN_data.db";
const JSON_PATH = "data.json";
const MAX_STORIES = 30;
const FETCH_N = 15;
const MAX_COMMENTS = 20;

// ── SQLite helpers (callback → promise) ──
function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      err ? reject(err) : resolve(this);
    });
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      err ? reject(err) : resolve(row);
    });
  });
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      err ? reject(err) : resolve(rows);
    });
  });
}

// ── Helpers ──
const _dom = new JSDOM("", { virtualConsole: vconsole });
function stripHtml(html) {
  const d = _dom.window.document.createElement("div");
  d.innerHTML = html;
  return d.textContent.replace(/\s+/g, " ").trim();
}

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function formatComments(texts) {
  return texts.map((t) => `— ${t.slice(0, 500)}`).join("\n");
}

// ── Fetch image from page (deep scan, direct fetch) ──
function findImageInDoc(doc, baseUrl) {
  const og = doc.querySelector('meta[property="og:image"], meta[name="og:image"]');
  if (og?.content) return new URL(og.content, baseUrl).href;
  const tw = doc.querySelector('meta[name="twitter:image"], meta[property="twitter:image"]');
  if (tw?.content) return new URL(tw.content, baseUrl).href;
  const imgs = doc.querySelectorAll("img[src]");
  for (const img of imgs) {
    const src = img.getAttribute("src");
    if (!src || src.endsWith(".svg") || src.includes("icon") || src.includes("logo")) continue;
    const w = parseInt(img.getAttribute("width") || "", 10) || 0;
    const h = parseInt(img.getAttribute("height") || "", 10) || 0;
    if ((w > 0 && w < 80) || (h > 0 && h < 80)) continue;
    try {
      const url = new URL(src, baseUrl).href;
      if (url.startsWith("http")) return url;
    } catch {}
  }
  return null;
}

function findFirstContentLink(doc, baseUrl) {
  const links = doc.querySelectorAll("a[href]");
  for (const a of links) {
    const href = a.getAttribute("href");
    if (!href || href === "/" || href.startsWith("#") || href.startsWith("javascript:")) continue;
    try {
      const url = new URL(href, baseUrl).href;
      if (!url.startsWith("http")) continue;
      const host = new URL(url).hostname;
      if (host === new URL(baseUrl).hostname && !url.includes("twitter.com") && !url.includes("facebook.com"))
        return url;
    } catch {}
  }
  return null;
}

async function fetchAndScanPage(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HNReader/1.0)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const dom = new JSDOM(html, { url, virtualConsole: vconsole });
    return dom.window.document;
  } catch { return null; }
}

async function fetchOgImage(url) {
  // 1) Microlink (fast, purpose-built)
  try {
    const res = await fetch(
      `https://api.microlink.io/?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(6000), headers: { Accept: "application/json" } }
    );
    if (res.ok) {
      const data = await res.json();
      const img = data?.data?.image?.url;
      if (img) return img;
    }
  } catch {}

  // 2) Direct fetch — no CORS proxy needed from Node.js
  const doc = await fetchAndScanPage(url);
  if (doc) {
    const img = findImageInDoc(doc, url);
    if (img) return img;

    // 3) Follow first internal link and scan that too
    const link = findFirstContentLink(doc, url);
    if (link) {
      const doc2 = await fetchAndScanPage(link);
      if (doc2) {
        const img2 = findImageInDoc(doc2, link);
        if (img2) return img2;
      }
    }
  }

  return null;
}

// ── AI image generation via pollinations.ai (free, no key) ──
async function generateImage(id, title, articleText) {
  const prompt = encodeURIComponent(
    `Magazine illustration: ${title}. ${articleText ? articleText.slice(0, 200) : "Modern technology concept"}`
  );
  const reqUrl = `https://image.pollinations.ai/prompt/${prompt}?width=1024&height=768&nologo=true`;
  try {
    const res = await fetch(reqUrl, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const dir = "images";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = `${dir}/${id}.png`;
    fs.writeFileSync(filePath, buffer);
    console.log(`  ✓ Generated image`);
    return filePath;
  } catch {
    return null;
  }
}

// ── Fetch article text ──
async function fetchArticleText(url) {
  const proxies = [
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ];
  for (const buildUrl of proxies) {
    try {
      const res = await fetch(buildUrl(url), { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const html = await res.text();
    const dom = new JSDOM(html, { url, virtualConsole: vconsole });
      const article = new Readability(dom.window.document).parse();
      const text = article?.textContent?.replace(/\s+/g, " ").trim().slice(0, 8000);
      if (text && text.length > 100) return text;
    } catch {}
  }
  return "";
}

// ── Fetch HN comments ──
async function fetchComments(kids) {
  if (!kids?.length) return [];
  const items = await Promise.all(
    kids.slice(0, MAX_COMMENTS).map((id) =>
      fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
        .then((r) => r.json()).catch(() => null)
    )
  );
  return items.filter((c) => c && !c.deleted).map((c) => stripHtml(c.text || ""));
}

// ── Multi-provider LLM call (falls through on failure) ──
async function llmCall(system, user) {
  for (const [name, fn] of [
    ["Groq",       () => tryGroq(system, user)],
    ["Gemini",     () => tryGemini(system, user)],
    ["Mistral",    () => tryMistral(system, user)],
    ["OpenRouter", () => tryOpenRouter(system, user)],
  ]) {
    const result = await fn();
    if (result !== null) return result;
    console.warn(`  ${name} failed, trying next provider...`);
  }
  console.error("  All LLM providers failed.");
  return null;
}

async function tryGroq(system, user) {
  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    return completion.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.error("  Groq error:", err.message);
    return null;
  }
}

async function tryGemini(system, user) {
  if (!genAI) return null;
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      systemInstruction: system,
    });
    const result = await model.generateContent(user);
    return result.response.text();
  } catch (err) {
    console.error("  Gemini error:", err.message);
    return null;
  }
}

async function tryMistral(system, user) {
  if (!mistral) return null;
  try {
    const result = await mistral.chat.complete({
      model: "mistral-small-latest",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    return result.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.error("  Mistral error:", err.message);
    return null;
  }
}

async function tryOpenRouter(system, user) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-lite-preview-02-05:free",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) { const t = await res.text(); throw new Error(`${res.status} ${t}`); }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.error("  OpenRouter error:", err.message);
    return null;
  }
}

async function generateLabel(title, articleText, commentTexts) {
  const a = articleText ? `Article:\n${articleText.slice(0, 3000)}\n\n` : "";
  const c = commentTexts.length ? `Comments:\n${formatComments(commentTexts).slice(0, 3000)}` : "";
  return await llmCall(
    LABEL_SYSTEM,
    `Title: ${title}\n\n${a}${c}`
  );
}

async function generateDiscussion(title, commentTexts) {
  if (!commentTexts.length) return "No comments.";
  return await llmCall(
    DISCUSSION_SYSTEM,
    `Title: ${title}\n\nComments:\n${formatComments(commentTexts).slice(0, 3000)}`
  );
}

async function generateExplain(title, articleText, commentTexts) {
  if (articleText && articleText.length > 100) {
    return await llmCall(
      EXPLAIN_SYSTEM,
      `Title: ${title}\n\nArticle:\n${articleText.slice(0, 3000)}`
    );
  }
  return null;
}

// ── Main ──
async function main() {
  console.log("Opening DB...");
  const db = new sqlite3.Database(DB_PATH);

  await dbRun(db, `CREATE TABLE IF NOT EXISTS HN_topstories(
    id INTEGER PRIMARY KEY,
    author TEXT,
    descendants INTEGER,
    kids TEXT,
    score INTEGER,
    time INTEGER,
    title TEXT,
    type TEXT,
    url TEXT,
    og_image TEXT,
    groq_label TEXT,
    groq_discussion TEXT,
    groq_explain TEXT
  )`);

  // Load existing queue from data.json
  let queue = [];
  try {
    const existing = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
    queue = (existing.stories || existing).filter(s => s && s.id);
  } catch { queue = []; }
  const existingIds = new Set(queue.map(s => s.id));
  console.log(`Loaded ${queue.length} existing stories.`);

  console.log("Fetching story IDs...");
  const ids = await fetch(
    "https://hacker-news.firebaseio.com/v0/topstories.json"
  ).then((r) => r.json());

  const selected = ids.slice(0, FETCH_N);

  for (const id of selected) {
    // Skip if already in queue
    if (existingIds.has(id)) {
      console.log(`[${id}] Already in queue, skipping fetch.`);
      continue;
    }

    console.log(`\n[${id}] Fetching story...`);
    const res = await fetch(
      `https://hacker-news.firebaseio.com/v0/item/${id}.json`
    );
    const story = await res.json();
    if (!story) { console.log(`  Skipping (no data)`); continue; }

    let ogImage = null;
    let articleText = "";
    let commentTexts = [];
    let label, discussion, explain;

    // Fetch OG image
    console.log(`  Fetching OG image...`);
    ogImage = story.url ? await fetchOgImage(story.url) : null;

    // Fetch article text + comments in parallel
    console.log(`  Fetching article + comments...`);
    [articleText, commentTexts] = await Promise.all([
      story.url ? fetchArticleText(story.url) : Promise.resolve(""),
      fetchComments(story.kids),
    ]);

    // Generate LLM fields
    console.log(`  Generating label...`);
    label = await generateLabel(story.title, articleText, commentTexts);

    console.log(`  Generating discussion...`);
    discussion = await generateDiscussion(story.title, commentTexts);

    console.log(`  Generating explain...`);
    explain = await generateExplain(story.title, articleText, commentTexts);

    // Generate AI image if no OG image found
    let finalImage = ogImage;
    if (!finalImage) {
      console.log(`  No OG image, generating AI image...`);
      finalImage = await generateImage(story.id, story.title, articleText);
      if (!finalImage) {
        finalImage = story.url
          ? `https://s0.wp.com/mshots/v1/${encodeURIComponent(story.url)}?w=800`
          : null;
      }
    }

    // Upsert
    await dbRun(db,
      `INSERT OR REPLACE INTO HN_topstories
        (id, author, descendants, kids, score, time, title, type, url, og_image, groq_label, groq_discussion, groq_explain)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        story.id, story.by, story.descendants,
        JSON.stringify(story.kids || []), story.score, story.time,
        story.title, story.type, story.url, finalImage,
        label, discussion, explain,
      ]
    );

    // Add to queue
    queue.push({
      id: story.id, author: story.by, descendants: story.descendants,
      kids: JSON.stringify(story.kids || []), score: story.score, time: story.time,
      title: story.title, type: story.type, url: story.url, og_image: finalImage,
      groq_label: label, groq_discussion: discussion, groq_explain: explain,
    });
    existingIds.add(story.id);
    console.log(`  ✓ Saved`);
  }

  // Trim queue to latest MAX_STORIES by time
  queue.sort((a, b) => (b.time || 0) - (a.time || 0));
  queue = queue.slice(0, MAX_STORIES);

  // Sync SQLite to match queue (delete old stories)
  const keepIds = queue.map(s => s.id);
  await dbRun(db, `DELETE FROM HN_topstories WHERE id NOT IN (${keepIds.join(",")})`);

  // Export to JSON
  console.log(`\nExporting to ${JSON_PATH}...`);
  const payload = {
    _meta: { lastUpdated: new Date().toISOString() },
    stories: queue,
  };
  fs.writeFileSync(JSON_PATH, JSON.stringify(payload, null, 2));
  console.log(`Exported ${queue.length} stories.`);

  db.close();
  console.log("Done.");
}

main().catch((err) => { console.error(err); process.exit(1); });
