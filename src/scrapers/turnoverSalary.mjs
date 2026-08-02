import { BASE_URL } from "../browser.mjs";
import { scrapeAllPages } from "./paginate.mjs";

/**
 * Scrapes the "Turnover-based Salary" table (menu -> My Earning -> Turnover-based Salary),
 * walking every page, including the per-distributor breakdown behind each row's info modal.
 * Returns an array of { month, noOfPackets, totalTbSalary, charges, netTotal, breakdown }.
 */
export async function scrapeTurnoverSalary(page) {
  await page.goto(`${BASE_URL}/app/member/earning/levelincome`);

  const rows = await scrapeAllPages(page, (p) =>
    p.locator("table tbody tr").evaluateAll((trs) =>
      trs
        .map((row) => {
          const cells = Array.from(row.querySelectorAll("td"));
          if (cells.length < 6) return null;
          const [month, noOfPackets, totalTbSalary, charges, netTotal] = cells.map((td) =>
            td.textContent.trim()
          );
          const editBtn = row.querySelector("a.edititem");
          return { month, noOfPackets, totalTbSalary, charges, netTotal, editId: editBtn?.id || null };
        })
        .filter(Boolean)
    )
  );

  for (const row of rows) {
    if (!row.editId) {
      row.breakdown = [];
      continue;
    }
    // DataTables' responsive plugin clones each row's controls into a hidden
    // child-row template, so the same id can match a visible AND a hidden
    // element. Filter to the visible one rather than assuming DOM order.
    await page.locator(`a.edititem[id="${row.editId}"]:visible`).click();
    await page.locator("#fullscreenModal table tbody tr").first().waitFor({ timeout: 10000 });

    row.breakdown = await page.locator("#fullscreenModal table tbody tr").evaluateAll((trs) =>
      trs.map((tr) => {
        const [fromDistributor, distributorId, tbpSalary] = Array.from(
          tr.querySelectorAll("td")
        ).map((td) => td.textContent.trim());
        return { fromDistributor, distributorId, tbpSalary };
      })
    );

    await page.locator("#fullscreenModal .btn-close").click();
    await page.waitForTimeout(300);
  }

  return rows;
}
