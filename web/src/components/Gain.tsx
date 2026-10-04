import { formatINR } from "../lib/format";

/** Gain/loss of `current` over `paid`, e.g. "+₹88.07 (+2.24%)" in green. */
export default function Gain({ current, paid }: { current: number | null; paid: number | null | undefined }) {
  if (current == null || paid == null) return <span className="text-maroon-900/40">—</span>;
  const diff = current - Number(paid);
  const pct = Number(paid) !== 0 ? (diff / Number(paid)) * 100 : null;
  const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";
  const color = diff > 0 ? "text-green-700" : diff < 0 ? "text-red-700" : "text-maroon-900/60";
  return (
    <span className={color}>
      {sign}
      {formatINR(Math.abs(diff))}
      {pct != null && ` (${sign}${Math.abs(pct).toFixed(2)}%)`}
    </span>
  );
}
