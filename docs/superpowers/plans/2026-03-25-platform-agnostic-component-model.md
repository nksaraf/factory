# Platform-Agnostic Component Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the component/workload/deployment model from Kubernetes-only to a platform-agnostic system supporting Kubernetes, Docker Compose, systemd, Windows services, IIS, and bare processes — all managed through the same API and CLI.

**Architecture:** The component model separates WHAT (intent-based component kinds) from WHERE (deployment target with runtime field) from HOW (pluggable runtime reconcilers). The `componentSpec.kind` enum changes from K8s resource types to intent types (`server`, `worker`, `task`, `scheduled`, `site`, `database`, `gateway`). The single `port` integer becomes a `ports` JSONB array supporting multiple named ports with protocols (http, grpc, tcp, etc.). The `deploymentTarget` gains a `runtime` field and optional `hostId`/`vmId` for direct host targeting. The `artifact` table gains a `kind` field to distinguish container images from binaries/packages. The reconciler becomes a dispatcher that routes to runtime-specific strategies. The `host` and `vm` tables gain `osType` and `accessMethod` fields.

**Tech Stack:** Drizzle ORM (PostgreSQL), Elysia (API), Vitest + PGlite (tests), TypeScript

---

## File Structure

### New Files

- `factory/api/src/reconciler/runtime-strategy.ts` — Runtime strategy interface + registry
- `factory/api/src/reconciler/strategies/kubernetes.ts` — K8s strategy (extracted from resource-generator)
- `factory/api/src/reconciler/strategies/compose.ts` — Docker Compose strategy (stub)
- `factory/api/src/reconciler/strategies/systemd.ts` — systemd strategy (stub)
- `factory/api/src/reconciler/strategies/windows.ts` — Windows service strategy (stub)
- `factory/api/src/reconciler/strategies/noop.ts` — No-op strategy for inventory-only targets
- `factory/api/src/__tests__/runtime-strategies.test.ts` — Tests for strategy dispatch + K8s strategy
- `factory/api/drizzle/0004_platform_agnostic_components.sql` — Migration for all schema changes

### Modified Files

- `factory/api/src/db/schema/product.ts` — componentSpec.kind enum change + `stateful` field
- `factory/api/src/db/schema/fleet.ts` — deploymentTarget adds `runtime`, `hostId`, `vmId`; workload adds `desiredArtifactUri`
- `factory/api/src/db/schema/build.ts` — artifact adds `kind` field
- `factory/api/src/db/schema/infra.ts` — host adds `osType`, `accessMethod`; vm adds `osType`, `accessMethod`, `accessUser`; drop `sshUser` column from vm
- `factory/shared/src/types.ts` — All TypeScript type updates
- `factory/api/src/reconciler/reconciler.ts` — Dispatch to runtime strategies instead of direct K8s
- `factory/api/src/reconciler/resource-generator.ts` — Update switch for new component kinds
- `factory/api/src/modules/infra/model.ts` — API model updates for osType, accessMethod
- `factory/api/src/modules/fleet/model.ts` — API model updates for runtime field
- `factory/api/src/services/infra/host.service.ts` — Accept/return osType
- `factory/api/src/services/infra/vm.service.ts` — Accept/return osType, accessMethod, accessUser; drop sshUser
- `factory/api/src/lib/id.ts` — No new prefixes needed (all existing entities)
- `factory/api/src/test-helpers.ts` — Add truncate for any new tables (none expected)
- `factory/api/src/__tests__/reconciler.test.ts` — Update seed data for new kinds + runtime field
- `factory/api/src/__tests__/resource-generator.test.ts` — Update test helpers and assertions for new component kinds
- `factory/api/src/__tests__/infra-services.test.ts` — Tests for osType/accessMethod

---

### Task 1: Migration — Schema Changes

**Files:**

- Create: `factory/api/drizzle/0004_platform_agnostic_components.sql`

This migration makes all the database-level changes in one atomic migration.

- [ ] **Step 1: Write the migration SQL**

```sql
-- 0004_platform_agnostic_components.sql
-- Platform-agnostic component model: new component kinds, runtime on deployment targets,
-- osType on hosts/VMs, artifact kinds

-- 1. Component kind: deployment→server, statefulset→server+stateful, job→task, cronjob→scheduled
--    Add new kinds first, then migrate data, then drop old constraint

-- Add stateful column to component_spec
ALTER TABLE factory_product.component_spec ADD COLUMN "stateful" boolean NOT NULL DEFAULT false;

-- Migrate existing kinds to new intent-based kinds
UPDATE factory_product.component_spec SET "stateful" = true WHERE kind = 'statefulset';
UPDATE factory_product.component_spec SET kind = 'server' WHERE kind IN ('deployment', 'statefulset');
UPDATE factory_product.component_spec SET kind = 'task' WHERE kind = 'job';
UPDATE factory_product.component_spec SET kind = 'scheduled' WHERE kind = 'cronjob';

-- Replace the kind check constraint
ALTER TABLE factory_product.component_spec DROP CONSTRAINT "component_spec_kind_valid";
ALTER TABLE factory_product.component_spec ADD CONSTRAINT "component_spec_kind_valid"
  CHECK (kind IN ('server', 'worker', 'task', 'scheduled', 'site', 'database', 'gateway'));

-- 1b. Component ports: replace single port integer with ports JSONB array
-- Format: [{ "name": "http", "port": 8080, "protocol": "http" }]
ALTER TABLE factory_product.component_spec ADD COLUMN "ports" jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Migrate existing port values into ports array
UPDATE factory_product.component_spec
  SET ports = jsonb_build_array(jsonb_build_object('name', 'default', 'port', port, 'protocol', 'http'))
  WHERE port IS NOT NULL;

-- Drop old port column
ALTER TABLE factory_product.component_spec DROP COLUMN "port";

-- Also migrate healthcheck_path to a more flexible healthcheck JSONB
-- Format: { "path": "/health", "port": "http", "protocol": "http" }
ALTER TABLE factory_product.component_spec ADD COLUMN "healthcheck" jsonb;

UPDATE factory_product.component_spec
  SET healthcheck = jsonb_build_object('path', healthcheck_path, 'portName', 'default', 'protocol', 'http')
  WHERE healthcheck_path IS NOT NULL;

ALTER TABLE factory_product.component_spec DROP COLUMN "healthcheck_path";

-- 2. Deployment target: add runtime, hostId, vmId
ALTER TABLE factory_fleet.deployment_target ADD COLUMN "runtime" text NOT NULL DEFAULT 'kubernetes';
ALTER TABLE factory_fleet.deployment_target ADD COLUMN "host_id" text REFERENCES factory_infra.host(host_id) ON DELETE SET NULL;
ALTER TABLE factory_fleet.deployment_target ADD COLUMN "vm_id" text REFERENCES factory_infra.vm(vm_id) ON DELETE SET NULL;

ALTER TABLE factory_fleet.deployment_target ADD CONSTRAINT "deployment_target_runtime_valid"
  CHECK (runtime IN ('kubernetes', 'compose', 'systemd', 'windows_service', 'iis', 'process'));

-- 3. Workload: add desired_artifact_uri for non-container artifacts
ALTER TABLE factory_fleet.workload ADD COLUMN "desired_artifact_uri" text;

-- 4. Artifact: add kind field
ALTER TABLE factory_build.artifact ADD COLUMN "kind" text NOT NULL DEFAULT 'container_image';
ALTER TABLE factory_build.artifact ADD CONSTRAINT "artifact_kind_valid"
  CHECK (kind IN ('container_image', 'binary', 'archive', 'package', 'bundle'));

-- 5. Host: add osType, accessMethod
ALTER TABLE factory_infra.host ADD COLUMN "os_type" text NOT NULL DEFAULT 'linux';
ALTER TABLE factory_infra.host ADD COLUMN "access_method" text NOT NULL DEFAULT 'ssh';

ALTER TABLE factory_infra.host ADD CONSTRAINT "host_os_type_valid"
  CHECK (os_type IN ('linux', 'windows'));
ALTER TABLE factory_infra.host ADD CONSTRAINT "host_access_method_valid"
  CHECK (access_method IN ('ssh', 'winrm', 'rdp'));

-- 6. VM: add osType, accessMethod, replace sshUser with accessUser, drop sshUser
ALTER TABLE factory_infra.vm ADD COLUMN "os_type" text NOT NULL DEFAULT 'linux';
ALTER TABLE factory_infra.vm ADD COLUMN "access_method" text NOT NULL DEFAULT 'ssh';
ALTER TABLE factory_infra.vm ADD COLUMN "access_user" text;

-- Migrate sshUser to accessUser, then drop the old column
UPDATE factory_infra.vm SET access_user = ssh_user WHERE ssh_user IS NOT NULL;
ALTER TABLE factory_infra.vm DROP COLUMN "ssh_user";

ALTER TABLE factory_infra.vm ADD CONSTRAINT "vm_os_type_valid"
  CHECK (os_type IN ('linux', 'windows'));
ALTER TABLE factory_infra.vm ADD CONSTRAINT "vm_access_method_valid"
  CHECK (access_method IN ('ssh', 'winrm', 'rdp'));
```

- [ ] **Step 2: Verify migration applies cleanly**

Run: `cd factory/api && npx drizzle-kit generate 2>&1 | head -20`

This confirms the file is in the right place. The actual migration runs in tests via PGlite. Note: hand-written migrations don't produce a Drizzle Kit meta snapshot — this is fine as the project uses hand-written SQL migrations. Do NOT run `drizzle-kit generate` to create a competing migration.

- [ ] **Step 3: Commit**

```bash
git add factory/api/drizzle/0004_platform_agnostic_components.sql
git commit -m "feat(infra): add migration for platform-agnostic component model"
```

---

### Task 2: Update Shared Types

**Files:**

- Modify: `factory/shared/src/types.ts`

Update all TypeScript interfaces to match the new schema.

- [ ] **Step 1: Update ComponentKind and ComponentSpec**

In `factory/shared/src/types.ts`, change:

```typescript
// Old:
export type ComponentKind = "deployment" | "statefulset" | "job" | "cronjob"

export interface ComponentSpec {
  componentId: string
  moduleId: string
  name: string
  kind: ComponentKind
  port?: number | null
  healthcheckPath?: string | null
  isPublic: boolean
  runOrder?: number | null
  defaultReplicas: number
  defaultCpu: string
  defaultMemory: string
  createdAt: string
}
```

To:

```typescript
export type ComponentKind =
  | "server"
  | "worker"
  | "task"
  | "scheduled"
  | "site"
  | "database"
  | "gateway"

export type PortProtocol = "http" | "https" | "grpc" | "tcp" | "udp"

export interface ComponentPort {
  name: string
  port: number
  protocol: PortProtocol
}

export interface ComponentHealthcheck {
  path: string
  portName: string
  protocol: PortProtocol
}

export interface ComponentSpec {
  componentId: string
  moduleId: string
  name: string
  slug: string
  kind: ComponentKind
  ports: ComponentPort[]
  healthcheck?: ComponentHealthcheck | null
  isPublic: boolean
  stateful: boolean
  runOrder?: number | null
  defaultReplicas: number
  defaultCpu: string
  defaultMemory: string
  createdAt: string
}
```

- [ ] **Step 2: Update DeploymentTarget**

Change:

```typescript
export interface DeploymentTarget {
  deploymentTargetId: string
  name: string
  kind: DeploymentTargetKind
  siteId?: string | null
  clusterId?: string | null
  namespace?: string | null
  createdBy: string
  trigger: DeploymentTargetTrigger
  ttl?: string | null
  expiresAt?: string | null
  tierPolicies: Record<string, unknown>
  status: DeploymentTargetStatus
  labels: Record<string, unknown>
  createdAt: string
  destroyedAt?: string | null
}
```

To:

```typescript
export type DeploymentTargetRuntime =
  | "kubernetes"
  | "compose"
  | "systemd"
  | "windows_service"
  | "iis"
  | "process"

export interface DeploymentTarget {
  deploymentTargetId: string
  name: string
  kind: DeploymentTargetKind
  runtime: DeploymentTargetRuntime
  siteId?: string | null
  clusterId?: string | null
  hostId?: string | null
  vmId?: string | null
  namespace?: string | null
  createdBy: string
  trigger: DeploymentTargetTrigger
  ttl?: string | null
  expiresAt?: string | null
  tierPolicies: Record<string, unknown>
  status: DeploymentTargetStatus
  labels: Record<string, unknown>
  createdAt: string
  destroyedAt?: string | null
}
```

- [ ] **Step 3: Update Artifact**

Change:

```typescript
export interface Artifact {
  artifactId: string
  imageRef: string
  imageDigest: string
  sizeBytes?: number | null
  builtAt: string
}
```

To:

```typescript
export type ArtifactKind =
  | "container_image"
  | "binary"
  | "archive"
  | "package"
  | "bundle"

export interface Artifact {
  artifactId: string
  kind: ArtifactKind
  imageRef: string
  imageDigest: string
  sizeBytes?: number | null
  builtAt: string
}
```

- [ ] **Step 4: Update Workload**

Add `desiredArtifactUri` to the Workload interface:

```typescript
export interface Workload {
  workloadId: string
  deploymentTargetId: string
  moduleVersionId: string
  componentId: string
  artifactId: string
  replicas: number
  envOverrides: Record<string, unknown>
  resourceOverrides: Record<string, unknown>
  status: WorkloadStatus
  desiredImage: string
  desiredArtifactUri?: string | null
  actualImage?: string | null
  driftDetected: boolean
  lastReconciledAt?: string | null
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 5: Update Host and Vm types**

Change Host:

```typescript
export type OsType = "linux" | "windows"
export type AccessMethod = "ssh" | "winrm" | "rdp"

export interface Host {
  hostId: string
  name: string
  slug: string
  hostname?: string | null
  providerId: string
  datacenterId?: string | null
  ipAddress?: string | null
  ipmiAddress?: string | null
  status: HostStatus
  osType: OsType
  accessMethod: AccessMethod
  cpuCores: number
  memoryMb: number
  diskGb: number
  rackLocation?: string | null
  createdAt: string
}
```

Change Vm (note: `sshUser` is removed, replaced by `accessUser` + `accessMethod`):

```typescript
export interface Vm {
  vmId: string
  name: string
  slug: string
  providerId: string
  datacenterId?: string | null
  hostId?: string | null
  clusterId?: string | null
  proxmoxClusterId?: string | null
  proxmoxVmid?: number | null
  vmType: string
  status: VmStatus
  osType: OsType
  accessMethod: AccessMethod
  accessUser?: string | null
  cpu: number
  memoryMb: number
  diskGb: number
  ipAddress?: string | null
  createdAt: string
}
```

- [ ] **Step 6: Commit**

```bash
git add factory/shared/src/types.ts
git commit -m "feat(shared): update types for platform-agnostic component model"
```

---

### Task 3: Update Drizzle Schema Definitions

**Files:**

- Modify: `factory/api/src/db/schema/product.ts`
- Modify: `factory/api/src/db/schema/fleet.ts`
- Modify: `factory/api/src/db/schema/build.ts`
- Modify: `factory/api/src/db/schema/infra.ts`

These changes must match the migration SQL exactly.

- [ ] **Step 1: Update componentSpec in product.ts**

In `factory/api/src/db/schema/product.ts`:

1. Update imports — add `boolean`, `jsonb`; remove `integer` if `port` was its only use:

```typescript
import {
  boolean,
  check,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
```

2. Replace the `port` and `healthcheckPath` columns with `ports` and `healthcheck`:

```typescript
    // DELETE these two lines:
    port: integer("port"),
    healthcheckPath: text("healthcheck_path"),

    // ADD these two lines:
    ports: jsonb("ports").notNull().default([]),
    healthcheck: jsonb("healthcheck"),
```

3. Add the `stateful` column (after `isPublic`):

```typescript
    stateful: boolean("stateful").notNull().default(false),
```

4. Update the kind check constraint from:

```typescript
    check(
      "component_spec_kind_valid",
      sql`${t.kind} IN ('deployment', 'statefulset', 'job', 'cronjob')`
    ),
```

To:

```typescript
    check(
      "component_spec_kind_valid",
      sql`${t.kind} IN ('server', 'worker', 'task', 'scheduled', 'site', 'database', 'gateway')`
    ),
```

Note: `integer` import may still be needed by other tables (e.g. `runOrder`, `defaultReplicas`) — keep it if so.

- [ ] **Step 2: Update deploymentTarget in fleet.ts**

In `factory/api/src/db/schema/fleet.ts`, add to the `deploymentTarget` columns (after `kind`):

```typescript
    runtime: text("runtime").notNull().default("kubernetes"),
    hostId: text("host_id")
      .references(() => host.hostId, { onDelete: "set null" }),
    vmId: text("vm_id")
      .references(() => vm.vmId, { onDelete: "set null" }),
```

Add the import for `host` and `vm` at the top:

```typescript
import { cluster, host, vm } from "./infra"
```

Add the runtime check constraint to the table's constraint array:

```typescript
    check(
      "deployment_target_runtime_valid",
      sql`${t.runtime} IN ('kubernetes', 'compose', 'systemd', 'windows_service', 'iis', 'process')`
    ),
```

- [ ] **Step 3: Update workload in fleet.ts**

Add to the `workload` columns (after `desiredImage`):

```typescript
    desiredArtifactUri: text("desired_artifact_uri"),
```

- [ ] **Step 4: Update artifact in build.ts**

Add to the `artifact` columns (after `artifactId`):

```typescript
    kind: text("kind").notNull().default("container_image"),
```

Add a check constraint. The artifact table currently has no constraint array, so add one:

```typescript
export const artifact = factoryBuild.table(
  "artifact",
  {
    // ... columns ...
  },
  (t) => [
    check(
      "artifact_kind_valid",
      sql`${t.kind} IN ('container_image', 'binary', 'archive', 'package', 'bundle')`
    ),
  ]
)
```

Note: this changes the `artifact` table definition from a 2-arg to 3-arg `factoryBuild.table()` call.

- [ ] **Step 5: Update host and vm in infra.ts**

In the `host` table, add columns (after `status`):

```typescript
    osType: text("os_type").notNull().default("linux"),
    accessMethod: text("access_method").notNull().default("ssh"),
```

Add check constraints to the host constraint array:

```typescript
    check(
      "host_os_type_valid",
      sql`${t.osType} IN ('linux', 'windows')`
    ),
    check(
      "host_access_method_valid",
      sql`${t.accessMethod} IN ('ssh', 'winrm', 'rdp')`
    ),
```

In the `vm` table, add columns (after `status`):

```typescript
    osType: text("os_type").notNull().default("linux"),
    accessMethod: text("access_method").notNull().default("ssh"),
    accessUser: text("access_user"),
```

Also **remove** the `sshUser` column from the vm table (it's been replaced by `accessUser` + `accessMethod`):

```typescript
    // DELETE this line:
    sshUser: text("ssh_user"),
```

Add check constraints to the vm constraint array:

```typescript
    check(
      "vm_os_type_valid",
      sql`${t.osType} IN ('linux', 'windows')`
    ),
    check(
      "vm_access_method_valid",
      sql`${t.accessMethod} IN ('ssh', 'winrm', 'rdp')`
    ),
```

- [ ] **Step 6: Commit**

```bash
git add factory/api/src/db/schema/product.ts factory/api/src/db/schema/fleet.ts factory/api/src/db/schema/build.ts factory/api/src/db/schema/infra.ts
git commit -m "feat(schema): update Drizzle schema for platform-agnostic component model"
```

---

### Task 4: Write Tests for Schema Changes

**Files:**

- Modify: `factory/api/src/__tests__/infra-services.test.ts`

Verify the new columns work at the database level before touching services.

- [ ] **Step 1: Write test for host osType and accessMethod**

Add a new `describe` block in the `host` section of `infra-services.test.ts`:

```typescript
it("creates host with osType and accessMethod", async () => {
  const prov = await providerSvc.createProvider(db, {
    name: "prov",
    providerType: "proxmox",
  })
  const winHost = await hostSvc.addHost(db, {
    name: "win-srv-01",
    providerId: prov!.providerId,
    cpuCores: 16,
    memoryMb: 65536,
    diskGb: 1000,
    osType: "windows",
    accessMethod: "ssh",
  })
  expect(winHost.osType).toBe("windows")
  expect(winHost.accessMethod).toBe("ssh")
})

it("defaults host to linux + ssh", async () => {
  const prov = await providerSvc.createProvider(db, {
    name: "prov",
    providerType: "proxmox",
  })
  const linuxHost = await hostSvc.addHost(db, {
    name: "linux-srv-01",
    providerId: prov!.providerId,
    cpuCores: 16,
    memoryMb: 65536,
    diskGb: 1000,
  })
  expect(linuxHost.osType).toBe("linux")
  expect(linuxHost.accessMethod).toBe("ssh")
})

it("filters hosts by osType", async () => {
  const prov = await providerSvc.createProvider(db, {
    name: "prov",
    providerType: "proxmox",
  })
  await hostSvc.addHost(db, {
    name: "linux-01",
    providerId: prov!.providerId,
    cpuCores: 8,
    memoryMb: 32768,
    diskGb: 500,
    osType: "linux",
  })
  await hostSvc.addHost(db, {
    name: "win-01",
    providerId: prov!.providerId,
    cpuCores: 8,
    memoryMb: 32768,
    diskGb: 500,
    osType: "windows",
  })
  const winHosts = await hostSvc.listHosts(db, { osType: "windows" })
  expect(winHosts).toHaveLength(1)
  expect(winHosts[0].name).toBe("win-01")
})
```

- [ ] **Step 2: Write test for VM osType and accessMethod**

Add to the `vm` section:

```typescript
it("creates Windows VM with accessMethod and accessUser", async () => {
  const prov = await providerSvc.createProvider(db, {
    name: "prov",
    providerType: "proxmox",
  })
  const winVm = await vmSvc.createVm(db, {
    name: "win-vm-01",
    providerId: prov!.providerId,
    cpu: 4,
    memoryMb: 8192,
    diskGb: 100,
    osType: "windows",
    accessMethod: "winrm",
    accessUser: "Administrator",
  })
  expect(winVm.osType).toBe("windows")
  expect(winVm.accessMethod).toBe("winrm")
  expect(winVm.accessUser).toBe("Administrator")
})

it("lists VMs filtered by osType", async () => {
  const prov = await providerSvc.createProvider(db, {
    name: "prov",
    providerType: "proxmox",
  })
  await vmSvc.createVm(db, {
    name: "linux-vm",
    providerId: prov!.providerId,
    cpu: 2,
    memoryMb: 4096,
    diskGb: 50,
  })
  await vmSvc.createVm(db, {
    name: "win-vm",
    providerId: prov!.providerId,
    cpu: 2,
    memoryMb: 4096,
    diskGb: 50,
    osType: "windows",
  })
  const winVms = await vmSvc.listVms(db, { osType: "windows" })
  expect(winVms).toHaveLength(1)
  expect(winVms[0].name).toBe("win-vm")
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd factory/api && npx vitest run src/__tests__/infra-services.test.ts 2>&1 | tail -20`
Expected: Tests fail because services don't accept/return osType yet.

- [ ] **Step 4: Commit failing tests**

```bash
git add factory/api/src/__tests__/infra-services.test.ts
git commit -m "test(infra): add tests for osType and accessMethod on hosts and VMs"
```

---

### Task 5: Update Infra Services for osType/accessMethod

**Files:**

- Modify: `factory/api/src/services/infra/host.service.ts`
- Modify: `factory/api/src/services/infra/vm.service.ts`
- Modify: `factory/api/src/modules/infra/model.ts`

- [ ] **Step 1: Update host.service.ts — addHost accepts osType and accessMethod**

In `host.service.ts`, add `osType?: string` and `accessMethod?: string` to the `addHost` `data` parameter type. These flow through the existing `{ slug: explicitSlug, ...rest }` spread pattern automatically — DB defaults (`linux`, `ssh`) apply when omitted. No changes to the `.values()` call needed.

- [ ] **Step 2: Update host.service.ts — listHosts filters by osType**

In the `listHosts` function, add `osType?: string` to the filter options type and add a chained `.where()` following the existing pattern:

```typescript
if (filters?.osType) {
  query = query.where(eq(host.osType, filters.osType)) as typeof query
}
```

- [ ] **Step 3: Update vm.service.ts — createVm accepts osType, accessMethod, accessUser; drop sshUser**

In `vm.service.ts`, update the `createVm` function's `data` type:

- Add `osType?: string`, `accessMethod?: string`, `accessUser?: string`
- Remove `sshUser?: string`

The spread pattern (`{ slug: explicitSlug, ...rest }` → `db.insert(vm).values({ ...rest, slug })`) means the new fields flow through automatically. DB defaults (`linux`, `ssh`) apply when omitted.

- [ ] **Step 4: Update vm.service.ts — listVms filters by osType**

Add `osType?: string` to the filter options type and add a chained `.where()` following the existing pattern:

```typescript
if (filters?.osType) {
  query = query.where(eq(vm.osType, filters.osType)) as typeof query
}
```

- [ ] **Step 5: Update InfraModel**

In `factory/api/src/modules/infra/model.ts`:

Add to `createHostBody`:

```typescript
osType: t.Optional(t.String()),
accessMethod: t.Optional(t.String()),
```

Add to `listHostsQuery`:

```typescript
osType: t.Optional(t.String()),
```

Add to `createVmBody`:

```typescript
osType: t.Optional(t.String()),
accessMethod: t.Optional(t.String()),
accessUser: t.Optional(t.String()),
```

Add to `listVmsQuery`:

```typescript
osType: t.Optional(t.String()),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd factory/api && npx vitest run src/__tests__/infra-services.test.ts 2>&1 | tail -20`
Expected: All tests pass including new osType/accessMethod tests.

- [ ] **Step 7: Commit**

```bash
git add factory/api/src/services/infra/host.service.ts factory/api/src/services/infra/vm.service.ts factory/api/src/modules/infra/model.ts
git commit -m "feat(infra): support osType and accessMethod on hosts and VMs"
```

---

### Task 6: Runtime Strategy Interface + Registry

**Files:**

- Create: `factory/api/src/reconciler/runtime-strategy.ts`
- Create: `factory/api/src/reconciler/strategies/noop.ts`

- [ ] **Step 1: Write the runtime strategy interface**

Create `factory/api/src/reconciler/runtime-strategy.ts`:

```typescript
import type { Database } from "../db/connection"

export interface ReconcileContext {
  workload: {
    workloadId: string
    desiredImage: string
    desiredArtifactUri?: string | null
    replicas: number
    envOverrides: Record<string, unknown>
    resourceOverrides: Record<string, unknown>
    moduleVersionId: string
  }
  component: {
    name: string
    kind: string
    ports: Array<{ name: string; port: number; protocol: string }>
    healthcheck?: { path: string; portName: string; protocol: string } | null
    isPublic: boolean
    stateful: boolean
    defaultCpu: string
    defaultMemory: string
    defaultReplicas: number
  }
  target: {
    deploymentTargetId: string
    name: string
    kind: string
    runtime: string
    clusterId?: string | null
    hostId?: string | null
    vmId?: string | null
    namespace?: string | null
  }
  moduleName: string
}

export interface ReconcileResult {
  status: "running" | "completed" | "failed"
  actualImage?: string | null
  driftDetected: boolean
  details?: Record<string, unknown>
}

export interface RuntimeStrategy {
  readonly runtime: string
  reconcile(ctx: ReconcileContext, db: Database): Promise<ReconcileResult>
}

export type RuntimeType =
  | "kubernetes"
  | "compose"
  | "systemd"
  | "windows_service"
  | "iis"
  | "process"

const strategies: Partial<Record<RuntimeType, () => RuntimeStrategy>> = {}

export function registerRuntimeStrategy(
  runtime: RuntimeType,
  factory: () => RuntimeStrategy
): void {
  strategies[runtime] = factory
}

export function getRuntimeStrategy(runtime: string): RuntimeStrategy {
  const factory = strategies[runtime as RuntimeType]
  if (!factory) {
    throw new Error(
      `No strategy for runtime: ${runtime}. Supported: ${Object.keys(strategies).join(", ")}`
    )
  }
  return factory()
}

/** Clear all registered strategies — for test isolation only */
export function clearRuntimeStrategies(): void {
  for (const key of Object.keys(strategies)) {
    delete strategies[key as RuntimeType]
  }
}
```

- [ ] **Step 2: Write the no-op strategy**

Create `factory/api/src/reconciler/strategies/noop.ts`:

```typescript
import type {
  RuntimeStrategy,
  ReconcileContext,
  ReconcileResult,
} from "../runtime-strategy"

/** No-op strategy for inventory-only or unmanaged deployment targets */
export class NoopStrategy implements RuntimeStrategy {
  readonly runtime = "noop"

  async reconcile(ctx: ReconcileContext): Promise<ReconcileResult> {
    // Inventory-only: mark as running, no drift detection
    return {
      status: ctx.component.kind === "task" ? "completed" : "running",
      actualImage: null,
      driftDetected: false,
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add factory/api/src/reconciler/runtime-strategy.ts factory/api/src/reconciler/strategies/noop.ts
git commit -m "feat(reconciler): add runtime strategy interface and noop strategy"
```

---

### Task 7: Extract Kubernetes Strategy from Resource Generator

**Files:**

- Create: `factory/api/src/reconciler/strategies/kubernetes.ts`
- Modify: `factory/api/src/reconciler/resource-generator.ts` (keep for backward compat, delegate)

The existing `resource-generator.ts` and its `generateResources` function must continue to work because it's imported by the reconciler tests. We extract the K8s strategy as a new class that uses the existing functions, then update `generateResources` to handle the new component kinds.

- [ ] **Step 1: Write the Kubernetes strategy**

Create `factory/api/src/reconciler/strategies/kubernetes.ts`:

```typescript
import type { KubeClient } from "../../lib/kube-client"
import type {
  RuntimeStrategy,
  ReconcileContext,
  ReconcileResult,
} from "../runtime-strategy"
import type { Database } from "../../db/connection"
import { cluster } from "../../db/schema/infra"
import { eq } from "drizzle-orm"
import { generateResources } from "../resource-generator"

export class KubernetesStrategy implements RuntimeStrategy {
  readonly runtime = "kubernetes"

  constructor(private kube: KubeClient) {}

  async reconcile(
    ctx: ReconcileContext,
    db: Database
  ): Promise<ReconcileResult> {
    const clusterId = ctx.target.clusterId
    if (!clusterId)
      throw new Error(
        `Kubernetes target ${ctx.target.deploymentTargetId} has no cluster`
      )

    const clusterRows = await db
      .select()
      .from(cluster)
      .where(eq(cluster.clusterId, clusterId))
    const cl = clusterRows[0]
    if (!cl) throw new Error(`Cluster not found: ${clusterId}`)
    if (!cl.kubeconfigRef)
      throw new Error(`Cluster ${clusterId} has no kubeconfig`)

    // Generate and apply resources
    // Note: `as any` casts are needed here because ReconcileContext uses narrower
    // inline types while generateResources expects the full shared types.
    // A future cleanup could update generateResources to accept Pick<> types.
    const resources = generateResources(
      ctx.workload as any,
      ctx.component as any,
      ctx.target as any,
      ctx.moduleName
    )

    for (const resource of resources) {
      await this.kube.apply(cl.kubeconfigRef, resource)
    }

    // Check drift for long-running components
    const ns = ctx.target.namespace ?? ctx.target.name
    let actualImage: string | null = null
    let driftDetected = false

    if (
      ctx.component.kind === "server" ||
      ctx.component.kind === "worker" ||
      ctx.component.kind === "database" ||
      ctx.component.kind === "gateway"
    ) {
      actualImage = await this.kube.getDeploymentImage(
        cl.kubeconfigRef,
        ns,
        ctx.component.name
      )
      driftDetected =
        actualImage !== null && actualImage !== ctx.workload.desiredImage
    }

    const status = ctx.component.kind === "task" ? "completed" : "running"
    return { status, actualImage, driftDetected }
  }
}
```

- [ ] **Step 2: Update resource-generator.ts for multi-port and new component kinds**

In `factory/api/src/reconciler/resource-generator.ts`:

**First**, update all internal functions to use `ports` array instead of single `port`:

The `generateResources` function needs a helper to extract ports:

```typescript
function getFirstPort(component: ComponentSpec): number | null {
  const ports = (component as any).ports as
    | Array<{ name: string; port: number; protocol: string }>
    | undefined
  return ports?.[0]?.port ?? null
}
```

Update the Service and IngressRoute conditions:

```typescript
// Old: if (component.port) { ... }
// New:
const componentPorts =
  ((component as any).ports as Array<{
    name: string
    port: number
    protocol: string
  }>) ?? []
if (componentPorts.length > 0) {
  resources.push(makeService(component, ns, labels, componentPorts))
}

if (component.isPublic && componentPorts.length > 0) {
  resources.push(
    makeIngressRoute(component, ns, labels, target, componentPorts[0].port)
  )
}
```

Update `makeContainer` to emit multiple ports:

```typescript
if (componentPorts.length > 0) {
  container.ports = componentPorts.map((p) => ({ containerPort: p.port }))
}
```

Update `makeContainer` healthcheck to use the healthcheck object:

```typescript
const healthcheck = (component as any).healthcheck as {
  path: string
  portName: string
} | null
if (healthcheck) {
  const hcPort =
    componentPorts.find((p) => p.name === healthcheck.portName)?.port ??
    componentPorts[0]?.port
  container.livenessProbe = {
    httpGet: { path: healthcheck.path, port: hcPort },
    initialDelaySeconds: 10,
    periodSeconds: 15,
  }
  container.readinessProbe = {
    httpGet: { path: healthcheck.path, port: hcPort },
    initialDelaySeconds: 5,
    periodSeconds: 10,
  }
}
```

Update `makeService` to emit multiple ports:

```typescript
function makeService(
  component: ComponentSpec,
  ns: string,
  labels: Record<string, string>,
  ports: Array<{ name: string; port: number; protocol: string }>
): KubeResource {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: component.name, namespace: ns, labels },
    spec: {
      selector: { "dx.dev/component": component.name },
      ports: ports.map((p) => ({
        name: p.name,
        port: p.port,
        targetPort: p.port,
      })),
    },
  }
}
```

**Then**, update the switch statement to map new kinds to K8s resources:

Change the switch block from:

```typescript
switch (component.kind) {
  case "deployment":
    resources.push(
      makeDeployment(workload, component, ns, labels, resourceLimits)
    )
    break
  case "statefulset":
    resources.push(
      makeStatefulSet(workload, component, ns, labels, resourceLimits)
    )
    break
  case "job":
    resources.push(makeJob(workload, component, ns, labels, resourceLimits))
    break
  case "cronjob":
    resources.push(makeCronJob(workload, component, ns, labels, resourceLimits))
    break
}
```

To:

```typescript
switch (component.kind) {
  case "server":
  case "worker":
  case "gateway":
    if (component.stateful) {
      resources.push(
        makeStatefulSet(workload, component, ns, labels, resourceLimits)
      )
    } else {
      resources.push(
        makeDeployment(workload, component, ns, labels, resourceLimits)
      )
    }
    break
  case "database":
    resources.push(
      makeStatefulSet(workload, component, ns, labels, resourceLimits)
    )
    break
  case "task":
    resources.push(makeJob(workload, component, ns, labels, resourceLimits))
    break
  case "scheduled":
    resources.push(makeCronJob(workload, component, ns, labels, resourceLimits))
    break
  case "site":
    resources.push(
      makeDeployment(workload, component, ns, labels, resourceLimits)
    )
    break
}
```

- [ ] **Step 3: Commit**

```bash
git add factory/api/src/reconciler/strategies/kubernetes.ts factory/api/src/reconciler/resource-generator.ts
git commit -m "feat(reconciler): extract Kubernetes runtime strategy, update resource generator for new kinds"
```

---

### Task 7b: Update resource-generator.test.ts for New Component Kinds

**Files:**

- Modify: `factory/api/src/__tests__/resource-generator.test.ts`

The test helpers construct typed `ComponentSpec`, `Workload`, and `DeploymentTarget` objects inline. These must be updated for the new types.

- [ ] **Step 1: Update makeComponent helper**

Change the `makeComponent` function defaults:

```typescript
function makeComponent(overrides?: Partial<ComponentSpec>): ComponentSpec {
  return {
    componentId: "cmp_test1",
    moduleId: "mod_test1",
    name: "api-server",
    slug: "api-server",
    kind: "server",
    ports: [{ name: "http", port: 8080, protocol: "http" }],
    healthcheck: { path: "/health", portName: "http", protocol: "http" },
    isPublic: true,
    stateful: false,
    runOrder: null,
    defaultReplicas: 2,
    defaultCpu: "500m",
    defaultMemory: "512Mi",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  }
}
```

- [ ] **Step 2: Update makeTarget helper**

Add the new required fields:

```typescript
function makeTarget(overrides?: Partial<DeploymentTarget>): DeploymentTarget {
  return {
    deploymentTargetId: "dt_test1",
    name: "staging-01",
    slug: "staging-01",
    kind: "staging",
    runtime: "kubernetes",
    siteId: null,
    clusterId: "cls_test1",
    hostId: null,
    vmId: null,
    namespace: "staging-01",
    createdBy: "user1",
    trigger: "manual",
    ttl: null,
    expiresAt: null,
    tierPolicies: {},
    status: "active",
    labels: {},
    createdAt: "2024-01-01T00:00:00Z",
    destroyedAt: null,
    ...overrides,
  }
}
```

- [ ] **Step 3: Update makeWorkload helper**

Add the new field:

```typescript
function makeWorkload(overrides?: Partial<Workload>): Workload {
  return {
    workloadId: "wl_test1",
    deploymentTargetId: "dt_test1",
    moduleVersionId: "mv_test1",
    componentId: "cmp_test1",
    artifactId: "art_test1",
    replicas: 2,
    envOverrides: {},
    resourceOverrides: {},
    status: "provisioning",
    desiredImage: "registry.dx.dev/api:v1.0.0",
    desiredArtifactUri: null,
    actualImage: null,
    driftDetected: false,
    lastReconciledAt: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  }
}
```

- [ ] **Step 4: Update test assertions for new kinds**

Change these tests:

1. "generates Namespace + CronJob for cronjob component" → change to:

```typescript
it("generates Namespace + CronJob for scheduled component", () => {
  const resources = generateResources(
    makeWorkload(),
    makeComponent({
      kind: "scheduled",
      ports: [],
      healthcheck: null,
      isPublic: false,
    }),
    makeTarget(),
    "my-module"
  )
  expect(resources).toHaveLength(2)
  expect(resources.map((r) => r.kind)).toEqual(["Namespace", "CronJob"])
})
```

2. "generates Namespace + Job for job component" → change to:

```typescript
it("generates Namespace + Job for task component", () => {
  const resources = generateResources(
    makeWorkload(),
    makeComponent({
      kind: "task",
      ports: [],
      healthcheck: null,
      isPublic: false,
    }),
    makeTarget(),
    "my-module"
  )
  expect(resources).toHaveLength(2)
  expect(resources.map((r) => r.kind)).toEqual(["Namespace", "Job"])
})
```

3. "generates Namespace + StatefulSet for statefulset component" → change to:

```typescript
it("generates Namespace + StatefulSet for stateful server component", () => {
  const resources = generateResources(
    makeWorkload(),
    makeComponent({ kind: "server", stateful: true }),
    makeTarget(),
    "my-module"
  )
  expect(resources).toHaveLength(4)
  expect(resources[1].kind).toBe("StatefulSet")
})
```

4. Add a new test for database kind:

```typescript
it("generates StatefulSet for database component", () => {
  const resources = generateResources(
    makeWorkload(),
    makeComponent({ kind: "database" }),
    makeTarget(),
    "my-module"
  )
  expect(resources[1].kind).toBe("StatefulSet")
})
```

- [ ] **Step 5: Run tests**

Run: `cd factory/api && npx vitest run src/__tests__/resource-generator.test.ts 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add factory/api/src/__tests__/resource-generator.test.ts
git commit -m "test(reconciler): update resource-generator tests for platform-agnostic component kinds"
```

---

### Task 8: Create Stub Strategies for Compose, Systemd, Windows

**Files:**

- Create: `factory/api/src/reconciler/strategies/compose.ts`
- Create: `factory/api/src/reconciler/strategies/systemd.ts`
- Create: `factory/api/src/reconciler/strategies/windows.ts`

These are stubs that document the intended behavior but don't implement it yet.

- [ ] **Step 1: Write compose strategy stub**

Create `factory/api/src/reconciler/strategies/compose.ts`:

```typescript
import type {
  RuntimeStrategy,
  ReconcileContext,
  ReconcileResult,
} from "../runtime-strategy"

/** Docker Compose runtime strategy — deploys components as compose services on a host/VM */
export class ComposeStrategy implements RuntimeStrategy {
  readonly runtime = "compose"

  async reconcile(ctx: ReconcileContext): Promise<ReconcileResult> {
    // TODO: SSH into target host/VM
    // TODO: Generate docker-compose.yml snippet for this component
    // TODO: Run `docker compose up -d <service>` via SSH
    // TODO: Check container status for drift detection
    return {
      status: ctx.component.kind === "task" ? "completed" : "running",
      actualImage: null,
      driftDetected: false,
    }
  }
}
```

- [ ] **Step 2: Write systemd strategy stub**

Create `factory/api/src/reconciler/strategies/systemd.ts`:

```typescript
import type {
  RuntimeStrategy,
  ReconcileContext,
  ReconcileResult,
} from "../runtime-strategy"

/** systemd runtime strategy — deploys components as systemd units on Linux hosts/VMs */
export class SystemdStrategy implements RuntimeStrategy {
  readonly runtime = "systemd"

  async reconcile(ctx: ReconcileContext): Promise<ReconcileResult> {
    // TODO: SSH into target host/VM
    // TODO: Generate systemd unit file from component spec
    // TODO: `systemctl daemon-reload && systemctl enable --now <unit>`
    // TODO: Check `systemctl is-active <unit>` for status
    return {
      status: ctx.component.kind === "task" ? "completed" : "running",
      actualImage: null,
      driftDetected: false,
    }
  }
}
```

- [ ] **Step 3: Write windows strategy stub**

Create `factory/api/src/reconciler/strategies/windows.ts`:

```typescript
import type {
  RuntimeStrategy,
  ReconcileContext,
  ReconcileResult,
} from "../runtime-strategy"

/**
 * Windows runtime strategy — deploys components as Windows Services or IIS sites.
 * Handles both 'windows_service' and 'iis' runtimes.
 */
export class WindowsServiceStrategy implements RuntimeStrategy {
  readonly runtime = "windows_service"

  async reconcile(ctx: ReconcileContext): Promise<ReconcileResult> {
    // TODO: SSH (or WinRM) into target Windows host/VM
    // TODO: For windows_service: `sc.exe create/start` or `New-Service` via PowerShell
    // TODO: For IIS: `New-IISSite` / `Set-IISSiteBinding` via PowerShell
    // TODO: Check service status via `Get-Service` / `Get-IISSite`
    return {
      status: ctx.component.kind === "task" ? "completed" : "running",
      actualImage: null,
      driftDetected: false,
    }
  }
}

export class IisStrategy implements RuntimeStrategy {
  readonly runtime = "iis"

  async reconcile(ctx: ReconcileContext): Promise<ReconcileResult> {
    // TODO: SSH into target Windows host/VM
    // TODO: Deploy to IIS via PowerShell (`New-WebApplication`, `Set-ItemProperty IIS:\Sites\...`)
    // TODO: Check IIS site status
    return {
      status: "running",
      actualImage: null,
      driftDetected: false,
    }
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add factory/api/src/reconciler/strategies/compose.ts factory/api/src/reconciler/strategies/systemd.ts factory/api/src/reconciler/strategies/windows.ts
git commit -m "feat(reconciler): add stub strategies for compose, systemd, and windows runtimes"
```

---

### Task 9: Refactor Reconciler to Use Runtime Strategies

**Files:**

- Modify: `factory/api/src/reconciler/reconciler.ts`

The reconciler currently hardcodes Kubernetes. Refactor it to look up the deployment target's `runtime` field and dispatch to the appropriate strategy.

- [ ] **Step 1: Update Reconciler constructor and imports**

Change the reconciler to accept a KubeClient (for backward compatibility) but use it through the strategy pattern:

```typescript
import { eq, notInArray } from "drizzle-orm";
import type { Database } from "../db/connection";
import type { KubeClient } from "../lib/kube-client";
import { workload, deploymentTarget } from "../db/schema/fleet";
import { componentSpec, productModule } from "../db/schema/product";
import { moduleVersion } from "../db/schema/build";
import { logger } from "../logger";
import { getRuntimeStrategy, registerRuntimeStrategy, type ReconcileContext } from "./runtime-strategy";
import { KubernetesStrategy } from "./strategies/kubernetes";
import { ComposeStrategy } from "./strategies/compose";
import { SystemdStrategy } from "./strategies/systemd";
import { WindowsServiceStrategy, IisStrategy } from "./strategies/windows";
import { NoopStrategy } from "./strategies/noop";

export class Reconciler {
  constructor(
    private db: Database,
    private kube: KubeClient,
  ) {
    // Register all runtime strategies
    registerRuntimeStrategy("kubernetes", () => new KubernetesStrategy(kube));
    registerRuntimeStrategy("compose", () => new ComposeStrategy());
    registerRuntimeStrategy("systemd", () => new SystemdStrategy());
    registerRuntimeStrategy("windows_service", () => new WindowsServiceStrategy());
    registerRuntimeStrategy("iis", () => new IisStrategy());
    registerRuntimeStrategy("process", () => new NoopStrategy());
  }
```

- [ ] **Step 2: Refactor reconcileWorkload to use strategies**

Replace the existing `reconcileWorkload` method body:

```typescript
  async reconcileWorkload(workloadId: string): Promise<void> {
    // 1. Load workload
    const wlRows = await this.db
      .select()
      .from(workload)
      .where(eq(workload.workloadId, workloadId));
    const wl = wlRows[0];
    if (!wl) throw new Error(`Workload not found: ${workloadId}`);

    // 2. Load component
    const compRows = await this.db
      .select()
      .from(componentSpec)
      .where(eq(componentSpec.componentId, wl.componentId));
    const comp = compRows[0];
    if (!comp) throw new Error(`Component not found: ${wl.componentId}`);

    // 3. Load deployment target
    const dtRows = await this.db
      .select()
      .from(deploymentTarget)
      .where(eq(deploymentTarget.deploymentTargetId, wl.deploymentTargetId));
    const dt = dtRows[0];
    if (!dt) throw new Error(`Deployment target not found: ${wl.deploymentTargetId}`);

    // 4. Load module name
    const mvRows = await this.db
      .select()
      .from(moduleVersion)
      .where(eq(moduleVersion.moduleVersionId, wl.moduleVersionId));
    const mv = mvRows[0];
    if (!mv) throw new Error(`Module version not found: ${wl.moduleVersionId}`);

    const modRows = await this.db
      .select()
      .from(productModule)
      .where(eq(productModule.moduleId, mv.moduleId));
    const mod = modRows[0];
    const moduleName = mod?.name ?? "unknown";

    // 5. Build reconcile context
    // All fields (stateful, runtime, hostId, vmId, desiredArtifactUri) are available
    // directly from the Drizzle schema after Task 3 updates.
    const ctx: ReconcileContext = {
      workload: {
        workloadId: wl.workloadId,
        desiredImage: wl.desiredImage,
        desiredArtifactUri: wl.desiredArtifactUri ?? null,
        replicas: wl.replicas,
        envOverrides: wl.envOverrides as Record<string, unknown>,
        resourceOverrides: wl.resourceOverrides as Record<string, unknown>,
        moduleVersionId: wl.moduleVersionId,
      },
      component: {
        name: comp.name,
        kind: comp.kind,
        ports: (comp.ports ?? []) as Array<{ name: string; port: number; protocol: string }>,
        healthcheck: comp.healthcheck as any ?? null,
        isPublic: comp.isPublic,
        stateful: comp.stateful,
        defaultCpu: comp.defaultCpu,
        defaultMemory: comp.defaultMemory,
        defaultReplicas: comp.defaultReplicas,
      },
      target: {
        deploymentTargetId: dt.deploymentTargetId,
        name: dt.name,
        kind: dt.kind,
        runtime: dt.runtime,
        clusterId: dt.clusterId,
        hostId: dt.hostId ?? null,
        vmId: dt.vmId ?? null,
        namespace: dt.namespace,
      },
      moduleName,
    };

    // 6. Dispatch to runtime strategy
    const strategy = getRuntimeStrategy(ctx.target.runtime);
    const result = await strategy.reconcile(ctx, this.db);

    // 7. Update workload
    await this.db
      .update(workload)
      .set({
        status: result.status,
        actualImage: result.actualImage ?? null,
        driftDetected: result.driftDetected,
        lastReconciledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workload.workloadId, workloadId));
  }
```

Note: The `reconcileAll`, `detectDrift`, and `startLoop` methods remain unchanged.

- [ ] **Step 3: Commit**

```bash
git add factory/api/src/reconciler/reconciler.ts
git commit -m "refactor(reconciler): dispatch to runtime strategies instead of hardcoded K8s"
```

---

### Task 10: Update Reconciler Tests

**Files:**

- Modify: `factory/api/src/__tests__/reconciler.test.ts`

Update the seed data to use new component kinds and add a test for non-K8s runtime dispatch.

- [ ] **Step 1: Update seedWorkload to use new kinds**

In the `seedWorkload` function, change the default `kind` and the deployment target:

```typescript
  async function seedWorkload(opts?: {
    componentKind?: string;
    componentStateful?: boolean;
    desiredImage?: string;
    workloadStatus?: string;
    runtime?: string;
  }) {
    const kind = opts?.componentKind ?? "server";
    const stateful = opts?.componentStateful ?? false;
    const desiredImage =
      opts?.desiredImage ?? "registry.dx.dev/api:v1.0.0";
    const workloadStatus = opts?.workloadStatus ?? "provisioning";
    const runtime = opts?.runtime ?? "kubernetes";
```

Update the `componentSpec` insert to include `stateful`:

```typescript
const [comp] = await db
  .insert(componentSpec)
  .values({
    moduleId: mod.moduleId,
    name: "api-server",
    slug: "api-server",
    kind,
    stateful,
    ports: [{ name: "http", port: 8080, protocol: "http" }],
    healthcheck: { path: "/health", portName: "http", protocol: "http" },
    isPublic: true,
    defaultReplicas: 2,
    defaultCpu: "500m",
    defaultMemory: "512Mi",
  })
  .returning()
```

Update the `deploymentTarget` insert to include `runtime`:

```typescript
const [dt] = await db
  .insert(deploymentTarget)
  .values({
    name: "staging-01",
    slug: "staging-01",
    kind: "staging",
    runtime,
    clusterId: cls.clusterId,
    namespace: "staging-01",
    createdBy: "test",
    trigger: "manual",
    status: "active",
  })
  .returning()
```

- [ ] **Step 2: Update existing test assertions**

Change the test "reconciles a workload and applies Kube resources" — the component kind is now "server" so it should still produce a Deployment. No assertion changes needed since we didn't change what K8s resources are produced for `server` kind.

Change the test "sets job workloads to completed" to use `componentKind: "task"`:

```typescript
it("sets task workloads to completed", async () => {
  const { wl } = await seedWorkload({ componentKind: "task" })
  // ... rest unchanged
})
```

- [ ] **Step 3: Add test for stateful server → StatefulSet**

```typescript
it("creates StatefulSet for stateful server component", async () => {
  const { wl } = await seedWorkload({
    componentKind: "server",
    componentStateful: true,
  })
  const reconciler = new Reconciler(db, mockKube)

  await reconciler.reconcileWorkload(wl.workloadId)

  expect(mockKube.applied.map((r) => r.kind)).toContain("StatefulSet")
  expect(mockKube.applied.map((r) => r.kind)).not.toContain("Deployment")
})
```

- [ ] **Step 4: Add test for database kind → StatefulSet**

```typescript
it("creates StatefulSet for database component", async () => {
  const { wl } = await seedWorkload({ componentKind: "database" })
  const reconciler = new Reconciler(db, mockKube)

  await reconciler.reconcileWorkload(wl.workloadId)

  expect(mockKube.applied.map((r) => r.kind)).toContain("StatefulSet")
})
```

- [ ] **Step 5: Add test for non-K8s runtime dispatch through full reconciler**

This verifies the full path: reconciler reads runtime from DB, dispatches to compose strategy (stub), no K8s resources applied.

First, update `seedWorkload` to optionally omit `clusterId` for non-K8s targets:

In the `seedWorkload` function, make cluster creation conditional:

```typescript
// Only create cluster if runtime is kubernetes (or default)
let clsId: string | null = null
if (runtime === "kubernetes") {
  const [cls] = await db
    .insert(cluster)
    .values({
      name: "test-cluster",
      slug: "test-cluster",
      providerId: prov.providerId,
      kubeconfigRef: "fake-kubeconfig-yaml",
      status: "ready",
    })
    .returning()
  clsId = cls.clusterId
}
```

And use `clsId` in the deployment target insert:

```typescript
const [dt] = await db
  .insert(deploymentTarget)
  .values({
    name: "staging-01",
    slug: "staging-01",
    kind: "staging",
    runtime,
    clusterId: clsId,
    namespace: clsId ? "staging-01" : null,
    createdBy: "test",
    trigger: "manual",
    status: "active",
  })
  .returning()
```

Then add the test:

```typescript
it("dispatches compose runtime without touching K8s", async () => {
  const { wl } = await seedWorkload({ runtime: "compose" })
  const reconciler = new Reconciler(db, mockKube)

  await reconciler.reconcileWorkload(wl.workloadId)

  // Compose stub doesn't apply any K8s resources
  expect(mockKube.applied).toHaveLength(0)

  // Workload status is updated to running
  const updated = await db
    .select()
    .from(workload)
    .where(eq(workload.workloadId, wl.workloadId))
  expect(updated[0].status).toBe("running")
})
```

- [ ] **Step 6: Run all tests**

Run: `cd factory/api && npx vitest run 2>&1 | tail -30`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add factory/api/src/__tests__/reconciler.test.ts
git commit -m "test(reconciler): update tests for platform-agnostic component kinds"
```

---

### Task 11: Update Fleet Model and DeploymentTarget Service

**Files:**

- Modify: `factory/api/src/modules/fleet/model.ts`
- Modify: `factory/api/src/modules/fleet/service.ts`

- [ ] **Step 1: Update FleetModel — createDeploymentTargetBody**

In `factory/api/src/modules/fleet/model.ts`, add to `createDeploymentTargetBody`:

```typescript
    runtime: t.Optional(t.String()),
    hostId: t.Optional(t.String()),
    vmId: t.Optional(t.String()),
```

Add to `deploymentTargetQuery`:

```typescript
    runtime: t.Optional(t.String()),
```

- [ ] **Step 2: Update createWorkloadBody**

Add to `createWorkloadBody`:

```typescript
    desiredArtifactUri: t.Optional(t.String()),
```

- [ ] **Step 3: Update fleet service to pass runtime/hostId/vmId**

In `factory/api/src/modules/fleet/service.ts`, find the `createDeploymentTarget` function and ensure it passes the new fields through to the insert:

```typescript
runtime: opts.runtime ?? "kubernetes",
hostId: opts.hostId ?? null,
vmId: opts.vmId ?? null,
```

Similarly for `createWorkload`, pass `desiredArtifactUri` through.

- [ ] **Step 4: Run tests**

Run: `cd factory/api && npx vitest run 2>&1 | tail -30`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add factory/api/src/modules/fleet/model.ts factory/api/src/modules/fleet/service.ts
git commit -m "feat(fleet): support runtime, hostId, vmId on deployment targets"
```

---

### Task 12: Write Runtime Strategy Dispatch Tests

**Files:**

- Create: `factory/api/src/__tests__/runtime-strategies.test.ts`

- [ ] **Step 1: Write tests for strategy registry**

```typescript
import { describe, expect, it, beforeEach } from "vitest"
import {
  getRuntimeStrategy,
  registerRuntimeStrategy,
} from "../reconciler/runtime-strategy"
import { NoopStrategy } from "../reconciler/strategies/noop"
import { ComposeStrategy } from "../reconciler/strategies/compose"
import { SystemdStrategy } from "../reconciler/strategies/systemd"
import {
  WindowsServiceStrategy,
  IisStrategy,
} from "../reconciler/strategies/windows"

describe("Runtime Strategy Registry", () => {
  beforeEach(() => {
    // Register strategies for each test
    registerRuntimeStrategy("compose", () => new ComposeStrategy())
    registerRuntimeStrategy("systemd", () => new SystemdStrategy())
    registerRuntimeStrategy(
      "windows_service",
      () => new WindowsServiceStrategy()
    )
    registerRuntimeStrategy("iis", () => new IisStrategy())
    registerRuntimeStrategy("process", () => new NoopStrategy())
  })

  it("returns compose strategy", () => {
    const strategy = getRuntimeStrategy("compose")
    expect(strategy.runtime).toBe("compose")
  })

  it("returns systemd strategy", () => {
    const strategy = getRuntimeStrategy("systemd")
    expect(strategy.runtime).toBe("systemd")
  })

  it("returns windows_service strategy", () => {
    const strategy = getRuntimeStrategy("windows_service")
    expect(strategy.runtime).toBe("windows_service")
  })

  it("returns iis strategy", () => {
    const strategy = getRuntimeStrategy("iis")
    expect(strategy.runtime).toBe("iis")
  })

  it("returns noop for process runtime", () => {
    const strategy = getRuntimeStrategy("process")
    expect(strategy.runtime).toBe("noop")
  })

  it("throws for unknown runtime", () => {
    expect(() => getRuntimeStrategy("unknown_runtime")).toThrow(
      /No strategy for runtime: unknown_runtime/
    )
  })
})

describe("NoopStrategy", () => {
  it("returns running for server component", async () => {
    const strategy = new NoopStrategy()
    const result = await strategy.reconcile({
      workload: {
        workloadId: "wl_test",
        desiredImage: "img:v1",
        replicas: 1,
        envOverrides: {},
        resourceOverrides: {},
        moduleVersionId: "mv_test",
      },
      component: {
        name: "my-service",
        kind: "server",
        ports: [{ name: "http", port: 8080, protocol: "http" }],
        healthcheck: null,
        isPublic: false,
        stateful: false,
        defaultCpu: "100m",
        defaultMemory: "128Mi",
        defaultReplicas: 1,
      },
      target: {
        deploymentTargetId: "dt_test",
        name: "test-target",
        kind: "production",
        runtime: "process",
        hostId: "host_test",
        vmId: null,
        clusterId: null,
        namespace: null,
      },
      moduleName: "test-module",
    })

    expect(result.status).toBe("running")
    expect(result.driftDetected).toBe(false)
  })

  it("returns completed for task component", async () => {
    const strategy = new NoopStrategy()
    const result = await strategy.reconcile({
      workload: {
        workloadId: "wl_test",
        desiredImage: "img:v1",
        replicas: 1,
        envOverrides: {},
        resourceOverrides: {},
        moduleVersionId: "mv_test",
      },
      component: {
        name: "my-task",
        kind: "task",
        ports: [],
        healthcheck: null,
        isPublic: false,
        stateful: false,
        defaultCpu: "100m",
        defaultMemory: "128Mi",
        defaultReplicas: 1,
      },
      target: {
        deploymentTargetId: "dt_test",
        name: "test-target",
        kind: "dev",
        runtime: "process",
        hostId: null,
        vmId: null,
        clusterId: null,
        namespace: null,
      },
      moduleName: "test-module",
    })

    expect(result.status).toBe("completed")
  })
})
```

- [ ] **Step 2: Run the new tests**

Run: `cd factory/api && npx vitest run src/__tests__/runtime-strategies.test.ts 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add factory/api/src/__tests__/runtime-strategies.test.ts
git commit -m "test(reconciler): add tests for runtime strategy registry and noop strategy"
```

---

### Task 13: Update Test Helpers (Truncate Statements)

**Files:**

- Modify: `factory/api/src/test-helpers.ts`

No new tables are being added, but the deployment_target table now has FK references to host and vm. The truncation order already handles this correctly (deployment_target is truncated before host and vm). No changes needed to the truncate statements.

- [ ] **Step 1: Verify all tests pass end-to-end**

Run: `cd factory/api && npx vitest run 2>&1 | tail -40`
Expected: All tests pass — no truncation issues.

- [ ] **Step 2: Commit (only if changes were needed)**

If no changes were needed, skip this commit.

---

### Task 14: Run Full Test Suite and Fix Any Issues

**Files:**

- All modified files

- [ ] **Step 1: Run full test suite**

Run: `cd factory/api && npx vitest run 2>&1`
Expected: All tests pass.

- [ ] **Step 2: Fix any failing tests**

If any tests fail, trace the failure to the specific schema mismatch or import issue and fix it. Common issues:

- Existing tests that insert `componentSpec` with `kind: "deployment"` need to change to `kind: "server"`
- Existing tests that insert `componentSpec` with `port: 8080` need to change to `ports: [...]`
- Existing tests that insert `componentSpec` with `healthcheckPath: "..."` need to change to `healthcheck: {...}`
- Existing tests that check for Deployment K8s resources when kind is "deployment" need kind updated
- Any code referencing `sshUser` on VMs needs to use `accessUser` instead
- Import paths for moved code

- [ ] **Step 3: Run tests again**

Run: `cd factory/api && npx vitest run 2>&1`
Expected: All tests pass.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "fix: resolve test failures from platform-agnostic component model refactor"
```

---

## Summary of Changes

| Area                           | Before                                        | After                                                                   |
| ------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------- |
| **componentSpec.kind**         | `deployment`, `statefulset`, `job`, `cronjob` | `server`, `worker`, `task`, `scheduled`, `site`, `database`, `gateway`  |
| **componentSpec.stateful**     | N/A                                           | `boolean` (default false)                                               |
| **componentSpec.ports**        | Single `port` integer                         | `ports` JSONB array: `[{ name, port, protocol }]`                       |
| **componentSpec.healthcheck**  | `healthcheckPath` string                      | `healthcheck` JSONB: `{ path, portName, protocol }`                     |
| **deploymentTarget.runtime**   | N/A (always K8s)                              | `kubernetes`, `compose`, `systemd`, `windows_service`, `iis`, `process` |
| **deploymentTarget targeting** | `clusterId` + `namespace` only                | + `hostId`, `vmId` for direct host targeting                            |
| **artifact.kind**              | N/A (always container image)                  | `container_image`, `binary`, `archive`, `package`, `bundle`             |
| **host/vm**                    | No OS awareness                               | `osType` (`linux`/`windows`), `accessMethod` (`ssh`/`winrm`/`rdp`)      |
| **vm.sshUser**                 | `sshUser` column                              | Dropped; replaced by `accessUser` + `accessMethod`                      |
| **Reconciler**                 | Hardcoded K8s                                 | Strategy dispatch via `getRuntimeStrategy(target.runtime)`              |
| **Workload**                   | `desiredImage` only                           | + `desiredArtifactUri` for non-container artifacts                      |
