# The Deployment Composition Model (Revised)

## Catalog mirrors operations. Simple naming. Factory/Site analogy.

---

## The Principle

The software catalog has a hierarchy: **Domain → System → Component.**

The operational world mirrors it exactly: **Domain Deployment → System Deployment → Component Deployment.**

And a **Site** is the complete installation for a customer — the factory where their
instance of your products runs.

```
SOFTWARE CATALOG                    OPERATIONS
(what we build)                     (what's running)

Domain                         ──→  Domain Deployment
  └── System                   ──→    └── System Deployment
        └── Component          ──→          └── Component Deployment

                                    All wrapped in:
                                    SITE (the customer's installation)
                                    Running on:
                                    CELL (the infrastructure boundary)
```

---

## The Five Entities

### COMPONENT DEPLOYMENT

What we've been calling "Deployment." One component, one version, running in one place.

```
COMPONENT DEPLOYMENT: trafficure-api
  component: trafficure-api (from catalog)
  artifact: trafficure-api:2.4.0
  replicas: 3
  runtime: k8s-namespace "trafficure" in cluster "samsung-eks"
```

This is the leaf. The actual running container, process, or pod. Unchanged from
everything we've built — just renamed for clarity in the hierarchy.

---

### SYSTEM DEPLOYMENT

A running instance of a System. The group of Component Deployments that were deployed
together, version together, and health-check as a unit. What `docker-compose up` or
`helm install` produces.

**The factory analogy:** If a System is the blueprint for a machine, a System
Deployment is one machine built from that blueprint, installed on a factory floor,
running.

| Property                | Description                                                                     |
| ----------------------- | ------------------------------------------------------------------------------- |
| `system`                | Which System from the catalog                                                   |
| `version`               | Release Bundle version: "trafficure-core-2.4.0"                                 |
| `component_deployments` | The Component Deployments in this group                                         |
| `topology`              | single-node-compose, k8s-namespace, multi-node, etc.                            |
| `runtime`               | The compose project, k8s namespace, or set of hosts                             |
| `deployment_mechanism`  | What deploys this as a unit: compose file, helm chart, terraform, signed-bundle |
| `iac_source`            | The specific compose/helm/terraform file                                        |
| `health`                | Aggregate of component health                                                   |
| `deployed_at`           | Last deployed as a unit                                                         |
| `owner_team`            | Team responsible                                                                |

**Examples:**

```
SYSTEM DEPLOYMENT: "trafficure-core @ samsung-prod"
  system: Trafficure Core
  version: 2.4.0
  component_deployments:
    ├── trafficure-api (3 replicas)
    ├── trafficure-ui (2 replicas)
    ├── trafficure-worker (2 replicas)
    └── rf-engine (1 replica, GPU)
  topology: k8s-dedicated
  runtime: k8s-namespace "trafficure" in cluster "samsung-eks"
  mechanism: helm-chart (via Flux)
  health: healthy (all components healthy)

SYSTEM DEPLOYMENT: "trafficure-core @ ultratech-prod"
  system: Trafficure Core
  version: 2.3.0
  component_deployments:
    ├── trafficure-api (1 container)
    ├── trafficure-ui (1 container)
    ├── trafficure-worker (1 container)
    ├── rf-engine (1 container)
    ├── postgres (1 container)
    ├── redis (1 container)
    └── traefik (1 container)
  topology: single-node-compose
  runtime: docker-compose project on ultratech-vm-01
  mechanism: docker-compose
  health: healthy

SYSTEM DEPLOYMENT: "platform @ shared-saas-prod"
  system: Platform
  version: 3.1.0
  component_deployments:
    ├── traefik (DaemonSet)
    ├── ory-kratos (3 replicas)
    ├── ory-hydra (2 replicas)
    ├── spicedb (3 replicas)
    ├── entitlement-service (2 replicas)
    └── otel-collector (DaemonSet)
  topology: k8s-shared
  runtime: k8s-namespace "platform" in cluster "lepton-prod"
  mechanism: helm-chart (via Flux)
  note: SHARED — serves all SaaS sites
```

**System Deployment dependencies:**

```
SYSTEM DEPLOYMENT "trafficure-core @ samsung-prod"
  depends_on:
    ├── SYSTEM DEPLOYMENT "platform @ samsung-prod" (hard)
    └── MANAGED DEPENDENCY "samsung-rds-postgres" (hard)

SYSTEM DEPLOYMENT "smartmarket @ samsung-prod"
  depends_on:
    ├── SYSTEM DEPLOYMENT "platform @ samsung-prod" (hard)
    ├── MANAGED DEPENDENCY "samsung-rds-postgres" (hard)
    └── SYSTEM DEPLOYMENT "trafficure-core @ samsung-prod" (soft — reports reads trafficure data)
```

---

### DOMAIN DEPLOYMENT

A group of System Deployments that together deliver a Domain's capabilities for a
specific context. The Domain Deployment sits between the Site (everything for a
customer) and individual System Deployments.

**When is this useful?** When a Domain contains multiple Systems and you need to think
about them as a group. "The Network Access domain for Samsung" = Trafficure Core +
Trafficure Project Management + RF Engine System, all deployed for Samsung.

| Property              | Description                                        |
| --------------------- | -------------------------------------------------- |
| `domain`              | Which Domain from the catalog                      |
| `system_deployments`  | The System Deployments in this group               |
| `capabilities_active` | Which Capabilities are enabled (from entitlements) |
| `version_summary`     | Versions of each System Deployment                 |

**Examples:**

```
DOMAIN DEPLOYMENT: "Network Access @ samsung-prod"
  domain: Network Access
  system_deployments:
    ├── SYSTEM DEPLOYMENT "trafficure-core @ samsung-prod" (v2.4.0)
    └── SYSTEM DEPLOYMENT "trafficure-project-mgmt @ samsung-prod" (v1.2.0)
  capabilities_active: [Coverage, LOS, Planning, Project Management, RF Kit, SSO, API Access]

DOMAIN DEPLOYMENT: "Market Intelligence @ samsung-prod"
  domain: Market Intelligence
  system_deployments:
    ├── SYSTEM DEPLOYMENT "smartmarket-core @ samsung-prod" (v1.2.0)
    └── SYSTEM DEPLOYMENT "revenue-prediction @ samsung-prod" (v0.9-beta)
  capabilities_active: [Map Exploration, AI Analyst, Reports, Dataset Mgmt, Revenue Prediction]

DOMAIN DEPLOYMENT: "Platform @ samsung-prod"
  domain: Platform
  system_deployments:
    └── SYSTEM DEPLOYMENT "platform @ samsung-prod" (v3.1.0)
  capabilities_active: [IAM, API Gateway, Observability, Entitlements]
  note: Platform domain deployment serves all other domain deployments
```

**When Domain Deployment is optional:** If a Domain only has one System (common for
smaller products), the Domain Deployment is just a thin wrapper and can be skipped
in conversation. "SmartMarket deployment for Samsung" and "Market Intelligence domain
deployment for Samsung" mean the same thing. The entity exists for companies where
Domains contain multiple Systems and you need the grouping.

---

### SITE

**Definition:** The complete installation for a customer — everything running to serve
them across all Domains, all Products, all shared infrastructure. The factory where
their instance of your products operates.

**The factory analogy:** Samsung's Site is their factory. Inside the factory are
production lines (Domain Deployments) for different product families. Each production
line has machines (System Deployments). Each machine has parts (Component Deployments).
The factory sits on a piece of land (Cell).

| Property                      | Description                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `name`                        | "Samsung India Production", "Ultratech Production", "Shared SaaS Production" |
| `tenant`                      | Which customer (or "shared" for multi-tenant SaaS)                           |
| `environment`                 | production, staging, customer-staging, etc.                                  |
| `domain_deployments`          | All Domain Deployments at this site                                          |
| `cell`                        | Which Cell this site runs on                                                 |
| `isolation_level`             | Per-layer isolation: dedicated/shared at compute, data, network levels       |
| `offering`                    | Which commercial Offering governs this site                                  |
| `engagement`                  | Which Engagement manages this site's operations                              |
| `total_system_deployments`    | Count                                                                        |
| `total_component_deployments` | Count                                                                        |
| `health`                      | Aggregate: all domains healthy → site healthy                                |
| `cost`                        | Total infrastructure cost for this site                                      |

**Examples:**

```
SITE: "Samsung India Production"
  tenant: Samsung India
  environment: production
  cell: samsung-dedicated-mumbai
  offering: Enterprise Managed
  engagement: Samsung Managed Service (ENG-032)
  isolation: fully dedicated (compute, data, network)
  │
  ├── DOMAIN DEPLOYMENT: "Network Access @ samsung-prod"
  │     ├── SYSTEM DEPLOYMENT: trafficure-core (v2.4.0)
  │     └── SYSTEM DEPLOYMENT: trafficure-project-mgmt (v1.2.0)
  │
  ├── DOMAIN DEPLOYMENT: "Market Intelligence @ samsung-prod"
  │     ├── SYSTEM DEPLOYMENT: smartmarket-core (v1.2.0)
  │     └── SYSTEM DEPLOYMENT: revenue-prediction (v0.9-beta)
  │
  ├── DOMAIN DEPLOYMENT: "Platform @ samsung-prod"
  │     └── SYSTEM DEPLOYMENT: platform (v3.1.0)
  │
  └── DOMAIN DEPLOYMENT: "Extensions @ samsung-prod"
        └── SYSTEM DEPLOYMENT: tower-analyzer (v1.2.0, partner)

  TOTALS: 4 domains, 6 system deployments, ~20 component deployments
  COST: ₹X/month (Samsung's dedicated infrastructure)
  HEALTH: all healthy

---

SITE: "Samsung India Staging"
  tenant: Samsung India
  environment: customer-staging
  cell: samsung-dedicated-mumbai (same cell, different namespace/config)
  note: Samsung validates new versions here before approving production deployment
  versions: ahead of production (testing v2.5.0-rc1)

---

SITE: "Ultratech Production"
  tenant: Ultratech Cement
  environment: production
  cell: ultratech-onprem
  offering: Enterprise On-Prem
  engagement: Ultratech Managed Service (ENG-043)
  isolation: dedicated by default (own server)
  │
  ├── DOMAIN DEPLOYMENT: "Network Access @ ultratech-prod"
  │     └── SYSTEM DEPLOYMENT: trafficure-core (v2.3.0)
  │           (includes platform components — all in one compose stack)
  │
  └── (no other domains — Ultratech only has Trafficure)

  TOTALS: 1 domain, 1 system deployment, ~8 component deployments
  COST: ₹0 infrastructure (customer's hardware) + ops team time
  HEALTH: healthy (last verified 3 days ago via VPN)

---

SITE: "Shared SaaS Production"
  tenant: shared (50 customers)
  environment: production
  cell: lepton-saas-prod-mumbai
  offering: various (each tenant has their own plan/offering)
  │
  ├── DOMAIN DEPLOYMENT: "Network Access @ shared-saas-prod"
  │     └── SYSTEM DEPLOYMENT: trafficure-core (v2.5.0, multi-tenant)
  │
  ├── DOMAIN DEPLOYMENT: "Market Intelligence @ shared-saas-prod"
  │     └── SYSTEM DEPLOYMENT: smartmarket-core (v1.3.0, multi-tenant)
  │
  └── DOMAIN DEPLOYMENT: "Platform @ shared-saas-prod"
        └── SYSTEM DEPLOYMENT: platform (v3.1.0, shared)

  TENANTS SERVED: [ather, vbl, customer-c, ... 50 total]
  Each tenant's "virtual site" is a projection:
    Ather sees: smartmarket capabilities (their subscription)
    VBL sees: trafficure capabilities (their subscription)
    Customer-C sees: both (their subscription)

  ISOLATION: application-level (orgId), schema-per-tenant in shared RDS
  COST: shared, allocated by usage proportion per tenant
```

**A customer can have multiple Sites:** Samsung has a production Site AND a staging
Site. A customer evaluating your product has a trial Site. When you migrate a customer
from Compose to K8s, they temporarily have two production Sites (old and new) during
the migration.

---

### CELL

Unchanged from previous document. The infrastructure boundary that hosts Sites.

```
CELL: "lepton-saas-prod-mumbai"
  sites: ["Shared SaaS Production"]
  tenants: 50
  infrastructure: EKS cluster, RDS, ElastiCache, S3
  blast_radius: all 50 SaaS tenants

CELL: "samsung-dedicated-mumbai"
  sites: ["Samsung India Production", "Samsung India Staging"]
  tenants: 1 (Samsung)
  infrastructure: EKS cluster in Samsung's AWS account
  blast_radius: Samsung only

CELL: "ultratech-onprem"
  sites: ["Ultratech Production"]
  tenants: 1 (Ultratech)
  infrastructure: 1 VM in Ultratech's server room
  blast_radius: Ultratech only
```

---

## The Complete Hierarchy

```
CATALOG (what we design)          OPERATIONS (what's running)         INFRASTRUCTURE (where)

Domain                        →   Domain Deployment
  └── System                  →     └── System Deployment              ← runs on → Cell
        └── Component         →           └── Component Deployment     ← runs on → Runtime → Host

                                    Grouped into:
                                    SITE (per customer × environment)  ← hosted by → Cell
```

### Reading it top-down:

**Site** "Samsung India Production"
contains **Domain Deployments** for Network Access, Market Intelligence, Platform
each containing **System Deployments** for Trafficure Core, SmartMarket, Platform Services
each containing **Component Deployments** for trafficure-api, trafficure-ui, etc.
all running on **Cell** "samsung-dedicated-mumbai"
which consists of **Hosts** in **Substrate** Samsung AWS ap-south-1.

### Reading it bottom-up:

**Component Deployment** trafficure-api:2.4.0
is part of **System Deployment** "trafficure-core @ samsung-prod"
is part of **Domain Deployment** "Network Access @ samsung-prod"
is part of **Site** "Samsung India Production"
runs on **Runtime** k8s-namespace in **Host** eks-worker in **Cell** samsung-dedicated
managed under **Engagement** Samsung Managed Service
for **Customer** Samsung India
who subscribes to **Plan** Lepton Intelligence Suite
which entitles **Capabilities** that require this **Component**.

---

## When to Use Each Level in Conversation

| Level                    | When you say it                                                                                 | Example                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Site**                 | Talking to customers, account managers, leadership, during incidents affecting a whole customer | "Samsung's site is healthy." "Provision a new site for the Jio trial."                                    |
| **Domain Deployment**    | Talking about a product area for a customer                                                     | "The Network Access domain for Ultratech needs the v2.5 upgrade."                                         |
| **System Deployment**    | Talking to the owning team about their system's instance                                        | "The Trafficure Core deployment for Samsung is on v2.4.0." "Upgrade SmartMarket on the shared SaaS site." |
| **Component Deployment** | Debugging, on-call, CI/CD pipelines, detailed operations                                        | "The trafficure-api deployment has high error rate." "Roll back the rf-engine component deployment."      |
| **Cell**                 | Capacity planning, infrastructure ops, blast radius analysis                                    | "The SaaS cell is at 72% utilization." "We need a second cell by Q3."                                     |

Most conversations happen at the **Site** and **System Deployment** levels. Component
Deployment is for when you're in the weeds. Domain Deployment is for when you need the
grouping. Cell is for infra planning.

---

## The Single-Node Collapse

On a single-node Compose deployment (like Ultratech), all levels collapse:

```
SITE: "Ultratech Production"
  └── DOMAIN DEPLOYMENT: "Network Access @ ultratech"
        └── SYSTEM DEPLOYMENT: "trafficure-core @ ultratech"
              ├── COMPONENT DEPLOYMENT: trafficure-api
              ├── COMPONENT DEPLOYMENT: trafficure-ui
              ├── COMPONENT DEPLOYMENT: postgres
              ├── ... (all in one compose file on one VM)
              │
              NOTE: Platform components (traefik, kratos) are INSIDE
                    this System Deployment, not a separate System Deployment.
                    On single-node, everything collapses into one compose project.
              │
              CELL: ultratech-onprem (= one VM)
```

One site, one domain deployment, one system deployment, one compose file, one VM, one
cell. The hierarchy is still there but every level has exactly one member. That's fine —
the vocabulary works whether you have 1 or 100 of each level.

The value of the hierarchy shows when Ultratech upgrades to a multi-product, multi-node
setup — the same vocabulary scales up without renaming anything.

---

## Multi-Tenant Shared Sites

The shared SaaS site is special because one set of System Deployments serves many
tenants. Each tenant doesn't have their own System Deployments — they share them.

How do you talk about "what Ather has" when Ather doesn't have dedicated infrastructure?

**Approach: Virtual Site per tenant.**

Each SaaS tenant gets a virtual Site record that describes what THEY see and what
THEY'RE entitled to, even though the underlying System Deployments are shared:

```
SITE: "Ather Production" (virtual — no dedicated infra)
  tenant: Ather Energy
  environment: production
  hosted_on: SITE "Shared SaaS Production" (the physical site)
  │
  ├── Products active: [SmartMarket]
  ├── Capabilities entitled: [Map Exploration, AI Analyst, Reports, Dataset Mgmt]
  ├── Capabilities NOT entitled: [Coverage, LOS, Planning, Revenue Prediction, ...]
  │
  ├── System Deployments serving Ather:
  │     ├── SYSTEM DEPLOYMENT "smartmarket-core @ shared-saas" (shared, Ather is one of N tenants)
  │     └── SYSTEM DEPLOYMENT "platform @ shared-saas" (shared)
  │     NOTE: Ather is NOT served by the Trafficure system deployment (not subscribed)
  │
  ├── Isolation:
  │     data: schema "ather" in shared RDS
  │     compute: shared pods, orgId filter
  │     network: shared ingress
  │
  ├── Engagement: none (self-service SaaS, no managed service engagement)
  ├── Subscription: SmartMarket Professional (monthly)
  │
  └── Cost: allocated by usage proportion from shared infrastructure
```

The virtual Site makes Ather a first-class citizen in your operations model even
though they share infrastructure. When Ather reports a problem, you pull up their
virtual Site, see which System Deployments serve them, check their entitlements, and
investigate within the shared infrastructure filtered to their tenant context.

---

## Summary

| Entity                   | Mirrors             | Definition                                                      | Analogy                        |
| ------------------------ | ------------------- | --------------------------------------------------------------- | ------------------------------ |
| **Component Deployment** | Component           | One component version running                                   | A part in a machine            |
| **System Deployment**    | System              | A running instance of a System (group of component deployments) | A machine on the factory floor |
| **Domain Deployment**    | Domain              | All System Deployments for a business domain                    | A production line              |
| **Site**                 | (the whole factory) | Everything running for one customer in one environment          | The factory                    |
| **Cell**                 | (the land/building) | Infrastructure boundary hosting one or more sites               | The industrial park            |

Clean, simple, mirrors the catalog, scales from one VM to a hundred-customer SaaS
cluster.
