import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";
import { formatINR, formatNumber, formatDate, formatDateTime } from "../lib/format";
import { downloadCsv } from "../lib/csv";

// One row per (tracked account, bond) from GET /member/bonds — the "Schemes &
// Contract" page. A bond is a purchased plan: its committed `value`, term
// (bond_date → expires_on), and two pin-issuance counters — cbc (promotional)
// and lvlcom (level commission). The digital "Forward contractors" / "Wholesaler"
// bonds are the contracts that issue the monthly promotional pins. Half of each
// CBC pin pays to the wallet monthly; the other half is deferred and expected to
// release at the 12-month anniversary of the bond_date.

interface AccountRow {
  member_id: string;
  name: string;
}

interface BondRow {
  account_id: string;
  bond_id: number;
  invoice_no: string | null;
  plan_code: string | null;
  plan_name: string | null;
  plan_type: string | null;
  value: number | null;
  bond_date: string | null;
  expires_on: string | null;
  status: string | null;
  cbc_issued: number | null;
  cbc_count: number | null;
  lvlcom_issued: number | null;
  lvlcom_count: number | null;
  rd_paid: number | null;
  captured_at: string | null;
}

type SortKey = "value" | "cbc" | "bond_date" | "expires" | "anniversary";

const ALL = "all";
const SELECT_CLASS = "text-sm border border-maroon-200 rounded-lg px-3 py-1.5 bg-white text-maroon-900";
const LABEL_CLASS = "block text-xs font-semibold text-maroon-900/50 uppercase tracking-wider mb-1";

/** bond_date + 1 year = the 12-month mark where the deferred CBC half is due. */
function anniversary(bondDate: string | null): string | null {
  if (!bondDate) return null;
  const d = new Date(bondDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function planTypeBadge(type: string | null): string {
  const t = (type ?? "").toLowerCase();
  if (t === "digital") return "bg-maroon-100 text-maroon-700";
  if (t === "gold") return "bg-gold-400/30 text-maroon-800";
  if (t === "silver") return "bg-gray-200 text-gray-700";
  return "bg-gray-100 text-gray-700";
}

function statusBadge(status: string | null): string {
  const s = (status ?? "").toLowerCase();
  if (s === "active") return "bg-green-100 text-green-700";
  if (s === "matured" || s === "completed" || s === "closed") return "bg-blue-100 text-blue-700";
  return "bg-amber-100 text-amber-700";
}

// Gold/silver purchase plans (e.g. G10) pay no promotional (CBC) or level
// commission — the calculator returns cbc_total 0 for them, and their bonds'
// cbc/lvlcom counters never issue. Only the digital contract plans carry CBC.
function carriesCbc(type: string | null): boolean {
  const t = (type ?? "").toLowerCase();
  return t !== "gold" && t !== "silver";
}

function sortBonds(list: BondRow[], key: SortKey): BondRow[] {
  const sorted = [...list];
  sorted.sort((a, b) => {
    switch (key) {
      case "cbc": return Number(b.cbc_issued ?? 0) - Number(a.cbc_issued ?? 0);
      case "bond_date": return String(b.bond_date ?? "").localeCompare(String(a.bond_date ?? ""));
      case "expires": return String(a.expires_on ?? "").localeCompare(String(b.expires_on ?? ""));
      case "anniversary": return String(anniversary(a.bond_date) ?? "").localeCompare(String(anniversary(b.bond_date) ?? ""));
      default: return Number(b.value ?? 0) - Number(a.value ?? 0);
    }
  });
  return sorted;
}

export default function Bonds() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [rows, setRows] = useState<BondRow[]>([]);
  const [loading, setLoading] = useState(true);

  const filterAccount = searchParams.get("account") ?? ALL;
  const [planFilter, setPlanFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("value");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [accountsRes, bondsRes] = await Promise.all([
        supabase.from("accounts").select("member_id, name").order("member_id"),
        supabase
          .from("bonds")
          .select("account_id, bond_id, invoice_no, plan_code, plan_name, plan_type, value, bond_date, expires_on, status, cbc_issued, cbc_count, lvlcom_issued, lvlcom_count, rd_paid, captured_at"),
      ]);
      setAccounts((accountsRes.data as AccountRow[]) ?? []);
      setRows((bondsRes.data as BondRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  function setFilterAccount(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value === ALL) next.delete("account");
    else next.set("account", value);
    setSearchParams(next, { replace: true });
  }

  const accountName = (id: string) => accounts.find((a) => a.member_id === id)?.name ?? id;

  const scoped = useMemo(
    () => (filterAccount === ALL ? rows : rows.filter((r) => r.account_id === filterAccount)),
    [rows, filterAccount]
  );

  const plans = useMemo(
    () => [...new Set(scoped.map((r) => r.plan_name).filter(Boolean) as string[])].sort(),
    [scoped]
  );
  const statuses = useMemo(
    () => [...new Set(scoped.map((r) => r.status).filter(Boolean) as string[])].sort(),
    [scoped]
  );

  const matches = (r: BondRow) => {
    if (planFilter !== ALL && r.plan_name !== planFilter) return false;
    if (statusFilter !== ALL && r.status !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    if (q && !(r.plan_name ?? "").toLowerCase().includes(q) && !(r.plan_code ?? "").toLowerCase().includes(q) && !(r.invoice_no ?? "").toLowerCase().includes(q)) return false;
    return true;
  };

  const filtered = useMemo(
    () => sortBonds(scoped.filter(matches), sortKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scoped, planFilter, statusFilter, search, sortKey]
  );

  const committed = filtered.reduce((s, r) => s + Number(r.value ?? 0), 0);
  const digitalValue = filtered.filter((r) => (r.plan_type ?? "").toLowerCase() === "digital").reduce((s, r) => s + Number(r.value ?? 0), 0);
  const activeCount = filtered.filter((r) => (r.status ?? "").toLowerCase() === "active").length;
  const cbcIssued = filtered.filter((r) => carriesCbc(r.plan_type)).reduce((s, r) => s + Number(r.cbc_count ?? 0), 0);
  const cbcTotal = filtered.filter((r) => carriesCbc(r.plan_type)).reduce((s, r) => s + Number(r.cbc_issued ?? 0), 0);
  const capturedAt = rows.reduce<string | null>((max, r) => (r.captured_at && (!max || r.captured_at > max) ? r.captured_at : max), null);

  function exportCsv() {
    downloadCsv(
      `bonds-${filterAccount === ALL ? "all" : filterAccount}.csv`,
      ["Account", "Invoice", "Plan Code", "Plan", "Type", "Value", "Bond Date", "Expires On", "12-mo Mark", "Status", "CBC Issued", "CBC Total", "LVL Issued", "LVL Total", "RD Paid"],
      filtered.map((r) => [
        accountName(r.account_id),
        r.invoice_no,
        r.plan_code,
        r.plan_name,
        r.plan_type,
        r.value,
        r.bond_date,
        r.expires_on,
        anniversary(r.bond_date),
        r.status,
        carriesCbc(r.plan_type) ? r.cbc_count : "",
        carriesCbc(r.plan_type) ? r.cbc_issued : "",
        carriesCbc(r.plan_type) ? r.lvlcom_count : "",
        carriesCbc(r.plan_type) ? r.lvlcom_issued : "",
        r.rd_paid,
      ])
    );
  }

  const showAccount = filterAccount === ALL;
  const colCount = showAccount ? 10 : 9;

  return (
    <Layout>
      <div className="px-4 sm:px-8 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-maroon-900">Bonds &amp; Contracts</h1>
          <p className="text-sm text-maroon-900/50 mt-0.5">
            Each account's purchased plans. The digital "Forward contractors" / "Wholesaler" bonds
            are the contracts that issue the monthly promotional (CBC) pins.
            {capturedAt && ` As of ${formatDateTime(capturedAt)}.`}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <div className="bg-gold-500 rounded-xl shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/60 uppercase tracking-wider">Contracts</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{formatNumber(filtered.length)}</p>
            <p className="text-xs text-maroon-900/60 mt-1">{activeCount} active</p>
          </div>
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">Committed Value</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{formatINR(committed)}</p>
            <p className="text-xs text-maroon-900/40 mt-1">{formatINR(digitalValue)} in digital contracts</p>
          </div>
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">CBC Pins Issued</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{formatNumber(cbcIssued)}<span className="text-lg text-maroon-900/40"> / {formatNumber(cbcTotal)}</span></p>
            <p className="text-xs text-maroon-900/40 mt-1">promotional pins generated so far</p>
          </div>
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">Accounts</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{formatNumber(new Set(filtered.map((r) => r.account_id)).size)}</p>
            <p className="text-xs text-maroon-900/40 mt-1">with contracts shown</p>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-maroon-100 bg-white px-5 py-4 text-sm text-maroon-900/70">
          <span className="font-semibold text-maroon-900">How the CBC payout works: </span>
          50% of each promotional pin pays to the cash wallet every month; the other 50% is held and
          expected to release at the <span className="font-semibold text-maroon-900">12-month mark</span> of
          each contract (a 24-month plan releases it at months 12 and 24). The "12-mo Mark" column shows that date.
        </div>

        <div className="flex flex-wrap items-end gap-3 mb-6">
          <div>
            <label className={LABEL_CLASS}>Account</label>
            <select value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)} className={SELECT_CLASS}>
              <option value={ALL}>All accounts</option>
              {accounts.map((a) => (
                <option key={a.member_id} value={a.member_id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS}>Plan</label>
            <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} className={SELECT_CLASS}>
              <option value={ALL}>All plans</option>
              {plans.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS}>Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={SELECT_CLASS}>
              <option value={ALL}>All</option>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS}>Search</label>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Plan, code or invoice"
              className={SELECT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Sort by</label>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className={SELECT_CLASS}>
              <option value="value">Value</option>
              <option value="cbc">CBC pins</option>
              <option value="bond_date">Bond date (newest)</option>
              <option value="expires">Expires (soonest)</option>
              <option value="anniversary">12-mo mark (soonest)</option>
            </select>
          </div>
          <button
            onClick={exportCsv}
            disabled={!filtered.length}
            className="ml-auto text-sm border border-maroon-200 rounded-lg px-3 py-1.5 bg-white text-maroon-700 hover:bg-maroon-50 disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48 bg-white rounded-xl border border-maroon-100 shadow-sm">
            <p className="text-sm text-maroon-900/40">Loading…</p>
          </div>
        ) : !rows.length ? (
          <div className="flex items-center justify-center h-48 bg-white rounded-xl border border-maroon-100 shadow-sm">
            <p className="text-sm text-maroon-900/40">No bonds captured yet. They are filled by the next scrape.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-maroon-50 text-left text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">
                  {showAccount && <th className="px-5 py-3">Account</th>}
                  <th className="px-5 py-3">Plan</th>
                  <th className="px-5 py-3">Invoice</th>
                  <th className="px-5 py-3 text-right">Value</th>
                  <th className="px-5 py-3">Term</th>
                  <th className="px-5 py-3">12-mo Mark</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">CBC</th>
                  <th className="px-5 py-3 text-right">LVL</th>
                  <th className="px-5 py-3 text-right">RD Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-maroon-50">
                {filtered.length ? (
                  filtered.map((r) => (
                    <tr key={`${r.account_id}-${r.bond_id}`} className="hover:bg-maroon-50/50">
                      {showAccount && (
                        <td className="px-5 py-3">
                          <Link to={`/accounts/${r.account_id}`} className="font-medium text-maroon-700 hover:underline">{accountName(r.account_id)}</Link>
                        </td>
                      )}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-maroon-900">{r.plan_name ?? "—"}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${planTypeBadge(r.plan_type)}`}>{r.plan_type ?? "—"}</span>
                        </div>
                        <div className="text-xs text-maroon-900/40 font-mono">{r.plan_code ?? ""}</div>
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-maroon-900/60">{r.invoice_no ?? "—"}</td>
                      <td className="px-5 py-3 text-right font-semibold">{formatINR(r.value)}</td>
                      <td className="px-5 py-3 text-xs text-maroon-900/70">{formatDate(r.bond_date)} → {formatDate(r.expires_on)}</td>
                      <td className="px-5 py-3">{formatDate(anniversary(r.bond_date))}</td>
                      <td className="px-5 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(r.status)}`}>{r.status ?? "—"}</span></td>
                      <td className="px-5 py-3 text-right">{carriesCbc(r.plan_type) ? <>{formatNumber(r.cbc_count)}<span className="text-maroon-900/40"> / {formatNumber(r.cbc_issued)}</span></> : <span className="text-maroon-900/30">—</span>}</td>
                      <td className="px-5 py-3 text-right">{carriesCbc(r.plan_type) ? <>{formatNumber(r.lvlcom_count)}<span className="text-maroon-900/40"> / {formatNumber(r.lvlcom_issued)}</span></> : <span className="text-maroon-900/30">—</span>}</td>
                      <td className="px-5 py-3 text-right">{formatINR(r.rd_paid)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={colCount} className="px-5 py-8 text-center text-maroon-900/40">No contracts match these filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
