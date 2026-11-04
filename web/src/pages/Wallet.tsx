import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";
import { formatINR, formatDate, formatDateTime } from "../lib/format";
import { downloadCsv } from "../lib/csv";
import { SI_PAYOUT_RATE, PROMO_PAYOUT_RATE, PAID_PIN_STATUSES, FAILED_WITHDRAWAL_STATUSES, tbpNet } from "../lib/income";

// Withdrawals are itemised by the API only from here on (earlier ones exist
// only as the dashboard's lifetime total), so a running balance is only
// meaningful from this date. It anchors back from the current balance.
const LEDGER_START = "2026-11-01";
const PENDING_FLAG_DAYS = 7;

interface AccountRow {
  member_id: string;
  name: string;
}

type EntryKind = "Sales Incentive" | "Turnover Salary" | "Promotional Incentive" | "Withdrawal";
type WithdrawalState = "pending" | "paid out" | "rejected";

interface Entry {
  key: string;
  date: string; // YYYY-MM-DD (withdrawals: request date)
  at: string; // full timestamp for ordering within a day
  accountId: string;
  accountName: string;
  kind: EntryKind;
  reference: string;
  detail: string | null;
  credit: number;
  debit: number; // 0 for rejected withdrawals: the money stayed in the wallet
  withdrawalState: WithdrawalState | null;
  status: string;
  balance: number | null; // running balance after this entry, from LEDGER_START
}

interface Withdrawal {
  account_id: string;
  withdrawal_id: number;
  branch: string | null;
  amount: number | null;
  status: string | null;
  disbursal_mode: string | null;
  requested_at: string | null;
  disbursed_at: string | null;
}

type GroupMode = "none" | "month" | "account";

const KIND_BADGE: Record<EntryKind, string> = {
  "Sales Incentive": "bg-blue-100 text-blue-700",
  "Turnover Salary": "bg-purple-100 text-purple-700",
  "Promotional Incentive": "bg-amber-100 text-amber-700",
  Withdrawal: "bg-red-100 text-red-700",
};

const SELECT_CLASS = "text-sm border border-maroon-200 rounded-lg px-3 py-1.5 bg-white text-maroon-900";
const LABEL_CLASS = "block text-xs font-semibold text-maroon-900/50 uppercase tracking-wider mb-1";
const BUTTON_CLASS = "text-xs font-medium text-maroon-700 border border-maroon-200 rounded-lg px-3 py-1.5 hover:bg-maroon-50";

function monthLabel(yyyyMm: string): string {
  const [year, month] = yyyyMm.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function withdrawalState(status: string | null): WithdrawalState {
  const s = String(status ?? "").toLowerCase();
  if (FAILED_WITHDRAWAL_STATUSES.includes(s)) return "rejected";
  if (s === "pending" || s === "") return "pending";
  return "paid out";
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

// IST calendar date of a timestamp, matching how the app shows request times.
function istDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export default function Wallet() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [balances, setBalances] = useState<Map<string, { cash: number; capturedAt: string }>>(new Map());
  const [lifetimeWithdrawn, setLifetimeWithdrawn] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  const thisMonth = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7);
  const [filterAccount, setFilterAccount] = useState("");
  const [period, setPeriod] = useState(thisMonth); // "all" | "custom" | "YYYY-MM"
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [entryFilter, setEntryFilter] = useState<"all" | "credits" | "withdrawals">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | WithdrawalState>("all");
  const [groupBy, setGroupBy] = useState<GroupMode>("none");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    const [accountsRes, siRes, tsRes, pinsRes, wdRes, walletRes, dashRes] = await Promise.all([
      supabase.from("accounts").select("member_id, name").order("name"),
      supabase.from("sales_incentive").select("account_id, bill_date, invoice_no, from_distributor, si_value, status"),
      supabase.from("turnover_salary").select("account_id, month, no_of_packets, total_tb_salary, net_total"),
      supabase.from("promotional_incentive_pins").select("account_id, code, dated, amount, status").in("status", PAID_PIN_STATUSES),
      supabase.from("wallet_withdrawals").select("account_id, withdrawal_id, branch, amount, status, disbursal_mode, requested_at, disbursed_at"),
      supabase.from("wallet_snapshots").select("account_id, cash_balance, captured_at"),
      supabase.from("dashboard_snapshots").select("account_id, my_withdraw"),
    ]);

    const accountList = (accountsRes.data as AccountRow[]) ?? [];
    const nameOf = new Map(accountList.map((a) => [a.member_id, a.name]));
    const base = (accountId: string) => ({ accountId, accountName: nameOf.get(accountId) ?? accountId, balance: null });
    const list: Entry[] = [];

    for (const r of (siRes.data as { account_id: string; bill_date: string | null; invoice_no: string; from_distributor: string | null; si_value: number | null; status: string | null }[]) ?? []) {
      if (!r.bill_date || String(r.status ?? "").toLowerCase() !== "paid") continue;
      list.push({
        ...base(r.account_id), key: `si-${r.account_id}-${r.invoice_no}`, date: r.bill_date, at: r.bill_date,
        kind: "Sales Incentive", reference: r.invoice_no, detail: r.from_distributor,
        credit: Number(r.si_value ?? 0) * SI_PAYOUT_RATE, debit: 0, withdrawalState: null, status: "paid",
      });
    }
    for (const r of (tsRes.data as { account_id: string; month: string; no_of_packets: number | null; total_tb_salary: number | null; net_total: number | null }[]) ?? []) {
      const [mm, yyyy] = r.month.split("-");
      if (!mm || !yyyy) continue;
      const date = `${yyyy}-${mm}-01`;
      list.push({
        ...base(r.account_id), key: `ts-${r.account_id}-${r.month}`, date, at: date,
        kind: "Turnover Salary", reference: r.month,
        detail: r.no_of_packets != null ? `${r.no_of_packets} packet${r.no_of_packets === 1 ? "" : "s"}` : null,
        credit: tbpNet(r), debit: 0, withdrawalState: null, status: "paid",
      });
    }
    for (const r of (pinsRes.data as { account_id: string; code: string; dated: string | null; amount: number | null; status: string }[]) ?? []) {
      if (!r.dated) continue;
      list.push({
        ...base(r.account_id), key: `pin-${r.account_id}-${r.code}`, date: r.dated, at: r.dated,
        kind: "Promotional Incentive", reference: r.code, detail: null,
        credit: Number(r.amount ?? 0) * PROMO_PAYOUT_RATE, debit: 0, withdrawalState: null, status: r.status,
      });
    }
    const wdList = (wdRes.data as Withdrawal[]) ?? [];
    for (const w of wdList) {
      if (!w.requested_at) continue;
      const state = withdrawalState(w.status);
      list.push({
        ...base(w.account_id), key: `wd-${w.account_id}-${w.withdrawal_id}`, date: istDate(w.requested_at), at: w.requested_at,
        kind: "Withdrawal", reference: `#${w.withdrawal_id}`, detail: w.branch,
        credit: 0, debit: state === "rejected" ? 0 : Number(w.amount ?? 0), withdrawalState: state, status: w.status ?? "pending",
      });
    }

    // Running balance per account from LEDGER_START, anchored on today's
    // balance: opening = current - credits + debits over the ledger period.
    const walletMap = new Map(
      ((walletRes.data as { account_id: string; cash_balance: number | null; captured_at: string }[]) ?? []).map((w) => [
        w.account_id,
        { cash: Number(w.cash_balance ?? 0), capturedAt: w.captured_at },
      ])
    );
    for (const [accountId, wallet] of walletMap) {
      const ledger = list
        .filter((e) => e.accountId === accountId && e.date >= LEDGER_START)
        // Same day: credits land before the withdrawals that spend them.
        .sort((a, b) => a.at.localeCompare(b.at) || b.credit - a.credit);
      let balance = wallet.cash - ledger.reduce((s, e) => s + e.credit - e.debit, 0);
      for (const e of ledger) {
        balance += e.credit - e.debit;
        e.balance = balance;
      }
    }

    list.sort((a, b) => b.at.localeCompare(a.at) || a.credit - b.credit);
    setAccounts(accountList);
    setEntries(list);
    setWithdrawals(wdList);
    setBalances(walletMap);
    setLifetimeWithdrawn(
      new Map(((dashRes.data as { account_id: string; my_withdraw: number | null }[]) ?? []).map((d) => [d.account_id, Number(d.my_withdraw ?? 0)]))
    );
    setLoading(false);
  }

  const availableMonths = useMemo(() => {
    const set = new Set(entries.map((e) => e.date.slice(0, 7)));
    set.add(thisMonth);
    return [...set].sort().reverse();
  }, [entries, thisMonth]);

  const inPeriod = (date: string) => {
    if (period === "all") return true;
    if (period === "custom") return (!customFrom || date >= customFrom) && (!customTo || date <= customTo);
    return date.slice(0, 7) === period;
  };

  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        if (filterAccount && e.accountId !== filterAccount) return false;
        if (!inPeriod(e.date)) return false;
        if (entryFilter === "credits" && e.kind === "Withdrawal") return false;
        if (entryFilter === "withdrawals" && e.kind !== "Withdrawal") return false;
        if (statusFilter !== "all" && e.withdrawalState !== statusFilter) return false;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, filterAccount, period, customFrom, customTo, entryFilter, statusFilter]
  );

  const totals = (list: Entry[]) => ({
    count: list.length,
    credit: list.reduce((s, e) => s + e.credit, 0),
    debit: list.reduce((s, e) => s + e.debit, 0),
    pending: list.filter((e) => e.withdrawalState === "pending").reduce((s, e) => s + e.debit, 0),
  });
  const summary = totals(filtered);

  const visibleAccounts = filterAccount ? accounts.filter((a) => a.member_id === filterAccount) : accounts;
  const balanceNow = visibleAccounts.reduce((s, a) => s + (balances.get(a.member_id)?.cash ?? 0), 0);
  const lifetime = visibleAccounts.reduce((s, a) => s + (lifetimeWithdrawn.get(a.member_id) ?? 0), 0);
  const capturedAt = [...balances.values()].map((b) => b.capturedAt).sort().reverse()[0] ?? null;
  // A running balance only makes sense for one account with every entry shown.
  const showBalance = Boolean(filterAccount) && entryFilter === "all" && statusFilter === "all";

  const groups = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of filtered) {
      const key = groupBy === "account" ? e.accountId : e.date.slice(0, 7);
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return [...map.entries()].sort((a, b) => (groupBy === "account" ? totals(b[1]).credit - totals(a[1]).credit : b[0].localeCompare(a[0])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, groupBy]);

  const tracker = withdrawals
    .filter((w) => !filterAccount || w.account_id === filterAccount)
    .sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at)));

  function accountNameOf(id: string) {
    return accounts.find((a) => a.member_id === id)?.name ?? id;
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  // Shareable plain-text list of the withdrawals in the selected period,
  // grouped by account (same layout as the gold sale summaries).
  function periodLabel() {
    if (period === "all") return "All Time";
    if (period === "custom") {
      const from = customFrom ? formatDate(customFrom) : "start";
      const to = customTo ? formatDate(customTo) : "today";
      return `${from} to ${to}`;
    }
    return monthLabel(period);
  }

  function buildWithdrawalSummary() {
    const list = entries.filter(
      (e) =>
        e.kind === "Withdrawal" &&
        (!filterAccount || e.accountId === filterAccount) &&
        inPeriod(e.date) &&
        (statusFilter === "all" || e.withdrawalState === statusFilter)
    );
    const title = `Wallet Withdrawals - ${periodLabel()}`;
    const lines = [title, "-".repeat(title.length), ""];
    const byAccount = new Map<string, Entry[]>();
    for (const e of list) byAccount.set(e.accountId, [...(byAccount.get(e.accountId) ?? []), e]);
    const accountIds = [...byAccount.keys()].sort((a, b) => accountNameOf(a).localeCompare(accountNameOf(b)));
    accountIds.forEach((accountId, i) => {
      lines.push(`${i + 1}. ${accountNameOf(accountId)} (${accountId})`, "");
      for (const e of [...byAccount.get(accountId)!].sort((a, b) => a.at.localeCompare(b.at))) {
        const [y, m, d] = e.date.split("-");
        const amount = withdrawals.find((w) => w.account_id === e.accountId && `#${w.withdrawal_id}` === e.reference)?.amount;
        lines.push(`   * ${d}-${m}-${y} – ${formatINR(amount)} – ${e.reference} (${e.status})`);
      }
      lines.push("");
    });
    if (list.length === 0) lines.push("No withdrawals in this period.", "");
    // Rejected requests never left the wallet, so they're listed but not totalled.
    lines.push(`Total Withdrawn: ${formatINR(list.reduce((s, e) => s + e.debit, 0))}`);
    setCopied(false);
    setSummaryText(lines.join("\n"));
  }

  async function copySummary() {
    if (!summaryText) return;
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function downloadSummary() {
    if (!summaryText) return;
    const url = URL.createObjectURL(new Blob([summaryText], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `wallet-withdrawals-${period === "custom" ? "custom" : period}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    downloadCsv(
      "wallet-statement.csv",
      ["Date", "Account", "Entry", "Reference", "Detail", "Credit", "Debit", "Status", ...(showBalance ? ["Balance"] : [])],
      filtered.map((e) => [e.date, e.accountName, e.kind, e.reference, e.detail, e.credit || null, e.debit || null, e.status, ...(showBalance ? [e.balance] : [])])
    );
  }

  function statementRow(e: Entry, dense = false) {
    const pad = dense ? "py-1 pr-4" : "px-5 py-3";
    return (
      <tr key={e.key} className={dense ? "" : "hover:bg-maroon-50/50"}>
        <td className={pad}>{e.kind === "Turnover Salary" ? monthLabel(e.date.slice(0, 7)) : formatDate(e.date)}</td>
        <td className={pad}>
          <Link to={`/accounts/${e.accountId}`} className="text-maroon-700 hover:underline">{e.accountName}</Link>
        </td>
        <td className={pad}>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${KIND_BADGE[e.kind]}`}>{e.kind}</span>
        </td>
        <td className={`${pad} font-mono text-xs`}>{e.reference}</td>
        <td className={pad}>{e.detail ?? "—"}</td>
        <td className={`${pad} text-green-700 font-semibold`}>{e.credit ? `+${formatINR(e.credit)}` : ""}</td>
        <td className={`${pad} text-red-700 font-semibold`}>
          {e.kind === "Withdrawal" ? (e.debit ? `−${formatINR(e.debit)}` : <span className="line-through text-maroon-900/40">{formatINR(withdrawals.find((w) => `#${w.withdrawal_id}` === e.reference)?.amount)}</span>) : ""}
        </td>
        <td className={pad}>{e.status}</td>
        {showBalance && <td className={`${pad} font-semibold`}>{e.balance == null ? "—" : formatINR(e.balance)}</td>}
      </tr>
    );
  }

  const statementHeaders = ["Date", "Account", "Entry", "Reference", "Detail", "Credit", "Debit", "Status", ...(showBalance ? ["Balance"] : [])];

  return (
    <Layout>
      <div className="px-4 sm:px-8 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-maroon-900">Wallet</h1>
          <p className="text-sm text-maroon-900/50 mt-0.5">
            Money credited (income after deductions) and withdrawn, per account. Withdrawals are itemised from{" "}
            {formatDate(LEDGER_START)}; earlier ones are only in the lifetime total.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <div className="bg-gold-500 rounded-xl shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/60 uppercase tracking-wider">Balance Now</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{balances.size ? formatINR(balanceNow) : "—"}</p>
            <p className="text-xs text-maroon-900/60 mt-1">{capturedAt ? `as of ${formatDateTime(capturedAt)}` : "not captured yet"}</p>
          </div>
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">Credited</p>
            <p className="text-3xl font-bold mt-2 text-green-700">{formatINR(summary.credit)}</p>
            <p className="text-xs text-maroon-900/40 mt-1">net income in this period</p>
          </div>
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">Withdrawn</p>
            <p className="text-3xl font-bold mt-2 text-red-700">{formatINR(summary.debit)}</p>
            <p className="text-xs text-maroon-900/40 mt-1">
              {summary.pending > 0 ? `${formatINR(summary.pending)} still pending payout` : "nothing pending payout"}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">Lifetime Withdrawn</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{formatINR(lifetime)}</p>
            <p className="text-xs text-maroon-900/40 mt-1">dashboard total, all time</p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 mb-6">
          <div>
            <label className={LABEL_CLASS}>Account</label>
            <select value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)} className={SELECT_CLASS}>
              <option value="">All Accounts</option>
              {accounts.map((a) => (
                <option key={a.member_id} value={a.member_id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS}>Period</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value)} className={SELECT_CLASS}>
              {availableMonths.map((m) => (
                <option key={m} value={m}>{m === thisMonth ? `This month (${monthLabel(m)})` : monthLabel(m)}</option>
              ))}
              <option value="all">All Time</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>
          {period === "custom" && (
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
            <label className={LABEL_CLASS}>Entries</label>
            <select value={entryFilter} onChange={(e) => setEntryFilter(e.target.value as typeof entryFilter)} className={SELECT_CLASS}>
              <option value="all">Credits &amp; Withdrawals</option>
              <option value="credits">Credits only</option>
              <option value="withdrawals">Withdrawals only</option>
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS}>Withdrawal Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className={SELECT_CLASS}>
              <option value="all">Any</option>
              <option value="pending">Pending</option>
              <option value="paid out">Paid out</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS}>Group by</label>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupMode)} className={SELECT_CLASS}>
              <option value="none">None</option>
              <option value="month">By Month</option>
              <option value="account">By Account</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48 bg-white rounded-xl border border-maroon-100 shadow-sm">
            <p className="text-sm text-maroon-900/40">Loading…</p>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-maroon-900 mb-3">Accounts</h2>
            <div className="bg-white rounded-xl border border-maroon-100 shadow-sm overflow-hidden overflow-x-auto mb-8">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-maroon-50 text-left text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">
                    <th className="px-5 py-3">Account</th>
                    <th className="px-5 py-3">Balance Now</th>
                    <th className="px-5 py-3">Credited</th>
                    <th className="px-5 py-3">Withdrawn</th>
                    <th className="px-5 py-3">Pending Payout</th>
                    <th className="px-5 py-3">Last Withdrawal</th>
                    <th className="px-5 py-3">Check</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-maroon-50">
                  {visibleAccounts.map((a) => {
                    const t = totals(filtered.filter((e) => e.accountId === a.member_id));
                    const last = withdrawals
                      .filter((w) => w.account_id === a.member_id && w.requested_at)
                      .sort((x, y) => String(y.requested_at).localeCompare(String(x.requested_at)))[0];
                    // Balance = opening + credits - withdrawals; checkable for the current month,
                    // where the opening balance is the ledger start (everything earlier was withdrawn).
                    const monthEntries = entries.filter((e) => e.accountId === a.member_id && e.date.slice(0, 7) === thisMonth);
                    const opening = entries
                      .filter((e) => e.accountId === a.member_id && e.date >= LEDGER_START && e.date.slice(0, 7) < thisMonth)
                      .reduce((s, e) => s + e.credit - e.debit, 0);
                    const expected = opening + monthEntries.reduce((s, e) => s + e.credit - e.debit, 0);
                    const cash = balances.get(a.member_id)?.cash;
                    const ok = cash != null && Math.abs(cash - expected) < 1;
                    return (
                      <tr key={a.member_id} className="hover:bg-maroon-50/50">
                        <td className="px-5 py-3">
                          <button onClick={() => setFilterAccount(a.member_id)} className="font-medium text-maroon-700 hover:underline text-left">
                            {a.name}
                          </button>
                        </td>
                        <td className="px-5 py-3 font-semibold">{cash != null ? formatINR(cash) : "—"}</td>
                        <td className="px-5 py-3 text-green-700">{formatINR(t.credit)}</td>
                        <td className="px-5 py-3 text-red-700">{formatINR(t.debit)}</td>
                        <td className="px-5 py-3">{t.pending ? formatINR(t.pending) : "—"}</td>
                        <td className="px-5 py-3">{last ? `${formatDate(last.requested_at)} · ${formatINR(last.amount)}` : "—"}</td>
                        <td className="px-5 py-3">
                          {cash == null ? "—" : (
                            <span
                              className={`text-xs font-medium ${ok ? "text-green-700" : "text-red-700"}`}
                              title={`Expected from this month's credits and withdrawals: ${formatINR(expected)}`}
                            >
                              {ok ? "✔ reconciles" : `✗ expected ${formatINR(expected)}`}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-maroon-900/40 -mt-6 mb-8">
              Credited and Withdrawn follow the filters above. Check compares Balance Now with this month&apos;s credits less withdrawals.
              Click an account to see its statement with a running balance.
            </p>

            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-maroon-900">Statement</h2>
              <div className="flex items-center gap-2">
                {filterAccount && (
                  <button onClick={() => setFilterAccount("")} className={BUTTON_CLASS}>All accounts</button>
                )}
                <button onClick={buildWithdrawalSummary} className={BUTTON_CLASS}>Withdrawal Summary</button>
                <button onClick={exportCsv} className={BUTTON_CLASS}>Export CSV</button>
              </div>
            </div>
            {!showBalance && (
              <p className="text-xs text-maroon-900/40 mb-2">
                Pick one account (with all entries and any status) to see the running balance.
              </p>
            )}
            <div className="bg-white rounded-xl border border-maroon-100 shadow-sm overflow-hidden overflow-x-auto mb-8">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-maroon-50 text-left text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">
                    {groupBy === "none"
                      ? statementHeaders.map((h) => <th key={h} className="px-5 py-3">{h}</th>)
                      : ["", "Entries", "Credited", "Withdrawn", "Net", ""].map((h, i) => (
                          <th key={i} className="px-5 py-3">{i === 0 ? (groupBy === "account" ? "Account" : "Month") : h}</th>
                        ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-maroon-50">
                  {groupBy === "none" && filtered.map((e) => statementRow(e))}
                  {groupBy !== "none" &&
                    groups.map(([key, list]) => {
                      const t = totals(list);
                      return (
                        <Fragment key={key}>
                          <tr className="hover:bg-maroon-50/50">
                            <td className="px-5 py-3 font-medium text-maroon-900">{groupBy === "account" ? accountNameOf(key) : monthLabel(key)}</td>
                            <td className="px-5 py-3">{t.count}</td>
                            <td className="px-5 py-3 text-green-700">{formatINR(t.credit)}</td>
                            <td className="px-5 py-3 text-red-700">{formatINR(t.debit)}</td>
                            <td className="px-5 py-3 font-semibold">{formatINR(t.credit - t.debit)}</td>
                            <td className="px-5 py-3 text-right">
                              <button onClick={() => toggle(key)} className="text-xs font-medium text-maroon-700 hover:underline">
                                {expanded.has(key) ? "Hide" : "Entries"}
                              </button>
                            </td>
                          </tr>
                          {expanded.has(key) && (
                            <tr>
                              <td colSpan={6} className="px-4 py-3 bg-maroon-50/40">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-left text-maroon-900/50">
                                      {statementHeaders.map((h) => <th key={h} className="py-1 pr-4">{h}</th>)}
                                    </tr>
                                  </thead>
                                  <tbody>{list.map((e) => statementRow(e, true))}</tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={statementHeaders.length} className="px-5 py-8 text-center text-maroon-900/40">
                        No entries match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <h2 className="text-lg font-semibold text-maroon-900 mb-3">Withdrawal Tracker</h2>
            <div className="bg-white rounded-xl border border-maroon-100 shadow-sm overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-maroon-50 text-left text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">
                    <th className="px-5 py-3">Requested</th>
                    <th className="px-5 py-3">Account</th>
                    <th className="px-5 py-3">Withdrawal</th>
                    <th className="px-5 py-3">Amount</th>
                    <th className="px-5 py-3">Branch</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Paid Out</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-maroon-50">
                  {tracker.map((w) => {
                    const state = withdrawalState(w.status);
                    const age = daysSince(w.requested_at);
                    const overdue = state === "pending" && age != null && age > PENDING_FLAG_DAYS;
                    return (
                      <tr key={`${w.account_id}-${w.withdrawal_id}`} className={overdue ? "bg-red-50" : "hover:bg-maroon-50/50"}>
                        <td className="px-5 py-3">{w.requested_at ? formatDateTime(w.requested_at) : "—"}</td>
                        <td className="px-5 py-3">{accountNameOf(w.account_id)}</td>
                        <td className="px-5 py-3 font-mono text-xs">#{w.withdrawal_id}</td>
                        <td className="px-5 py-3 font-semibold">{formatINR(w.amount)}</td>
                        <td className="px-5 py-3">{w.branch ?? "—"}</td>
                        <td className="px-5 py-3">
                          <span
                            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              state === "paid out" ? "bg-green-100 text-green-700" : state === "rejected" ? "bg-maroon-100 text-maroon-700" : overdue ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {w.status ?? "pending"}
                            {state === "pending" && age != null && ` · ${age}d`}
                          </span>
                          {overdue && <span className="block text-xs text-red-700 mt-1">pending over {PENDING_FLAG_DAYS} days</span>}
                        </td>
                        <td className="px-5 py-3">
                          {w.disbursed_at ? `${formatDateTime(w.disbursed_at)}${w.disbursal_mode ? ` · ${w.disbursal_mode}` : ""}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {tracker.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-8 text-center text-maroon-900/40">No withdrawals yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {summaryText != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setSummaryText(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-maroon-100">
              <h3 className="font-semibold text-maroon-900">Withdrawal Summary</h3>
              <button onClick={() => setSummaryText(null)} className="text-maroon-900/50 hover:text-maroon-900 text-xl leading-none" aria-label="Close">
                ×
              </button>
            </div>
            <pre className="px-5 py-4 text-sm text-maroon-900 whitespace-pre-wrap font-mono overflow-auto">{summaryText}</pre>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-maroon-100">
              {copied && <span className="text-xs text-green-700 mr-auto">Copied to clipboard</span>}
              <button onClick={downloadSummary} className={BUTTON_CLASS}>Download .txt</button>
              <button onClick={copySummary} className="text-xs font-semibold text-white bg-maroon-700 rounded-lg px-3 py-1.5 hover:bg-maroon-800">
                Copy
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
