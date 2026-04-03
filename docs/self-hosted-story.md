# Enterprise Self-Hosted Journey

Self-hosted means the **Site runs in the customer’s infrastructure**, not in the vendor SaaS environment. The Factory still produces releases and manages licensing, but the **Site runtime lives under the customer’s control**.

There are two variants:

1. **Connected Self-Hosted** (customer environment can talk to Factory)
2. **Air-Gapped Self-Hosted** (customer environment has no connectivity to Factory)

The planes remain identical. Only the **interaction with Factory changes**.

---

# Shared Starting Point (Enterprise Contract)

## Step 1 — Deal and Licensing

**Plane:** Factory → Commerce Plane

Actors

* sales
* partner
* customer procurement

Actions

Commerce Plane creates:

```
customer_account
deployment_type: SELF_HOSTED
license
module_entitlements
quota_policy
support_tier
```

Output

```
entitlement_bundle
license_token
deployment_manifest
```

---

## Step 2 — Release Selection

**Plane:** Factory → Product Plane + Build Plane

Factory determines the release the customer will run.

Example

```
platform_version: 2.3.1
modules:
  - geoanalytics
  - kpi
  - coverage
```

Build Plane ensures artifacts exist.

Artifacts produced:

```
container_images
helm_charts
migration_scripts
module_bundles
```

---

# Path A — Connected Self-Hosted Deployment

Customer environment can communicate with Factory.

---

## Step 3 — Infrastructure Preparation

**Plane:** Factory → Infrastructure Plane

Customer or partner prepares infrastructure.

Examples

```
Kubernetes cluster
object storage
database cluster
network ingress
```

Infrastructure may be:

* cloud account owned by customer
* customer datacenter
* partner-managed environment

---

## Step 4 — Site Creation

**Plane:** Factory → Fleet Plane

Fleet registers a new Site.

Example

```
site_id: samsung-prod
deployment_type: SELF_HOSTED
provider: samsung
region: ap-south
```

Fleet generates:

```
site_bootstrap_config
site_identity
deployment_manifest
```

---

## Step 5 — Site Bootstrap

**Plane:** Site → Control Plane

Bootstrap process installs the platform.

Installer deploys:

```
Network Plane
Control Plane
Service Plane
Data Plane
```

Example deployment method

```
helm install platform
```

Control Plane starts with:

```
root_admin
site_identity
initial policies
```

---

## Step 6 — Factory Connection Established

Site registers with Factory.

Communication channels:

```
telemetry
license validation
upgrade notifications
fleet monitoring
```

Example:

```
site → factory heartbeat
```

---

## Step 7 — Namespace Provisioning

**Plane:** Site → Control Plane

Customer tenants created.

Example

```
namespace: samsung
```

Control Plane provisions:

```
roles
policies
quotas
service accounts
```

---

## Step 8 — Module Deployment

**Plane:** Site → Service Plane

Service Plane deploys modules.

Example

```
geoanalytics
kpi
coverage
```

Modules run as services and workers.

---

## Step 9 — Data Plane Initialization

**Plane:** Site → Data Plane

Tenant storage initialized.

Examples

```
postgres schema
object storage prefix
search indexes
cache partition
```

---

## Step 10 — Production Operation

Customer users access the platform.

Request flow

```
Network Plane
→ Service Plane
→ Data Plane
```

Control Plane enforces policies.

Factory receives telemetry.

---

# Path B — Air-Gapped Deployment

Customer environment cannot communicate with Factory.

This changes artifact distribution and license updates.

---

## Step 3 — Release Bundle Creation

**Plane:** Factory → Build Plane

Build Plane produces an **offline release bundle**.

Bundle contains

```
container images
helm charts
migration scripts
module packages
SBOM
documentation
license bundle
```

Output

```
platform-release-2.3.1.tar
```

---

## Step 4 — Bundle Transfer

Bundle transferred manually.

Methods

```
secure file transfer
physical media
partner delivery
```

---

## Step 5 — Infrastructure Preparation

**Plane:** Customer Environment

Customer prepares runtime environment.

Examples

```
Kubernetes cluster
local container registry
object storage
database
```

---

## Step 6 — Site Installation

**Plane:** Site → Control Plane

Installer loads images from local registry.

Deployment installs:

```
Network Plane
Control Plane
Service Plane
Data Plane
```

Control Plane initializes with:

```
license bundle
initial policies
admin accounts
```

---

## Step 7 — Namespace Creation

**Plane:** Site → Control Plane

Tenant namespace created.

Example

```
namespace: samsung
```

---

## Step 8 — Module Activation

**Plane:** Site → Service Plane

Modules enabled locally.

---

## Step 9 — Data Initialization

**Plane:** Site → Data Plane

Tenant data stores created.

---

## Step 10 — Operation

Customer runs platform entirely offline.

Telemetry stored locally.

Support processes include:

```
offline log bundles
manual upgrade packages
license renewal bundles
```

---

# Upgrade Flow (Connected Self-Hosted)

Factory → Fleet Plane pushes upgrade availability.

Site pulls update:

```
new images
migration scripts
```

Fleet orchestrates upgrade.

---

# Upgrade Flow (Air-Gapped)

Factory produces:

```
upgrade bundle
```

Customer installs manually.

---

# Telemetry

Connected deployments send telemetry:

```
logs
metrics
usage
health
```

to Factory.

Air-gapped deployments export telemetry manually.

---

# Final Runtime Architecture

Every Site contains the same runtime.

```
Site
│
├── Network Plane
├── Control Plane
├── Service Plane
└── Data Plane
```

Factory always contains:

```
Factory
│
├── Product Plane
├── Build Plane
├── Infrastructure Plane
├── Commerce Plane
└── Fleet Plane
```

---

# Summary

Enterprise self-hosted deployments follow the same architecture as SaaS Sites.

The difference is **who owns infrastructure and how updates flow**.

Connected self-hosted Sites integrate with Factory for monitoring and upgrades.

Air-gapped Sites operate independently and receive releases through offline bundles.
