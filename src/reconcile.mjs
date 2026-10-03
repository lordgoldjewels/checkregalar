import { launchContext, BASE_URL } from "./browser.mjs";
import { switchToAccount, assertActiveAccount } from "./changeProfile.mjs";
import { scrapeSalesIncentive } from "./scrapers/salesIncentive.mjs";
import { scrapePromotionalIncentive } from "./scrapers/promotionalIncentive.mjs";
import { scrapeDigigoldBuy } from "./scrapers/digigoldBuy.mjs";
import { scrapeDigigoldSell } from "./scrapers/digigoldSell.mjs";
import {
  dbEnabled,
  supabase,
  getPhoneSession,
  listPhoneSessions,
  listAccountsForPhone,
  sellKey,
  toDigigoldSellRecords,
} from "./db.mjs";

/**
 * One-off cleanup for rows saved under the wrong account (switchToAccount
 * used to skip switching when a downline was active and its upline was
 * next - see changeProfile.mjs). The live site is the source of truth: any
 * DB row for an account whose key isn't on that account's history page
 * gets reported, and deleted with --apply.
 *
 *   node src/reconcile.mjs            # dry run
 *   node src/reconcile.mjs --apply    # delete the reported rows
 */

if (!dbEnabled) {
  console.error("Supabase not configured - set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const apply = process.argv.includes("--apply");
const headless = process.argv.includes("--headless");

const TABLES = [
  {
    table: "digigold_buy_transactions",
    scrape: scrapeDigigoldBuy,
    select: "id, order_id, buy_date, gold_worth",
    liveKeys: (_, rows) => rows.map((r) => r.orderId),
    dbKey: (r) => r.order_id,
  },
  {
    table: "digigold_sell_transactions",
    scrape: scrapeDigigoldSell,
    select: "id, sell_date, weight_gm, gold_worth, occurrence, status",
    liveKeys: (accountId, rows) => toDigigoldSellRecords(accountId, rows).map(sellKey),
    dbKey: sellKey,
  },
  {
    table: "sales_incentive",
    scrape: scrapeSalesIncentive,
    select: "id, invoice_no, bill_date, si_value",
    liveKeys: (_, rows) => rows.map((r) => r.invoiceNo),
    dbKey: (r) => r.invoice_no,
  },
  {
    table: "promotional_incentive_pins",
    scrape: scrapePromotionalIncentive,
    select: "id, code, dated, amount",
    liveKeys: (_, rows) => rows.map((r) => r.code),
    dbKey: (r) => r.code,
  },
];

const toDelete = new Map(TABLES.map(({ table }) => [table, []]));
let hadFailure = false;

for (const { phone_number: phone, status } of await listPhoneSessions()) {
  if (status !== "active") continue;
  const accounts = await listAccountsForPhone(phone);
  if (accounts.length === 0) continue;

  console.log(`\n=== Phone ${phone} ===`);
  const { storage_state: storageState } = await getPhoneSession(phone);
  const { browser, context } = await launchContext({ headless, storageState });
  const page = await context.newPage();

  try {
    // Visiting home first is what attaches the active profile to the session.
    await page.goto(`${BASE_URL}/app/home`, { timeout: 60000 });
    await page.locator('a:has-text("Account")').last().click();
    await page.waitForLoadState("load");

    for (const { memberId, name } of accounts) {
      console.log(`  -> ${memberId} (${name})`);
      try {
        await switchToAccount(page, memberId);
        const live = [];
        for (const t of TABLES) live.push(await t.scrape(page));
        await assertActiveAccount(page, memberId);

        for (const [i, t] of TABLES.entries()) {
          // An empty scrape could be a page that failed to render - never
          // treat it as "this account owns nothing".
          if (live[i].length === 0) {
            console.log(`     ${t.table}: 0 live rows, skipped`);
            continue;
          }
          const liveKeys = new Set(t.liveKeys(memberId, live[i]));
          const { data, error } = await supabase.from(t.table).select(t.select).eq("account_id", memberId);
          if (error) throw new Error(`${t.table} fetch: ${error.message}`);
          const stray = data.filter((r) => !liveKeys.has(t.dbKey(r)));
          console.log(`     ${t.table}: live ${live[i].length}, db ${data.length}, not on site ${stray.length}`);
          for (const r of stray) console.log(`       - ${JSON.stringify(r)}`);
          toDelete.get(t.table).push(...stray.map((r) => r.id));
        }
      } catch (err) {
        console.error(`     failed for ${memberId}: ${err.message}`);
        hadFailure = true;
      }
    }
  } finally {
    await browser.close();
  }
}

const total = [...toDelete.values()].reduce((n, ids) => n + ids.length, 0);
console.log(`\n${total} row(s) not found on the site.`);

if (!apply) {
  console.log("Dry run - nothing deleted. Re-run with --apply to delete them.");
} else {
  for (const [table, ids] of toDelete) {
    if (ids.length === 0) continue;
    const { error } = await supabase.from(table).delete().in("id", ids);
    if (error) {
      console.error(`delete from ${table} failed: ${error.message}`);
      hadFailure = true;
    } else {
      console.log(`Deleted ${ids.length} row(s) from ${table}.`);
    }
  }
}

if (hadFailure) process.exit(1);
