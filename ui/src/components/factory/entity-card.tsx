import { Link } from "react-router"

import { cn } from "@rio.js/ui/lib/utils"

import { StatusBadge } from "./status-badge"

interface EntityCardProps {
  name: string
  slug?: string
  status?: string
  subtitle?: string
  href: string
  metadata?: { label: string; value: string }[]
  className?: string
}

export function EntityCard({
  name,
  status,
  subtitle,
  href,
  metadata,
  className,
}: EntityCardProps) {
  return (
    <Link
      to={href}
      className={cn(
        "block rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{name}</h3>
          {subtitle && (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
        {status && <StatusBadge status={status} />}
      </div>
      {metadata && metadata.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {metadata.map((m) => (
            <div key={m.label} className="text-xs">
              <span className="text-muted-foreground">{m.label}: </span>
              <span>{m.value}</span>
            </div>
          ))}
        </div>
      )}
    </Link>
  )
}
