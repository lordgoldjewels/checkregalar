import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";
import { formatNumber, formatDate, formatDateTime } from "../lib/format";
import { downloadCsv } from "../lib/csv";

// One row per (tracked account, member) from GET /member/genealogy. The same
// member shows up under every tracked account above them, so "All accounts"
// merges rows by member_code. bv / gbv are business-volume points, not rupees.

interface AccountRow {
  member_id: string;
  name: string;
}

interface DistributorRow {
  account_id: string;
  member_code: string;
  name: string | null;
  rank: string | null;
  status: string | null;
  bv: number | null;
  gbv: number | null;
  team_size: number | null;
  parent_code: string | null;
  level: number | null;
  joined_on: string | null;
  captured_at: string | null;
}

interface Member {
  code: string;
  name: string;
  rank: string | null;
  status: string | null;
  bv: number;
  gbv: number;
  totalB: number; // Total-B = BV + GBV
  teamSize: number;
  parentCode: string | null;
  level: number | null; // depth within the selected account's tree; null when merged
  joinedOn: string | null;
  underAccounts: string[]; // tracked accounts whose tree contains this member (excluding itself)
}

type SortKey = "total" | "gbv" | "bv" | "team" | "name" | "joined";
type ViewMode = "table" | "tree";

const ALL = "all";

const SELECT_CLASS = "text-sm border border-maroon-200 rounded-lg px-3 py-1.5 bg-white text-maroon-900";
const LABEL_CLASS = "block text-xs font-semibold text-maroon-900/50 uppercase tracking-wider mb-1";

function rankBadge(rank: string | null): string {
  const r = (rank ?? "").toLowerCase();
  if (r.includes("district")) return "bg-purple-100 text-purple-700";
  if (r.includes("taluk")) return "bg-blue-100 text-blue-700";
  if (r === "distributor") return "bg-gray-100 text-gray-700";
  return "bg-amber-100 text-amber-700";
}

function statusBadge(status: string | null): string {
  return (status ?? "").toLowerCase() === "active" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700";
}

function toMember(r: DistributorRow): Member {
  return {
    code: r.member_code,
    name: r.name ?? r.member_code,
    rank: r.rank,
    status: r.status,
    bv: Number(r.bv ?? 0),
    gbv: Number(r.gbv ?? 0),
    totalB: Number(r.bv ?? 0) + Number(r.gbv ?? 0),
    teamSize: Number(r.team_size ?? 0),
    parentCode: r.parent_code,
    level: r.level,
    joinedOn: r.joined_on,
    underAccounts: [],
  };
}

/** Members for one account (its own tree), or every member once across all accounts. */
function buildMembers(rows: DistributorRow[], accountId: string): Member[] {
  if (accountId !== ALL) {
    return rows.filter((r) => r.account_id === accountId).map(toMember);
  }
  const byCode = new Map<string, Member>();
  for (const r of rows) {
    const m = byCode.get(r.member_code) ?? toMember(r);
    // A member's own account is the root of its tree (no parent); its upline
    // and join date come from the trees of the accounts above it.
    if (!m.parentCode && r.parent_code) m.parentCode = r.parent_code;
    if (!m.joinedOn && r.joined_on) m.joinedOn = r.joined_on;
    if (r.account_id !== r.member_code && !m.underAccounts.includes(r.account_id)) m.underAccounts.push(r.account_id);
    m.level = null;
    byCode.set(r.member_code, m);
  }
  return [...byCode.values()];
}

function sortMembers(list: Member[], key: SortKey): Member[] {
  const sorted = [...list];
  sorted.sort((a, b) => {
    switch (key) {
      case "total": return b.totalB - a.totalB;
      case "bv": return b.bv - a.bv;
      case "team": return b.teamSize - a.teamSize;
      case "name": return a.name.localeCompare(b.name);
      case "joined": return String(b.joinedOn ?? "").localeCompare(String(a.joinedOn ?? ""));
      default: return b.gbv - a.gbv;
    }
  });
  return sorted;
}

export default function Distributors() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [rows, setRows] = useState<DistributorRow[]>([]);
  const [loading, setLoading] = useState(true);

  const filterAccount = searchParams.get("account") ?? ALL;
  const [rankFilter, setRankFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [search, setSearch] = useState("");
  const [onlyTracked, setOnlyTracked] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [view, setView] = useState<ViewMode>("table");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [accountsRes, distRes] = await Promise.all([
        supabase.from("accounts").select("member_id, name").order("member_id"),
        supabase
          .from("distributors")
          .select("account_id, member_code, name, rank, status, bv, gbv, team_size, parent_code, level, joined_on, captured_at"),
      ]);
      setAccounts((accountsRes.data as AccountRow[]) ?? []);
      setRows((distRes.data as DistributorRow[]) ?? []);
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
  const trackedIds = useMemo(() => new Set(accounts.map((a) => a.member_id)), [accounts]);

  const members = useMemo(() => buildMembers(rows, filterAccount), [rows, filterAccount]);
  const nameByCode = useMemo(() => new Map(members.map((m) => [m.code, m.name])), [members]);

  // Rank and status are free text from the API, so the options come from the data.
  const ranks = useMemo(() => [...new Set(members.map((m) => m.rank).filter(Boolean) as string[])].sort(), [members]);
  const statuses = useMemo(() => [...new Set(members.map((m) => m.status).filter(Boolean) as string[])].sort(), [members]);

  const matches = (m: Member) => {
    if (rankFilter !== ALL && m.rank !== rankFilter) return false;
    if (statusFilter !== ALL && m.status !== statusFilter) return false;
    if (onlyTracked && !trackedIds.has(m.code)) return false;
    const q = search.trim().toLowerCase();
    if (q && !m.name.toLowerCase().includes(q) && !m.code.toLowerCase().includes(q)) return false;
    return true;
  };

  const filtered = useMemo(
    () => sortMembers(members.filter(matches), sortKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [members, rankFilter, statusFilter, search, onlyTracked, trackedIds, sortKey]
  );

  // Network GBV = GBV of the top of each tree (a member's GBV already includes
  // everyone below them, so summing every row would count volume many times).
  const roots = useMemo(() => {
    const codes = new Set(members.map((m) => m.code));
    return members.filter((m) => !m.parentCode || !codes.has(m.parentCode));
  }, [members]);
  const networkGbv = roots.reduce((s, m) => s + m.gbv, 0);
  const activeCount = filtered.filter((m) => (m.status ?? "").toLowerCase() === "active").length;
  const capturedAt = rows.reduce<string | null>((max, r) => (r.captured_at && (!max || r.captured_at > max) ? r.captured_at : max), null);

  const children = useMemo(() => {
    const map = new Map<string, Member[]>();
    for (const m of members) {
      if (!m.parentCode) continue;
      const list = map.get(m.parentCode) ?? [];
      list.push(m);
      map.set(m.parentCode, list);
    }
    for (const [k, list] of map) map.set(k, sortMembers(list, sortKey));
    return map;
  }, [members, sortKey]);

  const parentCodes = useMemo(() => [...children.keys()], [children]);

  function toggleNode(code: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  // In the tree, keep a node if it or anything below it matches the filters, so
  // matches stay visible in context.
  const visibleInTree = useMemo(() => {
    const keep = new Set<string>();
    const visit = (m: Member): boolean => {
      let any = matches(m);
      for (const c of children.get(m.code) ?? []) if (visit(c)) any = true;
      if (any) keep.add(m.code);
      return any;
    };
    roots.forEach(visit);
    return keep;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots, children, rankFilter, statusFilter, search, onlyTracked, trackedIds]);

  function exportCsv() {
    downloadCsv(
      `distributors-${filterAccount === ALL ? "all" : filterAccount}.csv`,
      ["Name", "Code", "Rank", "Status", "BV", "GBV", "Total-B", "Team Size", "Upline", "Upline Code", "Joined", "Level", "Under Accounts"],
      filtered.map((m) => [
        m.name,
        m.code,
        m.rank,
        m.status,
        m.bv,
        m.gbv,
        m.totalB,
        m.teamSize,
        m.parentCode ? nameByCode.get(m.parentCode) ?? "" : "",
        m.parentCode,
        m.joinedOn,
        m.level,
        m.underAccounts.map(accountName).join("; "),
      ])
    );
  }

  const memberLabel = (m: Member) => (
    <>
      {trackedIds.has(m.code) ? (
        <Link to={`/accounts/${m.code}`} className="font-medium text-maroon-700 hover:underline">{m.name}</Link>
      ) : (
        <span className="font-medium text-maroon-900">{m.name}</span>
      )}
      {trackedIds.has(m.code) && (
        <span className="ml-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase bg-gold-400/30 text-maroon-800">tracked</span>
      )}
      <div className="text-xs text-maroon-900/40 font-mono">{m.code}</div>
    </>
  );

  function renderTreeNode(m: Member, depth: number): JSX.Element | null {
    if (!visibleInTree.has(m.code)) return null;
    const dim = !matches(m);
    const kids = (children.get(m.code) ?? []).filter((c) => visibleInTree.has(c.code));
    const isOpen = !collapsed.has(m.code);
    return (
      <Fragment key={m.code}>
        <tr className={`hover:bg-maroon-50/50 ${dim ? "opacity-50" : ""}`}>
          <td className="px-5 py-2.5">
            <div style={{ paddingLeft: depth * 24 }} className="flex items-start gap-2">
              {kids.length ? (
                <button
                  onClick={() => toggleNode(m.code)}
                  aria-label={isOpen ? "Collapse" : "Expand"}
                  aria-expanded={isOpen}
                  className="w-5 h-5 -mt-0.5 shrink-0 rounded text-maroon-700 hover:bg-maroon-100 text-xs"
                >
                  {isOpen ? "▾" : "▸"}
                </button>
              ) : (
                <span className="w-5 shrink-0 text-center text-maroon-900/30 select-none">{depth === 0 ? "◆" : "└"}</span>
              )}
              <div>
                {memberLabel(m)}
                {kids.length > 0 && !isOpen && (
                  <span className="text-xs text-maroon-900/40">{kids.length} hidden below</span>
                )}
              </div>
            </div>
          </td>
          <td className="px-5 py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${rankBadge(m.rank)}`}>{m.rank ?? "—"}</span></td>
          <td className="px-5 py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(m.status)}`}>{m.status ?? "—"}</span></td>
          <td className="px-5 py-2.5 text-right">{formatNumber(m.bv)}</td>
          <td className="px-5 py-2.5 text-right">{formatNumber(m.gbv)}</td>
          <td className="px-5 py-2.5 text-right font-semibold">{formatNumber(m.totalB)}</td>
          <td className="px-5 py-2.5 text-right">{formatNumber(m.teamSize)}</td>
          <td className="px-5 py-2.5">{formatDate(m.joinedOn)}</td>
        </tr>
        {isOpen && kids.map((c) => renderTreeNode(c, depth + 1))}
      </Fragment>
    );
  }

  return (
    <Layout>
      <div className="px-4 sm:px-8 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-maroon-900">Distributors</h1>
          <p className="text-sm text-maroon-900/50 mt-0.5">
            Each account's team network. BV and GBV are business-volume points, not rupees.
            {capturedAt && ` As of ${formatDateTime(capturedAt)}.`}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <div className="bg-gold-500 rounded-xl shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/60 uppercase tracking-wider">Members</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{formatNumber(filtered.length)}</p>
            <p className="text-xs text-maroon-900/60 mt-1">
              {filterAccount === ALL ? "across all accounts, each counted once" : `in ${accountName(filterAccount)}'s tree, incl. the account`}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">Active</p>
            <p className="text-3xl font-bold mt-2 text-green-700">{formatNumber(activeCount)}</p>
            <p className="text-xs text-maroon-900/40 mt-1">
              {filtered.length - activeCount > 0 ? `${filtered.length - activeCount} not active` : "everyone shown is active"}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">Own BV</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{formatNumber(filtered.reduce((s, m) => s + m.bv, 0))}</p>
            <p className="text-xs text-maroon-900/40 mt-1">sum of each member's own BV</p>
          </div>
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">Network GBV</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{formatNumber(networkGbv)}</p>
            <p className="text-xs text-maroon-900/40 mt-1">
              GBV of the top member{roots.length > 1 ? "s" : ""} ({roots.map((r) => r.name).join(", ") || "—"})
            </p>
          </div>
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
            <label className={LABEL_CLASS}>Rank</label>
            <select value={rankFilter} onChange={(e) => setRankFilter(e.target.value)} className={SELECT_CLASS}>
              <option value={ALL}>All ranks</option>
              {ranks.map((r) => <option key={r} value={r}>{r}</option>)}
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
              placeholder="Name or code"
              className={SELECT_CLASS}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-maroon-900 pb-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlyTracked}
              onChange={(e) => setOnlyTracked(e.target.checked)}
              className="h-4 w-4 accent-maroon-700"
            />
            Only tracked
          </label>
          <div>
            <label className={LABEL_CLASS}>Sort by</label>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className={SELECT_CLASS}>
              <option value="total">Total-B</option>
              <option value="gbv">GBV</option>
              <option value="bv">BV</option>
              <option value="team">Team size</option>
              <option value="name">Name</option>
              <option value="joined">Joined (newest)</option>
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS}>View</label>
            <div className="inline-flex rounded-lg border border-maroon-200 overflow-hidden">
              {(["table", "tree"] as ViewMode[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`text-sm px-3 py-1.5 capitalize ${view === v ? "bg-maroon-700 text-white" : "bg-white text-maroon-900 hover:bg-maroon-50"}`}
                >
                  {v}
                </button>
              ))}
            </div>
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
            <p className="text-sm text-maroon-900/40">No distributors captured yet. They are filled by the next scrape.</p>
          </div>
        ) : view === "tree" ? (
          <>
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setCollapsed(new Set())}
              className="text-sm border border-maroon-200 rounded-lg px-3 py-1.5 bg-white text-maroon-700 hover:bg-maroon-50"
            >
              Expand all
            </button>
            <button
              onClick={() => setCollapsed(new Set(parentCodes))}
              className="text-sm border border-maroon-200 rounded-lg px-3 py-1.5 bg-white text-maroon-700 hover:bg-maroon-50"
            >
              Collapse all
            </button>
          </div>
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-maroon-50 text-left text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">
                  <th className="px-5 py-3">Member</th>
                  <th className="px-5 py-3">Rank</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">BV</th>
                  <th className="px-5 py-3 text-right">GBV</th>
                  <th className="px-5 py-3 text-right">Total-B</th>
                  <th className="px-5 py-3 text-right">Team</th>
                  <th className="px-5 py-3">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-maroon-50">
                {visibleInTree.size ? (
                  sortMembers(roots, sortKey).map((r) => renderTreeNode(r, 0))
                ) : (
                  <tr>
                    <td colSpan={8} className="px-5 py-8 text-center text-maroon-900/40">No members match these filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          </>
        ) : (
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-maroon-50 text-left text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">
                  <th className="px-5 py-3">Member</th>
                  <th className="px-5 py-3">Rank</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">BV</th>
                  <th className="px-5 py-3 text-right">GBV</th>
                  <th className="px-5 py-3 text-right">Total-B</th>
                  <th className="px-5 py-3 text-right">Team</th>
                  <th className="px-5 py-3">Upline</th>
                  <th className="px-5 py-3">Joined</th>
                  {filterAccount === ALL ? <th className="px-5 py-3">Under Accounts</th> : <th className="px-5 py-3">Level</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-maroon-50">
                {filtered.length ? (
                  filtered.map((m) => (
                    <tr key={m.code} className="hover:bg-maroon-50/50">
                      <td className="px-5 py-3">{memberLabel(m)}</td>
                      <td className="px-5 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${rankBadge(m.rank)}`}>{m.rank ?? "—"}</span></td>
                      <td className="px-5 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(m.status)}`}>{m.status ?? "—"}</span></td>
                      <td className="px-5 py-3 text-right">{formatNumber(m.bv)}</td>
                      <td className="px-5 py-3 text-right">{formatNumber(m.gbv)}</td>
                      <td className="px-5 py-3 text-right font-semibold">{formatNumber(m.totalB)}</td>
                      <td className="px-5 py-3 text-right">{formatNumber(m.teamSize)}</td>
                      <td className="px-5 py-3">{m.parentCode ? nameByCode.get(m.parentCode) ?? m.parentCode : "—"}</td>
                      <td className="px-5 py-3">{formatDate(m.joinedOn)}</td>
                      {filterAccount === ALL ? (
                        <td className="px-5 py-3 text-xs text-maroon-900/60">{m.underAccounts.map(accountName).join(", ") || "—"}</td>
                      ) : (
                        <td className="px-5 py-3">{m.level ?? "—"}</td>
                      )}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10} className="px-5 py-8 text-center text-maroon-900/40">No members match these filters.</td>
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
