# Component, Instances, and the Deployment Spectrum

**Purpose:** Define exactly where `component` sits in the data model, how developer instances / sandboxes / previews / production all relate to the module/release/site model, and how the system handles the messy reality of production operations.

---

## 1. The Problem with the Previous Model

The unified architecture document said "module is the fundamental unit." That's true at the planning and commercial layer. But nobody deploys a module. Nobody restarts a module. Nobody reads the logs of a module. Nobody execs into a module.

You deploy, restart, log, exec, scale, and debug **components**. The api server. The worker. The frontend. The scheduler. The migration job. These are the real things — they're containers, processes, binaries. They're what's actually running on the cluster, and they're what breaks at 2am.

The module is a logical grouping. The component is the operational reality.

And then there's the question of *where* those components run. A developer running `dx dev` has their components in Docker Compose on localhost. A PR preview has those same components in an ephemeral K8s namespace. A production Site has those same components in a managed, governed, multi-tenant environment. The containers are the same. The context around them is wildly different.

The previous model was too clean. This document is the messy truth.

---

## 2. Component Is a First-Class Entity

### 2.1 What a Component Is

A **component** is a single independently deployable, scalable, operable process within a module. It is the smallest unit that:

- Has its own container image (or binary)
- Has its own Dockerfile and build configuration
- Has its own process lifecycle (start, stop, restart, crash)
- Has its own scaling knob (replicas)
- Has its own health check
- Has its own log stream
- Has its own resource allocation (CPU, memory)
- Has its own network exposure (port, or none for workers)
- Can be exec'd into, independently of other components

A module is made of one or more components. Most modules have 2-4.

### 2.2 Component Types

| Type | Has Port | Has Ingress | Scales Horizontally | Examples |
|---|---|---|---|---|
| **server** | yes | yes | yes | api, graphql, frontend, admin-ui |
| **worker** | no | no | yes | queue consumer, event processor, ETL worker |
| **cron** | no | no | no (single) | scheduler, cleanup job, report generator |
| **job** | no | no | no (run-to-completion) | migration, seed, one-time backfill |
| **daemon** | optional | no | per-node | log collector, monitoring sidecar |

### 2.3 Where Component Lives Across Planes

Component is not owned by one plane. It's a cross-plane entity with different facets at each layer:

```
Product Plane:     component_spec        (what this component IS — name, type, ownership)
Build Plane:       component_build       (how to build it — Dockerfile, build args)
                   component_artifact    (what was built — image digest, SBOM)
Fleet Plane:       component_deploy      (desired state — replicas, config, routes)
Runtime (Site):    component_instance    (actual state — pods, health, resource usage)
Infrastructure:    K8s resources          (Deployment, Service, IngressRoute, CronJob)
```

This is crucial: the same component entity appears at every layer, with different data at each. The `api` component is:

- A spec in `dx.yaml` (Product definition)
- A Dockerfile in `./services/api/` (Build input)
- A container image `billing-api:1.3.0` in the registry (Build output)
- A desired deployment with 3 replicas on Site trafficure-us-east (Fleet desired state)
- 3 running pods, 2 healthy, 1 restarting (Runtime actual state)
- A K8s Deployment + Service + IngressRoute (Infrastructure reality)

### 2.4 The Component Data Model

```
component_spec (Product Plane — lives in dx.yaml, synced to Factory DB)
──────────────
component_id            PK
module_id               FK → module
name                    "api", "worker", "frontend"
type                    server | worker | cron | job | daemon
port                    nullable (null for workers)
healthcheck_path        nullable ("/health")
public                  bool (needs external ingress?)
description             text
created_at              timestamp

component_build (Build Plane — lives in dx-component.yaml, synced to Factory DB)
───────────────
component_id            FK → component_spec
dockerfile              path relative to component
build_context           path
build_args              jsonb
dev_command              string (for dx dev)
dev_sync                 string[] (file sync paths for dx dev)
test_command             string
lint_command             string

component_artifact (Build Plane — produced by CI/builder)
──────────────────
artifact_id             PK
component_id            FK → component_spec
module_version_id       FK → module_version
image_ref               "registry.lepton.io/billing-api:1.3.0"
image_digest            "sha256:abc123..."
artifact_type           container | binary | bundle
size_bytes              bigint
sbom_ref                nullable
vuln_scan_status        clean | warnings | critical
created_at              timestamp
built_by                principal_id (human or agent)

component_deploy (Fleet Plane — desired state for a specific target)
────────────────
deploy_id               PK
component_id            FK → component_spec
target_id               FK → deployment_target (see section 3)
module_version_id       FK → module_version
artifact_id             FK → component_artifact
replicas                int
env_overrides           jsonb
resource_limits         jsonb (cpu, memory)
route_domain            nullable (for server types)
status                  desired | deploying | healthy | degraded | failed | stopped
created_at              timestamp
deployed_by             principal_id

component_instance (Runtime — actual state, observed from K8s or Docker)
──────────────────
instance_id             PK
deploy_id               FK → component_deploy
pod_name                string (K8s pod name, or Docker container ID)
node                    string (K8s node or "localhost")
status                  running | pending | crashloop | terminated | evicted
ready                   bool
restart_count           int
last_restart_reason     string nullable
started_at              timestamp
ip                      string (pod IP)
```

---

## 3. The Deployment Spectrum

Here's the key insight: developer instances, sandboxes, previews, and production Sites are all **the same thing at different governance levels.** They're all "a set of component instances running somewhere, with some configuration, for some purpose." What differs is who owns them, how long they live, what governs them, and what breaks if they die.

We model this with a single concept: **deployment_target**.

### 3.1 Deployment Target

A deployment target is anywhere components can run. It is the universal answer to "where are these containers?"

```
deployment_target
─────────────────
target_id               PK
type                    local | sandbox | site
name                    string (unique within type)
module_id               FK → module (what module this target runs)
cluster_id              FK → cluster (nullable for local)
namespace               string (K8s namespace, nullable for local)
owner_id                principal_id (who created/owns this)
trigger                 manual | pr | ci | fleet | agent
tier                    development | preview | staging | production
ttl                     interval nullable (null = permanent)
expires_at              timestamp nullable
status                  creating | active | degraded | suspended | destroying | destroyed
url                     string nullable (base URL for accessing this target)
config_snapshot         jsonb (resolved env vars at deploy time)
created_at              timestamp
destroyed_at            timestamp nullable
```

This single table holds every place components can run:

```
Local dev instance:
  type=local, tier=development, trigger=manual,
  owner=alice, ttl=null (lives until developer stops it),
  cluster=null, namespace=null

PR preview sandbox:
  type=sandbox, tier=preview, trigger=pr,
  owner=alice, ttl=48h, cluster=dev-cluster,
  namespace=billing--preview-pr-42,
  url=pr-42.billing.preview.lepton.io

Manual sandbox:
  type=sandbox, tier=development, trigger=manual,
  owner=bob, ttl=72h, cluster=dev-cluster,
  namespace=billing--sandbox-perf-test

Agent sandbox:
  type=sandbox, tier=development, trigger=agent,
  owner=agent-qa-runner, ttl=2h, cluster=dev-cluster,
  namespace=billing--sandbox-qa-run-789

Staging Site:
  type=site, tier=staging, trigger=fleet,
  owner=fleet, ttl=null, cluster=staging-cluster,
  namespace=billing--staging,
  url=staging.billing.lepton.io

Production Site (shared, multi-tenant):
  type=site, tier=production, trigger=fleet,
  owner=fleet, ttl=null, cluster=prod-cluster,
  namespace=trafficure--production,
  url=app.trafficure.com
```

### 3.2 The Spectrum Visualized

```
                 GOVERNANCE ──────────────────────────────────────►
                 (low)                                        (high)

  ┌──────────┐  ┌──────────────┐  ┌────────────┐  ┌─────────────┐
  │  Local    │  │   Sandbox    │  │  Staging    │  │ Production  │
  │  Dev      │  │  / Preview   │  │  Site       │  │ Site        │
  │           │  │              │  │             │  │             │
  │ Docker    │  │ K8s ns or VM │  │ K8s ns      │  │ K8s ns      │
  │ Compose   │  │              │  │             │  │             │
  │           │  │ Ephemeral    │  │ Persistent  │  │ Persistent  │
  │ No K8s    │  │ TTL-based    │  │ Fleet-      │  │ Fleet-      │
  │ No Fleet  │  │ Auto-cleanup │  │   managed   │  │   managed   │
  │ No auth   │  │ No tenants   │  │ No tenants  │  │ Tenants     │
  │ No audit  │  │ Basic auth   │  │ Full auth   │  │ Full auth   │
  │           │  │ No entitle-  │  │ Test        │  │ Entitle-    │
  │           │  │   ments      │  │   entitle-  │  │   ments     │
  │           │  │              │  │   ments     │  │ Audit       │
  │           │  │              │  │             │  │ SLA         │
  └──────────┘  └──────────────┘  └────────────┘  └─────────────┘

  trigger:       trigger:          trigger:         trigger:
    manual         pr/manual/        fleet            fleet
                   agent

  lifecycle:     lifecycle:         lifecycle:       lifecycle:
    dx dev         TTL or manual     release-driven   release-driven
    dx dev stop    dx sandbox        dx release       dx release
                   destroy           promote          promote
```

### 3.3 What's the Same Across the Spectrum

Regardless of where components run, the following are identical:

- **Component images.** The same `billing-api:1.3.0` image runs in local dev, sandbox, and production. Zero difference in the binary.
- **Component config structure.** Env vars, secrets, config files follow the same schema. Only the values differ (different DB URLs, different API keys).
- **Health checks.** Same `/health` endpoint, same logic.
- **Component types.** The api is still a server, the worker is still a worker.
- **Build artifacts.** Same Dockerfile, same build pipeline. You don't build differently for sandbox vs production.
- **dx commands.** `dx logs api`, `dx exec api`, `dx status` work the same way regardless of the target context. dx resolves the target.

### 3.4 What Differs Across the Spectrum

| Concern | Local Dev | Sandbox | Staging Site | Production Site |
|---|---|---|---|---|
| **Runtime** | Docker Compose | K8s namespace or VM | K8s namespace | K8s namespace |
| **Replicas** | 1 (always) | 1 (default) | configurable | configurable, autoscale |
| **Dependencies** | Local containers (postgres, redis) | Shared or ephemeral | Dedicated | Dedicated, replicated |
| **Data** | Local volumes, disposable | Ephemeral DB (seeded or snapshot) | Persistent, test data | Persistent, real customer data |
| **Auth** | None (or dev tokens) | Basic (platform auth) | Full (Better-Auth + SpiceDB) | Full |
| **Tenants** | None | None | None or test tenants | Real customer tenants |
| **Entitlements** | All modules enabled | All modules enabled | Test entitlements | Real entitlements from Commerce |
| **Audit** | None | Minimal | Full | Full, compliance-ready |
| **Observability** | Console logs | SigNoz (basic) | SigNoz (full) | SigNoz (full) + alerting |
| **Lifecycle** | Developer starts/stops | TTL + auto-cleanup | Fleet-managed releases | Fleet-managed releases |
| **Who triggers** | Developer (`dx dev`) | Developer / PR / Agent | Platform eng (`dx release promote`) | Platform eng (`dx release promote`) |
| **Convention gates** | None | Build must pass | Tests + review | Tests + review + staging-first + hours + cooldown |
| **Cost** | Developer machine | Shared cluster (cheap) | Shared or dedicated cluster | Dedicated cluster |

---

## 4. How Sandboxes Fit the Model

A sandbox is a `deployment_target` with `type=sandbox`. It is not a Site. It does not have tenants. It does not have a Control Plane governing it. It does not consume entitlements from Commerce.

A sandbox is: **a Fleet Plane resource that runs Build Plane artifacts on Infrastructure Plane compute, for the purpose of testing a module before it reaches a Site.**

### 4.1 Sandbox Lifecycle

```
Creation triggers:
  1. Developer runs `dx sandbox create feature-login`
  2. `dx push` creates a PR with auto-sandbox configured
  3. AI agent requests sandbox for QA run
  4. CI pipeline creates sandbox for integration testing

What happens:
  1. Build Plane builds artifacts for the module (or reuses existing)
  2. Fleet Plane creates a deployment_target (type=sandbox)
  3. Infrastructure Plane creates K8s namespace
  4. For each component in the module:
     → Fleet creates component_deploy (desired state)
     → Reconciler creates K8s Deployment + Service + IngressRoute
     → Reconciler waits for healthy
  5. For each dependency (postgres, redis):
     → Infrastructure Plane creates ephemeral instances
     → OR connects to shared dev instances
  6. Fleet records sandbox URL
  7. Developer gets notification with URL

Destruction:
  1. TTL expires → auto-cleanup cron job
  2. Developer runs `dx sandbox destroy`
  3. PR merged → linked sandbox destroyed
  4. Agent execution completes → sandbox destroyed
```

### 4.2 Sandbox Dependencies

This is where it gets real. A sandbox for the `billing` module needs postgres and redis. Options:

**Ephemeral dependencies (default):** Each sandbox gets its own postgres and redis containers in the same namespace. DB is seeded from migrations + seed data, or snapshot of production (sanitized). Dies with the sandbox.

**Shared dependencies:** Sandbox connects to a shared dev postgres/redis instance. Cheaper, faster to create, but sandboxes can interfere with each other. Use namespace-scoped schemas or database names for isolation.

**Production snapshot:** `dx sandbox create --snapshot-db` clones the production DB (sanitized), gives the sandbox its own copy. Expensive but accurate.

The dependency containers are also components — but they're **infrastructure components**, not module components. They belong to Infrastructure Plane, not to the module. In `dx.yaml`, they're declared under `dependencies`, not `components`.

```yaml
# dx.yaml
module: billing
components:           # Module components — your code
  api:
    path: ./services/api
    port: 8080
    type: server
  worker:
    path: ./services/worker
    type: worker

dependencies:         # Infrastructure components — not your code
  postgres:
    image: postgres:16-alpine
    port: 5432
    volumes: [data:/var/lib/postgresql/data]
  redis:
    image: redis:7-alpine
    port: 6379
```

In the data model, dependencies are tracked separately:

```
dependency_spec (Module definition — what this module needs to run)
───────────────
dependency_id           PK
module_id               FK → module
name                    "postgres", "redis", "elasticsearch"
image                   string
port                    int
config                  jsonb (env vars, volumes, etc.)

dependency_instance (Runtime — an actual running dependency)
───────────────────
instance_id             PK
dependency_id           FK → dependency_spec
target_id               FK → deployment_target
mode                    ephemeral | shared | external
connection_url          string (resolved at deploy time)
status                  running | pending | failed
```

For production Sites, dependencies are managed differently — they're Data Plane resources (managed postgres, managed redis), not ephemeral containers. The `dependency_spec` in `dx.yaml` is for local dev and sandboxes. Production Sites get their dependency configuration from Fleet Plane's site_configuration, which points to Data Plane managed resources.

---

## 5. How Production Releases Fit the Model

A production deployment goes through the Release → Rollout → Site path. Here's how it touches the component model:

### 5.1 Release Assembly

A release is a snapshot of module version pins. Each module version includes built artifacts for all its components.

```
Release v2.4.0
├── billing:1.3.0
│   ├── billing-api:1.3.0          (component_artifact)
│   ├── billing-worker:1.3.0       (component_artifact)
│   └── billing-frontend:1.3.0     (component_artifact)
├── auth:2.1.0
│   ├── auth-api:2.1.0
│   └── auth-worker:2.1.0
└── analytics:1.0.0
    ├── analytics-api:1.0.0
    ├── analytics-worker:1.0.0
    └── analytics-dashboard:1.0.0
```

### 5.2 Rollout Execution

When a release is promoted to a Site, Fleet creates a rollout. The rollout creates component_deploy records for every component in every module in the release. The reconciler then creates/updates K8s resources for each.

```
Rollout: release v2.4.0 → Site trafficure-us-east
│
├── component_deploy: billing-api         (artifact billing-api:1.3.0, 3 replicas)
├── component_deploy: billing-worker      (artifact billing-worker:1.3.0, 2 replicas)
├── component_deploy: billing-frontend    (artifact billing-frontend:1.3.0, 2 replicas)
├── component_deploy: auth-api            (artifact auth-api:2.1.0, 3 replicas)
├── component_deploy: auth-worker         (artifact auth-worker:2.1.0, 1 replica)
├── component_deploy: analytics-api       (artifact analytics-api:1.0.0, 2 replicas)
├── component_deploy: analytics-worker    (artifact analytics-worker:1.0.0, 2 replicas)
└── component_deploy: analytics-dashboard (artifact analytics-dashboard:1.0.0, 2 replicas)
```

Each `component_deploy` becomes one or more `component_instance` records as the reconciler creates pods and they start running.

### 5.3 The Rollout Is Also Immutable

Just like the original dx PRD's immutable deployments, each rollout gets a permanent identifier. You can always reference a specific rollout by ID. Rollback means creating a new rollout that points to the previous release's artifacts, not mutating anything.

```
Site: trafficure-us-east
├── Rollout history:
│   ├── rollout_001  release:v2.3.0  (was active, now superseded)
│   ├── rollout_002  release:v2.4.0  (currently active)
│   └── rollout_003  release:v2.4.1  (deploying, canary at 10%)
│
├── Active route:
│   app.trafficure.com → rollout_002 (90%) + rollout_003 (10%)
│
└── Rollback = create rollout_004 pointing to v2.3.0 artifacts. Instant.
```

---

## 6. The Messy Reality: Operating Components

### 6.1 The Ops Commands Work at Component Level

When something breaks, you don't care about modules or releases. You care about the broken container. Every operational command targets a component, optionally qualified by context:

```bash
# Basic — component name, dx figures out context from cwd or flags
dx logs api                           # logs for billing-api in current context
dx exec api -- bash                   # exec into billing-api pod
dx status api                         # health, replicas, restart count
dx ops restart api                    # restart billing-api pods
dx ops scale api --replicas 5         # scale billing-api

# Qualified — when you need to be specific
dx logs api --site trafficure-us-east            # specific site
dx logs api --sandbox feature-login              # specific sandbox
dx logs api --instance billing-api-pod-xyz       # specific pod

# Cross-component
dx status                             # all components in current module
dx status --site trafficure-us-east   # all components on that site
```

### 6.2 What Goes Wrong and How dx Handles It

**A component is crashlooping:**

```
$ dx status api --site trafficure-us-east

billing-api (server, 3 replicas)
  ✓ billing-api-abc12   running  (ready, 0 restarts)
  ✓ billing-api-def34   running  (ready, 0 restarts)
  ✗ billing-api-ghi56   crashloop (12 restarts, last: OOMKilled)
    Last log: "Fatal: heap out of memory allocating 2.1GB"
    Started: 2h ago, last crash: 4m ago

Troubleshoot:
  dx logs api --instance billing-api-ghi56 --previous
  dx exec api --instance billing-api-ghi56 -- sh  (if it stays up long enough)
  dx ops restart api --instance billing-api-ghi56
  dx ops scale api --replicas 4 --reason "compensating for OOM pod"
```

The system knows the specific pod, shows the specific error, and suggests the right operational commands — all at the component instance level.

**A hotfix needs to go out without a full release:**

This is the tension between the clean release model and production reality. Sometimes you need to push one component's image to one Site without assembling a full release.

```bash
# Emergency: deploy a single component artifact to a specific site
dx deploy api --artifact billing-api:1.3.1-hotfix --site trafficure-us-east \
  --force --reason "INCIDENT-456: fix OOM in query parser"
```

This creates a component_deploy record that breaks from the current release's pins. The system tracks this as **drift** — the Site is now running a mix of release v2.4.0 artifacts plus one hotfix artifact. The Fleet dashboard shows this drift clearly:

```
Site: trafficure-us-east
  Release: v2.4.0 (DRIFTED)
  Drift: billing-api pinned to 1.3.1-hotfix (INCIDENT-456)
  
  To resolve: include billing:1.3.1 in next release, or
              dx rollback api --site trafficure-us-east --to-release
```

Drift is not an error state. It's a tracked, audited, expected operational reality. The system's job is to make drift visible, not to prevent it.

**Someone manually scaled a component:**

```bash
dx ops scale worker --replicas 10 --site trafficure-us-east \
  --reason "handling Black Friday traffic spike"
```

This overrides the Fleet-managed replica count. The component_deploy record is updated with the manual override. The system tracks this as a **manual override**, distinct from drift:

```
component_deploy for billing-worker on trafficure-us-east:
  fleet_replicas: 2          (what the release says)
  actual_replicas: 10         (what's actually running)
  override: manual            (not from a release)
  override_by: alice@lepton
  override_reason: "handling Black Friday traffic spike"
  override_at: 2026-03-24T14:30:00Z
```

When the next release rolls out, it can either:
- **Reset overrides** (default): return to release-defined replicas
- **Preserve overrides** (`dx release promote --preserve-overrides`): keep manual changes

**Config was patched manually:**

```bash
dx env set API_RATE_LIMIT=5000 --component api --site trafficure-us-east \
  --reason "temporary increase for Samsung demo"
```

Same pattern: tracked as a manual override on the component_deploy, visible as drift, resolved on next release.

### 6.3 Desired State vs Actual State

The reconciler continuously compares desired state (component_deploy) to actual state (component_instance observed from K8s). Discrepancies are reported, not automatically fixed — because sometimes the discrepancy IS the fix (manual override during incident).

```
component_deploy (desired):
  artifact: billing-api:1.3.0
  replicas: 3
  env: {API_RATE_LIMIT: 1000}

component_instance (actual, from K8s):
  pod billing-api-abc12: running, image billing-api:1.3.0  ✓
  pod billing-api-def34: running, image billing-api:1.3.0  ✓
  pod billing-api-ghi56: running, image billing-api:1.3.1-hotfix  ✗ DRIFT
  actual replicas: 3 ✓
  env: {API_RATE_LIMIT: 5000}  ✗ OVERRIDE

Drift report:
  - Image drift on 1/3 pods (hotfix applied)
  - Config override on API_RATE_LIMIT (temporary increase)
  Both have audit-logged reasons.
```

### 6.4 The Audit Trail Is at Component Level

Every action on a component is logged:

```
audit_event:
  target_type: component
  target_id: billing-api
  target_context: site/trafficure-us-east
  action: scale
  before: {replicas: 2}
  after: {replicas: 10}
  actor: alice@lepton.io
  reason: "handling Black Friday traffic spike"
  timestamp: 2026-03-24T14:30:00Z
  override: true
  convention_bypass: false
```

---

## 7. The Complete Entity Relationship

Here's how component connects to everything:

```
PRODUCT PLANE
  module ──── 1:N ──── component_spec
                         │
BUILD PLANE              │
  module_version ─ 1:N ─ component_artifact ── (built from component_spec)
                         │
FLEET PLANE              │
  release ── 1:N ── release_module_pin ── N:1 ── module_version
                         │
  deployment_target ─ 1:N ─ component_deploy ── (artifact + config + replicas)
       │                         │
       │                         │
  (sandbox, site,           N:1 ─ component_artifact
   local, etc.)                  │
                                 │
RUNTIME                          │
  component_deploy ── 1:N ── component_instance (actual pods/containers)
                                 │
INFRASTRUCTURE                   │
  K8s Deployment  ◄───────── (reconciler translates component_deploy to K8s)
  K8s Service     ◄─────────
  K8s IngressRoute◄─────────
  K8s CronJob     ◄─────────


DEPENDENCIES (separate from module components)
  module ── 1:N ── dependency_spec (postgres, redis, etc.)
                       │
  deployment_target ─ 1:N ─ dependency_instance
                               │
                          mode: ephemeral (sandbox containers)
                                shared (dev shared instance)
                                external (managed by Data Plane / Site)
```

### 7.1 The Join Table: release_module_pin to component_artifact

When a release is assembled, the release pins module versions. Each module version already has its component artifacts. So the release implicitly determines every component artifact across every module. But the **deployment** creates explicit component_deploy records, because:

- Replicas may differ per site
- Config may differ per site/tier
- A hotfix may override one component's artifact
- A manual scaling may override one component's replicas

The component_deploy is the mutable, per-target deployment record. The release is the immutable, per-version intent.

### 7.2 How dx.yaml Maps to the Data Model

```yaml
# dx.yaml
module: billing                    → module (Product Plane)
team: platform-eng
product: trafficure

components:                        → component_spec[] (Product Plane)
  api:                             → component_spec(name=api, type=server)
    path: ./services/api
    port: 8080
    type: server
    healthcheck: /health
  worker:                          → component_spec(name=worker, type=worker)
    path: ./services/worker
    type: worker
  frontend:                        → component_spec(name=frontend, type=server)
    path: ./services/frontend
    port: 3000
    type: server

dependencies:                      → dependency_spec[] (Module definition)
  postgres:                        → dependency_spec(name=postgres)
    image: postgres:16-alpine
    port: 5432
  redis:                           → dependency_spec(name=redis)
    image: redis:7-alpine
    port: 6379
```

```yaml
# services/api/dx-component.yaml  → component_build
build:
  dockerfile: Dockerfile
  args:
    GO_VERSION: "1.23"
dev:
  command: uvicorn main:app --reload --port 8080
  sync: [./:/app]
test: pytest tests/
lint: ruff check .
```

---

## 8. How `dx deploy` Actually Works (Unified)

With this model, `dx deploy` works the same way across all targets. The difference is just which `deployment_target` it resolves to:

```bash
# Developer deploying to sandbox (Build Plane → sandbox target)
dx deploy --sandbox feature-login

# Developer deploying to their default dev site (Build Plane → sandbox target)  
dx deploy

# Platform engineer promoting a release to staging (Fleet Plane → site targets)
dx release promote v2.4.0 --tier staging

# Emergency hotfix to one component on one site
dx deploy api --artifact billing-api:1.3.1-hotfix --site trafficure-us-east \
  --force --reason "INCIDENT-456"
```

Under the hood, all of these:

1. **Resolve target** — which `deployment_target` are we deploying to?
2. **Resolve artifacts** — which `component_artifact` for each component?
3. **Resolve config** — merge tier defaults + site overrides + manual overrides
4. **Create/update component_deploy records** — desired state per component
5. **Reconciler picks up changes** — creates/updates K8s resources
6. **Wait for healthy** (if `--wait`)
7. **Report** — URLs, health, drift if any

The single-component emergency deploy is just step 2-6 for one component instead of all.

---

## 9. How `dx dev` Fits

Local dev is the one case that doesn't go through Fleet or Infrastructure Plane. It's purely Build Plane + local machine.

```bash
dx dev
```

1. Read `dx.yaml` — get component_specs and dependency_specs
2. Read each component's `dx-component.yaml` — get dev commands and sync paths
3. Generate `docker-compose.yaml`:
   - Each component → a Docker Compose service with `dev.command`, file sync, port mapping
   - Each dependency → a Docker Compose service with the specified image
   - Service discovery env vars auto-generated (API_URL, POSTGRES_URL, etc.)
4. Run `docker compose up`

No deployment_target record is created in the Factory DB (unless the developer explicitly registers their local instance — optional for fleet visibility). No reconciler. No K8s. Pure Docker.

But the developer can still use `dx status`, `dx logs`, `dx exec` — dx detects it's in local mode and talks to Docker instead of K8s.

```bash
dx status                    # shows Docker Compose container status
dx logs api                  # docker compose logs api
dx exec api -- bash          # docker compose exec api bash
dx logs postgres             # docker compose logs postgres (dependency)
```

Same commands. Same mental model. Different runtime.

---

## 10. Summary: Where Component Sits

Component is not a "nice to have" or "optional granularity." It is the operational atom of the entire system.

| Layer | What matters | Entity |
|---|---|---|
| **Planning** | Module (what capability are we building?) | module, component_spec |
| **Building** | Component (what containers are we producing?) | component_artifact |
| **Releasing** | Module version (what versions are we pinning?) | release_module_pin → module_version → component_artifact |
| **Deploying** | Component (what's the desired state per container?) | component_deploy |
| **Running** | Component instance (what's actually running?) | component_instance |
| **Operating** | Component instance (what's broken? what do I restart?) | component_instance |
| **Debugging** | Component instance (which pod do I exec into?) | component_instance |

Module is the planning unit. Release is the coordination unit. **Component is the operational unit.**

The system needs to think in modules when planning and coordinating, and think in components when deploying and operating. Every CLI command that touches running infrastructure (`dx logs`, `dx exec`, `dx ops restart`, `dx ops scale`, `dx status`, `dx deploy`) resolves to a component or component instance, not a module.
