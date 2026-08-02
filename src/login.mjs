import fs from "node:fs";
import path from "node:path";
import { launchContext, BASE_URL, AUTH_DIR } from "./browser.mjs";
import { dbEnabled, savePhoneSession } from "./db.mjs";

const phone = process.argv[2];
if (!phone) {
  console.error("Usage: node src/login.mjs <phone-number>");
  process.exit(1);
}
if (!dbEnabled) {
  console.error("Supabase not configured - set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

fs.mkdirSync(AUTH_DIR, { recursive: true });

const { browser, context } = await launchContext({ headless: false });
const page = await context.newPage();

page.on("console", (msg) => console.log(`  [console:${msg.type()}] ${msg.text()}`));
page.on("pageerror", (err) => console.log(`  [pageerror] ${err.message}`));
page.on("crash", () => console.log("  [page crashed]"));

async function dumpDebug(label) {
  const shotPath = path.join(AUTH_DIR, `${phone}-${label}.png`);
  try {
    await page.screenshot({ path: shotPath, fullPage: true });
    console.log(`  [debug] screenshot saved -> ${shotPath}`);
  } catch (e) {
    console.log(`  [debug] screenshot failed: ${e.message}`);
  }
  console.log(`  [debug] url: ${page.url()}`);
}

let resolveConfirm;
const confirmed = new Promise((resolve) => {
  resolveConfirm = resolve;
});

await page.exposeFunction("__loginConfirm", (success) => resolveConfirm(success));

// Re-injected automatically on every navigation (new document).
await page.addInitScript(() => {
  window.addEventListener("DOMContentLoaded", () => {
    const bar = document.createElement("div");
    bar.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:2147483647;display:flex;gap:8px;padding:8px;" +
      "background:#111;box-shadow:0 2px 6px rgba(0,0,0,.5);font-family:sans-serif;font-size:14px;";

    const label = document.createElement("span");
    label.textContent = "Once logged in, confirm below:";
    label.style.cssText = "color:#fff;align-self:center;margin-right:auto;";

    const okBtn = document.createElement("button");
    okBtn.textContent = "✅ Login Success";
    okBtn.style.cssText =
      "background:#16a34a;color:#fff;border:none;border-radius:4px;padding:6px 12px;cursor:pointer;font-weight:bold;";
    okBtn.onclick = () => window.__loginConfirm(true);

    const failBtn = document.createElement("button");
    failBtn.textContent = "❌ Failed / Cancel";
    failBtn.style.cssText =
      "background:#dc2626;color:#fff;border:none;border-radius:4px;padding:6px 12px;cursor:pointer;font-weight:bold;";
    failBtn.onclick = () => window.__loginConfirm(false);

    bar.append(label, okBtn, failBtn);
    document.body.appendChild(bar);
  });
});

try {
  await page.goto(`${BASE_URL}/app/member/dashboard`, { waitUntil: "load" });

  console.log(`\nA browser window has opened for phone ${phone}.`);
  console.log("Complete the login manually (phone + SMS OTP), then click the green");
  console.log('"Login Success" button in the bar at the top of the page.');
  console.log("Waiting for your confirmation (up to 10 minutes)...\n");

  const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), 10 * 60 * 1000));
  const result = await Promise.race([confirmed.then((ok) => (ok ? "success" : "failed")), timeout]);

  if (result !== "success") {
    console.error(`\nLogin not confirmed (${result}). No session saved.`);
    await dumpDebug(result);
    await browser.close();
    process.exit(1);
  }

  const storageState = await context.storageState();
  await savePhoneSession(phone, storageState);
  console.log(`\nSession saved for ${phone} -> Supabase phone_sessions`);

  await browser.close();
} catch (err) {
  console.error(`\nLogin script errored: ${err.stack || err.message}`);
  await dumpDebug("error");
  await browser.close();
  process.exit(1);
}
