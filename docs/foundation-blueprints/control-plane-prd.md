# Product Requirements Document

# **Control Plane (Per-Deployment Runtime Governance Layer)**

---

# 1. Purpose

The Control Plane is the runtime governance core inside every deployment of Product OS.

It is responsible for:

- Identity
- Access control
- Namespace tenancy
- Policy enforcement
- Quota enforcement
- Entitlement validation
- Workflow orchestration
- Event propagation
- Audit logging

It does **not**:

- Manage infrastructure provisioning (Infrastructure Plane)
- Manage deployment lifecycle or billing contracts (Fleet Plane)
- Implement business domain logic (Application Plane)

---

# 2. Design Principles

1. Deployment is a security boundary.
2. Namespace is the tenancy boundary.
3. Identity is deployment-scoped.
4. Authorization is relationship-based and scope-explicit.
5. All enforcement is local (no runtime dependency on Fleet).
6. All writes emit outbox events.
7. Quotas must be atomic and concurrency-safe.
8. Blue/green must not duplicate identity or policy state.

---

# 3. Core Concepts

## 3.1 Principal

A security subject.

Types:

- User
- Service Account
- Group

Groups are principals with members.

---

## 3.2 Organization

Identity container.

- Contains principals.
- May configure SSO.
- May own multiple namespaces.
- Not the data boundary.

---

## 3.3 Namespace

Tenancy boundary.

- Contains module instances.
- Contains namespace-scoped groups.
- Owns data.
- Owns quota partitions (optional).

Namespace does not own identity; it owns access.

---

## 3.4 Instance

Runtime generation of a namespace.

- Supports version compatibility.
- Supports schema evolution.
- Supports blue/green rollout.
- One namespace may have multiple instances (generational).

---

## 3.5 Deployment Slot

Runtime rollout unit (blue/green/canary).

- Bound to an instance.
- Used for traffic shifting.
- Not a tenancy boundary.

---

# 4. Functional Requirements

---

# 4.1 Identity Management

## 4.1.1 Authentication

Support:

- Local identity (email/password, passkey, MFA)
- OIDC/SAML federation
- Internal SSO (for air-gapped)
- Service account tokens

Tokens must be:

- Deployment-audienced
- Short-lived
- Signed locally

---

## 4.1.2 Org-Level Controls

Per organization:

- SSO configuration
- Domain verification
- SCIM (enterprise)
- MFA enforcement
- Session duration policy

---

# 4.2 Authorization Model

## 4.2.1 Role Bindings

Role bindings must include:

- principal_id
- scope_type (org / namespace / deployment)
- scope_id
- role_id

No implicit inheritance across scopes.

---

## 4.2.2 Namespace Groups

Support:

- Org-scoped groups
- Namespace-scoped groups
- Nested groups (optional, must be bounded)

Effective permissions = union of:

- Direct principal roles
- Group-derived roles

---

## 4.2.3 Operator Roles

### Deployment Operator

- Manage namespaces
- Inspect audit
- Override quotas (if allowed)

### Namespace Admin

- Manage users in namespace
- Configure modules
- Run workloads

### Org Admin

- Manage identity
- Assign namespace memberships

---

# 4.3 Entitlements

Control must:

- Accept signed entitlement bundle from Fleet
- Validate signature
- Store active entitlement
- Enforce:

  - Enabled modules
  - Seat limits
  - Quotas
  - Feature flags
  - Expiry behavior

Control must function without live Fleet connectivity.

---

# 4.4 Seat Enforcement

Seat models supported:

- Unique active principals per deployment
- Per-namespace seats (optional)
- Named seats (optional)

Seat activation occurs when:

- Principal logs in or becomes active.

Seat ledger must:

- Be atomic
- Prevent over-allocation
- Handle concurrent logins

---

# 4.5 Quota Enforcement

Quota types:

- Storage (GB)
- Compute (job runtime)
- API calls
- Assistant runs
- Tile generation
- Dataset count

Quota enforcement model:

1. Reserve
2. Execute
3. Commit or rollback

Quota ledger must:

- Support concurrency
- Be instance-scoped
- Be namespace-attributed

---

# 4.6 Workflow Engine

Control must provide:

- Job orchestration
- State transitions
- Retry policies
- Idempotency keys
- Audit hooks

Workflow execution must:

- Reserve quota before heavy operations
- Emit usage events
- Emit outbox events

---

# 4.7 Eventing and Outbox

All writes must:

- Write domain change
- Write outbox event in same transaction

Projection workers must:

- Update read models
- Update tile caches
- Update search indexes
- Publish WebSocket updates

Assistant listens to event stream.

---

# 4.8 Blue/Green Awareness

Control must:

- Maintain instance table
- Maintain instance_deployment mapping
- Route traffic by slot
- Keep identity and policy stable across slots
- Allow safe rollback

Migrations must follow:

- Expand/contract pattern
  OR
- Instance-level upgrade strategy

---

# 4.9 Audit Logging

Audit must record:

- principal_id
- namespace_id
- instance_id
- deployment_id
- action
- timestamp
- IP/device (if available)
- operator_session (if applicable)

Audit must not depend on Fleet.

---

# 4.10 Air-Gapped Support

Control must:

- Run fully disconnected
- Validate entitlement offline
- Allow offline upgrade packages
- Generate signed usage reports (optional)
- Enforce expiry locally

No runtime external calls required.

---

# 5. Non-Functional Requirements

## Scalability

- 1,000+ namespaces per deployment
- 10,000+ principals
- 100+ concurrent workflows per namespace

## Isolation

- Namespace data isolation enforced at storage and API layer

## Availability

- Identity and policy must not depend on external services

## Observability

- Structured audit logs
- Metrics per namespace
- Metrics per instance
- Metrics per deployment slot

---

# 6. API Surface (High-Level)

All external APIs restricted to GET/POST if required by security policy.

Core internal services:

- /auth/\*
- /org/\*
- /namespace/\*
- /roles/\*
- /quota/reserve
- /quota/commit
- /entitlements
- /workflow/\*
- /audit/\*
- /instance/\*
- /deployment-slot/\*

---

# 7. Data Model (Conceptual)

- principal
- organization
- group_membership
- namespace
- instance
- instance_deployment
- role
- role_binding
- entitlement_bundle
- quota_ledger
- workflow_run
- audit_log
- outbox_event

---

# 8. Success Criteria

- New namespace creation < 60 seconds
- Seat over-allocation impossible under concurrency
- Blue/green rollout with zero identity disruption
- Offline deployment fully operational
- No Fleet dependency during runtime
- Full traceability of assistant runs

---

# 9. Explicit Boundaries

Control Plane does not:

- Create deployments
- Modify billing contracts
- Provision infrastructure
- Contain business analytics logic
- Store large analytical datasets (Application Plane owns)

---

# Final Definition

The Control Plane is the authoritative runtime governance layer per deployment.

It stabilizes:

- Identity
- Tenancy
- Enforcement
- Execution control
- Audit

Across:

- SaaS
- Dedicated
- Self-hosted
- Air-gapped

It is the brain of the deployment, not the business logic engine and not the commercial system.
