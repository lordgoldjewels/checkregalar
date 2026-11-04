// Wallet -> GET /member/dashboard. The server returns the spendable cash balance
// (what the app shows as "Wallet Balance") plus the e-pin/coupon sub-wallets, a
// per-stream earnings breakdown (paid vs pending), and bonds. There is NO wallet
// ledger/transaction endpoint (all 404), so this snapshot is the only way to
// track how the balance moves - we store it each run and diff cash_balance.
// NOTE: /member/dashboard is a DIFFERENT endpoint from /member/status (which
// dashboard.mjs uses for the widgets); only /member/dashboard carries the wallet.
import { apiGet, apiGetAllPages } from "../api/client.mjs";

export async function fetchWallet(token) {
  const d = await apiGet(token, "/member/dashboard");
  const w = d.wallet ?? {};
  const e = d.earnings ?? {};
  const b = d.bonds ?? {};
  return {
    currencyCode: w.currency_code ?? null,
    cashBalance: w.cash_balance ?? null,     // "Wallet Balance" tile in the app
    epinBalance: w.epin_balance ?? null,
    couponBalance: w.coupon_balance ?? null,
    earningTotal: w.earning_total ?? null,   // "My incentives" tile
    streams: {
      icPaid: e.ic?.paid ?? null, icPending: e.ic?.pending ?? null,            // Sales Incentive
      gapPaid: e.gap?.paid ?? null, gapPending: e.gap?.pending ?? null,        // Turnover Salary
      cbcPaid: e.cbc?.paid ?? null, cbcPending: e.cbc?.pending ?? null,        // Promotional
      resellerPaid: e.reseller?.paid ?? null,                                  // Billing Margin
      settlementPaid: e.settlement?.paid ?? null, settlementPending: e.settlement?.pending ?? null,
    },
    bonds: { active: b.active ?? null, total: b.total ?? null, invested: b.invested ?? null },
  };
}

// Withdrawal requests -> GET /member/wallet/withdrawals. One row per request:
// { id, branch, amount, status ("pending" until paid out), disbursal_mode,
// requested_at, disbursed_at }. This is the only record of money leaving the
// wallet, so it explains cash_balance drops between snapshots.
export async function fetchWithdrawals(token) {
  const rows = await apiGetAllPages(token, "/member/wallet/withdrawals");
  return rows.map((r) => ({
    withdrawalId: r.id,
    branch: r.branch ?? null,
    amount: r.amount,
    status: r.status ?? null,
    disbursalMode: r.disbursal_mode ?? null,
    requestedAt: r.requested_at ?? null,
    disbursedAt: r.disbursed_at ?? null,
  }));
}
