import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";
import { formatINR, formatGm, formatDate } from "../lib/format";
import { downloadCsv } from "../lib/csv";

interface AccountRow {
  member_id: string;
  name: string;
}

interface CombinedTransaction {
  date: string | null;
  accountId: string;
  accountName: string;
  type: "Buy" | "Sell";
  weightGm: number | null;
  worth: number | null;
  priceOnDay: number | null; // buy only
  status: string | null; // sell only
  reference: string; // order_id (buy) or transaction_remarks (sell)
}

type GroupMode = "none" | "month" | "account" | "both";

const TYPE_BADGE: Record<string, string> = {
  Buy: "bg-blue-100 text-blue-700",
  Sell: "bg-amber-100 text-amber-700",
};

const SELECT_CLASS = "text-sm border border-maroon-200 rounded-lg px-3 py-1.5 bg-white text-maroon-900";
const LABEL_CLASS = "block text-xs font-semibold text-maroon-900/50 uppercase tracking-wider mb-1";

function monthLabel(yyyyMm: string): string {
  const [year, month] = yyyyMm.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

function summarize(list: CombinedTransaction[]) {
  return list.reduce(
    (acc, t) => ({
      count: acc.count + 1,
      weightGm: acc.weightGm + (t.weightGm ?? 0),
      worth: acc.worth + (t.worth ?? 0),
    }),
    { count: 0, weightGm: 0, worth: 0 }
  );
}

function transactionRow(t: CombinedTransaction, dense: boolean) {
  const pad = dense ? "py-1 pr-4" : "px-5 py-3";
  return (
    <tr key={`${t.type}-${t.reference}`} className={dense ? "" : "hover:bg-maroon-50/50"}>
      <td className={pad}>{formatDate(t.date)}</td>
      <td className={pad}>
        <Link to={`/accounts/${t.accountId}`} className={dense ? "text-maroon-700 hover:underline" : "font-medium text-maroon-700 hover:underline"}>
          {t.accountName}
        </Link>
      </td>
      <td className={pad}>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_BADGE[t.type]}`}>{t.type}</span>
      </td>
      <td className={pad}>{formatGm(t.weightGm)}</td>
      <td className={pad}>{formatINR(t.worth)}</td>
      <td className={pad}>{formatINR(t.priceOnDay)}</td>
      <td className={pad}>{t.status ?? "—"}</td>
      <td className={`${pad} font-mono ${dense ? "" : "text-xs"}`}>{t.reference}</td>
    </tr>
  );
}

function DetailTable({ rows }: { rows: CombinedTransaction[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-maroon-900/50">
          <th className="py-1 pr-4">Date</th>
          <th className="py-1 pr-4">Account</th>
          <th className="py-1 pr-4">Type</th>
          <th className="py-1 pr-4">Weight (gm)</th>
          <th className="py-1 pr-4">Worth</th>
          <th className="py-1 pr-4">Price on Day</th>
          <th className="py-1 pr-4">Status</th>
          <th className="py-1 pr-4">Reference</th>
        </tr>
      </thead>
      <tbody>{rows.map((t) => transactionRow(t, true))}</tbody>
    </table>
  );
}

export default function DigigoldTransactions() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [transactions, setTransactions] = useState<CombinedTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterAccount, setFilterAccount] = useState("");
  const [filterType, setFilterType] = useState<"" | "Buy" | "Sell">("");
  const [dateMode, setDateMode] = useState("all"); // "all" | "custom" | "YYYY-MM"
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [groupBy, setGroupBy] = useState<GroupMode>("none");

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedSubgroups, setExpandedSubgroups] = useState<Set<string>>(new Set());

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function toggleSubgroup(key: string) {
    setExpandedSubgroups((prev) => {
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

    const accountList = (accountsRes.data as AccountRow[]) ?? [];
    const nameOf = new Map(accountList.map((a) => [a.member_id, a.name]));

    const buys: CombinedTransaction[] = (
      (buyRes.data as {
        account_id: string;
        order_id: string;
        buy_date: string | null;
        weight_gm: number | null;
        gold_worth: number | null;
        price_on_day: number | null;
      }[]) ?? []
    ).map((r) => ({
      date: r.buy_date,
      accountId: r.account_id,
      accountName: nameOf.get(r.account_id) ?? r.account_id,
      type: "Buy",
      weightGm: r.weight_gm,
      worth: r.gold_worth,
      priceOnDay: r.price_on_day,
      status: null,
      reference: r.order_id,
    }));

    const sells: CombinedTransaction[] = (
      (sellRes.data as {
        account_id: string;
        transaction_remarks: string;
        sell_date: string | null;
        weight_gm: number | null;
        gold_worth: number | null;
        status: string | null;
      }[]) ?? []
    ).map((r) => ({
      date: r.sell_date,
      accountId: r.account_id,
      accountName: nameOf.get(r.account_id) ?? r.account_id,
      type: "Sell",
      weightGm: r.weight_gm,
      worth: r.gold_worth,
      priceOnDay: null,
      status: r.status,
      reference: r.transaction_remarks,
    }));

    const combined = [...buys, ...sells].sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.localeCompare(a.date);
    });

    setAccounts(accountList);
    setTransactions(combined);
    setLoading(false);
  }

  function accountNameOf(id: string) {
    return accounts.find((a) => a.member_id === id)?.name ?? id;
  }

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) {
      if (t.date) set.add(t.date.slice(0, 7));
    }
    return [...set].sort().reverse();
  }, [transactions]);

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (filterAccount && t.accountId !== filterAccount) return false;
      if (filterType && t.type !== filterType) return false;
      if (dateMode === "custom") {
        if (customFrom && (!t.date || t.date < customFrom)) return false;
        if (customTo && (!t.date || t.date > customTo)) return false;
      } else if (dateMode !== "all") {
        if (!t.date || t.date.slice(0, 7) !== dateMode) return false;
      }
      return true;
    });
  }, [transactions, filterAccount, filterType, dateMode, customFrom, customTo]);

  const summary = useMemo(() => summarize(filtered), [filtered]);

  const monthGroups = useMemo(() => {
    const map = new Map<string, CombinedTransaction[]>();
    for (const t of filtered) {
      const key = t.date ? t.date.slice(0, 7) : "unknown";
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const accountGroups = useMemo(() => {
    const map = new Map<string, CombinedTransaction[]>();
    for (const t of filtered) {
      const list = map.get(t.accountId) ?? [];
      list.push(t);
      map.set(t.accountId, list);
    }
    return [...map.entries()].sort((a, b) => summarize(b[1]).worth - summarize(a[1]).worth);
  }, [filtered]);

  function exportCsv() {
    downloadCsv(
      "digigold-transactions.csv",
      ["Date", "Account", "Type", "Weight (gm)", "Worth", "Price on Day", "Status", "Reference"],
      filtered.map((t) => [formatDate(t.date), t.accountName, t.type, t.weightGm, t.worth, t.priceOnDay, t.status, t.reference])
    );
  }

  return (
    <Layout>
      <div className="px-4 sm:px-8 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-maroon-900">Digi-Gold Transactions</h1>
          <p className="text-sm text-maroon-900/50 mt-0.5">Every Buy and Sell transaction, across all accounts</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">Transactions</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{summary.count}</p>
            <p className="text-xs text-maroon-900/40 mt-1">matching current filters</p>
          </div>
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">Total Weight</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{formatGm(summary.weightGm)}</p>
            <p className="text-xs text-maroon-900/40 mt-1">matching current filters</p>
          </div>
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">Total Worth</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{formatINR(summary.worth)}</p>
            <p className="text-xs text-maroon-900/40 mt-1">matching current filters</p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className={LABEL_CLASS}>Account</label>
            <select value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)} className={SELECT_CLASS}>
              <option value="">All Accounts</option>
              {accounts.map((a) => (
                <option key={a.member_id} value={a.member_id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS}>Type</label>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value as "" | "Buy" | "Sell")} className={SELECT_CLASS}>
              <option value="">All Types</option>
              <option value="Buy">Buy</option>
              <option value="Sell">Sell</option>
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS}>Date</label>
            <select value={dateMode} onChange={(e) => setDateMode(e.target.value)} className={SELECT_CLASS}>
              <option value="all">All Time</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
              <option value="custom">Custom Range</option>
            </select>
          </div>
          {dateMode === "custom" && (
            <>
              <div>
                <label className={LABEL_CLASS}>From</label>
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className={SELECT_CLASS} />
              </div>
              <div>
                <label className={LABEL_CLASS}>To</label>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className={SELECT_CLASS} />
              </div>
            </>
          )}
          <div>
            <label className={LABEL_CLASS}>Group by</label>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupMode)} className={SELECT_CLASS}>
              <option value="none">None</option>
              <option value="month">By Month</option>
              <option value="account">By Account</option>
              <option value="both">By Month &amp; Account</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48 bg-white rounded-xl border border-maroon-100 shadow-sm">
            <p className="text-sm text-maroon-900/40">Loading…</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-maroon-900">Transactions</h2>
              <button onClick={exportCsv} className="text-xs font-medium text-maroon-700 border border-maroon-200 rounded-lg px-3 py-1.5 hover:bg-maroon-50">
                Export CSV
              </button>
            </div>

            {groupBy === "none" && (
              <div className="bg-white rounded-xl border border-maroon-100 shadow-sm overflow-hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-maroon-50 text-left text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">
                      <th className="px-5 py-3">Date</th>
                      <th className="px-5 py-3">Account</th>
                      <th className="px-5 py-3">Type</th>
                      <th className="px-5 py-3">Weight (gm)</th>
                      <th className="px-5 py-3">Worth</th>
                      <th className="px-5 py-3">Price on Day</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Reference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-maroon-50">
                    {filtered.map((t) => transactionRow(t, false))}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-5 py-8 text-center text-maroon-900/40">
                          No transactions match these filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {groupBy === "month" && (
              <div className="bg-white rounded-xl border border-maroon-100 shadow-sm overflow-hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-maroon-50 text-left text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">
                      <th className="px-5 py-3">Month</th>
                      <th className="px-5 py-3">Transactions</th>
                      <th className="px-5 py-3">Weight</th>
                      <th className="px-5 py-3">Worth</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-maroon-50">
                    {monthGroups.map(([key, list]) => {
                      const s = summarize(list);
                      return (
                        <Fragment key={key}>
                          <tr className="hover:bg-maroon-50/50">
                            <td className="px-5 py-3 font-medium text-maroon-900">{key === "unknown" ? "Unknown date" : monthLabel(key)}</td>
                            <td className="px-5 py-3">{s.count}</td>
                            <td className="px-5 py-3">{formatGm(s.weightGm)}</td>
                            <td className="px-5 py-3 font-semibold">{formatINR(s.worth)}</td>
                            <td className="px-5 py-3 text-right">
                              <button onClick={() => toggleGroup(key)} className="text-xs font-medium text-maroon-700 hover:underline">
                                {expandedGroups.has(key) ? "Hide" : "Breakdown"}
                              </button>
                            </td>
                          </tr>
                          {expandedGroups.has(key) && (
                            <tr>
                              <td colSpan={5} className="px-4 py-3 bg-maroon-50/40">
                                <DetailTable rows={list} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {monthGroups.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-5 py-8 text-center text-maroon-900/40">
                          No transactions match these filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {groupBy === "account" && (
              <div className="bg-white rounded-xl border border-maroon-100 shadow-sm overflow-hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-maroon-50 text-left text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">
                      <th className="px-5 py-3">Account</th>
                      <th className="px-5 py-3">Transactions</th>
                      <th className="px-5 py-3">Weight</th>
                      <th className="px-5 py-3">Worth</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-maroon-50">
                    {accountGroups.map(([accountId, list]) => {
                      const s = summarize(list);
                      return (
                        <Fragment key={accountId}>
                          <tr className="hover:bg-maroon-50/50">
                            <td className="px-5 py-3">
                              <Link to={`/accounts/${accountId}`} className="font-medium text-maroon-700 hover:underline">
                                {accountNameOf(accountId)}
                              </Link>
                            </td>
                            <td className="px-5 py-3">{s.count}</td>
                            <td className="px-5 py-3">{formatGm(s.weightGm)}</td>
                            <td className="px-5 py-3 font-semibold">{formatINR(s.worth)}</td>
                            <td className="px-5 py-3 text-right">
                              <button onClick={() => toggleGroup(accountId)} className="text-xs font-medium text-maroon-700 hover:underline">
                                {expandedGroups.has(accountId) ? "Hide" : "Breakdown"}
                              </button>
                            </td>
                          </tr>
                          {expandedGroups.has(accountId) && (
                            <tr>
                              <td colSpan={5} className="px-4 py-3 bg-maroon-50/40">
                                <DetailTable rows={list} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {accountGroups.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-5 py-8 text-center text-maroon-900/40">
                          No transactions match these filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {groupBy === "both" && (
              <div className="bg-white rounded-xl border border-maroon-100 shadow-sm overflow-hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-maroon-50 text-left text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">
                      <th className="px-5 py-3">Month</th>
                      <th className="px-5 py-3">Transactions</th>
                      <th className="px-5 py-3">Weight</th>
                      <th className="px-5 py-3">Worth</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-maroon-50">
                    {monthGroups.map(([monthKey, monthList]) => {
                      const s = summarize(monthList);
                      const byAccount = new Map<string, CombinedTransaction[]>();
                      for (const t of monthList) {
                        const list = byAccount.get(t.accountId) ?? [];
                        list.push(t);
                        byAccount.set(t.accountId, list);
                      }
                      const accountEntries = [...byAccount.entries()].sort((a, b) => summarize(b[1]).worth - summarize(a[1]).worth);
                      return (
                        <Fragment key={monthKey}>
                          <tr className="hover:bg-maroon-50/50">
                            <td className="px-5 py-3 font-medium text-maroon-900">{monthKey === "unknown" ? "Unknown date" : monthLabel(monthKey)}</td>
                            <td className="px-5 py-3">{s.count}</td>
                            <td className="px-5 py-3">{formatGm(s.weightGm)}</td>
                            <td className="px-5 py-3 font-semibold">{formatINR(s.worth)}</td>
                            <td className="px-5 py-3 text-right">
                              <button onClick={() => toggleGroup(monthKey)} className="text-xs font-medium text-maroon-700 hover:underline">
                                {expandedGroups.has(monthKey) ? "Hide" : "Breakdown"}
                              </button>
                            </td>
                          </tr>
                          {expandedGroups.has(monthKey) &&
                            accountEntries.map(([accountId, accList]) => {
                              const as = summarize(accList);
                              const subKey = `${monthKey}|${accountId}`;
                              return (
                                <Fragment key={subKey}>
                                  <tr className="bg-maroon-50/40">
                                    <td className="pl-8 pr-4 py-2">
                                      <Link to={`/accounts/${accountId}`} className="text-maroon-700 hover:underline text-sm">
                                        {accountNameOf(accountId)}
                                      </Link>
                                    </td>
                                    <td className="px-4 py-2 text-sm">{as.count}</td>
                                    <td className="px-4 py-2 text-sm">{formatGm(as.weightGm)}</td>
                                    <td className="px-4 py-2 text-sm font-semibold">{formatINR(as.worth)}</td>
                                    <td className="px-4 py-2 text-right">
                                      <button onClick={() => toggleSubgroup(subKey)} className="text-xs font-medium text-maroon-700 hover:underline">
                                        {expandedSubgroups.has(subKey) ? "Hide" : "Details"}
                                      </button>
                                    </td>
                                  </tr>
                                  {expandedSubgroups.has(subKey) && (
                                    <tr>
                                      <td colSpan={5} className="px-4 py-3 bg-maroon-100/40">
                                        <DetailTable rows={accList} />
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                        </Fragment>
                      );
                    })}
                    {monthGroups.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-5 py-8 text-center text-maroon-900/40">
                          No transactions match these filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
