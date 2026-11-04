// Sales Incentive -> GET /member/earnings?stream=IC (Laravel-paginated).
// Returns rows in the shape upsertSalesIncentive() expects.
// NOTE: use the ITEMIZED view (per-invoice rows). The API has also returned a
// "legacy-merged" IC view (one row, reference "LEGACY-IC ×35 …"); if that shows
// up instead, a param likely toggles it - confirm when wiring the orchestrator.
import { apiGetAllPages, isoToDdMmYyyy } from "../api/client.mjs";

export async function fetchSalesIncentive(token) {
  const rows = await apiGetAllPages(token, "/member/earnings?stream=IC");
  return rows.map((r) => ({
    billDate: isoToDdMmYyyy(r.date), // API is ISO; convert so parseDdMmYyyy works
    invoiceNo: r.reference,
    fromDistributor: r.from ?? null,
    siValue: r.amount,
    status: r.status, // "paid" / "pending" (lowercase)
    payVia: null, // no equivalent in the API
    // KEEP (new) — ready for `net` / `paid_on` columns on sales_incentive:
    net: r.net ?? null,
    paidOn: r.paid_on ?? null,
  }));
}
