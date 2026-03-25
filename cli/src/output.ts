/** Human-readable key/value lines for CLI output. */
export function printKeyValue(rows: Record<string, string | number | undefined>): string {
  return Object.entries(rows)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

/** Minimal fixed-width table (no heavy deps). */
export function printTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
  );
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
  const sep = widths.map((w) => "-".repeat(w)).join("-+-");
  const head = headers.map((h, i) => pad(h, widths[i])).join(" | ");
  const body = rows
    .map((r) => r.map((c, i) => pad(c ?? "", widths[i])).join(" | "))
    .join("\n");
  return [head, sep, body].filter(Boolean).join("\n");
}
