import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

export const telegramEnabled = Boolean(botToken && chatId);

export async function notify(message) {
  if (!telegramEnabled) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" }),
    });
    if (!res.ok) {
      console.error(`Telegram notify failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error(`Telegram notify errored: ${err.message}`);
  }
}

// Screenshots only live on the (often ephemeral, e.g. CI) runner's disk, so
// on failure we ship the image itself through Telegram rather than just a path.
export async function notifyPhoto(filePath, caption) {
  if (!telegramEnabled) return;
  try {
    const buffer = fs.readFileSync(filePath);
    const form = new FormData();
    form.append("chat_id", chatId);
    if (caption) form.append("caption", caption.slice(0, 1024));
    form.append("parse_mode", "HTML");
    form.append("photo", new Blob([buffer], { type: "image/png" }), path.basename(filePath));

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      console.error(`Telegram notifyPhoto failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error(`Telegram notifyPhoto errored: ${err.message}`);
  }
}
