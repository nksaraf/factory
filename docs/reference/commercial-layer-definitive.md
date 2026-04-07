# The Commercial Layer — Definitive Model

## Three concerns, cleanly separated

### Grounded in Stripe, Lago, Chargebee, Zuora, and real SaaS billing primitives

---

## The Three Concerns

Every SaaS company's commercial layer is actually three independent systems that
interact:

```
1. PRODUCT CATALOG  — What exists and what it does
2. PRICE CATALOG    — How things cost
3. CUSTOMER STATE   — What a specific customer has, uses, and owes
```

Previous versions of our model tangled these together. This revision separates them
cleanly, following the same separation that Stripe, Lago, and every mature billing
platform has converged on independently.

---

## Concern 1: PRODUCT CATALOG

*What exists. What it does. What it depends on.*

This is YOUR system, not the billing system. The billing platform doesn't know or care
about your technical architecture. The product catalog is the bridge between what
sales sells, what engineering builds, and what the billing system charges for.

### Entities

#### PRODUCT

The market-facing thing with a brand, a logo, a pricing page, and a sales team.

This is NOT Stripe's "Product" (which is much more granular). This is what a customer
sees on your website and what a salesperson pitches.

| Property | Description |
|---|---|
| `name` | "Trafficure", "SmartMarket" |
| `description` | Market-facing value proposition |
| `owner_team` | Product management team |
| `lifecycle` | `incubation`, `growth`, `mature`, `sunset` |
| `realized_by_systems` | Links to Systems in the technical catalog (V3) |

You have 2-5 of these. Maybe 10 in a decade. This entity rarely changes.

#### CAPABILITY

The unit of functionality within a product. The thing that can be independently enabled,
disabled, sold, or metered. This maps to what Stripe calls a "Product" and what Lago
calls a component of a "Plan."

The critical insight from Stripe: **a Capability is the smallest thing you can
independently price.** Not the smallest thing you can build (that's a Component).
Not the biggest thing you sell (that's a Product). The thing in between.

| Property | Description |
|---|---|
| `name` | "Coverage Analysis", "AI Data Analyst", "SSO", "API Access", "Priority Support" |
| `product` | Which Product this belongs to. Null for platform capabilities. |
| `type` | `feature`, `integration`, `compute`, `data`, `support`, `infrastructure` |
| `description` | What this provides |
| `depends_on` | Other Capabilities this requires |
| `requires_components` | Technical Components (from V3) needed to deliver this |
| `activation` | How enabling manifests: `flag`, `config`, `deploy`, `independent` |
| `metered_dimensions` | What usage can be measured: null (unmetered) or list of Billable Metrics |
| `visibility` | `listed` (on pricing page), `unlisted` (available but not advertised), `internal` (infrastructure, never sold) |
| `lifecycle` | `experimental`, `beta`, `ga`, `deprecated` |
| `owner_team` | Engineering team that builds this |

**Key relationships:**

```
CAPABILITY "Coverage Analysis"
  ├── depends_on: [CAPABILITY "RF Engine"]
  ├── requires_components: [coverage-service, coverage-ui]  ← links to V3 Component
  ├── metered_dimensions: [BILLABLE METRIC "projects-created"]
  └── product: Trafficure

CAPABILITY "AI Data Analyst"
  ├── depends_on: [CAPABILITY "Dataset Management"]
  ├── requires_components: [ai-data-analyst-service, ai-data-analyst-ui]
  ├── metered_dimensions: [BILLABLE METRIC "ai-queries"]
  └── product: SmartMarket

CAPABILITY "Platform Core" (internal — never sold, always deployed)
  ├── depends_on: []
  ├── requires_components: [core-shell, traefik, ory-kratos, ory-hydra, spicedb, postgres]
  ├── metered_dimensions: null
  └── visibility: internal
```

#### BILLABLE METRIC

Borrowed directly from Lago. A billable metric defines **what you measure** — completely
independent of how you charge for it. The same metric can be priced differently in
different Plans.

This is what Stripe calls a "Meter."

| Property | Description |
|---|---|
| `name` | "ai-queries", "api-calls", "storage-gb", "projects-created", "seats" |
| `code` | Machine-readable: `ai_queries`, `api_calls` |
| `description` | What's being measured |
| `aggregation` | How events are combined: `count`, `sum`, `max`, `count-distinct`, `latest` |
| `field` | Which field in the event to aggregate (for sum/max) |
| `dimensions` | Optional tags for segmentation: `model`, `region`, `event_type` |
| `unit` | Human-readable unit: "queries", "calls", "GB", "seats", "minutes" |

**Examples:**

```
BILLABLE METRIC: "ai-queries"
  aggregation: count
  unit: "queries"
  dimensions: [model]  ← allows pricing per LLM model later

BILLABLE METRIC: "api-calls"
  aggregation: count
  unit: "calls"
  dimensions: [endpoint, method]

BILLABLE METRIC: "storage"
  aggregation: max
  unit: "GB"

BILLABLE METRIC: "active-seats"
  aggregation: count-distinct
  field: "user_id"
  unit: "users"
```

**Why separate Billable Metrics from Capabilities?** Because the same Capability can
have multiple metered dimensions (AI Data Analyst might meter both "ai-queries" and
"ai-compute-minutes"). And the same metric might apply across Capabilities (both
Coverage and Planning might count "projects-created"). Separation keeps things composable.

---

## Concern 2: PRICE CATALOG

*How things cost. How they're packaged. How they're billed.*

This is what lives in your billing system (Stripe, Lago, or custom). The price catalog
references Capabilities and Billable Metrics from the product catalog but adds pricing
logic.

### Entities

#### PLAN

A named, versioned packaging of Capabilities with associated pricing. This is Stripe's
"a set of Products with Prices" grouped logically, or Lago's "Plan" directly.

| Property | Description |
|---|---|
| `name` | "Trafficure Starter", "SmartMarket Professional", "Lepton Suite" |
| `code` | Machine-readable: `trafficure_starter`, `smartmarket_pro` |
| `type` | `base` (standalone), `add-on` (supplements a base plan), `suite` (multi-product) |
| `products` | Which Products this plan covers |
| `version` | Plan version (plans evolve; old versions may be grandfathered) |
| `lifecycle` | `active`, `grandfathered`, `sunset` |

A Plan contains **Line Items** — the individual priced components.

#### LINE ITEM

A single priced element within a Plan. Each line item grants access to a Capability
and/or defines a charge. This is Stripe's "Price" attached to a "Product" within a
Subscription.

| Property | Description |
|---|---|
| `plan` | Which Plan this belongs to |
| `capability` | Which Capability this grants/charges for. Nullable for pure fees. |
| `name` | Display name on invoice: "Coverage Analysis", "Platform Fee", "AI Queries" |
| `charge_type` | See charge types below |
| `billing_period` | `monthly`, `annual`, `one-time`, `per-billing-period` |
| `amount` | Fixed amount (for flat charges) |
| `per_unit_amount` | Per-unit cost (for per-seat, per-usage) |
| `metric` | Which Billable Metric drives this charge (for usage-based) |
| `tiers` | For graduated/volume pricing (see below) |
| `included_units` | Free units included before charging starts |
| `minimum_spend` | Minimum charge regardless of usage |
| `maximum_spend` | Cap on charges (price ceiling) |

**Charge types** (how billing platforms universally categorize charges):

| Type | Description | Example |
|---|---|---|
| `flat` | Fixed recurring amount | "Platform Fee: ₹10,000/month" |
| `per-seat` | Per named user or concurrent user | "₹1,500/user/month" |
| `per-unit` | Per metered unit consumed | "₹2 per AI query" |
| `tiered-graduated` | Different rates for different usage ranges, each tier priced independently | "First 100 queries free, next 900 at ₹2, above 1000 at ₹1" |
| `tiered-volume` | Single rate determined by total volume | "Under 1000 queries: ₹2 each. Over 1000: ₹1.50 each (for ALL)" |
| `package` | Per bundle of units | "₹500 per 100 queries" |
| `percentage` | Percentage of a value | "2.9% of transaction value" |
| `one-time` | Single charge, not recurring | "Implementation fee: ₹5,00,000" |

**Example Plan with Line Items:**

```
PLAN: "Trafficure Professional"
  type: base
  products: [Trafficure]
  version: 2024.1

  LINE ITEMS:
  ┌──────────────────────────┬──────────────┬────────────────────────────────┐
  │ Name                     │ Charge Type  │ Details                        │
  ├──────────────────────────┼──────────────┼────────────────────────────────┤
  │ Platform Fee             │ flat         │ ₹50,000/month                  │
  │ Coverage Analysis        │ (included)   │ Grants capability, no extra $  │
  │ LOS Analysis             │ (included)   │ Grants capability, no extra $  │
  │ Network Planning         │ (included)   │ Grants capability, no extra $  │
  │ User Seats               │ per-seat     │ ₹1,500/user/month, 10 included│
  │ Projects                 │ per-unit     │ 20 included, ₹5,000 each above│
  │ API Access               │ per-unit     │ 50,000 calls/month included,   │
  │                          │              │ ₹0.50 per 1000 above           │
  │ Storage                  │ tiered-grad  │ 100GB included, ₹500/GB above  │
  │ SSO Integration          │ (included)   │ Grants capability              │
  └──────────────────────────┴──────────────┴────────────────────────────────┘

PLAN: "AI Data Analyst Add-On"
  type: add-on
  products: [SmartMarket]
  version: 2025.1

  LINE ITEMS:
  ┌──────────────────────────┬──────────────┬────────────────────────────────┐
  │ AI Data Analyst Access   │ flat         │ ₹25,000/month                  │
  │ AI Queries               │ tiered-grad  │ 500 included,                  │
  │                          │              │ 501-2000: ₹50/query            │
  │                          │              │ 2001+: ₹30/query               │
  └──────────────────────────┴──────────────┴────────────────────────────────┘
```

**Notice what this does:** The Plan's line items simultaneously define:
- **Which capabilities are granted** (Coverage, LOS, Planning, SSO, API Access)
- **What the customer pays** (flat fees + per-seat + usage-based)
- **What limits exist** (10 included seats, 20 included projects, 50k API calls)

This is the elegance of the Stripe/Lago model: **the line item IS the entitlement AND
the charge in one entity.** You don't need a separate Entitlement entity in the price
catalog — the existence of a line item in an active subscription IS the entitlement.

#### COUPON

A discount that can be applied to a subscription or invoice.

| Property | Description |
|---|---|
| `name` | "Q1 Launch Discount", "Loyalty Renewal" |
| `type` | `percentage`, `fixed-amount` |
| `value` | 20 (meaning 20% or ₹20, depending on type) |
| `applies_to` | Specific plans, specific line items, or everything |
| `duration` | `once`, `repeating` (N months), `forever` |
| `expiry` | When this coupon can no longer be redeemed |
| `max_redemptions` | How many customers can use this |

#### ADDON CHARGE

A one-time, non-recurring charge that can be applied to a customer at any time,
independent of their subscription. Lago calls these "Add-ons" (the one-time kind),
Stripe handles them as Invoice Items.

| Property | Description |
|---|---|
| `name` | "Implementation Fee", "Custom Integration", "Training Session", "Data Migration" |
| `amount` | Charge amount |
| `tax_behavior` | `inclusive`, `exclusive` |

These map directly to Engagement costs — when you charge for a professional services
engagement, it's an addon charge on the customer's account.

---

## Concern 3: CUSTOMER STATE

*What a specific customer has. What they use. What they owe.*

### Entities

#### CUSTOMER

The paying entity. One record per commercial relationship.

| Property | Description |
|---|---|
| `name` | "Samsung India", "Ultratech Cement" |
| `type` | `enterprise`, `mid-market`, `self-service`, `internal`, `trial`, `partner` |
| `billing_email` | For invoices |
| `billing_address` | For tax calculation |
| `currency` | `INR`, `USD`, etc. |
| `payment_method` | Reference to payment method on file |
| `tax_id` | GST number, VAT ID, etc. |
| `metadata` | Flexible key-value: industry, region, account_manager, etc. |
| `tenant_ids` | Technical tenant identifiers (link to infrastructure model) |

#### SUBSCRIPTION

The active commercial relationship between a Customer and a Plan. This is the core
runtime entity — it determines what the customer can use RIGHT NOW.

A customer can have multiple active subscriptions (Trafficure base + SmartMarket add-on
+ Support add-on).

| Property | Description |
|---|---|
| `customer` | Who |
| `plan` | Which Plan (at which version) |
| `status` | `trialing`, `active`, `past-due`, `paused`, `cancelled`, `expired` |
| `started_at` | When this subscription began |
| `current_period_start` | Current billing period start |
| `current_period_end` | Current billing period end |
| `trial_end` | If trialing, when the trial ends |
| `cancel_at` | If scheduled for cancellation |
| `billing_anchor` | Which day of month billing cycles |
| `applied_coupons` | Active discounts |
| `items` | Subscription Items (see below) |

#### SUBSCRIPTION ITEM

Each line in an active subscription, corresponding to a Line Item from the Plan,
potentially with customer-specific overrides (custom quantity, negotiated price,
adjusted limits).

This is Stripe's SubscriptionItem exactly.

| Property | Description |
|---|---|
| `subscription` | Which Subscription |
| `line_item` | Which Line Item from the Plan |
| `capability_granted` | Which Capability this activates (resolved from line item) |
| `quantity` | For per-seat: how many seats purchased |
| `override_amount` | If negotiated price differs from plan default |
| `override_included_units` | If negotiated limits differ from plan default |
| `metadata` | Custom key-value |

**The Subscription Item IS the Entitlement.** An active subscription with items
referencing Capabilities determines what the customer can access. No separate
entitlement table needed for the common case. Your application checks: "Does this
customer have an active subscription item granting Capability X?" If yes, they have
access.

#### WALLET (replaces "Credit")

Prepaid balance that offsets usage charges. Called "Wallet" to avoid the accounting
"credit/debit" collision identified earlier.

| Property | Description |
|---|---|
| `customer` | Whose wallet |
| `currency` | What denomination: `INR`, `USD`, or `usage-credits` (a virtual currency) |
| `balance` | Current balance |
| `type` | `prepaid` (purchased), `promotional` (granted), `compensation` (service recovery) |
| `expires_at` | Nullable |
| `granted_reason` | "Annual commitment prepay", "Q1 2025 promo", "Incident INC-042" |

#### USAGE EVENT

A raw event representing customer consumption. Sent from your application to the
billing system (or to your own metering pipeline first, then aggregated to billing).

| Property | Description |
|---|---|
| `customer` | Who consumed |
| `metric` | Which Billable Metric: `ai_queries`, `api_calls`, etc. |
| `value` | Numeric value (1 for count-based, N for sum-based) |
| `timestamp` | When it happened |
| `dimensions` | Tags: `{model: "gpt-4", region: "ap-south-1"}` |
| `idempotency_key` | To prevent double-counting |

Usage Events are high-volume, append-only data. They live in your metering pipeline
(ClickHouse) and get aggregated into billing-period summaries for invoicing.

#### INVOICE

The bill. Generated automatically from Subscriptions + Usage at the end of each billing
period, or manually for one-time charges.

| Property | Description |
|---|---|
| `customer` | Who owes |
| `status` | `draft`, `finalized`, `paid`, `past-due`, `void` |
| `period_start` | Billing period covered |
| `period_end` | Billing period covered |
| `subtotal` | Before discounts and tax |
| `discount` | Coupon/wallet application |
| `tax` | GST/VAT |
| `total` | Final amount |
| `line_items` | Itemized charges (see below) |
| `due_date` | When payment is expected |
| `pdf_url` | Generated invoice PDF |

#### INVOICE LINE ITEM

Each charge on an invoice, traced back to the subscription item and/or usage that
generated it.

| Property | Description |
|---|---|
| `description` | "Trafficure Professional - Platform Fee", "AI Queries (1,247 @ ₹50)" |
| `subscription_item` | Which subscription item generated this charge |
| `quantity` | Units consumed or seats counted |
| `unit_amount` | Price per unit |
| `amount` | Line total |
| `period` | What period this covers |

---

## How It Connects to the Infrastructure Model

### The Resolution Chain

When your infrastructure system needs to know what to deploy for a customer, it follows
this chain:

```
CUSTOMER "Samsung India"
  └── has SUBSCRIPTION(s)
        └── each has SUBSCRIPTION ITEMS
              └── each grants a CAPABILITY
                    └── each Capability has requires_components
                          └── these are COMPONENTS from V3 technical catalog
                                └── deployed as DEPLOYMENTS on RUNTIMES on HOSTS

The complete list of components to deploy =
  union of all requires_components
  from all Capabilities
  from all active Subscription Items
  from all active Subscriptions
  for this Customer
  PLUS all "internal" visibility Capabilities (platform infrastructure)
```

### The Enforcement Chain

When your application needs to check if a customer can use a feature:

```
Request comes in for Customer "Samsung India" to use "AI Data Analyst"

1. Find active Subscriptions for Samsung India
2. Find Subscription Items across those Subscriptions
3. Check if any Subscription Item grants CAPABILITY "AI Data Analyst"
4. If yes → allow
5. If the Capability has metered_dimensions:
   a. Check current period usage against included_units from the Subscription Item
   b. If under limit → allow, record Usage Event
   c. If over limit → check charge_type:
      - If per-unit → allow, record Usage Event (will be billed)
      - If the plan has a maximum_spend → check if cap reached
   d. If Wallet has balance → allow, deduct from wallet
6. If no Subscription Item grants this Capability → deny (403 or show upgrade prompt)
```

### The Billing Chain

At the end of each billing period:

```
For each active Subscription:
  For each Subscription Item:
    If charge_type is flat → add fixed amount to Invoice
    If charge_type is per-seat → quantity × per_unit_amount → add to Invoice
    If charge_type is per-unit or tiered:
      Aggregate Usage Events for this period for the relevant Billable Metric
      Apply included_units (subtract free tier)
      Apply tier pricing logic
      → add calculated amount to Invoice
  Apply Coupons (percentage or fixed discount)
  Apply Wallet balance (deduct from prepaid)
  Calculate Tax
  Generate Invoice
```

---

## Handling Special Cases

### Custom Enterprise Contracts

Samsung doesn't pick a plan from your pricing page. Their contract is negotiated.
Two approaches:

**Option A: Custom Plan.** Create a Plan named "Samsung India Custom" with plan
version "samsung-2024" that has exactly the line items negotiated. This plan is
`lifecycle: active` but invisible to other customers. Samsung's Subscription
references this custom plan.

**Option B: Override at Subscription Item level.** Samsung subscribes to
"Trafficure Enterprise" (the standard plan) but individual Subscription Items have
`override_amount` and `override_included_units` reflecting negotiated terms.

Option A is cleaner for very custom deals. Option B is better when the deal is
mostly standard with a few adjustments. Stripe supports both patterns.

### Cross-Product Bundles

Samsung buys Trafficure + SmartMarket together. Two approaches:

**Option A: Suite Plan.** Create a Plan of type `suite` called "Lepton Intelligence
Suite" that includes line items from both products. One Subscription, one invoice.

**Option B: Multiple Subscriptions.** Samsung has separate Subscriptions for
Trafficure Enterprise and SmartMarket Professional. Two invoices (can be consolidated).
This is simpler operationally and is what Stripe recommends — each Subscription can
have its own billing period, its own start date, and can be modified independently.

### Engagement Charges

When you charge Samsung ₹25L for a professional services engagement, this is an
**Addon Charge** — a one-time invoice item added to their account. It appears on
their next invoice alongside their subscription charges. No subscription needed.

### Perpetual Licenses with Annual Maintenance

Some on-prem customers buy a perpetual license (one-time charge) plus annual
maintenance (recurring subscription). Model as:

- Addon Charge: "Trafficure Enterprise Perpetual License — ₹75L" (one-time)
- Subscription: "Trafficure Annual Maintenance" with line items for support,
  updates, and SLA (recurring, annual)

### Free Tier / Trial

Create a Plan called "Trafficure Free" with line items that grant core capabilities
but with tight limits (5 seats, 3 projects, 5,000 API calls/month). A trial customer
gets a Subscription with `status: trialing` and `trial_end` set to 14 days out.

---

## Complete Entity Map

### Product Catalog (your system)

| Entity | Count | Changes how often |
|---|---|---|
| **Product** | 2-5 | Rarely (new product launch) |
| **Capability** | 20-50 | Occasionally (new features, quarterly) |
| **Billable Metric** | 10-20 | Occasionally (new metered dimensions) |

### Price Catalog (billing system)

| Entity | Count | Changes how often |
|---|---|---|
| **Plan** | 5-15 | Occasionally (pricing changes, new tiers) |
| **Line Item** | 50-150 | With plan changes |
| **Coupon** | 10-50 | Frequently (marketing campaigns) |
| **Addon Charge (templates)** | 5-10 | Rarely |

### Customer State (billing system + your system)

| Entity | Count | Changes how often |
|---|---|---|
| **Customer** | 10-1000+ | Growing |
| **Subscription** | 1-3 per customer | On purchase/renewal/upgrade |
| **Subscription Item** | 5-20 per subscription | On plan change |
| **Wallet** | 0-1 per customer | On prepay/promo |
| **Usage Event** | Thousands-millions/day | Continuously |
| **Invoice** | 1 per customer per period | Monthly/annually |

---

## How This Replaces Previous Attempts

| Previous entity | What happened | Why |
|---|---|---|
| ~~Module~~ | Merged into **Capability** | Module was just a renamed Capability with extra baggage |
| ~~Bundle~~ | Merged into **Plan** (type: suite) | A bundle is just a multi-product Plan |
| ~~License~~ | Replaced by **Subscription** | License was reinventing what billing systems already model |
| ~~Entitlement~~ | Eliminated — **Subscription Item IS the entitlement** | Following Stripe's model: the line item grants access |
| ~~Seat~~ | Became a **Billable Metric** + **Line Item** charge_type: per-seat | Seats are just a metered dimension with per-seat pricing |
| ~~Quota~~ | Became **included_units** on a **Line Item** | Quotas are just the free tier of a tiered charge |
| ~~Usage~~ | Became **Usage Event** (raw) + billing period aggregation | Cleaner separation of raw events from billing logic |
| ~~Credit~~ | Renamed to **Wallet** | Avoids accounting "credit/debit" collision |
| ~~Offering~~ | Moved to **Deployment config** on the infrastructure side | Distribution channel and operations model are deployment concerns, not pricing concerns |
| **Plan** | Kept, clarified | Now properly contains Line Items |
| **Capability** | Kept, refined | Now cleanly connects to both billing (via Line Items) and infra (via requires_components) |
| **Product** | Kept, clarified | Now explicitly the market-facing brand, not the Stripe "product" |

**Previous model: 8 entities** (Capability, Plan, License, Entitlement, Seat, Quota,
Usage, Credit)

**This model: 12 entities** but many are standard billing primitives that your billing
system handles natively: Product, Capability, Billable Metric, Plan, Line Item, Coupon,
Addon Charge, Customer, Subscription, Subscription Item, Wallet, Usage Event, Invoice

**Entities YOU build and own: 3** (Product, Capability, Billable Metric)
**Entities your billing system handles: 9** (Plan, Line Item, Coupon, Addon Charge,
Customer, Subscription, Subscription Item, Wallet, Invoice)

**Your application code only needs to:**
1. Maintain the Product ↔ Capability ↔ Component graph (product catalog)
2. Send Usage Events to your metering pipeline
3. Check Subscription Items to determine feature access (entitlement check)
4. Sync Customer and Subscription data from your billing system

Everything else — invoicing, payment collection, dunning, revenue recognition, coupon
logic, trial management — is the billing system's job.

---

## The Capability Entity Is the Keystone

Capability is the single entity that bridges all three worlds:

```
SALES WORLD                ENGINEERING WORLD           BILLING WORLD
                           
"Coverage Analysis"  ←──── CAPABILITY ────→  Line Item in Plan
(thing we sell)             │                 (thing we charge for)
                            │
                            ├── requires_components:
                            │     [coverage-service,    ← V3 Component
                            │      coverage-ui,         ← V3 Component
                            │      rf-engine]           ← V3 Component
                            │
                            ├── metered_dimensions:
                            │     [BILLABLE METRIC       ← feeds billing
                            │      "projects-created"]
                            │
                            ├── depends_on:
                            │     [CAPABILITY             ← dependency graph
                            │      "RF Engine"]
                            │
                            └── activation: deploy        ← tells infra what to do
```

When sales sells it, billing charges for it, and engineering deploys it — they're all
talking about the same Capability. That's the vocabulary alignment this model achieves.
