import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";
import { formatINR } from "../lib/format";
import { downloadCsv } from "../lib/csv";
import { SI_PAYOUT_RATE, PROMO_PAYOUT_RATE, PAID_PIN_STATUSES, tbpNet } from "../lib/income";

// Money actually received and taken out, per account per month, keyed by the
// month it happened (not the month it was earned).
//
// Gold era (up to Oct 2026): income was paid as DigiGold, so IN = gold bought
// that month (exact) and OUT = gold sold. The SI / Salary / Promo split is only
// approximate there: old salary over ₹15,000 was cut 20% (gold conversion), and
// promo pins are a schedule, so a pin can fall in the month next to its buy.
// Cash era (from Nov 2026): IN = incentives paid that month after charges,
// OUT = withdrawals paid out.

const PAID_WITHDRAWAL_STATUSES = ["admin_paid", "disbursed"];
const SELL_DONE_STATUS = "PASSED";

interface AccountRow {
  member_id: string;
  name: string;
}

type Era = "gold" | "cash";

interface Cell {
  accountId: string;
  month: string; // YYYY-MM
  si: number;
  salary: number;
  promo: number;
  goldBuy: number;
  hasGold: boolean;
  goldSell: number;
  withdrawn: number;
}

interface FlowRow {
  accountId: string;
  month: string;
  era: Era;
  si: number;
  salary: number;
  promo: number;
  in: number;
  out: number;
  net: number;
  goldSell: number;
  withdrawn: number;
}

const SELECT_CLASS = "text-sm border border-maroon-200 rounded-lg px-3 py-1.5 bg-white text-maroon-900";
const LABEL_CLASS = "block text-xs font-semibold text-maroon-900/50 uppercase tracking-wider mb-1";

const ym = (d: string | null) => (d ? d.slice(0, 7) : null);
/** "MM-YYYY" -> "YYYY-MM" */
const ymFromMonthLabel = (m: string | null) => {
  const x = /^(\d{2})-(\d{4})$/.exec(m ?? "");
  return x ? `${x[2]}-${x[1]}` : m;
};
/** Month of a timestamp in IST. */
const ymIst = (ts: string | null) =>
  ts ? new Date(ts).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7) : null;

function monthLabel(yyyyMm: string): string {
  const [year, month] = yyyyMm.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function toFlow(c: Cell): FlowRow {
  const era: Era = c.hasGold ? "gold" : "cash";
  const inAmt = c.hasGold ? c.goldBuy : c.si + c.salary + c.promo;
  const out = c.goldSell + c.withdrawn;
  return {
    accountId: c.accountId, month: c.month, era,
    si: c.si, salary: c.salary, promo: c.promo,
    in: inAmt, out, net: inAmt - out,
    goldSell: c.goldSell, withdrawn: c.withdrawn,
  };
}

function sum(rows: FlowRow[]) {
  return rows.reduce(
    (t, r) => ({ si: t.si + r.si, salary: t.salary + r.salary, promo: t.promo + r.promo, in: t.in + r.in, out: t.out + r.out, net: t.net + r.net }),
    { si: 0, salary: 0, promo: 0, in: 0, out: 0, net: 0 }
  );
}

const inSource = (eras: Set<Era>) => [...eras].map((e) => (e === "gold" ? "gold buy" : "cash credit")).join(" + ");
const outSource = (r: { goldSell: number; withdrawn: number }) =>
  [r.goldSell ? "gold sell" : null, r.withdrawn ? "withdrawal" : null].filter(Boolean).join(" + ") || "—";

function EraBadge({ era }: { era: Era | "mixed" }) {
  const cls = era === "gold" ? "bg-amber-100 text-amber-700" : era === "cash" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{era}</span>;
}

export default function InHand() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAccount, setFilterAccount] = useState("all");
  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [eraFilter, setEraFilter] = useState<"all" | Era>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [accountsRes, siRes, salRes, pinRes, buyRes, sellRes, wdRes] = await Promise.all([
        supabase.from("accounts").select("member_id, name").order("member_id"),
        supabase.from("sales_incentive").select("account_id, bill_date, si_value, status"),
        supabase.from("turnover_salary").select("account_id, month, total_tb_salary, net_total"),
        supabase.from("promotional_incentive_pins").select("account_id, dated, amount, status"),
        supabase.from("digigold_buy_transactions").select("account_id, buy_date, gold_worth"),
        supabase.from("digigold_sell_transactions").select("account_id, sell_date, gold_worth, status"),
        supabase.from("wallet_withdrawals").select("account_id, amount, status, requested_at"),
      ]);

      const map = new Map<string, Cell>();
      const cell = (accountId: string, month: string | null) => {
        if (!month) return null;
        const key = `${accountId}|${month}`;
        let c = map.get(key);
        if (!c) {
          c = { accountId, month, si: 0, salary: 0, promo: 0, goldBuy: 0, hasGold: false, goldSell: 0, withdrawn: 0 };
          map.set(key, c);
        }
        return c;
      };

      type Si = { account_id: string; bill_date: string | null; si_value: number | null; status: string | null };
      for (const r of (siRes.data as Si[]) ?? []) {
        if ((r.status ?? "").toLowerCase() !== "paid") continue;
        const c = cell(r.account_id, ym(r.bill_date));
        if (c) c.si += Number(r.si_value ?? 0) * SI_PAYOUT_RATE;
      }
      type Sal = { account_id: string; month: string | null; total_tb_salary: number | null; net_total: number | null };
      for (const r of (salRes.data as Sal[]) ?? []) {
        const c = cell(r.account_id, ymFromMonthLabel(r.month));
        if (c) c.salary += tbpNet(r);
      }
      type Pin = { account_id: string; dated: string | null; amount: number | null; status: string | null };
      for (const r of (pinRes.data as Pin[]) ?? []) {
        if (!PAID_PIN_STATUSES.includes((r.status ?? "").toLowerCase())) continue;
        const c = cell(r.account_id, ym(r.dated));
        if (c) c.promo += Number(r.amount ?? 0) * PROMO_PAYOUT_RATE;
      }
      type Buy = { account_id: string; buy_date: string | null; gold_worth: number | null };
      for (const r of (buyRes.data as Buy[]) ?? []) {
        const c = cell(r.account_id, ym(r.buy_date));
        if (c) { c.goldBuy += Number(r.gold_worth ?? 0); c.hasGold = true; }
      }
      type Sell = { account_id: string; sell_date: string | null; gold_worth: number | null; status: string | null };
      for (const r of (sellRes.data as Sell[]) ?? []) {
        if (r.status !== SELL_DONE_STATUS) continue;
        const c = cell(r.account_id, ym(r.sell_date));
        if (c) c.goldSell += Number(r.gold_worth ?? 0);
      }
      type Wd = { account_id: string; amount: number | null; status: string | null; requested_at: string | null };
      for (const r of (wdRes.data as Wd[]) ?? []) {
        if (!PAID_WITHDRAWAL_STATUSES.includes((r.status ?? "").toLowerCase())) continue;
        const c = cell(r.account_id, ymIst(r.requested_at));
        if (c) c.withdrawn += Number(r.amount ?? 0);
      }

      setAccounts((accountsRes.data as AccountRow[]) ?? []);
      setCells([...map.values()]);
      setLoading(false);
    })();
  }, []);

  const accountName = (id: string) => accounts.find((a) => a.member_id === id)?.name ?? id;

  const allMonths = useMemo(() => [...new Set(cells.map((c) => c.month))].sort(), [cells]);

  const rows = useMemo(
    () =>
      cells
        .filter((c) => filterAccount === "all" || c.accountId === filterAccount)
        .filter((c) => (!fromMonth || c.month >= fromMonth) && (!toMonth || c.month <= toMonth))
        .map(toFlow)
        .filter((r) => eraFilter === "all" || r.era === eraFilter),
    [cells, filterAccount, fromMonth, toMonth, eraFilter]
  );

  const months = useMemo(() => [...new Set(rows.map((r) => r.month))].sort().reverse(), [rows]);
  const totals = sum(rows);
  const visibleAccounts = accounts.filter((a) => filterAccount === "all" || a.member_id === filterAccount);

  function toggle(month: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  }

  function exportCsv() {
    downloadCsv(
      `in-hand-${filterAccount}${eraFilter === "all" ? "" : `-${eraFilter}`}.csv`,
      ["Month", "Account", "Era", "Sales Incentive", "Salary", "Promo", "IN", "IN Source", "OUT", "OUT Source", "NET"],
      [...rows]
        .sort((a, b) => b.month.localeCompare(a.month) || accountName(a.accountId).localeCompare(accountName(b.accountId)))
        .map((r) => [
          r.month, accountName(r.accountId), r.era, r.si, r.salary, r.promo,
          r.in, inSource(new Set([r.era])), r.out, outSource(r), r.net,
        ])
    );
  }

  const pad = "px-4 py-3";
  const breakdownCell = (value: number, approx: boolean) => (
    <td className={`${pad} text-right ${approx ? "text-maroon-900/40" : ""}`} title={approx ? "Approximate: gold-era months are exact only as a total" : undefined}>
      {value ? `${approx ? "~" : ""}${formatINR(Math.round(value))}` : "—"}
    </td>
  );

  function flowCells(r: { era: Era | "mixed"; si: number; salary: number; promo: number; in: number; out: number; net: number }, inSrc: string, outSrc: string) {
    const approx = r.era !== "cash";
    return (
      <>
        <td className={pad}><EraBadge era={r.era} /></td>
        {breakdownCell(r.si, approx)}
        {breakdownCell(r.salary, approx)}
        {breakdownCell(r.promo, approx)}
        <td className={`${pad} text-right font-semibold text-green-700`}>{formatINR(Math.round(r.in))}</td>
        <td className={`${pad} text-xs text-maroon-900/50`}>{inSrc}</td>
        <td className={`${pad} text-right font-semibold text-red-700`}>{r.out ? formatINR(Math.round(r.out)) : "—"}</td>
        <td className={`${pad} text-xs text-maroon-900/50`}>{outSrc}</td>
        <td className={`${pad} text-right font-bold ${r.net < 0 ? "text-red-700" : "text-maroon-900"}`}>{formatINR(Math.round(r.net))}</td>
      </>
    );
  }

  return (
    <Layout>
      <div className="px-4 sm:px-8 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-maroon-900">In-Hand</h1>
          <p className="text-sm text-maroon-900/50 mt-0.5">
            Money actually received (IN) and taken out (OUT) per account, by the month it happened, in ₹ after charges.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">IN</p>
            <p className="text-3xl font-bold mt-2 text-green-700">{formatINR(Math.round(totals.in))}</p>
            <p className="text-xs text-maroon-900/40 mt-1">gold bought + cash credited</p>
          </div>
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">OUT</p>
            <p className="text-3xl font-bold mt-2 text-red-700">{formatINR(Math.round(totals.out))}</p>
            <p className="text-xs text-maroon-900/40 mt-1">gold sold + withdrawals paid out</p>
          </div>
          <div className="bg-gold-500 rounded-xl shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/60 uppercase tracking-wider">NET</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{formatINR(Math.round(totals.net))}</p>
            <p className="text-xs text-maroon-900/60 mt-1">IN − OUT for the selected range</p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className={LABEL_CLASS}>Account</label>
            <select value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)} className={SELECT_CLASS}>
              <option value="all">All accounts</option>
              {accounts.map((a) => (
                <option key={a.member_id} value={a.member_id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS}>From</label>
            <select value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} className={SELECT_CLASS}>
              <option value="">Start</option>
              {allMonths.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS}>To</label>
            <select value={toMonth} onChange={(e) => setToMonth(e.target.value)} className={SELECT_CLASS}>
              <option value="">Now</option>
              {allMonths.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS}>Era</label>
            <select value={eraFilter} onChange={(e) => setEraFilter(e.target.value as "all" | Era)} className={SELECT_CLASS}>
              <option value="all">All</option>
              <option value="gold">Gold (to Oct 2026)</option>
              <option value="cash">Cash (from Nov 2026)</option>
            </select>
          </div>
          <button
            onClick={exportCsv}
            disabled={!rows.length}
            className="ml-auto text-sm border border-maroon-200 rounded-lg px-3 py-1.5 bg-white text-maroon-700 hover:bg-maroon-50 disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-sm mb-6 space-y-1">
          <p>
            <span className="font-semibold">Gold months (to Oct 2026):</span> IN is the gold actually bought, so the total is exact. The
            Sales Incentive / Salary / Promo split there is approximate (shown faded with ~).
          </p>
          <p>
            <span className="font-semibold">Timing:</span> earnings pay out early the following month, and a month's OUT can exceed its IN
            because gold sells lag the buys and include price gains. It evens out over the whole period, not month by month.
          </p>
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
                    <th className="px-4 py-3">Account</th>
                    <th className="px-4 py-3 text-right">IN</th>
                    <th className="px-4 py-3 text-right">OUT</th>
                    <th className="px-4 py-3 text-right">NET</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-maroon-50">
                  {visibleAccounts.map((a) => {
                    const t = sum(rows.filter((r) => r.accountId === a.member_id));
                    return (
                      <tr key={a.member_id} className="hover:bg-maroon-50/50">
                        <td className="px-4 py-3">
                          <button onClick={() => setFilterAccount(a.member_id)} className="font-medium text-maroon-700 hover:underline text-left">
                            {a.name}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right text-green-700">{formatINR(Math.round(t.in))}</td>
                        <td className="px-4 py-3 text-right text-red-700">{formatINR(Math.round(t.out))}</td>
                        <td className={`px-4 py-3 text-right font-semibold ${t.net < 0 ? "text-red-700" : ""}`}>{formatINR(Math.round(t.net))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <h2 className="text-lg font-semibold text-maroon-900 mb-3">By Month</h2>
            <div className="bg-white rounded-xl border border-maroon-100 shadow-sm overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-maroon-50 text-left text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">
                    <th className="px-4 py-3">Month</th>
                    <th className="px-4 py-3">Era</th>
                    <th className="px-4 py-3 text-right">Sales Inc.</th>
                    <th className="px-4 py-3 text-right">Salary</th>
                    <th className="px-4 py-3 text-right">Promo</th>
                    <th className="px-4 py-3 text-right">IN</th>
                    <th className="px-4 py-3">IN Source</th>
                    <th className="px-4 py-3 text-right">OUT</th>
                    <th className="px-4 py-3">OUT Source</th>
                    <th className="px-4 py-3 text-right">NET</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-maroon-50">
                  {months.length ? (
                    months.map((m) => {
                      const monthRows = rows.filter((r) => r.month === m);
                      const t = sum(monthRows);
                      const eras = new Set(monthRows.map((r) => r.era));
                      const era: Era | "mixed" = eras.size === 1 ? [...eras][0] : "mixed";
                      const goldSell = monthRows.reduce((s, r) => s + r.goldSell, 0);
                      const withdrawn = monthRows.reduce((s, r) => s + r.withdrawn, 0);
                      const canExpand = filterAccount === "all" && monthRows.length > 0;
                      const open = expanded.has(m);
                      return (
                        <Fragment key={m}>
                          <tr className="hover:bg-maroon-50/50">
                            <td className={`${pad} font-medium text-maroon-900 whitespace-nowrap`}>
                              {canExpand ? (
                                <button onClick={() => toggle(m)} className="hover:underline text-left" aria-expanded={open}>
                                  <span className="text-maroon-700 mr-1">{open ? "▾" : "▸"}</span>
                                  {monthLabel(m)}
                                </button>
                              ) : (
                                monthLabel(m)
                              )}
                            </td>
                            {flowCells({ era, ...t }, inSource(eras), outSource({ goldSell, withdrawn }))}
                          </tr>
                          {canExpand && open &&
                            [...monthRows]
                              .sort((a, b) => accountName(a.accountId).localeCompare(accountName(b.accountId)))
                              .map((r) => (
                                <tr key={`${m}-${r.accountId}`} className="bg-maroon-50/40 text-xs">
                                  <td className={`${pad} pl-10 text-maroon-900/70`}>{accountName(r.accountId)}</td>
                                  {flowCells(r, inSource(new Set([r.era])), outSource(r))}
                                </tr>
                              ))}
                        </Fragment>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={10} className="px-5 py-8 text-center text-maroon-900/40">No money movement in this range.</td>
                    </tr>
                  )}
                </tbody>
                {months.length > 0 && (
                  <tfoot>
                    <tr className="bg-maroon-50 font-semibold">
                      <td className={pad}>Total</td>
                      <td className={pad} />
                      {breakdownCell(totals.si, rows.some((r) => r.era === "gold"))}
                      {breakdownCell(totals.salary, rows.some((r) => r.era === "gold"))}
                      {breakdownCell(totals.promo, rows.some((r) => r.era === "gold"))}
                      <td className={`${pad} text-right text-green-700`}>{formatINR(Math.round(totals.in))}</td>
                      <td className={pad} />
                      <td className={`${pad} text-right text-red-700`}>{formatINR(Math.round(totals.out))}</td>
                      <td className={pad} />
                      <td className={`${pad} text-right`}>{formatINR(Math.round(totals.net))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
