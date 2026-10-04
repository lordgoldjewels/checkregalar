import { BASE_URL } from "../browser.mjs";
import { parseAmount } from "../db.mjs";

/**
 * Scrapes the current DigiGold rate (₹ per gram, incl. 3% GST) from the
 * public DigiGold page - the hidden #txt_base_price the site's own buy form
 * converts rupees to grams with. Buys and sells both settle at this rate, so
 * grams x rate is what holdings are worth right now. Needs no login.
 */
export async function scrapeGoldRate(page) {
  await page.goto(`${BASE_URL}/app/digigold`);
  const raw = await page.locator("#txt_base_price").getAttribute("value", { timeout: 10000 });
  const rate = parseAmount(raw);
  if (!rate || rate <= 0) throw new Error(`unexpected gold rate: ${JSON.stringify(raw)}`);
  return rate;
}
