import fs from "node:fs";
import path from "node:path";
import { launchContext, DATA_DIR, BASE_URL } from "./browser.mjs";
import { switchToAccount } from "./changeProfile.mjs";
import { scrapeDashboard } from "./scrapers/dashboard.mjs";
import { scrapeSalesIncentive } from "./scrapers/salesIncentive.mjs";
import { scrapeTurnoverSalary } from "./scrapers/turnoverSalary.mjs";
import { captureFailure } from "./debug.mjs";
import {
  dbEnabled,
  getPhoneSession,
  listPhoneSessions,
  listAccountsForPhone,
  upsertAccount,
  insertDashboardSnapshot,
  upsertSalesIncentive,
  upsertTurnoverSalary,
  startScrapeRun,
  finishScrapeRun,
} from "./db.mjs";

if (!dbEnabled) {
  console.error("Supabase not configured - set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const headless = process.argv.includes("--headless");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

const phoneSessions = await listPhoneSessions();

for (const { phone_number: phone, status } of phoneSessions) {
  if (status !== "active") {
    console.log(`\n=== Phone ${phone} === skipped (status: ${status})`);
    continue;
  }

  const accounts = await listAccountsForPhone(phone);
  if (accounts.length === 0) {
    console.log(`\n=== Phone ${phone} === no accounts registered, skipping`);
    continue;
  }

  console.log(`\n=== Phone ${phone} ===`);
  const runId = await startScrapeRun(phone);
  let accountsScraped = 0;
  const runErrors = [];

  const { storage_state: storageState } = await getPhoneSession(phone);
  const { browser, context } = await launchContext({ headless, storageState });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/app/home`);
  await page.locator('a:has-text("Account")').last().click();
  await page.waitForLoadState("load");
  if (page.url().includes("/auth/login")) {
    console.error(`Session for ${phone} has expired. Re-run: npm run login -- ${phone}`);
    await browser.close();
    await finishScrapeRun(runId, { status: "session_expired", accountsScraped, errors: [{ error: "session expired" }] });
    continue;
  }

  for (const { memberId, name } of accounts) {
    console.log(`  -> ${memberId} (${name})`);
    let step = "switchToAccount";
    try {
      await switchToAccount(page, memberId);

      step = "scrapeDashboard";
      const dashboard = await scrapeDashboard(page);
      step = "scrapeSalesIncentive";
      const salesIncentive = await scrapeSalesIncentive(page);
      step = "scrapeTurnoverSalary";
      const turnoverSalary = await scrapeTurnoverSalary(page);

      const scrapedAt = new Date().toISOString();

      const outDir = path.join(DATA_DIR, memberId);
      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, `${timestamp}.json`);
      fs.writeFileSync(
        outFile,
        JSON.stringify({ memberId, name, phone, scrapedAt, dashboard, salesIncentive, turnoverSalary }, null, 2)
      );
      console.log(`     saved -> ${outFile}`);

      step = "db.upsertAccount";
      await upsertAccount({ memberId, name, phone });
      step = "db.insertDashboardSnapshot";
      await insertDashboardSnapshot(memberId, scrapedAt, dashboard);
      step = "db.upsertSalesIncentive";
      await upsertSalesIncentive(memberId, salesIncentive);
      step = "db.upsertTurnoverSalary";
      await upsertTurnoverSalary(memberId, turnoverSalary);
      console.log(`     synced to Supabase`);

      accountsScraped++;
    } catch (err) {
      console.error(`     failed for ${memberId} at ${step}:`, err.message);
      const debugDir = await captureFailure(page, { memberId, step, err });
      console.error(`     debug artifacts -> ${debugDir}`);
      runErrors.push({ memberId, step, error: err.message });
    }
  }

  await browser.close();
  await finishScrapeRun(runId, {
    status: runErrors.length === 0 ? "success" : "partial",
    accountsScraped,
    errors: runErrors.length ? runErrors : null,
  });
}
