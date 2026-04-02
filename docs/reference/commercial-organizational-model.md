# The Commercial & Organizational Model

## The business layer that drives the infrastructure

### Companion to the Infrastructure Mental Model V3

---

## Why This Layer Exists

The Infrastructure Mental Model (V3) answers: *what software exists, where does it run,
and how is it connected?*

This document answers the layer above: *why does it exist, who pays for it, what was
promised, and who's doing the work?*

Without this layer, your infrastructure model is an orphan. It can tell you "Trafficure
API v2.3.1 is running on Ultratech's VM" but it can't tell you "Ultratech is a managed
services customer on an Enterprise On-Prem offering with a 24x7 SLA, currently in the
second year of a 3-year contract, with a pending implementation engagement to deploy the
network planner v2 module."

Every deployment decision, every priority call, every incident response is ultimately
driven by commercial context. This model makes that context explicit, queryable, and
available to both humans and AI agents.

---

## The Six Commercial Entities

```
PRODUCT
  └── sold as → OFFERING(s)
        └── purchased by → CUSTOMER(s)
              └── through → ENGAGEMENT(s)
                    └── which create/attach to → DEPLOYMENT(s) [from Infra Model]

INITIATIVE (internal, cross-cutting)
  └── drives changes across → COMPONENTS, DEPLOYMENTS, ENGAGEMENTS

ACCOUNT (the organizational wrapper)
  └── groups → CUSTOMERS, ENGAGEMENTS, commercial context
```

---

### 1. PRODUCT

**Definition:** A commercially distinct thing you build and sell (or offer). Has a name
in the market, a value proposition, customers, pricing, and a roadmap. A product is NOT
a component or a system — it's the commercial identity that one or more technical systems
realize.

**Developer's intuition:** "The thing on our website that customers buy."

**Why it's separate from System (V3):** A System is a technical grouping of components
that cooperate. A Product is a commercial identity. They often align 1:1, but not always:

- One product, multiple systems: "Trafficure" the product might be realized by the
  "Trafficure Core" system, the "Trafficure Analytics" system, and the "IAM" system
  working together. The customer sees one product; engineers see three systems.
- One system, multiple products: The "Platform IAM" system might serve both Trafficure
  and SmartMarket products. Engineers see one system; sales sees two products that
  include IAM as a capability.
- Product bundles: "Lepton Intelligence Suite" might bundle Trafficure + SmartMarket
  as a single commercial offering, even though they're technically independent products.

**Key properties:**

| Property | Description |
|---|---|
| `name` | Market-facing name: "Trafficure", "SmartMarket" |
| `type` | `platform`, `application`, `module`, `add-on`, `tool`, `data-product` |
| `tagline` | One-line value proposition |
| `owner_team` | Product management team |
| `realized_by` | List of System IDs from the technical catalog |
| `target_market` | Who this is for: "telecom network planners", "tower companies", "fiber operators" |
| `pricing_model` | `subscription-per-seat`, `subscription-per-usage`, `perpetual-license`, `freemium`, `custom-contract` |
| `lifecycle` | `incubation`, `growth`, `mature`, `sunset` |
| `roadmap_url` | Link to product roadmap |
| `documentation_url` | Customer-facing product documentation |
| `competitive_landscape` | Brief note on alternatives and positioning |

**Product lifecycle** (distinct from component lifecycle and deployment lifecycle):

| State | Meaning | Commercial implication |
|---|---|---|
| `incubation` | Being built, not yet generally available | No SLAs, limited/beta customers only |
| `growth` | Actively acquiring customers, investing heavily | Feature velocity high, breaking changes possible |
| `mature` | Established market position, stable feature set | Reliability > new features, strong SLA commitments |
| `sunset` | Being phased out, successor exists or market exited | No new customers, existing customers being migrated |

**Linkage to Infra Model V3:**

```
PRODUCT "Trafficure"
  └── realized_by → SYSTEM "Trafficure Core Platform"
  └── realized_by → SYSTEM "Trafficure Analytics"
  └── realized_by → SYSTEM "Platform IAM" (shared with SmartMarket)
        └── SYSTEM contains → COMPONENTS (trafficure-api, trafficure-ui, etc.)
              └── COMPONENTS are packaged as → ARTIFACTS
                    └── ARTIFACTS deployed as → DEPLOYMENTS
```

---

### 2. OFFERING

**Definition:** A specific packaged way to buy and consume a product. The offering binds
together: which product, which edition/tier, which distribution channel, which deployment
topology, which SLA level, which support model, and which pricing. The offering is what
the sales team actually sells and what the contract actually specifies.

**Developer's intuition:** "The plan the customer is on."

**Why it matters:** The same product deployed two different ways for two different
customers creates radically different operational realities. Knowing the offering tells
you everything about the constraints:

- Can you push updates automatically? (SaaS offering: yes. On-prem unmanaged: no.)
- What's the uptime commitment? (Enterprise: 99.9%. Starter: best-effort.)
- Who operates it? (Managed cloud: you. Self-hosted: customer.)
- What features are available? (Enterprise: SSO, audit logs, advanced analytics. Professional: core features.)
- What's the support model? (Enterprise: 24x7, 1-hour response. Starter: business hours, next-day.)

**Key properties:**

| Property | Description |
|---|---|
| `name` | "Trafficure SaaS Professional", "Trafficure Enterprise On-Prem", "SmartMarket Starter" |
| `product` | Which product |
| `edition` | Feature tier: `starter`, `professional`, `enterprise`, `custom` |
| `distribution_channel` | How it's delivered: see channel table below |
| `default_topology` | Expected deployment shape: `single-node`, `clustered`, `managed-cloud`, `on-prem-managed`, `on-prem-unmanaged` |
| `sla_tier` | `best-effort`, `business-hours`, `24x7-standard`, `24x7-critical` |
| `support_model` | `community`, `email-business-hours`, `dedicated-support-engineer`, `embedded-sre` |
| `update_channel` | `continuous`, `stable-monthly`, `lts-quarterly`, `customer-controlled` |
| `operations_model` | Who operates: `vendor-operated`, `vendor-managed`, `customer-operated-vendor-supported`, `customer-operated-unsupported` |
| `entitlements` | List of features/capabilities included |
| `pricing` | Pricing structure (per-seat, per-usage, flat, custom) |
| `contract_term` | Typical: `monthly`, `annual`, `multi-year`, `perpetual` |
| `onboarding_model` | `self-service`, `assisted`, `white-glove`, `professional-services-required` |
| `lifecycle` | `active`, `deprecated`, `grandfathered` (existing customers only) |

**Distribution channels in detail:**

| Channel | Who deploys | Who operates | Update model | Access model |
|---|---|---|---|---|
| `saas-shared` | You | You | Continuous, all customers updated together | Internet, login |
| `saas-dedicated` | You | You | Per-customer update schedule possible | Internet or VPN, dedicated instance |
| `managed-cloud` | You, in your cloud | You | You control, per-customer cadence | Internet or VPN |
| `managed-customer-cloud` | You, in their cloud account | You | You control, with their approval | Their cloud, your access |
| `self-hosted-managed` | Customer's infra, you have access | Shared (you + customer) | You push with their approval window | VPN or jump-box |
| `self-hosted-supported` | Customer's infra, limited access | Customer, you advise | Customer pulls when ready | Support tickets, remote sessions |
| `self-hosted-unsupported` | Customer's infra, no access | Customer | Customer's responsibility | No access |
| `marketplace` | Customer via AWS/Azure marketplace | Customer or you | Marketplace update mechanism | Varies |
| `air-gapped` | Customer's disconnected infra | Customer | Signed bundles delivered out-of-band | No network access |

**Operations model explained:**

This is one of the most important properties on an offering because it determines who
can touch the deployment and how.

| Model | Meaning | Implication |
|---|---|---|
| `vendor-operated` | You own the full operational lifecycle. Customer never touches infrastructure. | You deploy, monitor, scale, patch, respond to incidents. Full control. |
| `vendor-managed` | You manage operations but customer's infra team has visibility and veto power. | You propose changes, customer approves. Maintenance windows negotiated. |
| `customer-operated-vendor-supported` | Customer runs it day-to-day. You provide support, guidance, and escalation path. | You don't deploy — customer does. You answer tickets and provide runbooks. |
| `customer-operated-unsupported` | Customer runs it entirely. Community support only or no support. | You have no visibility. You might not even know they're running it. |

**Example offerings for Trafficure:**

```
Offering: "Trafficure Cloud Professional"
  product: Trafficure
  edition: professional
  distribution: saas-shared
  topology: clustered (on your k8s)
  sla: 24x7-standard (99.5%)
  support: email-business-hours
  operations: vendor-operated
  updates: continuous
  onboarding: self-service
  pricing: per-seat monthly

Offering: "Trafficure Enterprise Managed"
  product: Trafficure
  edition: enterprise
  distribution: managed-customer-cloud
  topology: clustered (in their AWS/Azure)
  sla: 24x7-critical (99.9%)
  support: dedicated-support-engineer
  operations: vendor-managed
  updates: stable-monthly (with customer approval)
  onboarding: professional-services-required
  pricing: annual contract, custom

Offering: "Trafficure Enterprise On-Prem"
  product: Trafficure
  edition: enterprise
  distribution: self-hosted-managed
  topology: single-node or clustered (on their hardware)
  sla: 24x7-standard (99.5%)
  support: dedicated-support-engineer
  operations: vendor-managed (VPN access)
  updates: lts-quarterly
  onboarding: white-glove (implementation engagement required)
  pricing: perpetual license + annual maintenance

Offering: "Trafficure Air-Gapped"
  product: Trafficure
  edition: enterprise
  distribution: air-gapped
  topology: single-node (their disconnected server)
  sla: best-effort (verification impossible)
  support: email + quarterly on-site visits
  operations: customer-operated-vendor-supported
  updates: signed bundles delivered quarterly
  onboarding: on-site implementation engagement
  pricing: perpetual license + annual maintenance
```

**Linkage to Infra Model V3:**

The Offering determines the default values for most deployment dimensions:

```
OFFERING "Trafficure Enterprise On-Prem"
  └── implies → DEPLOYMENT dimensions:
        topology: single-node or on-prem-managed
        update_mechanism: lts-quarterly
        deployment_mechanism: docker-compose or native-installer
        access_mechanism: vpn
        change_process: customer-approval-required
        sla_tier: 24x7-standard
```

When you create a new deployment for a customer, the offering provides the template.
Customer-specific overrides (different maintenance window, additional compliance tags)
layer on top.

---

### 3. CUSTOMER

**Definition:** An organization that has a commercial relationship with you. More than a
tenant tag — a customer has contracts, contacts, a history, entitlements, and an account
team. The customer is the commercial identity; the tenant is the technical isolation
boundary in your deployments.

**Developer's intuition:** "The company paying us."

**Why it's separate from Tenant (V3):** A tenant is a technical concept — it's the
`org_id` in your database, the namespace in your k8s cluster, the identifier that ensures
data isolation. A customer is a commercial concept — it's the entity with a contract, a
billing address, and a relationship manager. They usually map 1:1, but not always:

- One customer, multiple tenants: Samsung India might have separate tenants for their
  mobile division and their network division, each with independent deployments but
  billed under one contract.
- One tenant, multiple offerings: A customer might have Trafficure Professional for
  their small offices and Trafficure Enterprise for their headquarters, all under one
  customer entity.
- Internal customers: Your own teams are customers of your platform tools — they
  consume the IAM system, the CI/CD pipeline, the observability stack. They don't pay,
  but they have SLAs and expectations.

**Key properties:**

| Property | Description |
|---|---|
| `name` | "Samsung India", "Ultratech Cement", "Ather Energy", "VBL" |
| `type` | `enterprise`, `mid-market`, `smb`, `internal`, `partner`, `trial` |
| `industry` | `telecom`, `cement`, `automotive-ev`, `beverages`, `government` |
| `region` | Primary geography |
| `tenant_ids` | Technical tenant identifiers in your systems |
| `account_manager` | Commercial relationship owner |
| `technical_account_manager` | Technical relationship owner (if different) |
| `contract_status` | `prospect`, `trial`, `active`, `churning`, `churned`, `paused` |
| `contract_start` | When the commercial relationship began |
| `contract_end` | When the current contract expires |
| `arr` | Annual recurring revenue (or contract value) |
| `health_score` | Account health indicator: `green`, `yellow`, `red` |
| `offerings` | Which offerings they've purchased |
| `engagements` | All engagements (past and present) |
| `deployments` | All active deployments serving this customer |
| `compliance_requirements` | Customer-mandated: `iso-27001`, `sox`, `data-residency-india`, etc. |
| `special_terms` | Any non-standard contractual obligations |
| `escalation_path` | Who to call when things go wrong: internal escalation + customer contacts |

**Customer lifecycle:**

| State | Meaning | What exists |
|---|---|---|
| `prospect` | In sales pipeline, no contract yet | Maybe a sandbox deployment for demo/POC |
| `trial` | Evaluating, time-limited access | Trial deployment, limited offering |
| `active` | Under contract, paying | Production deployments, active engagements |
| `expansion` | Active and growing — adding offerings, users, or modules | New engagements being scoped |
| `churning` | At risk of leaving or contract not renewing | Retention efforts, escalation |
| `churned` | Contract ended, no longer paying | Deployments being decommissioned, data retention per policy |
| `paused` | Contract active but usage suspended (budget freeze, reorganization) | Deployments may be running but not actively used |

**Linkage to Infra Model V3:**

```
CUSTOMER "Ultratech Cement"
  └── tenant_ids: ["ultratech"] (in your app DB, in k8s namespaces, in org-scoped data)
  └── offerings: ["Trafficure Enterprise On-Prem"]
  └── deployments: [trafficure-api-ultratech-prod, trafficure-ui-ultratech-prod, ...]
  └── substrates: ["Ultratech Pune Server Room"] (customer-premises substrate)
  └── network_entities: ["Ultratech VPN Tunnel"] (connecting you to their infra)
  └── secrets: ["ultratech-vpn-cert", "ultratech-db-password"] (credentials for their environment)
  └── data_stores: ["ultratech-trafficure-db"] (with data residency: india)
```

---

### 4. ENGAGEMENT

**Definition:** A scoped commercial commitment to a customer — either time-bounded
(project) or ongoing (managed service / support). The engagement is where business
promises become technical work. It's the entity that answers "why are we doing this work?"
and "what did we promise?"

**Developer's intuition:** "The project / the contract / the SOW."

**Why it's critical:** Without engagements, you can't answer:
- "Why was this deployment created?" (Because of implementation engagement ENG-042.)
- "What did we promise Samsung about uptime?" (Their managed service engagement
   specifies 99.9% with 1-hour response.)
- "How much capacity should we plan for Ather?" (Their expansion engagement calls for
   3 new modules by Q3.)
- "Can we postpone this migration?" (Check the engagement timeline and contractual milestones.)
- "Who's paying for this developer's time?" (They're allocated to engagement ENG-057.)

**Engagement types:**

| Type | Time model | What it produces | Example |
|---|---|---|---|
| `implementation` | Time-bounded (weeks to months) | New deployments, configured and tested | "Deploy Trafficure for VBL, including data migration from their legacy system" |
| `migration` | Time-bounded | Modified deployments (new topology, new version, new infrastructure) | "Migrate Ultratech from single-node Compose to Kubernetes cluster" |
| `custom-development` | Time-bounded | New or modified components, features, integrations | "Build Samsung-specific network optimization module" |
| `integration` | Time-bounded | Configured connections between customer's systems and your product | "Integrate Trafficure with Ather's internal fleet management API" |
| `managed-service` | Ongoing (annual renewal) | Operational responsibility for existing deployments | "Operate and monitor Ultratech's production environment" |
| `support` | Ongoing (annual renewal) | Support tickets, incident response, advisory | "Enterprise support for Samsung India's self-hosted deployment" |
| `professional-services` | Time-bounded | Advisory deliverables — architecture reviews, training, optimization | "Network planning optimization workshop for VBL" |
| `poc-trial` | Time-bounded (days to weeks) | Temporary deployment for evaluation | "Trafficure POC for prospective customer Jio" |

**Key properties:**

| Property | Description |
|---|---|
| **Identity** | |
| `engagement_id` | Unique identifier (e.g., "ENG-042") |
| `name` | Human-readable: "Ultratech Trafficure Implementation" |
| `type` | From the type table above |
| `customer` | Which customer |
| `offering` | Which offering this engagement is for |
| **Scope** | |
| `description` | What was promised |
| `deliverables` | Concrete deliverables: deployments, documents, training sessions, integrations |
| `scope_document_url` | Link to SOW, proposal, or scope document |
| `modules_included` | Which product modules/features are in scope |
| **Timeline** | |
| `start_date` | When work begins |
| `end_date` | When work is expected to complete (null for ongoing) |
| `milestones` | Key dates: kickoff, UAT, go-live, hypercare-end, handover |
| `status` | `scoping`, `approved`, `in-progress`, `on-hold`, `completed`, `cancelled` |
| **People** | |
| `engagement_manager` | Commercial owner (delivery lead, account manager) |
| `technical_lead` | Technical owner (architect, tech lead) |
| `team_members` | People allocated to this engagement |
| `customer_contacts` | Customer-side stakeholders and their roles |
| **Commercial** | |
| `contract_value` | Revenue from this engagement |
| `billing_model` | `fixed-price`, `time-and-materials`, `retainer`, `included-in-subscription` |
| `budget_consumed` | How much of the budget has been used |
| **Operational (for ongoing engagements)** | |
| `sla_commitments` | Specific SLA terms: uptime, response time, resolution time |
| `maintenance_windows` | When changes are allowed |
| `change_process` | `continuous-deploy`, `weekly-release`, `monthly-release`, `customer-approval`, `change-board` |
| `incident_response` | How incidents are handled: response times, escalation path, communication channels |
| `reporting_cadence` | How often you report to the customer: weekly, monthly, quarterly |
| **Linkage** | |
| `deployments_created` | Deployments this engagement created (for implementation/migration) |
| `deployments_managed` | Deployments this engagement operates (for managed services) |
| `components_modified` | Components this engagement changed (for custom development) |
| `infrastructure_provisioned` | Hosts, substrates, network entities created for this engagement |

**Engagement lifecycle:**

```
scoping → approved → in-progress → [completing | on-hold] → completed → archived
                                          ↓
                                      cancelled

For ongoing engagements (managed-service, support):
approved → active → [renewing | churning] → ended → archived
```

**The project-to-service transition:**

This is the most important lifecycle pattern for a company like Lepton. A customer
journey typically flows:

```
1. POC/Trial Engagement (2-4 weeks)
   → Creates: sandbox deployment, demo data
   → Outcome: Customer decides to buy

2. Implementation Engagement (1-6 months)
   → Creates: production deployment, configured integrations, migrated data
   → Consumes: professional services hours, infrastructure provisioning
   → Milestones: kickoff → environment setup → data migration → UAT → go-live → hypercare

3. Hypercare Period (2-4 weeks, part of implementation)
   → The deployment is live but the implementation team is still actively monitoring
   → Bug fixes are immediate, not through normal support channels
   → This is the transition zone between project and operations

4. Handover to Managed Service (explicit event)
   → Implementation engagement status → completed
   → Managed service engagement status → active
   → The deployment's operational ownership transfers from project team to ops/SRE team
   → Runbooks, monitoring, and alerting are verified as part of handover criteria

5. Managed Service Engagement (ongoing, annual renewal)
   → Manages: the production deployment(s)
   → Provides: monitoring, incident response, patching, minor updates
   → Reports: monthly uptime, incident summary, capacity forecast

6. Expansion Engagements (as needed)
   → New implementation or custom development engagements
   → Layer on top of the existing managed service
   → May create new deployments or modify existing ones
```

**Handover criteria** (the checklist for transitioning from project to operations):

| Criterion | Description |
|---|---|
| Deployment verified | All deployments passing health checks, drift status = converged |
| Monitoring configured | Dashboards, alerts, and SLOs defined and tested |
| Runbooks complete | Deployment, rollback, troubleshooting, and escalation runbooks exist and are tested |
| Secrets rotated | All initial/temporary credentials replaced with production credentials on proper rotation |
| Backup verified | Backup schedule tested, restore procedure verified |
| Customer trained | Customer contacts trained on basic operations, support ticket process, escalation path |
| SLA baseline established | Baseline metrics collected during hypercare to set realistic SLA targets |
| On-call configured | Managed service team added to on-call rotation for this deployment |

**Linkage to Infra Model V3:**

```
ENGAGEMENT "Ultratech Trafficure Implementation" (ENG-042)
  customer: Ultratech Cement
  offering: Trafficure Enterprise On-Prem
  type: implementation
  status: completed
  
  Created:
    SUBSTRATE: "Ultratech Pune Server Room" (registered in inventory)
    HOST: "ultratech-pune-vm-01" (provisioned via Ansible)
    RUNTIME: docker-compose on ultratech-pune-vm-01
    DEPLOYMENTS: [trafficure-api-ultratech-prod, trafficure-ui-ultratech-prod, ...]
    NETWORK ENTITIES: [ultratech-vpn-tunnel, ultratech-traefik-gateway]
    DATA STORES: [ultratech-trafficure-db]
    SECRETS: [ultratech-db-cred, ultratech-vpn-cert]
  
  Handed over to:
    ENGAGEMENT "Ultratech Managed Service" (ENG-043)
      type: managed-service
      status: active
      manages: [same deployments as above]
      sla: 99.5% uptime, 1-hour response, 4-hour resolution
      maintenance_window: Sunday 2-6am IST
      change_process: customer-approval (2-day notice)
```

---

### 5. INITIATIVE

**Definition:** An internal, cross-cutting effort that drives change across multiple
components, deployments, customers, and/or engagements. Initiatives are how engineering
leadership tracks and drives organizational priorities that span team boundaries.

**Developer's intuition:** "The big thing we're all working toward."

**Why it's separate from engagement:** Engagements are customer-facing and commercially
driven. Initiatives are internally driven — they're engineering or platform priorities
that may not correspond to any single customer request. "Migrate all customers to the
new IAM system" is an initiative that touches every customer's deployment but isn't any
single customer's engagement.

**Initiative types:**

| Type | Description | Example |
|---|---|---|
| `migration` | Moving things from old to new | "Migrate all single-node customers to Kubernetes" |
| `platform-upgrade` | Upgrading shared infrastructure | "Upgrade all deployments to Traefik v3" |
| `compliance` | Achieving a compliance certification or standard | "Achieve SOC 2 Type II by Q4" |
| `security` | Remediation of security issues | "Rotate all database credentials to 90-day auto-rotation" |
| `feature-rollout` | Rolling a new feature across all deployments | "Enable the new planning algorithm for all Enterprise customers" |
| `deprecation` | Removing old components or APIs | "Deprecate API v1, migrate all consumers to v2" |
| `cost-optimization` | Reducing infrastructure spend | "Consolidate preview environments to shared k8s cluster" |
| `tech-debt` | Paying down accumulated technical debt | "Replace all hand-written SQL with sqlc-generated code" |
| `observability` | Improving monitoring and debugging capabilities | "Add distributed tracing to all Java services" |

**Key properties:**

| Property | Description |
|---|---|
| `name` | "IAM Migration", "SOC 2 Compliance", "K8s Migration" |
| `type` | From the type table above |
| `owner` | Person or team driving this initiative |
| `sponsor` | Executive sponsor |
| `priority` | `p0-critical`, `p1-high`, `p2-medium`, `p3-low` |
| `deadline` | Target completion date |
| `status` | `proposed`, `approved`, `in-progress`, `blocked`, `completed`, `abandoned` |
| `description` | What we're doing and why |
| `success_criteria` | How we know we're done: measurable conditions |
| `scope` | What's affected: list of components, deployments, customers, or offerings |
| `progress` | Completion tracking: X of Y components migrated, N of M customers updated |
| `blockers` | Current impediments |
| `risks` | Known risks and mitigation plans |
| `linked_engagements` | Customer engagements that are affected by or depend on this initiative |
| `linked_jira_epic` | For engineering tracking |
| `documentation_url` | RFC, design doc, or planning document |

**Initiative progress tracking** (what OpsLevel calls "Campaigns" and Cortex calls "Initiatives"):

An initiative defines a **scorecard** — a set of conditions that each entity in scope
must satisfy. Progress is measured by how many entities pass the scorecard.

```
Initiative: "Add distributed tracing to all production services"
Scope: All components with type=service AND lifecycle=production
Scorecard:
  ✓ OTel SDK integrated (check: source code contains otel dependency)
  ✓ Trace context propagation configured (check: service emits traces to collector)
  ✓ Dashboard exists in Grafana (check: dashboard URL populated in component record)
  ✓ Runbook updated (check: runbook mentions trace IDs in troubleshooting section)
Progress: 12/18 services fully passing, 4 partially, 2 not started
```

**Linkage to Infra Model V3:**

Initiatives don't create entities directly — they track changes across existing entities.
But they provide the *why* for changes:

```
INITIATIVE "Migrate to Kubernetes"
  └── affects DEPLOYMENTS:
        trafficure-api-ultratech-prod: status=migrating-source
        trafficure-api-ultratech-k8s-prod: status=migrating-target
  └── affects HOSTS:
        ultratech-pune-vm-01: lifecycle=draining (once migration complete)
  └── requires ENGAGEMENTS:
        "Ultratech K8s Migration" (ENG-055): type=migration
        "Samsung K8s Migration" (ENG-056): type=migration
  └── changes COMPONENTS:
        trafficure-api: now has Helm chart artifact in addition to Compose
  └── creates TEMPLATES:
        "k8s-deployment-template": new template for future customers
```

---

### 6. ACCOUNT

**Definition:** The organizational wrapper that groups a customer relationship — their
offerings, engagements, deployments, contacts, contracts, and financial data into a
single manageable entity. In smaller companies, Account and Customer are the same thing.
In larger or more complex situations, they diverge.

**Developer's intuition:** "The CRM record."

**Why it might differ from Customer:**
- A holding company (Account: "Samsung Group") might have multiple customers
  (Samsung India Networks, Samsung India Mobile, Samsung Electronics Korea) each with
  their own offerings and deployments.
- A reseller or partner (Account: "Telecom Solutions Inc.") might purchase on behalf
  of multiple end-customers.
- A government entity might have a master services agreement (Account) with multiple
  departments as customers.

For most companies Lepton's size, Account = Customer. But the model should accommodate
the divergence because enterprise sales encounters it frequently.

| Property | Description |
|---|---|
| `name` | "Samsung Group", "Government of Maharashtra" |
| `type` | `direct`, `partner`, `reseller`, `holding-company` |
| `customers` | Customer entities under this account |
| `account_manager` | Overall relationship owner |
| `master_contract` | Master services agreement, if any |
| `total_arr` | Sum of all customer ARR under this account |
| `strategic_tier` | `strategic` (top 10), `growth` (top 50), `standard`, `self-service` |

---

## The Complete Relationship Map

### Commercial → Technical Linkage

```
ACCOUNT
  └── contains → CUSTOMER(s)
        └── has → OFFERING(s) [which product, edition, distribution]
        │     └── determines → default DEPLOYMENT dimensions
        │           (topology, sla, update_channel, operations_model, change_process)
        │
        └── has → ENGAGEMENT(s)
        │     │
        │     ├── Implementation Engagement
        │     │     └── creates → SUBSTRATE (registers customer infra)
        │     │     └── creates → HOST (provisions VMs)
        │     │     └── creates → RUNTIME (installs Docker, Compose, K8s)
        │     │     └── creates → DEPLOYMENT(s) (deploys the product)
        │     │     └── creates → NETWORK ENTITY (VPN, DNS, certs)
        │     │     └── creates → DATA STORE (initializes database)
        │     │     └── creates → SECRET (provisions credentials)
        │     │     └── hands over to → Managed Service Engagement
        │     │
        │     ├── Managed Service Engagement
        │     │     └── manages → DEPLOYMENT(s) [monitoring, patching, incident response]
        │     │     └── governed by → SLA commitments, maintenance windows, change process
        │     │
        │     ├── Custom Development Engagement
        │     │     └── modifies → COMPONENT(s) [new features, integrations]
        │     │     └── creates → API(s) [customer-specific endpoints]
        │     │     └── may create → ARTIFACT(s) [customer-specific builds]
        │     │
        │     ├── Support Engagement
        │     │     └── covers → DEPLOYMENT(s) [ticket-based support, advisory]
        │     │
        │     └── POC/Trial Engagement
        │           └── creates → temporary DEPLOYMENT(s) [sandbox, with TTL]
        │           └── may use → WORKSPACE [demo environment]
        │
        └── owns (from their side) → SUBSTRATE [customer-premises]
              └── where → DEPLOYMENT(s) run

PRODUCT
  └── realized by → SYSTEM(s) [technical catalog]
  └── sold as → OFFERING(s) [commercial packaging]
  └── has → PRODUCT lifecycle (incubation → growth → mature → sunset)

INITIATIVE (internal)
  └── drives changes across → COMPONENTS, DEPLOYMENTS
  └── may require → ENGAGEMENTS (customer-facing work driven by internal priority)
  └── tracked via → scorecards and progress metrics
```

### The Full Entity Count

**Commercial Layer (this document): 6 entities**
- Product, Offering, Customer, Engagement, Initiative, Account

**Technical Layer (Infra Model V3): 13 entities**
- Domain, System, Component, API, Artifact, Release Bundle, Template
- Substrate, Host, Workspace, Runtime, Network Entity
- Deployment, Workload, Managed Dependency, Data Store, Secret

**Organizational Layer: 2 entities**
- Team, Person

**Total: 21 entities**

---

## The Updated Banned Words List

These additions apply to the commercial layer:

| Instead of... | Say... | Because... |
|---|---|---|
| **project** (naked) | **engagement** (commercial scope) or **initiative** (internal effort) | "Project" conflates customer work with internal work |
| **client** vs **customer** | Pick one and be consistent. Recommendation: **customer** | Services companies say "client," product companies say "customer." Lepton is a hybrid — pick one. |
| **contract** (meaning the work) | **engagement** (the scoped work) vs **contract** (the legal document) | The engagement is the work; the contract is the paper. Different lifecycles. |
| **plan** (meaning offering) | **offering** (the packaged product) vs **plan** (the pricing tier) | "Plan" is overloaded: pricing plan, project plan, capacity plan |
| **onboarding** (ambiguous) | **implementation engagement** (the project) vs **user onboarding** (UX) vs **employee onboarding** (HR) | Three very different things called "onboarding" |
| **scope** (as a noun for everything) | **engagement scope** (what's promised), **offering scope** (what's included), **initiative scope** (what's affected) | Always qualify what scope you mean |
| **go-live** (as a permanent state) | **go-live** is a **milestone** in an **implementation engagement**. The deployment's **lifecycle state** becomes `active`. | Go-live is an event, not a state. |
| **handover** (vague) | **project-to-operations handover** with explicit **handover criteria** checklist | A handover without criteria is a handoff of blame |
| **account** (meaning customer) | **account** (the CRM wrapper) vs **customer** (the organization) vs **tenant** (the technical isolation) | Three concentric circles, not synonyms |
| **SLA** (used loosely) | **SLA** lives on the **engagement** (what you promised) and flows to the **deployment** (how it's enforced). Don't say "the SLA" without saying which engagement. | Different engagements with the same customer might have different SLAs |

---

## The AI Agent's Commercial Awareness

When Claude Code or an ops copilot processes a request involving customer context:

**"Deploy the hotfix to Samsung"**
```
→ Look up CUSTOMER "Samsung India"
→ Find their active MANAGED SERVICE ENGAGEMENT
→ Check the engagement's change_process: "customer-approval-required"
→ Check the maintenance_window: "Saturday 1-5am IST"
→ It's Tuesday. You cannot deploy without explicit approval.
→ Response: "Samsung India's managed service engagement requires customer
   approval for changes, with a standard maintenance window Saturday 1-5am IST.
   Should I draft a change request notification for their technical contact?"
```

**"How much does Ultratech cost us?"**
```
→ Look up CUSTOMER "Ultratech Cement"
→ Find all DEPLOYMENTS tagged to tenant: ultratech
→ For each deployment, sum:
   - SUBSTRATE cost allocation (their on-prem = $0, but VPN and monitoring infra has cost)
   - HOST resource consumption × cost per unit
   - MANAGED DEPENDENCY costs attributed to their usage
   - People cost: team members allocated to their ENGAGEMENTS × rate
→ Compare against their contract ARR
→ Report: margin analysis per customer
```

**"A new customer wants Trafficure. What do we need to do?"**
```
→ Ask: which OFFERING? (SaaS Pro, Enterprise On-Prem, Enterprise Managed, etc.)
→ The offering determines:
   - What ENGAGEMENT types are needed (self-service onboarding vs implementation project)
   - What INFRASTRUCTURE must be provisioned (nothing for SaaS, full stack for on-prem)
   - What TEMPLATES to use for the deployment
   - What HANDOVER CRITERIA must be met before going live
   - What MANAGED SERVICE engagement to create post-go-live
→ Generate: engagement plan with milestones, infrastructure requirements, and timeline
```

**"We're planning the K8s migration initiative. Which customers are affected?"**
```
→ Look up INITIATIVE "Migrate to Kubernetes"
→ Find all DEPLOYMENTS with topology: single-node
→ For each deployment, find the CUSTOMER and their ENGAGEMENT
→ For each customer, check:
   - Engagement type: managed-service (we can plan and execute)
     vs customer-operated (we need to notify and coordinate)
   - Change process: continuous (easy) vs customer-approval (needs lead time)
   - SLA tier: 24x7-critical (needs careful migration plan with rollback)
     vs best-effort (simpler)
→ Report: prioritized list of customers by migration complexity
```

---

## How It All Fits Together: A Complete Trace

Starting from a business decision, trace all the way down to running infrastructure:

```
ACCOUNT: "Samsung Group" (strategic tier)
  └── CUSTOMER: "Samsung India Networks" (active, enterprise, telecom)
        │
        ├── OFFERING: "Trafficure Enterprise Managed"
        │     product: Trafficure
        │     edition: enterprise
        │     distribution: managed-customer-cloud (their AWS account)
        │     operations: vendor-managed
        │     sla: 24x7-critical (99.9%)
        │
        ├── ENGAGEMENT: "Samsung Trafficure Implementation" (ENG-031, completed)
        │     type: implementation
        │     delivered: production deployment in Samsung's AWS ap-south-1
        │     handover: completed 2024-09-15, all criteria met
        │
        ├── ENGAGEMENT: "Samsung Managed Service" (ENG-032, active)
        │     type: managed-service
        │     manages: all Samsung production deployments
        │     sla: 99.9% uptime, 30-min response, 2-hour resolution
        │     maintenance_window: Sunday 1-5am IST
        │     change_process: customer-approval (1-week notice)
        │     reporting: monthly uptime + incident report
        │     │
        │     └── manages → DEPLOYMENTS:
        │           │
        │           ├── DEPLOYMENT: "trafficure-api-samsung-prod"
        │           │     component: trafficure-api (from SYSTEM "Trafficure Core")
        │           │     artifact: trafficure-api:2.4.0 (container image in ECR)
        │           │     runtime: k8s-namespace "trafficure" on samsung-prod-eks
        │           │     environment: production
        │           │     tenant: samsung-india
        │           │     topology: clustered
        │           │     deployment_mode: live
        │           │     lifecycle_state: active
        │           │     deployment_mechanism: helm-chart (via Flux GitOps)
        │           │     drift_status: converged
        │           │     │
        │           │     └── runs on → HOST: eks-worker-node-i-0a1b2c3d
        │           │           └── in → SUBSTRATE: Samsung AWS ap-south-1 (cloud-region)
        │           │                 └── in → SUBSTRATE: Samsung AWS Account (cloud-account)
        │           │                       └── owned by → CUSTOMER: Samsung India Networks
        │           │
        │           └── DEPLOYMENT: "trafficure-ui-samsung-prod"
        │                 ... (similar structure)
        │
        ├── ENGAGEMENT: "Samsung Network Optimizer Module" (ENG-038, in-progress)
        │     type: custom-development
        │     modifies: COMPONENT "trafficure-network-optimizer" (new module)
        │     creates: API "network-optimizer-api" (new API)
        │     timeline: 2025-Q1 to 2025-Q3
        │     team: [dev-1, dev-2, architect-1]
        │
        └── ENGAGEMENT: "Samsung Support" (ENG-033, active)
              type: support
              covers: all Samsung deployments
              model: dedicated-support-engineer
              response_time: 30 minutes (P1), 2 hours (P2), 8 hours (P3)

PRODUCT: "Trafficure"
  lifecycle: mature
  realized_by: [SYSTEM "Trafficure Core", SYSTEM "Trafficure Analytics"]
  └── SYSTEM "Trafficure Core"
        └── COMPONENT "trafficure-api" (type: service, lifecycle: production, tier: tier-1)
              └── provides → API "trafficure-planning-api" (openapi, version: v2, visibility: public)
              └── depends on → COMPONENT "trafficure-db" (hard, sync)
              └── depends on → MANAGED DEPENDENCY "Samsung RDS Postgres" (hard, sync)
              └── packaged as → ARTIFACT "trafficure-api:2.4.0" (container-image, ECR)
                    └── part of → RELEASE BUNDLE "Trafficure Platform 2.4.0"

INITIATIVE: "SOC 2 Compliance" (in-progress)
  affects: DEPLOYMENT "trafficure-api-samsung-prod" (among others)
  scorecard:
    ✓ Encryption at rest: enabled
    ✓ Audit logging: configured
    ✗ Secret rotation: 90-day auto-rotation NOT YET configured
    ✓ Access review: completed quarterly
  → The failing scorecard item generates work that touches Samsung's engagement
```

---

*This commercial model is a companion to the Infrastructure Mental Model V3.
Together they form a complete vocabulary of 21 entities spanning business context,
software catalog, infrastructure, and operations.*
