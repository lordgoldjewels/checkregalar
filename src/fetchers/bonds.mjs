// Bonds / contracts (the "Schemes & Contract" page) -> GET /member/bonds.
// Each bond is a purchased plan (G12 Forward contractors, G24 Wholesaler, G10
// Gold Purchase, ...). It carries the committed `value`, the term
// (bond_date -> expires_on), and two issuance counters:
//   cbc    -> promotional-incentive pins { issued = total the bond will throw,
//             count = how many issued so far }
//   lvlcom -> level-commission pins, same shape
// plus rd_paid (refundable-deposit amount paid out so far).
//
// We track these because the promotional pins are issued BY these contracts,
// and the back-half of the CBC payout is expected to release at the 12-month
// anniversary - a status flip (active -> matured/completed) or an rd_paid /
// cbc.count bump here is the signal that it has landed.
import { apiGet } from "../api/client.mjs";

export async function fetchBonds(token) {
  const res = await apiGet(token, "/member/bonds");
  return (res.data ?? []).map((b) => ({
    bondId: b.id,
    invoiceNo: b.invoice_no ?? null,
    planCode: b.plan?.code ?? null,
    planName: b.plan?.name ?? null,
    planType: b.plan?.type ?? null,
    value: b.value ?? null,
    bondDate: b.bond_date ?? null,     // already ISO yyyy-mm-dd
    expiresOn: b.expires_on ?? null,
    status: b.status ?? null,
    cbcIssued: b.cbc?.issued ?? null,
    cbcCount: b.cbc?.count ?? null,
    lvlcomIssued: b.lvlcom?.issued ?? null,
    lvlcomCount: b.lvlcom?.count ?? null,
    rdPaid: b.rd_paid ?? null,
  }));
}
