# The Commercial Packaging Model

## Capabilities, Plans, Entitlements, and Usage

### Replaces the previous Module/Bundle/Capability Map approach

---

## Design Principles

The previous attempt (Module, Bundle, Capability Map) was too verbose, too rigid, and
too specific to one way of packaging software. This revision follows three principles:

1. **General, not specific.** The same vocabulary should work whether you're selling
   per-seat SaaS, metered API access, perpetual licenses, or air-gapped bundles.

2. **Composable, not hierarchical.** Instead of forced nesting (Product → Module →
   Component), use flat entities with typed relationships. A capability can depend on
   other capabilities. A plan can include any mix of capabilities. An entitlement can
   grant access to a capability or a numeric quota.

3. **Separated concerns.** What functionality exists (Capability) is separate from how
   it's packaged (Plan), which is separate from what a customer actually has (License →
   Entitlements), which is separate from what they're actually consuming (Usage).

---

## The Eight Entities

```
What exists:        CAPABILITY (unit of functionality)
                      └── depends on → COMPONENTS (from technical catalog)
                      └── depends on → other CAPABILITIES

How it's packaged:  PLAN (named packaging with price)
                      └── includes → CAPABILITIES + QUOTAS

What a customer has: LICENSE (contractual grant)
                      └── contains → ENTITLEMENTS (capability access or resource quota)
                      └── has → SEATS (per-user allocations)

What's consumed:    USAGE (actual consumption against quotas)
                    CREDIT (pre-purchased or promotional units)
```

---

### 1. CAPABILITY

**Definition:** A unit of functionality that your product can provide. Capabilities are
the atoms of your product catalog — everything else (plans, entitlements, deployments)
references them. A capability has a name customers recognize, but it's not tied to any
specific commercial packaging.

**Developer's intuition:** "A thing the product can do."

Capabilities form a dependency graph. "AI Data Analyst" depends on "Dataset Management."
"Coverage Analysis" depends on "RF Engine" capability. At the leaf level, capabilities
depend on technical components from the infrastructure model.

**Key properties:**

| Property | Description |
|---|---|
| `name` | "Coverage Analysis", "AI Data Analyst", "Single Sign-On", "API Access" |
| `product` | Which product this belongs to. Nullable for platform-level capabilities. |
| `description` | What this capability provides, in customer-facing language |
| `type` | See type table below |
| `depends_on_capabilities` | Other capabilities this requires |
| `depends_on_components` | Technical components this needs deployed (the bridge to infra model) |
| `activation_type` | How enabling this capability manifests technically |
| `owner_team` | Who builds and maintains this |
| `lifecycle` | `experimental`, `beta`, `ga`, `deprecated` |
| `visibility` | `public` (on pricing page), `internal` (infrastructure, not sold), `hidden` (exists but not advertised) |

**Capability types:**

| Type | Description | Examples |
|---|---|---|
| `feature` | A user-facing functional area | Coverage Analysis, AI Data Analyst, Reports |
| `integration` | Connecting to an external system | SSO/SAML, LDAP, Slack Integration, API Access |
| `infrastructure` | Platform-level capability not sold directly | IAM, API Gateway, Observability |
| `data` | Access to a dataset or data capability | Terrain Data, Map Tiles, Revenue Data |
| `compute` | A computation or processing capability | RF Engine, Microwave Planning Engine |
| `support-tier` | A support level capability | Priority Support, Dedicated Engineer |
| `limit-override` | A capability that raises a quota | Extended API Rate Limit, Extra Storage |

**Activation types** — how enabling a capability manifests technically:

| Type | What happens when enabled | Deployment impact |
|---|---|---|
| `entitlement-flag` | A feature flag is flipped. No new components. | Config change only |
| `configuration` | Existing components get additional config/schema. | Config change + possible migration |
| `additive` | New components must be deployed alongside existing ones. | New deployments created |
| `independent` | A separate system must be deployed. | Significant new infrastructure |
| `external` | An external integration is configured (customer's SSO, etc.) | Config + network entity |

**Capability dependency graph (Lepton example):**

```
CAPABILITY: "Coverage Analysis" (feature, additive)
  ├── depends_on_capabilities: ["RF Engine"]
  ├── depends_on_components: [coverage-service, coverage-ui]
  └── implicitly requires: [core-shell, traefik, IAM, postgres] (via platform capabilities)

CAPABILITY: "RF Engine" (compute, additive)
  └── depends_on_components: [rf-engine]

CAPABILITY: "AI Data Analyst" (feature, additive)
  ├── depends_on_capabilities: ["Dataset Management"]
  ├── depends_on_components: [ai-data-analyst-service, ai-data-analyst-ui]
  └── implicitly requires: [core-shell, traefik, IAM, postgres]

CAPABILITY: "Dataset Management" (infrastructure, additive)
  └── depends_on_components: [organization-data-management-service]

CAPABILITY: "Single Sign-On" (integration, configuration)
  └── depends_on_components: [ory-kratos] (existing, just needs SAML config)

CAPABILITY: "API Access" (integration, entitlement-flag)
  └── depends_on_components: [] (no new components — API already exists, just needs auth)

CAPABILITY: "Revenue Prediction" (feature, additive)
  ├── depends_on_capabilities: ["Dataset Management", "Reports"]
  ├── depends_on_components: [revenue-prediction-service, revenue-prediction-ui]
  ├── lifecycle: beta
  └── visibility: hidden (not on pricing page yet, Samsung-only for now)

CAPABILITY: "Platform Core" (infrastructure, independent)
  └── depends_on_components: [core-shell, traefik, ory-kratos, ory-hydra, spicedb, postgres, otel-collectors]
  └── visibility: internal (every deployment needs this, never sold as a line item)
```

**Resolving what to deploy for a customer:**

Starting from the capabilities a customer is entitled to, recursively resolve
dependencies, collect all `depends_on_components`, deduplicate, and you have the
complete list of components that must be deployed. Platform-level capabilities
(visibility: internal) are always included.

This replaces the old "Capability Map" entity entirely — the mapping lives as
`depends_on_components` directly on the Capability. Simpler, no join entity needed.

---

### 2. PLAN

**Definition:** A named, priced packaging of capabilities and resource quotas. The thing
on your pricing page. The thing a sales rep quotes. Plans are how you turn a product
catalog into a commercial offer.

**Developer's intuition:** "The pricing tier."

A plan is NOT the same as an offering (from the earlier model). An offering combined
product + edition + distribution channel + SLA + operations model. That was too many
concerns in one entity. Now:

- **Plan** = what capabilities you get and at what price (commercial packaging)
- **Offering** = how it's delivered and operated (distribution + operations)

These are orthogonal. "Trafficure Professional" (plan) can be delivered as SaaS or
self-hosted (offering). The plan determines features; the offering determines topology.

**Key properties:**

| Property | Description |
|---|---|
| `name` | "Trafficure Professional", "SmartMarket Starter", "Lepton Intelligence Suite" |
| `product` | Which product(s). Can span multiple products for suite plans. |
| `type` | `tier` (edition level), `suite` (multi-product), `add-on` (supplements a base plan) |
| `capabilities_included` | Which capabilities are included |
| `quotas_included` | Default resource quotas (see Quota entity below) |
| `seats_model` | How seats work: `unlimited`, `per-named-user`, `per-concurrent-user`, `per-organization` |
| `seats_included` | Number of seats included in base price (if applicable) |
| `pricing_model` | `flat-monthly`, `flat-annual`, `per-seat-monthly`, `per-seat-annual`, `usage-based`, `hybrid`, `custom-contract`, `perpetual-license`, `perpetual-plus-maintenance` |
| `base_price` | Starting price (if applicable) |
| `per_seat_price` | Per additional seat (if applicable) |
| `billing_period` | `monthly`, `annual`, `multi-year`, `one-time` |
| `available_addons` | Add-on plans that can supplement this plan |
| `minimum_commitment` | Minimum term, minimum seats, minimum spend |
| `trial_available` | Can a customer try this plan before buying? Duration? |
| `lifecycle` | `active` (currently sold), `grandfathered` (existing customers only, not sold to new), `deprecated` (being phased out), `promotional` (time-limited) |

**Lepton's plan catalog:**

```
PLAN: "Trafficure Starter"
  type: tier
  product: Trafficure
  capabilities: [Coverage Analysis, LOS Analysis, Network Planning]
  seats_model: per-named-user
  seats_included: 5
  quotas: [api-calls: 10k/day, storage: 50GB, projects: 10]
  pricing: per-seat-monthly, ₹15,000/seat/month
  addons: [Project Management, Microwave Planning, API Access]
  trial: 14 days

PLAN: "Trafficure Professional"
  type: tier
  product: Trafficure
  capabilities: [Coverage, LOS, Planning, Project Management, SSO, API Access]
  seats_model: per-named-user
  seats_included: 20
  quotas: [api-calls: 100k/day, storage: 500GB, projects: unlimited]
  pricing: per-seat-annual, ₹1,50,000/seat/year
  addons: [Microwave Planning, RF Kit, Priority Support]

PLAN: "Trafficure Enterprise"
  type: tier
  product: Trafficure
  capabilities: [all Trafficure capabilities including RF Kit, Microwave]
  seats_model: per-organization (unlimited)
  quotas: [api-calls: unlimited, storage: unlimited, projects: unlimited]
  pricing: custom-contract
  addons: [Revenue Prediction, Dedicated Support Engineer]

PLAN: "SmartMarket Starter"
  type: tier
  product: SmartMarket
  capabilities: [Map Exploration, Dataset Management]
  seats_model: per-named-user
  seats_included: 3
  quotas: [datasets: 5, storage: 10GB, reports: 10/month]
  pricing: per-seat-monthly

PLAN: "SmartMarket Professional"
  type: tier
  product: SmartMarket
  capabilities: [Map Exploration, Dataset Mgmt, AI Analyst, Reports]
  seats_model: per-named-user
  quotas: [datasets: unlimited, storage: 500GB, reports: unlimited, ai-queries: 1000/month]
  pricing: per-seat-annual

PLAN: "Lepton Intelligence Suite"
  type: suite
  products: [Trafficure, SmartMarket]
  capabilities: [all Trafficure Enterprise + all SmartMarket Professional capabilities]
  seats_model: per-organization
  quotas: [all unlimited]
  pricing: custom-contract

PLAN: "Priority Support" (add-on)
  type: add-on
  capabilities: [Priority Support]
  pricing: flat-annual

PLAN: "Revenue Prediction" (add-on)
  type: add-on
  capabilities: [Revenue Prediction]
  pricing: custom-contract
  lifecycle: active (but visibility hidden — available by negotiation only)
```

---

### 3. LICENSE

**Definition:** The contractual grant to a specific customer. A license binds a plan (or
custom selection of capabilities) to a customer for a specific term. It's the commercial
record of "what did we sell them, when, and for how long."

**Developer's intuition:** "The deal."

A license is the bridge between the abstract plan catalog and a specific customer's
concrete entitlements. A customer can hold multiple licenses (Trafficure license +
SmartMarket add-on license + Support add-on license).

**Key properties:**

| Property | Description |
|---|---|
| `license_id` | Unique identifier (e.g., "LIC-2024-0042") |
| `customer` | Which customer |
| `plan` | Which plan this license is for. Nullable for fully custom deals. |
| `type` | `subscription`, `perpetual`, `trial`, `internal`, `partner`, `nfr` (not for resale) |
| `status` | `trial`, `active`, `suspended`, `expired`, `cancelled`, `renewed` |
| `start_date` | When the license became active |
| `end_date` | When it expires (null for perpetual) |
| `auto_renew` | Whether it renews automatically |
| `entitlements` | The specific entitlements this license grants (see below) |
| `seats_purchased` | Number of seats purchased (if seat-based) |
| `contract_value` | Total contract value (ARR or TCV) |
| `payment_terms` | `prepaid-annual`, `quarterly`, `monthly`, `net-30`, `net-60` |
| `contract_document_url` | Link to the signed contract |
| `special_terms` | Any non-standard provisions (custom SLA, special pricing, etc.) |

**License lifecycle:**

```
trial → active → [renewing | expiring | suspended] → renewed | expired | cancelled
                       ↓
                   upgraded (moved to a higher plan)
                   downgraded (moved to a lower plan)
```

**Multiple licenses per customer:**

```
Customer: Samsung India
├── LICENSE: LIC-2024-0031 (Trafficure Enterprise, perpetual + annual maintenance)
│     status: active
│     entitlements: [all Trafficure capabilities]
│     seats: unlimited (per-organization)
│
├── LICENSE: LIC-2024-0032 (SmartMarket Professional, annual subscription)
│     status: active
│     entitlements: [SmartMarket capabilities]
│     seats: 15 named users
│
├── LICENSE: LIC-2024-0055 (Revenue Prediction add-on, custom contract)
│     status: active
│     entitlements: [Revenue Prediction capability]
│     special_terms: "Samsung-specific model. Generalization rights revert to Lepton."
│
└── LICENSE: LIC-2024-0033 (Priority Support, annual)
      status: active
      entitlements: [Priority Support, Dedicated Support Engineer]
```

---

### 4. ENTITLEMENT

**Definition:** A specific grant of access — either to a capability or to a resource
quantity. Entitlements are the atomic unit of "what this customer is allowed to do/use."
They live on a license and are the runtime-checkable facts that your application
enforces.

**Developer's intuition:** "What the license unlocks."

**Two flavors of entitlement:**

| Flavor | Description | Example |
|---|---|---|
| **Capability entitlement** | Access to use a specific capability | "Can use AI Data Analyst" |
| **Quantity entitlement** | A numeric allocation of a resource | "10,000 API calls per day" |

**Key properties:**

| Property | Description |
|---|---|
| `license` | Which license grants this |
| `type` | `capability-access` or `resource-quota` |
| `capability` | For capability entitlements: which capability is granted |
| `resource` | For quantity entitlements: which resource (see Quota) |
| `quantity` | For quantity entitlements: how much |
| `period` | For quantity entitlements: per what time window (`per-day`, `per-month`, `per-year`, `lifetime`, `unlimited`) |
| `enforcement` | How this is checked at runtime |
| `status` | `active`, `suspended`, `expired` |

**Enforcement types:**

| Type | Description |
|---|---|
| `hard-block` | Capability/resource is completely unavailable without entitlement. UI hides it, API returns 403. |
| `soft-limit` | Usage is metered and customer is warned when approaching limit. Exceeding triggers overage billing or throttling. |
| `advisory` | Entitlement is tracked but not enforced. Honor system. Common for early-stage products. |
| `deployment-gated` | The components for this capability are only deployed if the entitlement exists. No flag check needed — the code simply isn't there. |
| `config-gated` | The capability exists in the deployed code but is activated via configuration/feature flag tied to the entitlement. |

**Samsung's entitlements (resolved from their licenses):**

```
From LIC-2024-0031 (Trafficure Enterprise):
  ✓ Coverage Analysis (capability, deployment-gated)
  ✓ LOS Analysis (capability, deployment-gated)
  ✓ Network Planning (capability, deployment-gated)
  ✓ Project Management (capability, deployment-gated)
  ✓ RF Kit (capability, deployment-gated)
  ✓ Microwave Planning (capability, deployment-gated)
  ✓ SSO/SAML (capability, config-gated)
  ✓ API Access (capability, config-gated)
  ✓ API calls: unlimited (quantity, advisory)
  ✓ Storage: unlimited (quantity, advisory)
  ✓ Projects: unlimited (quantity, advisory)

From LIC-2024-0032 (SmartMarket Professional):
  ✓ Dataset Management (capability, deployment-gated)
  ✓ Map Exploration (capability, deployment-gated)
  ✓ AI Data Analyst (capability, deployment-gated)
  ✓ Reports & Analytics (capability, deployment-gated)
  ✓ AI queries: 1000/month (quantity, soft-limit)
  ✓ Datasets: unlimited (quantity, advisory)
  ✓ Seats: 15 named users (quantity, hard-block)

From LIC-2024-0055 (Revenue Prediction add-on):
  ✓ Revenue Prediction (capability, deployment-gated)

From LIC-2024-0033 (Priority Support):
  ✓ Priority Support (capability — affects SLA response times)
  ✓ Dedicated Support Engineer (capability — assigned person)
```

**The deployment resolution flow:**

```
Customer's entitlements (capability type, deployment-gated)
  → Collect all entitled capabilities
  → Resolve capability dependency graph (AI Analyst → Dataset Mgmt → Platform Core)
  → Collect depends_on_components from each capability
  → Deduplicate
  → Result: complete list of components to deploy

Customer's entitlements (capability type, config-gated)
  → These capabilities exist in already-deployed components
  → Generate feature flag / config overlay for the customer's deployment
  → Apply via config management (Vault, ConfigMap, env vars)
```

---

### 5. SEAT

**Definition:** A per-user allocation within a license. Seats track how many people (or
service accounts, or API keys) can use the product under a given license.

**Developer's intuition:** "A user slot."

**Seat models:**

| Model | Description | Enforcement |
|---|---|---|
| `named-user` | Each seat is assigned to a specific person. Reassignment possible with cooldown. | Auth system checks if the user has an assigned seat |
| `concurrent` | N users can be active simultaneously. Any user can log in; the Nth+1 is blocked. | Session manager tracks active sessions |
| `per-organization` | Unlimited users within the customer's org. No per-user tracking. | Org-level entitlement check only |
| `device` | Each seat is tied to a specific device or installation. | License key per device |
| `service-account` | Machine/API identity seats, separate from human user seats. | API key or service token validation |

**Key properties:**

| Property | Description |
|---|---|
| `license` | Which license this seat belongs to |
| `model` | From the model table above |
| `total` | Total seats purchased |
| `assigned` | Currently assigned/in-use |
| `available` | Remaining unassigned |
| `assignee` | For named-user: which Person entity holds this seat |
| `overage_policy` | What happens when seats are full: `block`, `allow-and-bill`, `notify-admin` |
| `reassignment_cooldown` | How often a named seat can be reassigned (prevents seat-sharing abuse) |

---

### 6. QUOTA

**Definition:** A numeric limit on a resource. Quotas are the constraints that shape
how a customer uses the product. They're defined on plans, granted via entitlements,
and tracked via usage.

**Developer's intuition:** "The limit."

**Common quota types:**

| Resource | Unit | Examples |
|---|---|---|
| `api-calls` | count per period | 10,000/day, 100,000/month, unlimited |
| `storage` | bytes | 50GB, 500GB, unlimited |
| `compute-minutes` | minutes per period | GPU minutes for model training |
| `ai-queries` | count per period | LLM queries for AI Data Analyst |
| `datasets` | count | Number of datasets in Dataset Management |
| `projects` | count | Number of planning projects |
| `reports` | count per period | Generated reports per month |
| `exports` | count per period | Data exports per month |
| `integrations` | count | Number of connected external systems |
| `environments` | count | Number of deployment environments |
| `webhooks` | count | Number of active webhook subscriptions |
| `concurrent-users` | count | Simultaneous active sessions |
| `data-retention` | days | How long historical data is kept |

**Key properties:**

| Property | Description |
|---|---|
| `resource` | What's being limited (from table above) |
| `limit` | The numeric cap. `-1` or `null` for unlimited. |
| `period` | Time window: `per-hour`, `per-day`, `per-month`, `per-year`, `lifetime`, `none` (absolute limit like storage) |
| `scope` | `per-seat`, `per-organization`, `per-deployment`, `per-project` |
| `enforcement` | `hard-block`, `soft-limit-then-throttle`, `soft-limit-then-bill`, `advisory` |
| `overage_rate` | If enforcement is bill: price per unit over the limit |
| `burst_allowance` | Short-term spike tolerance above the limit |

---

### 7. USAGE

**Definition:** Actual consumption of a resource tracked against a quota. Usage records
are the metering data that powers billing, capacity planning, and quota enforcement.

**Developer's intuition:** "How much they've actually used."

**Key properties:**

| Property | Description |
|---|---|
| `customer` | Who |
| `resource` | What resource (matching a quota resource type) |
| `period` | The time window this usage record covers |
| `quantity_consumed` | How much was used |
| `quota_limit` | What the limit was for this period |
| `percentage_consumed` | quantity / limit (for alerting) |
| `overage` | How much over the limit (if any) |
| `source` | Where this measurement came from: `api-gateway-metrics`, `storage-system`, `billing-agent` |
| `recorded_at` | Timestamp |

**Usage patterns that matter operationally:**

| Pattern | Description | Action |
|---|---|---|
| **Normal** | < 70% of quota | No action |
| **Warning** | 70-90% of quota | Notify customer and account manager |
| **Approaching limit** | 90-100% | Urgent notification, offer upgrade |
| **At limit** | 100% | Enforce policy: block, throttle, or bill overage |
| **Burst** | Brief spike > 100% | Allow within burst_allowance, then enforce |
| **Sustained overage** | Consistently over limit | Trigger plan upgrade discussion |

---

### 8. CREDIT

**Definition:** Pre-purchased or promotional consumption units that offset usage charges.
Credits are a currency within your product that can be applied against metered usage.

**Developer's intuition:** "Prepaid balance."

**Why credits exist:**

- **Prepaid usage:** Customer buys 10,000 AI query credits upfront at a discount.
- **Promotional:** "Sign up in Q1 and get 5,000 free API credits."
- **Compensation:** "Sorry about the outage — here's 1,000 credits."
- **Trial:** "Your trial includes 500 credits to try the AI features."
- **Commitment discount:** "Commit to ₹10L/year and get a 20% credit multiplier."

**Key properties:**

| Property | Description |
|---|---|
| `customer` | Who holds these credits |
| `type` | `prepaid`, `promotional`, `compensation`, `trial`, `commitment` |
| `resource` | What these credits apply to (or `general` for universal credits) |
| `amount_granted` | Total credits granted |
| `amount_remaining` | Current balance |
| `expires_at` | When unused credits expire (null for non-expiring) |
| `granted_at` | When issued |
| `granted_reason` | Why: "Q1 2025 promotion", "Incident INC-0042 compensation", "Annual prepay" |

---

## How It All Connects

### The Full Commercial Flow

```
CAPABILITY (what exists)
  └── defined in the product catalog
  └── depends on other capabilities and on components

PLAN (how it's packaged)
  └── bundles capabilities + quotas at a price point

LICENSE (what a customer bought)
  └── references a plan (or is custom)
  └── has a term, a status, and commercial details

ENTITLEMENT (what the license unlocks)
  ├── capability-access → enables features
  │     └── enforcement: entitlement-flag | config-gated | deployment-gated
  └── resource-quota → sets limits
        └── enforcement: hard-block | soft-limit | advisory

SEAT (who can use it)
  └── per-user allocations within a license

QUOTA (the limits)
  └── defined on plans, granted via entitlements, tracked via usage

USAGE (actual consumption)
  └── metered against quotas, triggers enforcement actions

CREDIT (prepaid/promotional balance)
  └── offsets usage charges
```

### Connecting to the Infrastructure Model (V3)

```
CAPABILITY "AI Data Analyst"
  depends_on_capabilities: ["Dataset Management"]
  depends_on_components: [ai-data-analyst-service, ai-data-analyst-ui]
       │
       └── COMPONENT "ai-data-analyst-service" (from V3 technical catalog)
             └── packaged as → ARTIFACT
                   └── deployed as → DEPLOYMENT
                         (only created if customer has this capability entitled
                          AND activation_type = deployment-gated)

ENTITLEMENT "Samsung has AI Data Analyst"
  type: capability-access
  enforcement: deployment-gated
  │
  └── means: ai-data-analyst-service MUST be deployed for Samsung
       └── DEPLOYMENT "ai-data-analyst-samsung-prod"
             component: ai-data-analyst-service
             tenant: samsung-india
             environment: production

ENTITLEMENT "Samsung has 1000 AI queries/month"
  type: resource-quota
  enforcement: soft-limit-then-bill
  │
  └── tracked by: USAGE records from api-gateway-metrics
  └── enforced by: rate limiter in traefik or application middleware
  └── offset by: any CREDITS Samsung holds for ai-queries
```

### Connecting to the Engagement Model

```
ENGAGEMENT "Samsung Implementation"
  └── scoped to → CAPABILITIES the customer is entitled to
                   (resolved from their LICENSE → ENTITLEMENTS)
  └── deploys → COMPONENTS required by those capabilities
                 (resolved from capability dependency graph)
  └── configures → QUOTAS and feature flags per the plan/entitlements
```

### Connecting to the Offering Model

The Offering (from the earlier commercial model) still exists as the distribution and
operations wrapper. But now:

- **Plan** determines *what* the customer gets (capabilities, quotas, seats)
- **Offering** determines *how* it's delivered (topology, operations model, update channel)
- **License** binds both to a specific customer

```
Customer: Samsung India

  Plan: "Lepton Intelligence Suite" (what they get)
    → capabilities, quotas, seats

  Offering: "Enterprise Managed" (how it's delivered)
    → managed-customer-cloud, vendor-managed, 24x7-critical SLA

  License: LIC-2024-0031 (the contractual binding)
    → plan + offering + customer + term + price + special terms
```

---

## The Capability Lifecycle (Revisited, Cleaner)

For your Revenue Prediction journey:

```
Phase 1: Customer-Specific
  CAPABILITY: "Revenue Prediction"
    lifecycle: experimental
    visibility: hidden
    depends_on_components: [revenue-prediction-service (Samsung-specific fork)]
    entitled to: [Samsung India] only
  
  No plan includes it. It's a direct entitlement on a custom license.

Phase 2: Beta
  CAPABILITY: "Revenue Prediction"
    lifecycle: beta
    visibility: hidden (available by request)
    depends_on_components: [revenue-prediction-service (generalized)]
    entitled to: [Samsung India, + early adopter customers]
  
  Still not on a plan. Individual entitlements granted to select customers.

Phase 3: GA as Add-On
  CAPABILITY: "Revenue Prediction"
    lifecycle: ga
    visibility: public
    depends_on_components: [revenue-prediction-service, revenue-prediction-ui]
  
  PLAN: "Revenue Prediction Add-On"
    type: add-on
    capabilities: [Revenue Prediction]
    pricing: per-seat-annual or usage-based
  
  Available on the pricing page. Any Enterprise customer can buy it.

Phase 4: Included in Suite
  PLAN: "Lepton Intelligence Suite" (updated)
    capabilities: [...existing..., Revenue Prediction]
  
  Now included in the top-tier plan. Still available as add-on for lower tiers.
```

---

## What's NOT in This Model (and Why)

**Billing / Invoicing / Payment Processing:** This model stops at "what was sold and
what's consumed." The actual invoicing, payment collection, dunning, and revenue
recognition is the domain of your billing system (Stripe Billing, Chargebee, Zuora, or
custom). This model provides the inputs to billing, not the billing itself.

**Pricing algorithms:** Dynamic pricing, volume discounts, commitment discount schedules,
and negotiated enterprise pricing live in your pricing engine or CRM. The Plan entity
captures the structure, not the calculation.

**Customer success / health scoring:** While we track contract status and usage patterns,
a full customer health model (NPS, feature adoption depth, support ticket sentiment) is
a separate concern.

---

## Updated Entity Count

**Commercial Packaging: 8 entities** (this document)
- Capability, Plan, License, Entitlement, Seat, Quota, Usage, Credit

**Commercial Operations: 5 entities** (from earlier document, revised)
- Product, Offering, Customer, Engagement, Initiative
- (Account is optional, = Customer for most cases)

**Technical Catalog: 7 entities** (from V3)
- Domain, System, Component, API, Artifact, Release Bundle, Template

**Infrastructure: 6 entities** (from V3)
- Substrate, Host, Workspace, Runtime, Network Entity

**Operational: 5 entities** (from V3)
- Deployment, Workload, Managed Dependency, Data Store, Secret

**Organizational: 2 entities**
- Team, Person

**Total: 33 entities across the full model**

But in daily conversation, most developers interact with about 8 of these regularly:
Capability, Component, Deployment, Host, Customer, Engagement, Entitlement, and Team.
The rest are structural entities that the system tracks but humans rarely name in
conversation.
