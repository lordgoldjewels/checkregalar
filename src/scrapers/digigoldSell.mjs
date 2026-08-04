import { BASE_URL } from "../browser.mjs";
import { scrapeAllPages } from "./paginate.mjs";

/**
 * Scrapes the "My Transaction -> DigiGold Sell History" table. Same
 * always-in-DOM-just-hidden pattern as Buy History - no click-through needed.
 * Returns an array of { sellDate, weightGm, goldWorth, transactionRemarks, walletRemarks, status }.
 */
export async function scrapeDigigoldSell(page) {
  await page.goto(`${BASE_URL}/app/member/transaction/outgoingdigi`);

  return scrapeAllPages(page, (p) =>
    p.locator("table tbody tr.odd, table tbody tr.even").evaluateAll((rows) =>
      rows
        .map((row) => {
          const cells = Array.from(row.querySelectorAll("td")).map((td) => td.textContent.trim());
          if (cells.length < 6) return null;
          const [sellDate, weightGm, goldWorth, transactionRemarks, walletRemarks, status] = cells;
          return { sellDate, weightGm, goldWorth, transactionRemarks, walletRemarks, status };
        })
        .filter(Boolean)
    )
  );
}
