import "dotenv/config";
import fs from "fs";
import { tgCall } from "./telegram.mjs";

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pickTestImage() {
  try {
    const f = fs.readdirSync("images").find((x) => /\.(png|jpe?g)$/i.test(x));
    if (f) return { data: fs.readFileSync(`images/${f}`), name: f };
  } catch {}
  return {
    data: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    ),
    name: "test.png",
  };
}

if (!token || !chatId) {
  console.error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (in .env or inline).");
  process.exit(1);
}

let botId, channelId;

try {
  const me = await tgCall(token, "getMe", {});
  botId = me.id;
  console.log(`1) getMe OK — @${me.username}`);
} catch (e) {
  console.error(`1) getMe FAILED: ${e.message}\n   → Token is invalid. Revoke via @BotFather and use the new one.`);
  process.exit(1);
}

try {
  const wh = await tgCall(token, "getWebhookInfo", {});
  if (wh.url) {
    console.error(`2) WEBHOOK CONFLICT — a webhook is set on this bot (${wh.url}).\n   → getUpdates will always fail while it's active.\n   → Fix: open ${`https://api.telegram.org/bot${token}/deleteWebhook`} in a browser.`);
  } else {
    console.log("2) No webhook set — getUpdates is usable.");
  }
} catch (e) {
  console.log(`2) getWebhookInfo failed: ${e.message}`);
}

try {
  const ch = await tgCall(token, "getChat", { chat_id: chatId });
  channelId = ch.id;
  console.log(`3) Channel OK — "${ch.title}" (id ${ch.id})`);
  if (!ch.linked_chat_id) {
    console.error(`   → NO DISCUSSION GROUP LINKED.\n   → Fix: channel → Manage → Discussions → Link group.`);
  } else {
    console.log(`   → Linked discussion group id: ${ch.linked_chat_id}`);
    try {
      const g = await tgCall(token, "getChat", { chat_id: ch.linked_chat_id });
      console.log(`4) Discussion group OK — "${g.title}" (${g.type}, id ${g.id})`);
      if (g.type === "group") {
        console.warn("   ⚠ This is a BASIC group. Telegram only links SUPERgroups as discussion groups — check that linking actually succeeded.");
      }
      try {
        const m = await tgCall(token, "getChatMember", { chat_id: ch.linked_chat_id, user_id: botId });
        console.log(`5) Bot membership in group: status = ${m.status}`);
        if (!["administrator", "member"].includes(m.status)) {
          console.error("   → Bot is NOT in the group. Add it and make it admin.");
        } else if (m.status === "member") {
          console.warn("   ⚠ Bot is a plain member. Make it ADMIN so privacy mode can't hide the auto-forwarded posts.");
        }
      } catch (e) {
        console.error(`5) Could not check bot membership in group: ${e.message}`);
      }
    } catch (e) {
      console.error(`4) Cannot read linked group: ${e.message}`);
    }
  }
} catch (e) {
  console.error(`3) getChat FAILED for ${chatId}: ${e.message}\n   → Is the bot an admin of the channel?`);
  process.exit(1);
}

console.log("\n--- Live comment test ---");
let postId;
try {
  const img = pickTestImage();
  const sent = await tgCall(token, "sendPhoto",
    { chat_id: chatId, caption: "<b>diagnostic test post</b> — safe to ignore", parse_mode: "HTML" },
    { field: "photo", data: img.data, mime: "image/png", name: img.name });
  postId = sent.message_id;
  console.log(`A) Test photo posted to channel (message_id ${postId})`);
} catch (e) {
  console.error(`A) sendPhoto FAILED: ${e.message}`);
  process.exit(1);
}

console.log("B) Polling getUpdates for up to 12s to catch the auto-forward...");
let fwdId = null;
let sawAny = false;
const deadline = Date.now() + 12000;
let offset = 0;
while (Date.now() < deadline && !fwdId) {
  let updates;
  try {
    updates = await tgCall(token, "getUpdates", { offset, timeout: 0, allowed_updates: ["message", "channel_post"] });
  } catch (e) {
    console.error(`B) getUpdates FAILED: ${e.message}`);
    break;
  }
  if (!Array.isArray(updates)) break;
  for (const u of updates) {
    if (typeof u?.update_id === "number" && u.update_id >= offset) offset = u.update_id + 1;
    const m = u.message || u.channel_post;
    if (!m) continue;
    sawAny = true;
    const originId = m.forward_origin?.type === "channel" ? m.forward_origin.message_id : undefined;
    console.log(`   update: type=${u.message ? "message" : "channel_post"} msg_id=${m.message_id} auto_fwd=${!!m.is_automatic_forward} origin_msg=${originId ?? m.forward_from_message_id ?? "-"}`);
    if (originId === postId || m.forward_from_message_id === postId) fwdId = m.message_id;
  }
  if (!updates.length) await sleep(800);
}

if (!fwdId) {
  console.error(sawAny
    ? `C) Updates arrived but NONE matched the test post → the auto-forward never reached the bot.\n   → Confirm the group really IS the linked discussion group of THIS channel, and the bot is admin IN THE GROUP.`
    : `C) getUpdates returned NOTHING at all.\n   → If you saw a webhook warning above, delete the webhook first; otherwise re-add the bot to the group as admin.`);
} else {
  console.log(`C) Auto-forward found (group message_id ${fwdId}) — sending comment reply...`);
  try {
    const linked = (await tgCall(token, "getChat", { chat_id: chatId })).linked_chat_id;
    await tgCall(token, "sendMessage", {
      chat_id: linked,
      text: "✅ diagnostic comment — if you can read this under the test post, comments work!",
      reply_to_message_id: fwdId,
    });
    console.log("D) COMMENT SENT SUCCESSFULLY. Check the channel post — it should show a comment now.");
  } catch (e) {
    console.error(`D) Comment send FAILED: ${e.message}`);
  }
}

console.log("\nCleaning up test messages (best effort)...");
try {
  if (postId) await tgCall(token, "deleteMessage", { chat_id: chatId, message_id: postId });
  if (fwdId) {
    const linked = (await tgCall(token, "getChat", { chat_id: chatId })).linked_chat_id;
    await tgCall(token, "deleteMessage", { chat_id: linked, message_id: fwdId });
  }
  console.log("Cleanup done.");
} catch (e) {
  console.log(`Cleanup skipped: ${e.message}`);
}
