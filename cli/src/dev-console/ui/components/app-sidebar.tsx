import { useEffect, useState } from "react"
import { Link, useLocation as useRouteLocation } from "react-router"

import { useLocation, useWhoami } from "../hooks/use-queries.js"
import { cn } from "../lib/cn.js"

type NavItem = {
  to: string
  label: string
  icon: string
  match?: (path: string) => boolean
}

const NAV: NavItem[] = [
  {
    to: "/",
    label: "Overview",
    icon: "icon-[ph--squares-four-duotone]",
    match: (p) => p === "/",
  },
  {
    to: "/threads",
    label: "Threads",
    icon: "icon-[ph--chats-circle-duotone]",
    match: (p) => p.startsWith("/threads"),
  },
  {
    to: "/catalog",
    label: "Catalog",
    icon: "icon-[ph--stack-duotone]",
    match: (p) => p.startsWith("/catalog"),
  },
  {
    to: "/env",
    label: "Env",
    icon: "icon-[ph--key-duotone]",
    match: (p) => p.startsWith("/env"),
  },
  {
    to: "/location",
    label: "Location",
    icon: "icon-[ph--map-pin-duotone]",
    match: (p) => p.startsWith("/location"),
  },
]

const COLLAPSE_KEY = "dx.console.sidebar.collapsed"

function useCollapsed() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return window.localStorage.getItem(COLLAPSE_KEY) === "1"
  })
  useEffect(() => {
    window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0")
  }, [collapsed])
  return [collapsed, setCollapsed] as const
}

function Divider({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={cn("mx-3 border-t border-zinc-800/60", collapsed && "mx-2")}
    />
  )
}

function SectionLabel({
  collapsed,
  children,
}: {
  collapsed: boolean
  children: React.ReactNode
}) {
  if (collapsed) return null
  return (
    <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-zinc-600 font-semibold">
      {children}
    </div>
  )
}

function NavButton({
  item,
  active,
  collapsed,
}: {
  item: NavItem
  active: boolean
  collapsed: boolean
}) {
  return (
    <Link
      to={item.to}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex items-center gap-3 mx-2 px-2.5 py-2 rounded-md text-sm transition-colors",
        active
          ? "bg-gradient-to-r from-sky-500/15 to-violet-500/10 text-zinc-50 shadow-sm ring-1 ring-sky-500/20"
          : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/40",
        collapsed && "justify-center px-0"
      )}
    >
      <span
        className={cn(
          item.icon,
          "text-[18px]",
          active ? "text-sky-300" : "text-zinc-500 group-hover:text-zinc-300"
        )}
      />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {active && !collapsed && (
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sky-400 shadow-[0_0_8px_oklch(0.75_0.18_240)]" />
      )}
    </Link>
  )
}

function LocationPanel({ collapsed }: { collapsed: boolean }) {
  const { data } = useLocation()
  if (!data || collapsed) return null

  const row = (
    icon: string,
    label: string,
    value: string | undefined,
    mono = true
  ) =>
    value ? (
      <div className="flex items-center gap-2 text-[11px] min-w-0">
        <span className={cn(icon, "text-[13px] text-zinc-600 shrink-0")} />
        <span className="text-zinc-600 shrink-0">{label}</span>
        <span
          className={cn("text-zinc-300 truncate", mono && "font-mono")}
          title={value}
        >
          {value}
        </span>
      </div>
    ) : null

  return (
    <div className="mx-3 mb-3 rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-600 font-semibold mb-1">
        <span className="icon-[ph--crosshair-duotone] text-[13px] text-zinc-500" />
        Where
      </div>
      {row("icon-[ph--desktop-duotone]", "host", data.host.name)}
      {row("icon-[ph--cube-duotone]", "realm", data.realm?.name)}
      {row("icon-[ph--flag-duotone]", "site", data.site.slug)}
      {row("icon-[ph--git-branch-duotone]", "bench", data.workbench.name)}
    </div>
  )
}

function UserCard({ collapsed }: { collapsed: boolean }) {
  const whoami = useWhoami()
  const d = whoami.data
  const health = d?.factory.health.status
  const dotColor =
    health === "healthy"
      ? "bg-emerald-400 shadow-[0_0_10px_oklch(0.8_0.15_150)]"
      : health === "unauthorized"
        ? "bg-amber-400"
        : "bg-red-400"
  const name = d?.user?.name ?? d?.user?.email ?? "—"
  const initial = name.slice(0, 1).toUpperCase()
  const factoryHost = d?.factory.url.replace(/^https?:\/\//, "")
  const title = d
    ? `${d.user?.email ?? "not signed in"} · ${d.factory.url} (${health})`
    : "loading…"

  return (
    <a
      href={d?.factory.url}
      target="_blank"
      rel="noreferrer"
      title={title}
      className={cn(
        "mx-2 flex items-center gap-2.5 rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-2 hover:bg-zinc-900/60 hover:border-zinc-700 transition-colors",
        collapsed && "justify-center p-1.5"
      )}
    >
      <div className="relative shrink-0">
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-sky-500/40 via-violet-500/30 to-fuchsia-500/30 border border-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-100">
          {initial}
        </div>
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--color-surface-0)]",
            dotColor
          )}
        />
      </div>
      {!collapsed && (
        <div className="flex-1 min-w-0 leading-tight">
          <div className="text-xs text-zinc-100 truncate font-medium">
            {name}
          </div>
          <div className="text-[10px] text-zinc-500 font-mono truncate flex items-center gap-1">
            <span className="icon-[ph--cloud-duotone] text-[11px]" />
            {factoryHost ?? "…"}
          </div>
        </div>
      )}
    </a>
  )
}

export function AppSidebar() {
  const [collapsed, setCollapsed] = useCollapsed()
  const { pathname } = useRouteLocation()

  return (
    <aside
      className={cn(
        "relative shrink-0 flex flex-col h-screen border-r border-zinc-800/60 bg-zinc-950/40 backdrop-blur-sm transition-[width] duration-200 ease-out",
        collapsed ? "w-14" : "w-60"
      )}
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="absolute -right-3 top-6 z-10 h-6 w-6 rounded-full border border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 flex items-center justify-center shadow-md"
      >
        <span
          className={cn(
            collapsed
              ? "icon-[ph--caret-right-bold]"
              : "icon-[ph--caret-left-bold]",
            "text-[11px]"
          )}
        />
      </button>

      <div
        className={cn(
          "flex items-center gap-2.5 px-3 pt-5 pb-4",
          collapsed && "justify-center px-0"
        )}
      >
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-sky-400 via-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/20 shrink-0">
          <span className="icon-[ph--lightning-duotone] text-[17px] text-white" />
        </div>
        {!collapsed && (
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-tight text-zinc-50">
              dx dev
            </div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">
              console
            </div>
          </div>
        )}
      </div>

      <Divider collapsed={collapsed} />

      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 space-y-0.5">
        <SectionLabel collapsed={collapsed}>Navigate</SectionLabel>
        {NAV.map((item) => (
          <NavButton
            key={item.to}
            item={item}
            active={item.match ? item.match(pathname) : pathname === item.to}
            collapsed={collapsed}
          />
        ))}

        <SectionLabel collapsed={collapsed}>Context</SectionLabel>
        <LocationPanel collapsed={collapsed} />
      </nav>

      <div className="pt-2 pb-3 border-t border-zinc-800/60">
        <UserCard collapsed={collapsed} />
      </div>
    </aside>
  )
}
