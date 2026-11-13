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
const POSTED_PATH = "telegram-posted.json";
const POSTED_LIMIT = 8000;

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
function clipPlain(text, max) {
  const t = (text || "").trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

function buildMeta(s) {
  return `Score: ${s.score ?? 0} · ${s.author ?? "?"}`;
}

function articleLink(s) {
  if (!s.url || typeof s.url !== "string") return null;
  try {
    const u = new URL(s.url);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.href;
  } catch {
    return null;
  }
}

// Returns { first, continuation } (at most one continuation message) with plain text, no formatting.
function buildStoryMessages(s, { captionMode }) {
  const linkLine = articleLink(s);
  const footer = [buildMeta(s), linkLine].filter(Boolean).join("\n");
  const title = clipPlain(s.title || "", 200);
  const label = (s.groq_label || "").trim();
  const summary = (s.groq_explain || "").trim();
  const limit = captionMode ? CAPTION_LIMIT : MESSAGE_LIMIT;

  const headerParts = [title];
  if (label) headerParts.push(clipPlain(label, 300));
  const header = headerParts.join("\n\n");

  const baseWithFooter = (body) => [header, body, footer].filter(Boolean).join("\n\n");

  let firstBody = "";
  let rest = "";
  if (summary) {
    const prefix = "Summary:\n";
    const room = limit - baseWithFooter(prefix).length;
    if (room > 40) {
      if (summary.length <= room) {
        firstBody = prefix + summary;
      } else {
        const cut = Math.max(0, room - 1);
        let split = summary.lastIndexOf("\n\n", cut);
        if (split < Math.floor(cut * 0.5)) split = summary.lastIndexOf("\n", cut);
        if (split < Math.floor(cut * 0.5)) split = summary.lastIndexOf(" ", cut);
        if (split < Math.floor(cut * 0.5)) split = cut;
        firstBody = prefix + summary.slice(0, split).trimEnd() + "…";
        rest = summary.slice(split).trimStart();
      }
    } else {
      rest = summary;
    }
  }

  let first = baseWithFooter(firstBody);
  if (first.length > limit) first = clipPlain(first, limit);

  let continuation = "";
  if (rest) {
    continuation = clipPlain(rest, MESSAGE_LIMIT);
  }

  return { first, continuation };
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

// Download an OG image ourselves (IPv4 + redirects) so it can be uploaded
// as a real file when Telegram rejects the raw URL.
function httpsGet(url, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "GET",
      family: 4,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; HNReader/1.0)",
        Accept: "image/*,*/*;q=0.8",
      },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error("too many redirects"));
        try { return resolve(httpsGet(new URL(res.headers.location, url).href, redirectsLeft - 1)); }
        catch (e) { return reject(e); }
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("timeout", () =>
      req.destroy(Object.assign(new Error("download timed out"), { code: "ETIMEDOUT" }))
    );
    req.on("error", reject);
    req.end();
  });
}

async function downloadImage(url) {
  try {
    const { headers, body } = await httpsGet(url);
    const mime = String(headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (!body.length || body.length > 9 * 1024 * 1024) return null;
    if (!mime.startsWith("image/") || mime === "image/svg+xml") return null;
    const ext =
      mime.includes("jpeg") ? ".jpg" :
      mime.includes("webp") ? ".webp" :
      mime.includes("gif") ? ".gif" : ".png";
    return { kind: "buffer", data: body, mime, name: `og${ext}` };
  } catch {
    return null;
  }
}

async function postStory(token, chatId, s) {
  let image = await loadImage(s);

  if (image?.kind === "url") {
    try {
      const { first, continuation } = buildStoryMessages(s, { captionMode: true });
      await tgCall(token, "sendPhoto", {
        chat_id: chatId, photo: image.value, caption: first,
      });
      if (continuation) {
        await tgCall(token, "sendMessage", {
          chat_id: chatId, text: continuation, disable_web_page_preview: true,
        });
      }
      return;
    } catch (err) {
      console.warn(`  ⚠ Photo URL rejected (${String(err.message).slice(0, 90)}) — downloading and re-uploading instead...`);
      image = await downloadImage(image.value);
    }
  }

  if (image?.kind === "buffer") {
    try {
      const { first, continuation } = buildStoryMessages(s, { captionMode: true });
      await tgCall(token, "sendPhoto",
        { chat_id: chatId, caption: first },
        { field: "photo", data: image.data, mime: image.mime, name: image.name });
      if (continuation) {
        await tgCall(token, "sendMessage", {
          chat_id: chatId, text: continuation, disable_web_page_preview: true,
        });
      }
      return;
    } catch {}
  }

  // No usable image at all — text message(s) with everything.
  const { first, continuation } = buildStoryMessages(s, { captionMode: false });
  await tgCall(token, "sendMessage", {
    chat_id: chatId,
    text: first,
    disable_web_page_preview: false,
  });
  if (continuation) {
    await tgCall(token, "sendMessage", {
      chat_id: chatId, text: continuation, disable_web_page_preview: true,
    });
  }
}

function normalizeUrl(url) {
  if (!url || typeof url !== "string") return "";
  try {
    const u = new URL(url.trim());
    u.hash = "";
    u.hostname = u.hostname.replace(/^www\./i, "").toLowerCase();
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.href;
  } catch {
    return url.trim();
  }
}

function loadPosted() {
  try {
    const raw = JSON.parse(fs.readFileSync(POSTED_PATH, "utf-8"));
    return {
      ids: new Set((raw.ids || []).map(Number).filter(Boolean)),
      urls: new Set((raw.urls || []).filter(Boolean).map(normalizeUrl)),
    };
  } catch {
    return { ids: new Set(), urls: new Set() };
  }
}

function savePosted(posted) {
  const ids = [...posted.ids].filter(Boolean).slice(-POSTED_LIMIT);
  const urls = [...posted.urls].filter(Boolean).slice(-POSTED_LIMIT);
  fs.writeFileSync(POSTED_PATH, JSON.stringify({ ids, urls }, null, 2) + "\n");
}

function alreadyPosted(posted, s) {
  if (s?.id && posted.ids.has(Number(s.id))) return "id";
  const url = normalizeUrl(s?.url);
  if (url && posted.urls.has(url)) return "url";
  return null;
}

function rememberPosted(posted, s) {
  if (s?.id) posted.ids.add(Number(s.id));
  const url = normalizeUrl(s?.url);
  if (url) posted.urls.add(url);
}

export function markQueuePosted(stories) {
  if (!stories?.length) return;
  const posted = loadPosted();
  const before = posted.ids.size + posted.urls.size;
  for (const s of stories) rememberPosted(posted, s);
  if (posted.ids.size + posted.urls.size !== before) savePosted(posted);
}

export async function notifyTelegram(stories, { force = false } = {}) {
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

  const posted = loadPosted();
  const fresh = [];
  for (const s of stories) {
    const reason = force ? null : alreadyPosted(posted, s);
    if (reason) {
      console.log(`  ↷ Skip Telegram (already posted ${reason}): ${s.title || s.id}`);
      continue;
    }
    fresh.push(s);
  }
  if (!fresh.length) {
    console.log("Telegram: all candidate stories were already posted.");
    return;
  }

  console.log(`Posting ${fresh.length} new story(ies) to Telegram...`);
  let dirty = false;
  for (const s of fresh) {
    try {
      await postStory(token, chatId, s);
      rememberPosted(posted, s);
      dirty = true;
      console.log(`  ✓ Posted to Telegram: ${s.title}`);
    } catch (err) {
      console.error(`  ✗ Telegram post failed for [${s.id}]: ${err.message}`);
    }
    await sleep(500);
  }
  if (dirty) savePosted(posted);
}
