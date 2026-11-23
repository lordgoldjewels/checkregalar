export function formatINR(value: number | null | undefined): string {
  if (value == null) return "—";
  return "₹" + value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString("en-IN");
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST";
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}

export function formatGm(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toLocaleString("en-IN", { maximumFractionDigits: 4 })} gm`;
}

// Whole days from now until `iso` (negative if past). Null for missing/invalid.
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}
