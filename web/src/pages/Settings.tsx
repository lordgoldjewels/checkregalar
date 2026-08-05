import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";

interface NotificationType {
  type: string;
  label: string;
  category: string;
}

const TYPES: NotificationType[] = [
  { type: "sales_incentive", label: "Sales Incentive", category: "New Earnings" },
  { type: "turnover_salary", label: "Turnover Salary", category: "New Earnings" },
  { type: "promotional_incentive", label: "Promotional Incentive", category: "New Earnings" },
  { type: "digigold_buy", label: "DigiGold Buy", category: "DigiGold Transactions" },
  { type: "digigold_sell", label: "DigiGold Sell", category: "DigiGold Transactions" },
  { type: "scrape_crashed", label: "Scrape Crashed", category: "Failures" },
  { type: "failed_to_load_home", label: "Failed to Load Home", category: "Failures" },
  { type: "session_expired", label: "Session Expired", category: "Failures" },
  { type: "account_scrape_failure", label: "Per-Account Scrape Failure", category: "Failures" },
  { type: "partial_run_summary", label: "Partial Run Summary", category: "Failures" },
];

const CATEGORIES = ["New Earnings", "DigiGold Transactions", "Failures"];

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={on}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        on ? "bg-maroon-700" : "bg-gray-300"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          on ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export default function Settings() {
  const [enabled, setEnabled] = useState<Map<string, boolean>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    const { data } = await supabase.from("notification_settings").select("type, enabled");
    setEnabled(new Map((data as { type: string; enabled: boolean }[] ?? []).map((r) => [r.type, r.enabled])));
    setLoading(false);
  }

  async function toggle(type: string) {
    const next = !(enabled.get(type) ?? true);
    setEnabled((prev) => new Map(prev).set(type, next));
    const { error } = await supabase.from("notification_settings").update({ enabled: next }).eq("type", type);
    if (error) {
      setEnabled((prev) => new Map(prev).set(type, !next));
    }
  }

  return (
    <Layout>
      <div className="px-4 sm:px-8 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-maroon-900">Notifications</h1>
          <p className="text-sm text-maroon-900/50 mt-0.5">Control which Telegram alerts the scraper sends</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48 bg-white rounded-xl border border-maroon-100 shadow-sm">
            <p className="text-sm text-maroon-900/40">Loading…</p>
          </div>
        ) : (
          <div className="space-y-6">
            {CATEGORIES.map((category) => (
              <div key={category}>
                <h2 className="text-lg font-semibold text-maroon-900 mb-3">{category}</h2>
                <div className="bg-white rounded-xl border border-maroon-100 shadow-sm divide-y divide-maroon-50">
                  {TYPES.filter((t) => t.category === category).map((t) => (
                    <div key={t.type} className="flex items-center justify-between px-5 py-3.5">
                      <span className="text-sm text-maroon-900">{t.label}</span>
                      <Toggle on={enabled.get(t.type) ?? true} onClick={() => toggle(t.type)} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
