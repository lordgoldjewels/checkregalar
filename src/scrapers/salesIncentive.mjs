import { BASE_URL } from "../browser.mjs";
import { scrapeAllPages } from "./paginate.mjs";

/**
 * Scrapes the "Sales Incentive" table (menu -> My Earning -> Sales Incentive),
 * walking every page so accounts with more than 100 entries aren't truncated.
 * Returns an array of { billDate, invoiceNo, fromDistributor, siValue, status, payVia }.
 */
export async function scrapeSalesIncentive(page) {
  await page.goto(`${BASE_URL}/app/member/earning/iccom`);

  return scrapeAllPages(page, (p) =>
    p.locator("table tbody tr").evaluateAll((rows) =>
      rows
        .map((row) => {
          const cells = Array.from(row.querySelectorAll("td")).map((td) => td.textContent.trim());
          if (cells.length < 6) return null;
          const [billDate, invoiceNo, fromDistributor, siValue, status, payVia] = cells;
          return { billDate, invoiceNo, fromDistributor, siValue, status, payVia };
        })
        .filter(Boolean)
    )
  );
}
