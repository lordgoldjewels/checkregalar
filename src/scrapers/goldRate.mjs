import { BASE_URL } from "../browser.mjs";
import { parseAmount } from "../db.mjs";

/**
 * Scrapes the current gold rate (₹ per gram, excl. GST) from the home page's
 * "Today's Market Price" block - the GOLD product card, not the Silver one
 * next to it. The DigiGold page shows the same rate plus 3% GST
 * (#txt_base_price); this stores the rate without GST. Needs no login.
 */
export async function scrapeGoldRate(page) {
  // The price is in the server-rendered HTML; the full "load" event can take
  // 30s+ on this page (images, translate widget), so don't wait for it.
  await page.goto(`${BASE_URL}/app/home`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const goldTitle = page.locator("a.product-title").filter({ hasText: /^\s*GOLD\s*$/i });
  const raw = await goldTitle.locator("xpath=..").locator(".sale-price").innerText({ timeout: 30000 });
  // "₹. 13,675.00/gm" -> 13675
  const rate = parseAmount(raw.replace(/\/\s*gm/i, ""));
  if (!rate || rate <= 0) throw new Error(`unexpected gold rate: ${JSON.stringify(raw)}`);
  return rate;
}
