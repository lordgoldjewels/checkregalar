import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";
import { formatINR } from "../lib/format";

const SI_CHARGE_RATE = 0.10; // Sales Incentive is charged 10%; net = 90% of gross.

interface AccountRow {
  member_id: string;
  name: string;
}

interface IncomeTotals {
  salesIncentiveGross: number;
  turnoverSalary: number;
}

export default function Income() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [totals, setTotals]     = useState<Map<string, IncomeTotals>>(new Map());
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);

    const [accountsRes, siRes, tsRes] = await Promise.all([
      supabase.from("accounts").select("member_id, name").order("name"),
      supabase.from("sales_incentive").select("account_id, si_value"),
      supabase.from("turnover_salary").select("account_id, net_total"),
    ]);

    const map = new Map<string, IncomeTotals>();
    const ensure = (id: string) => {
      if (!map.has(id)) map.set(id, { salesIncentiveGross: 0, turnoverSalary: 0 });
      return map.get(id)!;
    };

    for (const row of (siRes.data as { account_id: string; si_value: number | null }[]) ?? []) {
      ensure(row.account_id).salesIncentiveGross += row.si_value ?? 0;
    }
    for (const row of (tsRes.data as { account_id: string; net_total: number | null }[]) ?? []) {
      ensure(row.account_id).turnoverSalary += row.net_total ?? 0;
    }

    setAccounts((accountsRes.data as AccountRow[]) ?? []);
    setTotals(map);
    setLoading(false);
  }

  const netOf = (t: IncomeTotals) => t.salesIncentiveGross * (1 - SI_CHARGE_RATE);

  const grandSalesIncentiveGross = [...totals.values()].reduce((s, t) => s + t.salesIncentiveGross, 0);
  const grandSalesIncentiveNet   = grandSalesIncentiveGross * (1 - SI_CHARGE_RATE);
  const grandTurnoverSalary      = [...totals.values()].reduce((s, t) => s + t.turnoverSalary, 0);
  const grandTotal               = grandSalesIncentiveNet + grandTurnoverSalary;

  return (
    <Layout>
      <div className="px-4 sm:px-8 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-maroon-900">Income</h1>
          <p className="text-sm text-maroon-900/50 mt-0.5">Sales Incentive (net of 10% charges) + Turnover-based Salary, across all accounts</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">Sales Incentive (Net)</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{formatINR(grandSalesIncentiveNet)}</p>
            <p className="text-xs text-maroon-900/40 mt-1">gross {formatINR(grandSalesIncentiveGross)} &middot; 10% charges deducted</p>
          </div>
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">Turnover-based Salary</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{formatINR(grandTurnoverSalary)}</p>
            <p className="text-xs text-maroon-900/40 mt-1">net total, all accounts</p>
          </div>
          <div className="bg-gold-500 rounded-xl shadow-sm px-5 py-5">
            <p className="text-xs font-semibold text-maroon-900/60 uppercase tracking-wider">Total Income (Net)</p>
            <p className="text-3xl font-bold mt-2 text-maroon-900">{formatINR(grandTotal)}</p>
            <p className="text-xs text-maroon-900/60 mt-1">combined</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48 bg-white rounded-xl border border-maroon-100 shadow-sm">
            <p className="text-sm text-maroon-900/40">Loading…</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-maroon-50 text-left text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Sales Incentive (Gross)</th>
                  <th className="px-5 py-3">Sales Incentive (Net)</th>
                  <th className="px-5 py-3">Turnover Salary</th>
                  <th className="px-5 py-3">Total (Net)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-maroon-50">
                {accounts.map((a) => {
                  const t = totals.get(a.member_id) ?? { salesIncentiveGross: 0, turnoverSalary: 0 };
                  const net = netOf(t);
                  return (
                    <tr key={a.member_id} className="hover:bg-maroon-50/50">
                      <td className="px-5 py-3">
                        <Link to={`/accounts/${a.member_id}`} className="font-medium text-maroon-700 hover:underline">
                          {a.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-maroon-900/50">{formatINR(t.salesIncentiveGross)}</td>
                      <td className="px-5 py-3">{formatINR(net)}</td>
                      <td className="px-5 py-3">{formatINR(t.turnoverSalary)}</td>
                      <td className="px-5 py-3 font-semibold">{formatINR(net + t.turnoverSalary)}</td>
                    </tr>
                  );
                })}
                {accounts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-maroon-900/40">
                      No accounts yet.
                    </td>
                  </tr>
                )}
              </tbody>
              {accounts.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-maroon-200 bg-maroon-50 font-semibold">
                    <td className="px-5 py-3">Total</td>
                    <td className="px-5 py-3 text-maroon-900/50">{formatINR(grandSalesIncentiveGross)}</td>
                    <td className="px-5 py-3">{formatINR(grandSalesIncentiveNet)}</td>
                    <td className="px-5 py-3">{formatINR(grandTurnoverSalary)}</td>
                    <td className="px-5 py-3">{formatINR(grandTotal)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
