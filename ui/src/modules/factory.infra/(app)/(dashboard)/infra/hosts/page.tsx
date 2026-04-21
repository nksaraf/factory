import { useCallback, useMemo, useState } from "react"
import { Link } from "react-router"

import { cn } from "@rio.js/ui/lib/utils"
import { Icon } from "@rio.js/ui/icon"

import { DashboardPage, StatusBadge, EmptyState } from "@/components/factory"
import { useHosts } from "@/lib/infra"
import type { Host } from "@/lib/infra/types"

const TYPE_ICON: Record<string, string> = {
  "bare-metal": "icon-[ph--desktop-tower-duotone]",
  vm: "icon-[ph--monitor-duotone]",
  "network-appliance": "icon-[ph--router-duotone]",
}

function s(host: Host, key: string): string {
  return (host.spec[key] as string) ?? ""
}

function n(host: Host, key: string): number {
  return (host.spec[key] as number) ?? 0
}

type SortKey =
  | "name"
  | "type"
  | "ipAddress"
  | "os"
  | "cpu"
  | "memoryMb"
  | "diskGb"
  | "lifecycle"
type SortDir = "asc" | "desc"

function CopyCell({ value }: { value: string | null | undefined }) {
  const [copied, setCopied] = useState(false)
  if (!value) return <span className="text-muted-foreground">&mdash;</span>
  const copy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <span className="group inline-flex items-center gap-1">
      <span className="font-mono">{value}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          copy()
        }}
        title="Copy"
        className="opacity-0 group-hover:opacity-100 transition-opacity h-5 w-5 rounded hover:bg-accent flex items-center justify-center shrink-0"
      >
        <Icon
          icon={copied ? "icon-[ph--check-bold]" : "icon-[ph--copy-duotone]"}
          className={cn(
            "text-xs",
            copied ? "text-emerald-500" : "text-muted-foreground"
          )}
        />
      </button>
    </span>
  )
}

function SortHeader({
  label,
  icon,
  sortKey,
  currentKey,
  currentDir,
  onSort,
}: {
  label: string
  icon?: string
  sortKey: SortKey
  currentKey: SortKey
  currentDir: SortDir
  onSort: (key: SortKey) => void
}) {
  const active = currentKey === sortKey
  return (
    <th className="pb-2 pr-4">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
      >
        {icon && <Icon icon={icon} className="text-sm" />}
        {label}
        <Icon
          icon={
            active
              ? currentDir === "asc"
                ? "icon-[ph--caret-up-bold]"
                : "icon-[ph--caret-down-bold]"
              : "icon-[ph--caret-up-down-bold]"
          }
          className={cn(
            "text-xs",
            active ? "text-foreground" : "text-muted-foreground/40"
          )}
        />
      </button>
    </th>
  )
}

function compareHosts(a: Host, b: Host, key: SortKey, dir: SortDir): number {
  let av: string | number
  let bv: string | number
  switch (key) {
    case "name":
      av = a.name.toLowerCase()
      bv = b.name.toLowerCase()
      break
    case "type":
      av = a.type
      bv = b.type
      break
    case "ipAddress":
      av = s(a, "ipAddress")
      bv = s(b, "ipAddress")
      break
    case "os":
      av = s(a, "os")
      bv = s(b, "os")
      break
    case "cpu":
      av = n(a, "cpu")
      bv = n(b, "cpu")
      break
    case "memoryMb":
      av = n(a, "memoryMb")
      bv = n(b, "memoryMb")
      break
    case "diskGb":
      av = n(a, "diskGb")
      bv = n(b, "diskGb")
      break
    case "lifecycle":
      av = s(a, "lifecycle")
      bv = s(b, "lifecycle")
      break
    default:
      return 0
  }
  const cmp =
    typeof av === "number"
      ? av - (bv as number)
      : av.localeCompare(bv as string)
  return dir === "asc" ? cmp : -cmp
}

export default function HostsPage() {
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>("name")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const { data: hosts, isLoading } = useHosts()

  const onSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
      else {
        setSortKey(key)
        setSortDir("asc")
      }
    },
    [sortKey]
  )

  const all = hosts ?? []
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const h of all) counts[h.type] = (counts[h.type] ?? 0) + 1
    return counts
  }, [all])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return all
      .filter((h) => {
        if (typeFilter && h.type !== typeFilter) return false
        if (!q) return true
        return (
          h.name.toLowerCase().includes(q) ||
          s(h, "ipAddress").includes(q) ||
          s(h, "os").toLowerCase().includes(q)
        )
      })
      .sort((a, b) => compareHosts(a, b, sortKey, sortDir))
  }, [all, search, typeFilter, sortKey, sortDir])

  const toolbar = (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex gap-1 rounded-lg border bg-muted p-1">
        <button
          type="button"
          onClick={() => setTypeFilter(null)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            !typeFilter
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          All ({all.length})
        </button>
        {Object.entries(typeCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([type, count]) => (
            <button
              key={type}
              type="button"
              onClick={() => setTypeFilter(typeFilter === type ? null : type)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors inline-flex items-center gap-1.5",
                typeFilter === type
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon
                icon={TYPE_ICON[type] ?? "icon-[ph--question-duotone]"}
                className="text-sm"
              />
              {type} ({count})
            </button>
          ))}
      </div>
      <input
        placeholder="Search hosts..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xs text-base px-3 py-2 rounded-md border bg-card text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
      />
    </div>
  )

  return (
    <DashboardPage
      plane="infra"
      title="Host & VM Inventory"
      description="Bare-metal hosts, virtual machines, and network appliances"
      toolbar={toolbar}
    >
      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {!isLoading && filtered.length === 0 && (
        <EmptyState
          icon="icon-[ph--hard-drives-duotone]"
          title="No hosts found"
        />
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <SortHeader
              label="Name"
              sortKey="name"
              currentKey={sortKey}
              currentDir={sortDir}
              onSort={onSort}
            />
            <SortHeader
              label="Type"
              sortKey="type"
              currentKey={sortKey}
              currentDir={sortDir}
              onSort={onSort}
            />
            <SortHeader
              label="IP"
              icon="icon-[ph--map-pin-duotone]"
              sortKey="ipAddress"
              currentKey={sortKey}
              currentDir={sortDir}
              onSort={onSort}
            />
            <SortHeader
              label="OS"
              sortKey="os"
              currentKey={sortKey}
              currentDir={sortDir}
              onSort={onSort}
            />
            <SortHeader
              label="CPU"
              icon="icon-[ph--cpu-duotone]"
              sortKey="cpu"
              currentKey={sortKey}
              currentDir={sortDir}
              onSort={onSort}
            />
            <SortHeader
              label="Mem"
              icon="icon-[ph--memory-duotone]"
              sortKey="memoryMb"
              currentKey={sortKey}
              currentDir={sortDir}
              onSort={onSort}
            />
            <SortHeader
              label="Disk"
              icon="icon-[ph--hard-drive-duotone]"
              sortKey="diskGb"
              currentKey={sortKey}
              currentDir={sortDir}
              onSort={onSort}
            />
            <SortHeader
              label="Status"
              sortKey="lifecycle"
              currentKey={sortKey}
              currentDir={sortDir}
              onSort={onSort}
            />
          </tr>
        </thead>
        <tbody>
          {filtered.map((h) => (
            <tr
              key={h.id}
              className="border-b last:border-0 hover:bg-accent/30"
            >
              <td className="py-2.5 pr-4 font-medium">
                <Link
                  to={`/infra/hosts/${h.slug}`}
                  className="hover:text-primary hover:underline inline-flex items-center gap-1.5"
                >
                  <Icon
                    icon={
                      TYPE_ICON[h.type] ?? "icon-[ph--desktop-tower-duotone]"
                    }
                    className="text-base text-muted-foreground"
                  />
                  {h.name}
                </Link>
              </td>
              <td className="py-2.5 pr-4 text-xs text-muted-foreground">
                {h.type}
              </td>
              <td className="py-2.5 pr-4 text-xs">
                <CopyCell value={s(h, "ipAddress") || null} />
              </td>
              <td className="py-2.5 pr-4 text-xs">
                {s(h, "os") || (
                  <span className="text-muted-foreground">&mdash;</span>
                )}
              </td>
              <td className="py-2.5 pr-4 text-xs font-mono">
                {n(h, "cpu") > 0 ? (
                  `${n(h, "cpu")}c`
                ) : (
                  <span className="text-muted-foreground">&mdash;</span>
                )}
              </td>
              <td className="py-2.5 pr-4 text-xs font-mono">
                {n(h, "memoryMb") > 0 ? (
                  `${Math.round(n(h, "memoryMb") / 1024)}G`
                ) : (
                  <span className="text-muted-foreground">&mdash;</span>
                )}
              </td>
              <td className="py-2.5 pr-4 text-xs font-mono">
                {n(h, "diskGb") > 0 ? (
                  `${n(h, "diskGb")}G`
                ) : (
                  <span className="text-muted-foreground">&mdash;</span>
                )}
              </td>
              <td className="py-2.5 pr-4">
                <StatusBadge status={s(h, "lifecycle") || "unknown"} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DashboardPage>
  )
}
