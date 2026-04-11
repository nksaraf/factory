import { cn } from "@rio.js/ui/lib/utils"

interface MetricCardProps {
  label: string
  value: string | number
  change?: number
  unit?: string
  plane?: "product" | "build" | "ops" | "infra" | "agent" | "commerce"
  className?: string
}

const PLANE_BORDER: Record<string, string> = {
  product: "border-l-purple-400/40",
  build: "border-l-amber-400/40",
  ops: "border-l-teal-400/40",
  infra: "border-l-blue-400/40",
  agent: "border-l-green-400/40",
  commerce: "border-l-emerald-400/40",
}

export function MetricCard({
  label,
  value,
  change,
  unit,
  plane,
  className,
}: MetricCardProps) {
  const borderClass = plane ? PLANE_BORDER[plane] : "border-l-transparent"

  return (
    <div
      className={cn(
        "rounded-lg border border-l-2 bg-card p-4",
        borderClass,
        className
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tracking-tight">{value}</span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
      {change != null && (
        <p
          className={cn(
            "mt-1 text-xs font-medium",
            change > 0
              ? "text-emerald-500"
              : change < 0
                ? "text-red-500"
                : "text-muted-foreground"
          )}
        >
          {change > 0 ? "+" : ""}
          {change}%
        </p>
      )}
    </div>
  )
}
