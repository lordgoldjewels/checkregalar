import { Fragment, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";
import { formatINR, formatNumber, formatDateTime, formatDate } from "../lib/format";
import { downloadCsv } from "../lib/csv";

interface Account {
  member_id: string;
  name: string;
  phone_number: string;
  upline_member_id: string | null;
}

interface Snapshot {
  id: number;
  captured_at: string;
  my_business: number | null;
  my_promotional_incentive: number | null;
  my_distributors: number | null;
  my_gross_b_volume: number | null;
  my_earning: number | null;
  my_withdraw: number | null;
  my_tbp_gross_b_volume: number | null;
  my_gift: number | null;
}

interface SalesIncentiveRow {
  id: number;
  bill_date: string;
  invoice_no: string;
  from_distributor: string | null;
  si_value: number | null;
  status: string | null;
  pay_via: string | null;
}

interface TurnoverSalaryRow {
  id: number;
  month: string;
  no_of_packets: number | null;
  total_tb_salary: number | null;
  charges: number | null;
  net_total: number | null;
}

interface BreakdownRow {
  turnover_salary_id: number;
  from_distributor: string | null;
  distributor_id: string | null;
  tbp_salary: number | null;
}

interface PromotionalIncentivePinRow {
  code: string;
  category: string | null;
  dated: string | null;
  amount: number | null;
  status: string;
}

interface DigigoldBuyRow {
  order_id: string;
  buy_date: string | null;
  weight_gm: number | null;
  gold_worth: number | null;
  price_on_day: number | null;
}

export default function AccountDetail() {
  const { memberId } = useParams<{ memberId: string }>();
  const [account, setAccount]   = useState<Account | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [salesIncentive, setSalesIncentive] = useState<SalesIncentiveRow[]>([]);
  const [turnoverSalary, setTurnoverSalary] = useState<TurnoverSalaryRow[]>([]);
  const [breakdowns, setBreakdowns] = useState<Map<number, BreakdownRow[]>>(new Map());
  const [pins, setPins] = useState<PromotionalIncentivePinRow[]>([]);
  const [digigoldBuys, setDigigoldBuys] = useState<DigigoldBuyRow[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!memberId) return;
    fetchData(memberId);
  }, [memberId]);

  async function fetchData(id: string) {
    setLoading(true);
    const [accountRes, snapshotsRes, siRes, tsRes, pinsRes, digigoldRes] = await Promise.all([
      supabase.from("accounts").select("member_id, name, phone_number, upline_member_id").eq("member_id", id).maybeSingle(),
      supabase.from("dashboard_snapshots").select("*").eq("account_id", id).order("captured_at", { ascending: false }),
      supabase.from("sales_incentive").select("*").eq("account_id", id).order("bill_date", { ascending: false }),
      supabase.from("turnover_salary").select("*").eq("account_id", id).order("month", { ascending: false }),
      supabase
        .from("promotional_incentive_pins")
        .select("code, category, dated, amount, status")
        .eq("account_id", id)
        .order("dated", { ascending: true }),
      supabase
        .from("digigold_buy_transactions")
        .select("order_id, buy_date, weight_gm, gold_worth, price_on_day")
        .eq("account_id", id)
        .order("buy_date", { ascending: false }),
    ]);

    setAccount((accountRes.data as Account) ?? null);
    setSnapshots((snapshotsRes.data as Snapshot[]) ?? []);
    setSalesIncentive((siRes.data as SalesIncentiveRow[]) ?? []);
    const tsRows = (tsRes.data as TurnoverSalaryRow[]) ?? [];
    setTurnoverSalary(tsRows);
    setPins((pinsRes.data as PromotionalIncentivePinRow[]) ?? []);
    setDigigoldBuys((digigoldRes.data as DigigoldBuyRow[]) ?? []);

    if (tsRows.length > 0) {
      const { data: breakdownData } = await supabase
        .from("turnover_salary_breakdown")
        .select("turnover_salary_id, from_distributor, distributor_id, tbp_salary")
        .in("turnover_salary_id", tsRows.map((r) => r.id));
      const map = new Map<number, BreakdownRow[]>();
      for (const row of (breakdownData as BreakdownRow[]) ?? []) {
        const list = map.get(row.turnover_salary_id) ?? [];
        list.push(row);
        map.set(row.turnover_salary_id, list);
      }
      setBreakdowns(map);
    }

    setLoading(false);
  }

  function toggleExpanded(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const latest = snapshots[0];

  const pinStatusStyle: Record<string, string> = {
    closed: "bg-green-100 text-green-700",
    active: "bg-blue-100 text-blue-700",
    pending: "bg-amber-100 text-amber-700",
  };

  function exportSalesIncentiveCsv() {
    downloadCsv(
      `sales-incentive-${memberId}.csv`,
      ["Bill Date", "Invoice No", "From", "SI Value", "Status", "Pay Via"],
      salesIncentive.map((r) => [formatDate(r.bill_date), r.invoice_no, r.from_distributor, r.si_value, r.status, r.pay_via])
    );
  }

  function exportTurnoverSalaryCsv() {
    downloadCsv(
      `turnover-salary-${memberId}.csv`,
      ["Month", "Packets", "Total TB Salary", "Charges", "Net Total"],
      turnoverSalary.map((r) => [r.month, r.no_of_packets, r.total_tb_salary, r.charges, r.net_total])
    );
  }

  function exportPromotionalIncentiveCsv() {
    downloadCsv(
      `promotional-incentive-${memberId}.csv`,
      ["Code", "Category", "Dated", "Amount", "Status"],
      pins.map((r) => [r.code, r.category, formatDate(r.dated), r.amount, r.status])
    );
  }

  function exportDigigoldBuyCsv() {
    downloadCsv(
      `digigold-buy-${memberId}.csv`,
      ["Buy Date", "Weight (gm)", "Gold Worth", "Price on Day", "Order ID"],
      digigoldBuys.map((r) => [formatDate(r.buy_date), r.weight_gm, r.gold_worth, r.price_on_day, r.order_id])
    );
  }

  if (loading) {
    return (
      <Layout>
        <div className="px-4 sm:px-8 py-6 sm:py-8">
          <div className="flex items-center justify-center h-48 bg-white rounded-xl border border-maroon-100 shadow-sm">
            <p className="text-sm text-maroon-900/40">Loading…</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (!account) {
    return (
      <Layout>
        <div className="px-4 sm:px-8 py-6 sm:py-8">
          <p className="text-maroon-900/60">Account not found.</p>
          <Link to="/accounts" className="text-maroon-700 hover:underline text-sm">← back to accounts</Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="px-4 sm:px-8 py-6 sm:py-8">
        <Link to="/accounts" className="text-sm text-maroon-700 hover:underline">← Accounts</Link>
        <div className="mt-2 mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-maroon-900">{account.name}</h1>
          <p className="text-sm text-maroon-900/50 mt-0.5 font-mono">{account.member_id} &middot; {account.phone_number}</p>
        </div>

        {latest && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
            {[
              { label: "Business", value: formatINR(latest.my_business) },
              { label: "Promotional Incentive", value: formatINR(latest.my_promotional_incentive) },
              { label: "Distributors", value: formatNumber(latest.my_distributors) },
              { label: "Gross BVolume", value: formatNumber(latest.my_gross_b_volume) },
              { label: "Earning", value: formatINR(latest.my_earning) },
              { label: "Withdraw", value: formatINR(latest.my_withdraw) },
              { label: "TBP Gross BVolume", value: formatNumber(latest.my_tbp_gross_b_volume) },
              { label: "Gift", value: formatNumber(latest.my_gift) },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl border border-maroon-100 shadow-sm px-4 py-4">
                <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">{s.label}</p>
                <p className="text-xl font-bold mt-1.5 text-maroon-900">{s.value}</p>
              </div>
            ))}
          </div>
        )}
        {latest && <p className="text-xs text-maroon-900/40 mb-8">as of {formatDateTime(latest.captured_at)}</p>}

        {/* Sales Incentive */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-maroon-900">Sales Incentive</h2>
          <button
            onClick={exportSalesIncentiveCsv}
            className="text-xs font-medium text-maroon-700 border border-maroon-200 rounded-lg px-3 py-1.5 hover:bg-maroon-50"
          >
            Export CSV
          </button>
        </div>
        <div className="bg-white rounded-xl border border-maroon-100 shadow-sm overflow-hidden mb-8 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-maroon-50 text-left text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">
                <th className="px-4 py-2.5">Bill Date</th>
                <th className="px-4 py-2.5">Invoice No</th>
                <th className="px-4 py-2.5">From</th>
                <th className="px-4 py-2.5">SI Value</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Pay Via</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-maroon-50">
              {salesIncentive.map((r) => (
                <tr key={r.id} className="hover:bg-maroon-50/50">
                  <td className="px-4 py-2.5">{formatDate(r.bill_date)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{r.invoice_no}</td>
                  <td className="px-4 py-2.5">{r.from_distributor}</td>
                  <td className="px-4 py-2.5">{formatINR(r.si_value)}</td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">{r.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-maroon-900/60">{r.pay_via}</td>
                </tr>
              ))}
              {salesIncentive.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-maroon-900/40">No sales incentive records.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Turnover-based Salary */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-maroon-900">Turnover-based Salary</h2>
          <button
            onClick={exportTurnoverSalaryCsv}
            className="text-xs font-medium text-maroon-700 border border-maroon-200 rounded-lg px-3 py-1.5 hover:bg-maroon-50"
          >
            Export CSV
          </button>
        </div>
        <div className="bg-white rounded-xl border border-maroon-100 shadow-sm overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-maroon-50 text-left text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">
                <th className="px-4 py-2.5">Month</th>
                <th className="px-4 py-2.5">Packets</th>
                <th className="px-4 py-2.5">Total TB Salary</th>
                <th className="px-4 py-2.5">Charges</th>
                <th className="px-4 py-2.5">Net Total</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-maroon-50">
              {turnoverSalary.map((r) => (
                <Fragment key={r.id}>
                  <tr className="hover:bg-maroon-50/50">
                    <td className="px-4 py-2.5">{r.month}</td>
                    <td className="px-4 py-2.5">{formatNumber(r.no_of_packets)}</td>
                    <td className="px-4 py-2.5">{formatINR(r.total_tb_salary)}</td>
                    <td className="px-4 py-2.5">{formatINR(r.charges)}</td>
                    <td className="px-4 py-2.5">{formatINR(r.net_total)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => toggleExpanded(r.id)}
                        className="text-xs font-medium text-maroon-700 hover:underline"
                      >
                        {expanded.has(r.id) ? "Hide" : "Breakdown"}
                      </button>
                    </td>
                  </tr>
                  {expanded.has(r.id) && (
                    <tr>
                      <td colSpan={6} className="px-4 py-3 bg-maroon-50/40">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-maroon-900/50 uppercase tracking-wider">
                              <th className="py-1 pr-4">From Distributor</th>
                              <th className="py-1 pr-4">Distributor ID</th>
                              <th className="py-1 pr-4">TBP Salary</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(breakdowns.get(r.id) ?? []).map((b, i) => (
                              <tr key={i}>
                                <td className="py-1 pr-4">{b.from_distributor}</td>
                                <td className="py-1 pr-4 font-mono">{b.distributor_id}</td>
                                <td className="py-1 pr-4">{formatINR(b.tbp_salary)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {turnoverSalary.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-maroon-900/40">No turnover salary records.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Promotional Incentive */}
        <div className="flex items-center justify-between mb-3 mt-8">
          <h2 className="text-lg font-semibold text-maroon-900">Promotional Incentive</h2>
          <button
            onClick={exportPromotionalIncentiveCsv}
            className="text-xs font-medium text-maroon-700 border border-maroon-200 rounded-lg px-3 py-1.5 hover:bg-maroon-50"
          >
            Export CSV
          </button>
        </div>
        <div className="bg-white rounded-xl border border-maroon-100 shadow-sm overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-maroon-50 text-left text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">
                <th className="px-4 py-2.5">Code</th>
                <th className="px-4 py-2.5">Category</th>
                <th className="px-4 py-2.5">Dated</th>
                <th className="px-4 py-2.5">Amount</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-maroon-50">
              {pins.map((p) => (
                <tr key={p.code} className="hover:bg-maroon-50/50">
                  <td className="px-4 py-2.5 font-mono text-xs">{p.code}</td>
                  <td className="px-4 py-2.5">{p.category}</td>
                  <td className="px-4 py-2.5">{formatDate(p.dated)}</td>
                  <td className="px-4 py-2.5">{formatINR(p.amount)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${pinStatusStyle[p.status] ?? "bg-maroon-100 text-maroon-700"}`}>
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
              {pins.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-maroon-900/40">No promotional incentive pins.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* DigiGold Buy History */}
        <div className="flex items-center justify-between mb-3 mt-8">
          <h2 className="text-lg font-semibold text-maroon-900">DigiGold Buy History</h2>
          <button
            onClick={exportDigigoldBuyCsv}
            className="text-xs font-medium text-maroon-700 border border-maroon-200 rounded-lg px-3 py-1.5 hover:bg-maroon-50"
          >
            Export CSV
          </button>
        </div>
        <div className="bg-white rounded-xl border border-maroon-100 shadow-sm overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-maroon-50 text-left text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">
                <th className="px-4 py-2.5">Buy Date</th>
                <th className="px-4 py-2.5">Weight (gm)</th>
                <th className="px-4 py-2.5">Gold Worth</th>
                <th className="px-4 py-2.5">Price on Day</th>
                <th className="px-4 py-2.5">Order ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-maroon-50">
              {digigoldBuys.map((r) => (
                <tr key={r.order_id} className="hover:bg-maroon-50/50">
                  <td className="px-4 py-2.5">{formatDate(r.buy_date)}</td>
                  <td className="px-4 py-2.5">{r.weight_gm}</td>
                  <td className="px-4 py-2.5">{formatINR(r.gold_worth)}</td>
                  <td className="px-4 py-2.5">{formatINR(r.price_on_day)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{r.order_id}</td>
                </tr>
              ))}
              {digigoldBuys.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-maroon-900/40">No DigiGold purchases.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
