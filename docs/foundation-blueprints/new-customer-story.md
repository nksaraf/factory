## Lifecycle: From Customer Acquisition to Running Product

Two paths exist:

1. **Enterprise SaaS customer (with Purchase Order)**
2. **Self-serve customer (product-led signup)**

Both end in the same outcome: a **Namespace running inside a Site** with enabled modules.

The difference is **how Commerce and Fleet are triggered**.

---

# Path 1 — Enterprise SaaS Customer (PO-based)

Typical for telecoms, governments, or enterprise deals.

## Step 1 — Deal Creation

**Plane:** Factory → Commerce Plane

Actors
Sales, finance, partner (if applicable)

Actions

- Customer account created
- Contract and pricing defined
- Modules licensed
- Seat limits defined
- Quotas defined
- Support tier defined

Output

```
Customer Account
License
Entitlement Bundle
```

Example entitlement bundle

```
modules:
  - geoanalytics
  - kpi
  - coverage

seats: 120
storage_quota: 5TB
compute_quota: 2000 hrs
```

---

## Step 2 — Site Assignment

**Plane:** Factory → Fleet Plane

Fleet decides where the customer will run.

Possible outcomes

- existing SaaS Site
- new dedicated Site
- partner-operated Site

Example

```
customer: Samsung
site: saas-us-east-1
namespace: samsung
```

Fleet records:

- site_id
- provider
- region
- deployment type

---

## Step 3 — Namespace Provisioning

**Plane:** Site → Control Plane

Control Plane provisions a namespace.

Creates:

```
namespace
roles
default policies
service accounts
quota limits
```

Example

```
namespace_id: samsung
tenant_context: samsung
```

This becomes the isolation boundary.

---

## Step 4 — Module Enablement

**Plane:** Site → Service Plane

Service Plane installs or enables modules.

Example

```
geoanalytics
kpi
coverage
```

Actions

- service configuration
- API enablement
- worker deployment

---

## Step 5 — Data Initialization

**Plane:** Site → Data Plane

Data Plane creates tenant-scoped storage.

Examples

```
Postgres schema or RLS tenant
object storage prefix
search indexes
cache namespace
```

Example

```
bucket: data/samsung/*
schema: tenant_samsung
```

---

## Step 6 — Identity Setup

**Plane:** Site → Control Plane

Users and identity sources added.

Possible sources

- SSO integration
- SCIM provisioning
- manual users

Roles created

```
admin
analyst
viewer
```

---

## Step 7 — Customer Access

**Plane:** Site → Network Plane

Network Plane exposes endpoints.

Examples

```
https://app.platform.com/samsung
https://api.platform.com/samsung
```

Network plane handles:

- routing
- TLS
- rate limits
- WAF

---

## Step 8 — Running Product

Customer now has:

```
Site
 ├ Network Plane
 ├ Control Plane
 ├ Service Plane
 └ Data Plane
```

Users log in and use modules.

Telemetry begins flowing back to Factory.

---

# Path 2 — Self-Serve Customer

Product-led growth signup.

The difference is **automation of the Commerce and Fleet steps**.

---

## Step 1 — Signup

**Plane:** Site → Network Plane

User signs up.

Example

```
app.platform.com/signup
```

User creates account.

---

## Step 2 — Trial Creation

**Plane:** Factory → Commerce Plane

Commerce automatically creates:

```
trial account
trial license
trial quotas
```

Example

```
modules: geoanalytics
seats: 5
trial_period: 14 days
```

---

## Step 3 — Namespace Auto-Provisioning

**Plane:** Site → Control Plane

System automatically creates namespace.

Example

```
namespace_id: startup_xyz
```

User becomes namespace admin.

---

## Step 4 — Module Activation

**Plane:** Site → Service Plane

Trial modules automatically enabled.

Example

```
geoanalytics
dashboard
basic analytics
```

---

## Step 5 — Data Initialization

**Plane:** Site → Data Plane

Tenant storage created.

Example

```
schema: tenant_startup_xyz
bucket: startup_xyz/*
```

---

## Step 6 — User Access

**Plane:** Site → Network Plane

User immediately enters product.

---

## Step 7 — Upgrade Path

If user converts:

**Commerce Plane**

- upgrade license
- update quotas
- enable additional modules

**Control Plane**

- apply updated entitlements

No redeployment needed.

---

# Telemetry Feedback Loop

During runtime the Site sends signals to the Factory.

Planes involved

Site

```
Network Plane → request logs
Service Plane → usage metrics
Data Plane → storage metrics
Control Plane → audit logs
```

Factory

```
Fleet Plane → health monitoring
Commerce Plane → billing
Product Plane → product analytics
```

This feedback loop informs:

- billing
- product decisions
- reliability improvements

---

# Visual Lifecycle

```
Enterprise SaaS

Sales/PO
   │
Commerce Plane
   │
Fleet Plane
   │
Site Provisioned
   │
Control Plane
   │
Service Plane
   │
Data Plane
   │
Customer Uses Product
```

---

```
Self-Serve

Signup
   │
Commerce Trial
   │
Namespace Created
   │
Modules Enabled
   │
Product Ready
```

---

# Final Outcome

Both journeys converge to the same runtime structure.

```
Factory
 ├ Product Plane
 ├ Build Plane
 ├ Infrastructure Plane
 ├ Commerce Plane
 └ Fleet Plane


Site
 ├ Network Plane
 ├ Control Plane
 ├ Service Plane
 └ Data Plane
```

Factory produces and governs.

Sites run workloads.

Namespaces isolate customers.

Modules deliver functionality.
