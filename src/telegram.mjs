import fs from "fs";
import path from "path";
import https from "node:https";
import crypto from "node:crypto";
import { setDefaultResultOrder } from "node:dns";

// Some networks resolve api.telegram.org to an unreachable IPv6 address;
// prefer IPv4 so requests don't hang until timeout.
setDefaultResultOrder("ipv4first");

const TG_API = "https://api.telegram.org";
const CAPTION_LIMIT = 1024;
const MESSAGE_LIMIT = 4096;
const REQUEST_TIMEOUT_MS = 20000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hnItem = (id) => `https://news.ycombinator.com/item?id=${id}`;

// ── Transport (node:https instead of fetch — avoids undici happy-eyeballs hangs) ──
function singleRequest(token, method, fields, file) {
  return new Promise((resolve, reject) => {
    let payload, contentType;
    if (file) {
      const boundary = "----tgform" + crypto.randomBytes(16).toString("hex");
      const safeName = String(file.name).replace(/["\r\n]/g, "");
      const parts = [];
      for (const [k, v] of Object.entries(fields)) {
        parts.push(
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)
        );
      }
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${safeName}"\r\nContent-Type: ${file.mime}\r\n\r\n`
        )
      );
      parts.push(file.data);
      parts.push(Buffer.from("\r\n"));
      parts.push(Buffer.from(`--${boundary}--\r\n`));
      payload = Buffer.concat(parts);
      contentType = `multipart/form-data; boundary=${boundary}`;
    } else {
      payload = Buffer.from(JSON.stringify(fields));
      contentType = "application/json";
    }

    const req = https.request(
      `${TG_API}/bot${token}/${method}`,
      {
        method: "POST",
        family: 4,
        timeout: REQUEST_TIMEOUT_MS,
        headers: { "Content-Type": contentType, "Content-Length": payload.length },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new Error(`invalid response from Telegram (HTTP ${res.statusCode})`));
          }
        });
      }
    );
    req.on("timeout", () =>
      req.destroy(Object.assign(new Error(`request timed out (${REQUEST_TIMEOUT_MS}ms)`), { code: "ETIMEDOUT" }))
    );
    req.on("error", reject);
    req.end(payload);
  });
}

export async function tgCall(token, method, fields, file, attempt = 0) {
  let data;
  try {
    data = await singleRequest(token, method, fields, file);
  } catch (err) {
    if (attempt === 0) {
      await sleep(1000);
      return tgCall(token, method, fields, file, 1);
    }
    const cause = err.code || err.cause?.code || err.message;
    throw new Error(`Telegram ${method}: ${cause}`);
  }
  if (data.ok) return data.result;
  const retryAfter = data.parameters?.retry_after;
  if (retryAfter && attempt === 0) {
    await sleep(retryAfter * 1000);
    return tgCall(token, method, fields, file, 1);
  }
  throw new Error(`Telegram ${method}: ${data.description || JSON.stringify(data).slice(0, 200)}`);
}

// ── Message formatting ──
function escapeHtml(s = "") {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

// Clip after escaping so length is guaranteed; strips a dangling partial entity.
function safeClip(text, max) {
  let t = escapeHtml((text || "").trim());
  if (t.length > max) t = t.slice(0, Math.max(0, max - 1));
  t = t.replace(/&[a-z]*$/i, "").trimEnd();
  return t.length < (text || "").trim().length ? t + " …" : t;
}

function buildMeta(s) {
  const domain = getDomain(s.url);
  return (
    `▲ ${s.score ?? 0} · 💬 ${s.descendants ?? 0} · ${escapeHtml(s.author ?? "?")}` +
    (domain ? ` · ${domain}` : "")
  );
}

// One post per story: title, label, discussion recap and TL;DR all in the
// caption so the content visibly belongs to the post. Sections are shed in
// reverse priority (TL;DR → discussion → label → title) to fit the limit.
function buildCaption(s) {
  const footer = [buildMeta(s), `🟠 ${hnItem(s.id)}`].join("\n");

  const titleOf = (max) => `<b>${safeClip(s.title, max)}</b>`;
  const labelOf = (max) => {
    const l = safeClip(s.groq_label, max);
    return l ? `💡 ${l}` : null;
  };
  const discOf = (max) => {
    const d = safeClip(s.groq_discussion, max);
    return d && d !== "No comments." ? `💬 <b>Hacker News discussion</b>\n${d}` : null;
  };
  const explOf = (max) => {
    const e = safeClip(s.groq_explain, max);
    return e ? `📖 <b>TL;DR</b>\n${e}` : null;
  };

  const attempts = [
    [titleOf(130), labelOf(170), discOf(380), explOf(150)],
    [titleOf(130), labelOf(170), discOf(280), null],
    [titleOf(120), labelOf(140), discOf(180), null],
    [titleOf(100), null, discOf(110), null],
    [titleOf(80), null, null, null],
  ];
  for (const sections of attempts) {
    const cap = [...sections.filter(Boolean), footer].join("\n\n");
    if (cap.length <= CAPTION_LIMIT) return cap;
  }
  return clipMessage(`${titleOf(80)}\n\n${footer}`);
}

// Text-only fallback (no usable image): roomier budgets under the 4096 limit.
function buildTextMessage(s) {
  const d = safeClip(s.groq_discussion, 1800);
  const e = safeClip(s.groq_explain, 1100);
  const parts = [`<b>${safeClip(s.title, 160)}</b>`];
  const label = safeClip(s.groq_label, 300);
  if (label) parts.push(`💡 ${label}`);
  if (d && d !== "No comments.") parts.push(`💬 <b>Hacker News discussion</b>\n${d}`);
  if (e) parts.push(`📖 <b>TL;DR</b>\n${e}`);
  if (s.url) parts.push(`🔗 ${s.url}`);
  parts.push(buildMeta(s), `🟠 ${hnItem(s.id)}`);
  return clipMessage(parts.join("\n\n"));
}

function clipMessage(text) {
  if (text.length <= MESSAGE_LIMIT) return text;
  let t = text.slice(0, MESSAGE_LIMIT - 1);
  t = t.replace(/&[a-z]*$/i, "").replace(/<[^>]*$/, "").trimEnd();
  return t + " …";
}

// ── Posting ──
async function loadImage(s) {
  const img = s.og_image;
  if (!img || typeof img !== "string") return null;
  if (img.startsWith("images/")) {
    try {
      return {
        kind: "buffer",
        data: fs.readFileSync(img),
        mime: path.extname(img) === ".jpg" ? "image/jpeg" : "image/png",
        name: path.basename(img),
      };
    } catch { return null; }
  }
  if (/^https?:\/\//.test(img)) return { kind: "url", value: img };
  return null;
}

async function postStory(token, chatId, s) {
  const image = await loadImage(s);

  if (image?.kind === "url") {
    await tgCall(token, "sendPhoto", {
      chat_id: chatId, photo: image.value, caption: buildCaption(s), parse_mode: "HTML",
    });
  } else if (image?.kind === "buffer") {
    await tgCall(token, "sendPhoto",
      { chat_id: chatId, caption: buildCaption(s), parse_mode: "HTML" },
      { field: "photo", data: image.data, mime: image.mime, name: image.name });
  } else {
    await tgCall(token, "sendMessage", {
      chat_id: chatId, text: buildTextMessage(s), parse_mode: "HTML", disable_web_page_preview: true,
    });
  }
}

export async function notifyTelegram(stories) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("Telegram skipped (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set).");
    return;
  }
  if (!stories?.length) {
    console.log("Telegram: no new stories to post.");
    return;
  }
  console.log(`Posting ${stories.length} new story(ies) to Telegram...`);
  for (const s of stories) {
    try {
      await postStory(token, chatId, s);
      console.log(`  ✓ Posted to Telegram: ${s.title}`);
    } catch (err) {
      console.error(`  ✗ Telegram post failed for [${s.id}]: ${err.message}`);
    }
    await sleep(500);
  }
}
