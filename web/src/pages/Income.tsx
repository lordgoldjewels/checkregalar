import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";
import { formatINR, formatDate } from "../lib/format";
import { downloadCsv } from "../lib/csv";

const SI_CHARGE_RATE = 0.10; // Sales Incentive is charged 10%; net = 90% of gross.
const PI_ACTUAL_RATE = 0.5; // Promotional Incentive pins show double the actual payout; actual = pin amount / 2.
// Turnover Salary: actual payout is 90% of total_tb_salary above 15000, else 80% -
// the site's own displayed charges/net_total don't reflect this tier, so we compute
// the real figure ourselves rather than trusting what's stored.
const TB_SALARY_THRESHOLD = 15000;
const TB_HIGH_RATE = 0.9;
const TB_LOW_RATE = 0.8;
function actualTbSalary(totalTbSalary: number | null): number {
  const gross = totalTbSalary ?? 0;
  return gross * (gross > TB_SALARY_THRESHOLD ? TB_HIGH_RATE : TB_LOW_RATE);
}

interface AccountRow {
  member_id: string;
  name: string;
}

interface IncomeTotals {
  salesIncentiveGross: number;
  turnoverSalary: number;
  turnoverSalaryActual: number;
  promotionalIncentive: number;
}

interface SalesIncentiveDetail {
  bill_date: string;
  invoice_no: string;
  from_distributor: string | null;
  si_value: number | null;
  status: string | null;
  pay_via: string | null;
}

interface TurnoverSalaryDetail {
  id: number;
  no_of_packets: number | null;
  total_tb_salary: number | null;
  charges: number | null;
  net_total: number | null;
  breakdown: { from_distributor: string | null; distributor_id: string | null; tbp_salary: number | null }[];
}

interface PromotionalIncentiveDetail {
  code: string;
  category: string | null;
  dated: string | null;
  amount: number | null;
  status: string;
}

function monthLabel(yyyyMm: string): string {
  const [year, month] = yyyyMm.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

function monthAccountKey(monthKey: string, accountId: string) {
  return `${monthKey}|${accountId}`;
}

export default function Income() {
  const [accounts, setAccounts]           = useState<AccountRow[]>([]);
  const [totals, setTotals]               = useState<Map<string, IncomeTotals>>(new Map());
  const [monthlyTotals, setMonthlyTotals] = useState<Map<string, IncomeTotals>>(new Map());
  const [monthlyByAccount, setMonthlyByAccount] = useState<Map<string, Map<string, IncomeTotals>>>(new Map());
  const [siDetails, setSiDetails] = useState<Map<string, SalesIncentiveDetail[]>>(new Map());
  const [tsDetails, setTsDetails] = useState<Map<string, TurnoverSalaryDetail[]>>(new Map());
  const [piDetails, setPiDetails] = useState<Map<string, PromotionalIncentiveDetail[]>>(new Map());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [expandedAccountMonths, setExpandedAccountMonths] = useState<Set<string>>(new Set());
  const [loading, setLoading]             = useState(true);

  function toggleMonth(key: string) {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggleAccountMonth(key: string) {
    setExpandedAccountMonths((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);

    const [accountsRes, siRes, tsRes, piRes] = await Promise.all([
      supabase.from("accounts").select("member_id, name").order("name"),
      supabase
        .from("sales_incentive")
        .select("account_id, si_value, bill_date, invoice_no, from_distributor, status, pay_via"),
      supabase.from("turnover_salary").select("id, account_id, net_total, month, no_of_packets, total_tb_salary, charges"),
      supabase
        .from("promotional_incentive_pins")
        .select("account_id, code, category, dated, amount, status")
        .eq("status", "closed"),
    ]);

    const tsRows = (tsRes.data as (TurnoverSalaryDetail & { id: number; account_id: string; month: string })[]) ?? [];
    const breakdownRes = tsRows.length
      ? await supabase
          .from("turnover_salary_breakdown")
          .select("turnover_salary_id, from_distributor, distributor_id, tbp_salary")
          .in("turnover_salary_id", tsRows.map((r) => r.id))
      : { data: [] };
    const breakdownByTsId = new Map<number, TurnoverSalaryDetail["breakdown"]>();
    for (const row of (breakdownRes.data as { turnover_salary_id: number; from_distributor: string | null; distributor_id: string | null; tbp_salary: number | null }[]) ?? []) {
      const list = breakdownByTsId.get(row.turnover_salary_id) ?? [];
      list.push({ from_distributor: row.from_distributor, distributor_id: row.distributor_id, tbp_salary: row.tbp_salary });
      breakdownByTsId.set(row.turnover_salary_id, list);
    }

    const byAccount = new Map<string, IncomeTotals>();
    const ensureAccount = (id: string) => {
      if (!byAccount.has(id)) byAccount.set(id, { salesIncentiveGross: 0, turnoverSalary: 0, turnoverSalaryActual: 0, promotionalIncentive: 0 });
      return byAccount.get(id)!;
    };

    const byMonth = new Map<string, IncomeTotals>();
    const ensureMonth = (key: string) => {
      if (!byMonth.has(key)) byMonth.set(key, { salesIncentiveGross: 0, turnoverSalary: 0, turnoverSalaryActual: 0, promotionalIncentive: 0 });
      return byMonth.get(key)!;
    };

    const byMonthByAccount = new Map<string, Map<string, IncomeTotals>>();
    const ensureMonthAccount = (monthKey: string, accountId: string) => {
      if (!byMonthByAccount.has(monthKey)) byMonthByAccount.set(monthKey, new Map());
      const accMap = byMonthByAccount.get(monthKey)!;
      if (!accMap.has(accountId)) accMap.set(accountId, { salesIncentiveGross: 0, turnoverSalary: 0, turnoverSalaryActual: 0, promotionalIncentive: 0 });
      return accMap.get(accountId)!;
    };

    const siByMonthAccount = new Map<string, SalesIncentiveDetail[]>();
    const tsByMonthAccount = new Map<string, TurnoverSalaryDetail[]>();
    const piByMonthAccount = new Map<string, PromotionalIncentiveDetail[]>();

    for (const row of (siRes.data as (SalesIncentiveDetail & { account_id: string })[]) ?? []) {
      ensureAccount(row.account_id).salesIncentiveGross += row.si_value ?? 0;
      if (row.bill_date) {
        const monthKey = row.bill_date.slice(0, 7);
        ensureMonth(monthKey).salesIncentiveGross += row.si_value ?? 0;
        ensureMonthAccount(monthKey, row.account_id).salesIncentiveGross += row.si_value ?? 0;

        const key = monthAccountKey(monthKey, row.account_id);
        const list = siByMonthAccount.get(key) ?? [];
        list.push(row);
        siByMonthAccount.set(key, list);
      }
    }
    for (const row of tsRows) {
      const actual = actualTbSalary(row.total_tb_salary);
      ensureAccount(row.account_id).turnoverSalary += row.net_total ?? 0;
      ensureAccount(row.account_id).turnoverSalaryActual += actual;
      // turnover_salary.month is "MM-YYYY" - normalize to "YYYY-MM" to match bill_date grouping.
      const [mm, yyyy] = row.month.split("-");
      if (mm && yyyy) {
        const monthKey = `${yyyy}-${mm}`;
        ensureMonth(monthKey).turnoverSalary += row.net_total ?? 0;
        ensureMonth(monthKey).turnoverSalaryActual += actual;
        ensureMonthAccount(monthKey, row.account_id).turnoverSalary += row.net_total ?? 0;
        ensureMonthAccount(monthKey, row.account_id).turnoverSalaryActual += actual;

        const key = monthAccountKey(monthKey, row.account_id);
        const list = tsByMonthAccount.get(key) ?? [];
        list.push({ ...row, breakdown: breakdownByTsId.get(row.id) ?? [] });
        tsByMonthAccount.set(key, list);
      }
    }
    for (const row of (piRes.data as (PromotionalIncentiveDetail & { account_id: string })[]) ?? []) {
      ensureAccount(row.account_id).promotionalIncentive += row.amount ?? 0;
      if (row.dated) {
        const monthKey = row.dated.slice(0, 7);
        ensureMonth(monthKey).promotionalIncentive += row.amount ?? 0;
        ensureMonthAccount(monthKey, row.account_id).promotionalIncentive += row.amount ?? 0;

        const key = monthAccountKey(monthKey, row.account_id);
        const list = piByMonthAccount.get(key) ?? [];
        list.push(row);
        piByMonthAccount.set(key, list);
      }
    }

    setAccounts((accountsRes.data as AccountRow[]) ?? []);
    setTotals(byAccount);
    setMonthlyTotals(byMonth);
    setMonthlyByAccount(byMonthByAccount);
    setSiDetails(siByMonthAccount);
    setTsDetails(tsByMonthAccount);
    setPiDetails(piByMonthAccount);
    setLoading(false);
  }

  const netOf = (t: IncomeTotals) => t.salesIncentiveGross * (1 - SI_CHARGE_RATE);
  const promoActualOf = (t: IncomeTotals) => t.promotionalIncentive * PI_ACTUAL_RATE;

  const grandSalesIncentiveGross = [...totals.values()].reduce((s, t) => s + t.salesIncentiveGross, 0);
  const grandSalesIncentiveNet   = grandSalesIncentiveGross * (1 - SI_CHARGE_RATE);
  const grandTurnoverSalarySite  = [...totals.values()].reduce((s, t) => s + t.turnoverSalary, 0);
  const grandTurnoverSalary      = [...totals.values()].reduce((s, t) => s + t.turnoverSalaryActual, 0);
  const grandPromoIncentiveGross = [...totals.values()].reduce((s, t) => s + t.promotionalIncentive, 0);
  const grandPromoIncentive      = grandPromoIncentiveGross * PI_ACTUAL_RATE;
  const grandTotal               = grandSalesIncentiveNet + grandTurnoverSalary + grandPromoIncentive;

  const monthKeys = [...monthlyTotals.keys()].sort().reverse();

  function exportByAccountCsv() {
    downloadCsv(
      "income-by-account.csv",
      ["Name", "Member ID", "Sales Incentive (Gross)", "Sales Incentive (Net)", "Turnover Salary (Site)", "Turnover Salary (Actual)", "Promotional Incentive (Actual)", "Total (Net)"],
      accounts.map((a) => {
        const t = totals.get(a.member_id) ?? { salesIncentiveGross: 0, turnoverSalary: 0, turnoverSalaryActual: 0, promotionalIncentive: 0 };
        const net = netOf(t);
        const promo = promoActualOf(t);
        return [a.name, a.member_id, t.salesIncentiveGross, net, t.turnoverSalary, t.turnoverSalaryActual, promo, net + t.turnoverSalaryActual + promo];
      })
    );
  }

  function exportByMonthCsv() {
    downloadCsv(
      "income-by-month.csv",
      ["Month", "Sales Incentive (Gross)", "Sales Incentive (Net)", "Turnover Salary (Site)", "Turnover Salary (Actual)", "Promotional Incentive (Actual)", "Total (Net)"],
      monthKeys.map((key) => {
        const t = monthlyTotals.get(key)!;
        const net = netOf(t);
        const promo = promoActualOf(t);
        return [monthLabel(key), t.salesIncentiveGross, net, t.turnoverSalary, t.turnoverSalaryActual, promo, net + t.turnoverSalaryActual + promo];
      })
    );
  }

  return (
    <Layout>
      <div className="px-4 sm:px-8 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-maroon-900">Income</h1>
          <p className="text-sm text-maroon-900/50 mt-0.5">Sales Incentive (net of 10% charges) + Turnover-based Salary + Promotional Incentive, across all accounts</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">Sales Incentive (Net)</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{formatINR(grandSalesIncentiveNet)}</p>
            <p className="text-xs text-maroon-900/40 mt-1">gross {formatINR(grandSalesIncentiveGross)} &middot; 10% charges deducted</p>
          </div>
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">Turnover-based Salary</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{formatINR(grandTurnoverSalary)}</p>
            <p className="text-xs text-maroon-900/40 mt-1">
              site shows {formatINR(grandTurnoverSalarySite)} &middot; additional charges {formatINR(grandTurnoverSalarySite - grandTurnoverSalary)}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">Promotional Incentive</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{formatINR(grandPromoIncentive)}</p>
            <p className="text-xs text-maroon-900/40 mt-1">redeemed pins {formatINR(grandPromoIncentiveGross)} &middot; actual is 50%</p>
          </div>
          <div className="bg-gold-500 rounded-xl shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/60 uppercase tracking-wider">Total Income (Net)</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{formatINR(grandTotal)}</p>
            <p className="text-xs text-maroon-900/60 mt-1">combined</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48 bg-white rounded-xl border border-maroon-100 shadow-sm">
            <p className="text-sm text-maroon-900/40">Loading…</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-maroon-900">By Account</h2>
              <button
                onClick={exportByAccountCsv}
                className="text-xs font-medium text-maroon-700 border border-maroon-200 rounded-lg px-3 py-1.5 hover:bg-maroon-50"
              >
                Export CSV
              </button>
            </div>
            <div className="bg-white rounded-xl border border-maroon-100 shadow-sm overflow-hidden overflow-x-auto mb-8">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-maroon-50 text-left text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Sales Incentive (Gross)</th>
                    <th className="px-5 py-3">Sales Incentive (Net)</th>
                    <th className="px-5 py-3">Turnover Salary (Site)</th>
                    <th className="px-5 py-3">Turnover Salary (Actual)</th>
                    <th className="px-5 py-3">Promotional Incentive</th>
                    <th className="px-5 py-3">Total (Net)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-maroon-50">
                  {accounts.map((a) => {
                    const t = totals.get(a.member_id) ?? { salesIncentiveGross: 0, turnoverSalary: 0, turnoverSalaryActual: 0, promotionalIncentive: 0 };
                    const net = netOf(t);
                    const promo = promoActualOf(t);
                    return (
                      <tr key={a.member_id} className="hover:bg-maroon-50/50">
                        <td className="px-5 py-3">
                          <Link to={`/accounts/${a.member_id}`} className="font-medium text-maroon-700 hover:underline">
                            {a.name}
                          </Link>
                        </td>
                        <td className="px-5 py-3 text-maroon-900/50">{formatINR(t.salesIncentiveGross)}</td>
                        <td className="px-5 py-3">{formatINR(net)}</td>
                        <td className="px-5 py-3 text-maroon-900/50">{formatINR(t.turnoverSalary)}</td>
                        <td className="px-5 py-3">{formatINR(t.turnoverSalaryActual)}</td>
                        <td className="px-5 py-3">{formatINR(promo)}</td>
                        <td className="px-5 py-3 font-semibold">{formatINR(net + t.turnoverSalaryActual + promo)}</td>
                      </tr>
                    );
                  })}
                  {accounts.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-8 text-center text-maroon-900/40">
                        No accounts yet.
                      </td>
                    </tr>
                  )}
                </tbody>
                {accounts.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-maroon-200 bg-maroon-50 font-semibold">
                      <td className="px-5 py-3">Total</td>
                      <td className="px-5 py-3 text-maroon-900/50">{formatINR(grandSalesIncentiveGross)}</td>
                      <td className="px-5 py-3">{formatINR(grandSalesIncentiveNet)}</td>
                      <td className="px-5 py-3 text-maroon-900/50">{formatINR(grandTurnoverSalarySite)}</td>
                      <td className="px-5 py-3">{formatINR(grandTurnoverSalary)}</td>
                      <td className="px-5 py-3">{formatINR(grandPromoIncentive)}</td>
                      <td className="px-5 py-3">{formatINR(grandTotal)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-semibold text-maroon-900">By Month</h2>
              <button
                onClick={exportByMonthCsv}
                className="text-xs font-medium text-maroon-700 border border-maroon-200 rounded-lg px-3 py-1.5 hover:bg-maroon-50"
              >
                Export CSV
              </button>
            </div>
            <p className="text-xs text-maroon-900/40 mb-3">
              Promotional Incentive is attributed to the month a pin's redemption date falls in.
            </p>
            <div className="bg-white rounded-xl border border-maroon-100 shadow-sm overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-maroon-50 text-left text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">
                    <th className="px-5 py-3">Month</th>
                    <th className="px-5 py-3">Sales Incentive (Gross)</th>
                    <th className="px-5 py-3">Sales Incentive (Net)</th>
                    <th className="px-5 py-3">Turnover Salary (Site)</th>
                    <th className="px-5 py-3">Turnover Salary (Actual)</th>
                    <th className="px-5 py-3">Promotional Incentive</th>
                    <th className="px-5 py-3">Total (Net)</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-maroon-50">
                  {monthKeys.map((key) => {
                    const t = monthlyTotals.get(key)!;
                    const net = netOf(t);
                    const promo = promoActualOf(t);
                    const accountBreakdown = [...(monthlyByAccount.get(key) ?? new Map())].sort(
                      (a, b) =>
                        netOf(b[1]) + b[1].turnoverSalaryActual + promoActualOf(b[1]) -
                        (netOf(a[1]) + a[1].turnoverSalaryActual + promoActualOf(a[1]))
                    );
                    return (
                      <Fragment key={key}>
                        <tr className="hover:bg-maroon-50/50">
                          <td className="px-5 py-3 font-medium text-maroon-900">{monthLabel(key)}</td>
                          <td className="px-5 py-3 text-maroon-900/50">{formatINR(t.salesIncentiveGross)}</td>
                          <td className="px-5 py-3">{formatINR(net)}</td>
                          <td className="px-5 py-3 text-maroon-900/50">{formatINR(t.turnoverSalary)}</td>
                          <td className="px-5 py-3">{formatINR(t.turnoverSalaryActual)}</td>
                          <td className="px-5 py-3">{formatINR(promo)}</td>
                          <td className="px-5 py-3 font-semibold">{formatINR(net + t.turnoverSalaryActual + promo)}</td>
                          <td className="px-5 py-3 text-right">
                            <button
                              onClick={() => toggleMonth(key)}
                              className="text-xs font-medium text-maroon-700 hover:underline"
                            >
                              {expandedMonths.has(key) ? "Hide" : "Breakdown"}
                            </button>
                          </td>
                        </tr>
                        {expandedMonths.has(key) &&
                          accountBreakdown.map(([accountId, at]) => {
                            const amKey = monthAccountKey(key, accountId);
                            const accountName = accounts.find((a) => a.member_id === accountId)?.name ?? accountId;
                            const si = siDetails.get(amKey) ?? [];
                            const ts = tsDetails.get(amKey) ?? [];
                            const pi = piDetails.get(amKey) ?? [];
                            return (
                              <Fragment key={amKey}>
                                <tr className="bg-maroon-50/40">
                                  <td className="pl-8 pr-4 py-2">
                                    <Link to={`/accounts/${accountId}`} className="text-maroon-700 hover:underline text-sm">
                                      {accountName}
                                    </Link>
                                  </td>
                                  <td className="px-4 py-2 text-sm text-maroon-900/50">{formatINR(at.salesIncentiveGross)}</td>
                                  <td className="px-4 py-2 text-sm">{formatINR(netOf(at))}</td>
                                  <td className="px-4 py-2 text-sm text-maroon-900/50">{formatINR(at.turnoverSalary)}</td>
                                  <td className="px-4 py-2 text-sm">{formatINR(at.turnoverSalaryActual)}</td>
                                  <td className="px-4 py-2 text-sm">{formatINR(promoActualOf(at))}</td>
                                  <td className="px-4 py-2 text-sm font-semibold">{formatINR(netOf(at) + at.turnoverSalaryActual + promoActualOf(at))}</td>
                                  <td className="px-4 py-2 text-right">
                                    <button
                                      onClick={() => toggleAccountMonth(amKey)}
                                      className="text-xs font-medium text-maroon-700 hover:underline"
                                    >
                                      {expandedAccountMonths.has(amKey) ? "Hide" : "Details"}
                                    </button>
                                  </td>
                                </tr>
                                {expandedAccountMonths.has(amKey) && (
                                  <tr>
                                    <td colSpan={8} className="px-4 py-3 bg-maroon-100/40">
                                      {si.length > 0 && (
                                        <div className="mb-3">
                                          <p className="text-xs font-semibold text-maroon-900/50 uppercase tracking-wider mb-1">
                                            Sales Incentive
                                          </p>
                                          <table className="w-full text-xs">
                                            <thead>
                                              <tr className="text-left text-maroon-900/50">
                                                <th className="py-1 pr-4">Bill Date</th>
                                                <th className="py-1 pr-4">Invoice No</th>
                                                <th className="py-1 pr-4">From</th>
                                                <th className="py-1 pr-4">SI Value (Net)</th>
                                                <th className="py-1 pr-4">Status</th>
                                                <th className="py-1 pr-4">Pay Via</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {si.map((r) => (
                                                <tr key={r.invoice_no}>
                                                  <td className="py-1 pr-4">{formatDate(r.bill_date)}</td>
                                                  <td className="py-1 pr-4 font-mono">{r.invoice_no}</td>
                                                  <td className="py-1 pr-4">{r.from_distributor}</td>
                                                  <td className="py-1 pr-4">{formatINR((r.si_value ?? 0) * (1 - SI_CHARGE_RATE))}</td>
                                                  <td className="py-1 pr-4">{r.status}</td>
                                                  <td className="py-1 pr-4">{r.pay_via}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      )}
                                      {ts.map((r) => (
                                        <div key={r.id}>
                                          <p className="text-xs font-semibold text-maroon-900/50 uppercase tracking-wider mb-1">
                                            Turnover Salary &middot; {formatINR(r.total_tb_salary)} gross &middot; site shows {formatINR(r.net_total)} net &middot; actual {formatINR(actualTbSalary(r.total_tb_salary))}
                                            {(r.total_tb_salary ?? 0) <= TB_SALARY_THRESHOLD && " (20% charges, below ₹15,000)"}
                                          </p>
                                          {r.breakdown.length > 0 && (
                                            <table className="w-full text-xs">
                                              <thead>
                                                <tr className="text-left text-maroon-900/50">
                                                  <th className="py-1 pr-4">From Distributor</th>
                                                  <th className="py-1 pr-4">Distributor ID</th>
                                                  <th className="py-1 pr-4">TBP Salary</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {r.breakdown.map((b, i) => (
                                                  <tr key={i}>
                                                    <td className="py-1 pr-4">{b.from_distributor}</td>
                                                    <td className="py-1 pr-4 font-mono">{b.distributor_id}</td>
                                                    <td className="py-1 pr-4">{formatINR(b.tbp_salary)}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          )}
                                        </div>
                                      ))}
                                      {pi.length > 0 && (
                                        <div className="mb-3">
                                          <p className="text-xs font-semibold text-maroon-900/50 uppercase tracking-wider mb-1">
                                            Promotional Incentive
                                          </p>
                                          <table className="w-full text-xs">
                                            <thead>
                                              <tr className="text-left text-maroon-900/50">
                                                <th className="py-1 pr-4">Code</th>
                                                <th className="py-1 pr-4">Category</th>
                                                <th className="py-1 pr-4">Dated</th>
                                                <th className="py-1 pr-4">Amount (Actual)</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {pi.map((r) => (
                                                <tr key={r.code}>
                                                  <td className="py-1 pr-4 font-mono">{r.code}</td>
                                                  <td className="py-1 pr-4">{r.category}</td>
                                                  <td className="py-1 pr-4">{formatDate(r.dated)}</td>
                                                  <td className="py-1 pr-4">{formatINR((r.amount ?? 0) * PI_ACTUAL_RATE)}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      )}
                                      {si.length === 0 && ts.length === 0 && pi.length === 0 && (
                                        <p className="text-xs text-maroon-900/40">No detail records.</p>
                                      )}
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                      </Fragment>
                    );
                  })}
                  {monthKeys.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-5 py-8 text-center text-maroon-900/40">
                        No income data yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
