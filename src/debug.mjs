import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./browser.mjs";

/**
 * On a scrape failure, dumps everything useful for debugging:
 * screenshot, full DOM HTML, an accessibility (aria) snapshot, and the error.
 * Returns the directory the artifacts were written to.
 */
export async function captureFailure(page, { memberId, step, err }) {
  const dir = path.join(DATA_DIR, "_failures", memberId, new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(dir, { recursive: true });

  await page.screenshot({ path: path.join(dir, "screenshot.png"), fullPage: true }).catch(() => {});

  const html = await page.content().catch(() => null);
  if (html) fs.writeFileSync(path.join(dir, "dom.html"), html);

  const aria = await page.locator("body").ariaSnapshot().catch(() => null);
  if (aria) fs.writeFileSync(path.join(dir, "aria.yaml"), aria);

  fs.writeFileSync(
    path.join(dir, "error.txt"),
    `step: ${step}\nurl: ${page.url()}\n\n${err?.stack || err?.message || String(err)}`
  );

  return dir;
}
