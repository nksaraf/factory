import { Link, useLocation, useParams } from "react-router"

import { cn } from "@rio.js/ui/lib/utils"
import { Icon } from "@rio.js/ui/icon"

import { StatusBadge, EmptyState } from "@/components/factory"
import { usePrincipal, usePrincipalLinks } from "../../../../../data/use-org"

const INITIALS_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-teal-500",
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

const PROVIDER_ICON: Record<string, string> = {
  github: "icon-[simple-icons--github]",
  slack: "icon-[simple-icons--slack]",
  jira: "icon-[simple-icons--jira]",
  google: "icon-[simple-icons--google]",
}

const TABS = [
  { path: "", label: "Overview", icon: "icon-[ph--squares-four-duotone]" },
  {
    path: "/identities",
    label: "Identities",
    icon: "icon-[ph--fingerprint-duotone]",
  },
  {
    path: "/timeline",
    label: "Timeline",
    icon: "icon-[ph--clock-counter-clockwise-duotone]",
  },
] as const

export function PrincipalLayout({ children }: { children: React.ReactNode }) {
  const { slug } = useParams<{ slug: string }>()
  const location = useLocation()
  const { data: principal, isLoading } = usePrincipal(slug)
  const { data: links } = usePrincipalLinks(slug)

  if (isLoading)
    return <p className="p-6 text-sm text-muted-foreground">Loading...</p>
  if (!principal)
    return (
      <EmptyState
        title="Person not found"
        description={`No principal with slug "${slug}"`}
      />
    )

  const spec = (principal.spec ?? {}) as Record<string, unknown>
  const email = spec.email as string | undefined
  const avatarUrl = spec.avatarUrl as string | undefined
  const providers = [
    ...new Set((links ?? []).map((l: any) => l.type ?? l.provider)),
  ]
  const basePath = `/org/principals/${slug}`

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 pb-0 space-y-4 shrink-0">
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={principal.name}
              className="h-16 w-16 rounded-full object-cover shrink-0"
            />
          ) : (
            <div
              className={cn(
                "h-16 w-16 rounded-full flex items-center justify-center shrink-0 text-white font-semibold text-2xl",
                getColor(principal.name ?? "")
              )}
            >
              {getInitials(principal.name ?? principal.slug)}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-semibold">
              {principal.name ?? principal.slug}
            </h1>
            {email && (
              <p className="text-base text-muted-foreground">{email}</p>
            )}
            <div className="mt-1 flex items-center gap-2">
              <StatusBadge status={principal.type ?? "unknown"} />
              {providers.map((p: string) => (
                <span
                  key={p}
                  className={cn(
                    PROVIDER_ICON[p] ?? "icon-[ph--link-duotone]",
                    "text-lg text-muted-foreground"
                  )}
                  title={p}
                />
              ))}
            </div>
          </div>
        </div>

        <nav className="flex gap-1 border-b">
          {TABS.map((t) => {
            const href = `${basePath}${t.path}`
            const isActive =
              t.path === ""
                ? location.pathname === basePath ||
                  location.pathname === `${basePath}/`
                : location.pathname.startsWith(href)
            return (
              <Link
                key={t.path}
                to={href}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                  isActive
                    ? "border-green-500 text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                )}
              >
                <Icon icon={t.icon} className="text-sm" />
                {t.label}
              </Link>
            )
          })}
        </nav>
      </div>
      <div className="flex-1 overflow-y-auto p-6 min-h-0">{children}</div>
    </div>
  )
}
