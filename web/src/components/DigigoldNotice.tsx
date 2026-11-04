import { formatDate } from "../lib/format";

// DigiGold buy/sell isn't wired into the new API scraper yet (deferred), and the
// old browser scraper that filled these tables stopped on this date.
export const DIGIGOLD_DATA_UNTIL = "2026-10-31";

/** Banner telling viewers DigiGold transactions are frozen at the old scraper's last run. */
export default function DigigoldNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`rounded-lg border border-amber-200 bg-amber-50 text-amber-800 ${compact ? "px-3 py-2 text-xs mb-3" : "px-4 py-3 text-sm mb-6"}`}
      role="status"
    >
      <span className="font-semibold">DigiGold buy/sell is not updating for now.</span>{" "}
      Transactions shown are up to {formatDate(DIGIGOLD_DATA_UNTIL)}, from the old site; support for the new app is coming later.
      {!compact && " The gold rate and current worth still update with every scrape."}
    </div>
  );
}
