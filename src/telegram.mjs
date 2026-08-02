import "dotenv/config";

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
