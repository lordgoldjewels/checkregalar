import { Fragment, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";
import { formatDateTime } from "../lib/format";

interface RunRow {
  id: number;
  phone_number: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  accounts_scraped: number;
  errors: any;
}

const STATUS_STYLE: Record<string, string> = {
  success: "bg-green-100 text-green-700",
  partial: "bg-amber-100 text-amber-700",
  running: "bg-blue-100 text-blue-700",
  session_expired: "bg-red-100 text-red-700",
};

export default function ScrapeRuns() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .from("scrape_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setRuns((data as RunRow[]) ?? []);
        setLoading(false);
      });
  }, []);

  return (
    <Layout>
      <div className="px-4 sm:px-8 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-maroon-900">Scrape Runs</h1>
          <p className="text-sm text-maroon-900/50 mt-0.5">History of scrape executions</p>
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
                  <th className="px-5 py-3">Phone</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Accounts Scraped</th>
                  <th className="px-5 py-3">Started</th>
                  <th className="px-5 py-3">Finished</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-maroon-50">
                {runs.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="hover:bg-maroon-50/50">
                      <td className="px-5 py-3">{r.phone_number}</td>
                      <td className="px-5 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[r.status] ?? "bg-gray-100 text-gray-700"}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-5 py-3">{r.accounts_scraped}</td>
                      <td className="px-5 py-3 text-maroon-900/60">{formatDateTime(r.started_at)}</td>
                      <td className="px-5 py-3 text-maroon-900/60">{formatDateTime(r.finished_at)}</td>
                      <td className="px-5 py-3 text-right">
                        {r.errors && (
                          <button
                            onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                            className="text-xs font-medium text-maroon-700 hover:underline"
                          >
                            {expanded === r.id ? "Hide errors" : "View errors"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded === r.id && r.errors && (
                      <tr>
                        <td colSpan={6} className="px-5 py-3 bg-red-50/50">
                          <pre className="text-xs text-red-700 whitespace-pre-wrap">{JSON.stringify(r.errors, null, 2)}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {runs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-maroon-900/40">
                      No scrape runs yet.
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
