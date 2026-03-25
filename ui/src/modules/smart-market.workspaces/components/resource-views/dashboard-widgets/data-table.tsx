import type { Block } from "../../../types"

interface TableData {
  title: string
  columns: { key: string; label: string; align?: "left" | "right" | "center" }[]
  rows: Record<string, string | number>[]
}

export function DashboardTable({ block }: { block: Block }) {
  const data = block.data as unknown as TableData

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-medium text-muted-foreground">
          {data.title}
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              {data.columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-2 font-medium text-muted-foreground ${
                    col.align === "right"
                      ? "text-right"
                      : col.align === "center"
                        ? "text-center"
                        : "text-left"
                  }`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, ri) => (
              <tr
                key={ri}
                className="border-b last:border-0 hover:bg-muted/20 transition-colors"
              >
                {data.columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-2 ${
                      col.align === "right"
                        ? "text-right tabular-nums"
                        : col.align === "center"
                          ? "text-center"
                          : "text-left"
                    }`}
                  >
                    {row[col.key] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
