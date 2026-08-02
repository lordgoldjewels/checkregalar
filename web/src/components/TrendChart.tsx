import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { formatINR } from "../lib/format";

// Validated categorical palette slots 1 (blue) & 2 (orange) - see dataviz skill.
const SERIES = [
  { key: "business", label: "Business", color: "#2a78d6" },
  { key: "withdraw", label: "Withdraw", color: "#eb6834" },
] as const;

interface Point {
  t: number; // bucket timestamp (ms)
  business: number;
  withdraw: number;
}

const WIDTH = 720;
const HEIGHT = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 56 };

function niceMax(value: number): number {
  if (value <= 0) return 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export default function TrendChart() {
  const [points, setPoints] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTable, setShowTable] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .from("dashboard_snapshots")
      .select("captured_at, my_business, my_withdraw")
      .order("captured_at", { ascending: true })
      .then(({ data }) => {
        const rows = (data as { captured_at: string; my_business: number | null; my_withdraw: number | null }[]) ?? [];
        // Snapshots from the same scrape run land within a few minutes of each
        // other across accounts - bucket to 10 minutes and sum, so each run
        // becomes one point on the trend rather than five overlapping ones.
        const BUCKET_MS = 10 * 60 * 1000;
        const buckets = new Map<number, Point>();
        for (const row of rows) {
          const t = Math.round(new Date(row.captured_at).getTime() / BUCKET_MS) * BUCKET_MS;
          const existing = buckets.get(t) ?? { t, business: 0, withdraw: 0 };
          existing.business += row.my_business ?? 0;
          existing.withdraw += row.my_withdraw ?? 0;
          buckets.set(t, existing);
        }
        setPoints([...buckets.values()].sort((a, b) => a.t - b.t));
        setLoading(false);
      });
  }, []);

  const { xFor, yFor, yMax, yTicks } = useMemo(() => {
    const maxVal = Math.max(1, ...points.map((p) => Math.max(p.business, p.withdraw)));
    const yMax = niceMax(maxVal);
    const innerW = WIDTH - PAD.left - PAD.right;
    const innerH = HEIGHT - PAD.top - PAD.bottom;
    const n = points.length;
    const xFor = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yFor = (v: number) => PAD.top + innerH - (v / yMax) * innerH;
    const yTicks = [0, yMax * 0.25, yMax * 0.5, yMax * 0.75, yMax];
    return { xFor, yFor, yMax, yTicks };
  }, [points]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-56 bg-white rounded-xl border border-maroon-100 shadow-sm">
        <p className="text-sm text-maroon-900/40">Loading…</p>
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center h-56 bg-white rounded-xl border border-maroon-100 shadow-sm">
        <p className="text-sm text-maroon-900/40">No snapshot history yet.</p>
      </div>
    );
  }

  const linePath = (key: "business" | "withdraw") =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(i)},${yFor(p[key])}`).join(" ");

  const hovered = hoverIdx != null ? points[hoverIdx] : null;

  return (
    <div className="bg-white rounded-xl border border-maroon-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-maroon-900">Business &amp; Withdraw over time</h3>
          <p className="text-xs text-maroon-900/40">summed across all accounts, per scrape run</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Legend - line key, not a filled box, per dataviz interaction spec */}
          <div className="flex items-center gap-3">
            {SERIES.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5 text-xs text-maroon-900/70">
                <svg width="14" height="8"><line x1="0" y1="4" x2="14" y2="4" stroke={s.color} strokeWidth="2" strokeLinecap="round" /></svg>
                {s.label}
              </div>
            ))}
          </div>
          <button
            onClick={() => setShowTable((v) => !v)}
            className="text-xs font-medium text-maroon-700 hover:underline"
          >
            {showTable ? "Show chart" : "Show table"}
          </button>
        </div>
      </div>

      {showTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-maroon-900/50 uppercase tracking-wider">
                <th className="py-1 pr-4">Time</th>
                <th className="py-1 pr-4">Business</th>
                <th className="py-1 pr-4">Withdraw</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.t}>
                  <td className="py-1 pr-4">{new Date(p.t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                  <td className="py-1 pr-4">{formatINR(p.business)}</td>
                  <td className="py-1 pr-4">{formatINR(p.withdraw)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="w-full h-auto"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const px = ((e.clientX - rect.left) / rect.width) * WIDTH;
              let nearest = 0;
              let best = Infinity;
              points.forEach((_, i) => {
                const d = Math.abs(xFor(i) - px);
                if (d < best) { best = d; nearest = i; }
              });
              setHoverIdx(nearest);
            }}
            onMouseLeave={() => setHoverIdx(null)}
          >
            {/* gridlines */}
            {yTicks.map((v, i) => (
              <g key={i}>
                <line x1={PAD.left} x2={WIDTH - PAD.right} y1={yFor(v)} y2={yFor(v)} stroke="#e1e0d9" strokeWidth="1" />
                <text x={PAD.left - 8} y={yFor(v)} textAnchor="end" dominantBaseline="middle" className="fill-maroon-900/40" fontSize="10">
                  {v >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v)}
                </text>
              </g>
            ))}

            {/* crosshair */}
            {hoverIdx != null && (
              <line x1={xFor(hoverIdx)} x2={xFor(hoverIdx)} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="#c3c2b7" strokeWidth="1" />
            )}

            {SERIES.map((s) => (
              <path key={s.key} d={linePath(s.key)} fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            ))}

            {/* end markers with surface ring */}
            {SERIES.map((s) => {
              const last = points[points.length - 1];
              return (
                <circle key={s.key} cx={xFor(points.length - 1)} cy={yFor(last[s.key])} r="4" fill={s.color} stroke="#fcfcfb" strokeWidth="2" />
              );
            })}

            {/* hover markers */}
            {hovered &&
              SERIES.map((s) => (
                <circle key={s.key} cx={xFor(hoverIdx!)} cy={yFor(hovered[s.key])} r="4" fill={s.color} stroke="#fcfcfb" strokeWidth="2" />
              ))}
          </svg>

          {hovered && (
            <div
              className="absolute top-0 bg-maroon-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg pointer-events-none"
              style={{ left: `${(xFor(hoverIdx!) / WIDTH) * 100}%`, transform: "translateX(-50%)" }}
            >
              <p className="text-maroon-100/70 mb-1">
                {new Date(hovered.t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}
              </p>
              {SERIES.map((s) => (
                <p key={s.key}>
                  <strong>{formatINR(hovered[s.key])}</strong> <span className="text-maroon-100/70">{s.label}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
