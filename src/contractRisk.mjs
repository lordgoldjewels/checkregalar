// Pure contract-risk evaluation, shared by the scraper. Given an account's
// fetched bonds plus its stored alert state, decide which Telegram lines are due
// now and what the new stored state should be. No I/O here — the caller reads
// and writes the state (src/db.mjs) so this stays testable.
//
// Two independent cadences (see the approved plan):
//  - Coverage (per account): the latest-expiring ACTIVE DIGITAL contract keeps
//    the account earning. Remind weekly from 90→15 days before it ends, daily in
//    the final 15 days, one final alert on/after expiry (or when there is no
//    active digital contract at all = income stopped), then stop. Reset when the
//    coverage date changes (a new plan with a later end date was added — contracts
//    are never extended).
//  - Payout (per contract): fixed countdown at 30/15/7/3/2/1/0 days before each
//    contract's 12-month mark (bond_date + 1y), then stop.

export const PAYOUT_MILESTONES = [30, 15, 7, 3, 2, 1, 0];
const DAY_MS = 86_400_000;

const toYmd = (ms) => new Date(ms).toISOString().slice(0, 10);

function daysUntil(iso, nowMs) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - nowMs) / DAY_MS);
}

function daysBetweenYmd(a, b) {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Infinity;
  return Math.round((tb - ta) / DAY_MS);
}

function addYear(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

// A bond carries CBC / counts as income-bearing unless it's a gold/silver
// purchase plan (mirrors web/src/pages/Bonds.tsx carriesCbc).
function isDigital(b) {
  const t = (b.planType ?? "").toLowerCase();
  return t !== "gold" && t !== "silver";
}
function isActive(b) {
  return (b.status ?? "").toLowerCase() === "active";
}

/**
 * @param {object} args
 * @param {Array}  args.bonds        fetched bonds (camelCase, from fetchBonds)
 * @param {object} args.coverageState { coverage_target, coverage_last_alerted, coverage_expired_alerted }
 * @param {Map<number,number>} args.payoutStages  bondId -> payout_stage
 * @param {number} args.now          Date.now()
 * @returns {{ lines: string[], coverage: {target, lastAlerted, expiredAlerted}, payoutStageUpdates: Array<{bondId:number, stage:number}> }}
 */
export function evaluateContractRisk({ bonds, coverageState = {}, payoutStages = new Map(), now }) {
  const lines = [];
  const today = toYmd(now);

  const activeDigital = (bonds ?? []).filter((b) => isActive(b) && isDigital(b));
  const coverageUntil =
    activeDigital.length
      ? activeDigital.map((b) => b.expiresOn).filter(Boolean).sort().at(-1) ?? null
      : null;

  // ---- Coverage countdown (per account) ----
  const prevTarget = coverageState.coverage_target ?? null;
  let lastAlerted = coverageState.coverage_last_alerted ?? null;
  let expiredAlerted = coverageState.coverage_expired_alerted ?? false;

  // A new plan with a different coverage date resets the countdown.
  if ((prevTarget ?? null) !== (coverageUntil ?? null)) {
    lastAlerted = null;
    expiredAlerted = false;
  }

  if (!coverageUntil) {
    if (!expiredAlerted) {
      lines.push("no active contract — income stopped, add a new plan");
      expiredAlerted = true;
      lastAlerted = today;
    }
  } else {
    const d = daysUntil(coverageUntil, now);
    if (d < 0) {
      if (!expiredAlerted) {
        lines.push(`last contract expired (${coverageUntil}) — income stopped, add a new plan`);
        expiredAlerted = true;
        lastAlerted = today;
      }
    } else if (d <= 15) {
      if (lastAlerted !== today) {
        lines.push(`contract coverage ends in ${d}d (${coverageUntil}) — add a new plan`);
        lastAlerted = today;
      }
    } else if (d <= 90) {
      if (!lastAlerted || daysBetweenYmd(lastAlerted, today) >= 7) {
        lines.push(`contract coverage ends in ${d}d (${coverageUntil}) — add a new plan`);
        lastAlerted = today;
      }
    }
    // d > 90: nothing yet.
  }

  // ---- Deferred-payout countdown (per contract) ----
  const payoutStageUpdates = [];
  for (const b of activeDigital) {
    const mark = addYear(b.bondDate);
    if (!mark) continue;
    const d = daysUntil(mark, now);
    const prevStage = payoutStages.get(Number(b.bondId)) ?? 0;
    const shouldHave = PAYOUT_MILESTONES.filter((m) => d <= m).length;
    // Fire the newly-reached milestone, but never raise a stale "today" for a
    // mark that passed before we ever started tracking this bond.
    if (shouldHave > prevStage && !(prevStage === 0 && d < 0)) {
      const m = PAYOUT_MILESTONES[shouldHave - 1];
      const when = m === 0 ? "today" : `in ${m}d`;
      lines.push(`${b.planName ?? "contract"} held-back CBC half pays ${when} (${mark}) — check wallet`);
      payoutStageUpdates.push({ bondId: Number(b.bondId), stage: shouldHave });
    }
  }

  return { lines, coverage: { target: coverageUntil, lastAlerted, expiredAlerted }, payoutStageUpdates };
}
