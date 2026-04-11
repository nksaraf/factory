/** Human-readable key/value lines for CLI output. */
export function printKeyValue(
  rows: Record<string, string | number | undefined>
): string {
  return Object.entries(rows)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")
}

export type ColumnAlign = "left" | "right"

export interface ColumnOpt {
  align?: ColumnAlign
  /** Apply a style function to cell values (not headers). */
  style?: (s: string) => string
}

/** Strip ANSI escape codes for width calculation. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "")
}

function padCell(s: string, width: number, align: ColumnAlign): string {
  const visible = stripAnsi(s).length
  const diff = Math.max(0, width - visible)
  return align === "right" ? " ".repeat(diff) + s : s + " ".repeat(diff)
}

/** Minimal fixed-width table (no heavy deps). */
export function printTable(
  headers: string[],
  rows: string[][],
  opts?: ColumnOpt[]
): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => stripAnsi(r[i] ?? "").length))
  )
  const align = (i: number): ColumnAlign => opts?.[i]?.align ?? "left"
  const styleFn = (i: number) => opts?.[i]?.style

  const sep = widths.map((w) => "-".repeat(w)).join("-+-")
  const head = headers
    .map((h, i) => padCell(h, widths[i], align(i)))
    .join(" | ")
  const body = rows
    .map((r) =>
      r
        .map((c, i) => {
          const val = c ?? ""
          const styled = styleFn(i) ? styleFn(i)!(val) : val
          return padCell(styled, widths[i], align(i))
        })
        .join(" | ")
    )
    .join("\n")
  return [head, sep, body].filter(Boolean).join("\n")
}
