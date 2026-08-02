function escapeCsvCell(value: unknown): string {
  // Round away binary floating-point artifacts (e.g. 90587.04000000001) without
  // changing the displayed precision of whole numbers.
  const normalized = typeof value === "number" ? Math.round(value * 100) / 100 : value;
  const str = normalized == null ? "" : String(normalized);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(","));
  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
