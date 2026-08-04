import { BASE_URL } from "../browser.mjs";

/**
 * Scrapes the "Redeem My Earning -> Promotional Incentive" pins page.
 * All pins (across every incentive scheme/category the account has) are
 * rendered client-side in one page load and filtered with CSS classes
 * (active/closed/pending), not paginated - so a single evaluate() gets
 * everything.
 * Returns an array of { code, category, dated, amount, status }.
 */
export async function scrapePromotionalIncentive(page) {
  await page.goto(`${BASE_URL}/app/member/userportal/cbcpins`);
  await page.locator(".element-item").first().waitFor({ timeout: 10000 }).catch(() => {});

  return page.locator(".element-item").evaluateAll((items) =>
    items.map((el) => ({
      code: el.querySelector("h4")?.textContent.trim(),
      category: el.dataset.category,
      dated: el.querySelector('span[style*="float:right"]')?.textContent.replace("Dated : ", "").trim(),
      amount: el.querySelector(".card-footer strong")?.textContent.replace("Promotional Incentive", "").trim(),
      status: [...el.classList].find((c) => ["active", "closed", "pending"].includes(c)) || null,
    }))
  );
}
