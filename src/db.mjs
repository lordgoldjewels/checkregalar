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
    .eq("phone_number", phone);
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

export async function insertDashboardSnapshot(accountId, capturedAt, dashboard) {
  if (!dbEnabled) return;
  const { error } = await supabase.from("dashboard_snapshots").insert({
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
  });
  if (error) throw new Error(`insertDashboardSnapshot(${accountId}): ${error.message}`);
}

/** Upserts sales incentive rows and returns the ones whose invoice_no is new for this account. */
export async function upsertSalesIncentive(accountId, rows) {
  if (!dbEnabled || rows.length === 0) return [];

  const { data: existing, error: fetchError } = await supabase
    .from("sales_incentive")
    .select("invoice_no")
    .eq("account_id", accountId);
  if (fetchError) throw new Error(`upsertSalesIncentive(${accountId}) fetch: ${fetchError.message}`);
  const existingInvoices = new Set((existing ?? []).map((r) => r.invoice_no));

  const records = rows.map((r) => ({
    account_id: accountId,
    bill_date: parseDdMmYyyy(r.billDate),
    invoice_no: r.invoiceNo,
    from_distributor: r.fromDistributor,
    si_value: parseAmount(r.siValue),
    status: r.status,
    pay_via: r.payVia,
  }));
  const { error } = await supabase
    .from("sales_incentive")
    .upsert(records, { onConflict: "account_id,invoice_no" });
  if (error) throw new Error(`upsertSalesIncentive(${accountId}): ${error.message}`);

  return records.filter((r) => !existingInvoices.has(r.invoice_no));
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
