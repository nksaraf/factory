# Platform Fabric — Product Requirements Document

**Document Owner:** Nikhil
**Version:** 0.1 (Draft)
**Last Updated:** March 2026
**Status:** RFC — Request for Comments

---

## 1. Executive Summary

Platform Fabric is the internal operating architecture that governs how the company builds, deploys, operates, and commercializes all of its software products. It is not a single application — it is the foundational system that every product (Trafficure, NetworkAccess, SmartMarket, and future offerings) runs on top of.

Platform Fabric is divided into two cooperating halves:

- **Factory** — the company-wide system that designs, builds, and operates all products and their deployments. Runs once, centrally.
- **Site** — a running instance of a product in a specific customer environment. Runs once per customer/region/environment. Self-governing at runtime.

The Factory produces and manages Sites. Each Site governs itself.

---

## 2. Problem Statement

The company is building multiple enterprise SaaS products targeting regulated industries including telecom, transportation, and government. These products must support diverse deployment models — shared multi-tenant SaaS, dedicated single-tenant, on-premise, air-gapped, and sovereign deployments.

Without a unified platform architecture:

- Each product team reinvents infrastructure, CI/CD, tenant management, billing, and operational tooling independently.
- Deployment to regulated or air-gapped environments requires ad-hoc engineering per customer.
- There is no consistent way to manage entitlements, licensing, or commercial relationships across products.
- Engineering standards, build pipelines, and operational practices diverge across teams, making it harder to move engineers between products and harder to maintain quality.
- Scaling from a handful of customers to hundreds becomes an engineering bottleneck rather than an operational routine.

Platform Fabric solves this by establishing a single, product-agnostic architecture that all products deploy through and all sites run on.

---

## 3. Goals and Non-Goals

### Goals

- Define a company-wide architectural standard that all current and future products conform to.
- Enable any product to be deployed as shared multi-tenant SaaS, dedicated single-tenant, on-premise, air-gapped, or sovereign — using the same architecture.
- Provide a unified commercial layer (billing, entitlements, partners, trials) that works across all products.
- Ensure each Site is self-governing at runtime — capable of operating independently of the Factory, including in disconnected or air-gapped environments.
- Establish shared, product-agnostic Factory planes so that engineering practices, build infrastructure, and operational tooling are consistent across the company.
- Support phased implementation — the architecture must be adoptable incrementally, not as a big-bang rewrite.

### Non-Goals

- Platform Fabric is not a product sold to customers. It is internal infrastructure.
- Platform Fabric does not prescribe the internal implementation of any specific product's business logic or data models.
- Platform Fabric does not replace product-specific UX, landing pages, or marketing sites.
- Building all phases simultaneously. The architecture is designed for incremental delivery.

---

## 4. Architecture Overview

### 4.1 The Two Halves

```
Platform Fabric

┌──────────────────────────────────────────────────┐
│              Infrastructure Plane                 │
│           (spans Factory and all Sites)           │
└──────────┬────────────────────────┬──────────────┘
           │                        │
┌──────────┴────────────┐    ┌─────┴────────────┐
│       Factory         │    │     Site N        │
│   (company-wide)      │    │  (per deployment) │
│                       │    │                   │
│  • Product Plane      │    │  • Control Plane  │
│  • Build Plane        │    │  • Service Plane  │
│  • Agent Plane        │    │  • Data Plane     │
│  • Commerce Plane     │    │                   │
│  • Fleet Plane        │    │                   │
└───────────────────────┘    └───────────────────┘
```

### 4.2 Key Principle — Product Agnosticism

All Factory planes are product-agnostic. They define how the company builds software, not what any specific product does. Products are a dimension of data flowing through the Factory, not separate instances of it.

An engineer moving from Trafficure to NetworkAccess should find the same build pipelines, the same infrastructure patterns, the same fleet operations tooling, and the same commercial systems. Only the domain knowledge changes.

Product-specific logic lives exclusively inside the Site's Service Plane.

### 4.3 Key Principle — Site Autonomy

Each Site contains its own Control Plane, Service Plane, and Data Plane. A Site can operate independently of the Factory — this is a hard requirement for air-gapped, sovereign, and regulated deployments.

The Factory has authority over Site lifecycle (create, upgrade, rollback, decommission). The Site has authority over its own runtime (identity, policies, workloads, data).

### 4.4 Key Principle — Infrastructure Spans Both Halves

Infrastructure Plane is the only plane that exists in both the Factory and inside every Site. At Factory scope, it provisions and manages the substrate (clusters, networks, certificates). At Site scope, it operates the local runtime (gateway, service mesh, compute, storage). Both halves are the same plane, operating at different scopes.

### 4.5 Key Principle — Policy-Execution Pattern

A recurring pattern across the architecture: Control Plane declares policies. Other planes execute them. The policy is a declarative statement ("retain backups for 7 years," "rate limit to 100 req/min," "encrypt data at rest with AES-256"). The executing plane decides how to fulfill it. Control Plane never needs to know implementation details — it declares intent, other planes deliver it.

### 4.6 Service Naming Convention

All services across Platform Fabric follow a consistent naming convention:

```
{scope}-{plane}-{component}
```

Where scope is either `factory` or `site`, plane identifies which architectural plane the service belongs to, and component describes the specific service.

```
factory-product-api
factory-build-api
factory-agent-api
factory-commerce-api
factory-fleet-api
factory-infra-api

site-control-api
site-data-api
site-infra-api
site-service-api
```

This convention extends to non-API services:

```
factory-build-worker
factory-agent-orchestrator
factory-fleet-scheduler
site-control-auth
site-data-postgres
site-infra-gateway
site-service-analytics-module
```

An engineer browsing a repository list or service registry sees the architecture instantly. Factory services group together, Site services group together. The naming tells you where it runs and what it does.

---

## 5. Factory Planes

### 5.1 Product Plane

**Purpose:** Defines what the company builds and why.

**Scope:** Company-wide product management system. Owns the processes, templates, and standards for product planning — not the individual plans themselves.

**Responsibilities:**

**Product definition:**

- Product architecture and module definitions
- Service boundaries
- Feature specifications

**Roadmap management:**

- Product roadmaps across all offerings
- Initiatives and milestones
- Prioritization frameworks

**Work management:**

- Epics, stories, tasks, and backlog
- Cross-product dependency tracking
- Defect tracking

**Delivery planning:**

- Sprint planning
- Release trains and milestones
- Release version definitions, feature inclusion, release notes, and changelogs

**Architecture governance:**

- Architecture decision records (ADRs)
- Platform standards
- API conventions

**Developer experience:**

- Engineering guidelines and development standards
- Spec templates and review processes
- Internal documentation

**Engineering analytics:**

- Delivery metrics and velocity tracking
- Defect rates and quality trends
- Cross-team delivery visibility

**What it is not:** Product Plane does not own CI/CD, artifact creation, or build pipelines — those are Build Plane concerns. Product Plane defines intent (what, why, and when). Build Plane handles execution (how).

**Systems of Record:**

```
Work graph:
  initiative
  epic
  story
  task

Release definitions:
  release
  release_scope
  release_notes
  changelog
```

**Key services:** `factory-product-api`

---

### 5.2 Build Plane

**Purpose:** Defines how the company builds software.

**Scope:** Company-wide build infrastructure. One set of CI/CD standards, one artifact registry, one versioning scheme, one code quality gate — shared across all products.

**Responsibilities:**

**Source control:**

- Git repositories
- Branch management and commit history
- Code ownership (CODEOWNERS)

**Pull request system:**

- PR creation and code review workflows
- Merge policies and branch protection
- Review assignment and approval gates

**CI pipelines:**

- Build pipelines, integration pipelines, release pipelines
- Shared across all products
- Self-hosted runners (Proxmox infrastructure)

**Testing infrastructure:**

- Unit tests, integration tests, contract tests, performance tests
- Test reporting and quality gates

**Security checks:**

- Dependency scanning and vulnerability detection
- SBOM (Software Bill of Materials) generation
- License compliance checks

**Artifact production:**

- Container images
- Binaries and frontend bundles
- Worker service packages

**Artifact storage:**

- Container registries
- Artifact registries

**Versioning:**

- Semantic versioning
- Dependency graphs and compatibility metadata
- Release planning coordination with Product Plane

**Service Plane SDK:** Build Plane produces a shared SDK that every product's modules are built on top of. This SDK enforces consistent patterns across all products:

- How a module registers itself
- How it receives tenant context from Control Plane
- How it emits telemetry (OpenTelemetry)
- How it accesses Data Plane
- How it declares its API surface
- How health checks work

Product teams build their modules on this SDK. The SDK is the contract between Factory and Service Plane.

**Systems of Record:**

```
Code graph:
  repository
  branch
  commit
  pull_request

Artifact graph:
  artifact
  artifact_version
  build
  build_pipeline
```

**Key services:** `factory-build-api`, `factory-build-worker`

---

### 5.3 Agent Plane

**Purpose:** Manages AI and automation agents that operate across the platform. The system of record for automation state.

**Scope:** Company-wide automation infrastructure. Agents can operate in any plane — writing code (Build Plane), triaging work (Product Plane), deploying releases (Fleet Plane), monitoring infrastructure (Infrastructure Plane), or running QA (Build/Service Plane). Agent Plane provides the shared infrastructure for all of them.

**Stakeholders:**

- Engineering agents (code generation, code review, refactoring)
- QA agents (test generation, test execution, regression detection)
- Product agents (backlog grooming, spec drafting, analytics)
- Security agents (vulnerability scanning, compliance checking)
- Operations agents (incident response, capacity monitoring, alerting)

**Responsibilities:**

**Agent registry:**

- Agent definitions and types
- Capability declarations (what each agent can do)
- Version management for agent models and prompts

**Agent identity:**

- Agent authentication (agents are first-class identities, not user impersonation)
- Service identities and API tokens
- Permission scoping (which planes and APIs each agent can access)

**Task orchestration:**

- Agent task queues
- Execution scheduling and prioritization
- Multi-agent coordination (when tasks require handoffs between agents)

**Execution tracking:**

- Agent run history
- Execution logs and outcomes
- Cost tracking per agent execution

**Agent memory:**

- Contextual knowledge per agent
- Persistent reasoning state
- Embeddings and knowledge stores

**Tool registry:**

- Allowed APIs and tools per agent type
- Tool access policies and guardrails
- MCP server registry for agent tool access

**Performance analytics:**

- Agent performance metrics (quality, speed, reliability)
- Cost-effectiveness tracking
- Drift detection (agent output quality degradation over time)

**Why this is a separate plane:** Agents are a cross-cutting concern. They operate in every other plane but need their own identity system, execution tracking, memory, and governance. Without Agent Plane, each team builds ad-hoc automation with no consistent identity model, no audit trail, no cost tracking, and no way to manage agent permissions centrally. Agent Plane makes automation a first-class citizen of the architecture.

**Systems of Record:**

```
Agent registry:
  agent
  agent_type
  capabilities
  permissions

Execution history:
  agent_execution
  execution_log
  execution_result

Agent memory:
  agent_context
  knowledge_store
```

**Key services:** `factory-agent-api`, `factory-agent-orchestrator`, `factory-agent-memory`

---

### 5.4 Commerce Plane

**Purpose:** Manages the commercial relationship between the company and its customers and partners.

**Scope:** Company-wide commercial system. One billing engine, one entitlement engine, one customer record — shared across all products. A customer has one account with the company, not one per product.

**Responsibilities by phase:**

**Phase 1 — Launch:**

- Customer accounts
- Pricing plans and tiers (engine, not UI — product-specific pricing pages are owned by each product)
- Entitlements (which customer gets which modules, what usage limits apply)
- Billing and invoicing
- Subscription management
- Trial lifecycle (start, extend, convert, expire)

**Phase 2 — Scale:**

- Partner and MSP accounts
- Channel relationships and deal registration
- Usage metering and reporting
- Customer self-serve portal
- Dunning and payment failure handling
- Onboarding orchestration (automated trigger to Fleet Plane)
- Multi-currency support

**Phase 3 — Enterprise maturity:**

- CPQ (configure, price, quote)
- Contract management and custom SLAs
- Revenue recognition (ASC 606)
- Marketplace integrations (AWS, Azure)
- Partner tiers and programs
- White-labeling
- Customer health scoring and churn prediction
- Tax calculation across jurisdictions
- Expansion triggers and upsell automation
- Offboarding workflows and data retention policies
- Commercial audit trail
- Partner portal

**Entitlement engine:** The only piece of Commerce Plane that must be custom-built. It is the contract between the commercial model and Fleet operations. Everything else (billing, payments, invoicing) should leverage existing SaaS tooling (e.g., Stripe).

**Entitlement as state machine:** Every entitlement has explicit states (trial, active, suspended, expired, upgraded, downgraded) with defined entry conditions, exit conditions, and side effects. Commerce Plane manages the state machine. Fleet Plane subscribes to state transitions and acts accordingly.

**Multi-product account model:** A customer signs up once and gets one account. Products are added to the account as additional entitlements. Samsung buys Trafficure today, adds NetworkAccess next year — same account, same billing relationship, additional entitlement.

```
trafficure.com              networkaccess.com
│ "Start free trial"        │ "Start free trial"
│                           │
└───────────┬───────────────┘
            ▼
   Commerce Plane (shared)
   • Unified customer identity
   • Single billing dashboard
   • Entitlements across products
            │
            ▼ triggers
       Fleet Plane
       (provision site for the right product)
```

**Commerce-Fleet interaction:**

```
Commerce Plane                Fleet Plane              Site
│                             │                        │
│ Customer signs up           │                        │
│ Plan selected               │                        │
│ Entitlement created ─────►  │ Assign tenant ───────► │ Tenant active
│                             │ (shared site)          │
│ Customer upgrades           │                        │
│ Entitlement updated ─────►  │ Update modules ──────► │ New modules live
│                             │                        │
│ Payment fails               │                        │
│ Grace period ────────────►  │ No action              │ Runs normally
│ Restricted mode ─────────►  │ Restrict tenant ─────► │ Read-only
│ Suspended ───────────────►  │ Suspend tenant ──────► │ Site down, data preserved
│ Terminated ──────────────►  │ Decommission ────────► │ Data deleted per policy
```

**Partner and MSP model:**

```
Commerce Plane knows:

MSP: TechServ India
├── Customer: Samsung
│   ├── Entitlement: Trafficure Pro
│   └── Tenant in: SaaS Site India
├── Customer: Indus Towers
│   ├── Entitlement: Trafficure Enterprise
│   └── Dedicated Site: Indus Site
└── Billing: TechServ pays company, TechServ bills their customers

Direct Customer: Abu Dhabi DOT
├── Entitlement: Trafficure Enterprise
├── Dedicated Site: Abu Dhabi Site (air-gapped)
└── Billing: Direct
```

**Build vs. buy guidance:** Commerce is largely a solved problem. Build the entitlement engine (it is the core differentiator that bridges commercial model to fleet operations). Buy or integrate everything else — Stripe for billing/payments, CRM for customer/partner accounts.

**Systems of Record:**

```
Commerce graph:
  customer
  partner
  pricing_plan
  license
  entitlement
  subscription
  usage_record
  invoice
```

**Key services:** `factory-commerce-api`, `factory-commerce-entitlement-api`, `factory-commerce-billing-worker`

---

### 5.5 Fleet Plane

**Purpose:** Manages what runs where across all products and all Sites.

**Scope:** Company-wide deployment and lifecycle management. One set of deployment tooling, one upgrade protocol, one rollback procedure — the product is just a parameter, not a different workflow.

**Responsibilities:**

- Site lifecycle (create, upgrade, rollback, suspend, decommission)
- Product-to-Site mapping (knows that Site 14 is Trafficure, Site 7 is NetworkAccess)
- Module version management (which version of which module runs on which Site)
- Deployment orchestration (rolling updates, canary, blue-green)
- Tenant assignment for shared Sites (Commerce says "new customer," Fleet assigns them a tenant slot in an existing shared Site)
- Configuration distribution (pushing entitlement changes, policy updates to Sites)
- Fleet-wide health monitoring and alerting

**Product awareness:** Fleet Plane is the only Factory plane that is product-aware. It knows which product each Site belongs to and what modules are available for that product. All other Factory planes are product-agnostic. Fleet Plane treats the product as a dimension of its data model, not a separate workflow.

**Site types managed by Fleet:**

```
Fleet Plane
│
├── Shared Sites (multi-tenant)
│   ├── SaaS Site US (Trafficure tenants)
│   ├── SaaS Site EU (Trafficure tenants)
│   └── SaaS Site India (Trafficure tenants)
│
├── Dedicated Sites (single-tenant)
│   ├── Samsung Site
│   ├── Indus Towers Site
│   └── Abu Dhabi DOT Site (air-gapped)
│
└── Ephemeral Sites
    └── Demo/trial environments (short TTL)
```

**Shared vs. dedicated decision:** Fleet Plane consumes the entitlement from Commerce Plane to determine whether a customer gets a tenant in a shared Site or a dedicated Site. Most customers (trial, starter, pro, business tiers) get a shared Site tenant. Dedicated Sites exist for customers who need isolation — regulatory, air-gapped, sovereign, or contractual.

**Systems of Record:**

```
Fleet graph:
  site
  site_configuration
  tenant
  deployment
  rollout
  upgrade_plan
```

**Key services:** `factory-fleet-api`, `factory-fleet-scheduler`, `factory-fleet-deployer`

---

## 6. Infrastructure Plane

**Purpose:** Provides compute, storage, and network to every other plane. The substrate that everything runs on.

**Scope:** Spans both Factory and Site. The only plane that exists in both halves. At Factory scope, it provisions and manages global infrastructure. At Site scope, it operates the local runtime substrate.

### 6.1 Factory Infrastructure

Managed by the platform/infrastructure engineering team. Provisions and manages the substrate that all Sites run on.

**Responsibilities:**

**Cluster management:**

- Cluster provisioning (Kubernetes, bare metal)
- Cluster upgrades and patching
- Node pool management
- Multi-cloud and on-prem abstraction

**Global network:**

- VPCs, subnets, peering
- Cross-site connectivity mesh
- Factory-to-Site management channels
- Global DNS zones
- CDN (if applicable)
- Firewall rules and security groups

**PKI and certificate management:**

- Root and intermediate CAs
- Certificate issuance for Sites
- Rotation policies
- mTLS certificate distribution

**Shared services:**

- Container registry
- Secrets management infrastructure
- Artifact storage
- Image scanning and compliance

**Fleet infrastructure operations:**

- Capacity planning across Sites
- Cost monitoring and optimization
- Resource utilization tracking
- Infrastructure health monitoring

**Key services:** `factory-infra-api`, `factory-infra-cluster-manager`, `factory-infra-cert-manager`

### 6.2 Site Infrastructure

Operates the local runtime substrate within each Site. This is the floor that Control Plane, Service Plane, and Data Plane stand on.

**Responsibilities:**

**Ingress:**

- API Gateway (Traefik)
- TLS termination
- Load balancing
- Rate limiting execution (policies from Control Plane)
- DDoS protection

**Service mesh:**

- Service-to-service mTLS
- Internal routing and load balancing
- Circuit breakers and retries
- Service discovery
- Traffic splitting (canary, blue-green)

**Compute:**

- Kubernetes namespaces per plane
- Pod scheduling and autoscaling
- Resource quotas per plane
- Node management
- Runtime isolation

**Storage:**

- Block storage provisioning
- Object storage (S3-compatible)
- Volume management and storage classes
- Storage performance tiers

**Egress:**

- Outbound traffic policies
- Allowlists and denylists
- Egress gateway (for audited outbound)
- Zero egress mode (air-gapped deployments)

**Local secrets:**

- Secrets injection to pods
- Encryption keys (data-at-rest)
- Certificate distribution (from Factory CA)
- Secret rotation

**Key services:** `site-infra-api`, `site-infra-gateway`, `site-infra-mesh`

### 6.3 Infrastructure as Contract

Other planes never interact with infrastructure primitives directly. They consume Infrastructure Plane through contracts:

```
Control Plane says:    "Enforce auth policies at ingress"
Infrastructure does:    Configures gateway rules

Fleet Plane says:      "Deploy Service Plane v2.4 to Site 7"
Infrastructure does:    Pulls image, schedules pods, routes traffic

Data Plane says:       "I need 500GB persistent volume, SSD tier"
Infrastructure does:    Provisions PV, attaches to pod

Service Plane says:    "Module A needs to reach Module B"
Infrastructure does:    Service mesh routes and load balances
```

### 6.4 Cross-Boundary Communication

Factory Infrastructure and Site Infrastructure communicate, but the Site must function independently.

```
Factory Infrastructure            Site Infrastructure

Pushes:                           Operates independently:
• Cluster configs                 • Local service mesh
• Certificate updates             • Pod scheduling
• Network policy updates          • Storage provisioning
• Capacity adjustments            • Ingress routing

Receives (when connected):        Reports back:
• Health metrics                  • Resource utilization
• Capacity utilization            • Certificate expiry status
• Infrastructure alerts           • Infrastructure health
```

For air-gapped Sites, all pushes happen via physical media or one-way data diode. The Site operates fully autonomously with no dependency on real-time Factory connectivity.

### 6.5 Deployment Model Variations


| Model          | Factory Infra Role                  | Site Infra Operation            |
| -------------- | ----------------------------------- | ------------------------------- |
| SaaS shared    | Fully operates                      | Same team, same cluster         |
| SaaS dedicated | Provisions and monitors             | Same team, separate cluster     |
| Customer cloud | Specification and remote management | Customer team, Factory assists  |
| On-premise     | Specification and periodic updates  | Customer team operates          |
| Air-gapped     | Specification and physical media    | Customer team, fully autonomous |


---

## 7. Site Planes

### 7.1 Control Plane

**Purpose:** Governs the Site. The gatekeeper — every request passes through it, gets authenticated, tenant-resolved, policy-checked, and then handed to Service Plane. Control Plane is thin, critical, and rarely changes.

**Scope:** Per-Site authority on identity, tenancy, governance, and observability.

**Responsibilities:**

**Identity and authentication:**

- User authentication (SSO, OAuth, local credentials, LDAP, SCIM, AD)
- Service account management
- API Keys/Tokens
- Token issuance and validation

**Tenant resolution and context:**

- Resolve tenant from request (subdomain, header, token claim)
- Set tenant context on every request (e.g., `app.current_tenant` for RLS)
- Tenant context middleware is mandatory and untouchable — no request can bypass it

**Namespace management:**

- Tenant namespace isolation
- Namespace provisioning and decommissioning

**Policies and RBAC:**

- Role-based access control per tenant
- Policy definitions and enforcement
- Security policies

**Entitlements:**

- Consumed from Commerce Plane via Fleet Plane
- Module access per tenant
- Usage limits and quotas
- Feature gates (commercially driven)

**Audit logging:**

- Tenant-scoped audit trail
- All access and mutation events recorded
- Compliance-ready audit export

**Observability:**

- Metrics, logs, and traces collection (OpenTelemetry)
- Alerting engine
- Dashboards
- Export pipeline (ships telemetry back to Factory)
- Service Plane and Data Plane are producers of telemetry — they emit signals in OpenTelemetry format. Control Plane collects, stores, alerts, and exports.

**Policy declarations:**

- Backup retention policies (executed by Data Plane)
- Rate limiting policies (executed at Infrastructure Plane gateway)
- Encryption policies (executed by Data Plane)
- Resource quota policies (executed by Infrastructure Plane and Data Plane)

AB Testing

Notifications

**What Control Plane does not own:** Workflow orchestration. Business workflows (approval chains, order processing) belong in Service Plane. Infrastructure workflows (tenant provisioning, config rollouts) are Fleet Plane concerns.

**Systems of Record:**

```
Identity graph:
  user
  organization
  team
  service_account

Policy graph:
  role
  permission
  policy
  namespace

Audit:
  audit_event
  security_event
```

**Key services:** `site-control-api`, `site-control-auth`, `site-control-audit`

---

### 7.2 Tenant Configuration Model

Tenant-specific configuration follows three tiers with clear ownership:

**Tier 1 — Commerce-driven (Factory → Site):** What the tenant is entitled to. Modules, usage limits, plan tier, feature gates. Originates in Commerce Plane, flows through Fleet Plane, lands in Control Plane's entitlement store. Tenant cannot modify this.

**Tier 2 — Governance (Control Plane):** How the tenant operates within the Site. RBAC roles, security policies, audit settings, API rate limits, namespace configuration. Managed by the tenant's admin or by the platform operator.

**Tier 3 — Application (Service Plane):** Product-specific preferences. Webhook URLs, notification settings, UI preferences, integration credentials, workflow definitions. Managed by the tenant's users.

**Rule:** If the config affects what the tenant can do, it is Tier 1 (Commerce/Control). If it affects how the tenant is governed, it is Tier 2 (Control). If it affects how the product behaves for the tenant, it is Tier 3 (Service).

```
Commerce Plane ──► Fleet Plane ──► Control Plane (Tier 1: entitlements)
                                   Control Plane (Tier 2: governance)
                                   Service Plane (Tier 3: application prefs)
```

---

### 7.3 Service Plane

**Purpose:** Runs the product. All product-specific business logic lives here and nowhere else.

**Scope:** Per-Site execution of product modules, APIs, integrations, and business workflows.

**Responsibilities:**

**Product modules:**

- Built on the shared Service Plane SDK (produced by Build Plane)
- Module registration and lifecycle
- Module-specific configuration

**APIs:**

- External APIs (registered with Control Plane gateway via Infrastructure Plane ingress)
- Internal APIs (service-to-service via Infrastructure Plane mesh)
- API versioning

**Business logic:**

- All product-specific domain logic
- Business rules and calculations

**Analytics definitions:**

- Metric definitions (what to measure)
- Report templates (what to display)
- Pipeline definitions (what transformations to run)
- Data Plane owns the analytics infrastructure (engine, OLAP store). Service Plane owns what analytics matter for this product.

**Integrations and connectors:**

- Third-party service integrations
- Webhook management
- External data source connectors

**Background jobs and workers:**

- Scheduled tasks
- Async processing
- Queue consumers

**Event processing:**

- Domain event production and consumption
- Event-driven workflows

**Workflow orchestration:**

- Business process automation (approval chains, order processing, escalations)
- State machines for business entities

**Application configuration (Tier 3):**

- Tenant-specific product preferences
- Webhook URLs, notification settings
- Integration credentials (encrypted, stored via Infrastructure secrets)

**Key services:** `site-service-api`, `site-service-{module-name}`, `site-service-worker`

---

### 7.4 Data Plane

**Purpose:** Manages all state. Databases, object storage, caching, analytics infrastructure, search, and data pipelines.

**Scope:** Per-Site data storage, querying, and processing. Runs on storage and compute provided by Infrastructure Plane.

**Responsibilities:**

**Primary databases:**

- PostgreSQL with Row Level Security (RLS)
- Geospatial databases (PostGIS for location-aware products like Trafficure)
- Tenant isolation enforced at database level, not application level
- Composite indexes with `tenant_id` as leading column
- Statement timeouts per connection

**Row Level Security implementation:**

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON orders
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
```

The application sets tenant context on each connection (provided by Control Plane's tenant resolution). RLS ensures data isolation even if application code is buggy. This is defense in depth — the database itself refuses to return rows the current tenant should not see.

**Object storage:**

- S3-compatible object storage
- Tenant-scoped buckets or prefixes

**Caching layer:**

- Application-level caching (Redis or equivalent)
- Tenant-scoped cache keys

**Search and indexing:**

- Full-text search infrastructure
- Tenant-scoped indexes

**Analytics engine:**

- OLAP store and query engine
- Pipeline execution framework
- Materialized views
- Executes analytics definitions from Service Plane — Data Plane is the engine, Service Plane is the driver

**Data pipelines:**

- ETL and ELT workflows
- Data transformation and enrichment
- Cross-source data federation

**Backup and replication:**

- Executes backup policies declared by Control Plane
- Point-in-time recovery
- Cross-region replication (if required)
- Retention policy enforcement

**Resource quota enforcement:**

- Per-tenant storage quotas
- Query resource limits
- Connection pool limits per tenant

**Data governance:**

- Schema management and migration tracking
- Data retention policies (executed per Control Plane policy declarations)
- Data classification and sensitivity tagging
- Compliance metadata (data residency, GDPR, sector-specific regulations)

**Key services:** `site-data-api`, `site-data-postgres`, `site-data-analytics`, `site-data-cache`

---

### 7.5 Multi-Tenancy in Shared Sites

In shared Sites, all three Site planes are tenant-aware:

**Control Plane:** Resolves tenant identity on every request and sets context. Enforces tenant-scoped RBAC, policies, and entitlements. Produces tenant-scoped audit logs.

**Service Plane:** Receives requests with tenant context already established (via SDK middleware). Module code never needs to determine who the tenant is. Stores tenant-specific application configuration (Tier 3).

**Data Plane:** Enforces isolation at the storage layer via RLS. Even if Service Plane has a bug, Data Plane will not leak data across tenants. Per-tenant resource quotas prevent noisy-neighbor issues.

Three layers of defense, each with a clear isolation responsibility.

**Tenant isolation progression:**


| Scale                  | Strategy           | Where                                 |
| ---------------------- | ------------------ | ------------------------------------- |
| Early (most tenants)   | Row-level with RLS | Shared database, shared schema        |
| Large tenants          | Separate schema    | Same database, own tables and indexes |
| Enterprise / regulated | Dedicated Site     | Own database, own infrastructure      |


The system starts with row-level isolation for all tenants. When a specific tenant's usage creates performance issues, they graduate to schema-level isolation. When a customer requires full isolation (regulatory, contractual, air-gapped), they get a dedicated Site. This is a Fleet Plane lifecycle operation triggered by Commerce Plane, not an application-level decision.

---

## 8. Cross-Plane Flows

### 8.1 Engineering Workflow

A typical flow from product idea to running software:

```
Product Plane
  defines work (epic → stories → tasks)
        ↓
Agent Plane
  assigns automation (code agents, QA agents)
        ↓
Build Plane
  produces artifacts (CI → test → build → registry)
        ↓
Fleet Plane
  deploys releases (rollout → site assignment)
        ↓
Infrastructure Plane
  provisions substrate (compute, network, storage)
        ↓
Site
  runs software (Control → Service → Data)
```

### 8.2 Runtime Request Flow

A typical request through a shared Site:

```
External Request
       │
       ▼
┌─────────────────────────────────────────────────┐
│ Infrastructure Plane (Site)                      │
│                                                  │
│ API Gateway (Traefik)                            │
│ • TLS termination                                │
│ • Load balancing                                 │
│ • Routes to Control Plane                        │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ Control Plane                                    │
│                                                  │
│ • Authenticate request                           │
│ • Resolve tenant from token/header/subdomain     │
│ • Check entitlements (is tenant allowed?)         │
│ • Apply rate limiting policy                     │
│ • Set tenant context                             │
│ • Emit audit event                               │
│ • Route to Service Plane                         │
└──────────────────┬──────────────────────────────┘
                   │ (tenant context attached)
                   ▼
┌─────────────────────────────────────────────────┐
│ Service Plane                                    │
│                                                  │
│ • Module receives request with tenant context    │
│ • Executes business logic                        │
│ • Emits telemetry (OpenTelemetry)                │
│ • Reads/writes via Data Plane                    │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ Data Plane                                       │
│                                                  │
│ • Receives query with tenant context             │
│ • RLS automatically scopes to tenant             │
│ • Returns tenant-scoped data only                │
└─────────────────────────────────────────────────┘
```

---

## 9. Self-Serve Signup Flow

### 9.1 First-Time Customer

Customer visits `trafficure.com`, clicks "Start free trial."

1. Redirected to Commerce Plane signup (branded as Trafficure).
2. Commerce creates customer account and trial entitlement.
3. Commerce triggers Fleet Plane.
4. Fleet assigns tenant in existing shared Site (milliseconds, not minutes).
5. Customer redirected to their Trafficure tenant.

No Site provisioning needed for trials. Tenant assignment in a shared Site is near-instant.

### 9.2 Existing Customer Adds Product

Same customer visits `networkaccess.com`, clicks "Start free trial."

1. Logs in with existing account.
2. Commerce recognizes customer, adds NetworkAccess trial entitlement to same account.
3. Fleet assigns tenant in a NetworkAccess shared Site.
4. One customer, two products, one bill.

### 9.3 Trial to Paid Conversion

Seamless — customer was a tenant in the shared Site during trial, remains a tenant after converting. Commerce updates the entitlement, Fleet updates module access. No migration.

### 9.4 Shared to Dedicated Migration

Rare, high-value event. Customer on shared Site needs dedicated infrastructure (regulatory, contractual). Sales team involved, implementation timeline agreed. Fleet provisions a dedicated Site, migrates data and configuration. Not a self-serve flow.

### 9.5 Payment Failure Degradation Path

```
Payment fails → Grace period (runs normally)
             → Restricted mode (read-only, no new data)
             → Suspended (site down, data preserved)
             → Terminated (data deleted per retention policy)
```

Each state is a first-class concept in both Commerce Plane (entitlement state machine) and Fleet Plane (tenant/site lifecycle).

---

## 10. Product-to-Site Mapping

Fleet Plane manages the product-to-site mapping as a data model concern, not an architectural layer.

```
Fleet Plane
│
├── Trafficure
│   ├── SaaS Site US (shared, multi-tenant)
│   │   ├── Tenant: Acme Corp (Pro plan)
│   │   ├── Tenant: Globex (Starter plan)
│   │   └── Tenant: Initech (Trial)
│   ├── SaaS Site EU (shared, multi-tenant)
│   │   └── Tenant: Siemens (Business plan)
│   ├── SaaS Site India (shared, multi-tenant)
│   │   └── Tenant: Reliance (Pro plan)
│   ├── Samsung Site (dedicated)
│   └── Abu Dhabi DOT Site (dedicated, air-gapped)
│
├── NetworkAccess
│   ├── SaaS Site US (shared, multi-tenant)
│   └── Indus Towers Site (dedicated)
│
└── SmartMarket
    └── SaaS Site US (shared, multi-tenant)
```

---

## 11. Architecture Summary

### 11.1 Final Plane Inventory


| Plane                | Scope                | Purpose                                      |
| -------------------- | -------------------- | -------------------------------------------- |
| Infrastructure Plane | Spans Factory + Site | Compute, storage, network substrate          |
| Product Plane        | Factory              | What we build, why, and what work exists     |
| Build Plane          | Factory              | How we build it                              |
| Agent Plane          | Factory              | AI and automation agents across the platform |
| Commerce Plane       | Factory              | Who gets what, through whom, at what price   |
| Fleet Plane          | Factory              | What runs where                              |
| Control Plane        | Site                 | Who is allowed to do what, under what rules  |
| Service Plane        | Site                 | What the product does                        |
| Data Plane           | Site                 | Where data lives and how it is queried       |


Nine planes total. Infrastructure spans both halves. Five Factory planes handle what the company does. Three Site planes handle what the product does.

### 11.2 Authority Boundaries

```
Factory authority:
  Product Plane   → what gets built and what work exists
  Build Plane     → how it gets built
  Agent Plane     → what automation operates and where
  Commerce Plane  → who pays and what they get
  Fleet Plane     → where it runs and what version

Site authority:
  Control Plane   → who can do what at runtime
  Service Plane   → how the product behaves
  Data Plane      → how data is stored and queried

Shared authority:
  Infrastructure  → what everything runs on
```

### 11.3 Mental Model

The Factory is the manufacturing and operations headquarters. It designs products, builds them, commercializes them, and manages the fleet of running Sites.

Each Site is a self-governing instance of a product. It authenticates users, enforces policies, runs business logic, and manages data — all independently of the Factory.

Infrastructure Plane is the ground both halves stand on.

---

## 12. Phased Implementation

### Phase 1 — Foundation

**Factory:**

- Build Plane: CI/CD pipelines, artifact registry, repository standards, Service Plane SDK (v1)
- Agent Plane: Agent registry, basic agent identity, engineering agent integration (code review, test generation)
- Infrastructure Plane (Factory): Single Kubernetes cluster, Traefik ingress, basic networking, cert-manager
- Fleet Plane: Basic site/tenant lifecycle (create, upgrade), product-to-site mapping
- Commerce Plane: Customer accounts, 2-3 pricing plans, entitlements, billing (Stripe), trial lifecycle

**Site:**

- Infrastructure Plane (Site): Traefik gateway, Kubernetes-native networking, cloud storage
- Control Plane: Authentication, tenant resolution, basic RBAC, entitlements, audit logging
- Service Plane: First product modules (Trafficure), built on SDK
- Data Plane: PostgreSQL with RLS, basic object storage, caching

**Outcome:** First SaaS shared Site running with multi-tenant Trafficure. Self-serve signup working. Billing collecting payments.

### Phase 2 — Scale

**Factory:**

- Build Plane: Service Plane SDK (v2) with richer patterns, enhanced testing infrastructure
- Agent Plane: Task orchestration, multi-agent coordination, execution tracking, agent memory, QA and operations agents
- Infrastructure Plane (Factory): Multi-cluster management, cross-site networking, Vault for secrets
- Fleet Plane: Rolling deployments, canary releases, automated rollback, tenant migration (shared to dedicated)
- Commerce Plane: Partner/MSP accounts, usage metering, customer portal, dunning, multi-currency

**Site:**

- Infrastructure Plane (Site): Service mesh with mTLS, advanced egress control
- Control Plane: Full observability stack (OpenTelemetry + ClickHouse), policy-execution pattern for all planes
- Service Plane: Second product (NetworkAccess), analytics definitions, business workflow orchestration
- Data Plane: Analytics engine, data pipelines, schema-per-tenant for large customers

**Outcome:** Multiple products running. Partner channel active. Regional shared Sites (US, EU, India). Dedicated Sites for enterprise customers.

### Phase 3 — Enterprise

**Factory:**

- Infrastructure Plane (Factory): Air-gapped deployment specifications, one-way management channels, multi-cloud abstraction
- Agent Plane: Full agent marketplace, third-party agent support, advanced performance analytics, cost optimization
- Fleet Plane: Infrastructure-as-code for customer-operated Sites, advanced fleet analytics
- Commerce Plane: CPQ, contract management, marketplace integrations, revenue recognition, health scoring

**Site:**

- Infrastructure Plane (Site): Zero-egress mode, customer-operated infrastructure support
- Control Plane: Compliance-ready audit export, advanced policy framework
- Service Plane: Full module marketplace, third-party module support
- Data Plane: Cross-region replication, advanced backup policies, data residency enforcement

**Outcome:** Full deployment model spectrum — SaaS shared, SaaS dedicated, customer cloud, on-premise, air-gapped. Enterprise commercial maturity.

---

## 13. Key Risks and Mitigations

**Control Plane as single point of failure:** If Control Plane goes down, the entire Site is dead — Service Plane cannot authenticate, Data Plane cannot enforce isolation. Mitigation: keep Control Plane thin and focused on authority. No business logic, no workflow orchestration. Minimal dependencies. Design for graceful degradation — if observability subsystem fails, auth and tenant resolution must still work.

**Provisioning latency on signup:** If assigning a tenant in a shared Site takes too long, conversion drops. Mitigation: tenant assignment is a database insert and entitlement record, not infrastructure provisioning. Shared Sites are pre-provisioned and waiting for tenants.

**Trial to paid seamlessness:** No data migration on conversion. Customer stays in the same shared Site. Commerce updates entitlement, Fleet updates module access. Invisible transition.

**Partner/direct channel conflict:** Customer self-serves while partner is working the deal. Mitigation: Commerce Plane needs attribution logic, duplicate detection, and merge policies from Phase 2 onward.

**Tenant data isolation:** A data leak between tenants is a company-ending event. Mitigation: RLS at database level (defense in depth), mandatory tenant context middleware in SDK, no application code can bypass tenant scoping. Audit and automated testing of isolation boundaries.

**Infrastructure Plane spanning both halves:** Different operating models (company-operated SaaS vs. customer-operated air-gapped) mean Infrastructure Plane at Site scope must be fully self-contained. Mitigation: Site Infrastructure never depends on real-time Factory connectivity. All Factory pushes are asynchronous and idempotent.

---

## 14. Open Questions

1. **Technology selection for analytics engine within Data Plane.** ClickHouse (already explored for tracing) vs. alternatives for OLAP workloads.
2. **Service mesh timing.** Start with Kubernetes-native networking in Phase 1 and add full mesh (Linkerd/Istio) in Phase 2, or invest upfront?
3. **Module marketplace in Phase 3.** Should third-party modules be supported? What are the security and isolation implications?
4. **Cross-site data federation.** When a multi-site customer needs to query across Sites, what is the pattern? This needs design before Phase 3.
5. **Naming the overall company platform.** "Platform Fabric" is the working title. Does it become a branded internal concept or remain informal?
6. **Workflow orchestration placement.** This PRD places business workflow orchestration in Service Plane and limits Control Plane to governance. An alternative view places approval and provisioning workflows in Control Plane. The boundary between governance workflows (Control Plane) and business workflows (Service Plane) needs explicit definition with example cases.
7. **Agent Plane governance model.** What guardrails prevent agents from taking destructive actions? How are agent permissions reviewed and rotated? What is the escalation path when an agent produces unexpected results?
8. **Agent Plane cost controls.** LLM-based agents incur per-execution costs. What budget controls, cost allocation (per product, per agent type), and kill-switch mechanisms are needed?

---

## Appendix A: Glossary


| Term                     | Definition                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Platform Fabric          | The complete operating architecture spanning Factory and all Sites                                           |
| Factory                  | The company-wide system that designs, builds, and operates all products. Runs once.                          |
| Site                     | A running instance of a product in a specific customer environment. Self-governing at runtime.               |
| Plane                    | A logical layer of the architecture with a defined scope and responsibility                                  |
| Tenant                   | A customer's isolated partition within a shared Site                                                         |
| Entitlement              | A record of what a customer is allowed to use, managed by Commerce Plane                                     |
| Agent                    | An AI or automation entity with its own identity, permissions, and execution history, managed by Agent Plane |
| Service Plane SDK        | Shared framework produced by Build Plane that all product modules are built on                               |
| RLS                      | Row Level Security — database-enforced tenant data isolation                                                 |
| Policy-Execution Pattern | Control Plane declares intent, other planes implement it                                                     |
| System of Record         | The authoritative source for a specific category of data, owned by one plane                                 |


## Appendix B: Service Registry

```
Factory Services:
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

Site Services:
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
