import fs from "node:fs";
import path from "node:path";
import { launchContext, DATA_DIR, BASE_URL } from "./browser.mjs";
import { switchToAccount } from "./changeProfile.mjs";
import { scrapeDashboard } from "./scrapers/dashboard.mjs";
import { scrapeSalesIncentive } from "./scrapers/salesIncentive.mjs";
import { scrapeTurnoverSalary } from "./scrapers/turnoverSalary.mjs";
import { scrapePromotionalIncentive } from "./scrapers/promotionalIncentive.mjs";
import { scrapeDigigoldBuy } from "./scrapers/digigoldBuy.mjs";
import { scrapeDigigoldSell } from "./scrapers/digigoldSell.mjs";
import { captureFailure } from "./debug.mjs";
import {
  dbEnabled,
  getPhoneSession,
  listPhoneSessions,
  listAccountsForPhone,
  upsertAccount,
  upsertDashboardSnapshot,
  upsertSalesIncentive,
  upsertTurnoverSalary,
  upsertPromotionalIncentivePins,
  upsertDigigoldBuy,
  upsertDigigoldSell,
  startScrapeRun,
  finishScrapeRun,
  getNotificationSettings,
} from "./db.mjs";
import { notify, notifyPhoto } from "./telegram.mjs";

if (!dbEnabled) {
  console.error("Supabase not configured - set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

// Fetched before the crash handler below so a fatal crash can still respect
// the scrape_crashed toggle; a fetch failure falls back to all-enabled.
const notificationSettings = await getNotificationSettings().catch(() => ({
  sales_incentive: true, turnover_salary: true, promotional_incentive: true,
  digigold_buy: true, digigold_sell: true,
  scrape_crashed: true, failed_to_load_home: true, session_expired: true,
  account_scrape_failure: true, partial_run_summary: true,
}));

// Safety net: alert on any crash the per-account try/catch didn't already
// handle (e.g. a Supabase outage, a bug in the loop itself).
for (const event of ["uncaughtException", "unhandledRejection"]) {
  process.on(event, async (err) => {
    console.error(`\nFatal ${event}:`, err);
    if (notificationSettings.scrape_crashed) {
      await notify(`🔴 <b>Scrape run crashed</b> (${event})\n<code>${String(err?.message || err)}</code>`);
    }
    process.exit(1);
  });
}

const headless = process.argv.includes("--headless");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

let hadFailure = false;

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
  const earningUpdates = [];
  const digigoldUpdates = [];

  const { storage_state: storageState } = await getPhoneSession(phone);
  const { browser, context } = await launchContext({ headless, storageState });
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/app/home`, { timeout: 60000 });
    await page.locator('a:has-text("Account")').last().click();
    await page.waitForLoadState("load");
  } catch (err) {
    console.error(`     failed to open home for ${phone}:`, err.message);
    const debugDir = await captureFailure(page, { memberId: `_nav_${phone}`, step: "goto_home", err });
    await browser.close();
    await finishScrapeRun(runId, { status: "error", accountsScraped, errors: [{ error: err.message }] });
    if (notificationSettings.failed_to_load_home) {
      await notifyPhoto(
        path.join(debugDir, "screenshot.png"),
        `🔴 <b>Scrape failed to load home</b> for ${phone}\n${err.message}`
      );
    }
    hadFailure = true;
    continue;
  }
  if (page.url().includes("/auth/login")) {
    // The "Account" tab click can briefly flash /auth/login while the app's
    // router re-validates the session cookie async, then bounces back once
    // it confirms the session is still valid - so a single URL read right
    // after the click is prone to false positives. Give it a moment to
    // settle and re-check before concluding the session is really expired.
    await page.waitForTimeout(2000);
  }
  if (page.url().includes("/auth/login")) {
    console.error(`Session for ${phone} has expired. Re-run: npm run login -- ${phone}`);
    const debugDir = await captureFailure(page, {
      memberId: `_session_${phone}`,
      step: "session_expired",
      err: new Error("session expired"),
    });
    await browser.close();
    await finishScrapeRun(runId, { status: "session_expired", accountsScraped, errors: [{ error: "session expired" }] });
    if (notificationSettings.session_expired) {
      await notifyPhoto(
        path.join(debugDir, "screenshot.png"),
        `🔴 <b>Session expired</b> for ${phone} - run <code>npm run login -- ${phone}</code> to re-authenticate.`
      );
    }
    hadFailure = true;
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
      step = "scrapePromotionalIncentive";
      const promotionalIncentive = await scrapePromotionalIncentive(page);
      step = "scrapeDigigoldBuy";
      const digigoldBuy = await scrapeDigigoldBuy(page);
      step = "scrapeDigigoldSell";
      const digigoldSell = await scrapeDigigoldSell(page);

      const scrapedAt = new Date().toISOString();

      const outDir = path.join(DATA_DIR, memberId);
      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, `${timestamp}.json`);
      fs.writeFileSync(
        outFile,
        JSON.stringify(
          { memberId, name, phone, scrapedAt, dashboard, salesIncentive, turnoverSalary, promotionalIncentive, digigoldBuy, digigoldSell },
          null,
          2
        )
      );
      console.log(`     saved -> ${outFile}`);

      step = "db.upsertAccount";
      await upsertAccount({ memberId, name, phone });
      step = "db.upsertDashboardSnapshot";
      await upsertDashboardSnapshot(memberId, scrapedAt, dashboard);
      step = "db.upsertSalesIncentive";
      const newInvoices = await upsertSalesIncentive(memberId, salesIncentive);
      step = "db.upsertTurnoverSalary";
      const salaryChanges = await upsertTurnoverSalary(memberId, turnoverSalary);
      step = "db.upsertPromotionalIncentivePins";
      const pinChanges = await upsertPromotionalIncentivePins(memberId, promotionalIncentive);
      step = "db.upsertDigigoldBuy";
      const newDigigoldBuys = await upsertDigigoldBuy(memberId, digigoldBuy);
      step = "db.upsertDigigoldSell";
      const digigoldSellChanges = await upsertDigigoldSell(memberId, digigoldSell);
      console.log(`     synced to Supabase`);

      if (newInvoices.length > 0 || salaryChanges.length > 0 || pinChanges.length > 0) {
        earningUpdates.push({ memberId, name, invoiceChanges: newInvoices, salaryChanges, pinChanges });
      }
      if (newDigigoldBuys.length > 0 || digigoldSellChanges.length > 0) {
        digigoldUpdates.push({ memberId, name, buys: newDigigoldBuys, sells: digigoldSellChanges });
      }

      accountsScraped++;
    } catch (err) {
      console.error(`     failed for ${memberId} at ${step}:`, err.message);
      const debugDir = await captureFailure(page, { memberId, step, err });
      console.error(`     debug artifacts -> ${debugDir}`);
      runErrors.push({ memberId, step, error: err.message });
      if (notificationSettings.account_scrape_failure) {
        await notifyPhoto(
          path.join(debugDir, "screenshot.png"),
          `🟠 <b>Scrape failed</b> for ${memberId} (${phone}) at <code>${step}</code>\n${err.message}`
        );
      }
    }
  }

  await browser.close();
  await finishScrapeRun(runId, {
    status: runErrors.length === 0 ? "success" : "partial",
    accountsScraped,
    errors: runErrors.length ? runErrors : null,
  });

  if (runErrors.length > 0) {
    hadFailure = true;
    if (notificationSettings.partial_run_summary) {
      const lines = runErrors.map((e) => `  - ${e.memberId} at ${e.step}: ${e.error}`).join("\n");
      await notify(
        `🟠 <b>Scrape partially failed</b> for ${phone}\n` +
          `${accountsScraped}/${accounts.length} accounts succeeded.\n\n${lines}`
      );
    }
  }

  if (earningUpdates.length > 0) {
    const lines = earningUpdates.flatMap(({ memberId, name, invoiceChanges, salaryChanges, pinChanges }) => [
      ...(notificationSettings.sales_incentive
        ? invoiceChanges.map((inv) =>
            inv.isNew
              ? `  ${name} (${memberId}): new Sales Incentive invoice ${inv.invoice_no} - ₹${inv.si_value} (${inv.bill_date}, ${inv.status})`
              : `  ${name} (${memberId}): Sales Incentive invoice ${inv.invoice_no} status ${inv.previousStatus} -> ${inv.status} (₹${inv.si_value})`
          )
        : []),
      ...(notificationSettings.turnover_salary
        ? salaryChanges.map((c) =>
            c.isNew
              ? `  ${name} (${memberId}): new Turnover Salary for ${c.month} - ₹${c.current}`
              : `  ${name} (${memberId}): Turnover Salary for ${c.month} increased ₹${c.previous} -> ₹${c.current}`
          )
        : []),
      ...(notificationSettings.promotional_incentive
        ? pinChanges.map((p) =>
            p.isNew
              ? `  ${name} (${memberId}): new Promotional Incentive pin ${p.code} - ₹${p.amount} (${p.dated}, ${p.status})`
              : p.status === "closed"
              ? `  ${name} (${memberId}): Promotional Incentive pin ${p.code} REDEEMED - ₹${p.amount} (${p.dated})`
              : `  ${name} (${memberId}): Promotional Incentive pin ${p.code} status ${p.previousStatus} -> ${p.status} (₹${p.amount})`
          )
        : []),
    ]);
    if (lines.length > 0) {
      await notify(`🟢 <b>New earnings detected</b> for ${phone}\n${lines.join("\n")}`);
    }
  }

  if (digigoldUpdates.length > 0) {
    const lines = digigoldUpdates.flatMap(({ memberId, name, buys, sells }) => [
      ...(notificationSettings.digigold_buy
        ? buys.map(
            (b) => `  ${name} (${memberId}): bought ${b.weight_gm}gm DigiGold - ₹${b.gold_worth} (${b.buy_date}, order ${b.order_id})`
          )
        : []),
      ...(notificationSettings.digigold_sell
        ? sells.map((s) =>
            s.isNew
              ? `  ${name} (${memberId}): sold ${s.weight_gm}gm DigiGold - ₹${s.gold_worth} (${s.sell_date}, ${s.status})`
              : `  ${name} (${memberId}): DigiGold sale ${s.transaction_remarks} status ${s.previousStatus} -> ${s.status}`
          )
        : []),
    ]);
    if (lines.length > 0) {
      await notify(`🟡 <b>DigiGold transaction</b> for ${phone}\n${lines.join("\n")}`);
    }
  }
}

if (hadFailure) {
  console.error("\nScrape run finished with failures - exiting non-zero.");
  process.exit(1);
}
