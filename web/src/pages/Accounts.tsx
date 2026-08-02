import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";

interface AccountRow {
  member_id: string;
  name: string;
  phone_number: string;
  upline_member_id: string | null;
}

export default function Accounts() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    supabase
      .from("accounts")
      .select("member_id, name, phone_number, upline_member_id")
      .order("name")
      .then(({ data }) => {
        setAccounts((data as AccountRow[]) ?? []);
        setLoading(false);
      });
  }, []);

  const nameById = new Map(accounts.map((a) => [a.member_id, a.name]));

  return (
    <Layout>
      <div className="px-4 sm:px-8 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-maroon-900">Accounts</h1>
          <p className="text-sm text-maroon-900/50 mt-0.5">All tracked member accounts</p>
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
                  <th className="px-5 py-3">Phone</th>
                  <th className="px-5 py-3">Upline</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-maroon-50">
                {accounts.map((a) => (
                  <tr key={a.member_id} className="hover:bg-maroon-50/50">
                    <td className="px-5 py-3">
                      <Link to={`/accounts/${a.member_id}`} className="font-medium text-maroon-700 hover:underline">
                        {a.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-maroon-900/60 font-mono text-xs">{a.member_id}</td>
                    <td className="px-5 py-3 text-maroon-900/60">{a.phone_number}</td>
                    <td className="px-5 py-3 text-maroon-900/60">
                      {a.upline_member_id ? nameById.get(a.upline_member_id) ?? a.upline_member_id : "—"}
                    </td>
                  </tr>
                ))}
                {accounts.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-maroon-900/40">
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
