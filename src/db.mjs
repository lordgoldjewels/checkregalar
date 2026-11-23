import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const dbEnabled = Boolean(url && serviceRoleKey);

export const supabase = dbEnabled
  ? createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  : null;

/** "₹. 1,01,894" / "14,61,404" / "0.00" -> number. Returns null if unparsable. */
export function parseAmount(raw) {
  if (raw == null) return null;
  // "₹. 1,01,894" -> strip currency symbol/commas/spaces, then a stray
  // leading "." left behind by the "₹." prefix (not a real decimal point).
  const num = Number(String(raw).replace(/[₹,\s]/g, "").replace(/^\.\s*/, ""));
  return Number.isFinite(num) ? num : null;
}

/** "20-07-2026" (DD-MM-YYYY) -> "2026-07-20" (ISO). */
export function parseDdMmYyyy(raw) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw || "");
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

// Postgres rejects a multi-row upsert whose payload has two rows for the
// same conflict key ("ON CONFLICT DO UPDATE command cannot affect row a
// second time"). Last occurrence wins (arbitrary but deterministic).
function dedupeByKey(records, keyFn) {
  const map = new Map();
  for (const r of records) map.set(keyFn(r), r);
  return [...map.values()];
}

export async function getPhoneSession(phone) {
  requireDb();
  const { data, error } = await supabase
    .from("phone_sessions")
    .select("storage_state, status")
    .eq("phone_number", phone)
    .maybeSingle();
  if (error) throw new Error(`getPhoneSession(${phone}): ${error.message}`);
  return data;
}

export async function savePhoneSession(phone, storageState, status = "active") {
  requireDb();
  const { error } = await supabase
    .from("phone_sessions")
    .upsert(
      { phone_number: phone, storage_state: storageState, status, updated_at: new Date().toISOString() },
      { onConflict: "phone_number" }
    );
  if (error) throw new Error(`savePhoneSession(${phone}): ${error.message}`);
}

export async function listPhoneSessions() {
  requireDb();
  const { data, error } = await supabase.from("phone_sessions").select("phone_number, status");
  if (error) throw new Error(`listPhoneSessions(): ${error.message}`);
  return data;
}

export async function listAccountsForPhone(phone) {
  requireDb();
  const { data, error } = await supabase
    .from("accounts")
    .select("member_id, name")
    .eq("phone_number", phone)
    .eq("enabled", true)
    .order("member_id");
  if (error) throw new Error(`listAccountsForPhone(${phone}): ${error.message}`);
  return data.map((a) => ({ memberId: a.member_id, name: a.name }));
}

function requireDb() {
  if (!dbEnabled) {
    throw new Error("Supabase not configured - set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
  }
}

export async function upsertAccount({ memberId, name, phone, uplineMemberId = null }) {
  if (!dbEnabled) return;
  const { error } = await supabase
    .from("accounts")
    .upsert(
      { member_id: memberId, name, phone_number: phone, upline_member_id: uplineMemberId },
      { onConflict: "member_id" }
    );
  if (error) throw new Error(`upsertAccount(${memberId}): ${error.message}`);
}

/** Upserts the dashboard snapshot in place (one row per account) - not history, just current status. */
export async function upsertDashboardSnapshot(accountId, capturedAt, dashboard) {
  if (!dbEnabled) return;
  const { error } = await supabase.from("dashboard_snapshots").upsert(
    {
      account_id: accountId,
      captured_at: capturedAt,
      my_business: parseAmount(dashboard.myBusiness),
      my_promotional_incentive: parseAmount(dashboard.myPromotionalIncentive),
      my_promotional_incentive_earned: dashboard.myPromotionalIncentiveCount?.earned ?? null,
      my_promotional_incentive_total: dashboard.myPromotionalIncentiveCount?.total ?? null,
      my_distributors: parseAmount(dashboard.myDistributors),
      my_gross_b_volume: parseAmount(dashboard.myGrossBVolume),
      my_earning: parseAmount(dashboard.myEarning),
      my_withdraw: parseAmount(dashboard.myWithdraw),
      my_tbp_gross_b_volume: parseAmount(dashboard.myTbpGrossBVolume),
      my_gift: parseAmount(dashboard.myGift),
    },
    { onConflict: "account_id" }
  );
  if (error) throw new Error(`upsertDashboardSnapshot(${accountId}): ${error.message}`);
}

/**
 * Upserts sales incentive rows and returns the ones worth flagging:
 * a brand-new invoice_no, or an existing one whose status changed
 * (e.g. PENDING -> PAID).
 */
export async function upsertSalesIncentive(accountId, rows) {
  if (!dbEnabled || rows.length === 0) return [];

  const { data: existing, error: fetchError } = await supabase
    .from("sales_incentive")
    .select("invoice_no, status")
    .eq("account_id", accountId);
  if (fetchError) throw new Error(`upsertSalesIncentive(${accountId}) fetch: ${fetchError.message}`);
  const existingByInvoice = new Map((existing ?? []).map((r) => [r.invoice_no, r.status]));

  let records = rows.map((r) => ({
    account_id: accountId,
    bill_date: parseDdMmYyyy(r.billDate),
    invoice_no: r.invoiceNo,
    from_distributor: r.fromDistributor,
    si_value: parseAmount(r.siValue),
    status: r.status,
    pay_via: r.payVia,
  }));
  records = dedupeByKey(records, (r) => r.invoice_no);
  const { error } = await supabase
    .from("sales_incentive")
    .upsert(records, { onConflict: "account_id,invoice_no" });
  if (error) throw new Error(`upsertSalesIncentive(${accountId}): ${error.message}`);

  return records.flatMap((r) => {
    if (!existingByInvoice.has(r.invoice_no)) return [{ ...r, isNew: true, previousStatus: null }];
    const previousStatus = existingByInvoice.get(r.invoice_no);
    if (previousStatus !== r.status) return [{ ...r, isNew: false, previousStatus }];
    return [];
  });
}

/**
 * Upserts promotional incentive pins and returns the ones worth flagging:
 * a brand-new pin, or an existing one whose status changed - most notably
 * active/pending -> closed, which means it was just redeemed.
 */
export async function upsertPromotionalIncentivePins(accountId, rows) {
  if (!dbEnabled || rows.length === 0) return [];

  const { data: existing, error: fetchError } = await supabase
    .from("promotional_incentive_pins")
    .select("code, status")
    .eq("account_id", accountId);
  if (fetchError) throw new Error(`upsertPromotionalIncentivePins(${accountId}) fetch: ${fetchError.message}`);
  const existingByCode = new Map((existing ?? []).map((r) => [r.code, r.status]));

  let records = rows.map((r) => ({
    account_id: accountId,
    code: r.code,
    category: r.category,
    dated: parseDdMmYyyy(r.dated),
    amount: parseAmount(r.amount),
    status: r.status,
  }));
  records = dedupeByKey(records, (r) => r.code);
  const { error } = await supabase
    .from("promotional_incentive_pins")
    .upsert(records, { onConflict: "account_id,code" });
  if (error) throw new Error(`upsertPromotionalIncentivePins(${accountId}): ${error.message}`);

  return records.flatMap((r) => {
    if (!existingByCode.has(r.code)) return [{ ...r, isNew: true, previousStatus: null }];
    const previousStatus = existingByCode.get(r.code);
    if (previousStatus !== r.status) return [{ ...r, isNew: false, previousStatus }];
    return [];
  });
}

/** Upserts DigiGold buy transactions and returns the ones whose order_id is new for this account. */
export async function upsertDigigoldBuy(accountId, rows) {
  if (!dbEnabled || rows.length === 0) return [];

  const { data: existing, error: fetchError } = await supabase
    .from("digigold_buy_transactions")
    .select("order_id")
    .eq("account_id", accountId);
  if (fetchError) throw new Error(`upsertDigigoldBuy(${accountId}) fetch: ${fetchError.message}`);
  const existingOrders = new Set((existing ?? []).map((r) => r.order_id));

  let records = rows.map((r) => ({
    account_id: accountId,
    order_id: r.orderId,
    buy_date: parseDdMmYyyy(r.buyDate),
    weight_gm: parseAmount(r.weightGm),
    gold_worth: parseAmount(r.goldWorth),
    price_on_day: parseAmount(r.priceOnDay),
  }));
  records = dedupeByKey(records, (r) => r.order_id);
  const { error } = await supabase
    .from("digigold_buy_transactions")
    .upsert(records, { onConflict: "account_id,order_id" });
  if (error) throw new Error(`upsertDigigoldBuy(${accountId}): ${error.message}`);

  return records.filter((r) => !existingOrders.has(r.order_id));
}

// transaction_remarks is blank on the site until a sell settles, so two
// different PENDING sells for the same account can share transaction_remarks
// - identify a sell by (sell_date, weight_gm, gold_worth) instead, which is
// always populated, even while pending. occurrence further disambiguates
// two genuinely different sells that share all three (e.g. the same gram
// amount sold twice in one day at the same rate) - see upsertDigigoldSell.
export function sellKey(r) {
  return `${r.sell_date}|${r.weight_gm}|${r.gold_worth}|${r.occurrence}`;
}

// occurrence = the Nth row this scrape sharing the same date/weight/worth,
// assigned in scrape order so it stays stable run to run as long as the
// site's own row order does.
export function toDigigoldSellRecords(accountId, rows) {
  const occurrenceCounts = new Map();
  return rows.map((r) => {
    const sell_date = parseDdMmYyyy(r.sellDate);
    const weight_gm = parseAmount(r.weightGm);
    const gold_worth = parseAmount(r.goldWorth);
    const groupKey = `${sell_date}|${weight_gm}|${gold_worth}`;
    const occurrence = occurrenceCounts.get(groupKey) ?? 0;
    occurrenceCounts.set(groupKey, occurrence + 1);
    return {
      account_id: accountId,
      transaction_remarks: r.transactionRemarks,
      sell_date,
      weight_gm,
      gold_worth,
      wallet_remarks: r.walletRemarks || null,
      status: r.status,
      occurrence,
    };
  });
}

/**
 * Upserts DigiGold sell transactions and returns the ones worth flagging:
 * a brand-new transaction, or an existing one whose status changed
 * (e.g. PENDING -> PASSED).
 */
export async function upsertDigigoldSell(accountId, rows) {
  if (!dbEnabled || rows.length === 0) return [];

  const { data: existing, error: fetchError } = await supabase
    .from("digigold_sell_transactions")
    .select("sell_date, weight_gm, gold_worth, occurrence, status")
    .eq("account_id", accountId);
  if (fetchError) throw new Error(`upsertDigigoldSell(${accountId}) fetch: ${fetchError.message}`);
  const existingByKey = new Map((existing ?? []).map((r) => [sellKey(r), r.status]));

  const records = dedupeByKey(toDigigoldSellRecords(accountId, rows), sellKey);
  const { error } = await supabase
    .from("digigold_sell_transactions")
    .upsert(records, { onConflict: "account_id,sell_date,weight_gm,gold_worth,occurrence" });
  if (error) throw new Error(`upsertDigigoldSell(${accountId}): ${error.message}`);

  return records.flatMap((r) => {
    const key = sellKey(r);
    if (!existingByKey.has(key)) return [{ ...r, isNew: true, previousStatus: null }];
    const previousStatus = existingByKey.get(key);
    if (previousStatus !== r.status) return [{ ...r, isNew: false, previousStatus }];
    return [];
  });
}

/** Upserts turnover salary rows and returns any that are new months or whose net_total increased. */
export async function upsertTurnoverSalary(accountId, rows) {
  if (!dbEnabled || rows.length === 0) return [];

  const { data: existing, error: fetchError } = await supabase
    .from("turnover_salary")
    .select("month, net_total")
    .eq("account_id", accountId);
  if (fetchError) throw new Error(`upsertTurnoverSalary(${accountId}) fetch: ${fetchError.message}`);
  const existingByMonth = new Map((existing ?? []).map((r) => [r.month, Number(r.net_total)]));

  const changes = [];

  for (const row of rows) {
    const netTotal = parseAmount(row.netTotal);
    const previous = existingByMonth.has(row.month) ? existingByMonth.get(row.month) : null;
    if (previous === null) {
      changes.push({ month: row.month, previous: null, current: netTotal, isNew: true });
    } else if (netTotal != null && netTotal > previous) {
      changes.push({ month: row.month, previous, current: netTotal, isNew: false });
    }

    const { data, error } = await supabase
      .from("turnover_salary")
      .upsert(
        {
          account_id: accountId,
          month: row.month,
          no_of_packets: parseAmount(row.noOfPackets),
          total_tb_salary: parseAmount(row.totalTbSalary),
          charges: parseAmount(row.charges),
          net_total: parseAmount(row.netTotal),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "account_id,month" }
      )
      .select("id")
      .single();
    if (error) throw new Error(`upsertTurnoverSalary(${accountId}, ${row.month}): ${error.message}`);

    const turnoverSalaryId = data.id;
    await supabase.from("turnover_salary_breakdown").delete().eq("turnover_salary_id", turnoverSalaryId);

    if (row.breakdown?.length > 0) {
      const breakdownRecords = row.breakdown.map((b) => ({
        turnover_salary_id: turnoverSalaryId,
        from_distributor: b.fromDistributor,
        distributor_id: b.distributorId,
        tbp_salary: parseAmount(b.tbpSalary),
      }));
      const { error: breakdownError } = await supabase
        .from("turnover_salary_breakdown")
        .insert(breakdownRecords);
      if (breakdownError) {
        throw new Error(`turnover_salary_breakdown(${accountId}, ${row.month}): ${breakdownError.message}`);
      }
    }
  }

  return changes;
}

/**
 * Upserts the wallet snapshot in place (one row per account - current state,
 * like dashboard_snapshots) and returns a change descriptor when cash_balance
 * moved, so the caller can alert. Needs the wallet_snapshots table (see
 * API-MIGRATION.md for the CREATE TABLE).
 */
export async function upsertWalletSnapshot(accountId, capturedAt, wallet) {
  if (!dbEnabled) return null;

  const { data: prev, error: fetchError } = await supabase
    .from("wallet_snapshots")
    .select("cash_balance")
    .eq("account_id", accountId)
    .maybeSingle();
  if (fetchError) throw new Error(`upsertWalletSnapshot(${accountId}) fetch: ${fetchError.message}`);
  const previousCash = prev ? Number(prev.cash_balance) : null;

  const { error } = await supabase.from("wallet_snapshots").upsert(
    {
      account_id: accountId,
      captured_at: capturedAt,
      currency_code: wallet.currencyCode,
      cash_balance: parseAmount(wallet.cashBalance),
      epin_balance: parseAmount(wallet.epinBalance),
      coupon_balance: parseAmount(wallet.couponBalance),
      earning_total: parseAmount(wallet.earningTotal),
      ic_paid: parseAmount(wallet.streams.icPaid),
      ic_pending: parseAmount(wallet.streams.icPending),
      gap_paid: parseAmount(wallet.streams.gapPaid),
      gap_pending: parseAmount(wallet.streams.gapPending),
      cbc_paid: parseAmount(wallet.streams.cbcPaid),
      cbc_pending: parseAmount(wallet.streams.cbcPending),
      reseller_paid: parseAmount(wallet.streams.resellerPaid),
      settlement_paid: parseAmount(wallet.streams.settlementPaid),
      settlement_pending: parseAmount(wallet.streams.settlementPending),
      bonds_active: wallet.bonds.active ?? null,
      bonds_total: wallet.bonds.total ?? null,
      bonds_invested: parseAmount(wallet.bonds.invested),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "account_id" }
  );
  if (error) throw new Error(`upsertWalletSnapshot(${accountId}): ${error.message}`);

  const current = wallet.cashBalance == null ? null : Number(wallet.cashBalance);
  if (previousCash === null && current !== null) return { isNew: true, previous: null, current, delta: null };
  if (previousCash !== null && current !== null && current !== previousCash) {
    return { isNew: false, previous: previousCash, current, delta: current - previousCash };
  }
  return null;
}

/**
 * Upserts wallet withdrawal requests and returns the ones worth flagging: a
 * new request, or one whose status changed (e.g. pending -> disbursed).
 * Needs the wallet_withdrawals table
 * (supabase/migrations/20261104190000_wallet_withdrawals.sql).
 */
export async function upsertWalletWithdrawals(accountId, rows) {
  if (!dbEnabled || rows.length === 0) return [];

  const { data: existing, error: fetchError } = await supabase
    .from("wallet_withdrawals")
    .select("withdrawal_id, status")
    .eq("account_id", accountId);
  if (fetchError) throw new Error(`upsertWalletWithdrawals(${accountId}) fetch: ${fetchError.message}`);
  const existingById = new Map((existing ?? []).map((r) => [Number(r.withdrawal_id), r.status]));

  const records = dedupeByKey(
    rows.map((r) => ({
      account_id: accountId,
      withdrawal_id: r.withdrawalId,
      branch: r.branch,
      amount: parseAmount(r.amount),
      status: r.status,
      disbursal_mode: r.disbursalMode,
      requested_at: r.requestedAt,
      disbursed_at: r.disbursedAt,
      updated_at: new Date().toISOString(),
    })),
    (r) => r.withdrawal_id
  );
  const { error } = await supabase
    .from("wallet_withdrawals")
    .upsert(records, { onConflict: "account_id,withdrawal_id" });
  if (error) throw new Error(`upsertWalletWithdrawals(${accountId}): ${error.message}`);

  return records.flatMap((r) => {
    if (!existingById.has(Number(r.withdrawal_id))) return [{ ...r, isNew: true, previousStatus: null }];
    const previousStatus = existingById.get(Number(r.withdrawal_id));
    if (previousStatus !== r.status) return [{ ...r, isNew: false, previousStatus }];
    return [];
  });
}

/**
 * Upserts the distributor network for one account (its flattened genealogy tree)
 * and returns the changes worth flagging: a NEW member (join), a RANK change
 * (promotion/demotion), a STATUS change, or a move in BV or GBV. Keyed by
 * (account_id, member_code) so each account keeps its own view of the tree.
 * Needs the distributors table
 * (supabase/migrations/20261114120000_distributors.sql).
 */
export async function upsertDistributors(accountId, capturedAt, rows) {
  if (!dbEnabled || rows.length === 0) return [];

  const { data: existing, error: fetchError } = await supabase
    .from("distributors")
    .select("member_code, rank, status, bv, gbv")
    .eq("account_id", accountId);
  if (fetchError) throw new Error(`upsertDistributors(${accountId}) fetch: ${fetchError.message}`);
  const existingByCode = new Map((existing ?? []).map((r) => [r.member_code, r]));

  const records = dedupeByKey(
    rows.map((r) => ({
      account_id: accountId,
      member_code: r.memberCode,
      name: r.name,
      rank: r.rank,
      status: r.status,
      bv: parseAmount(r.bv),
      gbv: parseAmount(r.gbv),
      team_size: r.teamSize ?? null,
      parent_code: r.parentCode,
      level: r.level,
      joined_on: r.joinedOn,
      captured_at: capturedAt,
      updated_at: new Date().toISOString(),
    })),
    (r) => r.member_code
  );
  const { error } = await supabase
    .from("distributors")
    .upsert(records, { onConflict: "account_id,member_code" });
  if (error) throw new Error(`upsertDistributors(${accountId}): ${error.message}`);

  // Initial seed for this account (no prior rows): everything looks "new", so
  // report nothing - it's just the baseline, not a wave of real joins. Genuine
  // joins/changes are caught on subsequent runs.
  if (existingByCode.size === 0) return [];

  return records.flatMap((r) => {
    const prev = existingByCode.get(r.member_code);
    if (!prev) return [{ ...r, isNew: true }];
    const bvPrev = prev.bv == null ? null : Number(prev.bv);
    const gbvPrev = prev.gbv == null ? null : Number(prev.gbv);
    const rankChanged = prev.rank !== r.rank;
    const statusChanged = prev.status !== r.status;
    const bvChanged = bvPrev !== r.bv;
    const gbvChanged = gbvPrev !== r.gbv;
    if (rankChanged || statusChanged || bvChanged || gbvChanged) {
      return [{
        ...r, isNew: false,
        prevRank: prev.rank, prevStatus: prev.status, prevBv: bvPrev, prevGbv: gbvPrev,
        rankChanged, statusChanged, bvChanged, gbvChanged,
      }];
    }
    return [];
  });
}

/**
 * Upserts bonds/contracts and returns the ones worth flagging: a brand-new
 * contract, a status change (active -> matured/completed = the term closing),
 * an rd_paid bump, or newly-issued cbc/lvlcom pins. The status/rd_paid signals
 * are how the 12-month back-half CBC payout is caught when it lands.
 */
export async function upsertBonds(accountId, capturedAt, rows) {
  if (!dbEnabled || rows.length === 0) return [];

  const { data: existing, error: fetchError } = await supabase
    .from("bonds")
    .select("bond_id, status, cbc_count, lvlcom_count, rd_paid")
    .eq("account_id", accountId);
  if (fetchError) throw new Error(`upsertBonds(${accountId}) fetch: ${fetchError.message}`);
  const existingById = new Map((existing ?? []).map((r) => [Number(r.bond_id), r]));

  const records = dedupeByKey(
    rows.map((r) => ({
      account_id: accountId,
      bond_id: r.bondId,
      invoice_no: r.invoiceNo,
      plan_code: r.planCode,
      plan_name: r.planName,
      plan_type: r.planType,
      value: parseAmount(r.value),
      bond_date: r.bondDate,
      expires_on: r.expiresOn,
      status: r.status,
      cbc_issued: r.cbcIssued ?? null,
      cbc_count: r.cbcCount ?? null,
      lvlcom_issued: r.lvlcomIssued ?? null,
      lvlcom_count: r.lvlcomCount ?? null,
      rd_paid: parseAmount(r.rdPaid),
      captured_at: capturedAt,
      updated_at: new Date().toISOString(),
    })),
    (r) => r.bond_id
  );
  const { error } = await supabase
    .from("bonds")
    .upsert(records, { onConflict: "account_id,bond_id" });
  if (error) throw new Error(`upsertBonds(${accountId}): ${error.message}`);

  // Initial seed (no prior rows): baseline, report nothing.
  if (existingById.size === 0) return [];

  return records.flatMap((r) => {
    const prev = existingById.get(Number(r.bond_id));
    if (!prev) return [{ ...r, isNew: true }];
    const rdPrev = prev.rd_paid == null ? null : Number(prev.rd_paid);
    const statusChanged = prev.status !== r.status;
    const cbcChanged = (prev.cbc_count ?? null) !== (r.cbc_count ?? null);
    const lvlChanged = (prev.lvlcom_count ?? null) !== (r.lvlcom_count ?? null);
    const rdChanged = rdPrev !== r.rd_paid;
    if (statusChanged || cbcChanged || lvlChanged || rdChanged) {
      return [{
        ...r, isNew: false,
        prevStatus: prev.status, prevCbcCount: prev.cbc_count ?? null,
        prevLvlcomCount: prev.lvlcom_count ?? null, prevRdPaid: rdPrev,
        statusChanged, cbcChanged, lvlChanged, rdChanged,
      }];
    }
    return [];
  });
}

export async function insertGoldRate(ratePerGm) {
  if (!dbEnabled) return;
  const { error } = await supabase.from("gold_rates").insert({ rate_per_gm: ratePerGm });
  if (error) throw new Error(`insertGoldRate(${ratePerGm}): ${error.message}`);
}

export async function startScrapeRun(phone) {
  if (!dbEnabled) return null;
  const { data, error } = await supabase
    .from("scrape_runs")
    .insert({ phone_number: phone, status: "running" })
    .select("id")
    .single();
  if (error) throw new Error(`startScrapeRun(${phone}): ${error.message}`);
  return data.id;
}

export async function finishScrapeRun(runId, { status, accountsScraped, errors }) {
  if (!dbEnabled || !runId) return;
  const { error } = await supabase
    .from("scrape_runs")
    .update({ finished_at: new Date().toISOString(), status, accounts_scraped: accountsScraped, errors })
    .eq("id", runId);
  if (error) throw new Error(`finishScrapeRun(${runId}): ${error.message}`);
}

const ALL_NOTIFICATION_TYPES = [
  "sales_incentive", "turnover_salary", "promotional_incentive",
  "digigold_buy", "digigold_sell", "wallet_balance", "distributor_update",
  "bond_update",
  "scrape_crashed", "failed_to_load_home", "session_expired",
  "account_scrape_failure", "partial_run_summary",
];

// Missing rows or a fetch failure default to enabled, so a DB hiccup never
// silently mutes an alert.
export async function getNotificationSettings() {
  const settings = Object.fromEntries(ALL_NOTIFICATION_TYPES.map((t) => [t, true]));
  if (!dbEnabled) return settings;
  const { data } = await supabase.from("notification_settings").select("type, enabled");
  for (const row of data ?? []) settings[row.type] = row.enabled;
  return settings;
}

// --- New-API token storage (reuses phone_sessions; needs a one-time migration:
//     ALTER TABLE phone_sessions ADD COLUMN IF NOT EXISTS api_token text; ) ---

export async function getPhoneApiToken(phone) {
  requireDb();
  const { data, error } = await supabase
    .from("phone_sessions")
    .select("api_token, status")
    .eq("phone_number", phone)
    .maybeSingle();
  if (error) throw new Error(`getPhoneApiToken(${phone}): ${error.message}`);
  return data;
}

export async function savePhoneApiToken(phone, apiToken, status = "active") {
  requireDb();
  const { error } = await supabase
    .from("phone_sessions")
    .upsert(
      { phone_number: phone, api_token: apiToken, status, updated_at: new Date().toISOString() },
      { onConflict: "phone_number" }
    );
  if (error) throw new Error(`savePhoneApiToken(${phone}): ${error.message}`);
}

export async function markPhoneSessionExpired(phone) {
  requireDb();
  const { error } = await supabase
    .from("phone_sessions")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("phone_number", phone);
  if (error) throw new Error(`markPhoneSessionExpired(${phone}): ${error.message}`);
}
