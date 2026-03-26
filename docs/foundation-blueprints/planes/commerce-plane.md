# Product Requirements Document

# **Commerce Plane (Factory-Level Commercial Governance)**

---

# 1. Purpose

The Commerce Plane is the commercial system of record inside the Factory.

It is responsible for:

- Customer account management
- Partner and MSP relationships
- Pricing plans and tiers
- Licensing
- Entitlement generation and signing
- Subscription lifecycle
- Trial lifecycle
- Usage metering and aggregation
- Billing and invoicing
- Payment collection
- Revenue attribution

It does **not**:

- Provision Sites or namespaces (Fleet Plane)
- Enforce entitlements at runtime (Control Plane)
- Manage infrastructure or deployment (Infrastructure Plane / Fleet Plane)
- Implement product-specific business logic (Service Plane)

Commerce Plane answers the question: **who gets what, through whom, at what price.**

---

# 2. Design Principles

1. One customer account across all products.
2. Entitlement is the contract between commercial model and fleet operations.
3. Entitlement state machine governs all lifecycle transitions.
4. Commerce triggers Fleet — never the reverse.
5. All commercial state changes emit events.
6. Site runtime must never depend on live Commerce connectivity.
7. Partner and direct channels coexist without conflict.
8. Build the entitlement engine. Buy everything else.

---

# 3. Core Concepts

## 3.1 Customer Account

The buyer entity.

- One account per customer across all products.
- May be a direct customer or a partner-managed customer.
- Owns subscriptions, licenses, and billing relationships.
- Not the same as a principal (identity) — a customer account is a commercial entity, not a runtime identity.

---

## 3.2 Partner Account

A channel entity that manages customers on behalf of the company.

Types:

- MSP (Managed Service Provider)
- Reseller
- SI (Systems Integrator)

A partner account:

- Owns customer accounts (commercially)
- May operate Sites (if partner-hosted)
- Has its own billing relationship with the company
- Bills its own customers independently

---

## 3.3 Subscription

A commercial agreement between the company and a customer.

- Bound to a customer account.
- References a pricing plan.
- Has a billing cycle.
- Produces invoices.
- May include add-ons.

---

## 3.4 License

A deployable authorization record.

- Bound to a subscription.
- Scoped to one or more Sites.
- Contains module entitlements, seat limits, and quota definitions.
- Produces signed entitlement bundles for delivery to Sites.

---

## 3.5 Entitlement Bundle

A signed, portable blob delivered to a Site.

- Contains all entitlement items (modules, seats, quotas, feature flags, expiry).
- Signed by Commerce Plane.
- Validated by Site Control Plane.
- Must be interpretable offline (air-gapped Sites).
- Immutable once signed — updates produce new bundles.

---

## 3.6 Entitlement Item

A single line item within an entitlement bundle.

Types:

- Module enablement (e.g., geoanalytics: enabled)
- Seat limit (e.g., seats: 120)
- Quota definition (e.g., storage: 5TB)
- Feature flag (e.g., advanced_analytics: true)
- Expiry constraint (e.g., expires: 2026-03-01)

---

## 3.7 Usage Record

An aggregated metering event.

- Attributed to a subscription, Site, and optionally a namespace.
- Used for billing, quota enforcement, and analytics.
- Collected from Site telemetry.
- Aggregated before billing.

---

# 4. Functional Requirements

---

## 4.1 Customer Account Management

### 4.1.1 Account Creation

Support:

- Self-serve signup (product-led)
- Sales-assisted creation (PO-based)
- Partner-initiated creation (MSP/reseller)

Account must include:

- account_id
- account_name
- account_type (direct / partner-managed)
- billing_contact
- created_at
- lifecycle_state

### 4.1.2 Multi-Product Account Model

A customer signs up once and gets one account. Products are added as additional entitlements.

Example: Samsung buys Trafficure today, adds NetworkAccess next year — same account, same billing relationship, additional entitlement.

### 4.1.3 Account Lifecycle States

- active
- suspended (payment failure)
- terminated
- merged (duplicate resolution)

---

## 4.2 Pricing and Plans

### 4.2.1 Plan Definition

Each product has one or more pricing plans.

A plan defines:

- plan_id
- product_id
- plan_name
- plan_tier (trial / starter / pro / business / enterprise)
- billing_interval (monthly / annual)
- base_price
- included_seats
- included_quotas
- enabled_modules
- feature_flags

### 4.2.2 Add-ons

Add-ons extend a plan.

- addon_id
- addon_name
- addon_type (module / seats / quota / support)
- price
- quantity_model (flat / per-unit / tiered)

Relationship: plan N—M addon.

### 4.2.3 Custom Pricing

Enterprise contracts may override standard plan pricing.

- Custom seat pricing
- Custom quota limits
- Custom module bundles
- Volume discounts
- Multi-year terms

Custom pricing is stored as contract overrides, not as new plans.

---

## 4.3 Subscription Management

### 4.3.1 Subscription Creation

Triggers:

- Self-serve signup → trial subscription
- Self-serve conversion → paid subscription
- Sales close → enterprise subscription
- Partner deal → partner-managed subscription

### 4.3.2 Subscription Lifecycle

States:

- trialing
- active
- past_due (grace period)
- restricted (read-only)
- suspended (access revoked, data preserved)
- cancelled
- terminated (data deleted per retention policy)

State transitions must:

- Emit events
- Trigger Fleet Plane actions
- Be auditable

### 4.3.3 Subscription Modifications

Supported modifications:

- Plan upgrade
- Plan downgrade
- Add-on addition
- Add-on removal
- Seat count change
- Quota increase
- Module enablement
- Module removal

All modifications must:

- Recalculate billing
- Generate updated entitlement bundle
- Notify Fleet Plane
- Be prorated where applicable

---

## 4.4 Trial Lifecycle

### 4.4.1 Trial Creation

Triggered by self-serve signup.

Trial parameters:

- trial_duration (default: 14 days)
- trial_modules (subset of full product)
- trial_seats (default: 5)
- trial_quotas (reduced limits)

### 4.4.2 Trial States

- active
- extended (sales-initiated)
- converted (to paid)
- expired

### 4.4.3 Trial to Paid Conversion

Seamless — no data migration, no Site change.

- Customer stays in the same shared Site.
- Commerce updates the entitlement.
- Fleet updates module access.
- Invisible transition from customer perspective.

### 4.4.4 Trial Expiry

On expiry:

- Access restricted (read-only)
- Data preserved for configurable period (default: 30 days)
- After retention period: data deleted, namespace decommissioned

---

## 4.5 Entitlement Engine

This is the only piece of Commerce Plane that must be custom-built. It is the contract between the commercial model and Fleet operations.

### 4.5.1 Entitlement Generation

On any commercial state change, Commerce Plane must:

1. Compute effective entitlements from subscription + plan + add-ons + overrides.
2. Generate a new entitlement bundle.
3. Sign the bundle.
4. Deliver the bundle to the target Site(s) via Fleet Plane.

### 4.5.2 Entitlement Bundle Structure

```
entitlement_bundle:
  bundle_id: uuid
  license_id: uuid
  site_id: uuid
  issued_at: timestamp
  expires_at: timestamp
  signature: bytes

  items:
    modules:
      - module_id: geoanalytics
        enabled: true
      - module_id: kpi
        enabled: true
      - module_id: coverage
        enabled: true

    seats:
      limit: 120
      model: unique_active_principals

    quotas:
      storage_gb: 5000
      compute_hours: 2000
      api_calls_monthly: 1000000
      assistant_runs_monthly: 50000
      dataset_count: 500

    feature_flags:
      advanced_analytics: true
      custom_dashboards: true
      white_label: false

    restrictions:
      state: active
      grace_period_days: 30
```

### 4.5.3 Entitlement Signing

Bundles must be:

- Signed with a key managed by Commerce Plane
- Verifiable by Site Control Plane without live connectivity
- Timestamped
- Versioned (Sites must accept only bundles newer than current)

### 4.5.4 Entitlement State Machine

Every entitlement has explicit states with defined transitions:

```
trial → active (conversion)
trial → expired (timeout)
active → active (modification)
active → past_due (payment failure)
past_due → active (payment received)
past_due → restricted (grace period exceeded)
restricted → active (payment received)
restricted → suspended (extended non-payment)
suspended → active (payment received + reactivation)
suspended → terminated (customer request or policy)
active → cancelled (customer request)
cancelled → terminated (retention period expired)
```

Each transition has:

- Entry conditions
- Exit conditions
- Side effects (Fleet notifications, billing adjustments)
- Audit record

### 4.5.5 Offline Entitlement Validation

For air-gapped and disconnected Sites:

- Entitlement bundles must be self-contained.
- Signature verification must work without network access.
- Expiry enforcement must work with local clock.
- License renewal bundles must be deliverable via offline media.

---

## 4.6 Billing and Invoicing

### 4.6.1 Billing Model

Support:

- Flat-rate billing (per plan)
- Per-seat billing
- Usage-based billing (metered)
- Hybrid (base + usage)
- Prepaid credits

### 4.6.2 Invoice Generation

Invoices must include:

- invoice_id
- customer_account_id
- subscription_id
- billing_period
- line_items (plan, seats, usage, add-ons)
- taxes (if applicable)
- total
- due_date
- payment_status

### 4.6.3 Payment Processing

Integrate with payment processor (Stripe recommended).

Support:

- Credit card
- ACH / bank transfer
- Wire transfer (enterprise)
- Partner billing (MSP pays, MSP bills customer)

### 4.6.4 Payment Failure Handling (Dunning)

```
Payment fails
  → Retry (automatic, configurable schedule)
  → Notify customer
  → Grace period (runs normally, default: 7 days)
  → Restricted mode (read-only, default: after 14 days)
  → Suspended (access revoked, data preserved, default: after 30 days)
  → Terminated (data deleted per retention policy, default: after 90 days)
```

Each stage must:

- Emit events to Fleet Plane
- Be configurable per plan tier
- Be overridable by sales (enterprise)
- Be auditable

---

## 4.7 Usage Metering

### 4.7.1 Metered Dimensions

- Storage (GB)
- Compute (job runtime hours)
- API calls (monthly)
- Assistant runs (monthly)
- Tile generation (count)
- Dataset count
- Active seats

### 4.7.2 Metering Pipeline

```
Site telemetry
  → Usage event emitted
  → Aggregated at Site
  → Reported to Factory (connected) or exported (air-gapped)
  → Commerce Plane ingests
  → Usage record created
  → Attributed to subscription
  → Available for billing
```

### 4.7.3 Usage Attribution

Usage must be attributable to:

- customer_account_id
- subscription_id
- site_id
- namespace_id (optional)
- module_id (optional)
- billing_period

### 4.7.4 Overage Handling

Options (configurable per plan):

- Hard cap (reject requests beyond quota)
- Soft cap (allow, bill overage)
- Alert-only (notify, no enforcement)
- Auto-upgrade (trigger plan upgrade)

---

## 4.8 Partner and MSP Model

### 4.8.1 Partner Account Structure

```
partner_account
  partner_id
  partner_name
  partner_type (MSP / reseller / SI)
  partner_tier (optional, Phase 3)
  billing_relationship
  commission_model (optional, Phase 3)
```

### 4.8.2 Partner-Customer Relationship

```
MSP: TechServ India
├── Customer: Samsung
│   ├── Entitlement: Trafficure Pro
│   └── Tenant in: SaaS Site India
├── Customer: Indus Towers
│   ├── Entitlement: Trafficure Enterprise
│   └── Dedicated Site: Indus Site
└── Billing: TechServ pays company, TechServ bills customers

Direct Customer: Abu Dhabi DOT
├── Entitlement: Trafficure Enterprise
├── Dedicated Site: Abu Dhabi Site (air-gapped)
└── Billing: Direct
```

### 4.8.3 Channel Conflict Resolution

When a customer self-serves while a partner is working the deal:

- Attribution logic must determine ownership.
- Duplicate detection must flag overlaps.
- Merge policies must resolve conflicts.
- Sales override must be available.

---

## 4.9 Commerce-Fleet Interaction

Commerce Plane triggers Fleet Plane on every commercial state change. Fleet Plane never triggers Commerce Plane.

```
Commerce Plane                Fleet Plane              Site
│                             │                        │
│ Customer signs up           │                        │
│ Plan selected               │                        │
│ Entitlement created ──────► │ Assign tenant ────────► │ Tenant active
│                             │ (shared site)          │
│ Customer upgrades           │                        │
│ Entitlement updated ──────► │ Update modules ───────► │ New modules live
│                             │                        │
│ Payment fails               │                        │
│ Grace period ─────────────► │ No action              │ Runs normally
│ Restricted mode ──────────► │ Restrict tenant ──────► │ Read-only
│ Suspended ────────────────► │ Suspend tenant ───────► │ Site down, data preserved
│ Terminated ───────────────► │ Decommission ─────────► │ Data deleted per policy
```

### 4.9.1 Event Contract

Commerce emits the following events to Fleet:

- `entitlement.created`
- `entitlement.updated`
- `entitlement.restricted`
- `entitlement.suspended`
- `entitlement.terminated`
- `entitlement.renewed`
- `subscription.created`
- `subscription.upgraded`
- `subscription.downgraded`
- `subscription.cancelled`
- `trial.created`
- `trial.extended`
- `trial.converted`
- `trial.expired`

Each event must include:

- event_id
- event_type
- customer_account_id
- subscription_id
- license_id
- entitlement_bundle (for create/update events)
- timestamp

---

## 4.10 Self-Serve Flows

### 4.10.1 First-Time Customer

1. Customer visits product site, clicks "Start free trial."
2. Redirected to Commerce signup (branded per product).
3. Commerce creates customer account and trial entitlement.
4. Commerce triggers Fleet Plane.
5. Fleet assigns tenant in existing shared Site (near-instant).
6. Customer redirected to their product tenant.

No Site provisioning needed for trials. Tenant assignment in a shared Site is a database insert, not infrastructure provisioning.

### 4.10.2 Existing Customer Adds Product

1. Customer visits second product site, clicks "Start free trial."
2. Logs in with existing account.
3. Commerce recognizes customer, adds new product trial entitlement to same account.
4. Fleet assigns tenant in a product-specific shared Site.
5. One customer, two products, one bill.

### 4.10.3 Trial to Paid Conversion

Seamless — customer was a tenant in the shared Site during trial, remains a tenant after converting. Commerce updates entitlement, Fleet updates module access. No migration.

### 4.10.4 Shared to Dedicated Migration

Rare, high-value event. Not self-serve.

- Sales team involved, implementation timeline agreed.
- Commerce updates license with deployment_type: DEDICATED.
- Fleet provisions dedicated Site, migrates data and configuration.

---

# 5. Non-Functional Requirements

## Scalability

- 10,000+ customer accounts
- 100,000+ subscriptions
- 1,000,000+ usage records per billing period
- Real-time entitlement generation (< 5 seconds)

## Reliability

- Billing and payment processing must be idempotent.
- Entitlement generation must be atomic.
- No duplicate invoices under any failure mode.
- No duplicate charges under any retry scenario.

## Auditability

- Full audit trail on all commercial state changes.
- Immutable event log.
- Compliance-ready export.

## Security

- Entitlement signing keys must be rotated.
- Payment data must never touch Commerce Plane directly (delegated to payment processor).
- PCI compliance via Stripe (or equivalent).
- Customer financial data encrypted at rest.

## Availability

- Commerce Plane downtime must not affect running Sites.
- Sites must operate on cached entitlement bundles.
- Billing can tolerate brief outages (batch reconciliation).

---

# 6. API Surface (High-Level)

Core services:

- /accounts/\*
- /partners/\*
- /plans/\*
- /addons/\*
- /subscriptions/\*
- /licenses/\*
- /entitlements/\*
- /entitlements/sign
- /entitlements/deliver
- /usage/\*
- /invoices/\*
- /payments/\*
- /trials/\*
- /webhooks/\* (Stripe callbacks)

Internal services (Factory-internal):

- /internal/entitlements/compute
- /internal/usage/ingest
- /internal/billing/reconcile

---

# 7. Data Model (Conceptual)

- customer_account
- partner_account
- partner_customer (join)
- product_sku
- plan
- addon
- plan_addon (join)
- price
- contract (optional, enterprise)
- subscription
- subscription_addon (join)
- license
- entitlement_bundle
- entitlement_item
- quota_definition
- feature_flag
- usage_record
- invoice
- invoice_line_item
- payment
- overage_event
- dunning_event
- commercial_audit_log

---

# 8. Key Relationships

```
customer_account 1—N subscription
partner_account 1—N customer_account (via partner_customer)
product_sku 1—N plan
plan N—M addon
plan 1—N quota_definition
subscription 1—N license
license 1—N entitlement_bundle
entitlement_bundle 1—N entitlement_item
entitlement_item N—1 module OR N—1 feature_flag
subscription 1—N invoice
invoice 1—N invoice_line_item
invoice 1—N payment
usage_record N—1 subscription
usage_record N—1 site
usage_record N—1 namespace (optional)
license N—1 site (delivered to)
```

---

# 9. Build vs. Buy Guidance

| Capability              | Recommendation                        | Rationale                                                                                                                                                |
| ----------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entitlement engine      | Build                                 | Core differentiator bridging commercial model to fleet operations. No off-the-shelf solution handles module-level entitlements + signed offline bundles. |
| Entitlement signing     | Build                                 | Tight coupling to license and deployment model.                                                                                                          |
| Billing and payments    | Buy (Stripe)                          | Solved problem. PCI compliance included.                                                                                                                 |
| Invoice generation      | Buy (Stripe)                          | Stripe Billing handles invoicing.                                                                                                                        |
| Dunning                 | Buy (Stripe)                          | Stripe handles retry logic and notifications.                                                                                                            |
| CRM / customer accounts | Buy or integrate                      | Salesforce, HubSpot, or lightweight internal.                                                                                                            |
| Usage metering          | Build (ingestion) + Buy (aggregation) | Custom ingestion pipeline, but Stripe metered billing for aggregation.                                                                                   |
| Tax calculation         | Buy                                   | Stripe Tax or equivalent.                                                                                                                                |
| Partner portal          | Build (Phase 2-3)                     | Custom requirements around entitlement visibility and customer management.                                                                               |

---

# 10. Phased Delivery

## Phase 1 — Launch

- Customer accounts (direct only)
- 2-3 pricing plans per product
- Trial lifecycle (create, convert, expire)
- Entitlement engine (generate, sign, deliver)
- Stripe integration (billing, payments, invoicing)
- Subscription lifecycle (create, upgrade, cancel)
- Basic usage metering (seats, storage)
- Commerce → Fleet event pipeline

## Phase 2 — Scale

- Partner and MSP accounts
- Partner-managed customer relationships
- Channel conflict resolution
- Usage metering (all dimensions)
- Usage-based billing
- Dunning and payment failure handling
- Customer self-serve portal
- Multi-currency support
- Overage handling
- Onboarding orchestration (automated Fleet triggers)

## Phase 3 — Enterprise Maturity

- CPQ (configure, price, quote)
- Contract management and custom SLAs
- Revenue recognition (ASC 606)
- Marketplace integrations (AWS, Azure)
- Partner tiers and programs
- White-labeling support
- Customer health scoring and churn prediction
- Tax calculation across jurisdictions
- Expansion triggers and upsell automation
- Offboarding workflows and data retention policies
- Commercial audit trail (compliance-ready)
- Partner portal

---

# 11. Success Criteria

- Trial-to-tenant assignment < 10 seconds (self-serve signup to usable product).
- Entitlement bundle generation < 5 seconds on any commercial state change.
- Zero duplicate invoices or charges under any failure mode.
- Entitlement state machine transitions fully auditable.
- Air-gapped Sites operate on signed bundles without live Commerce connectivity.
- Multi-product accounts work seamlessly (one customer, multiple products, one bill).
- Partner-managed customers billable through partner without custom workflows.
- Payment failure degradation path enforced automatically (grace → restricted → suspended → terminated).

---

# 12. Explicit Boundaries

Commerce Plane does not:

- Provision Sites or namespaces (Fleet Plane)
- Enforce entitlements at runtime (Site Control Plane)
- Manage deployment lifecycle (Fleet Plane)
- Provision infrastructure (Infrastructure Plane)
- Contain product-specific business logic (Service Plane)
- Store or process payment card data directly (delegated to Stripe)
- Manage user identity or authentication (Control Plane)

Commerce Plane does own:

- The commercial relationship with every customer and partner.
- The authoritative source for what every customer is entitled to.
- The signed entitlement bundles that Sites consume.
- The billing and invoicing lifecycle.
- The pricing model for every product.

---

# 13. Open Questions

1. **Entitlement bundle format.** JSON with JWS signature vs. custom binary format? JSON is debuggable and portable. Binary is more compact for air-gapped delivery.
2. **Usage metering granularity.** Hourly vs. daily aggregation? Hourly enables real-time dashboards but increases storage. Daily is sufficient for billing.
3. **Partner billing model.** Does the company bill partners who then bill customers? Or does the company bill customers directly with partner commission? Both models need support eventually — which is Phase 2 priority?
4. **Multi-currency timing.** Is multi-currency required for Phase 1 launch if initial customers are in India and Middle East?
5. **Entitlement bundle delivery for air-gapped.** Physical media? One-way data diode? Signed USB? Needs alignment with Infrastructure Plane air-gapped story.
6. **Customer account merging.** When a self-serve customer is later acquired by a partner deal, how does account merge work? What happens to billing history?
7. **Marketplace entitlement mapping.** AWS Marketplace and Azure Marketplace have their own entitlement models. How do these map to internal entitlement bundles?

---

# 14. Key Services

```
factory-commerce-api
factory-commerce-entitlement-api
factory-commerce-billing-worker
factory-commerce-usage-worker (Phase 2)
factory-commerce-partner-api (Phase 2)
factory-commerce-metering-ingest (Phase 2)
```

---

# Final Definition

The Commerce Plane is the authoritative commercial governance layer at the Factory level.

It manages:

- Customer and partner relationships
- Pricing and plans
- Subscriptions and licensing
- Entitlement generation and signing
- Billing and payment collection
- Usage metering and attribution

It produces signed entitlement bundles that flow through Fleet Plane to Site Control Planes, enabling every Site — SaaS, dedicated, self-hosted, or air-gapped — to know exactly what each customer is allowed to use, without depending on live Commerce connectivity.

It is the commercial brain of the Factory, not the runtime enforcer and not the deployment orchestrator.
