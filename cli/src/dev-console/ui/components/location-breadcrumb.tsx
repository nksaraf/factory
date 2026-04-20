import { useLocation } from "../hooks/use-queries.js"

export function LocationBreadcrumb() {
  const { data } = useLocation()
  if (!data) return null

  const parts = [
    data.host.name,
    data.realm?.name,
    data.site.slug,
    data.workbench.name,
  ].filter(Boolean) as string[]

  return (
    <div className="hidden md:flex items-center gap-1.5 text-xs text-zinc-500">
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-zinc-700">›</span>}
          <span className="font-mono">{p}</span>
        </span>
      ))}
    </div>
  )
}
