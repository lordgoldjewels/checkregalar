import { BASE_URL } from "../browser.mjs";
import { scrapeAllPages } from "./paginate.mjs";

/**
 * Scrapes the "My Transaction -> DigiGold Buy History" table.
 * DataTables' responsive plugin visually hides the Gold Worth/Price on
 * Day/Order ID columns behind a "+" expander on narrow viewports, but the
 * <td> cells are always present in the main row (just display:none), so
 * no click-through is needed - same as Sales Incentive.
 * Returns an array of { buyDate, weightGm, goldWorth, priceOnDay, orderId }.
 */
export async function scrapeDigigoldBuy(page) {
  await page.goto(`${BASE_URL}/app/member/transaction/incomingdigi`);

  return scrapeAllPages(page, (p) =>
    p.locator("table tbody tr.odd, table tbody tr.even").evaluateAll((rows) =>
      rows
        .map((row) => {
          const cells = Array.from(row.querySelectorAll("td")).map((td) => td.textContent.trim());
          if (cells.length < 5) return null;
          const [buyDate, weightGm, goldWorth, priceOnDay, orderId] = cells;
          return { buyDate, weightGm, goldWorth, priceOnDay, orderId };
        })
        .filter(Boolean)
    )
  );
}
