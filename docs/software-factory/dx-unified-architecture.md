# dx — The Software Factory

**Version:** 1.0 — Unified Architecture
**Date:** March 2026
**Status:** RFC

---

## 1. What This Document Is

This document merges two previously separate mental models — the "dx CLI PRD" and the "Platform Fabric Overview" — into a single, coherent architecture for how Lepton Software builds, deploys, and operates all of its products.

The previous dx PRD described a developer tool. The previous Platform Fabric overview described a nine-plane enterprise architecture. They were the same system described from two different angles, but with incompatible terminology, overlapping entity models, and no explicit connection between them.

This document replaces both. One system, one vocabulary, one architecture.

---

## 2. The Mental Model

The company operates a **Software Factory**. The Factory designs products, builds them, commercializes them, deploys them, and operates the infrastructure they run on. Every employee and every AI agent is a worker in this Factory.

**dx** is the tool every worker uses. It is a CLI, an API, and a UI — three interfaces to the same system. A developer types `dx dev` in the terminal. A product manager opens the dashboard to review a release plan. A sales operator creates a customer account in the commerce UI. An AI agent calls the API to open a pull request. All of them are using dx. All of them are interacting with the same Factory.

The Factory is organized into **six planes**. Each plane is a domain of responsibility with its own data model, its own services, and its own slice of the dx interface. The planes cooperate but maintain clear authority boundaries.

The Factory produces **Sites**. A Site is a running instance of a product in a specific customer environment — a Trafficure deployment serving Samsung, a NetworkAccess instance for Indus Towers, a shared SaaS deployment serving 50 tenants in India. Sites are self-governing at runtime. They have their own Control Plane, Service Plane, and Data Plane. The Factory creates, upgrades, monitors, and retires Sites. Sites run independently.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         dx (CLI + API + UI)                         │
│                                                                     │
│  Every worker in the company interacts through dx.                  │
│  The interface adapts to who you are and what you need.             │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                        The Software Factory                         │
│                                                                     │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                   │
│  │   Product    │ │    Build    │ │    Agent    │                   │
│  │   Plane      │ │    Plane    │ │    Plane    │                   │
│  │             │ │             │ │             │                   │
│  │ what & why  │ │  how        │ │ automation  │                   │
│  └─────────────┘ └─────────────┘ └─────────────┘                   │
│                                                                     │
│  ┌─────────────┐ ┌─────────────┐ ┌──────────────────────────────┐  │
│  │  Commerce   │ │    Fleet    │ │     Infrastructure Plane     │  │
│  │  Plane      │ │    Plane    │ │                              │  │
│  │             │ │             │ │  spans Factory + all Sites   │  │
│  │ who pays    │ │ what where  │ │  compute, network, storage   │  │
│  └─────────────┘ └─────────────┘ └──────────────────────────────┘  │
│                                                                     │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ produces ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │
│                                                                     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐               │
│  │   Site A     │ │   Site B     │ │   Site N     │               │
│  │ (Trafficure  │ │ (Samsung     │ │ (SmartMarket │               │
│  │  SaaS India) │ │  dedicated)  │ │  SaaS US)    │               │
│  │              │ │              │ │              │               │
│  │ Control      │ │ Control      │ │ Control      │               │
│  │ Service      │ │ Service      │ │ Service      │               │
│  │ Data         │ │ Data         │ │ Data         │               │
│  └──────────────┘ └──────────────┘ └──────────────┘               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. The Canonical Vocabulary

Every term used across the company maps to exactly one definition. Previous documents used "project" and "module" interchangeably, "deployment" for three different things, and "environment" to mean both a configuration tier and a running instance. This section eliminates all ambiguity.

### 3.1 Factory Entities

| Term               | Definition                                                                                                                                                                                                                              | Plane           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **Product**        | A commercially distinct offering sold to customers (Trafficure, NetworkAccess, SmartMarket).                                                                                                                                            | Product         |
| **Module**         | A deployable product capability. The fundamental unit that spans all planes. Has its own code, its own runtime, its own versioning. Can be enabled per customer. Examples: `geoanalytics`, `traffic-engine`, `network-planner`, `auth`. | Cross-plane     |
| **Module Version** | A specific buildable, deployable version of a module with semantic versioning and compatibility metadata.                                                                                                                               | Build           |
| **Artifact**       | A built output of a module version — container image, binary, UI bundle, worker package. A single module version can produce multiple artifacts.                                                                                        | Build           |
| **Release**        | A collection of module version pins that are deployed together as an atomic unit. A release is the unit of deployment at the Fleet level.                                                                                               | Fleet           |
| **Site**           | A running instance of a product in a specific customer environment. Self-governing at runtime. Contains its own Control Plane, Service Plane, and Data Plane.                                                                           | Fleet           |
| **Tenant**         | A customer's isolated partition within a shared Site. Most customers are tenants in a shared Site. Enterprise customers get dedicated Sites.                                                                                            | Fleet / Control |
| **Entitlement**    | A record of what a customer is allowed to use — which modules, what usage limits, what features. Managed by Commerce, enforced by Control.                                                                                              | Commerce        |
| **Work Item**      | A unit of planned work — story, task, bug. Lives in Product Plane, syncs with external trackers (Jira, Linear).                                                                                                                         | Product         |
| **Agent**          | An AI or automation entity with its own identity, permissions, execution history, and cost tracking. First-class citizen alongside human workers.                                                                                       | Agent           |

### 3.2 Build & Dev Entities

| Term             | Definition                                                                                                                                                                               | Plane |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **Repo**         | A git repository. Contains the source code for one or more modules.                                                                                                                      | Build |
| **Branch**       | A git branch within a repo. Follows naming conventions enforced by the Convention Engine.                                                                                                | Build |
| **Pull Request** | A code review unit. Links to work items, triggers CI, produces build artifacts.                                                                                                          | Build |
| **Build**        | The process of turning a git ref into one or more artifacts. Tracked, logged, cacheable.                                                                                                 | Build |
| **Convention**   | An organizational rule enforced by the Factory — branch naming, commit format, deployment gates, code quality. Violations are helpful, not hostile. Overridable with `--force --reason`. | Build |
| **Workflow**     | A named sequence of dx commands defined as a shell script. Developer-facing automation.                                                                                                  | Build |
| **Sandbox**      | An ephemeral environment for testing or preview. Can be K8s-based (namespace) or VM-based. Auto-created on PR, auto-destroyed on TTL.                                                    | Fleet |

### 3.3 Infrastructure Entities

| Term           | Definition                                                                          | Plane          |
| -------------- | ----------------------------------------------------------------------------------- | -------------- |
| **Provider**   | An infrastructure source — Proxmox cluster, Hetzner account, AWS account.           | Infrastructure |
| **Datacenter** | A geographic grouping of providers.                                                 | Infrastructure |
| **Host**       | A physical or virtual hypervisor (Proxmox cluster).                                 | Infrastructure |
| **VM**         | A virtual machine on any provider.                                                  | Infrastructure |
| **Cluster**    | A Kubernetes cluster spanning one or more VMs.                                      | Infrastructure |
| **IP Address** | A managed IP with allocation tracking (IPAM).                                       | Infrastructure |
| **Asset**      | Any tracked infrastructure resource — generic term for VM, host, node, cluster, IP. | Infrastructure |

### 3.4 Terms We Retired

| Old Term                               | Was Used In | Replaced By                                                                   | Why                                                                                                                                                                                                                                                          |
| -------------------------------------- | ----------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Project** (as deployable unit)       | dx PRD      | **Module**                                                                    | A "project" is what a developer has checked out locally — the repo directory context. The deployable unit is the module. `docker-compose.yaml` still lives in a project directory, and components are declared as services with `catalog.*` / `dx.*` labels. |
| **Service** (as single container)      | dx PRD      | **Artifact** (built output) / **Component** (running process within a module) | "Service" was overloaded. In K8s it means a network endpoint. In dx it meant "one container." We use "artifact" for the built thing and "component" for the running thing.                                                                                   |
| **Deployment** (as immutable snapshot) | dx PRD      | **Build Artifact + Rollout**                                                  | The immutable-snapshot-with-permanent-URL pattern is retained but split: the artifact is immutable (Build Plane), the act of placing it on a Site is a rollout (Fleet Plane).                                                                                |
| **Alias** (mutable DNS pointer)        | dx PRD      | **Route** (Infrastructure Plane traffic routing)                              | Aliases were a clever Vercel-style pattern. We keep the concept but call it what it is — a traffic route. "Production" is a route that points to the current rollout.                                                                                        |
| **Environment** (production/staging)   | dx PRD      | **Tier** (deployment category) + **Site** (actual instance)                   | "Production" is a tier — a category of Sites with certain policies. A specific Site like "Trafficure SaaS India" is the actual target.                                                                                                                       |

---

## 4. The Six Factory Planes

### 4.1 Product Plane — What We Build and Why

**Authority:** What gets built, what work exists, what goes into each release.

**Who uses it:** Product managers, engineering managers, team leads, and anyone tracking planned work.

**Systems of record:**

```
Work graph:         initiative → epic → story → task
Module registry:    module (definition, ownership, lifecycle state)
Release intent:     release_plan → release_note_entry, changelog_entry
Roadmap:            module_roadmap_item, milestone
Standards:          ADR (architecture decision records), API conventions
```

**Product Plane does not own:** CI/CD, build pipelines, artifact creation, deployment orchestration. Those are Build Plane and Fleet Plane.

#### dx CLI Surface

```
dx work create <title>                    Create work item (routes to configured tracker)
dx work list [--assignee me] [--status]   List work items
dx work show <id>                         Show work item detail
dx work start <id>                        Assign to me, transition to In Progress
dx work done <id>                         Transition to Done
dx work link <id> --pr <pr>               Link work item to PR

dx module list                            List all modules
dx module show <name>                     Module detail (versions, deps, ownership)
dx module create <name>                   Register a new module

dx release plan list                      List upcoming releases
dx release plan show <version>            Show release plan contents
```

#### dx API Surface

```
POST   /product/work-items                Create work item
GET    /product/work-items                List/search work items
PUT    /product/work-items/{id}           Update work item
POST   /product/work-items/{id}/transition  Transition status

GET    /product/modules                   List modules
POST   /product/modules                   Register module
GET    /product/modules/{name}            Module detail

GET    /product/releases                  List release plans
POST   /product/releases                  Create release plan
```

#### dx UI Surface

- **Work board:** Kanban view of work items by status, filterable by module/team/assignee. Syncs with Jira/Linear.
- **Module registry:** Browseable catalog of all modules, their ownership, current versions, and health.
- **Release planner:** View of upcoming releases, what module versions are included, what stories are resolved.
- **Engineering analytics:** Delivery velocity, defect rates, cycle time, cross-team visibility.

---

### 4.2 Build Plane — How We Build It

**Authority:** How code becomes deployable artifacts. One set of CI/CD standards, one artifact registry, one code quality gate, one convention engine — shared across all products.

**Who uses it:** Every developer, every day. This is the plane developers live in.

**Systems of record:**

```
Code graph:         repo → branch → commit → pull_request → pr_review
CI graph:           ci_pipeline → ci_run → build → artifact
Quality:            test_report, vulnerability_report, sbom, artifact_signature
Versioning:         module_version (links module → artifacts + compatibility metadata)
Conventions:        convention rules (branch, commit, deploy gates, code quality)
SDK:                Service Plane SDK (the shared framework all modules build on)
```

**Build Plane produces** the Service Plane SDK — the shared framework that every product module is built on. The SDK defines how a module registers itself, receives tenant context, emits telemetry, accesses data, declares its API surface, and handles health checks.

#### dx CLI Surface — Daily Developer Commands

```
dx dev [component...]                     Start local development (Docker Compose)
dx dev <component> --connect-to <site>    Hybrid local/remote development
dx test [component]                       Run tests
dx lint [component]                       Run linter
dx build [component]                      Build artifacts (OCI images)
dx build --push                           Build and push to registry

dx branch create <type/ticket-slug>       Create branch following conventions
dx branch list                            List branches
dx branch clean                           Delete merged/stale branches
dx commit [message]                       Commit following conventional format
dx push                                   Push + create PR + create sandbox
dx pr create/status/merge                 PR management

dx diff                                   Show what would change
dx plan <action>                          Dry-run any action

dx explain <topic>                        Built-in offline explanations
```

#### dx CLI Surface — Convention & Workflow Commands

```
dx convention validate                    Validate current state against conventions
dx convention report                      Report convention compliance stats

dx workflow list                          List available workflows
dx workflow run <name> [args]             Run a workflow script
dx start <ticket> [slug]                  Shortcut: pick up ticket + create branch
dx submit                                 Shortcut: test + lint + push
dx ship                                   Shortcut: deploy staging → production
```

#### dx API Surface

```
POST   /build/builds                      Trigger build
GET    /build/builds/{id}                 Build detail + logs
GET    /build/artifacts                   List artifacts
GET    /build/artifacts/{id}              Artifact detail (digest, SBOM, vulns)

GET    /build/modules/{name}/versions     List module versions
POST   /build/modules/{name}/versions     Create module version
GET    /build/modules/{name}/versions/{v} Version detail

POST   /build/conventions/validate        Validate against conventions
GET    /build/pipelines                   List CI pipelines
GET    /build/pipelines/{id}/runs         List pipeline runs
```

#### dx UI Surface

- **Build dashboard:** Pipeline status across all modules, recent builds, success/failure rates.
- **PR review queue:** Open PRs by module, review status, CI results, convention compliance.
- **Artifact browser:** Built images/binaries by module version, SBOM viewer, vulnerability reports.
- **Convention compliance:** Which teams/modules are overriding conventions and how often.

#### Local Development Engine

`dx dev` reads `docker-compose.yaml` and starts the local development stack. The escape hatch is always there — `docker ps`, `docker compose up`, and all native Docker commands work. If Docker is unavailable, dx falls back to direct process management.

```yaml
# docker-compose.yaml — lives at repo root, declares what this repo builds
# Components are services with a build: block and catalog/dx labels
# Resources are services with just an image (no build block)
services:
  api:
    build:
      context: ./services/api
    ports:
      - "8080:8080"
    labels:
      dx.type: service
      dx.owner: platform-eng
      dx.runtime: node
      dx.dev.command: "uvicorn main:app --reload --port 8080"
      dx.dev.sync: "./services/api:/app"
      dx.test: "pytest"
      dx.lint: "ruff check ."
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]

  worker:
    build:
      context: ./services/worker
    labels:
      dx.type: worker
      dx.owner: platform-eng
      dx.runtime: node

  frontend:
    build:
      context: ./services/frontend
    ports:
      - "3000:3000"
    labels:
      dx.type: website
      dx.owner: platform-eng
      dx.runtime: node
      dx.dev.command: "pnpm dev"

  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

Per-component config (build, dev commands, test, lint) is specified via `dx.*` labels on each service — no separate per-component file needed.

---

### 4.3 Agent Plane — Automation Across the Factory

**Authority:** AI and automation agent lifecycle — identity, permissions, execution, memory, cost tracking, governance.

**Who uses it:** Engineering agents (code review, refactoring), QA agents (test generation), product agents (backlog grooming), security agents (vuln scanning), operations agents (incident response). Also any developer using `dx ask`.

**Systems of record:**

```
Agent registry:     agent, agent_capability, agent_tool_grant
Execution:          agent_queue → agent_task → agent_execution → agent_execution_step
Memory:             agent_memory_store → agent_memory_item
Analytics:          agent performance metrics, cost tracking, drift detection
```

**Why a separate plane:** Agents are cross-cutting. An engineering agent writes code (Build Plane), a QA agent tests it (Build Plane), a product agent grooms the backlog (Product Plane), an ops agent monitors infrastructure (Infrastructure Plane). Without Agent Plane, each team builds ad-hoc automation with no consistent identity, no audit trail, no cost tracking, no governance.

#### dx CLI Surface

```
dx ask <message>                          Natural language interface to any plane
dx agent list                             List registered agents
dx agent show <name>                      Agent detail (capabilities, permissions, cost)
dx agent history <name>                   Execution history for an agent
dx agent run <name> <task>                Trigger agent execution
```

#### dx API Surface

```
GET    /agent/agents                      List agents
POST   /agent/agents                      Register agent
GET    /agent/agents/{id}                 Agent detail
POST   /agent/agents/{id}/execute         Trigger execution
GET    /agent/agents/{id}/executions      Execution history
GET    /agent/executions/{id}             Execution detail + steps + cost
POST   /agent/ask                         Natural language → tool calls
```

**Agent-first design principle:** Every dx command supports `--json`, `--wait`, `--dry-run`, `--timeout`. Agents are first-class users of the entire dx surface. `dx ask` translates natural language to dx commands using the agent's own identity and permissions.

#### dx UI Surface

- **Agent dashboard:** Registered agents, their capabilities, execution frequency, cost.
- **Execution log:** Recent agent runs, tool calls, outcomes, cost per execution.
- **Cost analytics:** Agent spending by team, by plane, by agent type. Budget alerts.

---

### 4.4 Commerce Plane — Who Gets What, at What Price

**Authority:** The commercial relationship between the company and its customers and partners. One billing engine, one entitlement engine, one customer record — across all products.

**Who uses it:** Sales, customer success, finance, and the systems that bridge commercial decisions to Fleet operations.

**Systems of record:**

```
Customer graph:     customer_account, partner (MSP)
Commercial:         product_sku, plan, addon, price, contract/subscription
Entitlements:       license → entitlement_bundle → entitlement_item
Billing:            invoice, payment, usage_record
Lifecycle:          trial → active → suspended → terminated (state machine)
```

**The entitlement engine is the critical custom-build.** It is the contract between the commercial model and Fleet operations. Everything else (billing, payments, invoicing) leverages Stripe and existing SaaS tooling.

A customer signs up once, gets one account. Products are added as additional entitlements. Samsung buys Trafficure today, adds NetworkAccess next year — same account, same billing relationship, additional entitlement.

#### dx CLI Surface

```
dx customer list                          List customer accounts
dx customer show <name>                   Customer detail (entitlements, sites, usage)
dx customer create <name>                 Create customer account

dx entitlement list [--customer <name>]   List entitlements
dx entitlement show <id>                  Entitlement detail (modules, quotas, state)
dx entitlement grant <customer> <module>  Grant module entitlement
dx entitlement revoke <customer> <module> Revoke module entitlement

dx plan list                              List pricing plans
dx plan show <name>                       Plan detail (included modules, limits)

dx billing status [--customer <name>]     Billing status
dx usage show [--customer <name>]         Usage dashboard
```

#### dx API Surface

```
POST   /commerce/customers                Create customer
GET    /commerce/customers                List customers
GET    /commerce/customers/{id}           Customer detail

POST   /commerce/entitlements             Grant entitlement
GET    /commerce/entitlements             List entitlements
PUT    /commerce/entitlements/{id}        Update entitlement
DELETE /commerce/entitlements/{id}        Revoke entitlement

GET    /commerce/plans                    List plans
POST   /commerce/subscriptions            Create subscription
GET    /commerce/usage                    Usage records
```

#### dx UI Surface

- **Customer management:** Account creation, contact info, billing relationship, subscription management.
- **Entitlement dashboard:** Which customer has which modules, usage against quotas, overages.
- **Billing overview:** Invoice status, payment history, revenue by product/plan.
- **Partner portal:** Partner accounts, their customers, deal registration, channel attribution.

---

### 4.5 Fleet Plane — What Runs Where

**Authority:** Site lifecycle, release management, deployment orchestration, tenant assignment. The only plane that is product-aware — it knows which product each Site belongs to and what modules are available.

**Who uses it:** DevOps, SRE, platform engineers, and developers deploying their work.

**Systems of record:**

```
Site graph:         site, site_configuration, site_manifest, site_health_snapshot
Tenant:             tenant (customer partition in shared Site)
Release:            release → release_module_pin → module_version
Deployment:         rollout → rollout_step
Lifecycle:          site_upgrade, site_channel (beta/stable)
```

**Fleet Plane consumes entitlements from Commerce** to determine whether a customer gets a tenant in a shared Site or a dedicated Site. **Fleet Plane consumes module versions from Build** to assemble releases. **Fleet Plane pushes releases to Sites** via Infrastructure Plane.

#### dx CLI Surface — Deployment Commands (Developer Daily Use)

```
dx deploy [component]                     Deploy module to target
dx deploy --ref <git-ref>                 Deploy specific ref
dx deploy --site <site>                   Deploy to specific Site
dx deploy --tier staging                  Deploy to all staging-tier Sites
dx deploy --canary --weight 10            Canary deployment

dx promote <rollout> --to <tier>          Promote rollout to next tier
dx rollback [module] [--to <rollout-id>]  Rollback to previous rollout
dx status [target]                        Status of anything
dx logs <target>                          Logs from anything
```

#### dx CLI Surface — Release & Site Commands (Platform Engineers)

```
dx release create <version>               Create release (bundle module versions)
dx release show <version>                 Release detail (module pins, rollout status)
dx release promote <version> --to <tier>  Promote release across Sites
dx release rollback <site> --to <version> Rollback Site to previous release
dx release status <version>               Rollout progress across fleet

dx site list                              List all Sites
dx site show <name>                       Site detail (product, tenants, health, release)
dx site create <name> --product <prod>    Create new Site
dx site upgrade <name> --release <ver>    Upgrade Site to specific release
dx site suspend <name>                    Suspend Site (data preserved)
dx site decommission <name>               Decommission Site

dx tenant list [--site <name>]            List tenants
dx tenant show <id>                       Tenant detail (customer, namespace, modules)
dx tenant assign <customer> --site <site> Assign customer to Site as tenant

dx sandbox create <name>                  Create ephemeral environment
dx sandbox list                           List sandboxes
dx sandbox open <name>                    Open sandbox URL
dx sandbox ssh/code/exec/logs <name>      Access sandbox
dx sandbox share <name>                   Shareable URL
dx sandbox extend <name> --ttl 72h        Extend TTL
dx sandbox destroy <name>                 Destroy sandbox
```

#### dx API Surface

```
POST   /fleet/releases                    Create release
GET    /fleet/releases/{version}          Release detail
POST   /fleet/releases/{version}/promote  Promote release
POST   /fleet/releases/{version}/rollback Rollback release

POST   /fleet/sites                       Create Site
GET    /fleet/sites                       List Sites
GET    /fleet/sites/{name}                Site detail
POST   /fleet/sites/{name}/upgrade        Upgrade Site
POST   /fleet/sites/{name}/suspend        Suspend Site
DELETE /fleet/sites/{name}                Decommission Site

POST   /fleet/sites/{name}/tenants        Assign tenant
GET    /fleet/sites/{name}/tenants        List tenants

POST   /fleet/rollouts                    Create rollout
GET    /fleet/rollouts/{id}               Rollout detail + steps

POST   /fleet/sandboxes                   Create sandbox
GET    /fleet/sandboxes                   List sandboxes
DELETE /fleet/sandboxes/{name}            Destroy sandbox
```

#### dx UI Surface

- **Fleet dashboard:** All Sites by product, health status, current release version, tenant count.
- **Release manager:** Release creation, module version selection, rollout progress, cross-Site status.
- **Site detail:** Health, tenants, current release, upgrade history, resource utilization.
- **Deployment history:** Every rollout, who triggered it, what changed, rollback timeline.
- **Sandbox manager:** Active sandboxes, their URLs, TTL countdown, resource usage.

---

### 4.6 Infrastructure Plane — The Substrate

**Authority:** Compute, storage, and network that every other plane and every Site runs on. The only plane that spans both the Factory and every Site.

**Who uses it:** Infrastructure engineers, SREs, and platform engineers.

**Factory-scope responsibilities:** Cluster provisioning, global networking, PKI, container registry, secrets infrastructure, capacity planning, IPAM.

**Site-scope responsibilities:** API gateway (Traefik), service mesh, pod scheduling, storage provisioning, egress policies, local secrets, certificate distribution.

**Systems of record:**

```
Factory:            provider, datacenter, region, host, node, vm, cluster, ip_address,
                    certificate_authority, certificate, registry, storage_pool
Site:               gateway config, mesh config, compute allocation, storage allocation
```

#### dx CLI Surface — Infrastructure Commands

```
dx infra status                           Overview of all infrastructure
dx infra topology                         Visual topology map
dx infra plan                             Dry-run of infrastructure changes
dx infra apply                            Apply infrastructure.yaml

dx infra datacenter list/create/show      Geographic groupings
dx infra region list/create/show          Regions within datacenters
dx infra provider list/add/remove/sync    Proxmox, cloud accounts

dx infra host list/add/remove/show        Physical/virtual hypervisors
dx infra node list/show/set-ip            Nodes within hosts
dx infra vm list/create/destroy/start/stop/restart/resize/migrate/snapshot/backup
dx infra template list/create/clone       VM templates

dx infra cluster list/create/destroy/status/upgrade/kubeconfig
dx infra k8s-node list/add/remove/drain/cordon/uncordon
dx infra platform install/status/upgrade/backup/restore

dx infra ip lookup/list/register/assign/release    IPAM
dx infra network list/show
dx infra tag add/remove/list                       Tag any resource
dx infra install <tool> --on <target>              Install tools on remote VMs
dx infra ansible list/run                          Run Ansible playbooks

dx infra up <cluster> --host <pve> --servers N --agents N   One-command bootstrap
```

#### dx CLI Surface — Operations Commands

```
dx ops scale <module> [--replicas N] [--auto --min N --max N]
dx ops restart <module> [--hard]
dx ops drain <node>
dx ops maintenance enable/disable
dx ops backup create/list/restore
dx ops cron list/logs/run/disable/create
dx ops cert list/status/renew/import
```

#### dx CLI Surface — Universal Access Commands

```
dx ssh <target>                           SSH into any machine
dx exec <target> [-- command]             Exec into anything (pod, vm, node)
dx code <target>                          VS Code/Cursor remote
dx docker <target> [args]                 Docker commands on remote machines
dx logs <target>                          Logs from anything
```

Target resolution is universal. dx figures out what `<target>` is: a VM name → SSH; an IP → IPAM lookup → SSH; a module component name → K8s pod exec; a host name → SSH. The same resolution works for ssh, exec, logs, code, and docker.

#### dx API Surface

```
GET    /infra/assets                      List all infrastructure assets
GET    /infra/assets/{id}                 Asset detail

POST   /infra/providers                   Register provider
GET    /infra/providers                   List providers
POST   /infra/providers/{id}/sync         Sync inventory

POST   /infra/vms                         Create VM
GET    /infra/vms                         List VMs
POST   /infra/vms/{id}/start|stop|restart VM lifecycle
POST   /infra/vms/{id}/resize             Resize VM
POST   /infra/vms/{id}/migrate            Migrate VM

POST   /infra/clusters                    Create cluster
GET    /infra/clusters                    List clusters
POST   /infra/clusters/{name}/upgrade     Upgrade cluster

GET    /infra/ips                         List IPs
POST   /infra/ips                         Register IP range
POST   /infra/ips/lookup                  Lookup IP ↔ asset
```

#### dx UI Surface

- **Infrastructure topology:** Visual map of datacenters, clusters, nodes, VMs, Sites. Drill-down.
- **Cluster health:** Node status, resource utilization, pod scheduling, storage usage per cluster.
- **VM management:** VM inventory, status, resource allocation, snapshot management.
- **IPAM:** IP allocation map, available ranges, assignments.
- **Certificate dashboard:** Certificate inventory, expiry timeline, rotation status.

---

## 5. Cross-Plane Flows

### 5.1 Developer Builds a Feature (Daily Flow)

```
Product Plane                 Build Plane                        Fleet Plane
│                             │                                  │
│ dx work start BILL-245      │                                  │
│ (story → In Progress)       │                                  │
│                             │                                  │
│                             │ dx branch create feature/...     │
│                             │ dx dev (local development)       │
│                             │ dx test, dx lint                 │
│                             │ dx push (commit → PR → sandbox)  │
│                             │                                  │
│                             │ Build triggers:                  │
│                             │   ci_run → build → artifact      │
│                             │   test_report, vuln scan         │
│                             │                                  │
│                             │                                  │ Sandbox created
│                             │                                  │ (ephemeral Site)
│                             │                                  │
│                             │ PR merged                        │
│                             │ module_version created            │
│                             │                                  │
│ dx work done BILL-245       │                                  │ Sandbox destroyed
│ (story → Done)              │                                  │
```

### 5.2 Release Ships to Production (Platform Engineer Flow)

```
Build Plane                   Fleet Plane                       Infrastructure Plane
│                             │                                  │
│ module_versions available:  │                                  │
│   billing:1.3.0             │                                  │
│   auth:2.1.0                │                                  │
│   analytics:1.0.0           │                                  │
│                             │                                  │
│                             │ dx release create v2.4.0         │
│                             │   pins: billing:1.3, auth:2.1,  │
│                             │         analytics:1.0            │
│                             │                                  │
│                             │ dx release promote v2.4.0        │
│                             │   --to staging                   │
│                             │                                  │
│                             │ For each staging Site:           │
│                             │   → create rollout               │
│                             │   → push module versions  ─────► │ pull images
│                             │   → update site_manifest         │ schedule pods
│                             │   → wait for healthy             │ route traffic
│                             │                                  │
│                             │ dx release promote v2.4.0        │
│                             │   --to production                │
│                             │                                  │
│                             │ For each production Site:        │
│                             │   → same flow                    │
│                             │   → canary optional              │
```

### 5.3 New Customer Onboards (Commerce → Fleet → Site)

```
Commerce Plane                Fleet Plane                       Site (Control Plane)
│                             │                                  │
│ Customer signs up           │                                  │
│ Plan selected               │                                  │
│ Entitlement created         │                                  │
│   modules: [geoanalytics,   │                                  │
│    coverage, kpi]           │                                  │
│   seats: 50                 │                                  │
│                             │                                  │
│ ────── event ──────────►    │                                  │
│                             │ Assign tenant to shared Site     │
│                             │   (SaaS India)                   │
│                             │                                  │
│                             │ Push entitlement bundle ────►    │ Create namespace
│                             │                                  │ Provision module instances
│                             │                                  │ Apply entitlement limits
│                             │                                  │ Customer can log in
```

### 5.4 Runtime Request (Through a Site)

```
Infrastructure (Site)         Control Plane                      Service Plane → Data Plane
│                             │                                  │
│ External request arrives    │                                  │
│ API Gateway (Traefik)       │                                  │
│   TLS termination           │                                  │
│   ForwardAuth ──────────►   │                                  │
│                             │ Authenticate (Better-Auth)       │
│                             │ Resolve tenant (namespace)       │
│                             │ Check entitlement                │
│                             │ Authorize (SpiceDB)              │
│                             │ Set tenant context               │
│                             │ Emit audit event                 │
│   ◄───── allow ─────────    │                                  │
│                             │                                  │
│ Route to Service Plane      │                                  │ Module receives request
│                             │                                  │   with tenant context
│                             │                                  │ Executes business logic
│                             │                                  │ Queries Data Plane
│                             │                                  │   (RLS scopes to tenant)
│                             │                                  │ Returns response
```

---

## 6. The dx System Architecture

### 6.1 Single Binary, Multiple Modes

dx is a single Go binary. It runs as CLI, API server, reconciler, builder, or installer depending on the subcommand:

```
dx                            → CLI mode (default)
dx serve api                  → Factory API server (all planes)
dx serve reconciler           → Fleet/Infrastructure reconciliation loop
dx serve builder              → Build Plane artifact builder
dx install                    → Bootstrap installer
```

### 6.2 Platform Components

```
┌──────────────────────────────────────────────────────────────────┐
│  dx CLI (single binary)                                          │
│  Developer / Agent / Ops / PM / Sales — all use the same binary  │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTPS
┌────────────────────────────▼─────────────────────────────────────┐
│  dx API Server (all Factory planes)                              │
│                                                                  │
│  Routes:                                                         │
│    /product/*     → Product Plane handlers                       │
│    /build/*       → Build Plane handlers                         │
│    /agent/*       → Agent Plane handlers                         │
│    /commerce/*    → Commerce Plane handlers                      │
│    /fleet/*       → Fleet Plane handlers                         │
│    /infra/*       → Infrastructure Plane handlers                │
│                                                                  │
│  Auth: Better-Auth (identity) + SpiceDB (authorization)          │
│  DB:   PostgreSQL (all Factory plane state)                      │
└────────────┬──────────────┬──────────────┬───────────────────────┘
             │              │              │
   ┌─────────▼──────┐ ┌────▼──────┐ ┌─────▼─────────┐
   │ dx-reconciler   │ │ dx-builder│ │ Sync Engine   │
   │                 │ │           │ │               │
   │ Fleet rollouts  │ │ Git ref → │ │ Jira, Slack,  │
   │ Site manifests  │ │ OCI image │ │ DNS, external │
   │ K8s resources   │ │           │ │ systems       │
   └─────────────────┘ └───────────┘ └───────────────┘
```

### 6.3 Database Organization

One Factory database (PostgreSQL), organized by plane via schemas:

```
factory_product.*       Work items, modules, release plans, roadmap
factory_build.*         Repos, branches, PRs, builds, artifacts, module versions,
                        conventions, CI pipelines
factory_agent.*         Agents, tasks, executions, memory
factory_commerce.*      Customers, plans, entitlements, subscriptions, billing
factory_fleet.*         Sites, tenants, releases, rollouts, site_manifests
factory_infra.*         Providers, hosts, VMs, clusters, IPs, certificates
```

Each Site has its own database with schemas:

```
site_control.*          Principals, organizations, namespaces, roles, policies, audit
site_service.*          Module instances, jobs, workflows, integrations, events
site_data.*             Datasets, pipelines, backups, retention policies
```

### 6.4 Technology Stack (Reconciled)

| Concern                | Technology                              | Notes                                                                                                                                                                          |
| ---------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity/Auth          | Better-Auth                             | OAuth, SAML, SCIM, passkeys, MCP agent auth. Handles authentication only.                                                                                                      |
| Authorization          | SpiceDB + PostgreSQL                    | Three-layer: generic SpiceDB schema, PostgreSQL resource type registry, runtime interpreter. dx's viewer/deployer/admin/platform-admin roles are defined in this system.       |
| Primary database       | PostgreSQL                              | Source of truth. `ltree`, GiST indexes, RLS, partitioning. SpiceDB is a read-optimized projection.                                                                             |
| Observability          | SigNoz (OTel-native)                    | Replaces Loki + Prometheus from original dx PRD. Infrastructure Plane owns the SigNoz instance. Audit events in PostgreSQL as authoritative source, outbox-mirrored to SigNoz. |
| Workflow orchestration | Temporal                                | Platform-level orchestration (site provisioning, release rollouts, tenant migration).                                                                                          |
| Developer workflows    | Shell scripts (.dx/workflows/)          | Developer-facing shortcuts. Not Temporal — these are lightweight CLI automation.                                                                                               |
| Ingress                | Traefik                                 | ForwardAuth integration with Control Plane.                                                                                                                                    |
| Container registry     | Bundled (dx) or external (Harbor, ECR)  | Build Plane artifact storage.                                                                                                                                                  |
| Object storage         | MinIO                                   | S3-compatible.                                                                                                                                                                 |
| Search/AI memory       | pgvector (Phase 1-2), Qdrant (Phase 3+) | Agent Plane memory.                                                                                                                                                            |
| CLI language           | Go                                      | Single static binary, K8s-native, fast startup, agent-friendly.                                                                                                                |

---

## 7. Who Uses What — The Worker Map

dx adapts to who you are. The CLI shows different help based on your role. The UI shows different dashboards based on your permissions. Every worker sees the slice they need.

### Developer (Day 1: 6 commands)

```
dx dev                        Start local development
dx test                       Run tests
dx build                      Build artifacts
dx deploy                     Deploy to sandbox/staging
dx status                     What's running
dx logs                       View logs
```

### Developer (Week 1: 14 commands)

All of the above, plus:

```
dx push                       Push + PR + sandbox
dx work start/done            Pick up and complete work items
dx branch create              Create branch following conventions
dx sandbox create/open        Manage preview environments
dx env list/set/resolve       Environment configuration
dx explain <topic>            Learn how things work
dx ask <question>             Natural language interface
```

### Platform Engineer / SRE

```
dx release create/promote/rollback    Manage releases across Sites
dx site list/show/create/upgrade      Manage Site lifecycle
dx tenant assign/list                 Manage tenants
dx ops scale/restart/drain            Operational commands
dx infra vm/cluster/platform          Infrastructure management
dx infra up                           One-command bootstrap
```

### Product Manager

```
dx work create/list/show              Manage work items
dx module list/show                   Browse module registry
dx release plan list/show             Review release plans
```

Primarily uses the **dx UI** for work boards, release planning, and engineering analytics.

### Sales / Customer Success

```
dx customer create/show               Manage customer accounts
dx entitlement grant/revoke           Manage entitlements
dx billing status                     Check billing
dx usage show                         Usage dashboards
```

Primarily uses the **dx UI** for customer management and entitlement dashboards.

### AI Agent

Same CLI/API as humans, with agent-specific features:

```
dx ask <natural-language>             Translates to tool calls
Every command supports: --json --wait --dry-run --timeout
dx whoami --json                      Self-orient
dx explain <topic>                    Learn the system
```

Agents authenticate with `DX_TOKEN`, have their own identity in Agent Plane, and every action is attributed to the agent in audit logs.

---

## 8. Configuration Files

### 8.1 Module Definition: `docker-compose.yaml` (repo root)

The project is defined entirely through `docker-compose.yaml` (or a `compose/` directory of per-service `.yml` files). Components and resources are distinguished by docker-compose labels:

```yaml
# docker-compose.yaml
services:
  api:
    build:
      context: ./services/api
    ports:
      - "8080:8080"
    labels:
      dx.type: service
      dx.owner: platform-eng
      dx.runtime: node
      dx.dev.command: "uvicorn main:app --reload --port 8080"
      dx.dev.sync: "./services/api:/app"
      dx.test: "pytest"
      dx.lint: "ruff check ."
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]

  worker:
    build:
      context: ./services/worker
    labels:
      dx.type: worker
      dx.owner: platform-eng

  frontend:
    build:
      context: ./services/frontend
    ports:
      - "3000:3000"
    labels:
      dx.type: website
      dx.owner: platform-eng
      dx.dev.command: "pnpm dev"

  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

### 8.2 Component Classification (from labels)

Components vs resources are classified automatically:

- **Component**: service with a `build:` block, or explicit `dx.kind: Component` label
- **Resource**: service with just an `image:` (postgres, redis, etc.), or explicit `dx.kind: Resource` label
- Per-component build/dev/test/lint config is specified via `dx.*` labels on each service

### 8.3 Tier Overrides: `.dx/tiers/`

```yaml
# .dx/tiers/production.yaml
env:
  DATABASE_URL: vault://billing/prod/db-url
  LOG_LEVEL: info

# .dx/tiers/staging.yaml
env:
  DATABASE_URL: vault://billing/staging/db-url
  LOG_LEVEL: debug
```

### 8.4 Conventions: `.dx/conventions.yaml`

```yaml
branches:
  pattern: "{type}/{ticket}-{slug}"
  types: [feature, hotfix, release, chore, experiment]
  require-ticket: true
  max-age: 30d

commits:
  format: conventional
  require-scope: true

deploy:
  production:
    require-passing-tests: true
    require-review: true
    require-staging-first: true
    restrict-hours: "Mon-Fri 09:00-16:00"
    cooldown: 30m
  sandbox:
    auto-create: true
    ttl: 48h
    max-per-module: 10

integrations:
  tracker: jira
  tracker-config:
    url: https://lepton.atlassian.net
    project: BILL
  notifications: slack
  notification-config:
    channel: "#deploys"
  secrets: vault
  dns: cloudflare
```

### 8.5 Workflows: `.dx/workflows/`

```bash
#!/bin/bash
# .dx/workflows/start.sh
set -e
TICKET=${1:?Usage: dx start <ticket-id> [slug]}
SLUG=${2:-$(dx work show "$TICKET" --json | jq -r '.title | gsub(" "; "-") | ascii_downcase')}
dx work start "$TICKET"
dx branch create "feature/${TICKET}-${SLUG}"
echo "Ready to work on $TICKET"
```

### 8.6 Infrastructure: `.dx/infrastructure.yaml`

```yaml
hosts:
  production-pve:
    type: proxmox
    url: https://pve1.internal:8006
    credentials: vault://infra/proxmox-production

clusters:
  production:
    host: production-pve
    servers:
      - name: k8s-server-1
        cpu: 4
        memory: 8
        disk: 100
    agents:
      - name: k8s-agent-{n}
        count: 3
        cpu: 8
        memory: 16
        disk: 200
    platform:
      domain: platform.lepton.io
      tls: letsencrypt
```

---

## 9. Design Principles (Unified)

### From the dx Tradition

1. **One tool to learn.** Every worker uses `dx`. The interface adapts, but the tool is singular.
2. **Progressive disclosure.** 6 commands day one, everything else discoverable when needed.
3. **The escape hatch guarantee.** Every dx action produces standard artifacts that native tools can read. `kubectl`, `docker`, `git`, `ssh` always work.
4. **Convention over configuration.** Sensible defaults everywhere. A developer should be able to run `dx dev` and `dx deploy` without configuring anything beyond `docker-compose.yaml`.
5. **Idempotency.** Every command that modifies state is idempotent. Agents don't need to check before acting.
6. **Fault tolerance.** dx degrades gracefully. If the platform is down, local dev still works. If Jira is down, work items still exist locally. If the cluster is unreachable, deployments queue.
7. **Agent-native.** `--json`, `--wait`, `--dry-run` on every command. AI agents are first-class users.

### From the Platform Fabric Tradition

8. **Product agnosticism.** All Factory planes are product-agnostic. Products are a dimension of data, not separate instances. An engineer moving from Trafficure to NetworkAccess finds the same pipelines, the same tools, the same conventions.
9. **Site autonomy.** Each Site is self-governing at runtime. A Site can operate independently of the Factory — hard requirement for air-gapped and sovereign deployments.
10. **Policy-execution pattern.** Control Plane declares policies. Other planes execute them. Declarative intent, not implementation details.
11. **Infrastructure as contract.** Other planes never touch infrastructure primitives directly. They consume Infrastructure Plane through contracts.
12. **Module as the fundamental unit.** The module connects Product (definition) → Build (artifact) → Fleet (release) → Service (runtime). It is the single concept that spans all planes.

---

## 10. The Stack Model

dx manages five infrastructure layers. Workers enter at whatever layer they need. Most developers never go below Layer 3.

```
┌───────────────────────────────────────────────────────────────┐
│  Layer 4: Product Workloads                                    │
│  dx dev, dx deploy, dx status, dx sandbox, dx release          │
│  (what 90% of developers interact with)                        │
├───────────────────────────────────────────────────────────────┤
│  Layer 3: dx Factory Platform                                  │
│  dx API, dx-reconciler, dx-builder, Factory DB                 │
│  (installed by dx install or Helm)                             │
├───────────────────────────────────────────────────────────────┤
│  Layer 2: Kubernetes                                           │
│  dx infra cluster, dx infra k8s-node                           │
│  (created by dx or pre-existing: k3s, EKS, GKE, AKS)          │
├───────────────────────────────────────────────────────────────┤
│  Layer 1: Virtual Machines                                     │
│  dx infra vm, dx infra template                                │
│  (provisioned by dx via Proxmox, or pre-existing)              │
├───────────────────────────────────────────────────────────────┤
│  Layer 0: Physical / Cloud Accounts                            │
│  dx infra host, dx infra provider, dx infra datacenter         │
│  (registered with dx, managed externally)                      │
└───────────────────────────────────────────────────────────────┘
```

| Starting point          | What dx does                                                               |
| ----------------------- | -------------------------------------------------------------------------- |
| Bare Proxmox cluster    | Creates VMs → installs k3s → installs Factory platform → deploys workloads |
| Bare VMs (any source)   | Installs k3s → installs Factory platform → deploys workloads               |
| Existing K8s cluster    | Installs Factory platform → deploys workloads                              |
| Factory already running | Deploys workloads                                                          |
| Just want local dev     | `dx dev` works with no platform at all                                     |

---

## 11. Service Naming Convention

All services follow:

```
{scope}-{plane}-{component}
```

### Factory Services (run once, centrally)

```
factory-product-api
factory-build-api
factory-build-worker
factory-agent-api
factory-agent-orchestrator
factory-agent-memory
factory-commerce-api
factory-commerce-entitlement-api
factory-commerce-billing-worker
factory-fleet-api
factory-fleet-scheduler
factory-fleet-deployer
factory-infra-api
factory-infra-cluster-manager
factory-infra-cert-manager
```

### Site Services (run per Site)

```
site-control-api
site-control-auth
site-control-audit
site-infra-api
site-infra-gateway
site-infra-mesh
site-service-api
site-service-{module-name}
site-service-worker
site-data-api
site-data-postgres
site-data-analytics
site-data-cache
```

In practice, all Factory services are deployed as the dx platform components (dx-api handles routing to all plane handlers). The naming convention is for the logical architecture, service registry, and repository organization — not necessarily one-deployment-per-service in Phase 1.

---

## 12. What dx Replaced

The previous dx PRD and Platform Fabric overview each had concepts that the other was missing. This unified model incorporates the best of both:

### Retained from dx

- Single binary architecture with subcommand mode dispatch
- Progressive disclosure CLI help (tier 1-5)
- Local development engine (Docker Compose generation, hybrid dev)
- Convention engine (branch, commit, deploy gates) with `--force --reason` override
- Workflow system (shell scripts, not YAML DSL)
- Sandbox environments (K8s + VM unified)
- IPAM (IP address management for on-prem)
- Offline bundle / air-gapped installer
- Universal target resolution (ssh/exec/logs/code work on VMs, pods, nodes)
- Fault-tolerant sync engine with graceful degradation
- Immutable artifact + traffic routing (the Vercel-style pattern, now expressed as Build artifacts + Fleet rollouts + Infrastructure routes)
- Agent-first design (`--json`, `--wait`, `--dry-run` on everything)
- Escape hatch guarantee (every action produces standard artifacts)

### Retained from Platform Fabric

- Nine-plane architecture (six Factory + three Site)
- Module as the cross-plane fundamental unit
- Release as a bundled, atomic deployment unit
- Site/Tenant model for multi-product, multi-customer deployment
- Commerce Plane (customers, entitlements, billing, partners)
- Entitlement engine bridging commercial → fleet operations
- Policy-execution pattern (Control Plane declares, others execute)
- Tier 1/2/3 tenant configuration model
- Service Plane SDK (shared framework for module development)
- Site autonomy (independent operation for air-gapped deployments)
- Product agnosticism across all Factory planes
- Better-Auth, SpiceDB, SigNoz, Temporal technology choices
- Service naming convention (`{scope}-{plane}-{component}`)

### Resolved Conflicts

| Conflict                     | Resolution                                                                                                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loki/Prometheus vs SigNoz    | **SigNoz** — OTel-native, single stack. `dx logs` queries SigNoz.                                                                                                                                                                 |
| Simple RBAC vs SpiceDB       | **SpiceDB** — dx's viewer/deployer/admin/platform-admin are roles in the SpiceDB model. Simple CLI experience, full authorization engine underneath.                                                                              |
| Password/OIDC vs Better-Auth | **Better-Auth** — dx delegates identity to Better-Auth. OAuth, SAML, SCIM, passkeys, agent auth all handled.                                                                                                                      |
| Project vs Module            | **Module** — the deployable unit is a module. "Project" is the local directory context where a developer works. `docker-compose.yaml` declares the module's components via labeled services.                                      |
| Environment vs Site          | **Both, at different levels** — "tier" (staging/production) is the deployment category. "Site" is the actual running instance. `dx deploy --tier staging` hits all staging Sites. `dx deploy --site trafficure-us-east` hits one. |
| Shell workflows vs Temporal  | **Both, at different levels** — Shell scripts for developer-facing shortcuts (`dx start`, `dx submit`, `dx ship`). Temporal for platform orchestration (site provisioning, release rollouts, tenant migration).                   |

---

## 13. Implementation Phasing

### Phase 1 — Foundation

**Build Plane:** CI/CD pipelines, artifact registry, convention engine, `dx dev`/`dx build`/`dx test`/`dx push`, Service Plane SDK v1.
**Fleet Plane:** Basic site lifecycle, single-module deploy, sandbox environments, module-to-site mapping.
**Infrastructure Plane (Factory):** Single K8s cluster, Traefik, basic networking, IPAM, Proxmox integration.
**Infrastructure Plane (Site):** Traefik gateway, K8s-native networking.
**Control Plane (Site):** Authentication (Better-Auth), tenant resolution, basic RBAC (SpiceDB), audit logging.
**Commerce Plane:** Customer accounts, 2-3 pricing plans, entitlement engine, Stripe billing, trial lifecycle.
**Product Plane:** Work item management, module registry, Jira sync.
**Agent Plane:** Agent identity, `dx ask`, agent-friendly CLI flags.

**Outcome:** First SaaS shared Site running. Developer can go from `dx dev` to `dx deploy` to production. Self-serve signup working. Billing collecting.

### Phase 2 — Scale

**Build Plane:** SDK v2, enhanced testing, SBOM/vulnerability scanning.
**Fleet Plane:** Multi-site releases, rolling deployments, canary, automated rollback, tenant migration.
**Agent Plane:** Task orchestration, multi-agent coordination, execution tracking, memory, QA and ops agents.
**Commerce Plane:** Partner/MSP accounts, usage metering, customer portal, dunning.
**Infrastructure Plane:** Multi-cluster, cross-site networking, Vault integration.

**Outcome:** Multiple products running. Partner channel active. Regional shared Sites. Dedicated Sites for enterprise.

### Phase 3 — Enterprise

**Fleet Plane:** Air-gapped deployment, one-way management channels, fleet analytics.
**Agent Plane:** Agent marketplace, third-party agents, cost optimization.
**Commerce Plane:** CPQ, contract management, marketplace integrations, revenue recognition.
**Infrastructure Plane:** Zero-egress mode, customer-operated infrastructure, multi-cloud.
**Control Plane (Site):** Compliance-ready audit export, advanced policy framework.

**Outcome:** Full deployment spectrum — SaaS shared, SaaS dedicated, customer cloud, on-premise, air-gapped. Enterprise commercial maturity.

---

## 14. Open Questions

1. **dx API: monolith or per-plane services?** Phase 1 ships as one API server with per-plane route groups. At what scale/complexity does it make sense to split into separate services per plane?

2. **dx UI: single app or per-plane apps?** One dashboard with plane-based navigation sections, or separate micro-frontends per plane?

3. **Module granularity:** Can a single repo produce multiple modules? If so, how is this declared in `docker-compose.yaml`? The current model assumes one module per repo for simplicity.

4. **Cross-plane event bus:** The planes need to communicate (Commerce → Fleet → Site). What is the eventing mechanism? PostgreSQL LISTEN/NOTIFY for Phase 1, dedicated event bus (NATS, Kafka) for Phase 2?

5. **dx binary vs Factory services:** In Phase 1, the dx CLI binary also runs the API server, reconciler, and builder via `dx serve`. At what point do these become separate deployments? How does this affect the single-binary distribution story for air-gapped environments?

6. **Convention engine ownership:** Is the convention engine a Build Plane service (it enforces build/code standards) or a cross-plane governance service (it also enforces deployment gates which are Fleet Plane)?

7. **Workflow orchestration boundary:** Where exactly does "developer workflow" (shell script, Build Plane) end and "platform orchestration" (Temporal, Fleet/Commerce Plane) begin? The `dx ship` shortcut calls `dx deploy` which triggers a Fleet Plane rollout which may be a Temporal workflow. The boundary needs explicit definition.

---

## Appendix A: Glossary

| Term                 | Definition                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------- |
| **dx**               | The unified CLI, API, and UI for the Software Factory. The one tool every worker uses.       |
| **Software Factory** | The company's internal operating system for building, deploying, and operating all products. |
| **Factory**          | The company-wide system that designs, builds, and operates products. Runs once, centrally.   |
| **Site**             | A running instance of a product in a customer environment. Self-governing at runtime.        |
| **Plane**            | A logical domain of the Factory with defined scope, data model, and authority.               |
| **Module**           | A deployable product capability. The fundamental unit spanning all planes.                   |
| **Module Version**   | A specific buildable version of a module with semantic versioning.                           |
| **Artifact**         | A built output — container image, binary, UI bundle.                                         |
| **Component**        | A running process within a module — api server, worker, frontend.                            |
| **Release**          | A collection of module version pins deployed together. The unit of Fleet deployment.         |
| **Rollout**          | The act of deploying a release to a specific Site.                                           |
| **Tier**             | A deployment category — staging, production, sandbox.                                        |
| **Tenant**           | A customer's isolated partition within a shared Site.                                        |
| **Entitlement**      | A record of what a customer can use. Commerce manages, Control enforces.                     |
| **Convention**       | An organizational rule enforced by the Factory.                                              |
| **Workflow**         | A named shell script sequence of dx commands. Developer-facing automation.                   |
| **Sandbox**          | An ephemeral environment for testing/preview.                                                |
| **Asset**            | Any tracked infrastructure resource.                                                         |
| **Provider**         | An infrastructure source (Proxmox, Hetzner, AWS).                                            |
| **Route**            | A traffic routing rule that maps a domain to a specific rollout.                             |
| **Target**           | A resolvable reference (VM, host, pod, IP) for ssh/exec/logs/code.                           |
| **Principal**        | A security subject — user, service account, or agent.                                        |

## Appendix B: Command Quick Reference by Plane

```
PRODUCT PLANE
  dx work create/list/show/start/done/link
  dx module list/show/create
  dx release plan list/show

BUILD PLANE
  dx dev [component...]
  dx test [component]
  dx lint [component]
  dx build [component] [--push]
  dx branch create/list/clean
  dx commit [message]
  dx push
  dx pr create/status/merge
  dx diff / dx plan <action>
  dx convention validate/report
  dx workflow list/run
  dx start/submit/ship (shortcuts)
  dx explain <topic>

AGENT PLANE
  dx ask <message>
  dx agent list/show/history/run

COMMERCE PLANE
  dx customer list/show/create
  dx entitlement list/show/grant/revoke
  dx plan list/show
  dx billing status
  dx usage show

FLEET PLANE
  dx deploy [component] [--site/--tier]
  dx promote/rollback
  dx release create/show/promote/rollback/status
  dx site list/show/create/upgrade/suspend/decommission
  dx tenant list/show/assign
  dx sandbox create/list/open/ssh/code/exec/logs/share/extend/destroy
  dx status [target]
  dx logs <target>

INFRASTRUCTURE PLANE
  dx infra status/topology/plan/apply
  dx infra datacenter/region/provider/host/node
  dx infra vm create/destroy/start/stop/restart/resize/migrate/snapshot/backup
  dx infra template/cluster/k8s-node/platform/registry
  dx infra ip lookup/list/register/assign/release
  dx infra install/ansible/tag/up
  dx ops scale/restart/drain/maintenance/backup/cron/cert
  dx ssh/exec/code/docker <target>

CROSS-CUTTING
  dx context list/use/show
  dx auth login/logout/status
  dx whoami
  dx sync status/retry/pending
  dx update
```
