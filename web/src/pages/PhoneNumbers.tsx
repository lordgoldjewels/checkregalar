import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";
import Toggle from "../components/Toggle";
import { formatDateTime } from "../lib/format";

interface PhoneSessionRow {
  phone_number: string;
  status: string;
  updated_at: string;
}

export default function PhoneNumbers() {
  const [phones, setPhones] = useState<PhoneSessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    const { data } = await supabase.from("phone_sessions").select("phone_number, status, updated_at").order("phone_number");
    setPhones((data as PhoneSessionRow[]) ?? []);
    setLoading(false);
  }

  async function toggle(phone: PhoneSessionRow) {
    const next = phone.status === "active" ? "session_expired" : "active";
    setPhones((prev) => prev.map((p) => (p.phone_number === phone.phone_number ? { ...p, status: next } : p)));
    const { error } = await supabase.from("phone_sessions").update({ status: next }).eq("phone_number", phone.phone_number);
    if (error) {
      setPhones((prev) => prev.map((p) => (p.phone_number === phone.phone_number ? { ...p, status: phone.status } : p)));
    }
  }

  return (
    <Layout>
      <div className="px-4 sm:px-8 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-maroon-900">Phone Numbers</h1>
          <p className="text-sm text-maroon-900/50 mt-0.5">
            Login sessions the scraper uses. A phone marked inactive is skipped by every scrape run. New sessions
            require the interactive CLI login (SMS OTP): <code className="font-mono">npm run login -- &lt;phone&gt;</code>.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48 bg-white rounded-xl border border-maroon-100 shadow-sm">
            <p className="text-sm text-maroon-900/40">Loading…</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-maroon-100 shadow-sm divide-y divide-maroon-50">
            {phones.map((p) => (
              <div key={p.phone_number} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <p className="text-sm text-maroon-900 font-medium">{p.phone_number}</p>
                  <p className="text-xs text-maroon-900/40 mt-0.5">
                    {p.status === "active" ? "Active" : "Session expired"} &middot; updated {formatDateTime(p.updated_at)}
                  </p>
                </div>
                <Toggle on={p.status === "active"} onClick={() => toggle(p)} />
              </div>
            ))}
            {phones.length === 0 && <p className="px-5 py-8 text-center text-sm text-maroon-900/40">No phone sessions yet.</p>}
          </div>
        )}
      </div>
    </Layout>
  );
}
