import { useEffect, useState, FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Layout from "../components/Layout";
import Toggle from "../components/Toggle";

interface AccountRow {
  member_id: string;
  name: string;
  phone_number: string;
  upline_member_id: string | null;
  enabled: boolean;
}

const INPUT_CLASS =
  "w-full border border-maroon-100 rounded-lg px-3 py-2 text-sm text-maroon-900 focus:outline-none focus:ring-2 focus:ring-gold-500";
const LABEL_CLASS = "block text-xs font-semibold text-maroon-900/50 uppercase tracking-wider mb-1";

type FormState = { mode: "add" } | { mode: "edit"; account: AccountRow };

export default function Accounts() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [phoneNumbers, setPhoneNumbers] = useState<string[]>([]);
  const [loading, setLoading]   = useState(true);

  const [form, setForm] = useState<FormState | null>(null);
  const [memberId, setMemberId] = useState("");
  const [name, setName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [uplineMemberId, setUplineMemberId] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    const [accountsRes, phonesRes] = await Promise.all([
      supabase.from("accounts").select("member_id, name, phone_number, upline_member_id, enabled").order("name"),
      supabase.from("phone_sessions").select("phone_number"),
    ]);
    setAccounts((accountsRes.data as AccountRow[]) ?? []);
    setPhoneNumbers(((phonesRes.data as { phone_number: string }[]) ?? []).map((p) => p.phone_number));
    setLoading(false);
  }

  const nameById = new Map(accounts.map((a) => [a.member_id, a.name]));

  function openAdd() {
    setMemberId("");
    setName("");
    setPhoneNumber(phoneNumbers[0] ?? "");
    setUplineMemberId("");
    setFormError(null);
    setForm({ mode: "add" });
  }

  function openEdit(account: AccountRow) {
    setMemberId(account.member_id);
    setName(account.name);
    setPhoneNumber(account.phone_number);
    setUplineMemberId(account.upline_member_id ?? "");
    setFormError(null);
    setForm({ mode: "edit", account });
  }

  function closeForm() {
    setForm(null);
    setFormError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (!memberId.trim() || !name.trim() || !phoneNumber) {
      setFormError("Member ID, name, and phone number are required.");
      return;
    }
    setSaving(true);
    setFormError(null);

    const payload = {
      name: name.trim(),
      phone_number: phoneNumber,
      upline_member_id: uplineMemberId || null,
    };

    const { error } =
      form.mode === "add"
        ? await supabase.from("accounts").insert({ member_id: memberId.trim(), ...payload })
        : await supabase.from("accounts").update(payload).eq("member_id", form.account.member_id);

    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    closeForm();
    fetchData();
  }

  async function handleDelete(account: AccountRow) {
    if (!window.confirm(`Delete ${account.name} (${account.member_id})? This cannot be undone.`)) return;
    setListError(null);
    const { error } = await supabase.from("accounts").delete().eq("member_id", account.member_id);
    if (error) {
      setListError(
        error.code === "23503"
          ? `Can't delete ${account.name} — this account still has tracked records (Sales Incentive, DigiGold, etc.). Remove those first.`
          : error.message
      );
      return;
    }
    fetchData();
  }

  async function toggleEnabled(account: AccountRow) {
    const next = !account.enabled;
    setAccounts((prev) => prev.map((a) => (a.member_id === account.member_id ? { ...a, enabled: next } : a)));
    const { error } = await supabase.from("accounts").update({ enabled: next }).eq("member_id", account.member_id);
    if (error) {
      setAccounts((prev) => prev.map((a) => (a.member_id === account.member_id ? { ...a, enabled: account.enabled } : a)));
    }
  }

  return (
    <Layout>
      <div className="px-4 sm:px-8 py-6 sm:py-8">
        <div className="flex items-center justify-between mb-6 sm:mb-8">
          <div>
            <h1 className="text-2xl font-bold text-maroon-900">Accounts</h1>
            <p className="text-sm text-maroon-900/50 mt-0.5">All tracked member accounts</p>
          </div>
          <button
            onClick={openAdd}
            className="bg-gold-500 hover:bg-gold-400 text-maroon-900 font-semibold text-sm px-4 py-2 rounded-lg transition"
          >
            + Add Account
          </button>
        </div>

        {listError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
            <p className="text-sm text-red-700">{listError}</p>
          </div>
        )}

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
                  <th className="px-5 py-3">Member ID</th>
                  <th className="px-5 py-3">Phone</th>
                  <th className="px-5 py-3">Upline</th>
                  <th className="px-5 py-3">Active</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-maroon-50">
                {accounts.map((a) => (
                  <tr key={a.member_id} className={`hover:bg-maroon-50/50 ${a.enabled ? "" : "opacity-50"}`}>
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
                    <td className="px-5 py-3">
                      <Toggle on={a.enabled} onClick={() => toggleEnabled(a)} />
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(a)} className="text-xs font-medium text-maroon-700 hover:underline mr-3">
                        Edit
                      </button>
                      <button onClick={() => handleDelete(a)} className="text-xs font-medium text-red-600 hover:underline">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
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

        {form && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 px-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
              <h2 className="text-lg font-semibold text-maroon-900 mb-4">
                {form.mode === "add" ? "Add Account" : "Edit Account"}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className={LABEL_CLASS}>Member ID</label>
                  <input
                    type="text"
                    value={memberId}
                    onChange={(e) => setMemberId(e.target.value)}
                    disabled={form.mode === "edit"}
                    className={`${INPUT_CLASS} ${form.mode === "edit" ? "bg-maroon-50 text-maroon-900/50" : ""}`}
                    placeholder="LJW..."
                  />
                </div>
                <div>
                  <label className={LABEL_CLASS}>Name</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLASS} />
                </div>
                <div>
                  <label className={LABEL_CLASS}>Phone Number</label>
                  <select value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className={INPUT_CLASS}>
                    <option value="">Select a phone…</option>
                    {phoneNumbers.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  {phoneNumbers.length === 0 && (
                    <p className="text-xs text-maroon-900/40 mt-1">
                      No phone sessions yet — run <code className="font-mono">npm run login -- &lt;phone&gt;</code> first.
                    </p>
                  )}
                </div>
                <div>
                  <label className={LABEL_CLASS}>Upline</label>
                  <select value={uplineMemberId} onChange={(e) => setUplineMemberId(e.target.value)} className={INPUT_CLASS}>
                    <option value="">None</option>
                    {accounts
                      .filter((a) => a.member_id !== memberId)
                      .map((a) => (
                        <option key={a.member_id} value={a.member_id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </div>

                {formError && <p className="text-sm text-red-600">{formError}</p>}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closeForm}
                    className="text-sm font-medium text-maroon-700 border border-maroon-100 rounded-lg px-4 py-2 hover:bg-maroon-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="bg-gold-500 hover:bg-gold-400 text-maroon-900 font-semibold text-sm px-4 py-2 rounded-lg transition disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
