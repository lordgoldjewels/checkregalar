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
    // The modal opens instantly but its body (#summeryinfo) is filled by a
    // separate pickgapinfo POST, leaving the previous month's table in place
    // until then - clear it and wait for this click's own response, or the
    // previous month's breakdown gets read as this month's.
    await page.locator("#summeryinfo").evaluate((el) => (el.innerHTML = ""));
    // DataTables' responsive plugin clones each row's controls into a hidden
    // child-row template, so the same id can match a visible AND a hidden
    // element. Filter to the visible one rather than assuming DOM order.
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/earning/pickgapinfo"), { timeout: 30000 }),
      page.locator(`a.edititem[id="${row.editId}"]:visible`).click(),
    ]);
    await page.locator("#summeryinfo table tbody tr").first().waitFor({ timeout: 10000 });

    row.breakdown = await page.locator("#summeryinfo table tbody tr").evaluateAll((trs) =>
      trs.map((tr) => {
        const [fromDistributor, distributorId, tbpSalary] = Array.from(
          tr.querySelectorAll("td")
        ).map((td) => td.textContent.trim());
        return { fromDistributor, distributorId, tbpSalary };
      })
    );

    await closeModal(page);
  }

  return rows;
}

// A close click that lands while the modal is still opening is silently
// ignored, leaving it open to intercept the next row's click - so confirm
// it actually closed, and retry if not.
async function closeModal(page) {
  const modal = page.locator("#fullscreenModal");
  for (let attempt = 1; ; attempt++) {
    await modal.locator(".btn-close").click();
    try {
      await modal.waitFor({ state: "hidden", timeout: 3000 });
      await page.locator(".modal-backdrop").waitFor({ state: "detached", timeout: 3000 });
      return;
    } catch (err) {
      if (attempt >= 3) throw new Error(`turnover salary modal did not close: ${err.message}`);
    }
  }
}
