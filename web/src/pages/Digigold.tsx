import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";
import { formatINR, formatGm, formatDate } from "../lib/format";
import { downloadCsv } from "../lib/csv";

interface AccountRow {
  member_id: string;
  name: string;
}

interface DigigoldTotals {
  boughtGm: number;
  boughtWorth: number;
  soldGm: number;
  soldWorth: number;
}

interface BuyDetail {
  order_id: string;
  buy_date: string | null;
  weight_gm: number | null;
  gold_worth: number | null;
  price_on_day: number | null;
}

interface SellDetail {
  transaction_remarks: string;
  sell_date: string | null;
  weight_gm: number | null;
  gold_worth: number | null;
  status: string | null;
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

function emptyTotals(): DigigoldTotals {
  return { boughtGm: 0, boughtWorth: 0, soldGm: 0, soldWorth: 0 };
}

function netGm(t: DigigoldTotals) {
  return t.boughtGm - t.soldGm;
}
function netWorth(t: DigigoldTotals) {
  return t.boughtWorth - t.soldWorth;
}

export default function Digigold() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [totals, setTotals] = useState<Map<string, DigigoldTotals>>(new Map());
  const [monthlyTotals, setMonthlyTotals] = useState<Map<string, DigigoldTotals>>(new Map());
  const [monthlyByAccount, setMonthlyByAccount] = useState<Map<string, Map<string, DigigoldTotals>>>(new Map());
  const [buyDetails, setBuyDetails] = useState<Map<string, BuyDetail[]>>(new Map());
  const [sellDetails, setSellDetails] = useState<Map<string, SellDetail[]>>(new Map());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [expandedAccountMonths, setExpandedAccountMonths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

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

    const [accountsRes, buyRes, sellRes] = await Promise.all([
      supabase.from("accounts").select("member_id, name").order("name"),
      supabase
        .from("digigold_buy_transactions")
        .select("account_id, order_id, buy_date, weight_gm, gold_worth, price_on_day"),
      supabase
        .from("digigold_sell_transactions")
        .select("account_id, transaction_remarks, sell_date, weight_gm, gold_worth, status"),
    ]);

    const byAccount = new Map<string, DigigoldTotals>();
    const ensureAccount = (id: string) => {
      if (!byAccount.has(id)) byAccount.set(id, emptyTotals());
      return byAccount.get(id)!;
    };

    const byMonth = new Map<string, DigigoldTotals>();
    const ensureMonth = (key: string) => {
      if (!byMonth.has(key)) byMonth.set(key, emptyTotals());
      return byMonth.get(key)!;
    };

    const byMonthByAccount = new Map<string, Map<string, DigigoldTotals>>();
    const ensureMonthAccount = (monthKey: string, accountId: string) => {
      if (!byMonthByAccount.has(monthKey)) byMonthByAccount.set(monthKey, new Map());
      const accMap = byMonthByAccount.get(monthKey)!;
      if (!accMap.has(accountId)) accMap.set(accountId, emptyTotals());
      return accMap.get(accountId)!;
    };

    const buyByMonthAccount = new Map<string, BuyDetail[]>();
    const sellByMonthAccount = new Map<string, SellDetail[]>();

    for (const row of (buyRes.data as (BuyDetail & { account_id: string })[]) ?? []) {
      ensureAccount(row.account_id).boughtGm += row.weight_gm ?? 0;
      ensureAccount(row.account_id).boughtWorth += row.gold_worth ?? 0;
      if (row.buy_date) {
        const monthKey = row.buy_date.slice(0, 7);
        ensureMonth(monthKey).boughtGm += row.weight_gm ?? 0;
        ensureMonth(monthKey).boughtWorth += row.gold_worth ?? 0;
        ensureMonthAccount(monthKey, row.account_id).boughtGm += row.weight_gm ?? 0;
        ensureMonthAccount(monthKey, row.account_id).boughtWorth += row.gold_worth ?? 0;

        const key = monthAccountKey(monthKey, row.account_id);
        const list = buyByMonthAccount.get(key) ?? [];
        list.push(row);
        buyByMonthAccount.set(key, list);
      }
    }
    for (const row of (sellRes.data as (SellDetail & { account_id: string })[]) ?? []) {
      ensureAccount(row.account_id).soldGm += row.weight_gm ?? 0;
      ensureAccount(row.account_id).soldWorth += row.gold_worth ?? 0;
      if (row.sell_date) {
        const monthKey = row.sell_date.slice(0, 7);
        ensureMonth(monthKey).soldGm += row.weight_gm ?? 0;
        ensureMonth(monthKey).soldWorth += row.gold_worth ?? 0;
        ensureMonthAccount(monthKey, row.account_id).soldGm += row.weight_gm ?? 0;
        ensureMonthAccount(monthKey, row.account_id).soldWorth += row.gold_worth ?? 0;

        const key = monthAccountKey(monthKey, row.account_id);
        const list = sellByMonthAccount.get(key) ?? [];
        list.push(row);
        sellByMonthAccount.set(key, list);
      }
    }

    setAccounts((accountsRes.data as AccountRow[]) ?? []);
    setTotals(byAccount);
    setMonthlyTotals(byMonth);
    setMonthlyByAccount(byMonthByAccount);
    setBuyDetails(buyByMonthAccount);
    setSellDetails(sellByMonthAccount);
    setLoading(false);
  }

  const grandBoughtGm = [...totals.values()].reduce((s, t) => s + t.boughtGm, 0);
  const grandBoughtWorth = [...totals.values()].reduce((s, t) => s + t.boughtWorth, 0);
  const grandSoldGm = [...totals.values()].reduce((s, t) => s + t.soldGm, 0);
  const grandSoldWorth = [...totals.values()].reduce((s, t) => s + t.soldWorth, 0);
  const grandNetGm = grandBoughtGm - grandSoldGm;
  const grandNetWorth = grandBoughtWorth - grandSoldWorth;

  const monthKeys = [...monthlyTotals.keys()].sort().reverse();

  function exportByAccountCsv() {
    downloadCsv(
      "digigold-by-account.csv",
      ["Name", "Member ID", "Bought (gm)", "Bought Worth", "Sold (gm)", "Sold Worth", "Net (gm)", "Net Worth"],
      accounts.map((a) => {
        const t = totals.get(a.member_id) ?? emptyTotals();
        return [a.name, a.member_id, t.boughtGm, t.boughtWorth, t.soldGm, t.soldWorth, netGm(t), netWorth(t)];
      })
    );
  }

  function exportByMonthCsv() {
    downloadCsv(
      "digigold-by-month.csv",
      ["Month", "Bought (gm)", "Bought Worth", "Sold (gm)", "Sold Worth", "Net (gm)", "Net Worth"],
      monthKeys.map((key) => {
        const t = monthlyTotals.get(key)!;
        return [monthLabel(key), t.boughtGm, t.boughtWorth, t.soldGm, t.soldWorth, netGm(t), netWorth(t)];
      })
    );
  }

  return (
    <Layout>
      <div className="px-4 sm:px-8 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-maroon-900">Digi-Gold</h1>
          <p className="text-sm text-maroon-900/50 mt-0.5">Buy and Sell transaction history, across all accounts</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">Bought</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{formatGm(grandBoughtGm)}</p>
            <p className="text-xs text-maroon-900/40 mt-1">worth {formatINR(grandBoughtWorth)}</p>
          </div>
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">Sold</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{formatGm(grandSoldGm)}</p>
            <p className="text-xs text-maroon-900/40 mt-1">worth {formatINR(grandSoldWorth)}</p>
          </div>
          <div className="bg-gold-500 rounded-xl shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/60 uppercase tracking-wider">Net Holdings</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{formatGm(grandNetGm)}</p>
            <p className="text-xs text-maroon-900/60 mt-1">worth {formatINR(grandNetWorth)}</p>
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
                    <th className="px-5 py-3">Bought</th>
                    <th className="px-5 py-3">Sold</th>
                    <th className="px-5 py-3">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-maroon-50">
                  {accounts.map((a) => {
                    const t = totals.get(a.member_id) ?? emptyTotals();
                    return (
                      <tr key={a.member_id} className="hover:bg-maroon-50/50">
                        <td className="px-5 py-3">
                          <Link to={`/accounts/${a.member_id}`} className="font-medium text-maroon-700 hover:underline">
                            {a.name}
                          </Link>
                        </td>
                        <td className="px-5 py-3">
                          {formatGm(t.boughtGm)} <span className="text-maroon-900/40">· {formatINR(t.boughtWorth)}</span>
                        </td>
                        <td className="px-5 py-3">
                          {formatGm(t.soldGm)} <span className="text-maroon-900/40">· {formatINR(t.soldWorth)}</span>
                        </td>
                        <td className="px-5 py-3 font-semibold">
                          {formatGm(netGm(t))} <span className="text-maroon-900/40 font-normal">· {formatINR(netWorth(t))}</span>
                        </td>
                      </tr>
                    );
                  })}
                  {accounts.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-maroon-900/40">
                        No accounts yet.
                      </td>
                    </tr>
                  )}
                </tbody>
                {accounts.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-maroon-200 bg-maroon-50 font-semibold">
                      <td className="px-5 py-3">Total</td>
                      <td className="px-5 py-3">
                        {formatGm(grandBoughtGm)} <span className="text-maroon-900/50 font-normal">· {formatINR(grandBoughtWorth)}</span>
                      </td>
                      <td className="px-5 py-3">
                        {formatGm(grandSoldGm)} <span className="text-maroon-900/50 font-normal">· {formatINR(grandSoldWorth)}</span>
                      </td>
                      <td className="px-5 py-3">
                        {formatGm(grandNetGm)} <span className="text-maroon-900/50 font-normal">· {formatINR(grandNetWorth)}</span>
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-maroon-900">By Month</h2>
              <button
                onClick={exportByMonthCsv}
                className="text-xs font-medium text-maroon-700 border border-maroon-200 rounded-lg px-3 py-1.5 hover:bg-maroon-50"
              >
                Export CSV
              </button>
            </div>
            <div className="bg-white rounded-xl border border-maroon-100 shadow-sm overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-maroon-50 text-left text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">
                    <th className="px-5 py-3">Month</th>
                    <th className="px-5 py-3">Bought</th>
                    <th className="px-5 py-3">Sold</th>
                    <th className="px-5 py-3">Net</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-maroon-50">
                  {monthKeys.map((key) => {
                    const t = monthlyTotals.get(key)!;
                    const accountBreakdown = [...(monthlyByAccount.get(key) ?? new Map())].sort(
                      (a, b) => netWorth(b[1]) - netWorth(a[1])
                    );
                    return (
                      <Fragment key={key}>
                        <tr className="hover:bg-maroon-50/50">
                          <td className="px-5 py-3 font-medium text-maroon-900">{monthLabel(key)}</td>
                          <td className="px-5 py-3">
                            {formatGm(t.boughtGm)} <span className="text-maroon-900/40">· {formatINR(t.boughtWorth)}</span>
                          </td>
                          <td className="px-5 py-3">
                            {formatGm(t.soldGm)} <span className="text-maroon-900/40">· {formatINR(t.soldWorth)}</span>
                          </td>
                          <td className="px-5 py-3 font-semibold">
                            {formatGm(netGm(t))} <span className="text-maroon-900/40 font-normal">· {formatINR(netWorth(t))}</span>
                          </td>
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
                            const buys = buyDetails.get(amKey) ?? [];
                            const sells = sellDetails.get(amKey) ?? [];
                            return (
                              <Fragment key={amKey}>
                                <tr className="bg-maroon-50/40">
                                  <td className="pl-8 pr-4 py-2">
                                    <Link to={`/accounts/${accountId}`} className="text-maroon-700 hover:underline text-sm">
                                      {accountName}
                                    </Link>
                                  </td>
                                  <td className="px-4 py-2 text-sm">
                                    {formatGm(at.boughtGm)} <span className="text-maroon-900/40">· {formatINR(at.boughtWorth)}</span>
                                  </td>
                                  <td className="px-4 py-2 text-sm">
                                    {formatGm(at.soldGm)} <span className="text-maroon-900/40">· {formatINR(at.soldWorth)}</span>
                                  </td>
                                  <td className="px-4 py-2 text-sm font-semibold">
                                    {formatGm(netGm(at))} <span className="text-maroon-900/40 font-normal">· {formatINR(netWorth(at))}</span>
                                  </td>
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
                                    <td colSpan={5} className="px-4 py-3 bg-maroon-100/40">
                                      {buys.length > 0 && (
                                        <div className="mb-3">
                                          <p className="text-xs font-semibold text-maroon-900/50 uppercase tracking-wider mb-1">
                                            Bought
                                          </p>
                                          <table className="w-full text-xs">
                                            <thead>
                                              <tr className="text-left text-maroon-900/50">
                                                <th className="py-1 pr-4">Buy Date</th>
                                                <th className="py-1 pr-4">Weight (gm)</th>
                                                <th className="py-1 pr-4">Gold Worth</th>
                                                <th className="py-1 pr-4">Price on Day</th>
                                                <th className="py-1 pr-4">Order ID</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {buys.map((r) => (
                                                <tr key={r.order_id}>
                                                  <td className="py-1 pr-4">{formatDate(r.buy_date)}</td>
                                                  <td className="py-1 pr-4">{r.weight_gm}</td>
                                                  <td className="py-1 pr-4">{formatINR(r.gold_worth)}</td>
                                                  <td className="py-1 pr-4">{formatINR(r.price_on_day)}</td>
                                                  <td className="py-1 pr-4 font-mono">{r.order_id}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      )}
                                      {sells.length > 0 && (
                                        <div>
                                          <p className="text-xs font-semibold text-maroon-900/50 uppercase tracking-wider mb-1">
                                            Sold
                                          </p>
                                          <table className="w-full text-xs">
                                            <thead>
                                              <tr className="text-left text-maroon-900/50">
                                                <th className="py-1 pr-4">Sell Date</th>
                                                <th className="py-1 pr-4">Weight (gm)</th>
                                                <th className="py-1 pr-4">Gold Worth</th>
                                                <th className="py-1 pr-4">Status</th>
                                                <th className="py-1 pr-4">Remarks</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {sells.map((r) => (
                                                <tr key={r.transaction_remarks}>
                                                  <td className="py-1 pr-4">{formatDate(r.sell_date)}</td>
                                                  <td className="py-1 pr-4">{r.weight_gm}</td>
                                                  <td className="py-1 pr-4">{formatINR(r.gold_worth)}</td>
                                                  <td className="py-1 pr-4">{r.status}</td>
                                                  <td className="py-1 pr-4 font-mono">{r.transaction_remarks}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      )}
                                      {buys.length === 0 && sells.length === 0 && (
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
                      <td colSpan={5} className="px-5 py-8 text-center text-maroon-900/40">
                        No Digi-Gold data yet.
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
