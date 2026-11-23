// API-based scrape (replaces the Playwright scrape.mjs for the mapped entities).
// Flow: per active phone -> load stored bearer token -> list linked accounts ->
// for each account: /me/switch (adopt the rotated token) -> fetch the mapped
// entities -> upsert via the EXISTING db.mjs -> diff -> Telegram. Persists the
// latest token so the next run resumes without OTP.
//
// Mapped: dashboard, sales incentive, promotional pins, turnover salary, gold
// rate. NOT included: DigiGold buy/sell (blocked - /digimarket txns empty; see
// API-MIGRATION.md). Account switching is safe here because we run sequentially
// and always use the freshest token.

import {
  dbEnabled,
  listPhoneSessions,
  getPhoneApiToken,
  savePhoneApiToken,
  markPhoneSessionExpired,
  upsertAccount,
  upsertDashboardSnapshot,
  upsertSalesIncentive,
  upsertTurnoverSalary,
  upsertPromotionalIncentivePins,
  upsertWalletSnapshot,
  upsertWalletWithdrawals,
  upsertDistributors,
  upsertBonds,
  insertGoldRate,
  startScrapeRun,
  finishScrapeRun,
  getNotificationSettings,
} from "./db.mjs";
import { SessionExpiredError } from "./api/client.mjs";
import { listAccounts, switchAccount } from "./api/accounts.mjs";
import { fetchGoldRate } from "./fetchers/goldRate.mjs";
import { fetchDashboard } from "./fetchers/dashboard.mjs";
import { fetchSalesIncentive } from "./fetchers/salesIncentive.mjs";
import { fetchTurnoverSalary } from "./fetchers/turnoverSalary.mjs";
import { fetchPromotionalIncentive } from "./fetchers/promotionalIncentive.mjs";
import { fetchWallet, fetchWithdrawals } from "./fetchers/wallet.mjs";
import { fetchDistributors } from "./fetchers/distributors.mjs";
import { fetchBonds } from "./fetchers/bonds.mjs";
import { notify } from "./telegram.mjs";

if (!dbEnabled) {
  console.error("Supabase not configured - set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const notificationSettings = await getNotificationSettings().catch(() => ({
  sales_incentive: true, turnover_salary: true, promotional_incentive: true,
  wallet_balance: true, distributor_update: true, scrape_crashed: true, session_expired: true,
  account_scrape_failure: true, partial_run_summary: true,
}));

for (const event of ["uncaughtException", "unhandledRejection"]) {
  process.on(event, async (err) => {
    console.error(`\nFatal ${event}:`, err);
    if (notificationSettings.scrape_crashed) {
      await notify(`🔴 <b>API scrape crashed</b> (${event})\n<code>${String(err?.message || err)}</code>`).catch(() => {});
    }
    process.exit(1);
  });
}

let hadFailure = false;

// Gold rate is public and shared - fetch once (no token needed).
try {
  const rate = await fetchGoldRate(null);
  await insertGoldRate(rate);
  console.log(`Gold rate: ₹${rate}/gm`);
} catch (err) {
  console.warn(`Gold rate fetch failed: ${err.message}`);
}

const phoneSessions = await listPhoneSessions();

for (const { phone_number: phone, status } of phoneSessions) {
  if (status !== "active") {
    console.log(`\n=== Phone ${phone} === skipped (status: ${status})`);
    continue;
  }

  console.log(`\n=== Phone ${phone} ===`);
  const session = await getPhoneApiToken(phone);
  let token = session?.api_token;
  if (!token) {
    console.error(`  no api_token for ${phone} - run OTP login first.`);
    if (notificationSettings.session_expired) {
      await notify(`🔴 <b>No session</b> for ${phone} - needs OTP login to the new API.`);
    }
    hadFailure = true;
    continue;
  }

  const runId = await startScrapeRun(phone);
  let accountsScraped = 0;
  const runErrors = [];
  const earningUpdates = [];

  let accounts;
  try {
    accounts = await listAccounts(token); // [{ id, member_code, name, ... }]
  } catch (err) {
    const expired = err instanceof SessionExpiredError;
    console.error(`  listAccounts failed for ${phone}: ${err.message}`);
    if (expired) await markPhoneSessionExpired(phone);
    await finishScrapeRun(runId, { status: expired ? "session_expired" : "error", accountsScraped, errors: [{ error: err.message }] });
    if (expired && notificationSettings.session_expired) {
      await notify(`🔴 <b>Session expired</b> for ${phone} - re-run OTP login to the new API.`);
    }
    hadFailure = true;
    continue;
  }

  let sessionDied = false;
  for (const acct of accounts) {
    const memberId = acct.member_code; // DB key (matches existing data)
    const name = acct.name;
    console.log(`  -> ${memberId} (${name})`);
    let step = "switch";
    try {
      // Switch rotates the token AND revokes the old one; adopt the new one for
      // this account's calls. Persist it immediately: if the run dies mid-way,
      // the stored token must be the freshest valid one, never the revoked
      // start token (that would lock the next run out with a 401).
      const switched = await switchAccount(token, acct.id);
      token = switched.token;
      await savePhoneApiToken(phone, token).catch(() => {});

      step = "fetchDashboard";
      const dashboard = await fetchDashboard(token);
      step = "fetchSalesIncentive";
      const salesIncentive = await fetchSalesIncentive(token);
      step = "fetchTurnoverSalary";
      const turnoverSalary = await fetchTurnoverSalary(token);
      step = "fetchPromotionalIncentive";
      const promotionalIncentive = await fetchPromotionalIncentive(token);
      step = "fetchWallet";
      const wallet = await fetchWallet(token);

      const scrapedAt = new Date().toISOString();
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
      step = "db.upsertWalletSnapshot";
      const walletChange = await upsertWalletSnapshot(memberId, scrapedAt, wallet);
      // Best effort: withdrawals only explain wallet drops, so a failure here
      // (e.g. the wallet_withdrawals table not created yet) must not fail the
      // account's earnings sync.
      let withdrawalChanges = [];
      try {
        withdrawalChanges = await upsertWalletWithdrawals(memberId, await fetchWithdrawals(token));
      } catch (err) {
        console.warn(`     withdrawals not synced: ${err.message}`);
      }
      // Best effort: distributors is a supplementary feature, so neither a
      // genealogy fetch error nor a missing table should fail the account's
      // core earnings sync.
      let distributorChanges = [];
      try {
        const distributors = await fetchDistributors(token);
        distributorChanges = await upsertDistributors(memberId, scrapedAt, distributors);
      } catch (err) {
        console.warn(`     distributors not synced: ${err.message}`);
      }
      // Best effort: bonds/contracts tracking is supplementary; a fetch error
      // or a missing table must not fail the account's core earnings sync.
      let bondChanges = [];
      try {
        const bonds = await fetchBonds(token);
        bondChanges = await upsertBonds(memberId, scrapedAt, bonds);
      } catch (err) {
        console.warn(`     bonds not synced: ${err.message}`);
      }
      console.log(`     synced to Supabase`);

      if (newInvoices.length || salaryChanges.length || pinChanges.length || walletChange || withdrawalChanges.length || distributorChanges.length || bondChanges.length) {
        earningUpdates.push({ memberId, name, invoiceChanges: newInvoices, salaryChanges, pinChanges, walletChange, withdrawalChanges, distributorChanges, bondChanges });
      }
      accountsScraped++;
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        // The stored token died mid-run - the whole phone is now logged out.
        console.error(`     session expired at ${step} for ${memberId}`);
        sessionDied = true;
        runErrors.push({ memberId, step, error: "session expired" });
        break;
      }
      console.error(`     failed for ${memberId} at ${step}: ${err.message}`);
      runErrors.push({ memberId, step, error: err.message });
      if (notificationSettings.account_scrape_failure) {
        await notify(`🟠 <b>API scrape failed</b> for ${memberId} (${phone}) at <code>${step}</code>\n${err.message}`).catch(() => {});
      }
    }
  }

  // Persist the freshest token so next run resumes without OTP (unless it died).
  if (!sessionDied && token) {
    await savePhoneApiToken(phone, token).catch((e) => console.warn(`  token save failed: ${e.message}`));
  }
  if (sessionDied) {
    await markPhoneSessionExpired(phone);
    if (notificationSettings.session_expired) {
      await notify(`🔴 <b>Session expired</b> for ${phone} mid-run - re-run OTP login to the new API.`).catch(() => {});
    }
  }

  await finishScrapeRun(runId, {
    status: sessionDied ? "session_expired" : runErrors.length === 0 ? "success" : "partial",
    accountsScraped,
    errors: runErrors.length ? runErrors : null,
  });

  if (runErrors.length) hadFailure = true;

  if (earningUpdates.length > 0) {
    const lines = earningUpdates.flatMap(({ memberId, name, invoiceChanges, salaryChanges, pinChanges, walletChange, withdrawalChanges = [], distributorChanges = [], bondChanges = [] }) => [
      ...(notificationSettings.sales_incentive ? invoiceChanges.map((inv) =>
        inv.isNew
          ? `  ${name} (${memberId}): new Sales Incentive ${inv.invoice_no} - ₹${inv.si_value} (${inv.bill_date}, ${inv.status})`
          : `  ${name} (${memberId}): Sales Incentive ${inv.invoice_no} ${inv.previousStatus} -> ${inv.status} (₹${inv.si_value})`) : []),
      ...(notificationSettings.turnover_salary ? salaryChanges.map((c) =>
        c.isNew
          ? `  ${name} (${memberId}): new Turnover Salary ${c.month} - ₹${c.current}`
          : `  ${name} (${memberId}): Turnover Salary ${c.month} ₹${c.previous} -> ₹${c.current}`) : []),
      ...(notificationSettings.promotional_incentive ? pinChanges.map((p) =>
        p.isNew
          ? `  ${name} (${memberId}): new Promotional pin ${p.code} - ₹${p.amount} (${p.dated}, ${p.status})`
          : `  ${name} (${memberId}): Promotional pin ${p.code} ${p.previousStatus} -> ${p.status} (₹${p.amount})`) : []),
      ...(notificationSettings.wallet_balance && walletChange && !walletChange.isNew ? [
        `  ${name} (${memberId}): wallet ₹${walletChange.previous} -> ₹${walletChange.current} (${walletChange.delta > 0 ? "+" : ""}${walletChange.delta})`,
      ] : []),
      ...(notificationSettings.wallet_balance ? withdrawalChanges.map((w) =>
        w.isNew
          ? `  ${name} (${memberId}): withdrawal ₹${w.amount} requested (${w.status})`
          : `  ${name} (${memberId}): withdrawal ₹${w.amount} ${w.previousStatus} -> ${w.status}`) : []),
      ...(notificationSettings.distributor_update ? distributorChanges.map((d) => {
        if (d.isNew) return `  ${name} (${memberId}): new distributor ${d.name} (${d.member_code}) - ${d.rank}, BV ${d.bv}, GBV ${d.gbv}`;
        const parts = [];
        if (d.rankChanged) parts.push(`rank ${d.prevRank} -> ${d.rank}`);
        if (d.statusChanged) parts.push(`status ${d.prevStatus} -> ${d.status}`);
        if (d.bvChanged) parts.push(`BV ${d.prevBv} -> ${d.bv}`);
        if (d.gbvChanged) parts.push(`GBV ${d.prevGbv} -> ${d.gbv}`);
        return `  ${name} (${memberId}): ${d.name} (${d.member_code}) ${parts.join(", ")}`;
      }) : []),
      ...(notificationSettings.bond_update ? bondChanges.map((b) => {
        if (b.isNew) return `  ${name} (${memberId}): new contract ${b.plan_code} ${b.plan_name} - ₹${b.value} (expires ${b.expires_on}, ${b.status})`;
        const parts = [];
        if (b.statusChanged) parts.push(`status ${b.prevStatus} -> ${b.status}`);
        if (b.rdChanged) parts.push(`rd_paid ₹${b.prevRdPaid} -> ₹${b.rd_paid}`);
        if (b.cbcChanged) parts.push(`CBC pins ${b.prevCbcCount} -> ${b.cbc_count}`);
        if (b.lvlChanged) parts.push(`LVL pins ${b.prevLvlcomCount} -> ${b.lvlcom_count}`);
        return `  ${name} (${memberId}): contract ${b.plan_code} (inv ${b.invoice_no}) ${parts.join(", ")}`;
      }) : []),
    ]);
    if (lines.length) await notify(`🟢 <b>New earnings</b> for ${phone}\n${lines.join("\n")}`).catch(() => {});
  }
}

if (hadFailure) {
  console.error("\nAPI scrape finished with failures - exiting non-zero.");
  process.exit(1);
}
console.log("\nAPI scrape complete.");
