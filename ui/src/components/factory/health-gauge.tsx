import { cn } from "@rio.js/ui/lib/utils"

interface HealthGaugeProps {
  label: string
  value: number
  max?: number
  unit?: string
  className?: string
}

function getGaugeColor(pct: number): string {
  if (pct >= 90) return "bg-red-500"
  if (pct >= 75) return "bg-amber-500"
  return "bg-emerald-500"
}

export function HealthGauge({
  label,
  value,
  max = 100,
  unit = "%",
  className,
}: HealthGaugeProps) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  const barColor = getGaugeColor(pct)

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          {value}
          {unit === "%" ? "%" : ` / ${max} ${unit}`}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
