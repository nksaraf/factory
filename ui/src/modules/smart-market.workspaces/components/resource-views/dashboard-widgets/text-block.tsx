import type { Block } from "../../../types"

interface TextData {
  title?: string
  content: string
  variant?: "info" | "warning" | "success"
}

const VARIANT_STYLES = {
  info: "border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/30",
  warning:
    "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30",
  success:
    "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30",
}

export function DashboardTextBlock({ block }: { block: Block }) {
  const data = block.data as unknown as TextData
  const variant = data.variant ?? "info"

  return (
    <div className={`rounded-lg border p-4 ${VARIANT_STYLES[variant]}`}>
      {data.title && <h3 className="text-sm font-medium">{data.title}</h3>}
      <p
        className={`text-sm text-muted-foreground ${data.title ? "mt-1" : ""}`}
      >
        {data.content}
      </p>
    </div>
  )
}
