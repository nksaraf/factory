# Authorization System — Product Requirements Document

**Platform Fabric · Shared IAM Backbone**

**Products:** Trafficure · SmartOps · SmartInventory · SmartMarket · Future Products

**Stack:** better-auth · SpiceDB · PostgreSQL

Version 1.0 · March 2026 · CONFIDENTIAL

---

## 1. Purpose

This document specifies the authorization requirements for the Platform Fabric product family. All products share a common IAM backbone. The authorization model converges RBAC, ABAC, and ReBAC into a unified evaluation chain built on seven composable primitives (defined in the companion Mental Model document) and implemented via better-auth, SpiceDB, and PostgreSQL (defined in the companion Technical Architecture document).

**Companion Documents:**
- Authorization Mental Model (`authz-mental-model.md`) — the seven-primitive conceptual framework
- Authorization Technical Architecture (`authz-technical-architecture.md`) — implementation with better-auth + SpiceDB + PostgreSQL

---

## 2. Scope

- All current products: Trafficure, SmartOps, SmartInventory, SmartMarket
- All future enterprise SaaS products built on the shared IAM backbone
- Field force management: service tickets, dispatch, repair workflows
- Cross-organization collaboration: vendor sub-namespaces, partner access, guest membership
- All principal types: human users, service accounts, AI agents, future entity types
- All deployment models: SaaS shared, SaaS dedicated, connected self-hosted, air-gapped

---

## 3. Design Principles

1. **Deny-by-default.** No access is granted unless explicitly permitted through the evaluation chain. Absence of a grant is a denial.

2. **Least privilege.** Principals receive the minimum permissions necessary for their function. Broad grants are discouraged in favor of scoped, composable permission sets.

3. **Hierarchy-aware inheritance.** Permissions flow downward through scope hierarchies with explicit override and exclusion capabilities at any node.

4. **Separation of policy and enforcement.** Authorization policies are defined declaratively. SpiceDB evaluates structural relationships. The custom runtime evaluates contextual constraints. Application logic never makes authorization decisions directly.

5. **Auditability.** Every access decision is traceable to the principal, resource, policy, and context that produced it.

6. **Product-agnostic backbone.** The IAM layer does not encode product-specific semantics. Product and module scoping are first-class dimensions, not hardcoded branches.

7. **PostgreSQL is source of truth.** All auth state lives in PostgreSQL. SpiceDB is a derived view, synced via transactional outbox, never written to directly by application code.

8. **Embedded auth, no external identity server.** better-auth runs as a library embedded in the backend process, writing directly to PostgreSQL. No separate identity service to deploy or manage.

---

## 4. Principal Model

### 4.1 Principal Types

The system supports an unbounded set of principal types. The architecture does not enumerate types — it accommodates them. Known types at design time:

| Principal Type | Identity Source | Key Characteristics |
|---------------|----------------|---------------------|
| Human User | better-auth (email/password, social login, SSO, passkey) | Belongs to one or more orgs; interactive sessions |
| Service Account | Platform-provisioned (API key or bearer token via better-auth) | Non-interactive; scoped to an org; may act on behalf of a user |
| AI Agent | Platform-provisioned with agent identity | Autonomous or semi-autonomous; bounded by delegated permission ceiling; audit-linked to sponsoring principal |
| External/Vendor | Federated identity (better-auth SSO/SAML) or scoped invitation | Operates within a vendor sub-namespace; time-bounded access; restricted to explicitly shared resources |
| Future Entity | TBD | The principal model supports new types without IAM schema migration |

**Key design rule:** Principal type is a trait on the `user` record (`principalType` field), not a schema partition. Adding a new principal type means registering identities with a new trait value and writing standard SpiceDB tuples for org, scope, role, and classification bindings. No schema change. No code change in the auth layer.

### 4.2 Principal-Organization Relationship

- Every principal belongs to at least one organization.
- A human user who signs up without an org invitation gets an auto-created personal org (`orgType: personal`). This personal org has the same schema as a multi-user org but with a single member.
- A principal may belong to multiple orgs. Each org membership carries its own role assignments, scope bindings, and classification clearances.
- `orgId` is the universal tenant key. All authorization evaluations are scoped to an `orgId` context.
- better-auth's session model tracks `activeOrganizationId` — the org the principal is currently operating within.

### 4.3 Requirement: Principal Extensibility

The IAM backbone MUST allow new principal types by adding a type trait value and associated policies, without changes to the authorization schema, SpiceDB definitions, evaluation engine, or existing product code.

---

## 5. Organization Model (Primitive ②)

The organization is the outermost mandatory gate. Evaluated first in every authorization decision. If the principal is not a member or guest of the owning organization, the resource is invisible.

### 5.1 Organization Types

| Type | Description |
|------|-------------|
| `personal` | Auto-created for individual users. Single member. Same schema as team orgs. |
| `team` | Standard multi-user organization. |
| `enterprise` | Enterprise org with SSO/SAML, SCIM, advanced policies. |
| `vendor_namespace` | Scoped boundary within a host org for vendor/partner access. Has permission ceiling and mandatory expiry. |

### 5.2 Cross-Organization Patterns

The system supports four collaboration patterns:

| Pattern | Mechanism | Example |
|---------|-----------|---------|
| Resource sharing | Directed grant from Org A to Org B on a specific resource | MTP shares an incident report with RTO |
| Guest membership | Principal from Org B gets a limited role within Org A | RTO officer gets Viewer role in MTP's enforcement workspace |
| Joint ownership | Resource carries multiple org relations | Joint safety investigation co-owned by two agencies |
| Org hierarchy | Parent org has configurable visibility into child orgs | Holding company sees subsidiary data per policy |

### 5.3 Vendor Sub-Namespace

When an org engages a vendor, the system creates a vendor sub-namespace (an organization with `orgType: vendor_namespace`) within the host org's boundary:

- **Namespace isolation:** Vendor principals cannot access resources outside their sub-namespace.
- **Permission ceiling:** Maximum privilege set defined by the host org. Vendor roles cannot exceed this ceiling.
- **Time-bounded:** Mandatory expiry date. Access ceases automatically. Renewal is explicit.
- **Audit separation:** All vendor actions tagged with vendor identity in the audit trail.
- **Self-management:** Vendors manage their own user roles within their sub-namespace, subject to the ceiling.

### 5.4 Cross-Org Audit Requirement

Every cross-org access event MUST record: source org, target org, principal, resource, action, collaboration pattern, and timestamp.

---

## 6. Scope Model (Primitive ③)

### 6.1 The Key Reduction

The requirements call for four independent hierarchies: regional (geography), topology (network architecture), channel (distribution), and department (organizational function). These are four instances of **one parameterized concept: Scope**.

A Scope is an org-defined hierarchy of arbitrary depth where principals are assigned at nodes and access inherits downward through the subtree, with optional exclusion overrides.

| Scope Dimension | Examples | Used By |
|----------------|----------|---------|
| Region | Country → Circle → Zone → Division | All products |
| Topology | Core → Aggregation → Distribution → Access → CPE | SmartInventory |
| Channel | Direct → National Dist → Regional Dist → Reseller → Sub-dealer | SmartMarket |
| Department | Engineering → Platforms → Frontend | All products |
| Skill Family | Fiber → Advanced Fiber → Specialized Fiber | SmartOps (field force) |
| Future | Cost Center, Security Zone, Project Portfolio | Any |

All use the same SpiceDB definition (`scope_node`), the same PostgreSQL table (`iam.scope_node`), the same admin UI, and the same inheritance resolution. The `scope_type` differentiates them.

### 6.2 Data Model Requirements

| Attribute | Requirement |
|-----------|-------------|
| Node Identity | Globally unique ID (within org), display name, optional code/slug |
| Level Naming | Org-defined level name at each depth (e.g., "Country", "Circle"). Metadata, not structural constraint. |
| Parent Reference | Each non-root node references exactly one parent. Root nodes have no parent. |
| Multi-Root | An org may define multiple root nodes per scope type |
| Depth Limit | No hardcoded limit. Must perform well to 10+ levels with 1000+ nodes per org |

### 6.3 Permission Inheritance

- **Downward propagation:** A grant at node N implies a grant at all descendants of N.
- **Exclusion override:** An explicit deny at descendant D overrides inherited access from an ancestor. Applies to D and its subtree.
- **No upward propagation:** A grant at a child never implies access to parent or siblings.
- **Cross-tree independence:** Grants in one scope tree do not affect another, even within the same org.

### 6.4 Sparse Assignment

Assignments are stored at the highest applicable node. The authorization engine resolves inheritance by evaluating the recursive `parent` relation in SpiceDB. This keeps assignment data sparse and avoids fan-out writes when the hierarchy changes.

### 6.5 Orthogonal Intersection

A principal's effective access is the intersection of ALL applicable scope dimensions. A field technician authorized for Access-tier topology AND Maharashtra region can only see Access-tier elements in Maharashtra. Neither scope alone is sufficient. SpiceDB models these as independent `scope` relations that are ANDed at evaluation time.

### 6.6 Hierarchy Mutation

When the hierarchy is restructured (nodes moved, merged, split, or deleted):

1. Re-evaluate all active assignments referencing affected nodes.
2. Emit hierarchy-change events via the transactional outbox to SpiceDB.
3. Provide an admin-facing impact preview before committing destructive changes.
4. Log all mutations in the audit trail with before/after state.

---

## 7. Role Model (Primitive ④)

### 7.1 Lattice Structure

The role hierarchy is a directed acyclic graph (DAG), not a linear chain. A role may have zero, one, or multiple parent roles. Permission inheritance flows from parent to child: a child inherits the union of all parents' permissions.

### 7.2 Permission Granularity

Permissions are action-resource pairs scoped by product and module:

```
<product>:<module>:<resource>:<action>
```

Examples: `trafficure:planning:simulation:create`, `smartops:fieldforce:ticket:escalate`, `smartinventory:lifecycle:element:decommission`, `smartmarket:channel:pricing:view`.

### 7.3 Role Requirements

| Requirement | Detail |
|-------------|--------|
| DAG enforcement | Cycles are rejected at write time |
| Multiple inheritance | Union of all parent permissions |
| Conflict resolution | Explicit deny wins |
| Org-scoped | Each org defines its own role lattice. Platform Super Admin exists outside org scope. |
| Role composability | Custom roles by composing permissions from existing roles |
| Dynamic lattice | Modifiable at runtime by org admins. Changes propagate on next evaluation. |
| Module-scoped assignment | A principal may hold different roles in different modules |

### 7.4 Role Evaluation

The custom runtime loads each org's role lattice from PostgreSQL, computes the transitive closure of permissions, and caches the result. Role evaluation is a sub-millisecond local lookup, not a SpiceDB call. SpiceDB stores role assignments as source of truth; the runtime caches the computed permission sets.

---

## 8. Classification Model (Primitive ⑤)

### 8.1 Mandatory Labels

Classifications are mandatory labels on resources, inspired by Palantir's Markings pattern. They are centrally managed and cannot be bypassed by discretionary grants. Even an Org Admin cannot access a Restricted resource without the classification clearance.

**Key property: mandatory overrides discretionary.** A principal with Owner role on a project containing a Restricted dataset cannot see the dataset's contents without Restricted clearance.

### 8.2 Classification Categories

| Category | Labels (org-extensible) | Behavior |
|----------|------------------------|----------|
| Data classification | Public, Internal, Restricted | Conjunctive (must hold all labels) |
| Jurisdiction | India, State-specific, EU/GDPR | Hard gate — no bypass |
| Regulatory tags | PII, Subscriber Data, Financial, Location | Additional constraints per tag |
| Asset criticality | P1 (Critical), P2 (High), P3 (Medium), P4 (Low) | Minimum authority level per tier |

### 8.3 Clearance Slot System

The SpiceDB schema uses four numbered clearance slots on the `organization` definition. The Ontology Registry maps each slot to a semantic meaning per org and per object type:

- Mumbai TP: slot 1 = VIP_OPS, slot 2 = FORENSIC, slot 3 = INTEL, slot 4 = OFFICER_PII
- Jio SmartInventory: slot 1 = CORE_ACCESS, slot 2 = SUBSCRIBER_PII, slot 3 = FINANCIAL, slot 4 = TRAI_REGULATED
- Distributor: slot 1 = PRICING_WHOLESALE, slot 2 = MARGIN_DATA

Same four slots. Different meanings. SpiceDB schema never changes.

### 8.4 Property-Level Security

Classifications gate specific properties on ontology objects, not just entire objects. An Incident object might have `description` (unclassified), `casualty_details` (FORENSIC), and `responding_officers` (OFFICER_PII). A principal who passes object-level checks but lacks FORENSIC clearance sees `casualty_details` as `null`. This is application-layer null-masking driven by the Ontology Registry's property-to-slot mapping.

### 8.5 Lineage Propagation

When a pipeline transforms a dataset, output classifications inherit from inputs. If the input carries SUBSCRIBER_PII, the output inherits it unless the pipeline explicitly strips the PII columns. This prevents classification laundering through ETL.

### 8.6 Classification Rules

- Classification is immutable once set, unless changed by an admin or owner with the appropriate permission.
- Downgrade (Restricted → Internal → Public) requires admin approval.
- Labels are extensible per-org.

---

## 9. Relationship Model (Primitive ⑥)

### 9.1 Resource-Level Access

Relationships bind a principal to a specific resource instance. While Roles grant broad capability and Scopes limit where, Relationships connect a principal to a specific resource.

| Relationship | Effect |
|-------------|--------|
| Owner | Full CRUD + share + transfer + delete |
| Team member | Inherits owner-level access for team-owned resources |
| Shared viewer | Read access to a specifically shared resource |
| Shared editor | Read + write access |
| Assignee | Action authority on an assigned work item |
| Approver | Authority to approve a pending action |

### 9.2 Ownership

- Resources have an owner (principal or team).
- Owners have full authority regardless of role-based permissions, unless overridden by admin-level deny.
- Ownership is transferable (audited, atomic operation).
- When an owner leaves or is deactivated, owned resources transfer to team lead or org admin via configurable policy.

### 9.3 Team Ownership

Resources can be owned by a team. All team members inherit owner-level access. Team membership is managed via better-auth's built-in team system, independently of the role lattice.

---

## 10. Constraint Model (Primitive ⑦)

Constraints are runtime-evaluated conditions that depend on the current state of the world. They are evaluated by the custom runtime against live PostgreSQL state, not stored as SpiceDB tuples.

### 10.1 Time-Based Access

| Pattern | Requirement |
|---------|-------------|
| Contract period | Vendor/partner access bound to start/end dates. Auto-revoked on expiry. |
| Shift-based | Principals restricted to time windows (e.g., 06:00–18:00 IST, weekdays). |
| Temporary elevation | JIT access grants, time-bounded (e.g., 4 hours for incident response). Auto-expire. |
| Seasonal | Recurring cron-like windows (e.g., audit season, planning cycles). |
| Grace period | Configurable grace (e.g., 15 minutes) for in-flight operations when a window expires. |

### 10.2 Workflow State

Resources move through org-defined state machines. The current state changes who can do what.

- Each resource type has a state machine with named states and valid transitions.
- Each state defines which actions are available and which roles/tiers can perform them.
- State transitions are themselves authorized actions.
- Certain states lock the resource (only designated roles can act).
- Reopening a closed resource requires elevated authorization.
- Complex resources may have parallel state machines (lifecycle + operational state).

### 10.3 Skill and Certification

| Requirement | Detail |
|-------------|--------|
| Skill registry | Org-defined catalog of skills/certifications with grouping into families |
| Principal-skill binding | Active certifications with issue date, expiry date, issuing authority |
| Resource-skill requirement | Service tickets, work orders, asset types declare required skills |
| Expiry enforcement | Expired certifications treated as absent |
| Skill hierarchy | Parent skills satisfy child requirements |
| Multi-skill requirements | All required skills must be held (conjunctive AND) |
| Skill-based dispatch | "Which principals in scope X hold skills Y and Z in time window T?" |

### 10.4 Support Tier Hierarchy

Tier assignment is per skill-domain: `(principal, domain, tier)` tuples. A technician might be L3 for fiber but L1 for RF.

- Certain actions gated by tier (L1 can diagnose, L2+ can authorize replacement).
- Auto-escalation shifts authorization context (original assignee loses write access).
- Vendor technicians have a tier ceiling.

### 10.5 Asset Criticality

| Level | Impact | Authorization |
|-------|--------|--------------|
| P1 (Critical) | >100K subscribers or revenue loss | Senior engineer + manager approval. Read restricted to L2+. |
| P2 (High) | 10K–100K subscribers | L2+ for modifications. Change-window approval. |
| P3 (Medium) | <10K subscribers | L1+ within scope and skill. Standard workflow. |
| P4 (Low) | Individual subscriber | Field technicians with relevant skills. Minimal approval. |

Dynamic criticality: context can elevate (P3 switch becomes P1 during major event). Criticality inheritance: degraded higher-tier element elevates dependents.

### 10.6 Financial Authority

| Requirement | Detail |
|-------------|--------|
| Threshold-based | Each role/principal has a maximum monetary authority |
| Cumulative tracking | Running totals per principal per cost center per time window |
| Delegation with ceiling | Delegated authority cannot exceed delegator's ceiling |
| Cost center scoping | Authority scoped to cost centers |
| Budget exhaustion | Exhausted budget suspends all financial approvals for that cost center |

### 10.7 Separation of Duties and Multi-Party Approval

| Requirement | Detail |
|-------------|--------|
| N-of-M approval | Configurable per action type and criticality level |
| Role separation | Requester and approver must hold different roles. Self-approval prohibited. |
| Dual control | Two principals must act within a bounded window |
| Approval expiry | Time-bounded. Lapsed approvals must be re-obtained. |
| Break-glass | Emergency override with mandatory high-priority alerting and post-incident review |

### 10.8 Data Sovereignty

| Requirement | Detail |
|-------------|--------|
| Jurisdictional tagging | Resources tagged with jurisdiction(s) |
| Principal jurisdiction clearance | Must hold clearance for resource's jurisdiction |
| Cross-jurisdiction denial | Hard constraint — no bypass regardless of other permissions |
| Regulatory tags | PII, subscriber data, financial, location — each imposes additional constraints |
| Processing location | Certain data restricted to specific data centers |

### 10.9 Channel Visibility (SmartMarket)

| Requirement | Detail |
|-------------|--------|
| Channel-scoped visibility | Principals see only data at their channel tier and below |
| Pricing tier access | Different tiers see different pricing |
| Commission/margin visibility | Each tier sees own margin, not tiers above |
| Quota/target access | Scoped by channel tier and region |

### 10.10 SLA/Priority-Driven Dynamic Access

- P1 incident → designated responders receive temporary elevated access.
- SLA breach proximity → auto-escalation of ticket tier and authorization scope.
- Post-incident → all priority-based elevations automatically revoked with reconciliation check.

---

## 11. Two Authorization Planes

### 11.1 Resource Plane (Platform Containers)

Resources are structural containers that humans create and manage: Organization, Workspace, Project, Dataset, Dashboard, Pipeline, Configuration. Auth is RBAC roles on containers, inherited downward.

### 11.2 Ontology Plane (Domain Entities)

Ontology objects are domain entities that the real world creates: Road Segment, Incident, Officer, Challan, Network Element, Customer Account, Service Ticket. Auth is multi-layered: object security (row-level), property security (column-level), mandatory controls (scope, classification).

### 11.3 The Binding

Both planes must pass. Having Viewer on a project (resource plane) does not mean seeing all rows. Being in the right scope with the right classification (ontology plane) does not help without a role on the containing project. The binding is a `dataset` relation on every ontology object that connects it to the resource plane.

### 11.4 Dynamic Ontology

Ontology object types are created by tenants at runtime. The SpiceDB schema uses a single generic `ontology_object` definition for all types. Type-specific semantics (properties, classification slot mappings, state machines, actions) live in the Ontology Registry (PostgreSQL), not in SpiceDB. Adding a new object type requires zero SpiceDB schema changes.

---

## 12. Evaluation Chain

Every authorization request flows through this chain. Seven primitives, evaluated in order. Short-circuit on first failure.

| Step | Check | Primitive | Evaluator |
|------|-------|-----------|-----------|
| 1 | Org entitlement (product + module) | ② Organization | SpiceDB |
| 2 | Principal validity (active, member of org) | ① Principal + ② Organization | better-auth session + SpiceDB |
| 3 | Time constraints (contract, shift, JIT, seasonal) | ⑦ Constraint | Custom Runtime |
| 4 | Jurisdiction (hard gate) | ⑤ Classification | SpiceDB + Runtime |
| 5 | Regional scope | ③ Scope | SpiceDB |
| 6 | Topology/channel/department scope (if applicable) | ③ Scope | SpiceDB |
| 7 | Role permission (lattice transitive closure) | ④ Role | Runtime (cached) |
| 8 | Skill/certification (if applicable) | ⑦ Constraint | Runtime → PostgreSQL |
| 9 | Workflow state (if applicable) | ⑦ Constraint | Runtime → PostgreSQL |
| 10 | Data classification + regulatory tags | ⑤ Classification | SpiceDB |
| 11 | Asset criticality (if applicable) | ⑤ Classification | SpiceDB |
| 12 | Financial authority (if applicable) | ⑦ Constraint | Runtime → PostgreSQL |
| 13 | Resource relationship (ownership, team, sharing) | ⑥ Relationship | SpiceDB |
| 14 | Multi-party approval (if applicable) | ⑦ Constraint | Runtime → PostgreSQL |
| 15 | Explicit deny check | ⑦ Constraint | Runtime |
| → | **ALLOW** (all applicable steps passed) | | |

Not all steps apply to every request. The runtime skips irrelevant steps. Financial authority is only checked for monetary actions. Topology scope is only checked for network elements. The chain is the maximum; most requests evaluate a subset.

---

## 13. Product and Module Scoping

| Requirement | Detail |
|-------------|--------|
| Product as dimension | Product identity is a first-class dimension in the permission model |
| Module registry | Central registry defines which modules belong to which products. A module may belong to multiple products. |
| Cross-product modules | Shared modules have a single permission definition, scoped differently per product |
| Product entitlement | Org subscription determines accessible products/modules. Checked before fine-grained permissions. |
| Module-level RBAC | Roles can be scoped to specific modules |

---

## 14. Audit and Compliance

| Requirement | Detail |
|-------------|--------|
| Decision logging | Every ALLOW and DENY with full evaluation context |
| Admin action logging | Role creation, assignment changes, hierarchy mutations, vendor namespace creation, policy changes |
| Immutability | Append-only. No principal can delete or modify audit entries. |
| Retention | Configurable per org (minimum 1 year). Archived after 90 days. |
| Query capability | By principal, resource, action, time range, decision outcome, collaboration pattern |
| Export | Structured format (JSON, CSV) for SIEM integration |
| Cross-org tagging | Vendor/cross-org actions tagged with source org, target org, pattern |
| Access reviews | Periodic review with auto-revoke for uncertified access |

---

## 15. Non-Functional Requirements

| Category | Target | Notes |
|----------|--------|-------|
| Latency P50 | < 5ms | SpiceDB with warm cache; cached role lattice |
| Latency P99 | < 50ms | Including cold cache and complex traversals |
| Throughput | > 10,000 decisions/sec | SpiceDB horizontal scaling; stateless runtime |
| Availability | 99.99% | Fail-open vs fail-closed configurable per endpoint |
| Consistency lag | < 500ms target, 5s max | PostgreSQL → SpiceDB outbox sync |
| Hierarchy depth | 10+ levels | 1000+ nodes per org, no degradation |
| Role lattice | 100+ roles per org | Arbitrary DAG depth. Sub-10ms lattice traversal. |
| Multi-tenancy | 1000+ orgs | Org relation on every resource. No cross-tenant leakage. |

---

## 16. Technology Stack

| Requirement Domain | Component | Role |
|-------------------|-----------|------|
| Identity + sessions + org membership | better-auth (PostgreSQL adapter) | Embedded library. Manages user lifecycle, sessions, org membership, teams, invitations, SSO/SAML, SCIM, 2FA, API keys. |
| Structural authorization (ReBAC) | SpiceDB | Derived view of PostgreSQL state. Evaluates scope hierarchies, org membership, classification clearances, resource relationships. |
| Auth data source of truth | PostgreSQL | All auth state. better-auth tables + IAM extensions + Ontology Registry + Constraint state. |
| PostgreSQL → SpiceDB sync | Transactional outbox | Outbox event written in same transaction as business write. Background consumer writes SpiceDB tuples. |
| Decision composition | Custom Runtime (TypeScript) | Composes better-auth sessions + SpiceDB checks + Ontology Registry + constraint evaluation. Trafficure's core IP. |
| Edge auth | Traefik ForwardAuth | API gateway intercepts requests, calls custom runtime, passes auth context to services via headers. |
| Audit | OpenTelemetry → ClickHouse | Authorization decisions emitted as structured events. Stored in ClickHouse for queryable audit. |

---

## 17. Glossary

| Term | Definition |
|------|-----------|
| Principal | Any entity that can authenticate and make requests (human, service account, AI agent, vendor) |
| Organization | Tenant boundary. Outermost mandatory gate. `orgId` is the universal tenant key. |
| Scope | An org-defined hierarchy (region, topology, channel, department) where principals are assigned at nodes and access inherits downward |
| Role | A node in a DAG-structured lattice that aggregates permissions (`product:module:resource:action`) |
| Classification | A mandatory label on a resource that the principal must be cleared for. Cannot be bypassed by discretionary grants. |
| Relationship | A principal's connection to a specific resource instance (owner, team member, assignee, approver) |
| Constraint | A runtime-evaluated condition (time, workflow state, skill, financial authority, approval) |
| Ontology Object | A domain entity (road segment, incident, network element) that lives inside a dataset and is authorized independently |
| Resource | A structural platform container (project, dataset, dashboard, pipeline) that organizes work |
| Clearance Slot | A numbered position (1–4) on the organization that maps to an org-specific classification label |
| Permission Ceiling | Maximum privilege set for a vendor sub-namespace. No assignment within can exceed it. |
| Transactional Outbox | Pattern where database changes and corresponding SpiceDB sync events are written in the same PostgreSQL transaction |
| Ontology Registry | PostgreSQL-based metadata service that maps dynamic object types to the generic SpiceDB schema |
