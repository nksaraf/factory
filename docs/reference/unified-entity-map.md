# The Unified Entity Map

## Every entity. Every connection. One picture.

---

## The Four Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│ COMMERCIAL    What we sell, who buys it, what they're entitled to   │
├─────────────────────────────────────────────────────────────────────┤
│ CATALOG       What we build, how it's designed and packaged         │
├─────────────────────────────────────────────────────────────────────┤
│ OPERATIONS    What's running, for whom, at what version             │
├─────────────────────────────────────────────────────────────────────┤
│ INFRASTRUCTURE  Where things run, on what hardware/cloud            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Every Entity, Placed

### COMMERCIAL LAYER

```
Product ─── Capability ─── Billable Metric
                │
Plan ────── Line Item (references Capabilities)
                │
Customer ── Subscription ── Subscription Item (grants Capabilities)
    │                            │
    │       Engagement ──────────┘ (creates/manages Sites)
    │
    └────── Wallet, Invoice (billing)

Partner ─── Extension ─── Marketplace Listing ─── Installation
```

### CATALOG LAYER

```
Domain
  └── System
        └── Component ─── API
              │
              └── Artifact ──→ (built by CI from Component source code)
                    │
              Release Bundle ──→ (groups Artifacts for a System, versioned)

Template ──→ (scaffolds new Components, Systems, or System Deployments)
```

### OPERATIONS LAYER

```
Site
  └── Domain Deployment
        └── System Deployment ──→ deployed from a Release Bundle
              └── Component Deployment ──→ runs a specific Artifact
                    └── Workload (actual running process/container)
```

### INFRASTRUCTURE LAYER

```
Substrate (nests: cloud account → region → VPC → subnet; or datacenter → rack)
  └── Host (long-lived machine with OS)
  └── Workspace (ephemeral machine — dev env, CI runner, preview host)
        │
        └── Runtime (what supervises processes: Docker, K8s, systemd)
              │
              └── (Component Deployments run here)

Network Entity (load balancer, DNS, VPN, cert, firewall, VLAN, message topic)
Managed Dependency (RDS, S3, SendGrid — third-party services)
Data Store (the actual data, with residency/retention/backup rules)
Secret (credentials, keys, tokens)
```

### PEOPLE LAYER

```
Team ─── Person
    └── Agent
    └── On-Call Rotation
    └── Allocation (person × work target × percentage)
```

---

## The Connections — How Everything Links

### Code to Running Software (the build-deploy chain)

```
DEVELOPER writes code in ──→ COMPONENT (source repo)
                                │
                          CI pipeline builds
                                │
                                ▼
                            ARTIFACT (container image, binary, chart)
                                │
                          grouped into
                                │
                                ▼
                         RELEASE BUNDLE (versioned set of artifacts for a System)
                                │
                          deployed as
                                │
                                ▼
                      SYSTEM DEPLOYMENT (at a Site, for a tenant)
                          │         │
              consists of │         │ runs on
                          ▼         ▼
               COMPONENT DEPLOYMENT ──→ RUNTIME ──→ HOST ──→ SUBSTRATE
                          │
                    manifests as
                          │
                          ▼
                       WORKLOAD (actual container/process/pod)
```

**Where the Release Bundle fits:** A Release Bundle is the SHIPPABLE UNIT. It sits
between the catalog (Artifacts) and operations (System Deployments). When you say
"deploy Trafficure Core 2.5.0 to Samsung," you're saying: take Release Bundle
"trafficure-core-2.5.0" and create/update the System Deployment at Samsung's Site.

```
RELEASE BUNDLE "trafficure-core-2.5.0"
  contains:
    ARTIFACT trafficure-api:2.5.0
    ARTIFACT trafficure-ui:2.5.0
    ARTIFACT trafficure-worker:2.5.0
    ARTIFACT rf-engine:2.5.0
  │
  deployed to:
    SYSTEM DEPLOYMENT "trafficure-core @ shared-saas-prod" → updated to 2.5.0 ✓
    SYSTEM DEPLOYMENT "trafficure-core @ samsung-prod" → scheduled for Sunday ⏳
    SYSTEM DEPLOYMENT "trafficure-core @ ultratech-prod" → still on 2.3.0, skipping ✗
  │
  delivered as:
    SIGNED BUNDLE "trafficure-2.5.0-airgap.tar.gz" → for air-gapped customers
```

The Release Bundle is not operational (it doesn't run) and not infrastructure (it's
not a place). It's a catalog entity that bridges to operations. It answers: "what
version of what system is available to deploy, and where has it been deployed so far?"

### Commercial to Operations (what was sold → what's running)

```
CUSTOMER "Samsung India"
  │
  ├── SUBSCRIPTION ──→ PLAN "Lepton Intelligence Suite"
  │     └── SUBSCRIPTION ITEMS ──→ grant CAPABILITIES
  │           └── Capabilities determine which COMPONENTS must be deployed
  │                 └── Components are deployed as COMPONENT DEPLOYMENTS
  │                       └── within SYSTEM DEPLOYMENTS
  │                             └── within DOMAIN DEPLOYMENTS
  │                                   └── at a SITE
  │
  └── ENGAGEMENT "Samsung Managed Service"
        └── manages the SITE "Samsung India Production"
              └── which hosts all the Domain/System/Component Deployments
```

The resolution chain from "what they bought" to "what's running":

```
Subscription Items → Capabilities → requires Components → deployed as:

  Capability "Coverage Analysis"
    requires: [coverage-service, coverage-ui]
    these Components exist in System "Trafficure Core"
    which has a System Deployment at Samsung's Site
    containing Component Deployments for coverage-service and coverage-ui
    running as Workloads on the Runtime in Samsung's infrastructure
```

### Infrastructure connections (what runs where)

```
SITE "Samsung India Production"
  │
  ├── hosted on → SUBSTRATE "Samsung AWS ap-south-1"
  │                 └── contains HOSTS (EKS worker nodes)
  │                       └── running RUNTIMES (K8s cluster → namespaces)
  │
  ├── SYSTEM DEPLOYMENT "trafficure-core @ samsung"
  │     runs on → RUNTIME: k8s-namespace "trafficure" in cluster "samsung-eks"
  │     │
  │     └── COMPONENT DEPLOYMENT "trafficure-api"
  │           runs on → same RUNTIME (k8s namespace)
  │           current HOST → eks-worker-i-0a1b2c (but K8s may reschedule)
  │           └── WORKLOAD: pod trafficure-api-7d4f8c-abc (the actual process)
  │
  ├── uses → MANAGED DEPENDENCY "Samsung RDS Postgres"
  │           in SUBSTRATE "Samsung AWS ap-south-1"
  │
  ├── stores data in → DATA STORE "samsung-trafficure-db"
  │                      served by "Samsung RDS Postgres"
  │
  ├── connected via → NETWORK ENTITY "samsung-nlb" (load balancer)
  │                 → NETWORK ENTITY "samsung-route53" (DNS)
  │                 → NETWORK ENTITY "samsung-tls-cert" (certificate)
  │
  └── authenticated by → SECRET "samsung-db-credential"
                       → SECRET "samsung-ory-secrets"
```

### Workspaces in the picture

Workspaces are ephemeral hosts. They fit exactly where hosts fit, but with different
lifecycle semantics:

```
FOR A PR PREVIEW:

  SITE "PR-1847 Preview" (ephemeral site, auto-destroyed on merge)
    └── SYSTEM DEPLOYMENT "trafficure-core @ pr-1847-preview"
          runs on → RUNTIME: docker-compose on WORKSPACE "preview-pr-1847"
                                                    │
                                              WORKSPACE
                                                type: preview-environment
                                                implementation: LXC on Proxmox
                                                    or K8s pod with DinD
                                                TTL: destroy on PR merge
                                                substrate: Lepton Proxmox cluster
                                                    or lepton-saas-dev cluster

FOR A DEVELOPER:

  (no Site — a developer workspace isn't a Site, it's personal)
  WORKSPACE "dev-nikhil"
    type: developer-workspace
    implementation: LXC on Proxmox with DinD
    has: full Trafficure stack running locally via Compose
    NOT tracked as a Site — it's a personal tool, not an installation

FOR A CI RUNNER:

  (no Site — a CI runner is infrastructure, not an installation)
  WORKSPACE "ci-runner-ephemeral-847"
    type: ci-runner
    implementation: K8s pod, destroyed after job
    purpose: build and test Artifacts
    NOT tracked as a Site — it's build infrastructure

FOR AN AI AGENT SANDBOX:

  WORKSPACE "claude-code-sandbox-task-4521"
    type: agent-sandbox
    implementation: K8s pod with DinD, scoped to trafficure repo
    TTL: task completion + 1 hour
    NOT tracked as a Site — it's a work environment
```

**The rule: a Site exists when software is deployed FOR A PURPOSE (serving a customer,
validating a release, demonstrating to a prospect). Workspaces that exist for building,
developing, or testing are infrastructure, not Sites.**

But a preview environment IS a Site — it's a temporary Site whose purpose is "validate
this PR for review." A demo environment IS a Site — "demonstrate the product to prospect
X." A POC IS a Site — "let customer X evaluate the product."

```
IS A SITE:                           NOT A SITE:
  Customer production                  Developer's local workspace
  Customer staging                     CI runner
  Shared SaaS production               Agent sandbox
  Preview environment (per-PR)         Build environment
  Demo environment                     Load test environment (debatable)
  POC/trial environment                Your staging (debatable — could go either way)
  DR standby
```

Your internal staging is a judgment call. It's not for a customer, but it IS a
running installation that mirrors production. You could model it as an internal Site
(tenant: "internal", environment: "staging") or just as System Deployments on
infrastructure. I'd make it a Site — it's useful to have the same vocabulary for
"staging is healthy" and "Samsung is healthy."

---

## The Complete Entity List

### Catalog (7 entities) — what we build

| Entity             | Parent                        | Connects to                                          |
| ------------------ | ----------------------------- | ---------------------------------------------------- |
| **Domain**         | —                             | Contains Systems                                     |
| **System**         | Domain                        | Contains Components, has Release Bundles             |
| **Component**      | System                        | Has APIs, produces Artifacts, owned by Team          |
| **API**            | Component provides it         | Consumed by other Components, used by Partners       |
| **Artifact**       | Built from Component          | Stored in registry, part of Release Bundle           |
| **Release Bundle** | Groups Artifacts for a System | Deployed as System Deployments                       |
| **Template**       | —                             | Scaffolds Components, System Deployments, Workspaces |

### Operations (5 entities) — what's running

| Entity                   | Parent               | Connects to                                                                                       |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------------------------- |
| **Site**                 | —                    | For a Customer+Environment, contains Domain Deployments, hosted on Substrate(s)                   |
| **Domain Deployment**    | Site                 | Groups System Deployments for a Domain                                                            |
| **System Deployment**    | Domain Deployment    | Instance of a System at a Release Bundle version, contains Component Deployments, runs on Runtime |
| **Component Deployment** | System Deployment    | Runs an Artifact on a Runtime, produces Workloads                                                 |
| **Workload**             | Component Deployment | Actual running process/container on a Host                                                        |

### Infrastructure (8 entities) — where things run

| Entity                 | Parent                                        | Connects to                               |
| ---------------------- | --------------------------------------------- | ----------------------------------------- |
| **Substrate**          | Substrates nest                               | Contains Hosts and Workspaces             |
| **Host**               | Substrate                                     | Long-lived machine, runs Runtimes         |
| **Workspace**          | Substrate                                     | Ephemeral machine, runs Runtimes, has TTL |
| **Runtime**            | Host or Workspace, runtimes nest              | Hosts Component Deployments               |
| **Network Entity**     | —                                             | Connects Sites, Deployments, Hosts        |
| **Managed Dependency** | Substrate (cloud account)                     | Used by Component Deployments             |
| **Data Store**         | Served by Managed Dep or Component Deployment | Holds data with residency/retention rules |
| **Secret**             | Stored in Vault/K8s/file                      | Used by Component Deployments             |

### Commercial (12 entities) — what we sell

| Entity                | Parent          | Connects to                                    |
| --------------------- | --------------- | ---------------------------------------------- |
| **Product**           | —               | Realized by Systems (catalog), sold as Plans   |
| **Capability**        | Product         | Requires Components, priced via Line Items     |
| **Billable Metric**   | —               | Measures consumption, referenced by Line Items |
| **Plan**              | —               | Contains Line Items, references Capabilities   |
| **Line Item**         | Plan            | Grants Capability and/or defines charge        |
| **Customer**          | —               | Has Subscriptions, Engagements, Sites          |
| **Subscription**      | Customer × Plan | Contains Subscription Items                    |
| **Subscription Item** | Subscription    | Grants a Capability, defines quantity/price    |
| **Engagement**        | Customer        | Creates/manages Sites                          |
| **Wallet**            | Customer        | Prepaid balance                                |
| **Invoice**           | Customer        | Generated from Subscriptions + Usage           |
| **Partner**           | —               | Builds Extensions, sells via Marketplace       |

### People (5 entities)

| Entity               | Parent                     | Connects to                                |
| -------------------- | -------------------------- | ------------------------------------------ |
| **Team**             | —                          | Owns Systems, Components, Sites            |
| **Person**           | Team                       | Allocated to Engagements, Systems, on-call |
| **Agent**            | Team, supervised by Person | Scoped to Components, trust-leveled        |
| **Allocation**       | Person × work target       | Percentage of time commitment              |
| **On-Call Rotation** | Team                       | Covers Sites/System Deployments            |

### Ecosystem (4 entities)

| Entity                  | Parent                     | Connects to                         |
| ----------------------- | -------------------------- | ----------------------------------- |
| **Partner**             | —                          | Builds Extensions                   |
| **Extension**           | Partner, type of Component | Uses Extension Points               |
| **Extension Point**     | Type of API                | Defines partner integration surface |
| **Marketplace Listing** | Partner × Extension        | Installed by Customers              |

---

## Total: 41 entities

But the WORKING SET for daily conversation is much smaller:

| Role                  | Their ~8 entities                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------- |
| **Developer**         | Component, Artifact, Component Deployment, Runtime, Workspace, API, Team, Agent               |
| **Tech Lead**         | System, System Deployment, Release Bundle, Site, Component, API, Team, Engagement             |
| **SRE/Ops**           | Site, System Deployment, Component Deployment, Host, Runtime, Network Entity, Secret, On-Call |
| **Product Manager**   | Product, Capability, Plan, Customer, Roadmap, Engagement, Site, Release Bundle                |
| **Delivery Manager**  | Engagement, Site, Customer, System Deployment, Release Bundle, Team, Allocation, Offering     |
| **Sales**             | Product, Capability, Plan, Customer, Partner, Marketplace Listing, Engagement, Site           |
| **Platform Engineer** | Runtime, Host, Workspace, Substrate, Template, Extension Point, System, Network Entity        |

---

## The One Diagram

```
            CUSTOMER
           /    |    \
     buys    contracts  entitled to
    plans    engagements  capabilities
       \        |        /
        \       |       /
         ▼      ▼      ▼
    ┌──────────────────────┐        ┌──────────────────────┐
    │       SITE           │        │    CATALOG            │
    │  (the factory)       │        │                       │
    │                      │        │  Domain               │
    │  Domain Deployment ◄─┼────────┤    └ System           │
    │    └ System Dep.   ◄─┼────────┤        └ Component    │
    │        └ Comp Dep  ◄─┼────┐   │            └ API      │
    │            └ Workload│    │   │            └ Artifact  │
    └──────────┬───────────┘    │   │        └ Rel. Bundle ─┼──→ deployed as System Dep.
               │                │   └──────────────────────┘
          runs on               │
               │           runs artifact
               ▼                │
    ┌──────────────────────┐    │
    │   INFRASTRUCTURE     │    │
    │                      │    │
    │   Substrate          │    │
    │     └ Host/Workspace │    │
    │         └ Runtime ◄──┼────┘
    │                      │
    │   Network Entity     │
    │   Managed Dependency │
    │   Data Store         │
    │   Secret             │
    └──────────────────────┘
```

Read it as: a Customer's Site contains Domain/System/Component Deployments that mirror
the catalog hierarchy. Each Component Deployment runs a specific Artifact (from the
catalog) on a specific Runtime (from infrastructure). System Deployments are created
from Release Bundles. Sites are hosted on Substrates. Everything connects.
