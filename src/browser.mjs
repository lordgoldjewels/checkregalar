import { chromium, devices } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AUTH_DIR = path.join(__dirname, "..", "auth");
export const DATA_DIR = path.join(__dirname, "..", "data");

export const BASE_URL = "https://lordicl.com";

// Keep Galaxy Tab S9's UA/touch/DPR characteristics but use an iPad-like
// 1024x768 viewport instead of its real 640x1024 (which, plus browser
// chrome, ran taller than the screen and pushed the bottom tab bar out of view).
export const DEVICE = {
  ...devices["Galaxy Tab S9"],
  viewport: { width: 1024, height: 768 },
};

export async function launchContext({ headless, storageState, devtools = false } = {}) {
  // devtools:true auto-opens the real Chrome DevTools panel (Network,
  // Application/cookies with actual expiry, Console) alongside the page,
  // for full manual inspection on top of whatever the script does.
  // Chromium forces headless:false whenever devtools is requested.
  const browser = await chromium.launch({ headless, devtools });
  const context = await browser.newContext({
    ...DEVICE,
    storageState,
  });
  return { browser, context };
}
