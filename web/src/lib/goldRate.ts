import { supabase } from "./supabase";

export interface GoldRate {
  rate: number; // ₹ per gram, excl. GST - home page "Today's Market Price"
  capturedAt: string;
}

/** Latest rate captured by the scraper, or null if none has been captured yet. */
export async function fetchLatestGoldRate(): Promise<GoldRate | null> {
  const { data } = await supabase
    .from("gold_rates")
    .select("rate_per_gm, captured_at")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { rate: Number(data.rate_per_gm), capturedAt: data.captured_at };
}

/** What `gm` grams are worth at `rate`, or null when either is unknown. */
export function currentWorth(gm: number | null | undefined, rate: GoldRate | null): number | null {
  if (gm == null || !rate) return null;
  return Number(gm) * rate.rate;
}
