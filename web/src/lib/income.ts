// Payout rules, verified 2026-11-04 against the live API: for every account,
// the wallet balance equalled the month's Turnover Salary `net` plus 50% of
// the promo pins paid that month, and lifetime Sales Incentive x 0.9 equalled
// the "withdraw" total.

/** Sales Incentive: TDS 5% + service 5% are deducted when it's paid out. */
export const SI_PAYOUT_RATE = 0.9;

/** Promotional Incentive pins pay out half their face amount. */
export const PROMO_PAYOUT_RATE = 0.5;

/** Turnover Salary: the site keeps 10% at every amount (no higher tier). */
export const TBP_NET_RATE = 0.9;

/** Pin statuses that mean paid out - "paid" from the API, "closed" from the old site. */
export const PAID_PIN_STATUSES = ["paid", "closed"];

/**
 * Pin statuses that are still to be paid. "active" pins came from the old site;
 * the API's pin list shows a duplicate of another pin in their place, but its
 * own pending total (/member/dashboard) still counts them, so they're owed.
 */
export const UNPAID_PIN_STATUSES = ["pending", "active"];

/** Net Turnover Salary: the site's own net when stored, else 90% of gross. */
export function tbpNet(row: { net_total: number | null; total_tb_salary: number | null }): number {
  if (row.net_total != null) return Number(row.net_total);
  return Number(row.total_tb_salary ?? 0) * TBP_NET_RATE;
}

/** Withdrawal statuses where the money never left the wallet. */
export const FAILED_WITHDRAWAL_STATUSES = ["rejected", "cancelled", "canceled", "failed"];
