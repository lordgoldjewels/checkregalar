// Dashboard -> GET /member/status. Its `widgets` + `pi.installments` map 1:1 to
// the old dashboard scrape. Returns the shape upsertDashboardSnapshot() expects
// (parseAmount() is applied there and is a no-op on numbers, so no DB change).
import { apiGet } from "../api/client.mjs";

export async function fetchDashboard(token) {
  const s = await apiGet(token, "/member/status");
  const w = s.widgets ?? {};
  const pi = s.pi ?? {};
  const inst = pi.installments ?? {};
  return {
    myBusiness: w.business ?? null,
    myPromotionalIncentive: w.pi_value ?? pi.total_value ?? null,
    myPromotionalIncentiveCount: { earned: inst.paid ?? null, total: inst.total ?? null },
    myDistributors: w.distributors ?? null,
    myGrossBVolume: w.gross_bv ?? null,
    myEarning: w.earning ?? null,
    myWithdraw: w.withdraw ?? null,
    myTbpGrossBVolume: w.tbp_gross_bv ?? null,
    myGift: w.gift ?? null,
    // KEEP (new) — not yet persisted (no columns). Available for a future
    // schema change: ep (eligibility), tbp.top_distributors, coaching.
    _extra: { ep: s.ep ?? null, topDistributors: s.tbp?.top_distributors ?? null, coaching: s.coaching ?? null },
  };
}
