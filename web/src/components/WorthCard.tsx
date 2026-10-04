import { formatINR, formatGm } from "../lib/format";

/**
 * Summary card for "what is this gold worth now vs what was paid", built to
 * be read at a glance: the whole card turns green on a gain and red on a
 * loss, with the gain/loss as a large arrow badge under the current worth.
 */
export default function WorthCard({
  label,
  current,
  paid,
  gm,
  emptyText,
}: {
  label: string;
  current: number | null;
  paid: number;
  gm: number;
  emptyText: string;
}) {
  if (gm === 0 || current == null) {
    return (
      <div className="bg-white rounded-xl border border-maroon-100 shadow-sm px-5 py-5">
        <p className="text-xs font-semibold text-maroon-900/40 uppercase tracking-wider">{label}</p>
        <p className="text-3xl font-bold mt-2 text-maroon-900">—</p>
        <p className="text-xs text-maroon-900/40 mt-1">{current == null && gm !== 0 ? "gold rate not captured yet" : emptyText}</p>
      </div>
    );
  }

  const diff = current - paid;
  const pct = paid !== 0 ? (diff / paid) * 100 : 0;
  const up = diff > 0;
  const down = diff < 0;
  const card = up
    ? "bg-green-50 border-green-200"
    : down
    ? "bg-red-50 border-red-200"
    : "bg-white border-maroon-100";
  const badge = up ? "bg-green-600" : down ? "bg-red-600" : "bg-maroon-900/50";

  return (
    <div className={`rounded-xl border shadow-sm px-5 py-5 ${card}`}>
      <p className="text-xs font-semibold text-maroon-900/50 uppercase tracking-wider">{label}</p>
      <p className="text-3xl font-bold mt-2 text-maroon-900">{formatINR(current)}</p>
      <p className={`inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full text-white text-sm font-bold ${badge}`}>
        <span aria-hidden>{up ? "▲" : down ? "▼" : "■"}</span>
        <span>
          {up ? "+" : down ? "−" : ""}
          {formatINR(Math.abs(diff))}
        </span>
        <span className="font-semibold opacity-90">
          ({up ? "+" : down ? "−" : ""}
          {Math.abs(pct).toFixed(2)}%)
        </span>
        <span className="sr-only">{up ? "gain" : down ? "loss" : "no change"}</span>
      </p>
      <p className="text-xs text-maroon-900/50 mt-2">
        Paid {formatINR(paid)} · {formatGm(gm)}
      </p>
    </div>
  );
}
