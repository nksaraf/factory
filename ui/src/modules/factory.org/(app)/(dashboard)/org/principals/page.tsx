import { useMemo, useState } from "react"
import { Link } from "react-router"

import { cn } from "@rio.js/ui/lib/utils"
import { Icon } from "@rio.js/ui/icon"

import { DashboardPage, EmptyState, StatusBadge } from "@/components/factory"
import { usePrincipals } from "../../../../data/use-org"

const INITIALS_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-teal-500",
  "bg-pink-500",
  "bg-indigo-500",
]

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2)
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function getColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++)
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  return INITIALS_COLORS[Math.abs(hash) % INITIALS_COLORS.length]!
}

function PrincipalAvatar({
  name,
  avatarUrl,
  size = 40,
}: {
  name: string
  avatarUrl?: string
  size?: number
}) {
  const px = `${size}px`
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="rounded-full object-cover shrink-0"
        style={{ width: px, height: px }}
      />
    )
  }
  const initials = getInitials(name)
  const color = getColor(name)
  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center shrink-0 text-white font-semibold",
        color
      )}
      style={{ width: px, height: px, fontSize: `${size * 0.38}px` }}
    >
      {initials}
    </div>
  )
}

const PROVIDER_ICON: Record<string, string> = {
  github: "icon-[simple-icons--github]",
  slack: "icon-[simple-icons--slack]",
  jira: "icon-[simple-icons--jira]",
  google: "icon-[simple-icons--google]",
}

export default function PrincipalsPage() {
  const { data: principals, isLoading } = usePrincipals()
  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState<string | null>(null)

  const all = principals ?? []
  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of all)
      counts[p.role ?? "unknown"] = (counts[p.role ?? "unknown"] ?? 0) + 1
    return counts
  }, [all])

  const filtered = all.filter((p: any) => {
    if (roleFilter && (p.role ?? "unknown") !== roleFilter) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (p.name ?? "").toLowerCase().includes(q) ||
      (p.email ?? "").toLowerCase().includes(q) ||
      (p.slug ?? "").toLowerCase().includes(q)
    )
  })

  const toolbar = (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex gap-1 rounded-lg border bg-muted p-1 flex-wrap">
        <button
          type="button"
          onClick={() => setRoleFilter(null)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            !roleFilter
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          All ({all.length})
        </button>
        {Object.entries(roleCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([role, count]) => (
            <button
              key={role}
              type="button"
              onClick={() => setRoleFilter(roleFilter === role ? null : role)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                roleFilter === role
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {role} ({count})
            </button>
          ))}
      </div>
      <input
        placeholder="Search people..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xs text-base px-3 py-2 rounded-md border bg-card text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
      />
    </div>
  )

  return (
    <DashboardPage
      plane="agent"
      title="People"
      description="Principals, identities, and collaborators"
      toolbar={toolbar}
    >
      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {!isLoading && filtered.length === 0 && (
        <EmptyState
          icon="icon-[ph--user-circle-duotone]"
          title="No people found"
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 content-start">
        {filtered.map((p: any) => (
          <Link
            key={p.id}
            to={`/org/principals/${p.slug ?? p.id}`}
            className="rounded-lg border bg-card p-4 hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <PrincipalAvatar
                name={p.name ?? p.slug}
                avatarUrl={p.spec?.avatarUrl}
                size={40}
              />

              <div className="min-w-0 flex-1">
                <div className="font-medium text-base truncate">
                  {p.name ?? p.slug}
                </div>
                <div className="text-sm text-muted-foreground truncate">
                  {p.email}
                </div>
              </div>
              <StatusBadge status={p.role ?? "unknown"} />
            </div>
            {p.spec?.providers && (
              <div className="mt-2 flex gap-1.5">
                {Object.keys(p.spec.providers).map((prov: string) => (
                  <span
                    key={prov}
                    className={cn(
                      PROVIDER_ICON[prov] ?? "icon-[ph--link-duotone]",
                      "text-base text-muted-foreground"
                    )}
                    title={prov}
                  />
                ))}
              </div>
            )}
          </Link>
        ))}
      </div>
    </DashboardPage>
  )
}
