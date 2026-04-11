# Factory Fleet Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build 12 Fleet dashboard screens: Fleet Map (sites list), Site Detail, DeploymentTarget Detail, Release Manager, Rollout Tracker, Incident Console, Sandbox Manager, Route & Domain Manager, Workload Inspector, Drift Report, Intervention Log, Release Bundle Manager.

**Architecture:** Each screen is a route page under `factory.fleet/(app)/(dashboard)/fleet/`. Screens use existing fleet data hooks from `ui/src/lib/fleet/` and shared dashboard components from `ui/src/components/factory/`. New hooks are added to `ui/src/lib/fleet/` only when the existing ones don't cover the needed data.

**Tech Stack:** React 19, Tailwind CSS 3, @rio.js/ui, TanStack React Query, TypeScript

**Depends on:** `2026-03-26-factory-ui-foundation.md` (provides shared components, color tokens, module scaffolding)

---

## File Map

### New Files — Route Pages

| File                                                                           | Screen                         |
| ------------------------------------------------------------------------------ | ------------------------------ |
| `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/sites/page.tsx`          | Fleet Map (Sites List)         |
| `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/sites/[slug]/page.tsx`   | Site Detail                    |
| `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/targets/page.tsx`        | Deployment Targets List        |
| `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/targets/[slug]/page.tsx` | Deployment Target Detail       |
| `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/releases/page.tsx`       | Release Manager                |
| `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/rollouts/page.tsx`       | Rollout Tracker                |
| `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/incidents/page.tsx`      | Incident Console (placeholder) |
| `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/sandboxes/page.tsx`      | Sandbox Manager                |
| `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/routes/page.tsx`         | Routes & Domains (placeholder) |
| `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/drift/page.tsx`          | Drift Report                   |
| `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/interventions/page.tsx`  | Intervention Log               |
| `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/bundles/page.tsx`        | Release Bundle Manager         |

### New Files — Sub-components

| File                                                                | Purpose                                                          |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `ui/src/modules/factory.fleet/components/site-card.tsx`             | Card for Fleet Map grid                                          |
| `ui/src/modules/factory.fleet/components/workload-table.tsx`        | Reusable workload table (used by Target Detail and Drift Report) |
| `ui/src/modules/factory.fleet/components/rollout-row.tsx`           | Timeline-aware rollout row                                       |
| `ui/src/modules/factory.fleet/components/sandbox-card.tsx`          | Card for Sandbox Manager grid                                    |
| `ui/src/modules/factory.fleet/components/release-detail-drawer.tsx` | Expandable release module pins                                   |

### Modified Files

| File                            | Change                                                                      |
| ------------------------------- | --------------------------------------------------------------------------- |
| `ui/src/lib/fleet/types.ts`     | Add `Intervention`, `ReleaseBundle`, `ReleaseModulePin` types               |
| `ui/src/lib/fleet/use-fleet.ts` | Add `useInterventions()`, `useReleaseBundles()`, `useFleetSite(slug)` hooks |
| `ui/src/lib/fleet/index.ts`     | Re-export new types and hooks                                               |

---

## Task 1: Fleet Map (Sites List) — `fleet/sites/page.tsx`

**Files:**

- Create: `ui/src/modules/factory.fleet/components/site-card.tsx`
- Create: `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/sites/page.tsx`

- [ ] **Step 1: Create the SiteCard component**

```tsx
// ui/src/modules/factory.fleet/components/site-card.tsx
import { Link } from "react-router"

import { cn } from "@rio.js/ui/lib/utils"

import { StatusBadge } from "@/components/factory"
import type { FleetSite } from "@/lib/fleet"

interface SiteCardProps {
  site: FleetSite
  className?: string
}

export function SiteCard({ site, className }: SiteCardProps) {
  const checkinAgo = site.lastCheckinAt
    ? formatRelativeTime(site.lastCheckinAt)
    : "Never"

  return (
    <Link
      to={`/fleet/sites/${site.slug}`}
      className={cn(
        "group block rounded-lg border bg-card p-4 transition-colors hover:border-[hsl(var(--plane-fleet))]",
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-base font-medium">{site.name}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{site.slug}</p>
        </div>
        <StatusBadge status={site.status} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="text-xs text-muted-foreground">Product</span>
          <p className="font-medium">{site.product}</p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Cluster</span>
          <p className="truncate font-medium">{site.clusterId}</p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Manifest</span>
          <p className="font-medium">
            {site.currentManifestVersion != null
              ? `v${site.currentManifestVersion}`
              : "—"}
          </p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Last Check-in</span>
          <p className="font-medium">{checkinAgo}</p>
        </div>
      </div>
    </Link>
  )
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return "Just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
```

- [ ] **Step 2: Create the Fleet Map page**

```tsx
// ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/sites/page.tsx
import { useMemo, useState } from "react"

import { Input } from "@rio.js/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rio.js/ui/components/select"

import { EmptyState, PlaneHeader } from "@/components/factory"
import { useFleetSites } from "@/lib/fleet"

import { SiteCard } from "../../../../components/site-card"

const STATUS_OPTIONS = [
  "all",
  "active",
  "provisioning",
  "degraded",
  "offline",
] as const

export default function FleetSitesPage() {
  const { data: sites, isLoading } = useFleetSites()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  const filtered = useMemo(() => {
    if (!sites) return []
    return sites.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          s.name.toLowerCase().includes(q) ||
          s.slug.toLowerCase().includes(q) ||
          s.product.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [sites, search, statusFilter])

  return (
    <div className="flex flex-col gap-6 p-6">
      <PlaneHeader
        plane="fleet"
        title="Fleet Map"
        description="All deployment sites across the fleet"
        icon="icon-[ph--globe-hemisphere-west-duotone]"
      />

      <div className="flex items-center gap-3">
        <Input
          placeholder="Search sites..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "all"
                  ? "All statuses"
                  : s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-[160px] animate-pulse rounded-lg border bg-muted"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="icon-[ph--globe-hemisphere-west-duotone]"
          title="No sites found"
          description={
            search || statusFilter !== "all"
              ? "Try adjusting your filters."
              : "No sites have been registered yet."
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((site) => (
            <SiteCard key={site.id} site={site} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify the page renders**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/prague && pnpm --filter ui dev`
Navigate to `/fleet/sites`. Confirm the page renders with loading skeletons or site cards.

- [ ] **Step 4: Commit**

```bash
git add ui/src/modules/factory.fleet/components/site-card.tsx \
  ui/src/modules/factory.fleet/\(app\)/\(dashboard\)/fleet/sites/page.tsx
git commit -m "feat(fleet): add Fleet Map sites list page with filterable card grid"
```

---

## Task 2: Site Detail — `fleet/sites/[slug]/page.tsx`

**Files:**

- Modify: `ui/src/lib/fleet/use-fleet.ts` — add `useFleetSite(slug)` hook
- Modify: `ui/src/lib/fleet/index.ts` — re-export `useFleetSite`
- Create: `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/sites/[slug]/page.tsx`

- [ ] **Step 1: Add useFleetSite hook**

Add to the end of `ui/src/lib/fleet/use-fleet.ts` (before the closing of the file):

```typescript
export function useFleetSite(slug: string | undefined) {
  return useDualOneQuery<FleetSite>({
    queryKey: ["fleet", "site", slug],
    sql: "SELECT * FROM site WHERE slug = ?",
    sqlParams: slug ? [slug] : [],
    fetchPath: `/sites/${slug}`,
    fromRow: toSite,
    fromApi: apiToSite,
    enabled: !!slug,
    single: true,
  })
}
```

- [ ] **Step 2: Re-export useFleetSite**

Add `useFleetSite` to the export list in `ui/src/lib/fleet/index.ts`:

```typescript
export {
  useDeploymentTarget,
  useDeploymentTargets,
  useFleetSite,
  useFleetSites,
  useReleases,
  useRollouts,
  useSandboxes,
  useWorkloads,
} from "./use-fleet"
```

- [ ] **Step 3: Create the Site Detail page**

```tsx
// ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/sites/[slug]/page.tsx
import { Link, useParams } from "react-router"

import { Button } from "@rio.js/ui/components/button"
import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"

import { EntityCard, PlaneHeader, StatusBadge } from "@/components/factory"
import { useDeploymentTargets, useFleetSite } from "@/lib/fleet"

export default function SiteDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: site, isLoading: siteLoading } = useFleetSite(slug)
  const { data: targets, isLoading: targetsLoading } = useDeploymentTargets()

  const siteTargets = targets?.filter((t) => site && t.siteId === site.id) ?? []

  if (siteLoading) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div className="h-10 w-64 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-lg bg-muted" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  if (!site) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-12">
        <Icon
          icon="icon-[ph--warning-duotone]"
          className="h-12 w-12 text-muted-foreground"
        />
        <p className="text-base text-muted-foreground">
          Site not found: {slug}
        </p>
        <Button asChild variant="outline">
          <Link to="/fleet/sites">Back to Fleet Map</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/fleet/sites" className="hover:text-foreground">
          Fleet Map
        </Link>
        <Icon icon="icon-[ph--caret-right]" className="h-3.5 w-3.5" />
        <span className="text-foreground">{site.name}</span>
      </div>

      {/* Site Header */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">{site.name}</h1>
              <StatusBadge status={site.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{site.slug}</p>
          </div>
          <Icon
            icon="icon-[ph--buildings-duotone]"
            className="h-8 w-8 text-[hsl(var(--plane-fleet))]"
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <InfoItem label="Product" value={site.product} />
          <InfoItem label="Cluster" value={site.clusterId} />
          <InfoItem
            label="Manifest Version"
            value={
              site.currentManifestVersion != null
                ? `v${site.currentManifestVersion}`
                : "—"
            }
          />
          <InfoItem
            label="Last Check-in"
            value={
              site.lastCheckinAt
                ? new Date(site.lastCheckinAt).toLocaleString()
                : "Never"
            }
          />
        </div>
      </div>

      {/* Deployment Targets */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">
          Deployment Targets
          {!targetsLoading && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({siteTargets.length})
            </span>
          )}
        </h2>

        {targetsLoading ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : siteTargets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No deployment targets for this site.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {siteTargets.map((target) => (
              <EntityCard
                key={target.id}
                href={`/fleet/targets/${target.slug}`}
                title={target.name}
                subtitle={`${target.kind} / ${target.runtime}`}
                status={target.status}
                metadata={[
                  { label: "Trigger", value: target.trigger },
                  { label: "TTL", value: target.ttl ?? "Permanent" },
                ]}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-muted-foreground">{label}</span>
      <p className="truncate text-sm font-medium">{value}</p>
    </div>
  )
}
```

- [ ] **Step 4: Verify the page renders**

Navigate to `/fleet/sites/<any-slug>`. Confirm site header and deployment targets list render.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/fleet/use-fleet.ts ui/src/lib/fleet/index.ts \
  ui/src/modules/factory.fleet/\(app\)/\(dashboard\)/fleet/sites/\[slug\]/page.tsx
git commit -m "feat(fleet): add Site Detail page with deployment targets list"
```

---

## Task 3: Deployment Targets List — `fleet/targets/page.tsx`

**Files:**

- Create: `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/targets/page.tsx`

- [ ] **Step 1: Create the Deployment Targets List page**

```tsx
// ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/targets/page.tsx
import { useMemo, useState } from "react"
import { Link } from "react-router"

import { Input } from "@rio.js/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rio.js/ui/components/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rio.js/ui/components/table"

import { EmptyState, PlaneHeader, StatusBadge } from "@/components/factory"
import { useDeploymentTargets } from "@/lib/fleet"

const KIND_OPTIONS = [
  "all",
  "production",
  "staging",
  "preview",
  "sandbox",
] as const
const STATUS_OPTIONS = [
  "all",
  "running",
  "provisioning",
  "degraded",
  "failed",
  "destroyed",
] as const

export default function DeploymentTargetsPage() {
  const { data: targets, isLoading } = useDeploymentTargets()
  const [search, setSearch] = useState("")
  const [kindFilter, setKindFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  const filtered = useMemo(() => {
    if (!targets) return []
    return targets.filter((t) => {
      if (kindFilter !== "all" && t.kind !== kindFilter) return false
      if (statusFilter !== "all" && t.status !== statusFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          t.name.toLowerCase().includes(q) ||
          t.slug.toLowerCase().includes(q) ||
          t.runtime.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [targets, search, kindFilter, statusFilter])

  return (
    <div className="flex flex-col gap-6 p-6">
      <PlaneHeader
        plane="fleet"
        title="Deployment Targets"
        description="All deployment targets across the fleet"
        icon="icon-[ph--target-duotone]"
      />

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search targets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Kind" />
          </SelectTrigger>
          <SelectContent>
            {KIND_OPTIONS.map((k) => (
              <SelectItem key={k} value={k}>
                {k === "all"
                  ? "All kinds"
                  : k.charAt(0).toUpperCase() + k.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "all"
                  ? "All statuses"
                  : s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="icon-[ph--target-duotone]"
          title="No deployment targets found"
          description={
            search || kindFilter !== "all" || statusFilter !== "all"
              ? "Try adjusting your filters."
              : "No deployment targets have been created yet."
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Runtime</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>TTL</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((target) => (
                <TableRow key={target.id}>
                  <TableCell>
                    <Link
                      to={`/fleet/targets/${target.slug}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {target.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {target.slug}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm">{target.kind}</TableCell>
                  <TableCell className="text-sm">{target.runtime}</TableCell>
                  <TableCell>
                    <StatusBadge status={target.status} />
                  </TableCell>
                  <TableCell className="text-sm">{target.trigger}</TableCell>
                  <TableCell className="text-sm">{target.ttl ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(target.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify the page renders**

Navigate to `/fleet/targets`. Confirm table renders with filters.

- [ ] **Step 3: Commit**

```bash
git add ui/src/modules/factory.fleet/\(app\)/\(dashboard\)/fleet/targets/page.tsx
git commit -m "feat(fleet): add Deployment Targets list page with table and filters"
```

---

## Task 4: Deployment Target Detail — `fleet/targets/[slug]/page.tsx`

**Files:**

- Create: `ui/src/modules/factory.fleet/components/workload-table.tsx`
- Create: `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/targets/[slug]/page.tsx`

- [ ] **Step 1: Create the WorkloadTable component**

```tsx
// ui/src/modules/factory.fleet/components/workload-table.tsx
import { Link } from "react-router"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rio.js/ui/components/table"
import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"

import { StatusBadge } from "@/components/factory"
import type { Workload } from "@/lib/fleet"

interface WorkloadTableProps {
  workloads: Workload[]
  isLoading?: boolean
  showTarget?: boolean
}

export function WorkloadTable({
  workloads,
  isLoading,
  showTarget,
}: WorkloadTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded bg-muted" />
        ))}
      </div>
    )
  }

  if (workloads.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No workloads found.
      </p>
    )
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Component</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Replicas</TableHead>
            <TableHead>Desired Image</TableHead>
            <TableHead>Actual Image</TableHead>
            <TableHead>Drift</TableHead>
            <TableHead>Last Reconciled</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {workloads.map((w) => (
            <TableRow
              key={w.id}
              className={cn(w.driftDetected && "bg-red-500/5")}
            >
              <TableCell className="font-medium">{w.componentId}</TableCell>
              <TableCell>
                <StatusBadge status={w.status} />
              </TableCell>
              <TableCell className="text-sm">{w.replicas}</TableCell>
              <TableCell className="max-w-[200px] truncate text-xs font-mono">
                {w.desiredImage}
              </TableCell>
              <TableCell className="max-w-[200px] truncate text-xs font-mono">
                {w.actualImage ?? "—"}
              </TableCell>
              <TableCell>
                {w.driftDetected ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-red-500">
                    <Icon
                      icon="icon-[ph--warning-diamond-duotone]"
                      className="h-4 w-4"
                    />
                    Drift
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">OK</span>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {w.lastReconciledAt
                  ? new Date(w.lastReconciledAt).toLocaleString()
                  : "Never"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
```

- [ ] **Step 2: Create the Deployment Target Detail page**

```tsx
// ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/targets/[slug]/page.tsx
import { Link, useParams } from "react-router"

import { Button } from "@rio.js/ui/components/button"
import { Icon } from "@rio.js/ui/icon"

import { MetricCard, PlaneHeader, StatusBadge } from "@/components/factory"
import { useDeploymentTargets, useWorkloads } from "@/lib/fleet"

import { WorkloadTable } from "../../../../components/workload-table"

export default function DeploymentTargetDetailPage() {
  const { slug } = useParams<{ slug: string }>()

  // Look up the target by slug from the list (single-fetch by slug not available)
  const { data: allTargets, isLoading: targetLoading } = useDeploymentTargets()
  const target = allTargets?.find((t) => t.slug === slug)

  const { data: workloads, isLoading: workloadsLoading } = useWorkloads(
    target?.id
  )

  const driftCount = workloads?.filter((w) => w.driftDetected).length ?? 0

  if (targetLoading) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div className="h-10 w-64 animate-pulse rounded bg-muted" />
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      </div>
    )
  }

  if (!target) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-12">
        <Icon
          icon="icon-[ph--warning-duotone]"
          className="h-12 w-12 text-muted-foreground"
        />
        <p className="text-base text-muted-foreground">
          Deployment target not found: {slug}
        </p>
        <Button asChild variant="outline">
          <Link to="/fleet/targets">Back to Targets</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/fleet/targets" className="hover:text-foreground">
          Deployment Targets
        </Link>
        <Icon icon="icon-[ph--caret-right]" className="h-3.5 w-3.5" />
        <span className="text-foreground">{target.name}</span>
      </div>

      {/* Target Header */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">{target.name}</h1>
              <StatusBadge status={target.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{target.slug}</p>
          </div>
          <Icon
            icon="icon-[ph--target-duotone]"
            className="h-8 w-8 text-[hsl(var(--plane-fleet))]"
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          <InfoItem label="Kind" value={target.kind} />
          <InfoItem label="Runtime" value={target.runtime} />
          <InfoItem label="Trigger" value={target.trigger} />
          <InfoItem label="TTL" value={target.ttl ?? "Permanent"} />
          <InfoItem label="Namespace" value={target.namespace ?? "—"} />
          <InfoItem label="Created By" value={target.createdBy} />
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard
          label="Workloads"
          value={workloads?.length ?? 0}
          plane="fleet"
        />
        <MetricCard
          label="Replicas"
          value={workloads?.reduce((sum, w) => sum + w.replicas, 0) ?? 0}
          plane="fleet"
        />
        <MetricCard label="Drift Detected" value={driftCount} plane="fleet" />
        <MetricCard
          label="Expires"
          value={
            target.expiresAt
              ? new Date(target.expiresAt).toLocaleDateString()
              : "Never"
          }
          plane="fleet"
        />
      </div>

      {/* Workloads */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Workloads</h2>
        <WorkloadTable
          workloads={workloads ?? []}
          isLoading={workloadsLoading}
        />
      </section>
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-muted-foreground">{label}</span>
      <p className="truncate text-sm font-medium">{value}</p>
    </div>
  )
}
```

- [ ] **Step 3: Verify the page renders**

Navigate to `/fleet/targets/<any-slug>`. Confirm header, metrics, and workload table render.

- [ ] **Step 4: Commit**

```bash
git add ui/src/modules/factory.fleet/components/workload-table.tsx \
  ui/src/modules/factory.fleet/\(app\)/\(dashboard\)/fleet/targets/\[slug\]/page.tsx
git commit -m "feat(fleet): add Deployment Target Detail page with workload table"
```

---

## Task 5: Release Manager — `fleet/releases/page.tsx`

**Files:**

- Modify: `ui/src/lib/fleet/types.ts` — add `ReleaseModulePin` type
- Create: `ui/src/modules/factory.fleet/components/release-detail-drawer.tsx`
- Create: `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/releases/page.tsx`

- [ ] **Step 1: Add ReleaseModulePin type**

Add to the end of `ui/src/lib/fleet/types.ts`:

```typescript
export interface ReleaseModulePin {
  moduleId: string
  moduleName: string
  version: string
  artifactUri: string | null
}
```

- [ ] **Step 2: Create the ReleaseDetailDrawer component**

```tsx
// ui/src/modules/factory.fleet/components/release-detail-drawer.tsx
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rio.js/ui/components/table"
import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"

import type { Release, ReleaseModulePin } from "@/lib/fleet"

interface ReleaseDetailDrawerProps {
  release: Release
  pins: ReleaseModulePin[]
  isOpen: boolean
  onClose: () => void
}

export function ReleaseDetailDrawer({
  release,
  pins,
  isOpen,
  onClose,
}: ReleaseDetailDrawerProps) {
  if (!isOpen) return null

  return (
    <div className="mt-2 rounded-lg border bg-muted/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-medium">Module Pins — {release.version}</h4>
        <button onClick={onClose} className="rounded p-1 hover:bg-muted">
          <Icon icon="icon-[ph--x]" className="h-4 w-4" />
        </button>
      </div>

      {pins.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No module pins available. Pin data is loaded from the release detail
          API.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Module</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Artifact</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pins.map((pin) => (
              <TableRow key={pin.moduleId}>
                <TableCell className="font-medium">{pin.moduleName}</TableCell>
                <TableCell className="font-mono text-sm">
                  {pin.version}
                </TableCell>
                <TableCell className="max-w-[200px] truncate text-xs font-mono text-muted-foreground">
                  {pin.artifactUri ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create the Release Manager page**

```tsx
// ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/releases/page.tsx
import { useMemo, useState } from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rio.js/ui/components/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rio.js/ui/components/table"
import { Icon } from "@rio.js/ui/icon"

import { EmptyState, PlaneHeader, StatusBadge } from "@/components/factory"
import { useReleases } from "@/lib/fleet"
import type { Release } from "@/lib/fleet"

import { ReleaseDetailDrawer } from "../../../../components/release-detail-drawer"

const STATUS_OPTIONS = [
  "all",
  "draft",
  "staging",
  "production",
  "superseded",
  "failed",
] as const

export default function ReleasesPage() {
  const { data: releases, isLoading } = useReleases()
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    if (!releases) return []
    if (statusFilter === "all") return releases
    return releases.filter((r) => r.status === statusFilter)
  }, [releases, statusFilter])

  return (
    <div className="flex flex-col gap-6 p-6">
      <PlaneHeader
        plane="fleet"
        title="Release Manager"
        description="All releases with lifecycle status and module pins"
        icon="icon-[ph--package-duotone]"
      />

      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "all"
                  ? "All statuses"
                  : s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="icon-[ph--package-duotone]"
          title="No releases found"
          description={
            statusFilter !== "all"
              ? "Try adjusting your status filter."
              : "No releases have been created yet."
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created By</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((release) => (
                <ReleaseRow
                  key={release.id}
                  release={release}
                  isExpanded={expandedId === release.id}
                  onToggle={() =>
                    setExpandedId(expandedId === release.id ? null : release.id)
                  }
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function ReleaseRow({
  release,
  isExpanded,
  onToggle,
}: {
  release: Release
  isExpanded: boolean
  onToggle: () => void
}) {
  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell>
          <Icon
            icon={
              isExpanded ? "icon-[ph--caret-down]" : "icon-[ph--caret-right]"
            }
            className="h-4 w-4 text-muted-foreground"
          />
        </TableCell>
        <TableCell className="font-mono font-medium">
          {release.version}
        </TableCell>
        <TableCell>
          <StatusBadge status={release.status} />
        </TableCell>
        <TableCell className="text-sm">{release.createdBy}</TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {new Date(release.createdAt).toLocaleString()}
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow>
          <TableCell colSpan={5} className="p-0 px-4 pb-4">
            <ReleaseDetailDrawer
              release={release}
              pins={[]}
              isOpen={true}
              onClose={onToggle}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
```

- [ ] **Step 4: Verify the page renders**

Navigate to `/fleet/releases`. Confirm table with expandable rows renders.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/fleet/types.ts \
  ui/src/modules/factory.fleet/components/release-detail-drawer.tsx \
  ui/src/modules/factory.fleet/\(app\)/\(dashboard\)/fleet/releases/page.tsx
git commit -m "feat(fleet): add Release Manager page with expandable module pins"
```

---

## Task 6: Rollout Tracker — `fleet/rollouts/page.tsx`

**Files:**

- Create: `ui/src/modules/factory.fleet/components/rollout-row.tsx`
- Create: `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/rollouts/page.tsx`

- [ ] **Step 1: Create the RolloutRow component**

```tsx
// ui/src/modules/factory.fleet/components/rollout-row.tsx
import { Link } from "react-router"

import { TableCell, TableRow } from "@rio.js/ui/components/table"
import { cn } from "@rio.js/ui/lib/utils"

import { StatusBadge } from "@/components/factory"
import type { DeploymentTarget, Release, Rollout } from "@/lib/fleet"

interface RolloutRowProps {
  rollout: Rollout
  release: Release | undefined
  target: DeploymentTarget | undefined
}

export function RolloutRow({ rollout, release, target }: RolloutRowProps) {
  const isActive = !rollout.completedAt
  const duration = rollout.completedAt
    ? formatDuration(
        new Date(rollout.startedAt).getTime(),
        new Date(rollout.completedAt).getTime()
      )
    : formatDuration(new Date(rollout.startedAt).getTime(), Date.now())

  return (
    <TableRow className={cn(isActive && "bg-blue-500/5")}>
      <TableCell className="font-mono text-sm">
        {release?.version ?? rollout.releaseId.slice(0, 8)}
      </TableCell>
      <TableCell>
        {target ? (
          <Link
            to={`/fleet/targets/${target.slug}`}
            className="text-sm hover:underline"
          >
            {target.name}
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">
            {rollout.deploymentTargetId.slice(0, 8)}
          </span>
        )}
      </TableCell>
      <TableCell>
        <StatusBadge status={rollout.status} />
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {new Date(rollout.startedAt).toLocaleString()}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {rollout.completedAt
          ? new Date(rollout.completedAt).toLocaleString()
          : "—"}
      </TableCell>
      <TableCell className="text-sm">{duration}</TableCell>
    </TableRow>
  )
}

function formatDuration(startMs: number, endMs: number): string {
  const diff = endMs - startMs
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ${secs % 60}s`
  const hours = Math.floor(mins / 60)
  return `${hours}h ${mins % 60}m`
}
```

- [ ] **Step 2: Create the Rollout Tracker page**

```tsx
// ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/rollouts/page.tsx
import { useMemo, useState } from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rio.js/ui/components/select"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@rio.js/ui/components/table"

import { EmptyState, PlaneHeader, TimelineView } from "@/components/factory"
import { useDeploymentTargets, useReleases, useRollouts } from "@/lib/fleet"

import { RolloutRow } from "../../../../components/rollout-row"

const STATUS_OPTIONS = [
  "all",
  "in_progress",
  "succeeded",
  "failed",
  "rolled_back",
] as const

export default function RolloutsPage() {
  const { data: rollouts, isLoading: rolloutsLoading } = useRollouts()
  const { data: releases } = useReleases()
  const { data: targets } = useDeploymentTargets()
  const [statusFilter, setStatusFilter] = useState<string>("all")

  const releaseMap = useMemo(() => {
    const map = new Map<
      string,
      typeof releases extends (infer T)[] | undefined ? T : never
    >()
    releases?.forEach((r) => map.set(r.id, r))
    return map
  }, [releases])

  const targetMap = useMemo(() => {
    const map = new Map<
      string,
      typeof targets extends (infer T)[] | undefined ? T : never
    >()
    targets?.forEach((t) => map.set(t.id, t))
    return map
  }, [targets])

  const filtered = useMemo(() => {
    if (!rollouts) return []
    if (statusFilter === "all") return rollouts
    return rollouts.filter((r) => r.status === statusFilter)
  }, [rollouts, statusFilter])

  const activeRollouts = useMemo(
    () => filtered.filter((r) => !r.completedAt),
    [filtered]
  )
  const completedRollouts = useMemo(
    () => filtered.filter((r) => r.completedAt),
    [filtered]
  )

  return (
    <div className="flex flex-col gap-6 p-6">
      <PlaneHeader
        plane="fleet"
        title="Rollout Tracker"
        description="Active and recent rollouts across deployment targets"
        icon="icon-[ph--rocket-launch-duotone]"
      />

      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "all"
                  ? "All statuses"
                  : s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rolloutsLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="icon-[ph--rocket-launch-duotone]"
          title="No rollouts found"
          description="No rollouts match the current filter."
        />
      ) : (
        <>
          {/* Active rollouts — timeline view */}
          {activeRollouts.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold">
                Active ({activeRollouts.length})
              </h2>
              <TimelineView
                items={activeRollouts.map((r) => ({
                  id: r.id,
                  title:
                    releaseMap.get(r.releaseId)?.version ??
                    r.releaseId.slice(0, 8),
                  subtitle:
                    targetMap.get(r.deploymentTargetId)?.name ??
                    r.deploymentTargetId.slice(0, 8),
                  status: r.status,
                  timestamp: r.startedAt,
                }))}
              />
            </section>
          )}

          {/* All rollouts — table */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">
              {activeRollouts.length > 0 ? "History" : "All Rollouts"}
            </h2>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Release</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Completed</TableHead>
                    <TableHead>Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(activeRollouts.length > 0
                    ? completedRollouts
                    : filtered
                  ).map((rollout) => (
                    <RolloutRow
                      key={rollout.id}
                      rollout={rollout}
                      release={releaseMap.get(rollout.releaseId)}
                      target={targetMap.get(rollout.deploymentTargetId)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify the page renders**

Navigate to `/fleet/rollouts`. Confirm timeline for active rollouts and table for all rollouts.

- [ ] **Step 4: Commit**

```bash
git add ui/src/modules/factory.fleet/components/rollout-row.tsx \
  ui/src/modules/factory.fleet/\(app\)/\(dashboard\)/fleet/rollouts/page.tsx
git commit -m "feat(fleet): add Rollout Tracker page with timeline and history table"
```

---

## Task 7: Incident Console (Placeholder) — `fleet/incidents/page.tsx`

**Files:**

- Create: `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/incidents/page.tsx`

- [ ] **Step 1: Create the Incident Console placeholder page**

```tsx
// ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/incidents/page.tsx
import { EmptyState, PlaneHeader } from "@/components/factory"

export default function IncidentsPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <PlaneHeader
        plane="fleet"
        title="Incident Console"
        description="Incident tracking and resolution for fleet operations"
        icon="icon-[ph--siren-duotone]"
      />

      <EmptyState
        icon="icon-[ph--siren-duotone]"
        title="Coming Soon"
        description="The Incident Console will provide real-time incident tracking, severity classification, blast radius analysis, and resolution workflows. The Incident entity is currently being designed — see the fleet schema RFC for progress."
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/src/modules/factory.fleet/\(app\)/\(dashboard\)/fleet/incidents/page.tsx
git commit -m "feat(fleet): add Incident Console placeholder page"
```

---

## Task 8: Sandbox Manager — `fleet/sandboxes/page.tsx`

**Files:**

- Create: `ui/src/modules/factory.fleet/components/sandbox-card.tsx`
- Create: `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/sandboxes/page.tsx`

- [ ] **Step 1: Create the SandboxCard component**

```tsx
// ui/src/modules/factory.fleet/components/sandbox-card.tsx
import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"

import { HealthGauge, StatusBadge } from "@/components/factory"
import type { Sandbox } from "@/lib/fleet"

interface SandboxCardProps {
  sandbox: Sandbox
  className?: string
}

export function SandboxCard({ sandbox, className }: SandboxCardProps) {
  const isAgent = sandbox.ownerType === "agent"

  return (
    <div className={cn("rounded-lg border bg-card p-4", className)}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Icon
            icon={
              isAgent ? "icon-[ph--robot-duotone]" : "icon-[ph--user-duotone]"
            }
            className="h-5 w-5 text-muted-foreground"
          />
          <div className="min-w-0">
            <h3 className="truncate text-base font-medium">{sandbox.name}</h3>
            <p className="text-xs text-muted-foreground">
              {sandbox.ownerType}: {sandbox.ownerId.slice(0, 12)}
            </p>
          </div>
        </div>
        <StatusBadge status={sandbox.statusMessage ?? "running"} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="text-xs text-muted-foreground">Runtime</span>
          <p className="font-medium">{sandbox.runtimeType}</p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Storage</span>
          <p className="font-medium">{sandbox.storageGb} GB</p>
        </div>
      </div>

      {/* Resource gauges */}
      <div className="mt-3 space-y-2">
        {sandbox.cpu && (
          <HealthGauge
            label="CPU"
            value={parseFloat(sandbox.cpu)}
            max={4}
            unit="cores"
          />
        )}
        {sandbox.memory && (
          <HealthGauge
            label="Memory"
            value={parseFloat(sandbox.memory)}
            max={8192}
            unit="MB"
          />
        )}
      </div>

      {/* Quick links */}
      <div className="mt-3 flex gap-2">
        {sandbox.webTerminalUrl && (
          <a
            href={sandbox.webTerminalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Icon icon="icon-[ph--terminal-duotone]" className="h-3.5 w-3.5" />
            Terminal
          </a>
        )}
        {sandbox.sshHost && (
          <span className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground">
            <Icon
              icon="icon-[ph--plugs-connected-duotone]"
              className="h-3.5 w-3.5"
            />
            {sandbox.sshHost}:{sandbox.sshPort}
          </span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the Sandbox Manager page**

```tsx
// ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/sandboxes/page.tsx
import { useMemo, useState } from "react"

import { Input } from "@rio.js/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rio.js/ui/components/select"

import { EmptyState, PlaneHeader } from "@/components/factory"
import { useSandboxes } from "@/lib/fleet"

import { SandboxCard } from "../../../../components/sandbox-card"

const OWNER_OPTIONS = ["all", "user", "agent"] as const

export default function SandboxesPage() {
  const { data: sandboxes, isLoading } = useSandboxes()
  const [search, setSearch] = useState("")
  const [ownerFilter, setOwnerFilter] = useState<string>("all")

  const filtered = useMemo(() => {
    if (!sandboxes) return []
    return sandboxes.filter((s) => {
      if (ownerFilter !== "all" && s.ownerType !== ownerFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          s.name.toLowerCase().includes(q) ||
          s.slug.toLowerCase().includes(q) ||
          s.ownerId.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [sandboxes, search, ownerFilter])

  return (
    <div className="flex flex-col gap-6 p-6">
      <PlaneHeader
        plane="fleet"
        title="Sandbox Manager"
        description="Developer and agent sandboxes across the fleet"
        icon="icon-[ph--cube-duotone]"
      />

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search sandboxes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={ownerFilter} onValueChange={setOwnerFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Owner" />
          </SelectTrigger>
          <SelectContent>
            {OWNER_OPTIONS.map((o) => (
              <SelectItem key={o} value={o}>
                {o === "all"
                  ? "All owners"
                  : o.charAt(0).toUpperCase() + o.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-[200px] animate-pulse rounded-lg border bg-muted"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="icon-[ph--cube-duotone]"
          title="No sandboxes found"
          description={
            search || ownerFilter !== "all"
              ? "Try adjusting your filters."
              : "No sandboxes have been provisioned yet."
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((sandbox) => (
            <SandboxCard key={sandbox.id} sandbox={sandbox} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify the page renders**

Navigate to `/fleet/sandboxes`. Confirm card grid with owner filter renders.

- [ ] **Step 4: Commit**

```bash
git add ui/src/modules/factory.fleet/components/sandbox-card.tsx \
  ui/src/modules/factory.fleet/\(app\)/\(dashboard\)/fleet/sandboxes/page.tsx
git commit -m "feat(fleet): add Sandbox Manager page with owner-filtered card grid"
```

---

## Task 9: Routes & Domains (Placeholder) — `fleet/routes/page.tsx`

**Files:**

- Create: `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/routes/page.tsx`

- [ ] **Step 1: Create the Routes & Domains placeholder page**

```tsx
// ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/routes/page.tsx
import { EmptyState, PlaneHeader } from "@/components/factory"

export default function RoutesPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <PlaneHeader
        plane="fleet"
        title="Routes & Domains"
        description="Ingress routes, domain mappings, and TLS certificates"
        icon="icon-[ph--signpost-duotone]"
      />

      <EmptyState
        icon="icon-[ph--signpost-duotone]"
        title="Coming Soon"
        description="The Routes & Domains manager will provide ingress route configuration, custom domain mapping, TLS certificate management, and traffic splitting controls. Route and Domain entities exist in the gateway schema but fleet-side hooks have not been created yet."
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/src/modules/factory.fleet/\(app\)/\(dashboard\)/fleet/routes/page.tsx
git commit -m "feat(fleet): add Routes & Domains placeholder page"
```

---

## Task 10: Drift Report — `fleet/drift/page.tsx`

**Files:**

- Create: `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/drift/page.tsx`

This page reuses the `WorkloadTable` component from Task 4 and fetches workloads across all targets, filtering for `driftDetected === true`.

- [ ] **Step 1: Create the Drift Report page**

```tsx
// ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/drift/page.tsx
import { useMemo } from "react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rio.js/ui/components/table"
import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"

import {
  EmptyState,
  MetricCard,
  PlaneHeader,
  StatusBadge,
} from "@/components/factory"
import { useDeploymentTargets, useWorkloads } from "@/lib/fleet"
import type { DeploymentTarget, Workload } from "@/lib/fleet"

interface DriftItem {
  workload: Workload
  target: DeploymentTarget
}

export default function DriftReportPage() {
  const { data: targets, isLoading: targetsLoading } = useDeploymentTargets()

  // We need workloads for all targets. In a real scenario, a dedicated
  // `/workloads?driftDetected=true` endpoint would be better. For now,
  // we render a per-target approach — the page shows targets that have drift.
  // Individual target workloads are loaded inline.

  return (
    <div className="flex flex-col gap-6 p-6">
      <PlaneHeader
        plane="fleet"
        title="Drift Report"
        description="Workloads where actual state differs from desired state"
        icon="icon-[ph--warning-diamond-duotone]"
      />

      {targetsLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : !targets || targets.length === 0 ? (
        <EmptyState
          icon="icon-[ph--warning-diamond-duotone]"
          title="No deployment targets"
          description="No deployment targets exist to check for drift."
        />
      ) : (
        <DriftTable targets={targets} />
      )}
    </div>
  )
}

function DriftTable({ targets }: { targets: DeploymentTarget[] }) {
  // Load workloads for each target and filter drifted ones
  // NOTE: In production, prefer a single API call. This demonstrates the
  // composition pattern using existing hooks.
  return (
    <div className="space-y-4">
      {targets.map((target) => (
        <TargetDriftSection key={target.id} target={target} />
      ))}
    </div>
  )
}

function TargetDriftSection({ target }: { target: DeploymentTarget }) {
  const { data: workloads, isLoading } = useWorkloads(target.id)

  const drifted = useMemo(
    () => workloads?.filter((w) => w.driftDetected) ?? [],
    [workloads]
  )

  // Skip targets with no drift
  if (!isLoading && drifted.length === 0) return null

  if (isLoading) {
    return <div className="h-16 animate-pulse rounded-lg bg-muted" />
  }

  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/5">
      <div className="flex items-center gap-3 border-b border-red-500/10 px-4 py-3">
        <Icon
          icon="icon-[ph--warning-diamond-duotone]"
          className="h-5 w-5 text-red-500"
        />
        <div>
          <span className="font-medium">{target.name}</span>
          <span className="ml-2 text-sm text-muted-foreground">
            {drifted.length} drifted workload{drifted.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Component</TableHead>
            <TableHead>Desired Image</TableHead>
            <TableHead>Actual Image</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Since</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {drifted.map((w) => (
            <TableRow key={w.id}>
              <TableCell className="font-medium">{w.componentId}</TableCell>
              <TableCell className="max-w-[200px] truncate font-mono text-xs">
                {w.desiredImage}
              </TableCell>
              <TableCell className="max-w-[200px] truncate font-mono text-xs text-red-400">
                {w.actualImage ?? "unknown"}
              </TableCell>
              <TableCell>
                <StatusBadge status={w.status} />
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {w.lastReconciledAt
                  ? new Date(w.lastReconciledAt).toLocaleString()
                  : "Unknown"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
```

- [ ] **Step 2: Verify the page renders**

Navigate to `/fleet/drift`. Confirm drifted workloads grouped by target render with red alert styling.

- [ ] **Step 3: Commit**

```bash
git add ui/src/modules/factory.fleet/\(app\)/\(dashboard\)/fleet/drift/page.tsx
git commit -m "feat(fleet): add Drift Report page showing workloads with state drift"
```

---

## Task 11: Intervention Log — `fleet/interventions/page.tsx`

**Files:**

- Modify: `ui/src/lib/fleet/types.ts` — add `Intervention` type
- Modify: `ui/src/lib/fleet/use-fleet.ts` — add `useInterventions()` hook
- Modify: `ui/src/lib/fleet/index.ts` — re-export new type and hook
- Create: `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/interventions/page.tsx`

- [ ] **Step 1: Add Intervention type**

Add to the end of `ui/src/lib/fleet/types.ts`:

```typescript
export interface Intervention {
  id: string
  action: string
  principalId: string
  principalType: string
  deploymentTargetId: string | null
  workloadId: string | null
  reason: string
  metadata: Record<string, unknown>
  createdAt: string
}
```

- [ ] **Step 2: Add useInterventions hook**

Add to the end of `ui/src/lib/fleet/use-fleet.ts` (add `Intervention` to the import from `./types`):

```typescript
const toIntervention = (r: Record<string, unknown>): Intervention => ({
  id: r.id as string,
  action: r.action as string,
  principalId: (r.principal_id ?? r.principalId) as string,
  principalType: (r.principal_type ?? r.principalType) as string,
  deploymentTargetId: (r.deployment_target_id ??
    r.deploymentTargetId ??
    null) as string | null,
  workloadId: (r.workload_id ?? r.workloadId ?? null) as string | null,
  reason: (r.reason ?? "") as string,
  metadata: parseJson(r.metadata),
  createdAt: (r.created_at ?? r.createdAt ?? "") as string,
})

const apiToIntervention = (r: Record<string, unknown>): Intervention =>
  toIntervention({ ...r, id: r.interventionId ?? r.id })

export function useInterventions() {
  return useDualListQuery<Intervention>({
    queryKey: ["fleet", "interventions"],
    sql: "SELECT * FROM intervention ORDER BY created_at DESC",
    fetchPath: "/interventions",
    fromRow: toIntervention,
    fromApi: apiToIntervention,
  })
}
```

- [ ] **Step 3: Re-export Intervention type and useInterventions hook**

Update `ui/src/lib/fleet/index.ts` to add:

- `Intervention` to the type exports
- `useInterventions` to the hook exports

```typescript
export type {
  DeploymentTarget,
  FleetSite,
  Intervention,
  Release,
  ReleaseModulePin,
  Rollout,
  Sandbox,
  Workload,
} from "./types"
export {
  useDeploymentTarget,
  useDeploymentTargets,
  useFleetSite,
  useFleetSites,
  useInterventions,
  useReleases,
  useRollouts,
  useSandboxes,
  useWorkloads,
} from "./use-fleet"
```

- [ ] **Step 4: Create the Intervention Log page**

```tsx
// ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/interventions/page.tsx
import { useMemo, useState } from "react"

import { Input } from "@rio.js/ui/components/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rio.js/ui/components/table"
import { Icon } from "@rio.js/ui/icon"

import { EmptyState, PlaneHeader } from "@/components/factory"
import { useInterventions } from "@/lib/fleet"

export default function InterventionsPage() {
  const { data: interventions, isLoading } = useInterventions()
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    if (!interventions) return []
    if (!search) return interventions
    const q = search.toLowerCase()
    return interventions.filter(
      (i) =>
        i.action.toLowerCase().includes(q) ||
        i.principalId.toLowerCase().includes(q) ||
        i.reason.toLowerCase().includes(q)
    )
  }, [interventions, search])

  return (
    <div className="flex flex-col gap-6 p-6">
      <PlaneHeader
        plane="fleet"
        title="Intervention Log"
        description="Audit trail of manual actions taken on fleet resources"
        icon="icon-[ph--hand-duotone]"
      />

      <div className="flex items-center gap-3">
        <Input
          placeholder="Search interventions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="icon-[ph--hand-duotone]"
          title="No interventions recorded"
          description={
            search
              ? "Try adjusting your search."
              : "No manual interventions have been logged yet."
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Principal</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Workload</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Timestamp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((intervention) => (
                <TableRow key={intervention.id}>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 rounded bg-muted px-2 py-0.5 text-sm font-medium">
                      <Icon
                        icon="icon-[ph--lightning-duotone]"
                        className="h-3.5 w-3.5"
                      />
                      {intervention.action}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div>
                      <span className="text-sm">
                        {intervention.principalId.slice(0, 12)}
                      </span>
                      <p className="text-xs text-muted-foreground">
                        {intervention.principalType}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {intervention.deploymentTargetId
                      ? intervention.deploymentTargetId.slice(0, 12)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {intervention.workloadId
                      ? intervention.workloadId.slice(0, 12)
                      : "—"}
                  </TableCell>
                  <TableCell className="max-w-[250px] truncate text-sm">
                    {intervention.reason || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(intervention.createdAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Verify the page renders**

Navigate to `/fleet/interventions`. Confirm table renders (may show empty state if no interventions exist).

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/fleet/types.ts ui/src/lib/fleet/use-fleet.ts ui/src/lib/fleet/index.ts \
  ui/src/modules/factory.fleet/\(app\)/\(dashboard\)/fleet/interventions/page.tsx
git commit -m "feat(fleet): add Intervention Log page with audit trail table"
```

---

## Task 12: Release Bundle Manager — `fleet/bundles/page.tsx`

**Files:**

- Modify: `ui/src/lib/fleet/types.ts` — add `ReleaseBundle` type
- Modify: `ui/src/lib/fleet/use-fleet.ts` — add `useReleaseBundles()` hook
- Modify: `ui/src/lib/fleet/index.ts` — re-export new type and hook
- Create: `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/bundles/page.tsx`

- [ ] **Step 1: Add ReleaseBundle type**

Add to the end of `ui/src/lib/fleet/types.ts`:

```typescript
export interface ReleaseBundle {
  id: string
  releaseId: string
  releaseVersion: string
  role: string
  arch: string
  status: string
  sizeBytes: number
  checksum: string
  storageUri: string | null
  createdAt: string
}
```

- [ ] **Step 2: Add useReleaseBundles hook**

Add to the end of `ui/src/lib/fleet/use-fleet.ts` (add `ReleaseBundle` to the import from `./types`):

```typescript
const toReleaseBundle = (r: Record<string, unknown>): ReleaseBundle => ({
  id: r.id as string,
  releaseId: (r.release_id ?? r.releaseId) as string,
  releaseVersion: (r.release_version ?? r.releaseVersion ?? "") as string,
  role: r.role as string,
  arch: r.arch as string,
  status: r.status as string,
  sizeBytes: (r.size_bytes ?? r.sizeBytes ?? 0) as number,
  checksum: (r.checksum ?? "") as string,
  storageUri: (r.storage_uri ?? r.storageUri ?? null) as string | null,
  createdAt: (r.created_at ?? r.createdAt ?? "") as string,
})

const apiToReleaseBundle = (r: Record<string, unknown>): ReleaseBundle =>
  toReleaseBundle({ ...r, id: r.releaseBundleId ?? r.id })

export function useReleaseBundles() {
  return useDualListQuery<ReleaseBundle>({
    queryKey: ["fleet", "release-bundles"],
    sql: "SELECT * FROM release_bundle ORDER BY created_at DESC",
    fetchPath: "/bundles",
    fromRow: toReleaseBundle,
    fromApi: apiToReleaseBundle,
  })
}
```

- [ ] **Step 3: Re-export ReleaseBundle type and useReleaseBundles hook**

Update `ui/src/lib/fleet/index.ts` to add:

- `ReleaseBundle` to the type exports
- `useReleaseBundles` to the hook exports

```typescript
export type {
  DeploymentTarget,
  FleetSite,
  Intervention,
  Release,
  ReleaseBundle,
  ReleaseModulePin,
  Rollout,
  Sandbox,
  Workload,
} from "./types"
export {
  useDeploymentTarget,
  useDeploymentTargets,
  useFleetSite,
  useFleetSites,
  useInterventions,
  useReleaseBundles,
  useReleases,
  useRollouts,
  useSandboxes,
  useWorkloads,
} from "./use-fleet"
```

- [ ] **Step 4: Create the Release Bundle Manager page**

```tsx
// ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/bundles/page.tsx
import { useMemo, useState } from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rio.js/ui/components/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rio.js/ui/components/table"
import { Icon } from "@rio.js/ui/icon"

import { EmptyState, PlaneHeader, StatusBadge } from "@/components/factory"
import { useReleaseBundles } from "@/lib/fleet"

const STATUS_OPTIONS = [
  "all",
  "building",
  "ready",
  "failed",
  "expired",
] as const
const ARCH_OPTIONS = ["all", "amd64", "arm64"] as const

export default function BundlesPage() {
  const { data: bundles, isLoading } = useReleaseBundles()
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [archFilter, setArchFilter] = useState<string>("all")

  const filtered = useMemo(() => {
    if (!bundles) return []
    return bundles.filter((b) => {
      if (statusFilter !== "all" && b.status !== statusFilter) return false
      if (archFilter !== "all" && b.arch !== archFilter) return false
      return true
    })
  }, [bundles, statusFilter, archFilter])

  return (
    <div className="flex flex-col gap-6 p-6">
      <PlaneHeader
        plane="fleet"
        title="Release Bundles"
        description="Offline release bundles for air-gapped site deployments"
        icon="icon-[ph--archive-duotone]"
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "all"
                  ? "All statuses"
                  : s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={archFilter} onValueChange={setArchFilter}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Arch" />
          </SelectTrigger>
          <SelectContent>
            {ARCH_OPTIONS.map((a) => (
              <SelectItem key={a} value={a}>
                {a === "all" ? "All archs" : a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="icon-[ph--archive-duotone]"
          title="No release bundles found"
          description={
            statusFilter !== "all" || archFilter !== "all"
              ? "Try adjusting your filters."
              : "No release bundles have been created yet."
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Release Version</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Arch</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Checksum</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((bundle) => (
                <TableRow key={bundle.id}>
                  <TableCell className="font-mono font-medium">
                    {bundle.releaseVersion}
                  </TableCell>
                  <TableCell className="text-sm">{bundle.role}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs font-medium">
                      <Icon
                        icon="icon-[ph--cpu-duotone]"
                        className="h-3.5 w-3.5"
                      />
                      {bundle.arch}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={bundle.status} />
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatBytes(bundle.sizeBytes)}
                  </TableCell>
                  <TableCell className="max-w-[120px] truncate font-mono text-xs text-muted-foreground">
                    {bundle.checksum || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(bundle.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}
```

- [ ] **Step 5: Verify the page renders**

Navigate to `/fleet/bundles`. Confirm table with status and arch filters renders.

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/fleet/types.ts ui/src/lib/fleet/use-fleet.ts ui/src/lib/fleet/index.ts \
  ui/src/modules/factory.fleet/\(app\)/\(dashboard\)/fleet/bundles/page.tsx
git commit -m "feat(fleet): add Release Bundle Manager page for air-gapped deployments"
```
