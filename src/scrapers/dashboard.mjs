import { BASE_URL } from "../browser.mjs";

/**
 * Scrapes the "MY ..." stat cards on the member dashboard.
 * Returns a flat object keyed by a slugified label, e.g. { myBusiness, myEarning, ... }.
 */
export async function scrapeDashboard(page) {
  await page.goto(`${BASE_URL}/app/member/dashboard`);

  const cards = await page.locator("a:has(span):has(h4)").evaluateAll((els) =>
    els.map((el) => ({
      label: el.querySelector("span")?.textContent?.trim(),
      value: el.querySelector("h4")?.textContent?.trim(),
    }))
  );

  const result = {};
  for (const { label, value } of cards) {
    if (!label || !value) continue;
    const countMatch = label.match(/\((\d+)\/(\d+)\)/);
    const key = label
      .replace(/\(.*?\)/g, "")
      .trim()
      .replace(/^MY /i, "my")
      .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
      .replace(/^./, (c) => c.toLowerCase());
    result[key] = value;
    if (countMatch) {
      result[`${key}Count`] = { earned: Number(countMatch[1]), total: Number(countMatch[2]) };
    }
  }
  return result;
}
