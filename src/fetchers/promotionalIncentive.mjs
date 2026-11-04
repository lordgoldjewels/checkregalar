// Promotional Incentive Pins -> GET /member/earnings?stream=CBC (paginated).
// `reference` is the pin code. Returns the shape
// upsertPromotionalIncentivePins() expects.
// Change-detection note: old "redeemed" was active/pending -> closed; the new
// status is pending -> paid (handle in the diff/Telegram layer).
import { apiGetAllPages, isoToDdMmYyyy } from "../api/client.mjs";

export async function fetchPromotionalIncentive(token) {
  const rows = await apiGetAllPages(token, "/member/earnings?stream=CBC");
  return rows.map((r) => ({
    code: r.reference,
    category: null, // no equivalent (stream is "CBC")
    dated: isoToDdMmYyyy(r.date),
    amount: r.amount,
    status: r.status, // "pending" / "paid"
    // KEEP (new) — ready for a `paid_on` column:
    paidOn: r.paid_on ?? null,
  }));
}
