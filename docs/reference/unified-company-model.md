# The Unified Company Model

## How a software product-and-services company actually works

---

## What This Document Is

We've been building pieces: infrastructure model, software catalog, commercial packaging,
document catalog. This document is the MAP that shows how all the pieces connect — and
reveals the pieces we were missing because we were thinking bottom-up instead of top-down.

Lepton isn't one business. It's three businesses sharing infrastructure, people, and
technology:

1. **The Product Business** — Trafficure, SmartMarket: built once, sold many times
2. **The Data Business** — datasets, analytics, intelligence sold as assets
3. **The Services Business** — custom software projects, implementations, consulting

Each has different economics, different delivery models, different success metrics. But
they share a common foundation and they sell together (Samsung buys Trafficure AND
custom development AND data). The company model must unify all three.

---

## The Company Model — Top Level

```
LEPTON SOFTWARE
│
├── BUSINESS LINES (what we sell)
│   ├── Product Business
│   │     └── Products → Capabilities → Plans → Subscriptions
│   ├── Data Business
│   │     └── Data Products → Datasets → Data Plans → Data Subscriptions
│   └── Services Business
│         └── Service Offerings → Engagements → Deliverables
│
├── ENGINEERING (what we build)
│   ├── Software Catalog
│   │     └── Domains → Systems → Components → APIs → Artifacts
│   ├── Data Catalog
│   │     └── Data Domains → Data Products → Datasets → Pipelines
│   └── Infrastructure Catalog
│         └── Substrates → Hosts → Workspaces → Runtimes → Network
│
├── OPERATIONS (how we deliver and run)
│   ├── Deployments (product instances running for customers)
│   ├── Data Deliveries (datasets delivered to customers)
│   └── Project Deliveries (custom software handed over)
│
├── CUSTOMERS (who we serve)
│   └── Customer → Subscriptions + Engagements + Data Subscriptions
│
└── ORGANIZATION (who we are)
    └── Teams → People → Skills → Capacity
```

---

## The Three Business Lines — Detailed

### Business Line 1: PRODUCT BUSINESS

**Economics:** High upfront investment (build the product), low marginal cost per
additional customer. Revenue grows with customers, not with headcount.

**What you sell:** Capabilities packaged into Plans. "Trafficure Professional with
Coverage, LOS, and Planning" or "SmartMarket with AI Analyst."

**How it connects to engineering:**

```
PRODUCT WORLD                          ENGINEERING WORLD

Product "Trafficure"           ←→      Domain "Network Access"
  └── Capability                         └── System "Trafficure Core"
        "Coverage Analysis"    ←→              ├── Component "coverage-service"
                                               ├── Component "coverage-ui"
                                               └── Component "rf-engine"
```

The connection: a **Product** is the commercial identity of one or more **Systems**. A
**Capability** is the commercial identity of a coherent set of **Components** within
those systems. The Product doesn't know about Components. The Component doesn't know
about pricing. The Capability is the bridge.

But this raises a question our model never answered clearly: **what exactly is a
System?**

### Defining System Precisely

A System has been loosely defined as "a collection of components that cooperate." But
in the unified model, a System has a very specific meaning:

**A System is the largest unit of software that a single team can own end-to-end and
that can be independently deployed and operated.**

This means:

- A System has ONE owning team (stream-aligned team in Team Topologies language)
- A System can be deployed without deploying other Systems
- A System has a clear API boundary — other Systems interact with it only through its
  public APIs
- A System maps to a Release Bundle — the things that ship together

Systems are NOT the same as Products. Trafficure (the Product) might be realized by
multiple Systems: "Trafficure Core" (planning, coverage, LOS), "Trafficure Project
Management" (project tracking), and "RF Engine" (computation). These Systems can be
owned by different teams, deployed independently, and evolved on different cadences.

Systems are NOT the same as Capabilities. The "Coverage Analysis" Capability needs
Components from the "Trafficure Core" System AND from the "RF Engine" System. A
Capability can span Systems. A System can contribute to multiple Capabilities.

**The mapping is many-to-many:**

```
Product ←——— many-to-many ———→ System
   │                              │
   └── Capability ←— m:m ——→ Component
         │
         └── (Capability = commercial view of what Components provide together)
```

### Business Line 2: DATA BUSINESS

**Economics:** Investment in data acquisition, curation, and pipeline infrastructure.
Value is in the data itself, not the software that serves it. Revenue can be
subscription (access to a live dataset), transactional (per-query or per-download),
or project-based (custom analytics engagement).

**What you sell:** Access to datasets, analytical insights, data intelligence. This
might be terrain data for network planning, market data for SmartMarket, demographic
data, geographic data, or customer-specific derived analytics.

**The data business needs its own vocabulary** because data products are fundamentally
different from software products:

#### DATA PRODUCT

**Definition:** A curated, maintained, trustworthy collection of data that delivers
value to consumers. A data product has an owner, a quality SLA, a schema, a freshness
guarantee, and consumers who depend on it.

This is NOT the same as a Data Store (from V3). A Data Store is WHERE data lives
(Postgres, S3). A Data Product is WHAT the data means and how it's curated, quality-
controlled, and served.

| Property          | Description                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `name`            | "India Terrain Elevation Data", "Telecom Tower Registry", "Market Demographics Dataset"                      |
| `domain`          | Business domain: "Network Intelligence", "Market Intelligence", "Geographic"                                 |
| `owner_team`      | Data team responsible for quality and freshness                                                              |
| `description`     | What this data represents and what it's useful for                                                           |
| `schema`          | Data dictionary — fields, types, descriptions                                                                |
| `freshness_sla`   | How often data is updated: real-time, daily, weekly, monthly, static                                         |
| `quality_metrics` | Completeness, accuracy, consistency, timeliness — measured and reported                                      |
| `source`          | Where the data comes from: government open data, commercial providers, customer-provided, internally derived |
| `license`         | What restrictions exist on redistribution: open, commercial-use-only, customer-specific, proprietary         |
| `consumers`       | Which Capabilities, Components, or Customers consume this data                                               |
| `stored_in`       | Which Data Store(s) hold this data                                                                           |
| `produced_by`     | Which Data Pipeline(s) create/update this data                                                               |
| `access_method`   | How consumers access it: API, bulk download, database query, file drop                                       |
| `lifecycle`       | `curating`, `active`, `deprecated`, `archived`                                                               |

#### DATA PIPELINE

**Definition:** An automated process that acquires, transforms, validates, and loads
data into a Data Product. This is the data equivalent of a CI/CD pipeline for software.

| Property         | Description                                                                            |
| ---------------- | -------------------------------------------------------------------------------------- |
| `name`           | "Terrain Data Ingestion", "Tower Registry Daily Sync", "Market Demographics ETL"       |
| `data_product`   | Which Data Product this produces/updates                                               |
| `source_systems` | Where input data comes from                                                            |
| `schedule`       | How often it runs: real-time, hourly, daily, weekly, on-demand                         |
| `components`     | Technical Components that implement this pipeline (Python scripts, Airflow DAGs, etc.) |
| `monitoring`     | How pipeline health is tracked: success/failure alerts, data quality checks            |
| `owner_team`     | Data engineering team responsible                                                      |

#### How Data Products Connect to Software Products

```
DATA PRODUCT "India Terrain Elevation Data"
  └── consumed by → CAPABILITY "Coverage Analysis" (in Trafficure)
  └── consumed by → CAPABILITY "LOS Analysis" (in Trafficure)
  └── consumed by → DATA PRODUCT "Network Coverage Quality Index" (derived data product)
  └── stored in → DATA STORE "terrain-tiles-s3" (infrastructure)
  └── produced by → DATA PIPELINE "terrain-ingestion" (engineering)
  └── sold via → DATA PLAN "Terrain Data Access" (commercial)
```

Data Products can be:

- **Embedded** in a software product (terrain data is bundled with Trafficure — customer
  doesn't buy it separately, it's part of the Capability)
- **Standalone** (sold independently — "Buy access to our Tower Registry dataset")
- **Derived** (created by combining customer data with your data — "Revenue Prediction
  trained on Samsung's sales data + our market demographics")

When a Data Product is sold standalone, it needs its own Plan, Subscription, and
entitlement system — just like software Capabilities. When it's embedded, it's just a
dependency of the Capability, invisible to the customer.

### Business Line 3: SERVICES BUSINESS

**Economics:** Revenue scales with headcount, not with customers. Every engagement
requires people. Margins come from efficiency (reusing tools, templates, accelerators)
and leverage (junior engineers supervised by seniors).

**What you sell:** Human expertise applied to a customer's specific problem. Could be:
implementing your own products, building custom software from scratch, data analytics
consulting, or staff augmentation.

**The services business needs different vocabulary** because the "product" is the work,
not the software:

#### SERVICE OFFERING

**Definition:** A repeatable, packageable consulting or development capability that your
company can deliver. Not a specific customer engagement — the TEMPLATE for engagements.

| Property           | Description                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`             | "Trafficure Implementation", "Custom Application Development", "Data Analytics Consulting", "Network Planning Optimization Workshop"                             |
| `type`             | `implementation` (deploying your product), `custom-development` (building bespoke), `consulting` (advisory), `training`, `staff-augmentation`, `managed-service` |
| `description`      | What this service delivers                                                                                                                                       |
| `typical_duration` | 2-4 weeks, 3-6 months, ongoing                                                                                                                                   |
| `typical_team`     | Team composition: 1 architect + 2 developers + 1 PM                                                                                                              |
| `deliverables`     | What the customer gets: deployed product, custom software, report, trained team                                                                                  |
| `reusable_assets`  | Templates, accelerators, frameworks, tools that speed up delivery                                                                                                |
| `prerequisites`    | What must exist before this service can be delivered (e.g., "customer must have Trafficure Enterprise license")                                                  |
| `pricing_model`    | `fixed-price`, `time-and-materials`, `retainer`, `included-in-subscription`                                                                                      |
| `owner_team`       | Delivery/consulting team                                                                                                                                         |

#### ENGAGEMENT (refined)

An Engagement is now the intersection of a Customer, a Service Offering, and possibly
Product Capabilities:

```
ENGAGEMENT "Samsung Trafficure + SmartMarket Implementation"
  customer: Samsung India
  service_offering: "Trafficure Implementation" + "SmartMarket Implementation"
  capabilities_in_scope: [Coverage, LOS, Planning, AI Analyst, Reports, Revenue Prediction]
  deliverables:
    ├── Deployed Trafficure (creates Deployments)
    ├── Deployed SmartMarket (creates Deployments)
    ├── Custom Revenue Prediction Module (creates Components + Artifacts)
    ├── Samsung-specific data pipeline (creates Data Pipeline)
    ├── Customer Architecture Document (creates document)
    └── Training for 20 users (delivers training)
```

#### PROJECT (for custom software)

When the services business builds custom software (not deploying your products), the
work is a **Project** that produces **Deliverables**:

| Property       | Description                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| `name`         | "Samsung Fleet Management Dashboard"                                                                      |
| `customer`     | Samsung India                                                                                             |
| `engagement`   | The Engagement this project is part of                                                                    |
| `type`         | `custom-application`, `integration`, `data-product`, `report-suite`, `automation`                         |
| `deliverables` | Custom Components, APIs, Data Products, documents                                                         |
| `source_repo`  | Where the custom code lives                                                                               |
| `ip_ownership` | Who owns the IP: `customer`, `lepton`, `shared`, `open-source`                                            |
| `reusability`  | Can this be generalized into a product/capability? `yes-planned`, `yes-potential`, `no-customer-specific` |
| `lifecycle`    | `active-development`, `delivered`, `maintenance`, `abandoned`                                             |

**The IP and reusability question is critical.** When you build "Revenue Prediction"
for Samsung, that's a custom Project. But if you can generalize it into a standard
Capability, it crosses from the Services Business to the Product Business. This
transition is where significant value is created — turning one-time project revenue
into recurring product revenue.

---

## The Unified Connection Map

Here's how everything connects across all three business lines:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        THE COMMERCIAL LAYER                              │
│                                                                          │
│  PRODUCT BUSINESS        DATA BUSINESS         SERVICES BUSINESS         │
│  ┌─────────────┐        ┌──────────────┐       ┌──────────────────┐     │
│  │ Product     │        │ Data Product │       │ Service Offering │     │
│  │  └Capability│        │  └Dataset    │       │  └Engagement     │     │
│  │    └Plan    │        │    └Data Plan│       │    └Project      │     │
│  └──────┬──────┘        └──────┬───────┘       └────────┬─────────┘     │
│         │                      │                        │               │
│         └──────────┬───────────┴────────────────────────┘               │
│                    │                                                     │
│              CUSTOMER                                                    │
│              └ Subscriptions (product + data)                            │
│              └ Engagements (services)                                    │
│              └ Licenses (entitlements)                                   │
└────────────────────┬────────────────────────────────────────────────────┘
                     │
                     │ "what to deliver"
                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        THE ENGINEERING LAYER                             │
│                                                                          │
│  SOFTWARE CATALOG         DATA CATALOG           PROJECT CATALOG         │
│  ┌─────────────┐        ┌──────────────┐       ┌──────────────────┐     │
│  │ Domain      │        │ Data Domain  │       │ Project          │     │
│  │  └System    │        │  └Data       │       │  └Deliverable    │     │
│  │    └Comp.   │        │    Product   │       │    └Custom Comp. │     │
│  │      └API   │        │    └Pipeline │       │      └Custom API │     │
│  │      └Artif.│        │    └Dataset  │       │                  │     │
│  └──────┬──────┘        └──────┬───────┘       └────────┬─────────┘     │
│         │                      │                        │               │
│         └──────────┬───────────┴────────────────────────┘               │
│                    │                                                     │
│              SHARED PLATFORM                                             │
│              └ IAM (Ory + SpiceDB)                                       │
│              └ API Gateway (Traefik)                                      │
│              └ Observability (Grafana + OTel + ClickHouse)               │
│              └ CI/CD Pipelines                                           │
│              └ Templates & Golden Paths                                  │
└────────────────────┬────────────────────────────────────────────────────┘
                     │
                     │ "where to run it"
                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     THE INFRASTRUCTURE LAYER                             │
│                                                                          │
│  Substrates → Hosts → Workspaces → Runtimes → Network Entities          │
│       │                                              │                   │
│       └── Deployments ← (product + data + custom) ───┘                  │
│       └── Data Stores                                                    │
│       └── Managed Dependencies                                           │
│       └── Secrets                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## The Exact Connection Points

### Product ↔ System

| Concept               | In Product world                    | In Engineering world                                | Relationship                                                                      |
| --------------------- | ----------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------- |
| The big thing         | **Product** (Trafficure)            | **Domain** (Network Access)                         | 1:1 typically. A Product's engineering is organized under a Domain.               |
| The feature area      | **Capability** (Coverage Analysis)  | Spans **Components** across one or more **Systems** | Many-to-many. A Capability needs components from potentially multiple Systems.    |
| The team's scope      | Implicit                            | **System** (Trafficure Core Platform)               | A System is owned by one team and represents their deployable boundary.           |
| The buildable unit    | Implicit                            | **Component** (coverage-service)                    | A Component is what a developer works on. Products don't know about Components.   |
| The interface         | Implicit (customers see "Coverage") | **API** (coverage-api v2)                           | APIs are the contract surface. Product Capabilities are experienced through APIs. |
| The shippable unit    | Implicit                            | **Artifact** (coverage-service:2.4.0)               | Artifacts are what CI produces. Products don't know about Artifacts.              |
| The versioned release | Product version "Trafficure 2024.3" | **Release Bundle** (Trafficure Core 2.4.0)          | A product version corresponds to one or more Release Bundles.                     |

### Data Product ↔ Software System

| Concept             | In Data world                        | In Software world                            | Relationship                                                                                                |
| ------------------- | ------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| The data asset      | **Data Product** (Tower Registry)    | —                                            | Data Products are their own thing, not software Components                                                  |
| The data processing | **Data Pipeline** (tower-sync-daily) | **Component** (pipeline code is a Component) | The pipeline's CODE is a Component; what it PRODUCES is a Data Product                                      |
| The storage         | **Dataset** (logical)                | **Data Store** (physical)                    | A Dataset lives in a Data Store. The Dataset is the logical view; the Data Store is the infrastructure.     |
| The consumption     | Data Product consumed by Capability  | Component reads from Data Store              | Software Capabilities consume Data Products. At the infrastructure level, Components read from Data Stores. |

### Services ↔ Product ↔ Engineering

| Concept                 | In Services world        | In Product world                                      | In Engineering world                                                |
| ----------------------- | ------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------- |
| The work                | **Engagement**           | —                                                     | Creates/modifies Components, Deployments                            |
| The template            | **Service Offering**     | —                                                     | References Templates from the engineering platform                  |
| Custom functionality    | **Project Deliverable**  | May become a **Capability** (if generalized)          | Is a **Component** or set of Components with customer-specific code |
| Deployment for customer | Part of Engagement       | Customer's **Subscription** determines what to deploy | **Deployment** on customer's infrastructure                         |
| Data work               | Custom analytics project | May become a **Data Product** (if generalized)        | Creates **Data Pipelines** and populates **Data Stores**            |

### The Generalization Bridge

This is the most valuable connection in the entire model — where Services revenue
transforms into Product revenue:

```
SERVICES WORLD                              PRODUCT WORLD

Custom Project                              Standard Capability
"Revenue Prediction for Samsung"    →→→     "Revenue Prediction Module"
  │                                           │
  ├── Samsung-specific code         →→→     ├── Generalized code
  ├── Samsung data model            →→→     ├── Configurable data model
  ├── One-time project revenue      →→→     ├── Recurring subscription revenue
  ├── Components owned by project   →→→     ├── Components owned by product team
  └── IP: shared or Lepton-owned    →→→     └── IP: Lepton-owned

Custom Data Analysis                        Standard Data Product
"Market analysis for Ultratech"     →→→     "Market Demographics Dataset"
  │                                           │
  ├── Customer-specific analysis    →→→     ├── Generalized dataset
  ├── One-time consulting revenue   →→→     ├── Recurring data subscription revenue
  └── IP: shared                    →→→     └── IP: Lepton-owned
```

Tracking this generalization pathway explicitly — flagging which Projects have
reusability potential, which custom Components could become standard Capabilities,
which one-off analyses could become Data Products — is where strategic value is created.

---

## The Shared Platform

All three business lines share a common engineering platform. This platform IS a Product
in its own right (an internal product), with its own Systems, Components, and Capabilities.

```
SHARED PLATFORM (internal product)
│
├── SYSTEM: "Identity & Access Management"
│     Components: ory-kratos, ory-hydra, spicedb, iam-runtime
│     Capabilities provided: Authentication, Authorization, SSO, Seat Management
│     Consumed by: ALL products, ALL services, ALL data deliveries
│
├── SYSTEM: "API Gateway"
│     Components: traefik, rate-limiter, api-key-manager
│     Capabilities provided: Traffic routing, Rate limiting, API authentication
│     Consumed by: ALL products
│
├── SYSTEM: "Observability"
│     Components: grafana, loki, tempo, otel-collectors, clickhouse
│     Capabilities provided: Metrics, Logs, Traces, Alerting, Dashboards
│     Consumed by: ALL products, ALL infrastructure
│
├── SYSTEM: "CI/CD Platform"
│     Components: github-actions-runners, artifact-registry, deployment-pipelines
│     Capabilities provided: Build, Test, Deploy automation
│     Consumed by: ALL engineering teams
│
├── SYSTEM: "Developer Platform"
│     Components: workspace-manager, template-registry, developer-portal
│     Capabilities provided: Dev environments, Scaffolding, Service catalog
│     Consumed by: ALL engineering teams
│
├── SYSTEM: "Billing & Entitlement"
│     Components: entitlement-service, usage-metering, license-token-service
│     Capabilities provided: Entitlement checks, Usage metering, License generation
│     Consumed by: ALL products
│
└── SYSTEM: "Data Platform"
      Components: data-pipeline-orchestrator, data-quality-checker, data-catalog
      Capabilities provided: Pipeline orchestration, Quality monitoring, Data discovery
      Consumed by: ALL data products, ALL data pipelines
```

The Shared Platform is the leverage multiplier. Every hour invested in the platform
saves time across all three business lines. Every new product, every new customer,
every new engagement benefits from the platform.

---

## The Complete Entity Inventory

### Commercial Layer (13 entities)

**Product Business:**

- Product, Capability, Plan, Line Item, Billable Metric
- Coupon, Subscription, Subscription Item, Wallet

**Data Business:**

- Data Product (commercial identity of a data asset)
- Data Plan (how data access is priced — can use same Plan entity with type: data)

**Services Business:**

- Service Offering (template for engagements)
- Engagement (specific customer commitment)
- Project (custom development work within an engagement)

**Shared:**

- Customer, Invoice

### Engineering Layer (15 entities)

**Software Catalog:**

- Domain, System, Component, API, Artifact, Release Bundle, Template

**Data Catalog:**

- Data Product (engineering identity — schema, quality, freshness)
- Data Pipeline
- Dataset (logical — the named collection of data)

**Project Catalog:**

- Project Deliverable (custom components, integrations, or data products)

**Shared Platform:**

- All the Systems listed above are themselves in the Software Catalog

### Infrastructure Layer (11 entities)

- Substrate, Host, Workspace, Runtime, Network Entity
- Deployment, Workload, Managed Dependency, Data Store, Secret
- Hardware Asset (for physical infrastructure)

### Organizational Layer (2+ entities)

- Team, Person
- (Skill, Capacity, Allocation — for resource management, if needed)

### Cross-Cutting (not entities, but concerns on all entities)

- Change Log (temporal history)
- Cost Attribution (financial tracking)
- Compliance Profile (regulatory constraints)
- Ownership (every entity has an owner)

### Total: ~40 entities across the full company model

But the daily working set for most people is much smaller:

| Role                  | Entities they interact with daily                              |
| --------------------- | -------------------------------------------------------------- |
| **Developer**         | Component, API, Artifact, Deployment, Workspace                |
| **Product Manager**   | Product, Capability, Plan, Customer, Roadmap                   |
| **Data Engineer**     | Data Product, Data Pipeline, Dataset, Data Store               |
| **SRE/Ops**           | Deployment, Host, Runtime, Network Entity, Incident            |
| **Delivery/PM**       | Engagement, Customer, Capability, Deployment, Service Offering |
| **Sales**             | Product, Capability, Plan, Customer, Service Offering          |
| **Platform Engineer** | System, Component, Template, Runtime, Workspace                |

---

## The One Diagram

If you had to explain the entire company model on a whiteboard in 5 minutes:

```
                    CUSTOMER
                   /    |    \
                  /     |     \
            buys    contracts   accesses
           product   services    data
              |         |         |
         SUBSCRIPTION ENGAGEMENT DATA SUB
              |         |         |
              |    ┌────┘         |
              |    |              |
        ┌─────┴────┴──────────────┴─────┐
        │        CAPABILITY              │
        │   (the bridge between          │
        │    commerce and code)          │
        └─────────────┬─────────────────┘
                      |
              realized by
                      |
        ┌─────────────┴─────────────────┐
        │          COMPONENT             │
        │    (the unit of software       │
        │     a developer builds)        │
        └─────────────┬─────────────────┘
                      |
             deployed as
                      |
        ┌─────────────┴─────────────────┐
        │         DEPLOYMENT             │
        │   (the unit of software        │
        │    that's actually running)    │
        └─────────────┬─────────────────┘
                      |
              runs on
                      |
        ┌─────────────┴─────────────────┐
        │       INFRASTRUCTURE           │
        │   (hosts, runtimes,            │
        │    networks, data stores)      │
        └───────────────────────────────┘
```

Four layers. Customer → Capability → Component → Deployment → Infrastructure.
Everything else in the model is detail within or between these layers.

**Capability is the keystone.** It's the single concept that:

- Sales talks about (what we sell)
- Product defines (what it does)
- Engineering builds (which components realize it)
- Operations deploys (which deployments deliver it)
- Customers use (what they're entitled to)
- Billing charges for (what they pay for)

When all six functions use the same word for the same thing, you have cross-department
harmony.
