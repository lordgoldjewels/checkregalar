import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";
import { formatINR, formatDate } from "../lib/format";
import { downloadCsv } from "../lib/csv";
import { SI_PAYOUT_RATE, PROMO_PAYOUT_RATE, PAID_PIN_STATUSES, tbpNet } from "../lib/income";

interface AccountRow {
  member_id: string;
  name: string;
}

type IncomeType = "Sales Incentive" | "Turnover Salary" | "Promotional Incentive";

interface IncomeTransaction {
  key: string;
  date: string | null; // Turnover Salary has only a month: dated the 1st
  accountId: string;
  accountName: string;
  type: IncomeType;
  reference: string; // invoice no / salary month / pin code
  detail: string | null; // from distributor / packet count
  gross: number;
  net: number; // what is actually paid out (see lib/income.ts)
  status: string;
  paid: boolean;
}

type GroupMode = "none" | "month" | "account" | "both";
type StatusFilter = "paid" | "unpaid" | "all";

const TYPES: IncomeType[] = ["Sales Incentive", "Turnover Salary", "Promotional Incentive"];

const TYPE_BADGE: Record<IncomeType, string> = {
  "Sales Incentive": "bg-blue-100 text-blue-700",
  "Turnover Salary": "bg-purple-100 text-purple-700",
  "Promotional Incentive": "bg-amber-100 text-amber-700",
};

const NET_RULE: Record<IncomeType, string> = {
  "Sales Incentive": "less TDS 5% + service 5%",
  "Turnover Salary": "less 10%",
  "Promotional Incentive": "pins paid out at 50%",
};

const SELECT_CLASS = "text-sm border border-maroon-200 rounded-lg px-3 py-1.5 bg-white text-maroon-900";
const LABEL_CLASS = "block text-xs font-semibold text-maroon-900/50 uppercase tracking-wider mb-1";
const BUTTON_CLASS = "text-xs font-medium text-maroon-700 border border-maroon-200 rounded-lg px-3 py-1.5 hover:bg-maroon-50";

function monthLabel(yyyyMm: string): string {
  const [year, month] = yyyyMm.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

function emptyByType(): Record<IncomeType, number> {
  return { "Sales Incentive": 0, "Turnover Salary": 0, "Promotional Incentive": 0 };
}

function summarize(list: IncomeTransaction[]) {
  const grossByType = emptyByType();
  const netByType = emptyByType();
  let gross = 0;
  let net = 0;
  for (const t of list) {
    gross += t.gross;
    net += t.net;
    grossByType[t.type] += t.gross;
    netByType[t.type] += t.net;
  }
  return { count: list.length, gross, net, grossByType, netByType };
}

function transactionRow(t: IncomeTransaction, dense: boolean) {
  const pad = dense ? "py-1 pr-4" : "px-5 py-3";
  return (
    <tr key={t.key} className={dense ? "" : "hover:bg-maroon-50/50"}>
      <td className={pad}>{t.type === "Turnover Salary" && t.date ? monthLabel(t.date.slice(0, 7)) : formatDate(t.date)}</td>
      <td className={pad}>
        <Link to={`/accounts/${t.accountId}`} className={dense ? "text-maroon-700 hover:underline" : "font-medium text-maroon-700 hover:underline"}>
          {t.accountName}
        </Link>
      </td>
      <td className={pad}>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${TYPE_BADGE[t.type]}`}>{t.type}</span>
      </td>
      <td className={`${pad} font-mono ${dense ? "" : "text-xs"}`}>{t.reference}</td>
      <td className={pad}>{t.detail ?? "—"}</td>
      <td className={`${pad} text-maroon-900/50`}>{formatINR(t.gross)}</td>
      <td className={`${pad} font-semibold`}>{formatINR(t.net)}</td>
      <td className={pad}>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${t.paid ? "bg-green-100 text-green-700" : "bg-maroon-100 text-maroon-700"}`}>
          {t.status}
        </span>
      </td>
    </tr>
  );
}

function DetailTable({ rows }: { rows: IncomeTransaction[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-maroon-900/50">
          <th className="py-1 pr-4">Date</th>
          <th className="py-1 pr-4">Account</th>
          <th className="py-1 pr-4">Type</th>
          <th className="py-1 pr-4">Reference</th>
          <th className="py-1 pr-4">From / Detail</th>
          <th className="py-1 pr-4">Gross</th>
          <th className="py-1 pr-4">Net</th>
          <th className="py-1 pr-4">Status</th>
        </tr>
      </thead>
      <tbody>{rows.map((t) => transactionRow(t, true))}</tbody>
    </table>
  );
}

// Group-row cells shared by the month / account / both views.
function GroupCells({ list, sub = false }: { list: IncomeTransaction[]; sub?: boolean }) {
  const s = summarize(list);
  const pad = sub ? "px-4 py-2 text-sm" : "px-5 py-3";
  return (
    <>
      <td className={pad}>{s.count}</td>
      <td className={`${pad} text-maroon-900/50`}>{formatINR(s.gross)}</td>
      {TYPES.map((type) => (
        <td key={type} className={pad}>{s.netByType[type] ? formatINR(s.netByType[type]) : "—"}</td>
      ))}
      <td className={`${pad} font-semibold`}>{formatINR(s.net)}</td>
    </>
  );
}

const GROUP_HEADERS = ["Transactions", "Gross", "Sales Incentive (Net)", "Turnover Salary (Net)", "Promotional (Net)", "Total (Net)"];

export default function IncomeTransactions() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [transactions, setTransactions] = useState<IncomeTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterAccount, setFilterAccount] = useState("");
  const [filterType, setFilterType] = useState<"" | IncomeType>("");
  // Paid by default so the totals match the Income page.
  const [filterStatus, setFilterStatus] = useState<StatusFilter>("paid");
  const [dateMode, setDateMode] = useState("all"); // "all" | "custom" | "YYYY-MM"
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [groupBy, setGroupBy] = useState<GroupMode>("none");

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedSubgroups, setExpandedSubgroups] = useState<Set<string>>(new Set());

  function toggle(setter: typeof setExpandedGroups, key: string) {
    setter((prev) => {
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

    const [accountsRes, siRes, tsRes, pinsRes] = await Promise.all([
      supabase.from("accounts").select("member_id, name").order("name"),
      supabase.from("sales_incentive").select("account_id, bill_date, invoice_no, from_distributor, si_value, status"),
      supabase.from("turnover_salary").select("account_id, month, no_of_packets, total_tb_salary, net_total"),
      supabase.from("promotional_incentive_pins").select("account_id, code, dated, amount, status"),
    ]);

    const accountList = (accountsRes.data as AccountRow[]) ?? [];
    const nameOf = new Map(accountList.map((a) => [a.member_id, a.name]));

    const salesIncentive: IncomeTransaction[] = (
      (siRes.data as {
        account_id: string;
        bill_date: string | null;
        invoice_no: string;
        from_distributor: string | null;
        si_value: number | null;
        status: string | null;
      }[]) ?? []
    ).map((r) => {
      const gross = Number(r.si_value ?? 0);
      const status = (r.status ?? "—").toLowerCase();
      return {
        key: `si-${r.account_id}-${r.invoice_no}`,
        date: r.bill_date,
        accountId: r.account_id,
        accountName: nameOf.get(r.account_id) ?? r.account_id,
        type: "Sales Incentive",
        reference: r.invoice_no,
        detail: r.from_distributor,
        gross,
        net: gross * SI_PAYOUT_RATE,
        status,
        paid: status === "paid",
      };
    });

    const turnoverSalary: IncomeTransaction[] = (
      (tsRes.data as {
        account_id: string;
        month: string; // "MM-YYYY"
        no_of_packets: number | null;
        total_tb_salary: number | null;
        net_total: number | null;
      }[]) ?? []
    ).map((r) => {
      const [mm, yyyy] = r.month.split("-");
      return {
        key: `ts-${r.account_id}-${r.month}`,
        date: mm && yyyy ? `${yyyy}-${mm}-01` : null,
        accountId: r.account_id,
        accountName: nameOf.get(r.account_id) ?? r.account_id,
        type: "Turnover Salary",
        reference: r.month,
        detail: r.no_of_packets != null ? `${r.no_of_packets} packet${r.no_of_packets === 1 ? "" : "s"}` : null,
        gross: Number(r.total_tb_salary ?? 0),
        net: tbpNet(r),
        // Stored salary months are ones the site has credited.
        status: "paid",
        paid: true,
      };
    });

    const promotional: IncomeTransaction[] = (
      (pinsRes.data as { account_id: string; code: string; dated: string | null; amount: number | null; status: string }[]) ?? []
    ).map((r) => {
      const gross = Number(r.amount ?? 0);
      return {
        key: `pin-${r.account_id}-${r.code}`,
        date: r.dated,
        accountId: r.account_id,
        accountName: nameOf.get(r.account_id) ?? r.account_id,
        type: "Promotional Incentive",
        reference: r.code,
        detail: null,
        gross,
        net: gross * PROMO_PAYOUT_RATE,
        status: r.status,
        paid: PAID_PIN_STATUSES.includes(r.status),
      };
    });

    const combined = [...salesIncentive, ...turnoverSalary, ...promotional].sort((a, b) => {
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
    for (const t of transactions) if (t.date) set.add(t.date.slice(0, 7));
    return [...set].sort().reverse();
  }, [transactions]);

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (filterAccount && t.accountId !== filterAccount) return false;
      if (filterType && t.type !== filterType) return false;
      if (filterStatus === "paid" && !t.paid) return false;
      if (filterStatus === "unpaid" && t.paid) return false;
      if (dateMode === "custom") {
        if (customFrom && (!t.date || t.date < customFrom)) return false;
        if (customTo && (!t.date || t.date > customTo)) return false;
      } else if (dateMode !== "all") {
        if (!t.date || t.date.slice(0, 7) !== dateMode) return false;
      }
      return true;
    });
  }, [transactions, filterAccount, filterType, filterStatus, dateMode, customFrom, customTo]);

  const summary = useMemo(() => summarize(filtered), [filtered]);

  const monthGroups = useMemo(() => {
    const map = new Map<string, IncomeTransaction[]>();
    for (const t of filtered) {
      const key = t.date ? t.date.slice(0, 7) : "unknown";
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const accountGroups = useMemo(() => {
    const map = new Map<string, IncomeTransaction[]>();
    for (const t of filtered) map.set(t.accountId, [...(map.get(t.accountId) ?? []), t]);
    return [...map.entries()].sort((a, b) => summarize(b[1]).net - summarize(a[1]).net);
  }, [filtered]);

  function expandAll() {
    if (groupBy === "month") {
      setExpandedGroups(new Set(monthGroups.map(([k]) => k)));
    } else if (groupBy === "account") {
      setExpandedGroups(new Set(accountGroups.map(([k]) => k)));
    } else if (groupBy === "both") {
      const subgroups = new Set<string>();
      for (const [monthKey, monthList] of monthGroups) {
        for (const accountId of new Set(monthList.map((t) => t.accountId))) subgroups.add(`${monthKey}|${accountId}`);
      }
      setExpandedGroups(new Set(monthGroups.map(([k]) => k)));
      setExpandedSubgroups(subgroups);
    }
  }

  function collapseAll() {
    setExpandedGroups(new Set());
    setExpandedSubgroups(new Set());
  }

  function exportCsv() {
    downloadCsv(
      "income-transactions.csv",
      ["Date", "Account", "Type", "Reference", "From / Detail", "Gross", "Net", "Status"],
      filtered.map((t) => [t.date, t.accountName, t.type, t.reference, t.detail, t.gross, t.net, t.status])
    );
  }

  const groupLabel = (key: string) => (key === "unknown" ? "Unknown date" : monthLabel(key));
  const statusNote = filterStatus === "paid" ? "paid only" : filterStatus === "unpaid" ? "unpaid only" : "paid + unpaid";

  return (
    <Layout>
      <div className="px-4 sm:px-8 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-maroon-900">Income Transactions</h1>
          <p className="text-sm text-maroon-900/50 mt-0.5">
            Every Sales Incentive invoice, Turnover Salary month and Promotional Incentive pin, across all accounts.
            Net is what is actually paid out.{" "}
            <Link to="/income" className="text-maroon-700 hover:underline">Back to Income summary</Link>
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          {TYPES.map((type) => (
            <div key={type} className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
              <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">{type} (Net)</p>
              <p className="text-3xl font-bold mt-2 text-maroon-900">{formatINR(summary.netByType[type])}</p>
              <p className="text-xs text-maroon-900/40 mt-1">
                gross {formatINR(summary.grossByType[type])} &middot; {NET_RULE[type]}
              </p>
            </div>
          ))}
          <div className="bg-gold-500 rounded-xl shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/60 uppercase tracking-wider">Total (Net)</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{formatINR(summary.net)}</p>
            <p className="text-xs text-maroon-900/60 mt-1">
              {summary.count} transactions &middot; {statusNote} &middot; gross {formatINR(summary.gross)}
            </p>
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
            <select value={filterType} onChange={(e) => setFilterType(e.target.value as "" | IncomeType)} className={SELECT_CLASS}>
              <option value="">All Types</option>
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS}>Status</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as StatusFilter)} className={SELECT_CLASS}>
              <option value="paid">Paid</option>
              <option value="unpaid">Unpaid (upcoming)</option>
              <option value="all">All</option>
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
        {dateMode === "custom" && (
          <p className="text-xs text-maroon-900/40 -mt-2 mb-4">Turnover Salary is dated the 1st of its month.</p>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-48 bg-white rounded-xl border border-maroon-100 shadow-sm">
            <p className="text-sm text-maroon-900/40">Loading…</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-maroon-900">Transactions</h2>
              <div className="flex items-center gap-2">
                {groupBy !== "none" && (
                  <>
                    <button onClick={expandAll} className={BUTTON_CLASS}>Expand All</button>
                    <button onClick={collapseAll} className={BUTTON_CLASS}>Collapse All</button>
                  </>
                )}
                <button onClick={exportCsv} className={BUTTON_CLASS}>Export CSV</button>
              </div>
            </div>

            {groupBy === "none" && (
              <div className="bg-white rounded-xl border border-maroon-100 shadow-sm overflow-hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-maroon-50 text-left text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">
                      <th className="px-5 py-3">Date</th>
                      <th className="px-5 py-3">Account</th>
                      <th className="px-5 py-3">Type</th>
                      <th className="px-5 py-3">Reference</th>
                      <th className="px-5 py-3">From / Detail</th>
                      <th className="px-5 py-3">Gross</th>
                      <th className="px-5 py-3">Net</th>
                      <th className="px-5 py-3">Status</th>
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

            {groupBy !== "none" && (
              <div className="bg-white rounded-xl border border-maroon-100 shadow-sm overflow-hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-maroon-50 text-left text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">
                      <th className="px-5 py-3">{groupBy === "account" ? "Account" : "Month"}</th>
                      {GROUP_HEADERS.map((h) => (
                        <th key={h} className="px-5 py-3">{h}</th>
                      ))}
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-maroon-50">
                    {(groupBy === "account" ? accountGroups : monthGroups).map(([key, list]) => (
                      <Fragment key={key}>
                        <tr className="hover:bg-maroon-50/50">
                          <td className="px-5 py-3 font-medium text-maroon-900">
                            {groupBy === "account" ? (
                              <Link to={`/accounts/${key}`} className="text-maroon-700 hover:underline">
                                {accountNameOf(key)}
                              </Link>
                            ) : (
                              groupLabel(key)
                            )}
                          </td>
                          <GroupCells list={list} />
                          <td className="px-5 py-3 text-right">
                            <button onClick={() => toggle(setExpandedGroups, key)} className="text-xs font-medium text-maroon-700 hover:underline">
                              {expandedGroups.has(key) ? "Hide" : "Breakdown"}
                            </button>
                          </td>
                        </tr>
                        {expandedGroups.has(key) && groupBy !== "both" && (
                          <tr>
                            <td colSpan={8} className="px-4 py-3 bg-maroon-50/40">
                              <DetailTable rows={list} />
                            </td>
                          </tr>
                        )}
                        {expandedGroups.has(key) &&
                          groupBy === "both" &&
                          [...new Set(list.map((t) => t.accountId))]
                            .map((accountId) => [accountId, list.filter((t) => t.accountId === accountId)] as const)
                            .sort((a, b) => summarize(b[1]).net - summarize(a[1]).net)
                            .map(([accountId, accList]) => {
                              const subKey = `${key}|${accountId}`;
                              return (
                                <Fragment key={subKey}>
                                  <tr className="bg-maroon-50/40">
                                    <td className="pl-8 pr-4 py-2">
                                      <Link to={`/accounts/${accountId}`} className="text-maroon-700 hover:underline text-sm">
                                        {accountNameOf(accountId)}
                                      </Link>
                                    </td>
                                    <GroupCells list={accList} sub />
                                    <td className="px-4 py-2 text-right">
                                      <button onClick={() => toggle(setExpandedSubgroups, subKey)} className="text-xs font-medium text-maroon-700 hover:underline">
                                        {expandedSubgroups.has(subKey) ? "Hide" : "Details"}
                                      </button>
                                    </td>
                                  </tr>
                                  {expandedSubgroups.has(subKey) && (
                                    <tr>
                                      <td colSpan={8} className="px-4 py-3 bg-maroon-100/40">
                                        <DetailTable rows={accList} />
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                      </Fragment>
                    ))}
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
          </>
        )}
      </div>
    </Layout>
  );
}
