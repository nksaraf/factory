import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"

type Plane = "product" | "build" | "ops" | "infra" | "agent" | "commerce"

const PLANE_CONFIG: Record<Plane, { color: string; icon: string }> = {
  product: { color: "text-purple-400", icon: "icon-[ph--paint-brush-duotone]" },
  build: { color: "text-amber-400", icon: "icon-[ph--gear-duotone]" },
  ops: { color: "text-teal-400", icon: "icon-[ph--rocket-launch-duotone]" },
  infra: { color: "text-blue-400", icon: "icon-[ph--hard-drives-duotone]" },
  agent: { color: "text-green-400", icon: "icon-[ph--robot-duotone]" },
  commerce: {
    color: "text-emerald-400",
    icon: "icon-[ph--storefront-duotone]",
  },
}

interface PlaneHeaderProps {
  plane: Plane
  title: string
  description?: string
  actions?: React.ReactNode
  className?: string
}

export function PlaneHeader({
  plane,
  title,
  description,
  actions,
  className,
}: PlaneHeaderProps) {
  const config = PLANE_CONFIG[plane]

  return (
    <div className={cn("flex items-start justify-between", className)}>
      <div className="flex items-center gap-3">
        <span className={cn(config.icon, "text-4xl shrink-0", config.color)} />
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
