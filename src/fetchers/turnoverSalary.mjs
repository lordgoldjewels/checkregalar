// Turnover Salary -> two calls:
//   A) GET /member/earnings?stream=GAP            -> monthly summary rows
//   B) GET /member/earnings/gap-details?month=MM  -> per-distributor breakdown
// Returns the shape upsertTurnoverSalary() expects (rows with a `breakdown[]`).
import { apiGetAllPages, apiGet } from "../api/client.mjs";

export async function fetchTurnoverSalary(token) {
  const months = await apiGetAllPages(token, "/member/earnings?stream=GAP");

  const out = [];
  for (const m of months) {
    const amount = m.amount ?? null;
    const net = m.net ?? null;
    // charges aren't a field; derive gross - net when both are present.
    const charges = amount != null && net != null ? amount - net : null;

    // The API month is "YYYY-MM" (e.g. "2026-11"); fall back to the date's
    // year-month if it's ever absent. gap-details is queried with this native
    // form. We STORE it as "MM-YYYY" ("11-2026") to match the existing rows and
    // what the web UI parses - storing the raw "YYYY-MM" created duplicate rows
    // and the UI rendered it as bogus years (e.g. "October 2079").
    const apiMonth = m.month ?? (m.date ? String(m.date).slice(0, 7) : null);
    const dbMonth = /^\d{4}-\d{2}$/.test(apiMonth || "")
      ? `${apiMonth.slice(5, 7)}-${apiMonth.slice(0, 4)}`
      : apiMonth;

    // Breakdown behind the month's "View details".
    let breakdown = [];
    try {
      const detail = await apiGet(token, `/member/earnings/gap-details?month=${encodeURIComponent(apiMonth)}`);
      breakdown = (detail.rows ?? []).map((r) => ({
        fromDistributor: r.from ?? null,
        distributorId: r.from_code ?? null, // now the member code (LJW…), was numeric
        tbpSalary: r.amount, // per-contribution gross
        // KEEP (new): level, net, date, status
        level: r.level ?? null,
        net: r.net ?? null,
        date: r.date ?? null,
        status: r.status ?? null,
      }));
    } catch (err) {
      // A missing breakdown shouldn't sink the whole month; leave it empty.
      breakdown = [];
    }

    out.push({
      month: dbMonth, // "MM-YYYY" (matches existing rows + web UI)
      noOfPackets: m.entries ?? null, // "N days of turnover salary"
      totalTbSalary: amount,
      charges,
      netTotal: net,
      breakdown,
    });
  }
  return out;
}
