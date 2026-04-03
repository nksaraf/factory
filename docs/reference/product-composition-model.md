# The Product Composition Model

## How commercial line items map to technical reality

### Addendum to the Commercial & Organizational Model

---

## The Problem

Your sales team sells things like:
- "Trafficure Coverage Module"
- "SmartMarket AI Data Analyst"
- "Revenue Prediction Module" (initially Samsung-specific)
- "Trafficure + SmartMarket Suite"

Your engineering team builds things like:
- `coverage-service` (Java backend)
- `coverage-ui` (React microfrontend)
- `rf-engine` (computation engine)
- `ai-data-analyst-service` (Python)
- `organization-data-management-service` (shared prereq)
- `core-shell` (frontend shell that hosts all UIs)

These two worlds don't map 1:1. The Coverage Module (commercial) requires
`coverage-service` + `coverage-ui` + `rf-engine` + `core-shell` + `planning-service`
(technical). The `core-shell` component serves every module. The
`organization-data-management-service` is a prerequisite for three different SmartMarket
modules but is never sold as a line item itself.

When Samsung buys "Trafficure Planning + Coverage + SmartMarket Reports + Revenue
Prediction," the engagement team needs to know exactly which technical components must be
deployed, which are shared infrastructure, and which are customer-specific.

This is the product composition problem, and every platform company faces it.

---

## How Other Companies Solve This

### Salesforce

Salesforce has three layers of commercial identity:

**Cloud** (≈ our Product): Sales Cloud, Service Cloud, Marketing Cloud. These are
the big things with separate pricing pages and sales teams.

**Edition** (≈ our Offering tier): Essentials, Professional, Enterprise, Unlimited.
Each edition includes a different set of features.

**Feature/Add-on** (≈ what we need): Einstein Analytics, CPQ, Field Service Lightning.
These can be purchased as add-ons to a Cloud + Edition combination. Some features are
included in higher editions, some are always separate purchases.

Technically, all of this runs on a single shared multitenant platform. A "feature" is
often just a permission/entitlement flag — no separate deployment at all. But some
add-ons (like Heroku, MuleSoft, Tableau) are entirely separate technical products with
their own infrastructure.

The key insight from Salesforce: **the commercial module is an entitlement, not a
deployment boundary.**

### SAP

SAP's modules (FI, CO, MM, SD, PP, HR) are the classic example of commercial line items
within a platform. They're sold individually, priced per-user, and appear on contracts.
But technically, they all run within a single SAP instance. "Installing the MM module"
means enabling configuration and schema objects within the shared deployment, not spinning
up a separate server.

An SAP implementation engagement scopes which modules are in scope, and the deployment
team configures the shared instance accordingly.

The key insight from SAP: **the module is a configuration scope within a shared
deployment, not a separate deployment.**

### Atlassian

Jira, Confluence, and Bitbucket are separate products with separate deployments. But
within Jira, you have Jira Software, Jira Service Management, and Jira Work Management
— these are commercial modules that share the same Jira deployment and database. Adding
"Jira Service Management" to a customer that already has "Jira Software" doesn't create
a new deployment — it enables features in the existing one.

But then there's the Atlassian Platform (Atlassian Account, Atlassian Guard) that
provides shared IAM across all products. This is infrastructure that no customer
directly buys but every product depends on.

The key insight from Atlassian: **some modules share a deployment, some are separate
deployments, and some are invisible infrastructure that no one buys.**

### Adobe Creative Cloud

Photoshop, Illustrator, Premiere, After Effects are distinct applications (separate
installs, separate processes). But they share Creative Cloud Libraries, Adobe Fonts,
Adobe Stock integration, and Adobe Sensei (AI). A customer buys a bundle (All Apps,
Photography Plan, Single App), and the bundle determines which applications they can
install.

The key insight from Adobe: **the commercial bundle determines entitlement; the
deployment topology is independent of the commercial packaging.**

---

## The Synthesis: Three New Concepts

After studying all of these, the model needs three additions to the commercial layer:

### 1. MODULE

### 2. BUNDLE

### 3. CAPABILITY MAP (the many-to-many bridge)

---

### MODULE

**Definition:** A commercially identifiable unit of functionality within a product. It has
a name customers recognize, it appears as a line item on contracts and invoices, it has
its own value proposition, and it can be sold individually or as part of a bundle. A
module is NOT a technical component — it's a commercial identity that is realized by one
or more technical components.

**Developer's intuition:** "The feature area the customer bought."

**The spectrum of module ↔ technology mapping:**

| Mapping type | Description | Example |
|---|---|---|
| **Entitlement-only** | No separate components. The module is a feature flag on shared infrastructure. Enabling the module means flipping a config/entitlement. | "Advanced Analytics" = a feature flag on the existing reports service |
| **Configuration scope** | Shared deployment, but the module activates specific schemas, UI routes, or processing pipelines within it. | SAP-style: "Coverage Module" enables coverage-related tables and API endpoints in the shared Trafficure instance |
| **Additive components** | The module requires additional technical components deployed alongside the shared platform. | "AI Data Analyst" requires deploying the `ai-data-analyst-service` alongside the existing SmartMarket stack |
| **Independent deployment** | The module is technically a separate product with its own deployment. Commercially bundled but technically independent. | "SmartMarket" alongside "Trafficure" — different codebases, different deployments, shared IAM |
| **Customer-specific** | The module exists only for one customer (or started that way). May eventually be generalized into a standard module. | "Revenue Prediction Module" — built for Samsung, may become standard |

**Key properties:**

| Property | Description |
|---|---|
| `name` | Commercial name: "Coverage Analysis", "AI Data Analyst", "Revenue Prediction" |
| `product` | Which product this belongs to: Trafficure, SmartMarket |
| `type` | `core` (included in all editions), `standard` (included in some editions), `add-on` (always separate purchase), `custom` (customer-specific), `internal` (not sold, but exists as a dependency) |
| `description` | Customer-facing description of what this module does |
| `mapping_type` | `entitlement-only`, `configuration-scope`, `additive-components`, `independent-deployment`, `customer-specific` |
| `realized_by` | Links to the Capability Map (see below) |
| `depends_on_modules` | Other modules this requires: "AI Data Analyst depends on Dataset Management" |
| `available_in_editions` | Which editions include this module: `enterprise`, `professional` |
| `available_as_addon` | Can be purchased separately? If so, at what price |
| `lifecycle` | `incubation`, `beta`, `ga` (generally available), `deprecated` |
| `customer_scope` | `all-customers`, `edition-gated`, `specific-customers` (for custom modules) |
| `owner_team` | Product team responsible |

**Lepton's module catalog:**

```
PRODUCT: Trafficure (Network Access Suite)
├── MODULE: "Coverage Analysis" (core)
│     mapping: additive-components
│     realized_by: [coverage-service, coverage-ui, rf-engine]
│
├── MODULE: "Line of Sight Analysis" (core)
│     mapping: additive-components
│     realized_by: [los-service, los-ui, los-engine]
│
├── MODULE: "Network Planning" (core)
│     mapping: additive-components
│     realized_by: [planning-service, planning-ui]
│
├── MODULE: "Project Management" (standard)
│     mapping: additive-components
│     realized_by: [project-service, project-hub-ui]
│
├── MODULE: "Microwave Planning" (add-on)
│     mapping: additive-components
│     realized_by: [microwave-engine, planning-service (shared)]
│     depends_on: ["Network Planning"]
│
└── MODULE: "RF Analysis Kit" (add-on, enterprise only)
      mapping: additive-components
      realized_by: [rf-engine, rf-kit-ui]

PRODUCT: SmartMarket
├── MODULE: "Dataset Management" (internal — prerequisite, not sold directly)
│     mapping: additive-components
│     realized_by: [organization-data-management-service]
│     type: internal
│
├── MODULE: "Map Exploration" (core)
│     mapping: additive-components
│     realized_by: [smartmarket-map-service, smartmarket-ui]
│     depends_on: ["Dataset Management"]
│
├── MODULE: "AI Data Analyst" (standard)
│     mapping: additive-components
│     realized_by: [ai-data-analyst-service, ai-data-analyst-ui]
│     depends_on: ["Dataset Management"]
│
├── MODULE: "Reports & Analytics" (standard)
│     mapping: additive-components
│     realized_by: [reports-service, reports-ui]
│     depends_on: ["Dataset Management"]
│
└── MODULE: "Revenue Prediction" (custom — Samsung initially)
      mapping: customer-specific
      realized_by: [revenue-prediction-service, revenue-prediction-ui]
      depends_on: ["Dataset Management", "Reports & Analytics"]
      customer_scope: specific-customers (Samsung India)
      lifecycle: incubation → will become standard once proven

SHARED PLATFORM (not a product — invisible infrastructure)
├── MODULE: "Identity & Access Management" (internal)
│     mapping: independent-deployment
│     realized_by: [ory-kratos, ory-hydra, spicedb, iam-runtime]
│     serves: [Trafficure, SmartMarket]
│
├── MODULE: "API Gateway" (internal)
│     mapping: independent-deployment
│     realized_by: [traefik-gateway]
│     serves: [Trafficure, SmartMarket]
│
└── MODULE: "Observability" (internal)
      mapping: independent-deployment
      realized_by: [grafana, loki, tempo, otel-collectors, clickhouse]
      serves: [Trafficure, SmartMarket]
```

---

### BUNDLE

**Definition:** A commercial packaging of products and/or modules sold together. Bundles
exist purely in the commercial layer — they have a name, a price, and a list of what's
included. They don't create any new technical entities.

**Developer's intuition:** "The package deal."

**Why it's needed:** When a customer buys "Lepton Intelligence Suite" (Trafficure +
SmartMarket together), or "Trafficure Enterprise with SmartMarket Reports add-on," the
engagement needs to reference what was purchased as a unit. The bundle is that unit.

**Key properties:**

| Property | Description |
|---|---|
| `name` | "Lepton Intelligence Suite", "Trafficure Enterprise + SmartMarket Reports" |
| `type` | `suite` (multiple products), `package` (product + add-ons), `plan` (edition-level bundle) |
| `includes_products` | Which products |
| `includes_modules` | Which specific modules (overrides edition defaults if needed) |
| `edition_level` | Default edition for included products: enterprise, professional |
| `pricing` | Bundle pricing (usually discounted vs individual) |
| `available_addons` | Modules that can be added to this bundle |
| `lifecycle` | `active`, `deprecated`, `promotional` (time-limited) |

**Example bundles:**

```
BUNDLE: "Trafficure Professional"
  type: plan
  includes_products: [Trafficure]
  includes_modules: [Coverage Analysis, LOS Analysis, Network Planning]
  edition: professional
  addons_available: [Project Management, Microwave Planning, RF Analysis Kit]

BUNDLE: "Trafficure Enterprise"
  type: plan
  includes_products: [Trafficure]
  includes_modules: [Coverage, LOS, Network Planning, Project Management, RF Analysis Kit]
  edition: enterprise
  addons_available: [Microwave Planning]

BUNDLE: "Lepton Intelligence Suite"
  type: suite
  includes_products: [Trafficure, SmartMarket]
  includes_modules: [all Trafficure core + standard, all SmartMarket core + standard]
  edition: enterprise
  addons_available: [Microwave Planning, Revenue Prediction]

BUNDLE: "SmartMarket Starter"
  type: plan
  includes_products: [SmartMarket]
  includes_modules: [Dataset Management (implicit), Map Exploration]
  edition: starter
  addons_available: [AI Data Analyst, Reports & Analytics]
```

---

### CAPABILITY MAP

**Definition:** The many-to-many bridge between commercial modules and technical
components. A capability map entry says: "Module X requires Component Y in role Z."

**Developer's intuition:** "What do I actually need to deploy to enable this module?"

**Why it's its own concept:** Because the relationship is not a simple list. A component
might be required by multiple modules (rf-engine serves both Coverage and RF Kit). A
module might need a component in different configurations depending on the deployment
(Coverage might need rf-engine with GPU in enterprise mode but CPU-only in professional
mode). And some components are always deployed regardless of which modules are enabled
(core-shell, API gateway, IAM).

**Capability map structure:**

```
CAPABILITY_MAP_ENTRY:
  module: MODULE reference
  component: COMPONENT reference (from V3 technical catalog)
  role: how this component serves this module
  requirement_type: how this component is needed
  configuration_notes: module-specific config for this component
```

**Requirement types:**

| Type | Meaning | Deployment implication |
|---|---|---|
| `required-exclusive` | This component exists solely for this module | Deploy when module is enabled, remove when disabled |
| `required-shared` | This component is needed by this module but also serves others | Deploy once, configure for all consuming modules |
| `required-platform` | This is platform infrastructure needed by all modules | Always deployed regardless of module selection |
| `optional-enhancement` | This component enhances this module but isn't strictly needed | Deploy if resources allow or if customer has the edition |
| `configuration-only` | No separate deployment — enabling the module means configuring this existing component differently | Apply config change to existing deployment |

**Lepton's capability map (partial):**

```
Module: "Coverage Analysis"
├── coverage-service       (required-exclusive)
├── coverage-ui            (required-exclusive)
├── rf-engine              (required-shared — also used by RF Kit, LOS)
├── core-shell             (required-platform — hosts all frontend modules)
├── planning-service       (required-shared — Coverage uses planning APIs)
├── traefik-gateway        (required-platform)
├── ory-kratos             (required-platform)
└── postgres               (required-platform — shared database)

Module: "AI Data Analyst"
├── ai-data-analyst-service       (required-exclusive)
├── ai-data-analyst-ui            (required-exclusive)
├── organization-data-mgmt-svc    (required-shared — prereq)
├── core-shell                    (required-platform)
├── traefik-gateway               (required-platform)
├── ory-kratos                    (required-platform)
└── postgres                      (required-platform)
    configuration_notes: "Requires ai_analyst schema in shared database"

Module: "Revenue Prediction" (Samsung custom)
├── revenue-prediction-service    (required-exclusive, customer-specific build)
├── revenue-prediction-ui         (required-exclusive, customer-specific build)
├── organization-data-mgmt-svc    (required-shared)
├── reports-service               (required-shared — Revenue Prediction extends Reports)
├── core-shell                    (required-platform)
└── gpu-host                      (optional-enhancement — faster model training)
    configuration_notes: "Samsung-specific model weights, Samsung data pipeline config"
```

---

## How This Changes the Engagement Model

When a customer buys a bundle or set of modules, the engagement now has a precise
technical specification:

### Step 1: Commercial Scoping

```
Customer: Samsung India
Bundle purchased: "Lepton Intelligence Suite" (enterprise)
Additional modules:
  - Revenue Prediction (custom add-on)
Offering: Enterprise Managed (in their AWS)
```

### Step 2: Module Resolution

Starting from the commercial selection, resolve the complete module list including
dependencies:

```
Explicit modules:
  Trafficure: Coverage, LOS, Network Planning, Project Management, RF Kit
  SmartMarket: Map Exploration, AI Data Analyst, Reports & Analytics
  Custom: Revenue Prediction

Implicit modules (dependencies, resolved automatically):
  SmartMarket: Dataset Management (required by AI Analyst, Reports, Revenue Prediction)
  Platform: IAM, API Gateway, Observability (required by everything)
```

### Step 3: Component Resolution (via Capability Map)

For each module, look up the capability map and collect all required components:

```
Required-exclusive components (deployed specifically for Samsung):
  coverage-service, coverage-ui
  los-service, los-ui, los-engine
  planning-service, planning-ui
  project-service, project-hub-ui
  rf-engine, rf-kit-ui
  smartmarket-map-service, smartmarket-ui
  ai-data-analyst-service, ai-data-analyst-ui
  reports-service, reports-ui
  organization-data-management-service
  revenue-prediction-service (custom)
  revenue-prediction-ui (custom)

Required-platform components (always deployed):
  core-shell (frontend host)
  traefik-gateway (API gateway)
  ory-kratos, ory-hydra, spicedb (IAM)
  postgres (shared database)
  grafana, loki, tempo, otel-collectors (observability)
```

### Step 4: Deployment Planning

The engagement manager now knows the complete technical scope. The deployment plan
becomes specific:

```
Engagement: "Samsung Trafficure + SmartMarket Implementation" (ENG-031)
  Customer: Samsung India
  Bundle: Lepton Intelligence Suite + Revenue Prediction add-on
  Offering: Enterprise Managed (their AWS, ap-south-1)

  Infrastructure needed:
    Substrate: Samsung AWS ap-south-1 (EKS cluster)
    Hosts: 3 EKS worker nodes (standard) + 1 GPU node (for Revenue Prediction)
    Runtime: k8s namespace "lepton-samsung-prod"

  Deployments to create (one per component):
    26 component deployments (from Step 3)
    Each with: Helm chart, image version, config overlay for Samsung

  Config overlays needed:
    Samsung-specific: SSO integration, data residency, branding
    Module-specific: Revenue Prediction model weights, Samsung data pipeline

  Estimated timeline: 8 weeks
    Week 1-2: Infrastructure provisioning, IAM setup
    Week 3-4: Core platform + Trafficure modules
    Week 5-6: SmartMarket modules + data migration
    Week 7: Revenue Prediction module + Samsung-specific config
    Week 8: UAT + hypercare transition
```

---

## The Updated Entity Hierarchy

```
ACCOUNT
  └── CUSTOMER(s)
        └── purchases → BUNDLE(s) and/or individual MODULE(s)
        │     │
        │     ├── BUNDLE contains → PRODUCT(s) at EDITION level + MODULE(s)
        │     │
        │     └── MODULE
        │           ├── belongs to → PRODUCT
        │           ├── depends on → other MODULE(s)
        │           ├── mapped to → COMPONENT(s) via CAPABILITY MAP
        │           │     └── COMPONENT (V3 technical catalog)
        │           │           └── packaged as → ARTIFACT
        │           │           └── deployed as → DEPLOYMENT
        │           │
        │           └── has mapping type:
        │                 entitlement-only (feature flag)
        │                 configuration-scope (shared deployment, different config)
        │                 additive-components (additional deployments)
        │                 independent-deployment (separate product technically)
        │                 customer-specific (custom built)
        │
        └── through → ENGAGEMENT(s)
              └── scoped to → MODULE(s) purchased
              └── resolved via → CAPABILITY MAP to COMPONENT(s)
              └── creates → DEPLOYMENT(s) for resolved components
```

---

## The Module Lifecycle: From Custom to Standard

This is directly relevant to your Samsung Revenue Prediction module strategy.

```
Stage 1: CUSTOMER-SPECIFIC MODULE
  module.type = custom
  module.customer_scope = specific-customers [Samsung]
  module.lifecycle = incubation
  
  Components have Samsung-specific code, Samsung-specific data models,
  hardcoded assumptions about Samsung's business.
  
  Engagement: "Samsung Revenue Prediction Development" (custom-development)

Stage 2: GENERALIZATION (internal initiative)
  module.type = custom → standard (transition in progress)
  module.lifecycle = incubation → beta
  
  Components are refactored:
    - Samsung-specific logic extracted into configuration
    - Data models generalized to support multiple customers
    - API contract stabilized
    - Documentation written
  
  Initiative: "Generalize Revenue Prediction Module"
  
  Samsung continues using it. New customers can opt into beta.

Stage 3: GENERALLY AVAILABLE MODULE
  module.type = standard
  module.customer_scope = edition-gated (enterprise only) or all-customers
  module.lifecycle = ga
  module.available_in_editions = [enterprise]
  module.available_as_addon = true, separate pricing
  
  Components are fully generic. Customer-specific behavior driven by configuration.
  Samsung's original custom engagement transitions to standard support.
  
  New customers can purchase this module. Sales team has a new line item.

Stage 4: CORE MODULE (optional)
  module.type = standard → core
  module.available_in_editions = [professional, enterprise] (included in more editions)
  
  The module has proven so valuable that it's included in lower tiers
  to increase product competitiveness.
```

This lifecycle happens with every customer-specific module. Tracking which stage each
module is at helps product, sales, and engineering stay aligned on what's sellable, what's
stable, and what's still bespoke.

---

## Cross-Product Engagements

Your question about engagements spanning multiple products is solved by the module model:

**An engagement doesn't reference products — it references modules.**

```
ENGAGEMENT: "Samsung Full Platform Implementation"
  customer: Samsung India
  modules_in_scope:
    From Trafficure:
      - Coverage Analysis
      - LOS Analysis
      - Network Planning
      - Project Management
      - RF Analysis Kit
    From SmartMarket:
      - Map Exploration
      - AI Data Analyst
      - Reports & Analytics
    Custom:
      - Revenue Prediction
  
  This engagement spans two products (Trafficure + SmartMarket) plus a custom
  module, but that's fine — the module list is the source of truth for scope.
```

A cross-product engagement might be handled by multiple teams:

```
ENGAGEMENT: "Samsung Full Platform Implementation"
  workstreams:
    - "Trafficure Deployment" → owner: Trafficure Core Team
        modules: [Coverage, LOS, Planning, Project, RF Kit]
    - "SmartMarket Deployment" → owner: SmartMarket Team
        modules: [Map Exploration, AI Analyst, Reports]
    - "Revenue Prediction Development" → owner: SmartMarket Team + Data Science
        modules: [Revenue Prediction]
    - "Platform Setup" → owner: Platform Team
        modules: [IAM, API Gateway, Observability]
  
  engagement_manager: (one person owns the whole engagement commercially)
  technical_leads: (one per workstream)
```

---

## The Deployment Composition View

After module resolution and component resolution, the deployment for a customer looks
like a composition of layers:

```
Samsung India Production Deployment
│
├── PLATFORM LAYER (deployed for every customer, every module)
│   ├── ory-kratos (IAM)
│   ├── ory-hydra (OAuth)
│   ├── spicedb (authorization)
│   ├── traefik-gateway (API gateway)
│   ├── postgres (shared database)
│   └── otel-collector (observability sidecar)
│
├── TRAFFICURE LAYER (Coverage + LOS + Planning + Project + RF)
│   ├── core-shell (frontend host — serves all Trafficure + SmartMarket UIs)
│   ├── coverage-service + coverage-ui
│   ├── los-service + los-ui + los-engine
│   ├── planning-service + planning-ui
│   ├── project-service + project-hub-ui
│   └── rf-engine + rf-kit-ui
│
├── SMARTMARKET LAYER (Map + AI Analyst + Reports)
│   ├── organization-data-management-service (shared prereq)
│   ├── smartmarket-map-service + smartmarket-ui
│   ├── ai-data-analyst-service + ai-data-analyst-ui
│   └── reports-service + reports-ui
│
├── CUSTOM LAYER (Samsung-specific)
│   └── revenue-prediction-service + revenue-prediction-ui
│       (custom build, Samsung-specific model weights)
│
└── INFRASTRUCTURE
    ├── EKS cluster in Samsung AWS ap-south-1
    ├── 3x standard worker nodes + 1x GPU node
    ├── RDS Postgres (managed dependency)
    ├── S3 bucket for terrain/tile data
    └── VPN tunnel for Lepton management access
```

Each layer maps to a set of modules, each module maps to components via the capability
map, and each component maps to a deployment. The layers aren't a technical concept —
they're a visual organizing principle that makes it easy for engagement managers to
understand what's deployed for a customer.

---

## Updated Entity Count

**Commercial Layer: 8 entities** (was 6)
- Product, Module (new), Bundle (new), Offering, Customer, Engagement, Initiative, Account

**Technical Bridge: 1 entity** (new)
- Capability Map (the many-to-many join between Module and Component)

**Technical Layer: 13 entities** (unchanged from V3)
- Domain, System, Component, API, Artifact, Release Bundle, Template
- Substrate, Host, Workspace, Runtime, Network Entity
- Deployment, Workload, Managed Dependency, Data Store, Secret

**Organizational Layer: 2 entities** (unchanged)
- Team, Person

**Total: 24 entities**

---

## What This Enables

**For sales:** "Which modules does Samsung have? What can we upsell?" → Query modules
purchased, check which available add-ons they don't have yet.

**For engagement planning:** "Samsung wants to add AI Data Analyst. What's the work?" →
Resolve capability map → Dataset Management is already deployed (prereq met) → only
need to deploy ai-data-analyst-service + ai-data-analyst-ui → scope is 2-3 weeks, not
8 weeks.

**For engineering:** "Which component changes affect which customers?" → A change to
rf-engine affects every customer with Coverage, LOS, or RF Kit modules enabled. Query
the capability map to find the blast radius.

**For product:** "Revenue Prediction is ready to generalize. Which customers might want
it?" → It's currently customer-specific for Samsung. Transition to standard module,
check which customers have SmartMarket Enterprise (prerequisite edition), pitch to them.

**For AI agents:** "Deploy the latest SmartMarket release to all customers who have the
AI Analyst module" → Resolve which customers have that module → for each, find the
deployment for ai-data-analyst-service → check the offering's update_channel and the
engagement's change_process → execute or queue approval requests as appropriate.
