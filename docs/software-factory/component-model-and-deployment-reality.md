# The Component Model & Deployment Reality

**What this document answers:** Where does "component" live in the data model? How do dev instances, preview deployments, agent sandboxes, and production Sites all relate? What happens when things go wrong and someone needs to manually fix a running deployment?

---

## 1. The Problem With the Current Model

The existing entity model has a gap in the middle. Watch what happens when you trace from "product manager defines a capability" to "container is running in K8s":

```
Product Plane:     module (logical capability: "geoanalytics")
                      ↓
Build Plane:       module_version (v2.3.0)
                      ↓
                   artifact (container image: geoanalytics-api:2.3.0)
                      ↓
Fleet Plane:       release (v2.4.0 pins geoanalytics:2.3.0 + auth:1.4.0 + ...)
                      ↓
                   rollout → site
                      ↓
Site Service:      module_instance (geoanalytics enabled in namespace samsung)
                      ↓
                   ??? ← what actually runs?
                      ↓
K8s:               Deployment, Pod, Service, IngressRoute, Secret, ConfigMap
```

The `???` is the gap. `module_instance` says "geoanalytics is enabled here" but doesn't describe what containers run, what ports they expose, what env vars they need, how health checks work, or how the api server relates to the worker. The entity-relationships doc has `service` under `module_instance` marked as "(optional granularity)" — but it's not optional. It's where all the actual deployment decisions happen.

Meanwhile, when a developer runs `dx dev` or `dx deploy` from their branch, they're not creating a `module_instance` or going through Fleet Plane at all. They're just saying "build my code and put it somewhere." The Release → Site model doesn't account for this.

---

## 2. Component: The Missing Entity

### What a component is

A **component** is a single deployable process within a module. It maps 1:1 to a container image, and at runtime it maps 1:1 to a K8s workload (Deployment, StatefulSet, Job, or CronJob).

A module has one or more components. The component is where the logical module meets the physical infrastructure.

```
module: geoanalytics
├── component: api          → runs as K8s Deployment, port 8080, has ingress
├── component: worker       → runs as K8s Deployment, no port, no ingress
├── component: scheduler    → runs as K8s CronJob, triggers hourly
└── component: migrator     → runs as K8s Job, runs once per deploy
```

### Why it's not optional

Without the component entity, the reconciler can't answer basic questions:
- How many containers does this module need?
- Which ones get ingress routes?
- Which ones are workers with no port?
- What's the health check endpoint for the api?
- What resources (CPU/memory) does each process need?
- Which component failed when the pod crashed?

`module_instance` says "geoanalytics runs here." Component says "geoanalytics runs here as an api on port 8080, a worker pulling from a queue, and a scheduler firing hourly."

### Where component lives in the model

Component is defined in two places and tracked in a third:

**1. Declared in code (docker-compose.yaml) — Build Plane concern**

The module author declares what the module ships. This is checked into git and is the source of truth for what a module version contains.

```yaml
# docker-compose.yaml
module: geoanalytics
team: analytics-eng

components:
  api:
    path: ./services/api
    port: 8080
    healthcheck: /health
    resources:
      cpu: 500m
      memory: 512Mi
  worker:
    path: ./services/worker
    worker: true                # no port, no ingress
    resources:
      cpu: 1000m
      memory: 1Gi
  scheduler:
    path: ./services/scheduler
    cron: "0 * * * *"           # hourly
  migrator:
    path: ./migrations
    job: true                   # run-once per deployment
    order: before               # runs before other components start
```

**2. Recorded in Factory DB — Build Plane system of record**

When a module version is created (after build + test + merge), its component manifest is stored. This is the bill of materials for what a module version actually ships.

```
component
─────────
component_id          PK
module_id             FK → module
name                  "api", "worker", "scheduler", "migrator"
kind                  deployment | statefulset | job | cronjob
port                  nullable (workers/jobs have no port)
healthcheck_path      nullable
is_public             boolean (gets ingress route or not)
run_order             nullable ("before", "after", null for parallel)
default_replicas      integer
default_cpu           resource string
default_memory        resource string
created_at            timestamp
```

```
component_artifact
──────────────────
component_artifact_id   PK
module_version_id       FK → module_version
component_id            FK → component
artifact_id             FK → artifact (the built image)
```

This is the join that the model was missing. A `module_version` produces N `artifacts`, one per component. `component_artifact` records which artifact corresponds to which component in which version.

**3. Instantiated at runtime — Fleet Plane / Site concern**

When a module is deployed (whether to a production Site, a sandbox, or a dev namespace), each component becomes a **workload**:

```
workload
────────
workload_id               PK
deployment_target_id      FK → deployment_target (see section 3)
module_version_id         FK → module_version
component_id              FK → component
artifact_id               FK → artifact (usually from component_artifact, but can be overridden)
replicas                  integer (can differ from default)
env_overrides             jsonb (merged with module-level config)
resource_overrides        jsonb (can differ from default)
status                    provisioning | running | degraded | stopped | failed | completed
desired_image             text (the image the reconciler wants)
actual_image              text (the image actually running — can differ if manually patched)
last_reconciled_at        timestamp
drift_detected            boolean
created_at                timestamp
updated_at                timestamp
```

The `desired_image` vs `actual_image` distinction is critical. In the clean world they're always identical. In the messy world, someone did `dx ops override geoanalytics-api --image registry/geoanalytics-api:hotfix-42` at 3am and they've diverged.

### The full component chain

```
DEFINE (code)
  docker-compose.yaml → components: [api, worker, scheduler, migrator]

BUILD (Build Plane)
  module_version 1 ── N component_artifact
  component_artifact N ── 1 component
  component_artifact N ── 1 artifact

DEPLOY (Fleet Plane)
  deployment_target 1 ── N workload
  workload N ── 1 component
  workload N ── 1 artifact (usually matches component_artifact, can diverge)

RUN (Infrastructure Plane / K8s)
  workload 1 ── 1 K8s Deployment|StatefulSet|Job|CronJob
  K8s Deployment 1 ── N Pod
  Pod 1 ── 1 Container (the actual running process)
```

---

## 3. Deployment Target: The Unifying Concept

Here's the key insight: **a developer's sandbox, a PR preview, an agent's test environment, a staging Site, and a production Site are all the same thing at the infrastructure layer.** They're all a namespace running workloads. The differences are:

- Who created it and why
- How long it lives
- What modules/components are in it
- What policies govern it
- Whether it serves real customers

We call this a **deployment target**.

```
deployment_target
─────────────────
deployment_target_id    PK
name                    text ("trafficure-prod-india", "sandbox-pr-42", "dev-nikhil-billing")
kind                    production | staging | sandbox | dev
site_id                 FK → site (nullable — sandboxes and dev targets may not belong to a customer-facing Site)
cluster_id              FK → cluster (which K8s cluster)
namespace               text (the K8s namespace name)
created_by              FK → principal (who/what created it)
trigger                 manual | pr | release | agent | ci
ttl                     interval (nullable — production targets don't expire)
expires_at              timestamp (nullable)
tier_policies           jsonb (what conventions/gates apply)
status                  provisioning | active | suspended | destroying | destroyed
labels                  jsonb
created_at              timestamp
destroyed_at            timestamp (nullable)
```

### The five kinds of deployment target

**1. Production target** — belongs to a Site, serves real tenants, has full policies.

```
deployment_target:
  name: trafficure-prod-india
  kind: production
  site_id: site_trafficure_india
  cluster_id: cluster_prod_mumbai
  namespace: trafficure-prod-india
  trigger: release
  ttl: null
  tier_policies: { require_release: true, require_review: true, canary: true }
```

Created by Fleet Plane when a Site is provisioned. Lives forever (until Site is decommissioned). All modules deployed through the Release → Rollout ceremony. Full Control Plane governance (auth, tenant isolation, entitlements, audit).

**2. Staging target** — belongs to a Site (or a shared staging Site), has moderate policies.

```
deployment_target:
  name: trafficure-staging
  kind: staging
  site_id: site_trafficure_staging
  cluster_id: cluster_staging
  namespace: trafficure-staging
  trigger: release
  ttl: null
  tier_policies: { require_passing_tests: true, require_review: false }
```

Created by Fleet Plane. Lives forever. Can receive both release-based deployments and individual module deploys for integration testing. Control Plane is present but with relaxed policies.

**3. Sandbox target** — ephemeral, created on PR or demand, has minimal policies.

```
deployment_target:
  name: sandbox-pr-42-billing
  kind: sandbox
  site_id: null                           # not part of a customer-facing Site
  cluster_id: cluster_dev
  namespace: sandbox-pr-42-billing
  created_by: principal_alice
  trigger: pr
  ttl: 48h
  expires_at: 2026-03-26T14:00:00Z
  tier_policies: { require_passing_tests: false }
```

Created by Build Plane automation when a PR is opened, or manually via `dx sandbox create`. Destroyed on TTL expiry or PR merge. Contains a single module (the one being changed), plus its dependencies (shared infrastructure containers). No Control Plane (no tenants, no auth — it's for the developer to test against). Has its own ephemeral database, optionally seeded from a snapshot.

**4. Dev target** — personal, long-lived, completely open.

```
deployment_target:
  name: dev-nikhil-billing
  kind: dev
  site_id: null
  cluster_id: cluster_dev
  namespace: dev-nikhil-billing
  created_by: principal_nikhil
  trigger: manual
  ttl: 7d                                # auto-cleanup after inactivity
  tier_policies: {}                      # no gates at all
```

Created by `dx deploy --dev` or `dx sandbox create --persistent`. A developer's personal remote dev environment. Can be updated by pushing individual components without a full build — `dx deploy api --dev` rebuilds just the api container and swaps it. No policies, no gates, no review required. The escape hatch is maximally open.

**5. Agent target** — ephemeral, created by automation, scoped to agent identity.

```
deployment_target:
  name: agent-qa-billing-run-847
  kind: sandbox
  site_id: null
  cluster_id: cluster_dev
  namespace: agent-qa-billing-run-847
  created_by: principal_agent_qa_runner
  trigger: agent
  ttl: 2h
  tier_policies: {}
```

Created by Agent Plane when a QA agent needs a running environment to test against, or when a code agent needs to validate its changes. Functionally identical to a sandbox but attributed to an agent principal. Auto-destroyed after the agent execution completes.

### What they all share

Every deployment target, regardless of kind, has:

- A K8s namespace
- One or more workloads (running component artifacts)
- Resolved environment variables
- A set of routes (ingress rules, even if just `*.dev.internal`)
- A status
- An audit trail (who created it, who deployed to it, what changed)

The reconciler doesn't care what kind of target it's reconciling. It sees a `deployment_target` with a set of `workloads`, each with a `desired_image`, and it makes K8s match. The same code path handles production, staging, sandbox, dev, and agent targets.

---

## 4. Two Deployment Paths

The architecture needs two paths into a deployment target. The ceremony path for production. The fast path for everything else.

### Path A: Release ceremony (Fleet Plane → Production/Staging)

```
module_versions are ready
        ↓
dx release create v2.4.0
  pins: geoanalytics:2.3.0, auth:1.4.0, workflow:3.1.0
        ↓
release record created in Factory DB
  with release_module_pin rows for each module version
        ↓
dx release promote v2.4.0 --to staging
        ↓
Fleet creates rollout for each staging deployment_target
  rollout references the release
        ↓
For each module in the release:
  For each component in the module:
    Fleet creates/updates workload row in that deployment_target
    workload.desired_image = component_artifact.artifact.image_ref
        ↓
Reconciler picks up workload changes
  Generates K8s resources (Deployment, Service, IngressRoute, Secret)
  Applies via server-side apply
  Watches for healthy
        ↓
Fleet updates rollout_step status
  If all components healthy → rollout succeeds
  If any component fails → auto-rollback (restore previous workload.desired_image)
```

This path is what ships to customers. It's audited. It respects conventions. It goes through gates.

### Path B: Direct deploy (Build Plane → Sandbox/Dev/Staging-for-testing)

```
Developer working on geoanalytics, on branch feature/BILL-245-rate-limiting
        ↓
dx deploy api                          # or: dx push (which auto-creates sandbox)
        ↓
Build Plane builds the api component from the current branch
  artifact: registry/geoanalytics-api:branch-feature-BILL-245-abc123
        ↓
Resolve deployment target:
  If --dev → dev-nikhil-geoanalytics (create if doesn't exist)
  If --sandbox <name> → sandbox-<name>
  If no flag → auto from context:
    - In PR branch? → sandbox-pr-<number>
    - Default → personal dev target
        ↓
Create/update workload in that deployment target
  workload.desired_image = the branch artifact
  Only the api component is updated — worker/scheduler stay on previous image
        ↓
Reconciler picks up change
  Same code path as production — generates K8s resources, applies, waits
        ↓
Developer gets URL:
  https://sandbox-pr-42--api.geoanalytics.dev.internal
```

This path is fast. No release ceremony. No multi-module bundling. One component at a time if needed. No production policies. But the same reconciler, the same K8s resource builder, the same workload data model.

### The critical point

**Both paths write to the same `workload` table. Both paths are reconciled by the same reconciler.** The deployment target's `kind` and `tier_policies` determine what gates apply, not a separate code path. This means:

- A sandbox and a production Site are structurally identical at the infra layer
- Promoting a sandbox to staging means updating the deployment target's kind and policies (or, more precisely, taking the tested artifacts and including them in a release that gets deployed to staging through Path A)
- Every deployment, no matter how casual, has an audit trail

---

## 5. The Dependencies Problem

A module doesn't run alone. The geoanalytics api needs PostgreSQL, Redis, maybe an S3 bucket. In production, these are shared infrastructure managed by Data Plane. In a sandbox, they need to be provisioned on-demand.

### Dependency declaration

```yaml
# docker-compose.yaml
module: geoanalytics

components:
  api:
    path: ./services/api
    port: 8080

dependencies:
  postgres:
    image: postgis/postgis:16-3.4
    port: 5432
    env:
      POSTGRES_DB: geoanalytics
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
    volumes:
      - data:/var/lib/postgresql/data
    healthcheck: "pg_isready -U dev"
  redis:
    image: redis:7-alpine
    port: 6379
```

### How dependencies are handled per target kind

| Target Kind | Dependencies | How |
|---|---|---|
| **`dx dev` (local)** | Docker Compose containers on laptop | dx generates `docker-compose.yaml` from the dependency block. `docker ps` shows them. |
| **Sandbox** | Ephemeral containers in the sandbox namespace | dx creates K8s Deployments for each dependency in the sandbox namespace. Cheap, isolated, disposable. |
| **Dev (remote)** | Same as sandbox — ephemeral containers | Each dev target gets its own dependency instances. |
| **Staging** | Shared infrastructure | Dependencies resolve to shared staging databases. `DATABASE_URL` points to staging Postgres, not an ephemeral one. The env overlay in `.dx/tiers/staging.yaml` handles this. |
| **Production** | Managed infrastructure (Data Plane) | Dependencies resolve to production databases managed by Data Plane. RLS, backups, the works. Env overlays in `.dx/tiers/production.yaml`. |

At the workload level, the distinction is just env vars. The api component's `DATABASE_URL` points to `localhost:5432` in local dev, to `postgres.sandbox-pr-42.svc:5432` in a sandbox, and to `prod-postgres.data.svc:5432` in production. Same container image, different configuration.

Dependencies in sandboxes/dev targets are themselves workloads — they show up in the workload table with `component_id = null` (they're not module components, they're infrastructure dependencies). The reconciler manages them the same way.

---

## 6. The Messy Reality: Drift, Overrides, and Manual Fixes

Production breaks. Someone needs to exec into a container at 2am. Someone needs to roll back a single component while the rest of the release stays. Someone pushes a hotfix image manually because the build pipeline is down. The architecture must handle all of this without pretending it won't happen.

### 6.1 Workload overrides

Any workload can be overridden — image, replicas, env vars, resources — without going through the release ceremony.

```bash
# Override the image for one component in one target
dx ops override geoanalytics api \
  --site trafficure-prod-india \
  --image registry/geoanalytics-api:hotfix-42 \
  --reason "Critical fix for rate limiting bug, pipeline is down"

# Override replicas
dx ops scale geoanalytics api --site trafficure-prod-india --replicas 5

# Override env var
dx ops env set geoanalytics api \
  --site trafficure-prod-india \
  --key RATE_LIMIT \
  --value 500 \
  --reason "Temporary increase during traffic spike"
```

Every override:
- Requires `--reason` (logged in audit)
- Updates `workload.desired_image` (or replicas, or env_overrides)
- Is reconciled immediately
- Sets `workload.drift_detected = true` (desired_image differs from what the release says)
- Appears in `dx status` as a drift warning

```
workload_override
─────────────────
override_id           PK
workload_id           FK → workload
field                 "image" | "replicas" | "env" | "resources"
previous_value        jsonb
new_value             jsonb
reason                text (required)
created_by            FK → principal
created_at            timestamp
reverted_at           timestamp (nullable)
reverted_by           FK → principal (nullable)
```

### 6.2 Drift detection and resolution

The reconciler continuously compares `workload.desired_image` against what's actually running in K8s. When they diverge (someone used `kubectl` directly, or an override is in place), it records the drift.

```bash
dx status --site trafficure-prod-india

  geoanalytics
    api:        running (3 replicas)  ⚠ DRIFT — image override active since 03:42
                desired: registry/geoanalytics-api:hotfix-42 (override)
                release: registry/geoanalytics-api:2.3.0
    worker:     running (2 replicas)  ✓
    scheduler:  running               ✓

  auth
    api:        running (2 replicas)  ✓
    ...
```

Drift is resolved in three ways:

1. **Revert the override:** `dx ops revert geoanalytics api --site trafficure-prod-india` — restores `desired_image` to what the current release says.

2. **Include the fix in the next release:** The hotfix gets merged, a new module version is built, the next release includes it. When that release rolls out, the workload's `desired_image` updates to the release version, override is automatically cleared.

3. **Acknowledge the drift:** `dx ops acknowledge geoanalytics api --site trafficure-prod-india --reason "Running hotfix until v2.3.1 ships"` — drift is still tracked but the warning is muted.

### 6.3 Manual intervention audit trail

Every manual action on a running deployment target is recorded:

```
intervention
────────────
intervention_id       PK
deployment_target_id  FK → deployment_target
workload_id           FK → workload (nullable — some interventions are target-wide)
action                override_image | scale | restart | exec | env_change | drain | acknowledge_drift
principal_id          FK → principal
reason                text
details               jsonb (what specifically changed)
created_at            timestamp
```

`dx exec` into a production pod? Logged. `dx ops restart`? Logged. `kubectl` directly (detected by reconciler as unexpected pod restart)? Logged as unattributed drift.

### 6.4 Partial rollback

In production, you don't always roll back the entire release. Sometimes one module's new version is broken and the rest are fine.

```bash
# Roll back just geoanalytics to its previous version, keep auth and workflow at current
dx rollback geoanalytics --site trafficure-prod-india

# This:
# 1. Looks up the previous release's geoanalytics module_version
# 2. For each geoanalytics component, updates workload.desired_image to the previous artifact
# 3. Records as override (drift from current release)
# 4. Reconciler swaps the containers
```

This is semantically an override (the deployment target is now running a mix of two releases), tracked as drift, and resolved when the next release ships.

### 6.5 The status command as ground truth

`dx status` must always show the actual running state, not the desired state. It queries both the Factory DB (what we think is running) and K8s (what's actually running) and shows discrepancies.

```bash
dx status geoanalytics --site trafficure-prod-india --detail

  Module: geoanalytics
  Release pin: v2.3.0 (from release v2.4.0)
  
  Components:
    api (Deployment)
      Desired:  3 replicas, registry/geoanalytics-api:2.3.0
      Actual:   3 replicas, registry/geoanalytics-api:hotfix-42  ⚠ OVERRIDE
      Override: by nikhil@lepton.io at 03:42, reason: "Rate limit bug hotfix"
      Pods:
        geoanalytics-api-7b9f4-xk2m   Running  (12h)  10.0.1.42
        geoanalytics-api-7b9f4-p3qn   Running  (12h)  10.0.1.43
        geoanalytics-api-7b9f4-w8rv   Running  (12h)  10.0.1.44
      Health: 3/3 passing, avg response 23ms
    
    worker (Deployment)
      Desired:  2 replicas, registry/geoanalytics-worker:2.3.0
      Actual:   2 replicas, registry/geoanalytics-worker:2.3.0  ✓
      Pods:
        geoanalytics-worker-5c8d2-j4kl  Running  (3d)  10.0.1.45
        geoanalytics-worker-5c8d2-m7np  Running  (3d)  10.0.1.46
      Queue depth: 142, processing rate: 47/min
    
    scheduler (CronJob)
      Desired:  registry/geoanalytics-scheduler:2.3.0
      Actual:   registry/geoanalytics-scheduler:2.3.0  ✓
      Last run: 14 min ago, succeeded (duration: 3m22s)
      Next run: in 46 min
    
    migrator (Job)
      Last run: 3 days ago (on deploy), succeeded
```

---

## 7. The Complete Data Model

Putting it all together. These are the entities that span Build Plane → Fleet Plane → Infrastructure Plane:

```
BUILD PLANE (what we ship)
──────────────────────────

module                          The logical capability
  module_id, name, team, product, lifecycle_state

component                       A deployable process within a module
  component_id, module_id, name, kind, port, healthcheck,
  is_public, run_order, default_replicas, default_cpu, default_memory

module_version                  A specific buildable version
  module_version_id, module_id, version, compatibility_range, schema_version

artifact                        A built image/binary/bundle
  artifact_id, image_ref, image_digest, size, built_at

component_artifact              Which artifact is which component in a version
  component_artifact_id, module_version_id, component_id, artifact_id


FLEET PLANE (where it runs)
───────────────────────────

release                         A bundle of module version pins
  release_id, version, status, created_by, created_at

release_module_pin              Which module versions are in a release
  release_module_pin_id, release_id, module_version_id

deployment_target               A namespace where workloads run
  deployment_target_id, name, kind, site_id, cluster_id, namespace,
  created_by, trigger, ttl, expires_at, tier_policies, status

rollout                         The act of deploying a release to a target
  rollout_id, release_id, deployment_target_id, status, started_at, completed_at

workload                        A running component in a target
  workload_id, deployment_target_id, module_version_id, component_id,
  artifact_id, replicas, env_overrides, resource_overrides,
  desired_image, actual_image, status, drift_detected

workload_override               Manual changes to a workload
  override_id, workload_id, field, previous_value, new_value,
  reason, created_by, created_at, reverted_at

dependency_workload             Infrastructure deps in sandbox/dev targets
  dependency_workload_id, deployment_target_id, name, image,
  port, env, status


INFRASTRUCTURE PLANE (the physical reality)
────────────────────────────────────────────

K8s resources generated by reconciler from workload rows:
  Namespace (from deployment_target)
  Deployment/StatefulSet/Job/CronJob (from workload, 1:1)
  Service (from workload where component.port is not null)
  IngressRoute (from workload where component.is_public)
  Secret (from resolved env vars)
  ConfigMap (from resolved config)
  
Labels on every resource:
  dx.dev/module: geoanalytics
  dx.dev/component: api
  dx.dev/module-version: 2.3.0
  dx.dev/deployment-target: trafficure-prod-india
  dx.dev/target-kind: production
  dx.dev/managed-by: dx-reconciler


SITE SERVICE PLANE (the logical view)
──────────────────────────────────────

module_instance                 A module enabled in a customer namespace
  module_instance_id, namespace_id, module_version_id, status, config

  This is the SITE-side view. It doesn't track individual components
  because Site Service Plane thinks in modules, not containers.
  Fleet Plane and Infrastructure Plane handle the component-level reality.
```

### The relationship chain, complete

```
module
  ├── 1:N component (what processes it ships)
  └── 1:N module_version (what versions exist)
                ├── 1:N component_artifact (built outputs per component)
                │         └── N:1 artifact (the actual image)
                └── N:M release (via release_module_pin)
                              └── 1:N rollout
                                        └── N:1 deployment_target
                                                  └── 1:N workload
                                                            └── N:1 component
                                                            └── N:1 artifact
```

---

## 8. How `docker-compose.yaml` Evolves

The `docker-compose.yaml` at a repo root is the canonical declaration of what a module contains. Here's the full schema:

```yaml
module: geoanalytics                # Module name (Factory-registered)
team: analytics-eng                 # Owning team
product: trafficure                 # Which product this module belongs to

components:
  api:
    path: ./services/api            # Source code path (relative to repo root)
    port: 8080                      # Exposed port (null for workers/jobs)
    healthcheck: /health            # Health endpoint (null for workers/jobs)
    public: true                    # Gets an ingress route (default: true if port is set)
    kind: deployment                # deployment | statefulset | job | cronjob (default: deployment)
    replicas: 2                     # Default replica count (overridable per tier)
    resources:
      cpu: 500m
      memory: 512Mi
    build:
      dockerfile: Dockerfile        # Default, can override
    dev:
      command: uvicorn main:app --reload --port 8080
      sync: [./:/app]              # File sync for hot reload
    test: pytest
    lint: ruff check .

  worker:
    path: ./services/worker
    kind: deployment
    worker: true                    # Shorthand: no port, no public, no healthcheck
    replicas: 2
    resources:
      cpu: 1000m
      memory: 1Gi
    dev:
      command: python worker.py

  scheduler:
    path: ./services/scheduler
    kind: cronjob
    cron: "0 * * * *"              # Required for cronjob kind
    resources:
      cpu: 200m
      memory: 256Mi

  migrator:
    path: ./migrations
    kind: job
    order: before                   # Run before other components on deploy

# Dependencies — used for local dev and sandbox provisioning
# In staging/production, these resolve to shared/managed infrastructure
dependencies:
  postgres:
    image: postgis/postgis:16-3.4
    port: 5432
    env:
      POSTGRES_DB: geoanalytics
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
    healthcheck: "pg_isready -U dev"
    volumes:
      - data:/var/lib/postgresql/data
  redis:
    image: redis:7-alpine
    port: 6379
```

### What `dx dev` does with this

Reads `docker-compose.yaml`, generates a Docker Compose file with:
- One service per component (using the `dev.command` for each)
- One service per dependency (using the images directly)
- File sync mounts for hot reload
- Auto-generated `SERVICE_URL` env vars for service discovery
- Health check from the dependency declarations

### What `dx build` does with this

For each component:
- Finds the Dockerfile at `{component.path}/{component.build.dockerfile}`
- Builds the image, tagged with the git ref
- Pushes to registry
- Records the artifact in Build Plane DB

### What the reconciler does with this

For each workload in a deployment target:
- Reads the component definition (kind, port, health, resources)
- Reads the artifact reference (which image to run)
- Reads the env overrides (tier-specific config)
- Generates the appropriate K8s resource (Deployment, Job, CronJob, etc.)
- Applies via server-side apply
- Watches for healthy / completed

---

## 9. Scenario Walkthrough: A Day in the Life

### 09:00 — Developer starts work

```bash
dx work start BILL-245                    # story → In Progress
dx branch create feature/BILL-245-rate-limiting
dx dev                                    # starts api + worker + postgres + redis locally
```

Local Docker Compose running. Developer is coding against live services on their laptop.

### 11:00 — Ready for feedback

```bash
dx push                                   # commit, push, create PR
```

Build Plane triggers:
1. CI builds all components from the branch
2. Tests run
3. If conventions allow, sandbox auto-created:
   - `deployment_target` created: kind=sandbox, trigger=pr, ttl=48h
   - Workloads created for each component (using branch artifacts)
   - Dependency workloads created (postgres, redis in the sandbox namespace)
   - Reconciler provisions everything in K8s
4. PR comment posted with sandbox URL

### 14:00 — Reviewer spots an issue with just the worker

Developer fixes the worker, pushes again. Only the worker component is rebuilt and deployed to the sandbox. The api workload keeps its previous image. No full rebuild.

### 16:00 — PR merged

```bash
dx work done BILL-245                     # story → Done
```

Build Plane:
1. Merge triggers a build from main
2. New `module_version` created: geoanalytics:2.3.1
3. Component artifacts recorded (one per component)
4. Sandbox destroyed (TTL or PR-merge trigger)

### Next day — Release manager bundles a release

```bash
dx release create v2.4.1 \
  --pin geoanalytics:2.3.1 \
  --pin auth:1.4.0 \
  --pin workflow:3.1.0
```

Fleet Plane:
1. Release record created with module version pins
2. Release promotes to staging: `dx release promote v2.4.1 --to staging`
3. Rollout created for each staging deployment target
4. For each module, for each component, workloads updated
5. Reconciler deploys. Migrator jobs run first (order: before)
6. Staging is green

### Same day — Production deploy

```bash
dx release promote v2.4.1 --to production
```

Fleet Plane:
1. Rollout created for each production deployment target (could be 5 Sites across regions)
2. Canary: 10% traffic to new workloads, watch for errors
3. If healthy, 50%, then 100%
4. All production Sites now running v2.4.1

### 03:00 — Something breaks

The rate limiting change has a bug that only manifests under load.

```bash
# On-call engineer gets paged, execs in to check
dx exec geoanalytics api --site trafficure-prod-india -- bash

# Identifies the issue — needs a quick fix
# Pipeline is slow, need to patch now
dx ops override geoanalytics api \
  --site trafficure-prod-india \
  --image registry/geoanalytics-api:hotfix-42 \
  --reason "Rate limiter bug causing 503s under load"

# Override applied. Workload drift detected.
# Only the api component on the India site is overridden.
# All other sites, all other components: untouched.
```

### Next morning — Proper fix

Developer pushes a fix, it goes through the normal PR → build → merge flow. New module version geoanalytics:2.3.2. Next release v2.4.2 includes it. When v2.4.2 rolls out to India, the override is automatically superseded (the release artifact replaces the override artifact), drift clears.

---

## 10. The Entity-Relationship Summary

```
PRODUCT PLANE (intent)
  module ──defines──► component

BUILD PLANE (artifacts)
  module ──versions──► module_version ──builds──► component_artifact ──references──► artifact
  repo ──contains──► branch ──has──► pull_request ──triggers──► build ──produces──► artifact

FLEET PLANE (placement)
  release ──pins──► module_version (via release_module_pin)
  release ──deploys-to──► deployment_target (via rollout)
  deployment_target ──contains──► workload
  workload ──runs──► component (using a specific artifact)
  site ──has──► deployment_target (production/staging kind)
  deployment_target ──may-have──► dependency_workload

INFRASTRUCTURE PLANE (reality)
  workload ──reconciles-to──► K8s Deployment/StatefulSet/Job/CronJob
  deployment_target ──reconciles-to──► K8s Namespace
  component.is_public ──reconciles-to──► K8s IngressRoute

SITE SERVICE PLANE (logical view)
  module_instance ──abstracts──► workloads (Site doesn't think in containers)
```

The component entity lives in **Product Plane** (definition) and **Build Plane** (artifact mapping). It is consumed by **Fleet Plane** (workload creation) and **Infrastructure Plane** (K8s resource generation). Site Service Plane does not see components — it sees module instances. The component-to-container translation is Fleet and Infrastructure's job.
