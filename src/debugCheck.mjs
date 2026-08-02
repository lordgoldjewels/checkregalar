import { launchContext, BASE_URL } from "./browser.mjs";
import { getPhoneSession } from "./db.mjs";

const phone = process.argv[2];
const devtools = process.argv.includes("--devtools");

const { storage_state: storageState } = await getPhoneSession(phone);
const { browser, context } = await launchContext({
  headless: false,
  storageState,
  devtools,
});
const page = await context.newPage();

await page.goto(`${BASE_URL}/app`);
await page.waitForTimeout(1500);

const accountLink = page.locator('a:has-text("Account")').last();
await accountLink.click();
await page.waitForTimeout(2000);

console.log("URL after clicking Account:", page.url());
console.log("Body text snippet:", (await page.locator("body").innerText()).slice(0, 300));

if (devtools) {
  console.log("\nDevTools is open — check Application > Cookies > https://lordicl.com for real expiry values.");
  console.log("Browser will stay open for 5 minutes for inspection.");
  await page.waitForTimeout(5 * 60 * 1000);
} else {
  await page.waitForTimeout(60000);
}
await browser.close();
