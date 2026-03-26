# Factory Infra Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build 8 Infrastructure dashboard screens: Provider Overview, Cluster Dashboard, Host & VM Inventory, Network Topology, Node Detail, Proxmox Cluster View, Resource Utilization, Certificates & Secrets.

**Architecture:** Each screen is a route page under `factory.infra/(app)/(dashboard)/infra/`. Screens use infra data hooks from `ui/src/lib/infra/` and shared dashboard components from `ui/src/components/factory/`.

**Tech Stack:** React 19, Tailwind CSS 3, @rio.js/ui, TanStack React Query, TypeScript

**Prerequisites:** The Foundation plan (2026-03-26-factory-ui-foundation.md) must be completed first. It creates the shared components (`StatusBadge`, `MetricCard`, `HealthGauge`, `EntityCard`, `PlaneHeader`, `EmptyState`), the infra data hooks (`useProviders`, `useClusters`, `useHosts`, etc.), the infra types, and the `factory.infra` extension scaffold.

---

## File Structure

### New Files
- `ui/src/modules/factory.infra/(app)/(dashboard)/infra/providers/page.tsx` — Provider Overview
- `ui/src/modules/factory.infra/(app)/(dashboard)/infra/providers/[slug]/page.tsx` — Provider Detail
- `ui/src/modules/factory.infra/(app)/(dashboard)/infra/clusters/page.tsx` — Cluster Dashboard
- `ui/src/modules/factory.infra/(app)/(dashboard)/infra/clusters/[slug]/page.tsx` — Cluster Detail
- `ui/src/modules/factory.infra/(app)/(dashboard)/infra/hosts/page.tsx` — Host & VM Inventory
- `ui/src/modules/factory.infra/(app)/(dashboard)/infra/network/page.tsx` — Network Topology
- `ui/src/modules/factory.infra/(app)/(dashboard)/infra/proxmox/page.tsx` — Proxmox Cluster View
- `ui/src/modules/factory.infra/(app)/(dashboard)/infra/utilization/page.tsx` — Resource Utilization
- `ui/src/modules/factory.infra/(app)/(dashboard)/infra/certs/page.tsx` — Certificates & Secrets (placeholder)
- `ui/src/modules/factory.infra/components/provider-type-icon.tsx` — Provider type icon helper
- `ui/src/modules/factory.infra/components/infra-data-table.tsx` — Reusable infra table with sorting/filtering
- `ui/src/modules/factory.infra/components/subnet-row.tsx` — Expandable subnet row with IP allocations
- `ui/src/modules/factory.infra/components/utilization-bar.tsx` — Simple Tailwind bar chart row

### Modified Files
- `ui/src/modules/factory.infra/manifest.json` — Add routes for all 8 screens

---

### Task 1: Provider Overview — `infra/providers/page.tsx`

**Files:**
- Create: `ui/src/modules/factory.infra/components/provider-type-icon.tsx`
- Create: `ui/src/modules/factory.infra/(app)/(dashboard)/infra/providers/page.tsx`

- [ ] **Step 1: Create the provider type icon helper**

This maps provider types to Phosphor duotone icons for visual distinction.

```tsx
// ui/src/modules/factory.infra/components/provider-type-icon.tsx
import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"

const PROVIDER_ICONS: Record<string, { icon: string; color: string }> = {
  proxmox: {
    icon: "icon-[ph--cpu-duotone]",
    color: "text-orange-400",
  },
  hetzner: {
    icon: "icon-[ph--hard-drives-duotone]",
    color: "text-red-400",
  },
  aws: {
    icon: "icon-[ph--cloud-duotone]",
    color: "text-amber-400",
  },
  gcp: {
    icon: "icon-[ph--google-logo-duotone]",
    color: "text-blue-400",
  },
  azure: {
    icon: "icon-[ph--microsoft-outlook-logo-duotone]",
    color: "text-cyan-400",
  },
  digitalocean: {
    icon: "icon-[ph--drop-duotone]",
    color: "text-blue-500",
  },
  manual: {
    icon: "icon-[ph--wrench-duotone]",
    color: "text-zinc-400",
  },
}

const DEFAULT_ICON = {
  icon: "icon-[ph--cloud-duotone]",
  color: "text-zinc-400",
}

interface ProviderTypeIconProps {
  type: string
  className?: string
}

export function ProviderTypeIcon({ type, className }: ProviderTypeIconProps) {
  const config = PROVIDER_ICONS[type.toLowerCase()] ?? DEFAULT_ICON

  return (
    <Icon
      icon={config.icon}
      className={cn("h-5 w-5", config.color, className)}
    />
  )
}
```

- [ ] **Step 2: Create the Provider Overview page**

```tsx
// ui/src/modules/factory.infra/(app)/(dashboard)/infra/providers/page.tsx
import { Link } from "react-router"

import { Badge } from "@rio.js/ui/badge"
import { Input } from "@rio.js/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rio.js/ui/select"
import { Skeleton } from "@rio.js/ui/skeleton"

import { PlaneHeader, StatusBadge, MetricCard } from "@/components/factory"
import { useProviders } from "@/lib/infra"
import type { Provider } from "@/lib/infra"

import { ProviderTypeIcon } from "../../../components/provider-type-icon"
import { useState, useMemo } from "react"

const KIND_LABELS: Record<string, string> = {
  internal: "Internal",
  cloud: "Cloud",
  partner: "Partner",
}

export default function ProvidersPage() {
  const { data: providers, isLoading } = useProviders()
  const [search, setSearch] = useState("")
  const [kindFilter, setKindFilter] = useState<string>("all")

  const filtered = useMemo(() => {
    if (!providers) return []
    return providers.filter((p) => {
      const matchesSearch =
        !search ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.providerType.toLowerCase().includes(search.toLowerCase())
      const matchesKind = kindFilter === "all" || p.providerKind === kindFilter
      return matchesSearch && matchesKind
    })
  }, [providers, search, kindFilter])

  const statusCounts = useMemo(() => {
    if (!providers) return { active: 0, degraded: 0, total: 0 }
    return {
      active: providers.filter(
        (p) => p.status === "active" || p.status === "running"
      ).length,
      degraded: providers.filter(
        (p) => p.status === "degraded" || p.status === "error"
      ).length,
      total: providers.length,
    }
  }, [providers])

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader
        plane="infra"
        title="Infrastructure Providers"
        description="All infrastructure providers — cloud, on-prem, and partner"
      />

      {/* Summary metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Total Providers"
          value={statusCounts.total}
          plane="infra"
        />
        <MetricCard
          label="Active"
          value={statusCounts.active}
          plane="infra"
        />
        <MetricCard
          label="Degraded / Error"
          value={statusCounts.degraded}
          plane="infra"
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search providers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All kinds" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            <SelectItem value="internal">Internal</SelectItem>
            <SelectItem value="cloud">Cloud</SelectItem>
            <SelectItem value="partner">Partner</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Provider grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((provider) => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}
          {filtered.length === 0 && (
            <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
              No providers match the current filters.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ProviderCard({ provider }: { provider: Provider }) {
  return (
    <Link
      to={`/infra/providers/${provider.slug}`}
      className="block rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <ProviderTypeIcon type={provider.providerType} className="h-6 w-6" />
          <div className="min-w-0">
            <h3 className="truncate font-medium">{provider.name}</h3>
            <p className="text-xs text-muted-foreground">
              {provider.providerType}
            </p>
          </div>
        </div>
        <StatusBadge status={provider.status} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <div>
          <span className="text-muted-foreground">Kind: </span>
          <span>{KIND_LABELS[provider.providerKind] ?? provider.providerKind}</span>
        </div>
        {provider.url && (
          <div>
            <span className="text-muted-foreground">URL: </span>
            <span className="truncate">{provider.url}</span>
          </div>
        )}
      </div>
    </Link>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/modules/factory.infra/components/provider-type-icon.tsx \
       "ui/src/modules/factory.infra/(app)/(dashboard)/infra/providers/page.tsx"
git commit -m "feat(infra-ui): add Provider Overview page with grid, filters, and status metrics"
```

---

### Task 2: Provider Detail — `infra/providers/[slug]/page.tsx`

**Files:**
- Create: `ui/src/modules/factory.infra/(app)/(dashboard)/infra/providers/[slug]/page.tsx`

- [ ] **Step 1: Create the Provider Detail page**

```tsx
// ui/src/modules/factory.infra/(app)/(dashboard)/infra/providers/[slug]/page.tsx
import { Link, useParams } from "react-router"
import { useMemo } from "react"

import { Button } from "@rio.js/ui/button"
import { Skeleton } from "@rio.js/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rio.js/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@rio.js/ui/tabs"
import { Icon } from "@rio.js/ui/icon"

import {
  PlaneHeader,
  StatusBadge,
  MetricCard,
  EntityCard,
} from "@/components/factory"
import {
  useProvider,
  useClusters,
  useHosts,
  useVMs,
  useRegions,
} from "@/lib/infra"

import { ProviderTypeIcon } from "../../../../components/provider-type-icon"

export default function ProviderDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: provider, isLoading: providerLoading } = useProvider(slug)
  const { data: clusters } = useClusters({ providerId: provider?.id })
  const { data: hosts } = useHosts({ providerId: provider?.id })
  const { data: vms } = useVMs({ providerId: provider?.id })
  const { data: regions } = useRegions({ providerId: provider?.id })

  if (providerLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (!provider) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground">Provider not found.</p>
        <Button variant="link" asChild>
          <Link to="/infra/providers">Back to Providers</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <ProviderTypeIcon type={provider.providerType} className="h-8 w-8" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{provider.name}</h1>
              <StatusBadge status={provider.status} />
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {provider.providerType} &middot; {provider.providerKind}
              {provider.url && (
                <>
                  {" "}&middot;{" "}
                  <a
                    href={provider.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    {provider.url}
                  </a>
                </>
              )}
            </p>
          </div>
        </div>
        <Button variant="outline" asChild>
          <Link to="/infra/providers">
            <Icon icon="icon-[ph--arrow-left-duotone]" className="mr-1.5 h-4 w-4" />
            All Providers
          </Link>
        </Button>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <MetricCard
          label="Clusters"
          value={clusters?.length ?? 0}
          plane="infra"
        />
        <MetricCard
          label="Hosts"
          value={hosts?.length ?? 0}
          plane="infra"
        />
        <MetricCard
          label="VMs"
          value={vms?.length ?? 0}
          plane="infra"
        />
        <MetricCard
          label="Regions"
          value={regions?.length ?? 0}
          plane="infra"
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="clusters">
        <TabsList>
          <TabsTrigger value="clusters">
            Clusters ({clusters?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="hosts">
            Hosts ({hosts?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="vms">
            VMs ({vms?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="regions">
            Regions ({regions?.length ?? 0})
          </TabsTrigger>
        </TabsList>

        {/* Clusters tab */}
        <TabsContent value="clusters" className="mt-4">
          {clusters && clusters.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {clusters.map((cluster) => (
                <EntityCard
                  key={cluster.id}
                  name={cluster.name}
                  status={cluster.status}
                  href={`/infra/clusters/${cluster.slug}`}
                  metadata={[
                    {
                      label: "Created",
                      value: new Date(cluster.createdAt).toLocaleDateString(),
                    },
                  ]}
                />
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No clusters on this provider.
            </p>
          )}
        </TabsContent>

        {/* Hosts tab */}
        <TabsContent value="hosts" className="mt-4">
          {hosts && hosts.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>OS</TableHead>
                  <TableHead>CPU</TableHead>
                  <TableHead>Memory</TableHead>
                  <TableHead>Disk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hosts.map((host) => (
                  <TableRow key={host.id}>
                    <TableCell className="font-medium">{host.name}</TableCell>
                    <TableCell>
                      <StatusBadge status={host.status} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {host.ipAddress ?? "—"}
                    </TableCell>
                    <TableCell>{host.osType}</TableCell>
                    <TableCell>{host.cpuCores} cores</TableCell>
                    <TableCell>
                      {Math.round(host.memoryMb / 1024)} GB
                    </TableCell>
                    <TableCell>{host.diskGb} GB</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No hosts on this provider.
            </p>
          )}
        </TabsContent>

        {/* VMs tab */}
        <TabsContent value="vms" className="mt-4">
          {vms && vms.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>CPU</TableHead>
                  <TableHead>Memory</TableHead>
                  <TableHead>Disk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vms.map((vm) => (
                  <TableRow key={vm.id}>
                    <TableCell className="font-medium">{vm.name}</TableCell>
                    <TableCell>
                      <StatusBadge status={vm.status} />
                    </TableCell>
                    <TableCell>{vm.vmType}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {vm.ipAddress ?? "—"}
                    </TableCell>
                    <TableCell>{vm.cpu} vCPU</TableCell>
                    <TableCell>
                      {Math.round(vm.memoryMb / 1024)} GB
                    </TableCell>
                    <TableCell>{vm.diskGb} GB</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No VMs on this provider.
            </p>
          )}
        </TabsContent>

        {/* Regions tab */}
        <TabsContent value="regions" className="mt-4">
          {regions && regions.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {regions.map((region) => (
                <div
                  key={region.id}
                  className="rounded-lg border bg-card p-4"
                >
                  <h3 className="font-medium">
                    {region.displayName || region.name}
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {region.country && (
                      <div>
                        <span className="text-muted-foreground">Country: </span>
                        <span>{region.country}</span>
                      </div>
                    )}
                    {region.city && (
                      <div>
                        <span className="text-muted-foreground">City: </span>
                        <span>{region.city}</span>
                      </div>
                    )}
                    {region.timezone && (
                      <div>
                        <span className="text-muted-foreground">TZ: </span>
                        <span>{region.timezone}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No regions for this provider.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add "ui/src/modules/factory.infra/(app)/(dashboard)/infra/providers/[slug]/page.tsx"
git commit -m "feat(infra-ui): add Provider Detail page with clusters, hosts, VMs, regions tabs"
```

---

### Task 3: Cluster Dashboard — `infra/clusters/page.tsx`

**Files:**
- Create: `ui/src/modules/factory.infra/(app)/(dashboard)/infra/clusters/page.tsx`

- [ ] **Step 1: Create the Cluster Dashboard page**

```tsx
// ui/src/modules/factory.infra/(app)/(dashboard)/infra/clusters/page.tsx
import { Link } from "react-router"
import { useState, useMemo } from "react"

import { Input } from "@rio.js/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rio.js/ui/select"
import { Skeleton } from "@rio.js/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rio.js/ui/table"

import { PlaneHeader, StatusBadge, MetricCard } from "@/components/factory"
import { useClusters, useProviders } from "@/lib/infra"

export default function ClustersPage() {
  const { data: clusters, isLoading } = useClusters()
  const { data: providers } = useProviders()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  // Build a providerId -> name map for display
  const providerMap = useMemo(() => {
    const m = new Map<string, string>()
    providers?.forEach((p) => m.set(p.id, p.name))
    return m
  }, [providers])

  const filtered = useMemo(() => {
    if (!clusters) return []
    return clusters.filter((c) => {
      const matchesSearch =
        !search || c.name.toLowerCase().includes(search.toLowerCase())
      const matchesStatus =
        statusFilter === "all" || c.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [clusters, search, statusFilter])

  const statusCounts = useMemo(() => {
    if (!clusters) return { active: 0, total: 0 }
    return {
      active: clusters.filter(
        (c) => c.status === "active" || c.status === "running" || c.status === "ready"
      ).length,
      total: clusters.length,
    }
  }, [clusters])

  const uniqueStatuses = useMemo(() => {
    if (!clusters) return []
    return [...new Set(clusters.map((c) => c.status))].sort()
  }, [clusters])

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader
        plane="infra"
        title="Clusters"
        description="All Kubernetes and compute clusters across providers"
      />

      {/* Summary metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Total Clusters"
          value={statusCounts.total}
          plane="infra"
        />
        <MetricCard
          label="Active"
          value={statusCounts.active}
          plane="infra"
        />
        <MetricCard
          label="Providers"
          value={providers?.length ?? 0}
          plane="infra"
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search clusters..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {uniqueStatuses.map((s) => (
              <SelectItem key={s} value={s}>
                {s.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Clusters table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((cluster) => (
              <TableRow key={cluster.id}>
                <TableCell>
                  <Link
                    to={`/infra/clusters/${cluster.slug}`}
                    className="font-medium text-blue-400 hover:underline"
                  >
                    {cluster.name}
                  </Link>
                </TableCell>
                <TableCell>
                  {providerMap.get(cluster.providerId) ?? cluster.providerId}
                </TableCell>
                <TableCell>
                  <StatusBadge status={cluster.status} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(cluster.createdAt).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-8 text-center text-muted-foreground"
                >
                  No clusters match the current filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add "ui/src/modules/factory.infra/(app)/(dashboard)/infra/clusters/page.tsx"
git commit -m "feat(infra-ui): add Cluster Dashboard page with table, search, and status filter"
```

---

### Task 4: Cluster Detail — `infra/clusters/[slug]/page.tsx`

**Files:**
- Create: `ui/src/modules/factory.infra/(app)/(dashboard)/infra/clusters/[slug]/page.tsx`

- [ ] **Step 1: Create the Cluster Detail page**

```tsx
// ui/src/modules/factory.infra/(app)/(dashboard)/infra/clusters/[slug]/page.tsx
import { Link, useParams } from "react-router"
import { useMemo } from "react"

import { Button } from "@rio.js/ui/button"
import { Skeleton } from "@rio.js/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rio.js/ui/table"
import { Icon } from "@rio.js/ui/icon"

import {
  PlaneHeader,
  StatusBadge,
  MetricCard,
  HealthGauge,
} from "@/components/factory"
import { useCluster, useKubeNodes, useProvider } from "@/lib/infra"

export default function ClusterDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: cluster, isLoading: clusterLoading } = useCluster(slug)
  const { data: nodes } = useKubeNodes({
    clusterId: cluster?.id,
  })
  const { data: provider } = useProvider(cluster?.providerId)

  const roleCounts = useMemo(() => {
    if (!nodes) return { control: 0, worker: 0, total: 0 }
    return {
      control: nodes.filter(
        (n) => n.role === "control-plane" || n.role === "master"
      ).length,
      worker: nodes.filter((n) => n.role === "worker").length,
      total: nodes.length,
    }
  }, [nodes])

  const healthyNodes = useMemo(() => {
    if (!nodes) return 0
    return nodes.filter(
      (n) => n.status === "ready" || n.status === "active" || n.status === "running"
    ).length
  }, [nodes])

  if (clusterLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (!cluster) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground">Cluster not found.</p>
        <Button variant="link" asChild>
          <Link to="/infra/clusters">Back to Clusters</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Icon
              icon="icon-[ph--cube-duotone]"
              className="h-6 w-6 text-blue-400"
            />
            <h1 className="text-xl font-semibold">{cluster.name}</h1>
            <StatusBadge status={cluster.status} />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Provider:{" "}
            {provider ? (
              <Link
                to={`/infra/providers/${provider.slug}`}
                className="text-blue-400 hover:underline"
              >
                {provider.name}
              </Link>
            ) : (
              cluster.providerId
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled>
            <Icon
              icon="icon-[ph--arrow-circle-up-duotone]"
              className="mr-1.5 h-4 w-4"
            />
            Upgrade
          </Button>
          <Button variant="outline" size="sm" disabled>
            <Icon
              icon="icon-[ph--plus-circle-duotone]"
              className="mr-1.5 h-4 w-4"
            />
            Add Node
          </Button>
          <Button variant="outline" asChild>
            <Link to="/infra/clusters">
              <Icon
                icon="icon-[ph--arrow-left-duotone]"
                className="mr-1.5 h-4 w-4"
              />
              All Clusters
            </Link>
          </Button>
        </div>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <MetricCard
          label="Total Nodes"
          value={roleCounts.total}
          plane="infra"
        />
        <MetricCard
          label="Control Plane"
          value={roleCounts.control}
          plane="infra"
        />
        <MetricCard
          label="Workers"
          value={roleCounts.worker}
          plane="infra"
        />
        <MetricCard
          label="Healthy Nodes"
          value={`${healthyNodes} / ${roleCounts.total}`}
          plane="infra"
        />
      </div>

      {/* Node health gauge */}
      {roleCounts.total > 0 && (
        <div className="max-w-md">
          <HealthGauge
            label="Node Health"
            value={healthyNodes}
            max={roleCounts.total}
            unit="nodes"
          />
        </div>
      )}

      {/* Nodes table */}
      <div>
        <h2 className="mb-3 text-lg font-medium">Nodes</h2>
        {nodes && nodes.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>IP Address</TableHead>
                <TableHead>VM</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nodes.map((node) => (
                <TableRow key={node.id}>
                  <TableCell className="font-medium">{node.name}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                      {node.role}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={node.status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {node.ipAddress}
                  </TableCell>
                  <TableCell>
                    {node.vmId ? (
                      <span className="text-xs text-muted-foreground">
                        {node.vmId}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(node.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No nodes registered for this cluster.
          </p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add "ui/src/modules/factory.infra/(app)/(dashboard)/infra/clusters/[slug]/page.tsx"
git commit -m "feat(infra-ui): add Cluster Detail page with nodes table, health gauge, and actions"
```

---

### Task 5: Host & VM Inventory — `infra/hosts/page.tsx`

**Files:**
- Create: `ui/src/modules/factory.infra/(app)/(dashboard)/infra/hosts/page.tsx`

- [ ] **Step 1: Create the Host & VM Inventory page**

```tsx
// ui/src/modules/factory.infra/(app)/(dashboard)/infra/hosts/page.tsx
import { useState, useMemo } from "react"

import { Input } from "@rio.js/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rio.js/ui/select"
import { Skeleton } from "@rio.js/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rio.js/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@rio.js/ui/tabs"

import { PlaneHeader, StatusBadge, MetricCard } from "@/components/factory"
import { useHosts, useVMs, useProviders } from "@/lib/infra"
import type { Host, VM } from "@/lib/infra"

export default function HostsPage() {
  const { data: hosts, isLoading: hostsLoading } = useHosts()
  const { data: vms, isLoading: vmsLoading } = useVMs()
  const { data: providers } = useProviders()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [providerFilter, setProviderFilter] = useState<string>("all")

  const providerMap = useMemo(() => {
    const m = new Map<string, string>()
    providers?.forEach((p) => m.set(p.id, p.name))
    return m
  }, [providers])

  const filteredHosts = useMemo(() => {
    if (!hosts) return []
    return hosts.filter((h) => {
      const matchesSearch =
        !search ||
        h.name.toLowerCase().includes(search.toLowerCase()) ||
        h.ipAddress?.toLowerCase().includes(search.toLowerCase())
      const matchesStatus =
        statusFilter === "all" || h.status === statusFilter
      const matchesProvider =
        providerFilter === "all" || h.providerId === providerFilter
      return matchesSearch && matchesStatus && matchesProvider
    })
  }, [hosts, search, statusFilter, providerFilter])

  const filteredVMs = useMemo(() => {
    if (!vms) return []
    return vms.filter((v) => {
      const matchesSearch =
        !search ||
        v.name.toLowerCase().includes(search.toLowerCase()) ||
        v.ipAddress?.toLowerCase().includes(search.toLowerCase())
      const matchesStatus =
        statusFilter === "all" || v.status === statusFilter
      const matchesProvider =
        providerFilter === "all" || v.providerId === providerFilter
      return matchesSearch && matchesStatus && matchesProvider
    })
  }, [vms, search, statusFilter, providerFilter])

  const totalCpu = useMemo(() => {
    const hostCpu = (hosts ?? []).reduce((s, h) => s + h.cpuCores, 0)
    const vmCpu = (vms ?? []).reduce((s, v) => s + v.cpu, 0)
    return { hosts: hostCpu, vms: vmCpu }
  }, [hosts, vms])

  const totalMemGb = useMemo(() => {
    const hostMem = (hosts ?? []).reduce(
      (s, h) => s + Math.round(h.memoryMb / 1024),
      0
    )
    const vmMem = (vms ?? []).reduce(
      (s, v) => s + Math.round(v.memoryMb / 1024),
      0
    )
    return { hosts: hostMem, vms: vmMem }
  }, [hosts, vms])

  // Collect unique statuses across both hosts and VMs for filter
  const allStatuses = useMemo(() => {
    const statuses = new Set<string>()
    hosts?.forEach((h) => statuses.add(h.status))
    vms?.forEach((v) => statuses.add(v.status))
    return [...statuses].sort()
  }, [hosts, vms])

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader
        plane="infra"
        title="Host & VM Inventory"
        description="All bare-metal hosts and virtual machines across providers"
      />

      {/* Summary metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <MetricCard
          label="Total Hosts"
          value={hosts?.length ?? 0}
          plane="infra"
        />
        <MetricCard
          label="Total VMs"
          value={vms?.length ?? 0}
          plane="infra"
        />
        <MetricCard
          label="Host CPU Cores"
          value={totalCpu.hosts}
          unit="cores"
          plane="infra"
        />
        <MetricCard
          label="Host Memory"
          value={totalMemGb.hosts}
          unit="GB"
          plane="infra"
        />
      </div>

      {/* Shared filters */}
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search by name or IP..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {allStatuses.map((s) => (
              <SelectItem key={s} value={s}>
                {s.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {providers && providers.length > 0 && (
          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All providers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All providers</SelectItem>
              {providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="hosts">
        <TabsList>
          <TabsTrigger value="hosts">
            Hosts ({filteredHosts.length})
          </TabsTrigger>
          <TabsTrigger value="vms">
            VMs ({filteredVMs.length})
          </TabsTrigger>
        </TabsList>

        {/* Hosts tab */}
        <TabsContent value="hosts" className="mt-4">
          {hostsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>OS</TableHead>
                  <TableHead>CPU</TableHead>
                  <TableHead>Memory</TableHead>
                  <TableHead>Disk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredHosts.map((host) => (
                  <TableRow key={host.id}>
                    <TableCell className="font-medium">{host.name}</TableCell>
                    <TableCell>
                      {providerMap.get(host.providerId) ?? host.providerId}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={host.status} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {host.ipAddress ?? "—"}
                    </TableCell>
                    <TableCell>{host.osType}</TableCell>
                    <TableCell>{host.cpuCores} cores</TableCell>
                    <TableCell>
                      {Math.round(host.memoryMb / 1024)} GB
                    </TableCell>
                    <TableCell>{host.diskGb} GB</TableCell>
                  </TableRow>
                ))}
                {filteredHosts.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-8 text-center text-muted-foreground"
                    >
                      No hosts match the current filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        {/* VMs tab */}
        <TabsContent value="vms" className="mt-4">
          {vmsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>OS</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>CPU</TableHead>
                  <TableHead>Memory</TableHead>
                  <TableHead>Disk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredVMs.map((vm) => (
                  <TableRow key={vm.id}>
                    <TableCell className="font-medium">{vm.name}</TableCell>
                    <TableCell>
                      {providerMap.get(vm.providerId) ?? vm.providerId}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={vm.status} />
                    </TableCell>
                    <TableCell>{vm.vmType}</TableCell>
                    <TableCell>{vm.osType}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {vm.ipAddress ?? "—"}
                    </TableCell>
                    <TableCell>{vm.cpu} vCPU</TableCell>
                    <TableCell>
                      {Math.round(vm.memoryMb / 1024)} GB
                    </TableCell>
                    <TableCell>{vm.diskGb} GB</TableCell>
                  </TableRow>
                ))}
                {filteredVMs.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="py-8 text-center text-muted-foreground"
                    >
                      No VMs match the current filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add "ui/src/modules/factory.infra/(app)/(dashboard)/infra/hosts/page.tsx"
git commit -m "feat(infra-ui): add Host & VM Inventory page with dual tabs, search, and provider filter"
```

---

### Task 6: Network Topology — `infra/network/page.tsx`

**Files:**
- Create: `ui/src/modules/factory.infra/components/subnet-row.tsx`
- Create: `ui/src/modules/factory.infra/(app)/(dashboard)/infra/network/page.tsx`

- [ ] **Step 1: Create the expandable subnet row component**

```tsx
// ui/src/modules/factory.infra/components/subnet-row.tsx
import { useState } from "react"

import { Button } from "@rio.js/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rio.js/ui/table"
import { Icon } from "@rio.js/ui/icon"

import { StatusBadge } from "@/components/factory"
import { useIpAddresses } from "@/lib/infra"
import type { Subnet } from "@/lib/infra"

interface SubnetRowProps {
  subnet: Subnet
}

export function SubnetRow({ subnet }: SubnetRowProps) {
  const [expanded, setExpanded] = useState(false)
  const { data: ips, isLoading } = useIpAddresses(
    expanded ? { subnetId: subnet.id } : undefined
  )

  const allocatedCount = ips?.filter((ip) => ip.status === "allocated" || ip.status === "assigned").length ?? 0
  const totalIps = ips?.length ?? 0

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-accent/50"
        onClick={() => setExpanded(!expanded)}
      >
        <TableCell>
          <div className="flex items-center gap-2">
            <Icon
              icon={
                expanded
                  ? "icon-[ph--caret-down-duotone]"
                  : "icon-[ph--caret-right-duotone]"
              }
              className="h-4 w-4 text-muted-foreground"
            />
            <span className="font-mono font-medium">{subnet.cidr}</span>
          </div>
        </TableCell>
        <TableCell>
          {subnet.vlanId != null ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
              VLAN {subnet.vlanId}
              {subnet.vlanName && ` (${subnet.vlanName})`}
            </span>
          ) : (
            "—"
          )}
        </TableCell>
        <TableCell>{subnet.subnetType}</TableCell>
        <TableCell className="font-mono text-xs">
          {subnet.gateway ?? "—"}
        </TableCell>
        <TableCell>{subnet.description ?? "—"}</TableCell>
        <TableCell>
          {expanded && totalIps > 0 ? (
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-blue-500"
                  style={{
                    width: `${totalIps > 0 ? (allocatedCount / totalIps) * 100 : 0}%`,
                  }}
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {allocatedCount}/{totalIps}
              </span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">
              {expanded ? "—" : "Expand to view"}
            </span>
          )}
        </TableCell>
      </TableRow>

      {/* Expanded IP address sub-table */}
      {expanded && (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/30 p-0">
            <div className="px-8 py-3">
              {isLoading ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Loading IP addresses...
                </p>
              ) : ips && ips.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Address</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Hostname</TableHead>
                      <TableHead>FQDN</TableHead>
                      <TableHead>Assigned To</TableHead>
                      <TableHead>Purpose</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ips.map((ip) => (
                      <TableRow key={ip.id}>
                        <TableCell className="font-mono text-xs">
                          {ip.address}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={ip.status} />
                        </TableCell>
                        <TableCell className="text-xs">
                          {ip.hostname ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {ip.fqdn ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {ip.assignedToType
                            ? `${ip.assignedToType}: ${ip.assignedToId}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {ip.purpose ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No IP addresses in this subnet.
                </p>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
```

- [ ] **Step 2: Create the Network Topology page**

```tsx
// ui/src/modules/factory.infra/(app)/(dashboard)/infra/network/page.tsx
import { useState, useMemo } from "react"

import { Input } from "@rio.js/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rio.js/ui/select"
import { Skeleton } from "@rio.js/ui/skeleton"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@rio.js/ui/table"

import { PlaneHeader, MetricCard } from "@/components/factory"
import { useSubnets } from "@/lib/infra"

import { SubnetRow } from "../../../components/subnet-row"

export default function NetworkPage() {
  const { data: subnets, isLoading } = useSubnets()
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<string>("all")

  const filtered = useMemo(() => {
    if (!subnets) return []
    return subnets.filter((s) => {
      const matchesSearch =
        !search ||
        s.cidr.includes(search) ||
        s.vlanName?.toLowerCase().includes(search.toLowerCase()) ||
        s.description?.toLowerCase().includes(search.toLowerCase())
      const matchesType =
        typeFilter === "all" || s.subnetType === typeFilter
      return matchesSearch && matchesType
    })
  }, [subnets, search, typeFilter])

  const subnetTypes = useMemo(() => {
    if (!subnets) return []
    return [...new Set(subnets.map((s) => s.subnetType))].sort()
  }, [subnets])

  const vlanCount = useMemo(() => {
    if (!subnets) return 0
    return new Set(
      subnets.filter((s) => s.vlanId != null).map((s) => s.vlanId)
    ).size
  }, [subnets])

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader
        plane="infra"
        title="Network Topology"
        description="Subnets, VLANs, and IP address management"
      />

      {/* Summary metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Total Subnets"
          value={subnets?.length ?? 0}
          plane="infra"
        />
        <MetricCard
          label="VLANs"
          value={vlanCount}
          plane="infra"
        />
        <MetricCard
          label="Subnet Types"
          value={subnetTypes.length}
          plane="infra"
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search by CIDR, VLAN, or description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        {subnetTypes.length > 0 && (
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {subnetTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Subnets table with expandable rows */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>CIDR</TableHead>
              <TableHead>VLAN</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Gateway</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Utilization</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((subnet) => (
              <SubnetRow key={subnet.id} subnet={subnet} />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No subnets match the current filters.
                </td>
              </tr>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/modules/factory.infra/components/subnet-row.tsx \
       "ui/src/modules/factory.infra/(app)/(dashboard)/infra/network/page.tsx"
git commit -m "feat(infra-ui): add Network Topology page with expandable subnet rows and IP allocations"
```

---

### Task 7: Proxmox Cluster View — `infra/proxmox/page.tsx`

**Files:**
- Create: `ui/src/modules/factory.infra/(app)/(dashboard)/infra/proxmox/page.tsx`

- [ ] **Step 1: Create the Proxmox Cluster View page**

```tsx
// ui/src/modules/factory.infra/(app)/(dashboard)/infra/proxmox/page.tsx
import { useMemo } from "react"

import { Skeleton } from "@rio.js/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rio.js/ui/table"
import { Icon } from "@rio.js/ui/icon"

import {
  PlaneHeader,
  StatusBadge,
  MetricCard,
  EmptyState,
} from "@/components/factory"
import { useProxmoxClusters, useVMs } from "@/lib/infra"
import type { ProxmoxCluster, VM } from "@/lib/infra"

export default function ProxmoxPage() {
  const { data: clusters, isLoading } = useProxmoxClusters()
  const { data: allVMs } = useVMs()

  // Group VMs by proxmoxClusterId
  const vmsByCluster = useMemo(() => {
    const m = new Map<string, VM[]>()
    allVMs?.forEach((vm) => {
      if (vm.proxmoxClusterId) {
        const existing = m.get(vm.proxmoxClusterId) ?? []
        existing.push(vm)
        m.set(vm.proxmoxClusterId, existing)
      }
    })
    return m
  }, [allVMs])

  const syncedCount = useMemo(() => {
    if (!clusters) return 0
    return clusters.filter((c) => c.syncStatus === "synced" || c.syncStatus === "active").length
  }, [clusters])

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (!clusters || clusters.length === 0) {
    return (
      <div className="space-y-6 p-6">
        <PlaneHeader
          plane="infra"
          title="Proxmox Clusters"
          description="Proxmox Virtual Environment cluster management"
        />
        <EmptyState
          icon="icon-[ph--cpu-duotone]"
          title="No Proxmox Clusters"
          description="No Proxmox clusters have been registered yet. Add a Proxmox provider and configure cluster sync to get started."
        />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader
        plane="infra"
        title="Proxmox Clusters"
        description="Proxmox Virtual Environment cluster management and sync status"
      />

      {/* Summary metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Total Clusters"
          value={clusters.length}
          plane="infra"
        />
        <MetricCard
          label="Synced"
          value={syncedCount}
          plane="infra"
        />
        <MetricCard
          label="Proxmox VMs"
          value={[...vmsByCluster.values()].reduce(
            (s, vms) => s + vms.length,
            0
          )}
          plane="infra"
        />
      </div>

      {/* Cluster cards */}
      <div className="space-y-6">
        {clusters.map((cluster) => (
          <ProxmoxClusterCard
            key={cluster.id}
            cluster={cluster}
            vms={vmsByCluster.get(cluster.id) ?? []}
          />
        ))}
      </div>
    </div>
  )
}

function ProxmoxClusterCard({
  cluster,
  vms,
}: {
  cluster: ProxmoxCluster
  vms: VM[]
}) {
  return (
    <div className="rounded-lg border bg-card">
      {/* Cluster header */}
      <div className="flex items-start justify-between border-b p-4">
        <div>
          <div className="flex items-center gap-2">
            <Icon
              icon="icon-[ph--cpu-duotone]"
              className="h-5 w-5 text-orange-400"
            />
            <h3 className="font-medium">{cluster.name}</h3>
            <SyncStatusBadge status={cluster.syncStatus} />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              API: {cluster.apiHost}:{cluster.apiPort}
            </span>
            {cluster.lastSyncAt && (
              <span>
                Last sync:{" "}
                {new Date(cluster.lastSyncAt).toLocaleString()}
              </span>
            )}
          </div>
          {cluster.syncError && (
            <p className="mt-2 rounded bg-red-500/10 px-2 py-1 text-xs text-red-500">
              Sync error: {cluster.syncError}
            </p>
          )}
        </div>
        <span className="text-sm text-muted-foreground">
          {vms.length} VM{vms.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* VMs table */}
      {vms.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>VM Name</TableHead>
              <TableHead>VMID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>OS</TableHead>
              <TableHead>CPU</TableHead>
              <TableHead>Memory</TableHead>
              <TableHead>IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vms.map((vm) => (
              <TableRow key={vm.id}>
                <TableCell className="font-medium">{vm.name}</TableCell>
                <TableCell className="font-mono text-xs">
                  {vm.proxmoxVmid ?? "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge status={vm.status} />
                </TableCell>
                <TableCell>{vm.osType}</TableCell>
                <TableCell>{vm.cpu} vCPU</TableCell>
                <TableCell>
                  {Math.round(vm.memoryMb / 1024)} GB
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {vm.ipAddress ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No VMs found for this Proxmox cluster.
        </p>
      )}
    </div>
  )
}

function SyncStatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    synced: "bg-emerald-500/10 text-emerald-500",
    active: "bg-emerald-500/10 text-emerald-500",
    syncing: "bg-blue-500/10 text-blue-500",
    error: "bg-red-500/10 text-red-500",
    failed: "bg-red-500/10 text-red-500",
    pending: "bg-zinc-500/10 text-zinc-500",
  }

  const dotMap: Record<string, string> = {
    synced: "bg-emerald-500",
    active: "bg-emerald-500",
    syncing: "bg-blue-500 animate-pulse",
    error: "bg-red-500",
    failed: "bg-red-500",
    pending: "bg-zinc-500",
  }

  const color = colorMap[status] ?? "bg-zinc-500/10 text-zinc-500"
  const dot = dotMap[status] ?? "bg-zinc-500"

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      {status}
    </span>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add "ui/src/modules/factory.infra/(app)/(dashboard)/infra/proxmox/page.tsx"
git commit -m "feat(infra-ui): add Proxmox Cluster View page with sync status and VM tables"
```

---

### Task 8: Resource Utilization — `infra/utilization/page.tsx`

**Files:**
- Create: `ui/src/modules/factory.infra/components/utilization-bar.tsx`
- Create: `ui/src/modules/factory.infra/(app)/(dashboard)/infra/utilization/page.tsx`

- [ ] **Step 1: Create the utilization bar component**

A simple Tailwind-only horizontal bar for per-provider resource breakdown.

```tsx
// ui/src/modules/factory.infra/components/utilization-bar.tsx
import { cn } from "@rio.js/ui/lib/utils"

interface UtilizationBarProps {
  label: string
  value: number
  max: number
  unit?: string
  className?: string
}

function getBarColor(pct: number): string {
  if (pct >= 90) return "bg-red-500"
  if (pct >= 75) return "bg-amber-500"
  if (pct >= 50) return "bg-blue-500"
  return "bg-emerald-500"
}

export function UtilizationBar({
  label,
  value,
  max,
  unit = "",
  className,
}: UtilizationBarProps) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {value.toLocaleString()}
          {unit ? ` ${unit}` : ""} / {max.toLocaleString()}
          {unit ? ` ${unit}` : ""} ({pct}%)
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            getBarColor(pct)
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the Resource Utilization page**

```tsx
// ui/src/modules/factory.infra/(app)/(dashboard)/infra/utilization/page.tsx
import { useMemo } from "react"

import { Skeleton } from "@rio.js/ui/skeleton"

import {
  PlaneHeader,
  MetricCard,
  HealthGauge,
} from "@/components/factory"
import { useHosts, useVMs, useProviders } from "@/lib/infra"
import type { Host, VM, Provider } from "@/lib/infra"

import { UtilizationBar } from "../../../components/utilization-bar"

interface ResourceTotals {
  cpuCores: number
  memoryGb: number
  diskGb: number
  count: number
}

function sumHosts(hosts: Host[]): ResourceTotals {
  return hosts.reduce(
    (acc, h) => ({
      cpuCores: acc.cpuCores + h.cpuCores,
      memoryGb: acc.memoryGb + Math.round(h.memoryMb / 1024),
      diskGb: acc.diskGb + h.diskGb,
      count: acc.count + 1,
    }),
    { cpuCores: 0, memoryGb: 0, diskGb: 0, count: 0 }
  )
}

function sumVMs(vms: VM[]): ResourceTotals {
  return vms.reduce(
    (acc, v) => ({
      cpuCores: acc.cpuCores + v.cpu,
      memoryGb: acc.memoryGb + Math.round(v.memoryMb / 1024),
      diskGb: acc.diskGb + v.diskGb,
      count: acc.count + 1,
    }),
    { cpuCores: 0, memoryGb: 0, diskGb: 0, count: 0 }
  )
}

export default function UtilizationPage() {
  const { data: hosts, isLoading: hostsLoading } = useHosts()
  const { data: vms, isLoading: vmsLoading } = useVMs()
  const { data: providers } = useProviders()

  const isLoading = hostsLoading || vmsLoading

  // Aggregate totals
  const hostTotals = useMemo(
    () => sumHosts(hosts ?? []),
    [hosts]
  )
  const vmTotals = useMemo(
    () => sumVMs(vms ?? []),
    [vms]
  )

  // Per-provider breakdown
  const perProvider = useMemo(() => {
    if (!providers || !hosts || !vms) return []

    return providers.map((provider) => {
      const providerHosts = hosts.filter((h) => h.providerId === provider.id)
      const providerVMs = vms.filter((v) => v.providerId === provider.id)
      return {
        provider,
        hosts: sumHosts(providerHosts),
        vms: sumVMs(providerVMs),
      }
    })
  }, [providers, hosts, vms])

  return (
    <div className="space-y-6 p-6">
      <PlaneHeader
        plane="infra"
        title="Resource Utilization"
        description="Cross-provider resource usage — CPU, memory, and storage"
      />

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          {/* Aggregate metrics */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <MetricCard
              label="Host CPU"
              value={hostTotals.cpuCores}
              unit="cores"
              plane="infra"
            />
            <MetricCard
              label="Host Memory"
              value={hostTotals.memoryGb}
              unit="GB"
              plane="infra"
            />
            <MetricCard
              label="Host Disk"
              value={hostTotals.diskGb}
              unit="GB"
              plane="infra"
            />
            <MetricCard
              label="VM CPU"
              value={vmTotals.cpuCores}
              unit="vCPU"
              plane="infra"
            />
            <MetricCard
              label="VM Memory"
              value={vmTotals.memoryGb}
              unit="GB"
              plane="infra"
            />
            <MetricCard
              label="VM Disk"
              value={vmTotals.diskGb}
              unit="GB"
              plane="infra"
            />
          </div>

          {/* Overall utilization gauges (VM allocation vs host capacity) */}
          <div>
            <h2 className="mb-3 text-lg font-medium">
              VM Allocation vs Host Capacity
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              How much of your bare-metal host capacity is allocated to VMs.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <HealthGauge
                label="CPU Allocation"
                value={vmTotals.cpuCores}
                max={hostTotals.cpuCores || 1}
                unit="cores"
              />
              <HealthGauge
                label="Memory Allocation"
                value={vmTotals.memoryGb}
                max={hostTotals.memoryGb || 1}
                unit="GB"
              />
              <HealthGauge
                label="Disk Allocation"
                value={vmTotals.diskGb}
                max={hostTotals.diskGb || 1}
                unit="GB"
              />
            </div>
          </div>

          {/* Per-provider breakdown */}
          {perProvider.length > 0 && (
            <div>
              <h2 className="mb-3 text-lg font-medium">
                Per-Provider Breakdown
              </h2>
              <div className="space-y-6">
                {perProvider.map(({ provider, hosts: pH, vms: pV }) => (
                  <div
                    key={provider.id}
                    className="rounded-lg border bg-card p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="font-medium">{provider.name}</h3>
                      <span className="text-xs text-muted-foreground">
                        {pH.count} host{pH.count !== 1 ? "s" : ""}, {pV.count}{" "}
                        VM{pV.count !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="space-y-3">
                      <UtilizationBar
                        label="CPU"
                        value={pV.cpuCores}
                        max={pH.cpuCores || pV.cpuCores || 1}
                        unit="cores"
                      />
                      <UtilizationBar
                        label="Memory"
                        value={pV.memoryGb}
                        max={pH.memoryGb || pV.memoryGb || 1}
                        unit="GB"
                      />
                      <UtilizationBar
                        label="Disk"
                        value={pV.diskGb}
                        max={pH.diskGb || pV.diskGb || 1}
                        unit="GB"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/modules/factory.infra/components/utilization-bar.tsx \
       "ui/src/modules/factory.infra/(app)/(dashboard)/infra/utilization/page.tsx"
git commit -m "feat(infra-ui): add Resource Utilization page with aggregate gauges and per-provider bars"
```

---

### Task 9: Certificates & Secrets — `infra/certs/page.tsx`

**Files:**
- Create: `ui/src/modules/factory.infra/(app)/(dashboard)/infra/certs/page.tsx`

- [ ] **Step 1: Create the Certificates & Secrets placeholder page**

```tsx
// ui/src/modules/factory.infra/(app)/(dashboard)/infra/certs/page.tsx
import { PlaneHeader, EmptyState } from "@/components/factory"

export default function CertsPage() {
  return (
    <div className="space-y-6 p-6">
      <PlaneHeader
        plane="infra"
        title="Certificates & Secrets"
        description="TLS certificate inventory, expiry tracking, and secret management"
      />

      <EmptyState
        icon="icon-[ph--shield-check-duotone]"
        title="Coming Soon"
        description="Certificate and secret management is not yet available. This screen will provide TLS certificate inventory with expiry tracking, automated renewal status, and secret rotation management across all infrastructure providers."
      />

      <div className="mx-auto max-w-lg rounded-lg border bg-card p-6">
        <h3 className="mb-2 font-medium">Planned Features</h3>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="mt-1 block h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
            TLS certificate inventory across all clusters and domains
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 block h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
            Expiry timeline with 30/14/7-day warning thresholds
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 block h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
            Let's Encrypt / cert-manager integration status
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 block h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
            Secret rotation tracking and audit log
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 block h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
            Wildcard certificate management
          </li>
        </ul>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add "ui/src/modules/factory.infra/(app)/(dashboard)/infra/certs/page.tsx"
git commit -m "feat(infra-ui): add Certificates & Secrets placeholder page"
```

---

## Manifest Update

After all tasks are complete, update the `factory.infra` manifest to include routes for all screens.

- [ ] **Update `ui/src/modules/factory.infra/manifest.json`**

Ensure the `contributes.routes` array includes:

```json
{
  "id": "factory.infra",
  "displayName": "Factory Infra",
  "description": "Infrastructure management — providers, clusters, hosts, VMs, networks",
  "version": "0.0.1",
  "publisher": "factory",
  "engines": { "rio": ">=0.0.1" },
  "category": "platform",
  "tags": ["infra", "providers", "clusters", "hosts"],
  "categories": ["operations"],
  "main": "extension.ts",
  "module": {
    "sidebar": {
      "icon": "icon-[ph--hard-drives-duotone]",
      "label": "Infra",
      "order": 20
    },
    "routePrefix": "/infra"
  },
  "contributes": {
    "routes": [
      {
        "id": "factory.infra.route.home",
        "displayName": "Infra",
        "path": "/(root)/(app)/infra/"
      },
      {
        "id": "factory.infra.route.providers",
        "displayName": "Providers",
        "path": "/(root)/(app)/infra/providers/"
      },
      {
        "id": "factory.infra.route.provider-detail",
        "displayName": "Provider Detail",
        "path": "/(root)/(app)/infra/providers/:slug/"
      },
      {
        "id": "factory.infra.route.clusters",
        "displayName": "Clusters",
        "path": "/(root)/(app)/infra/clusters/"
      },
      {
        "id": "factory.infra.route.cluster-detail",
        "displayName": "Cluster Detail",
        "path": "/(root)/(app)/infra/clusters/:slug/"
      },
      {
        "id": "factory.infra.route.hosts",
        "displayName": "Hosts & VMs",
        "path": "/(root)/(app)/infra/hosts/"
      },
      {
        "id": "factory.infra.route.network",
        "displayName": "Network",
        "path": "/(root)/(app)/infra/network/"
      },
      {
        "id": "factory.infra.route.proxmox",
        "displayName": "Proxmox",
        "path": "/(root)/(app)/infra/proxmox/"
      },
      {
        "id": "factory.infra.route.utilization",
        "displayName": "Utilization",
        "path": "/(root)/(app)/infra/utilization/"
      },
      {
        "id": "factory.infra.route.certs",
        "displayName": "Certificates",
        "path": "/(root)/(app)/infra/certs/"
      }
    ]
  }
}
```

- [ ] **Commit**

```bash
git add ui/src/modules/factory.infra/manifest.json
git commit -m "feat(infra-ui): update manifest with routes for all 8 infra screens"
```
