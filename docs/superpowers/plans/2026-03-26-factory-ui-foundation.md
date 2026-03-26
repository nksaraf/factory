# Factory UI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the shared design system, plane color tokens, ambient health system, shared dashboard components, and extension scaffolding for Factory Fleet and Infra plane UIs.

**Architecture:** Each Factory plane (Fleet, Infra, etc.) is a Rio.js extension module registered in `entry.client.tsx`. Shared dashboard components live in `ui/src/components/factory/` and are imported by all plane modules. Plane-specific color tokens are CSS custom properties in `globals.css`. The ambient health system uses CSS classes that vary background/border/glow based on entity health status.

**Tech Stack:** React 19, Tailwind CSS 3, Rio.js extensions, @rio.js/ui (shadcn-style), Iconify (Phosphor duotone), TypeScript

---

## File Structure

### New Files
- `ui/src/globals-factory.css` — Plane color tokens + ambient health CSS
- `ui/src/components/factory/status-badge.tsx` — Status badge with plane-aware coloring
- `ui/src/components/factory/metric-card.tsx` — Number + trend sparkline card
- `ui/src/components/factory/health-gauge.tsx` — CPU/mem/disk gauge visualization
- `ui/src/components/factory/entity-card.tsx` — Clickable card for entity lists
- `ui/src/components/factory/data-table.tsx` — Sortable, filterable table for entity lists
- `ui/src/components/factory/timeline-view.tsx` — Vertical timeline for rollouts/incidents
- `ui/src/components/factory/empty-state.tsx` — Plane-themed empty state
- `ui/src/components/factory/plane-header.tsx` — Page header with plane accent color
- `ui/src/components/factory/index.ts` — Barrel export
- `ui/src/modules/factory.fleet/manifest.json` — Fleet extension manifest
- `ui/src/modules/factory.fleet/index.ts` — Fleet extension entry
- `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/page.tsx` — Fleet home/redirect
- `ui/src/modules/factory.infra/manifest.json` — Infra extension manifest
- `ui/src/modules/factory.infra/index.ts` — Infra extension entry
- `ui/src/modules/factory.infra/(app)/(dashboard)/infra/page.tsx` — Infra home/redirect
- `ui/src/lib/infra/api.ts` — Infra API fetch wrapper
- `ui/src/lib/infra/types.ts` — Infra domain types
- `ui/src/lib/infra/use-infra.ts` — Infra React Query hooks
- `ui/src/lib/infra/index.ts` — Barrel export

### Modified Files
- `ui/src/globals.css` — Import `globals-factory.css`
- `ui/src/entry.client.tsx` — Register and enable factory.fleet + factory.infra extensions

---

### Task 1: Plane Color Tokens & Ambient Health CSS

**Files:**
- Create: `ui/src/globals-factory.css`
- Modify: `ui/src/globals.css`

- [ ] **Step 1: Create the plane color tokens file**

```css
/* globals-factory.css — Factory plane design tokens & ambient health system */

/* ═══════════════════════════════════════════════════════════════════════════
   PLANE COLOR TOKENS
   Each plane gets a primary hue used for accents, borders, badges, and glows.
   ═══════════════════════════════════════════════════════════════════════════ */

:root {
  /* Product Plane — creative studio, warm purple */
  --plane-product: 271 81% 76%;       /* #b794f4 */
  --plane-product-dim: 271 40% 30%;
  --plane-product-glow: 271 81% 76% / 0.15;

  /* Build Plane — industrial, amber/copper */
  --plane-build: 38 62% 58%;          /* #d9a94f */
  --plane-build-dim: 38 30% 25%;
  --plane-build-glow: 38 62% 58% / 0.15;

  /* Fleet Plane — mission control, teal/cyan */
  --plane-fleet: 174 60% 60%;         /* #4fd1c5 */
  --plane-fleet-dim: 174 30% 25%;
  --plane-fleet-glow: 174 60% 60% / 0.15;

  /* Infra Plane — server room, cool blue */
  --plane-infra: 212 100% 67%;        /* #58a6ff */
  --plane-infra-dim: 212 40% 28%;
  --plane-infra-glow: 212 100% 67% / 0.15;

  /* Agent Plane — bot army, green */
  --plane-agent: 145 49% 62%;         /* #68d391 */
  --plane-agent-dim: 145 25% 25%;
  --plane-agent-glow: 145 49% 62% / 0.15;

  /* Commerce Plane — trading floor, emerald */
  --plane-commerce: 145 48% 52%;      /* #48bb78 */
  --plane-commerce-dim: 145 25% 22%;
  --plane-commerce-glow: 145 48% 52% / 0.15;
}

/* ═══════════════════════════════════════════════════════════════════════════
   AMBIENT HEALTH SYSTEM
   Apply [data-health] to any container to shift its visual mood.
   Values: "healthy" | "warning" | "critical" | "unknown"
   ═══════════════════════════════════════════════════════════════════════════ */

[data-health="healthy"] {
  --health-accent: 145 70% 50%;
  --health-bg: 145 70% 50% / 0.04;
  --health-border: 145 70% 50% / 0.15;
}

[data-health="warning"] {
  --health-accent: 38 92% 60%;
  --health-bg: 38 92% 60% / 0.06;
  --health-border: 38 92% 60% / 0.2;
}

[data-health="critical"] {
  --health-accent: 0 72% 60%;
  --health-bg: 0 72% 60% / 0.06;
  --health-border: 0 72% 60% / 0.25;
}

[data-health="unknown"] {
  --health-accent: 0 0% 50%;
  --health-bg: 0 0% 50% / 0.04;
  --health-border: 0 0% 50% / 0.1;
}

/* ═══════════════════════════════════════════════════════════════════════════
   STATUS BADGE VARIANTS
   ═══════════════════════════════════════════════════════════════════════════ */

.status-running, .status-active, .status-ready, .status-succeeded, .status-production {
  --status-color: 145 70% 50%;
}
.status-provisioning, .status-pending, .status-draft, .status-staging, .status-in_progress {
  --status-color: 212 80% 60%;
}
.status-degraded, .status-warning, .status-maintenance, .status-suspended {
  --status-color: 38 92% 60%;
}
.status-failed, .status-error, .status-critical, .status-offline, .status-destroyed, .status-decommissioned {
  --status-color: 0 72% 60%;
}
.status-stopped, .status-unknown, .status-idle, .status-paused {
  --status-color: 0 0% 50%;
}
```

- [ ] **Step 2: Import in globals.css**

Add this line at the end of `ui/src/globals.css`:

```css
@import "./globals-factory.css";
```

- [ ] **Step 3: Verify the import works**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/prague && pnpm --filter ui dev`
Expected: Dev server starts without CSS errors.

- [ ] **Step 4: Commit**

```bash
git add ui/src/globals-factory.css ui/src/globals.css
git commit -m "feat(ui): add Factory plane color tokens and ambient health CSS"
```

---

### Task 2: StatusBadge Component

**Files:**
- Create: `ui/src/components/factory/status-badge.tsx`

- [ ] **Step 1: Create the StatusBadge component**

```tsx
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@rio.js/ui/lib/utils"

const statusVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      status: {
        running: "bg-emerald-500/10 text-emerald-500",
        active: "bg-emerald-500/10 text-emerald-500",
        ready: "bg-emerald-500/10 text-emerald-500",
        succeeded: "bg-emerald-500/10 text-emerald-500",
        production: "bg-emerald-500/10 text-emerald-500",
        provisioning: "bg-blue-500/10 text-blue-500",
        pending: "bg-blue-500/10 text-blue-500",
        draft: "bg-blue-500/10 text-blue-500",
        staging: "bg-blue-500/10 text-blue-500",
        in_progress: "bg-blue-500/10 text-blue-500",
        degraded: "bg-amber-500/10 text-amber-500",
        warning: "bg-amber-500/10 text-amber-500",
        maintenance: "bg-amber-500/10 text-amber-500",
        suspended: "bg-amber-500/10 text-amber-500",
        failed: "bg-red-500/10 text-red-500",
        error: "bg-red-500/10 text-red-500",
        critical: "bg-red-500/10 text-red-500",
        offline: "bg-red-500/10 text-red-500",
        destroyed: "bg-red-500/10 text-red-500",
        decommissioned: "bg-red-500/10 text-red-500",
        stopped: "bg-zinc-500/10 text-zinc-500",
        unknown: "bg-zinc-500/10 text-zinc-500",
        idle: "bg-zinc-500/10 text-zinc-500",
        paused: "bg-zinc-500/10 text-zinc-500",
        rolled_back: "bg-amber-500/10 text-amber-500",
        superseded: "bg-zinc-500/10 text-zinc-500",
      },
    },
    defaultVariants: { status: "unknown" },
  }
)

type StatusValue = NonNullable<VariantProps<typeof statusVariants>["status"]>

const DOT_COLORS: Record<string, string> = {
  running: "bg-emerald-500",
  active: "bg-emerald-500",
  ready: "bg-emerald-500",
  succeeded: "bg-emerald-500",
  production: "bg-emerald-500",
  provisioning: "bg-blue-500 animate-pulse",
  pending: "bg-blue-500 animate-pulse",
  draft: "bg-blue-500",
  staging: "bg-blue-500",
  in_progress: "bg-blue-500 animate-pulse",
  degraded: "bg-amber-500 animate-pulse",
  warning: "bg-amber-500",
  maintenance: "bg-amber-500",
  suspended: "bg-amber-500",
  failed: "bg-red-500",
  error: "bg-red-500",
  critical: "bg-red-500 animate-pulse",
  offline: "bg-red-500",
  destroyed: "bg-red-500",
  decommissioned: "bg-red-500",
  stopped: "bg-zinc-500",
  unknown: "bg-zinc-500",
  idle: "bg-zinc-500",
  paused: "bg-zinc-500",
  rolled_back: "bg-amber-500",
  superseded: "bg-zinc-500",
}

interface StatusBadgeProps {
  status: string
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const normalized = status.toLowerCase().replace(/-/g, "_") as StatusValue
  const dotColor = DOT_COLORS[normalized] ?? "bg-zinc-500"

  return (
    <span className={cn(statusVariants({ status: normalized }), className)}>
      <span className={cn("inline-block h-1.5 w-1.5 rounded-full", dotColor)} />
      {status.replace(/_/g, " ")}
    </span>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/src/components/factory/status-badge.tsx
git commit -m "feat(ui): add StatusBadge component for entity status display"
```

---

### Task 3: MetricCard Component

**Files:**
- Create: `ui/src/components/factory/metric-card.tsx`

- [ ] **Step 1: Create the MetricCard component**

```tsx
import { cn } from "@rio.js/ui/lib/utils"

interface MetricCardProps {
  label: string
  value: string | number
  change?: number
  unit?: string
  plane?: "product" | "build" | "fleet" | "infra" | "agent" | "commerce"
  className?: string
}

const PLANE_BORDER: Record<string, string> = {
  product: "border-l-purple-400/40",
  build: "border-l-amber-400/40",
  fleet: "border-l-teal-400/40",
  infra: "border-l-blue-400/40",
  agent: "border-l-green-400/40",
  commerce: "border-l-emerald-400/40",
}

export function MetricCard({
  label,
  value,
  change,
  unit,
  plane,
  className,
}: MetricCardProps) {
  const borderClass = plane ? PLANE_BORDER[plane] : "border-l-transparent"

  return (
    <div
      className={cn(
        "rounded-lg border border-l-2 bg-card p-4",
        borderClass,
        className
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tracking-tight">{value}</span>
        {unit && (
          <span className="text-sm text-muted-foreground">{unit}</span>
        )}
      </div>
      {change != null && (
        <p
          className={cn(
            "mt-1 text-xs font-medium",
            change > 0
              ? "text-emerald-500"
              : change < 0
                ? "text-red-500"
                : "text-muted-foreground"
          )}
        >
          {change > 0 ? "+" : ""}
          {change}%
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/src/components/factory/metric-card.tsx
git commit -m "feat(ui): add MetricCard component for dashboard metrics"
```

---

### Task 4: HealthGauge Component

**Files:**
- Create: `ui/src/components/factory/health-gauge.tsx`

- [ ] **Step 1: Create the HealthGauge component**

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add ui/src/components/factory/health-gauge.tsx
git commit -m "feat(ui): add HealthGauge component for resource utilization"
```

---

### Task 5: EntityCard, PlaneHeader, EmptyState, TimelineView

**Files:**
- Create: `ui/src/components/factory/entity-card.tsx`
- Create: `ui/src/components/factory/plane-header.tsx`
- Create: `ui/src/components/factory/empty-state.tsx`
- Create: `ui/src/components/factory/timeline-view.tsx`

- [ ] **Step 1: Create EntityCard**

```tsx
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
```

- [ ] **Step 2: Create PlaneHeader**

```tsx
import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"

type Plane = "product" | "build" | "fleet" | "infra" | "agent" | "commerce"

const PLANE_CONFIG: Record<Plane, { color: string; icon: string }> = {
  product: { color: "text-purple-400", icon: "icon-[ph--paint-brush-duotone]" },
  build: { color: "text-amber-400", icon: "icon-[ph--gear-duotone]" },
  fleet: { color: "text-teal-400", icon: "icon-[ph--rocket-launch-duotone]" },
  infra: { color: "text-blue-400", icon: "icon-[ph--hard-drives-duotone]" },
  agent: { color: "text-green-400", icon: "icon-[ph--robot-duotone]" },
  commerce: { color: "text-emerald-400", icon: "icon-[ph--storefront-duotone]" },
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
        <Icon icon={config.icon} className={cn("h-6 w-6", config.color)} />
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
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
```

- [ ] **Step 3: Create EmptyState**

```tsx
import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"

interface EmptyStateProps {
  icon?: string
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({
  icon = "icon-[ph--empty-duotone]",
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 text-center",
        className
      )}
    >
      <Icon
        icon={icon}
        className="mb-4 h-12 w-12 text-muted-foreground/50"
      />
      <h3 className="font-medium">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
```

- [ ] **Step 4: Create TimelineView**

```tsx
import { cn } from "@rio.js/ui/lib/utils"

interface TimelineEntry {
  id: string
  label: string
  timestamp: string
  status?: "complete" | "active" | "pending" | "error"
  description?: string
}

interface TimelineViewProps {
  entries: TimelineEntry[]
  className?: string
}

const DOT_STYLES: Record<string, string> = {
  complete: "bg-emerald-500",
  active: "bg-blue-500 animate-pulse",
  pending: "bg-zinc-400",
  error: "bg-red-500",
}

export function TimelineView({ entries, className }: TimelineViewProps) {
  return (
    <div className={cn("relative space-y-0", className)}>
      {entries.map((entry, i) => (
        <div key={entry.id} className="relative flex gap-3 pb-6 last:pb-0">
          {/* Vertical line */}
          {i < entries.length - 1 && (
            <div className="absolute left-[7px] top-4 h-full w-px bg-border" />
          )}
          {/* Dot */}
          <div
            className={cn(
              "relative mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-background",
              DOT_STYLES[entry.status ?? "pending"]
            )}
          />
          {/* Content */}
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium">{entry.label}</span>
              <span className="text-xs text-muted-foreground">
                {entry.timestamp}
              </span>
            </div>
            {entry.description && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {entry.description}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/factory/entity-card.tsx ui/src/components/factory/plane-header.tsx ui/src/components/factory/empty-state.tsx ui/src/components/factory/timeline-view.tsx
git commit -m "feat(ui): add EntityCard, PlaneHeader, EmptyState, TimelineView components"
```

---

### Task 6: Barrel Export

**Files:**
- Create: `ui/src/components/factory/index.ts`

- [ ] **Step 1: Create barrel export**

```typescript
export { StatusBadge } from "./status-badge"
export { MetricCard } from "./metric-card"
export { HealthGauge } from "./health-gauge"
export { EntityCard } from "./entity-card"
export { PlaneHeader } from "./plane-header"
export { EmptyState } from "./empty-state"
export { TimelineView } from "./timeline-view"
```

- [ ] **Step 2: Commit**

```bash
git add ui/src/components/factory/index.ts
git commit -m "feat(ui): add barrel export for factory dashboard components"
```

---

### Task 7: Infra API Client Library

**Files:**
- Create: `ui/src/lib/infra/api.ts`
- Create: `ui/src/lib/infra/types.ts`
- Create: `ui/src/lib/infra/use-infra.ts`
- Create: `ui/src/lib/infra/index.ts`

- [ ] **Step 1: Create the infra fetch wrapper**

```typescript
// ui/src/lib/infra/api.ts
import { rio } from "../rio"

function getBaseUrl(): string {
  return `${rio.env.PUBLIC_FACTORY_API_URL ?? "http://localhost:3000"}/infra`
}

function getAuthToken(): string | null {
  return localStorage.getItem("jwt") ?? localStorage.getItem("bearer_token")
}

export async function infraFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const baseUrl = getBaseUrl()
  const token = getAuthToken()

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const response = await fetch(`${baseUrl}${path}`, { ...options, headers })

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: response.statusText }))
    throw new Error(
      error.error || `Infra API request failed: ${response.status}`
    )
  }

  return response.json()
}
```

- [ ] **Step 2: Create the infra domain types**

```typescript
// ui/src/lib/infra/types.ts

export interface Provider {
  id: string
  name: string
  slug: string
  providerType: string
  url: string | null
  status: string
  providerKind: string
  createdAt: string
}

export interface Cluster {
  id: string
  name: string
  slug: string
  providerId: string
  status: string
  kubeconfigRef: string | null
  createdAt: string
}

export interface Region {
  id: string
  name: string
  displayName: string
  slug: string
  country: string | null
  city: string | null
  timezone: string | null
  providerId: string | null
  createdAt: string
}

export interface Datacenter {
  id: string
  name: string
  displayName: string
  slug: string
  regionId: string
  availabilityZone: string | null
  address: string | null
  createdAt: string
}

export interface Host {
  id: string
  name: string
  slug: string
  hostname: string | null
  providerId: string
  datacenterId: string | null
  ipAddress: string | null
  ipmiAddress: string | null
  status: string
  osType: string
  accessMethod: string
  cpuCores: number
  memoryMb: number
  diskGb: number
  rackLocation: string | null
  createdAt: string
}

export interface VM {
  id: string
  name: string
  slug: string
  providerId: string
  datacenterId: string | null
  hostId: string | null
  clusterId: string | null
  proxmoxClusterId: string | null
  proxmoxVmid: number | null
  vmType: string
  status: string
  osType: string
  accessMethod: string
  accessUser: string | null
  cpu: number
  memoryMb: number
  diskGb: number
  ipAddress: string | null
  createdAt: string
}

export interface KubeNode {
  id: string
  name: string
  slug: string
  clusterId: string
  vmId: string | null
  role: string
  status: string
  ipAddress: string
  createdAt: string
}

export interface Subnet {
  id: string
  cidr: string
  gateway: string | null
  netmask: string | null
  vlanId: number | null
  vlanName: string | null
  datacenterId: string | null
  subnetType: string
  description: string | null
  dnsServers: string | null
  dnsDomain: string | null
  createdAt: string
}

export interface IpAddress {
  id: string
  address: string
  subnetId: string | null
  assignedToType: string | null
  assignedToId: string | null
  status: string
  hostname: string | null
  fqdn: string | null
  purpose: string | null
  createdAt: string
}

export interface ProxmoxCluster {
  id: string
  name: string
  slug: string
  providerId: string
  apiHost: string
  apiPort: number
  syncStatus: string
  lastSyncAt: string | null
  syncError: string | null
  createdAt: string
}
```

- [ ] **Step 3: Create the infra React Query hooks**

```typescript
// ui/src/lib/infra/use-infra.ts
import { useQuery } from "@tanstack/react-query"

import { infraFetch } from "./api"
import type {
  Cluster,
  Datacenter,
  Host,
  IpAddress,
  KubeNode,
  Provider,
  ProxmoxCluster,
  Region,
  Subnet,
  VM,
} from "./types"

interface SuccessResponse<T> {
  success: boolean
  data: T
}

const POLL_INTERVAL = 60_000

function buildQs(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v != null) qs.set(k, v)
  }
  const s = qs.toString()
  return s ? `?${s}` : ""
}

// --- Providers ---

export function useProviders(opts?: { status?: string }) {
  return useQuery<Provider[]>({
    queryKey: ["infra", "providers", opts],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<Provider[]>>(
        `/providers${buildQs(opts ?? {})}`
      )
      return res.data
    },
    refetchInterval: POLL_INTERVAL,
  })
}

export function useProvider(id: string | undefined) {
  return useQuery<Provider | null>({
    queryKey: ["infra", "provider", id],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<Provider>>(
        `/providers/${id}`
      )
      return res.data
    },
    enabled: !!id,
    refetchInterval: POLL_INTERVAL,
  })
}

// --- Clusters ---

export function useClusters(opts?: { providerId?: string; status?: string }) {
  return useQuery<Cluster[]>({
    queryKey: ["infra", "clusters", opts],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<Cluster[]>>(
        `/clusters${buildQs(opts ?? {})}`
      )
      return res.data
    },
    refetchInterval: POLL_INTERVAL,
  })
}

export function useCluster(id: string | undefined) {
  return useQuery<Cluster | null>({
    queryKey: ["infra", "cluster", id],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<Cluster>>(
        `/clusters/${id}`
      )
      return res.data
    },
    enabled: !!id,
    refetchInterval: POLL_INTERVAL,
  })
}

// --- Regions ---

export function useRegions(opts?: { providerId?: string }) {
  return useQuery<Region[]>({
    queryKey: ["infra", "regions", opts],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<Region[]>>(
        `/regions${buildQs(opts ?? {})}`
      )
      return res.data
    },
    refetchInterval: POLL_INTERVAL,
  })
}

// --- Datacenters ---

export function useDatacenters(opts?: { regionId?: string }) {
  return useQuery<Datacenter[]>({
    queryKey: ["infra", "datacenters", opts],
    queryFn: async () => {
      // Datacenters don't have a direct list endpoint with filters in the API,
      // we use regions endpoint and filter by regionId
      const res = await infraFetch<SuccessResponse<Datacenter[]>>(
        `/regions/${opts?.regionId}`
      )
      return res.data
    },
    enabled: !!opts?.regionId,
    refetchInterval: POLL_INTERVAL,
  })
}

// --- Hosts ---

export function useHosts(opts?: {
  providerId?: string
  datacenterId?: string
  status?: string
  osType?: string
}) {
  return useQuery<Host[]>({
    queryKey: ["infra", "hosts", opts],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<Host[]>>(
        `/hosts${buildQs(opts ?? {})}`
      )
      return res.data
    },
    refetchInterval: POLL_INTERVAL,
  })
}

export function useHost(id: string | undefined) {
  return useQuery<Host | null>({
    queryKey: ["infra", "host", id],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<Host>>(`/hosts/${id}`)
      return res.data
    },
    enabled: !!id,
    refetchInterval: POLL_INTERVAL,
  })
}

// --- VMs ---

export function useVMs(opts?: {
  providerId?: string
  status?: string
  hostId?: string
  clusterId?: string
  datacenterId?: string
  osType?: string
}) {
  return useQuery<VM[]>({
    queryKey: ["infra", "vms", opts],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<VM[]>>(
        `/vms${buildQs(opts ?? {})}`
      )
      return res.data
    },
    refetchInterval: POLL_INTERVAL,
  })
}

export function useVM(id: string | undefined) {
  return useQuery<VM | null>({
    queryKey: ["infra", "vm", id],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<VM>>(`/vms/${id}`)
      return res.data
    },
    enabled: !!id,
    refetchInterval: POLL_INTERVAL,
  })
}

// --- Kube Nodes ---

export function useKubeNodes(opts?: { clusterId?: string }) {
  return useQuery<KubeNode[]>({
    queryKey: ["infra", "kube-nodes", opts],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<KubeNode[]>>(
        `/kube-nodes${buildQs(opts ?? {})}`
      )
      return res.data
    },
    enabled: !!opts?.clusterId,
    refetchInterval: POLL_INTERVAL,
  })
}

// --- Subnets ---

export function useSubnets(opts?: {
  datacenterId?: string
  subnetType?: string
}) {
  return useQuery<Subnet[]>({
    queryKey: ["infra", "subnets", opts],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<Subnet[]>>(
        `/subnets${buildQs(opts ?? {})}`
      )
      return res.data
    },
    refetchInterval: POLL_INTERVAL,
  })
}

// --- IP Addresses ---

export function useIpAddresses(opts?: {
  subnetId?: string
  status?: string
  assignedToType?: string
}) {
  return useQuery<IpAddress[]>({
    queryKey: ["infra", "ips", opts],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<IpAddress[]>>(
        `/ips${buildQs(opts ?? {})}`
      )
      return res.data
    },
    refetchInterval: POLL_INTERVAL,
  })
}

// --- Proxmox Clusters ---

export function useProxmoxClusters(opts?: { providerId?: string }) {
  return useQuery<ProxmoxCluster[]>({
    queryKey: ["infra", "proxmox-clusters", opts],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<ProxmoxCluster[]>>(
        `/proxmox-clusters${buildQs(opts ?? {})}`
      )
      return res.data
    },
    refetchInterval: POLL_INTERVAL,
  })
}

// --- Assets (cross-type) ---

export function useInfraAssets() {
  return useQuery({
    queryKey: ["infra", "assets"],
    queryFn: async () => {
      const res = await infraFetch<SuccessResponse<unknown[]>>("/assets")
      return res.data
    },
    refetchInterval: POLL_INTERVAL,
  })
}
```

- [ ] **Step 4: Create barrel export**

```typescript
// ui/src/lib/infra/index.ts
export { infraFetch } from "./api"
export type {
  Cluster,
  Datacenter,
  Host,
  IpAddress,
  KubeNode,
  Provider,
  ProxmoxCluster,
  Region,
  Subnet,
  VM,
} from "./types"
export {
  useCluster,
  useClusters,
  useDatacenters,
  useHost,
  useHosts,
  useInfraAssets,
  useIpAddresses,
  useKubeNodes,
  useProvider,
  useProviders,
  useProxmoxClusters,
  useRegions,
  useSubnets,
  useVM,
  useVMs,
} from "./use-infra"
```

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/infra/
git commit -m "feat(ui): add Infra API client library with typed hooks"
```

---

### Task 8: Fleet Extension Module Scaffold

**Files:**
- Create: `ui/src/modules/factory.fleet/manifest.json`
- Create: `ui/src/modules/factory.fleet/index.ts`
- Create: `ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/page.tsx`

- [ ] **Step 1: Create the Fleet manifest**

```json
{
  "id": "factory.fleet",
  "displayName": "Factory Fleet",
  "description": "Fleet management — sites, deployments, releases, incidents",
  "version": "0.0.1",
  "publisher": "factory",
  "engines": { "rio": ">=0.0.1" },
  "category": "platform",
  "tags": ["fleet", "deployments", "releases"],
  "categories": ["operations"],
  "main": "extension.ts",
  "module": {
    "sidebar": {
      "icon": "icon-[ph--rocket-launch-duotone]",
      "label": "Fleet",
      "order": 10
    },
    "routePrefix": "/fleet"
  },
  "contributes": {
    "routes": [
      {
        "id": "factory.fleet.route.home",
        "displayName": "Fleet",
        "path": "/(root)/(app)/fleet/"
      },
      {
        "id": "factory.fleet.route.sites",
        "displayName": "Sites",
        "path": "/(root)/(app)/fleet/sites/"
      },
      {
        "id": "factory.fleet.route.site-detail",
        "displayName": "Site Detail",
        "path": "/(root)/(app)/fleet/sites/:slug/"
      },
      {
        "id": "factory.fleet.route.targets",
        "displayName": "Deployment Targets",
        "path": "/(root)/(app)/fleet/targets/"
      },
      {
        "id": "factory.fleet.route.target-detail",
        "displayName": "Target Detail",
        "path": "/(root)/(app)/fleet/targets/:slug/"
      },
      {
        "id": "factory.fleet.route.releases",
        "displayName": "Releases",
        "path": "/(root)/(app)/fleet/releases/"
      },
      {
        "id": "factory.fleet.route.rollouts",
        "displayName": "Rollouts",
        "path": "/(root)/(app)/fleet/rollouts/"
      },
      {
        "id": "factory.fleet.route.incidents",
        "displayName": "Incidents",
        "path": "/(root)/(app)/fleet/incidents/"
      },
      {
        "id": "factory.fleet.route.sandboxes",
        "displayName": "Sandboxes",
        "path": "/(root)/(app)/fleet/sandboxes/"
      },
      {
        "id": "factory.fleet.route.routes",
        "displayName": "Routes & Domains",
        "path": "/(root)/(app)/fleet/routes/"
      },
      {
        "id": "factory.fleet.route.workloads",
        "displayName": "Workload Inspector",
        "path": "/(root)/(app)/fleet/workloads/:id/"
      },
      {
        "id": "factory.fleet.route.drift",
        "displayName": "Drift Report",
        "path": "/(root)/(app)/fleet/drift/"
      },
      {
        "id": "factory.fleet.route.interventions",
        "displayName": "Intervention Log",
        "path": "/(root)/(app)/fleet/interventions/"
      },
      {
        "id": "factory.fleet.route.bundles",
        "displayName": "Release Bundles",
        "path": "/(root)/(app)/fleet/bundles/"
      }
    ],
    "sidebarGroups": [
      {
        "id": "factory.fleet.sidebar.group",
        "displayName": "Fleet",
        "icon": "icon-[ph--rocket-launch-duotone]",
        "group": "Fleet",
        "order": 10
      }
    ],
    "sidebarItems": [
      {
        "id": "factory.fleet.sidebar.sites",
        "displayName": "Fleet Map",
        "icon": "icon-[ph--globe-hemisphere-west-duotone]",
        "href": "/fleet/sites",
        "group": "factory.fleet.sidebar.group",
        "order": 1
      },
      {
        "id": "factory.fleet.sidebar.targets",
        "displayName": "Targets",
        "icon": "icon-[ph--crosshair-duotone]",
        "href": "/fleet/targets",
        "group": "factory.fleet.sidebar.group",
        "order": 2
      },
      {
        "id": "factory.fleet.sidebar.releases",
        "displayName": "Releases",
        "icon": "icon-[ph--package-duotone]",
        "href": "/fleet/releases",
        "group": "factory.fleet.sidebar.group",
        "order": 3
      },
      {
        "id": "factory.fleet.sidebar.rollouts",
        "displayName": "Rollouts",
        "icon": "icon-[ph--arrow-circle-up-duotone]",
        "href": "/fleet/rollouts",
        "group": "factory.fleet.sidebar.group",
        "order": 4
      },
      {
        "id": "factory.fleet.sidebar.incidents",
        "displayName": "Incidents",
        "icon": "icon-[ph--warning-diamond-duotone]",
        "href": "/fleet/incidents",
        "group": "factory.fleet.sidebar.group",
        "order": 5
      },
      {
        "id": "factory.fleet.sidebar.sandboxes",
        "displayName": "Sandboxes",
        "icon": "icon-[ph--terminal-window-duotone]",
        "href": "/fleet/sandboxes",
        "group": "factory.fleet.sidebar.group",
        "order": 6
      },
      {
        "id": "factory.fleet.sidebar.drift",
        "displayName": "Drift Report",
        "icon": "icon-[ph--git-diff-duotone]",
        "href": "/fleet/drift",
        "group": "factory.fleet.sidebar.group",
        "order": 7
      }
    ],
    "layouts": [],
    "views": [],
    "panels": [],
    "commands": [],
    "layerRenderers": [],
    "toolbarItems": [],
    "menus": []
  },
  "activationEvents": ["onStart"]
}
```

- [ ] **Step 2: Create the Fleet extension entry**

```typescript
// ui/src/modules/factory.fleet/index.ts
import { lazy } from "react"

import type { ExtensionManifest } from "@rio.js/client"

import manifest from "./manifest.json"

export const extension = {
  ...manifest,
  refs: {
    "factory.fleet.route.home": lazy(
      () => import("./(app)/(dashboard)/fleet/page")
    ),
    "factory.fleet.route.sites": lazy(
      () => import("./(app)/(dashboard)/fleet/sites/page")
    ),
    "factory.fleet.route.site-detail": lazy(
      () => import("./(app)/(dashboard)/fleet/sites/[slug]/page")
    ),
    "factory.fleet.route.targets": lazy(
      () => import("./(app)/(dashboard)/fleet/targets/page")
    ),
    "factory.fleet.route.target-detail": lazy(
      () => import("./(app)/(dashboard)/fleet/targets/[slug]/page")
    ),
    "factory.fleet.route.releases": lazy(
      () => import("./(app)/(dashboard)/fleet/releases/page")
    ),
    "factory.fleet.route.rollouts": lazy(
      () => import("./(app)/(dashboard)/fleet/rollouts/page")
    ),
    "factory.fleet.route.incidents": lazy(
      () => import("./(app)/(dashboard)/fleet/incidents/page")
    ),
    "factory.fleet.route.sandboxes": lazy(
      () => import("./(app)/(dashboard)/fleet/sandboxes/page")
    ),
    "factory.fleet.route.routes": lazy(
      () => import("./(app)/(dashboard)/fleet/routes/page")
    ),
    "factory.fleet.route.workloads": lazy(
      () => import("./(app)/(dashboard)/fleet/workloads/[id]/page")
    ),
    "factory.fleet.route.drift": lazy(
      () => import("./(app)/(dashboard)/fleet/drift/page")
    ),
    "factory.fleet.route.interventions": lazy(
      () => import("./(app)/(dashboard)/fleet/interventions/page")
    ),
    "factory.fleet.route.bundles": lazy(
      () => import("./(app)/(dashboard)/fleet/bundles/page")
    ),
  },
} satisfies ExtensionManifest
```

- [ ] **Step 3: Create Fleet home page (redirects to sites)**

```tsx
// ui/src/modules/factory.fleet/(app)/(dashboard)/fleet/page.tsx
import { Navigate } from "react-router"

export default function FleetHome() {
  return <Navigate to="/fleet/sites" replace />
}
```

- [ ] **Step 4: Commit**

```bash
git add ui/src/modules/factory.fleet/
git commit -m "feat(ui): scaffold factory.fleet extension module with manifest and routes"
```

---

### Task 9: Infra Extension Module Scaffold

**Files:**
- Create: `ui/src/modules/factory.infra/manifest.json`
- Create: `ui/src/modules/factory.infra/index.ts`
- Create: `ui/src/modules/factory.infra/(app)/(dashboard)/infra/page.tsx`

- [ ] **Step 1: Create the Infra manifest**

```json
{
  "id": "factory.infra",
  "displayName": "Factory Infrastructure",
  "description": "Infrastructure management — providers, clusters, hosts, VMs, networking",
  "version": "0.0.1",
  "publisher": "factory",
  "engines": { "rio": ">=0.0.1" },
  "category": "platform",
  "tags": ["infra", "clusters", "hosts", "networking"],
  "categories": ["infrastructure"],
  "main": "extension.ts",
  "module": {
    "sidebar": {
      "icon": "icon-[ph--hard-drives-duotone]",
      "label": "Infrastructure",
      "order": 11
    },
    "routePrefix": "/infra"
  },
  "contributes": {
    "routes": [
      {
        "id": "factory.infra.route.home",
        "displayName": "Infrastructure",
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
        "id": "factory.infra.route.host-detail",
        "displayName": "Host Detail",
        "path": "/(root)/(app)/infra/hosts/:slug/"
      },
      {
        "id": "factory.infra.route.vms",
        "displayName": "VMs",
        "path": "/(root)/(app)/infra/vms/"
      },
      {
        "id": "factory.infra.route.vm-detail",
        "displayName": "VM Detail",
        "path": "/(root)/(app)/infra/vms/:slug/"
      },
      {
        "id": "factory.infra.route.network",
        "displayName": "Network Topology",
        "path": "/(root)/(app)/infra/network/"
      },
      {
        "id": "factory.infra.route.nodes",
        "displayName": "Node Detail",
        "path": "/(root)/(app)/infra/clusters/:clusterId/nodes/:slug/"
      },
      {
        "id": "factory.infra.route.proxmox",
        "displayName": "Proxmox Clusters",
        "path": "/(root)/(app)/infra/proxmox/"
      },
      {
        "id": "factory.infra.route.utilization",
        "displayName": "Resource Utilization",
        "path": "/(root)/(app)/infra/utilization/"
      },
      {
        "id": "factory.infra.route.certs",
        "displayName": "Certificates & Secrets",
        "path": "/(root)/(app)/infra/certs/"
      }
    ],
    "sidebarGroups": [
      {
        "id": "factory.infra.sidebar.group",
        "displayName": "Infrastructure",
        "icon": "icon-[ph--hard-drives-duotone]",
        "group": "Infrastructure",
        "order": 11
      }
    ],
    "sidebarItems": [
      {
        "id": "factory.infra.sidebar.providers",
        "displayName": "Providers",
        "icon": "icon-[ph--cloud-duotone]",
        "href": "/infra/providers",
        "group": "factory.infra.sidebar.group",
        "order": 1
      },
      {
        "id": "factory.infra.sidebar.clusters",
        "displayName": "Clusters",
        "icon": "icon-[ph--circles-three-plus-duotone]",
        "href": "/infra/clusters",
        "group": "factory.infra.sidebar.group",
        "order": 2
      },
      {
        "id": "factory.infra.sidebar.hosts",
        "displayName": "Hosts & VMs",
        "icon": "icon-[ph--desktop-tower-duotone]",
        "href": "/infra/hosts",
        "group": "factory.infra.sidebar.group",
        "order": 3
      },
      {
        "id": "factory.infra.sidebar.network",
        "displayName": "Network",
        "icon": "icon-[ph--graph-duotone]",
        "href": "/infra/network",
        "group": "factory.infra.sidebar.group",
        "order": 4
      },
      {
        "id": "factory.infra.sidebar.proxmox",
        "displayName": "Proxmox",
        "icon": "icon-[ph--cube-duotone]",
        "href": "/infra/proxmox",
        "group": "factory.infra.sidebar.group",
        "order": 5
      },
      {
        "id": "factory.infra.sidebar.utilization",
        "displayName": "Utilization",
        "icon": "icon-[ph--chart-bar-duotone]",
        "href": "/infra/utilization",
        "group": "factory.infra.sidebar.group",
        "order": 6
      },
      {
        "id": "factory.infra.sidebar.certs",
        "displayName": "Certificates",
        "icon": "icon-[ph--shield-check-duotone]",
        "href": "/infra/certs",
        "group": "factory.infra.sidebar.group",
        "order": 7
      }
    ],
    "layouts": [],
    "views": [],
    "panels": [],
    "commands": [],
    "layerRenderers": [],
    "toolbarItems": [],
    "menus": []
  },
  "activationEvents": ["onStart"]
}
```

- [ ] **Step 2: Create the Infra extension entry**

```typescript
// ui/src/modules/factory.infra/index.ts
import { lazy } from "react"

import type { ExtensionManifest } from "@rio.js/client"

import manifest from "./manifest.json"

export const extension = {
  ...manifest,
  refs: {
    "factory.infra.route.home": lazy(
      () => import("./(app)/(dashboard)/infra/page")
    ),
    "factory.infra.route.providers": lazy(
      () => import("./(app)/(dashboard)/infra/providers/page")
    ),
    "factory.infra.route.provider-detail": lazy(
      () => import("./(app)/(dashboard)/infra/providers/[slug]/page")
    ),
    "factory.infra.route.clusters": lazy(
      () => import("./(app)/(dashboard)/infra/clusters/page")
    ),
    "factory.infra.route.cluster-detail": lazy(
      () => import("./(app)/(dashboard)/infra/clusters/[slug]/page")
    ),
    "factory.infra.route.hosts": lazy(
      () => import("./(app)/(dashboard)/infra/hosts/page")
    ),
    "factory.infra.route.host-detail": lazy(
      () => import("./(app)/(dashboard)/infra/hosts/[slug]/page")
    ),
    "factory.infra.route.vms": lazy(
      () => import("./(app)/(dashboard)/infra/vms/page")
    ),
    "factory.infra.route.vm-detail": lazy(
      () => import("./(app)/(dashboard)/infra/vms/[slug]/page")
    ),
    "factory.infra.route.network": lazy(
      () => import("./(app)/(dashboard)/infra/network/page")
    ),
    "factory.infra.route.nodes": lazy(
      () => import("./(app)/(dashboard)/infra/clusters/[clusterId]/nodes/[slug]/page")
    ),
    "factory.infra.route.proxmox": lazy(
      () => import("./(app)/(dashboard)/infra/proxmox/page")
    ),
    "factory.infra.route.utilization": lazy(
      () => import("./(app)/(dashboard)/infra/utilization/page")
    ),
    "factory.infra.route.certs": lazy(
      () => import("./(app)/(dashboard)/infra/certs/page")
    ),
  },
} satisfies ExtensionManifest
```

- [ ] **Step 3: Create Infra home page**

```tsx
// ui/src/modules/factory.infra/(app)/(dashboard)/infra/page.tsx
import { Navigate } from "react-router"

export default function InfraHome() {
  return <Navigate to="/infra/providers" replace />
}
```

- [ ] **Step 4: Commit**

```bash
git add ui/src/modules/factory.infra/
git commit -m "feat(ui): scaffold factory.infra extension module with manifest and routes"
```

---

### Task 10: Register Extensions in entry.client.tsx

**Files:**
- Modify: `ui/src/entry.client.tsx`

- [ ] **Step 1: Register factory.fleet and factory.infra**

In `entry.client.tsx`, inside `rio.extensions.register({...})`, add:

```typescript
"factory.fleet": () => import("./modules/factory.fleet"),
"factory.infra": () => import("./modules/factory.infra"),
```

- [ ] **Step 2: Enable the extensions**

In `entry.client.tsx`, inside `await rio.extensions.enable(...)`, add:

```typescript
"factory.fleet",
"factory.infra",
```

- [ ] **Step 3: Verify dev server loads without errors**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/prague && pnpm --filter ui dev`
Expected: Dev server starts, no import errors, new sidebar groups appear.

- [ ] **Step 4: Commit**

```bash
git add ui/src/entry.client.tsx
git commit -m "feat(ui): register and enable factory.fleet and factory.infra extensions"
```
