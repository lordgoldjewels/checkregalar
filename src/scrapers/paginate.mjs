/**
 * Walks every page of a DataTables-driven table, accumulating rows via
 * extractFn(page) on each page, until the "Next" button is disabled.
 * Sets page length to 100 first to minimize the number of page turns needed.
 */
export async function scrapeAllPages(page, extractFn) {
  const lengthSelect = page.locator('select[name$="_length"]');
  if (await lengthSelect.count() > 0) {
    await lengthSelect.selectOption("100");
    await page.waitForTimeout(500);
  }

  const allRows = [];
  for (let guard = 0; guard < 500; guard++) {
    allRows.push(...(await extractFn(page)));

    const next = page.locator(".paginate_button.next");
    if ((await next.count()) === 0) break;
    const className = (await next.getAttribute("class")) ?? "";
    if (className.includes("disabled")) break;

    await next.locator("a").click();
    await page.waitForTimeout(500);
  }
  return allRows;
}
