import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";
import { formatINR, formatDateTime } from "../lib/format";

interface AccountRow {
  member_id: string;
  name: string;
  phone_number: string;
}

interface SnapshotRow {
  account_id: string;
  captured_at: string;
  my_business: number | null;
  my_earning: number | null;
  my_withdraw: number | null;
}

interface RunRow {
  id: number;
  phone_number: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  accounts_scraped: number;
}

export default function Dashboard() {
  const [accounts, setAccounts]   = useState<AccountRow[]>([]);
  const [latest, setLatest]       = useState<Map<string, SnapshotRow>>(new Map());
  const [runs, setRuns]           = useState<RunRow[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);

    const [accountsRes, snapshotsRes, runsRes] = await Promise.all([
      supabase.from("accounts").select("member_id, name, phone_number").order("name"),
      supabase
        .from("dashboard_snapshots")
        .select("account_id, captured_at, my_business, my_earning, my_withdraw"),
      supabase
        .from("scrape_runs")
        .select("id, phone_number, started_at, finished_at, status, accounts_scraped")
        .order("started_at", { ascending: false })
        .limit(10),
    ]);

    const latestMap = new Map<string, SnapshotRow>();
    for (const row of (snapshotsRes.data as SnapshotRow[]) ?? []) {
      latestMap.set(row.account_id, row);
    }

    setAccounts((accountsRes.data as AccountRow[]) ?? []);
    setLatest(latestMap);
    setRuns((runsRes.data as RunRow[]) ?? []);
    setLoading(false);
  }

  const totals = accounts.reduce(
    (acc, a) => {
      const s = latest.get(a.member_id);
      acc.business += s?.my_business ?? 0;
      acc.earning  += s?.my_earning ?? 0;
      acc.withdraw += s?.my_withdraw ?? 0;
      return acc;
    },
    { business: 0, earning: 0, withdraw: 0 }
  );

  const lastRun = runs[0];

  const stats = [
    { label: "Accounts",      value: accounts.length,                 sub: "tracked" },
    { label: "Total Business", value: formatINR(totals.business),      sub: "latest snapshots" },
    { label: "Total Earning",  value: formatINR(totals.earning),       sub: "latest snapshots" },
    { label: "Total Withdraw", value: formatINR(totals.withdraw),      sub: "latest snapshots" },
    {
      label: "Last Run",
      value: lastRun ? lastRun.status : "—",
      sub: lastRun ? formatDateTime(lastRun.started_at) : "no runs yet",
      color: lastRun?.status === "success" ? "text-green-700" : lastRun?.status === "partial" ? "text-amber-600" : undefined,
    },
  ];

  return (
    <Layout>
      <div className="px-4 sm:px-8 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-maroon-900">Dashboard</h1>
          <p className="text-sm text-maroon-900/50 mt-0.5">Overview across all tracked accounts</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-6">
          {stats.map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
              <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">{s.label}</p>
              <p className={`text-2xl sm:text-3xl font-bold mt-2 ${s.color ?? "text-maroon-900"}`}>{s.value}</p>
              <p className="text-xs text-maroon-900/40 mt-1">{s.sub}</p>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48 bg-white rounded-xl border border-maroon-100 shadow-sm">
            <p className="text-sm text-maroon-900/40">Loading…</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-maroon-50 text-left text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Member ID</th>
                  <th className="px-5 py-3">Business</th>
                  <th className="px-5 py-3">Earning</th>
                  <th className="px-5 py-3">Withdraw</th>
                  <th className="px-5 py-3">Last Scraped</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-maroon-50">
                {accounts.map((a) => {
                  const s = latest.get(a.member_id);
                  return (
                    <tr key={a.member_id} className="hover:bg-maroon-50/50">
                      <td className="px-5 py-3">
                        <Link to={`/accounts/${a.member_id}`} className="font-medium text-maroon-700 hover:underline">
                          {a.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-maroon-900/60 font-mono text-xs">{a.member_id}</td>
                      <td className="px-5 py-3">{formatINR(s?.my_business)}</td>
                      <td className="px-5 py-3">{formatINR(s?.my_earning)}</td>
                      <td className="px-5 py-3">{formatINR(s?.my_withdraw)}</td>
                      <td className="px-5 py-3 text-maroon-900/50">{formatDateTime(s?.captured_at)}</td>
                    </tr>
                  );
                })}
                {accounts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-maroon-900/40">
                      No accounts yet.
                    </td>
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
