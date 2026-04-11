# Authorization Mental Model

**Platform Fabric · The Seven-Primitive Framework**

Version 1.0 · March 2026

---

## 1. The Reduction

The authorization requirements specify 15+ evaluation steps across dozens of dimensions. These are not separate concepts. They are instances of **seven primitives**. Every authorization decision in every product reduces to a composition of these seven.

| #   | Primitive          | Question it answers                                 | Evaluator                           |
| --- | ------------------ | --------------------------------------------------- | ----------------------------------- |
| ①   | **Principal**      | Who is asking?                                      | better-auth (session validation)    |
| ②   | **Organization**   | Which tenant boundary?                              | SpiceDB (mandatory first gate)      |
| ③   | **Scope**          | Where are they authorized?                          | SpiceDB (parameterized hierarchies) |
| ④   | **Role**           | What can they do?                                   | Custom Runtime (cached DAG closure) |
| ⑤   | **Classification** | How sensitive is this resource?                     | SpiceDB (mandatory clearance slots) |
| ⑥   | **Relationship**   | What is their connection to this specific resource? | SpiceDB (owner, team, assignee)     |
| ⑦   | **Constraint**     | What conditions apply right now?                    | Custom Runtime → PostgreSQL         |

Seven primitives. Four hierarchies collapse into one Scope. Four classification categories collapse into four clearance slots. Six constraint types collapse into one runtime evaluator. The SpiceDB schema stays at ~50 lines regardless of how many tenants, object types, or dimensions exist.

---

## 2. The Seven Primitives

### ① Principal — Who is asking?

Any entity that can authenticate and make requests. Humans, service accounts, AI agents, vendor identities, and unknown future types. All share the same authorization surface.

**Key rule:** Principal type is a trait (`principalType` field on the better-auth user record), not a schema partition. Adding a new type means a new trait value, not a schema migration. SpiceDB sees all principals as `principal:{id}` regardless of type.

**Identity lifecycle:** better-auth handles registration, login, MFA, social login, SSO/SAML, passkeys, session management, API keys, and JWT tokens. It writes directly to PostgreSQL. No separate identity server.

---

### ② Organization — Which tenant boundary?

The outermost mandatory gate. Evaluated first. If the principal is not a member or guest of the organization that owns the resource, the resource is **invisible** — not denied, invisible.

**`orgId` is the universal tenant key.** Every resource, scope hierarchy, role definition, and classification label exists within an org. Personal users get an auto-created personal org with the same schema as multi-user orgs.

**Membership model:** One home org, multiple guest memberships. Each membership carries independent role, scope, and classification bindings. better-auth manages members, teams, invitations, and roles per org.

**Entitlements:** The org's subscription determines which products and modules are accessible. Checked before fine-grained permissions.

**Vendor sub-namespaces:** Organizations with `orgType: vendor_namespace`, nested within a host org. Have a permission ceiling, mandatory expiry, and audit-separated logging.

**Cross-org patterns:** Resource sharing (directed grants), guest membership (limited role in another org), joint ownership (multiple org relations), org hierarchy (parent visibility into children).

---

### ③ Scope — Where are they authorized?

**The most important reduction in the model.** Four hierarchies — regional, topology, channel, department — are four instances of one parameterized concept.

A Scope is an org-defined hierarchy of arbitrary depth where principals are assigned at nodes and access inherits downward, with optional exclusion overrides.

| Scope Dimension | Examples                                          | Products       |
| --------------- | ------------------------------------------------- | -------------- |
| Region          | Country → Circle → Zone → Division                | All            |
| Topology        | Core → Aggregation → Distribution → Access → CPE  | SmartInventory |
| Channel         | Direct → National Dist → Regional Dist → Reseller | SmartMarket    |
| Department      | Engineering → Platforms → Frontend                | All            |
| Skill Family    | Fiber → Advanced Fiber → Specialized Fiber        | SmartOps       |
| Future          | Cost Center, Security Zone, Project Portfolio     | Any            |

**One SpiceDB definition handles all scope types:**

```
definition scope_node {
  relation parent: scope_node
  relation assigned: principal
  relation excluded: principal
  permission view = (assigned - excluded) + (parent->view - excluded)
}
```

**Orthogonal intersection:** Effective access = intersection of ALL applicable scopes. A technician authorized for Access-tier AND Maharashtra can only see Access-tier elements in Maharashtra.

**Adding a new dimension** = zero SpiceDB schema changes. Just a new `scope_type` value and hierarchy data in PostgreSQL.

---

### ④ Role — What can they do?

DAG-structured lattice (directed acyclic graph). Child roles inherit the union of all parents' permissions.

**Permissions:** `<product>:<module>:<resource>:<action>`. Roles aggregate permissions. The lattice determines effective permissions via transitive closure.

**Org-scoped:** Each org defines its own lattice. Platform Super Admin is the only cross-org role.

**Evaluation:** Runtime loads lattice from PostgreSQL, computes closure, caches result. Sub-millisecond local lookups. SpiceDB stores assignments as source of truth.

---

### ⑤ Classification — How sensitive is this resource?

**Mandatory labels** on resources. Cannot be bypassed by discretionary grants. Even an Org Admin with Owner role cannot access a Restricted resource without clearance. **Mandatory > discretionary.**

**Four clearance slots** on the organization definition, mapped to org-specific meanings by the Ontology Registry:

- Mumbai TP: slot 1 = VIP_OPS, slot 2 = FORENSIC, slot 3 = INTEL, slot 4 = OFFICER_PII
- Jio: slot 1 = CORE_ACCESS, slot 2 = SUBSCRIBER_PII, slot 3 = FINANCIAL, slot 4 = TRAI_REGULATED

Same SpiceDB schema. Different semantics.

**Clearances are org-level** (one tuple per user per slot), not per-object. Property-level security: classification gates specific properties — unauthorized properties appear as `null`.

---

### ⑥ Relationship — What is their connection to this specific resource?

Resource-level ReBAC grants. Owner, team member, shared viewer/editor, assignee, approver. Binds a principal to a specific resource instance.

**Distinction from Roles:** Roles = "can do X in general." Relationships = "has connection Y to resource Z specifically." Both must be satisfied.

---

### ⑦ Constraint — What conditions apply right now?

Runtime-evaluated conditions against live PostgreSQL state. NOT stored as SpiceDB tuples (would cause constant churn).

| Constraint           | What it checks                                     |
| -------------------- | -------------------------------------------------- |
| Time window          | Contract period, shift, JIT grant, seasonal        |
| Workflow state       | State machine position → allowed actions per role  |
| Skill/certification  | Active credentials vs. required skills             |
| Financial authority  | Monetary value vs. threshold and cumulative budget |
| Multi-party approval | N-of-M approvals, role separation                  |
| Explicit deny        | Deny policies targeting principal/role/resource    |
| Priority elevation   | P1 incident → temporary elevation                  |
| Break-glass          | Emergency override with audit                      |

---

## 3. The Evaluation Chain

```
REQUEST
  → ② Org entitlement
  → ① Principal validity
  → ⑦ Time constraints
  → ⑤ Jurisdiction (hard gate)
  → ③ Scope (all applicable dimensions intersected)
  → ④ Role (cached lattice closure)
  → ⑦ Skill/certification
  → ⑦ Workflow state
  → ⑤ Classification (data, regulatory, criticality)
  → ⑦ Financial authority
  → ⑥ Relationship (ownership, team, sharing)
  → ⑦ Multi-party approval
  → ⑦ Explicit deny
  → ALLOW
```

Short-circuit on first failure. Skip irrelevant steps.

---

## 4. Two Authorization Planes

### Resource Plane — Platform Containers

What humans create: Organization → Workspace → Project → Dataset / Dashboard / Pipeline. Auth: RBAC roles on containers, inherited downward.

### Ontology Plane — Domain Entities

What the real world creates: Road Segment, Incident, Network Element, Service Ticket. Auth: object security (row-level) + property security (column-level) + mandatory controls.

### The Binding

Both planes must pass. `dataset` relation on every ontology object connects it to the resource plane. Having Viewer on a project ≠ seeing all rows. Being in the right scope ≠ accessing the project without a role.

### Dynamic Ontology

One SpiceDB definition (`ontology_object`) for all domain types. Type-specific semantics live in the Ontology Registry (PostgreSQL). New types = zero schema changes.

---

## 5. The Generic SpiceDB Schema (~50 lines)

```
definition principal {}

definition organization {
  relation member: principal
  relation guest: principal
  relation admin: principal
  relation entitled_product: product
  relation entitled_module: module
  relation cls_1_holder: principal
  relation cls_2_holder: principal
  relation cls_3_holder: principal
  relation cls_4_holder: principal
  permission access = member + guest
  permission manage = admin
}

definition scope_node {
  relation parent: scope_node
  relation assigned: principal
  relation excluded: principal
  permission view = (assigned - excluded) + (parent->view - excluded)
  permission manage = (assigned - excluded) + (parent->manage - excluded)
}

definition project {
  relation workspace: workspace
  relation org: organization
  relation owner: principal
  relation editor: principal
  relation viewer: principal
  permission admin = owner & org->access
  permission edit = (editor + owner) & org->access
  permission view = (viewer + editor + owner) & org->access
}

definition dataset {
  relation project: project
  permission view = project->view
  permission edit = project->edit
}

definition ontology_object {
  relation dataset: dataset
  relation org: organization
  relation scope: scope_node
  relation owner: principal
  relation editor: principal
  relation viewer: principal
  relation team: team
  relation assignee: principal
  permission view = (viewer + editor + owner + assignee
                     + team->member_access + scope->view)
                    & org->access & dataset->view
  permission edit = (editor + owner + team->member_access + scope->manage)
                    & org->access & dataset->edit
  permission view_cls_1 = view & org->cls_1_holder
  permission view_cls_2 = view & org->cls_2_holder
  permission view_cls_3 = view & org->cls_3_holder
  permission view_cls_4 = view & org->cls_4_holder
}

definition workspace {
  relation org: organization
  relation member: principal
  permission access = member + org->access
}

definition team {
  relation member: principal
  relation lead: principal
  permission member_access = member + lead
}

definition product {}
definition module {}
```

Schema is constant at ~10 definitions regardless of scale.

---

## 6. Consistency Model

PostgreSQL is the source of truth. SpiceDB is a derived view synced via transactional outbox. Application code writes to PostgreSQL only. The outbox consumer is the only component that writes to SpiceDB. SpiceDB is rebuildable from PostgreSQL at any time. Reconciliation job detects and repairs drift.

---

## 7. The 18-Step Mapping

| Step | Requirement           | Primitive        |
| ---- | --------------------- | ---------------- |
| 1    | Org entitlement       | ② Organization   |
| 2    | Module entitlement    | ② Organization   |
| 3    | Principal validity    | ① + ②            |
| 4    | Time constraints      | ⑦ Constraint     |
| 5    | Jurisdiction          | ⑤ Classification |
| 6    | Regional scope        | ③ Scope          |
| 7    | Topology scope        | ③ Scope          |
| 8    | Role permission       | ④ Role           |
| 9    | Skill/cert            | ⑦ Constraint     |
| 10   | Workflow state        | ⑦ Constraint     |
| 11   | Data classification   | ⑤ Classification |
| 12   | Regulatory tags       | ⑤ Classification |
| 13   | Department scope      | ③ Scope          |
| 14   | Channel scope         | ③ Scope          |
| 15   | Criticality           | ⑤ Classification |
| 16   | Financial authority   | ⑦ Constraint     |
| 17   | Resource relationship | ⑥ Relationship   |
| 18   | Multi-party approval  | ⑦ Constraint     |

Seven primitives. All eighteen steps.
