# Authorization Model Evaluation

**Seven-Primitive Framework vs. Real Products**

Version 1.0 · March 2026

---

## 1. Evaluation Method

This document tests the seven-primitive authorization model against six real products — three internal (SmartMarket, TrafiCure, SmartInventory) and five external (GitHub, Jira, Google Workspace, Salesforce, Palantir Foundry). For each product, we map every authorization concept to a primitive, identify where the model fits cleanly, where it stretches, and where it breaks.

The goal is not validation — it's stress-testing.

---

## 2. Internal Products

### 2.1 SmartMarket

**Current state** (from screenshots): Organization-level roles (Admin, Analyst), project-level roles (Owner, Editor, Viewer), seat-based licensing (51/100 Analyst licenses), labels on team members, "Manage Access" panel per project showing per-user role assignments, and project visibility settings (Private Project).

**Mapping:**

| Concept                              | Primitive        | Notes                                              |
| ------------------------------------ | ---------------- | -------------------------------------------------- |
| Organization (Lepton Software)       | ② Organization   | Clean fit. Single org boundary.                    |
| Team members (Admin, Analyst)        | ④ Role           | Org-scoped role assignment.                        |
| Project access (Owner/Editor/Viewer) | ⑥ Relationship   | Per-resource binding, not org-wide capability.     |
| Private/Public project visibility    | ⑤ Classification | Binary gate: visible to org or invite-only.        |
| Analyst license count (51/100)       | ② Organization   | Entitlement/seat limit on org.                     |
| Labels ("tes 123", "intern")         | —                | Not an authz concept today. Informational tagging. |
| Shared Projects view                 | ⑥ Relationship   | Projects shared with you = relationship exists.    |

**What works well:** SmartMarket is the simplest internal product from an authz perspective. Org → Project → Data is a clean two-level container hierarchy. The SpiceDB `project` definition with owner/editor/viewer relations handles this directly. The "Manage Access" panel (screenshot 1) maps exactly to writing `editor` and `viewer` relations on a project in SpiceDB.

**Folder cascading — the incoming complication:** When folders are introduced between org and project, the model handles this with a new `folder` definition:

```
definition folder {
  relation org: organization
  relation parent: folder
  relation editor: principal
  relation viewer: principal
  permission view = (viewer + editor) & org->access + parent->view
  permission edit = (editor) & org->access + parent->edit
}

definition project {
  relation folder: folder
  relation org: organization
  relation owner: principal
  relation editor: principal
  relation viewer: principal
  permission view = (viewer + editor + owner) & org->access + folder->view
  permission edit = (editor + owner) & org->access + folder->edit
}
```

Zero schema changes to the core model. The `folder` definition is structurally identical to `workspace` — it's a container that sets defaults.

**The override question:** Can a project inside a folder _remove_ access that the folder grants? The model as written says no — folder permission is additive (the `+` operator). If you need subtractive overrides (folder grants Editor, project revokes it for a specific user), you need an exclusion mechanism. Two options: (a) add an `excluded` relation on `project` like scope_node has, or (b) accept that overrides are only additive (you can add more access at the project level but not remove inherited access). Option (b) is simpler and matches Google Drive's behavior. Recommendation: start with additive-only, add exclusions later if customer demand justifies the complexity.

**Gap: Labels are not authorization.** The "Label" column (screenshot 4: "tes 123", "intern") appears to be a free-form tag on team members. If labels are purely informational, they're outside the model. If they later need to drive access decisions (e.g., "interns cannot access production projects"), they become either a ③ Scope dimension (intern is a department/team node) or a ⑤ Classification slot (intern as a clearance level). Don't pre-model this — wait until the use case is real.

**Verdict: Clean fit. No model changes needed.**

---

### 2.2 TrafiCure

**Current state** (from screenshots): Five-level role hierarchy (Commissioner → DCP → ACP → Inspector → Constable), each role has a data scope (city-wide vs. zone-scoped vs. proximity-based), geographic zones with road segment assignments, per-role notification thresholds, per-role access permissions (feature toggles like "Can View Analytics Module"), user management with role + primary zone + status, and a dashboard with per-role analytics.

**Mapping:**

| Concept                                          | Primitive      | Notes                                                       |
| ------------------------------------------------ | -------------- | ----------------------------------------------------------- |
| Role hierarchy (Commissioner → Constable)        | ④ Role         | Linear lattice. Each level inherits parent permissions.     |
| Geographic zones (North/South/Central/East/West) | ③ Scope        | Regional scope dimension. Zone directory = scope_node tree. |
| City-wide vs. zone-scoped data visibility        | ③ Scope        | Commissioner assigned at root, ACP assigned at zone node.   |
| Proximity-based access (Constable)               | ⑦ Constraint   | Runtime GPS check. Not a static scope assignment.           |
| Per-role feature toggles (Can View Analytics)    | ④ Role         | Permissions on the role definition.                         |
| Notification thresholds per role                 | —              | Not authorization. Service Plane configuration.             |
| Report distribution settings                     | —              | Not authorization. Service Plane configuration.             |
| User status (Active/Suspended/Deactivated)       | ① Principal    | Principal validity check.                                   |
| Reporting manager                                | ⑥ Relationship | Manager relation on principal.                              |

**Where the model shines:** The TrafiCure deployment screenshots are almost a perfect illustration of ③ Scope and ④ Role working together. The "Zones & Regions" page (screenshot 6) shows exactly what scope_node models — a geographic hierarchy with users assigned at nodes and road segments as the protected resources below. The "Role Hierarchy" page (screenshot 7) shows the five-level linear role lattice.

The critical insight: TrafiCure's current UI _conflates_ role and scope into a single concept ("Level 1: Commissioner = City-Wide"). The model correctly separates them. A Commissioner has the `senior_officer` role AND a city-wide scope assignment. An ACP has the `zone_officer` role AND a specific zone scope assignment. Today they're bound 1:1, but separation enables future flexibility — imagine a DCP who is restricted to only North Zone for a transfer period, or a temporary Commissioner with zone-only scope during an investigation.

**The reporting manager problem:** Screenshot 10 (SmartInventory) shows a "Reporting Manager" field, and from the TrafiCure context, this relationship serves multiple purposes: (a) determines approval chains for leave/overtime, (b) determines who sees whose reports, (c) determines escalation paths for incidents. In the model, this is ⑥ Relationship (`manager` relation on principal). But it also feeds into ⑦ Constraint (approval workflows require manager sign-off). The model handles this, but it's worth noting that the manager relationship is _on the principal_, not on a resource. The SpiceDB schema currently models relationships on resources (ontology_object has owner/editor/viewer). For manager-subordinate relationships, you'd add:

```
definition principal {
  relation manager: principal
}
```

This lets you write permission checks like "can view subordinate's reports" as a SpiceDB query. Works.

**The proximity constraint:** Constables in TrafiCure get proximity-based alerts — they see data based on GPS location, not zone assignment. This is ⑦ Constraint, evaluated at runtime against live location data. The model explicitly says constraints are "NOT stored as SpiceDB tuples (would cause constant churn)." Correct. GPS-based access is a runtime check in the application layer, not a SpiceDB relationship.

**Notification thresholds are NOT authorization.** This is important. The screenshots show per-role notification thresholds (min alert duration, min severity, max notifications/hour, quiet hours). These look like they live alongside authorization config, but they're Tier 3 (Service Plane) configuration. The model shouldn't try to absorb them. They happen to be keyed by role, but they don't gate access to anything — they configure behavior. Keep them in the Service Plane SDK as role-keyed application config.

**The "deployment-specific role names" pattern:** Screenshot 7 shows "Role Hierarchy — Bangalore Deployment" with role names like Commissioner, DCP, ACP, Inspector, Constable. The authz mental model's role aliasing concept handles this — backend uses generic role template IDs (level_1, level_2, ...), each deployment maps to display names. A Mumbai deployment might use "SHO" instead of "Commissioner." This is already designed correctly in the model.

**Verdict: Strong fit. Role/scope separation is an improvement over current conflated model. Manager relationship needs `principal` definition extension. Proximity is a clean constraint case. Notification config correctly excluded.**

---

### 2.3 SmartInventory

**Current state** (from screenshots): Three-step user creation (User Details → Module Rights → Work Area Details), per-entity per-lifecycle-state per-CRUD permission matrix, reporting manager hierarchy, user types (Partner, internal), application access modes (Web/Mobile/Both), vendor IDs, and a "Rights Management" section in the sidebar.

**Mapping:**

| Concept                                      | Primitive                  | Notes                                                         |
| -------------------------------------------- | -------------------------- | ------------------------------------------------------------- |
| User Role (View Dashboard)                   | ④ Role                     | Named role with permission set.                               |
| Module Rights matrix (entity × state × CRUD) | ④ Role                     | Permissions aggregated into roles. **This is the hard case.** |
| Lifecycle states (Planned/As-Built/Dormant)  | ⑤ Classification OR ④ Role | See analysis below.                                           |
| Work Area (Step 3 of user creation)          | ③ Scope                    | Geographic/topology scope assignment.                         |
| Reporting Manager                            | ⑥ Relationship             | Manager relation on principal.                                |
| User Type (Partner)                          | ① Principal                | Principal trait (type field).                                 |
| Application Access (Web/Mobile/Both)         | ⑦ Constraint               | Runtime constraint on access channel.                         |
| Vendor ID                                    | ② Organization             | Vendor sub-namespace binding.                                 |
| Is Admin Rights Allowed?                     | ④ Role                     | Boolean permission ceiling.                                   |

**The entity × lifecycle × CRUD matrix (screenshot 11) — the model's hardest test.**

This matrix shows entity types on rows (ADB, Antenna, Area, Building, Cabinet, Cable, CDB, Competitor), lifecycle states as column groups (Planned, As-Built, Dormant), and CRUD operations as sub-columns under each state. A role defines exactly which entity types, in which lifecycle state, a user can Add/Edit/Delete/View.

This produces a permission space of: `entity_count × lifecycle_states × CRUD_operations`. With ~30 entity types × 3 states × 4 operations = ~360 individual permission bits per role.

**Option A — Flatten into permissions:** Each bit becomes a permission string:

```
smartinventory:network:antenna:planned:edit
smartinventory:network:antenna:asbuilt:view
smartinventory:network:cabinet:dormant:delete
```

Roles aggregate these permissions. The lattice closure computes effective permissions. This is semantically correct but produces very large permission sets per role. At 360 permissions per role × N roles, the cached lattice closure is heavy but bounded. This is fine for a product with < 20 roles.

**Option B — Treat lifecycle state as classification:** Lifecycle state (Planned/As-Built/Dormant) becomes three classification slots. A user needs both the role permission (antenna:edit) AND the classification clearance (planned_holder) to edit a planned antenna. This reduces the permission space to ~120 (entity × CRUD) plus 3 classification slots per user. Cleaner, but lifecycle state isn't really about sensitivity — it's about data maturity.

**Option C — Treat lifecycle state as a resource property, filter at query time:** The role grants `antenna:edit`. The application layer checks whether the specific antenna record's lifecycle_state is one the user is authorized for. This is a ⑦ Constraint — a runtime check against the resource's current state. The authorization model stays small (~120 permission bits), and lifecycle authorization is a constraint evaluation.

**Recommendation: Option C.** Lifecycle state is a property of the resource, not a dimension of the permission system. The role says "you can edit antennas." The constraint says "you can only edit antennas in Planned and As-Built states." This keeps the role lattice manageable, the SpiceDB schema unchanged, and the lifecycle-state mapping in the Ontology Registry where it belongs. The constraint evaluator checks `resource.lifecycle_state IN user.allowed_lifecycle_states`.

**Work Area — scope in action:** Step 3 of user creation assigns the user to work areas. This is exactly ③ Scope — the topology dimension from the authz model (Core → Aggregation → Distribution → Access → CPE). The user can only see and modify network elements within their assigned work area. Implemented as scope_node assignment in SpiceDB.

**The Partner/Vendor dimension:** SmartInventory has User Type = Partner, with Vendor ID and PAN fields. In the model, this maps to the vendor sub-namespace concept: an organization with `orgType: vendor_namespace`, nested within the host org, with a permission ceiling and mandatory expiry. The "Is Admin Rights Allowed?" checkbox is the permission ceiling toggle.

**Verdict: Fits with the lifecycle-state-as-constraint adaptation. The entity × state × CRUD matrix is the most demanding case but Option C handles it without model changes. Work Area is a direct scope_node application.**

---

## 3. External Products

### 3.1 GitHub

**Authorization concepts:** Organization → Teams → Repositories. Roles at org level (Owner, Member, Billing Manager) and repo level (Admin, Maintain, Write, Triage, Read). Teams as groups. Branch protection rules. CODEOWNERS for required reviewers. Repository visibility (Public/Private/Internal). Fine-grained PATs with scoped permissions. Deploy keys. GitHub Apps with installation permissions.

**Mapping:**

| Concept                                   | Primitive        | Fit quality                                                       |
| ----------------------------------------- | ---------------- | ----------------------------------------------------------------- |
| Organization                              | ② Organization   | Direct.                                                           |
| Teams                                     | team definition  | Groups with member/lead relations.                                |
| Org roles (Owner/Member)                  | ④ Role           | Org-scoped.                                                       |
| Repo roles (Admin/Write/Triage/Read)      | ⑥ Relationship   | Per-resource binding (not org-wide).                              |
| Repo visibility (Public/Private/Internal) | ⑤ Classification | Binary/ternary gate.                                              |
| Branch protection                         | ⑦ Constraint     | Conditional rules on specific branches.                           |
| Required reviewers (CODEOWNERS)           | ⑦ Constraint     | Multi-party approval requirement.                                 |
| Fine-grained PATs                         | ④ Role + ③ Scope | Token has a permission set AND a resource scope (specific repos). |
| GitHub Apps                               | ① Principal      | Service account with declared capabilities.                       |
| Deploy keys                               | ① Principal      | Machine identity scoped to repo.                                  |

**Analysis:** GitHub fits well with one interesting nuance. GitHub's team-based permissions are _additive_ — if you're in two teams, you get the union of both teams' access. This matches the model's `permission view = ... + team->member_access`. GitHub does NOT support exclusions (you can't say "Team A has Write, but Bob in Team A is restricted to Read"). The model's `excluded` relation on scope_node goes further than GitHub does, which is fine — it means the model can express everything GitHub does plus more.

The fine-grained PAT case is worth noting. A PAT combines a permission set (what operations) with a resource scope (which repos). This is ④ Role × ③ Scope intersected on a service identity (① Principal). The model handles this if you treat the PAT as a principal with a role binding scoped to specific repositories.

**What the model doesn't cover:** GitHub's "outside collaborator" concept — a user who has repo access without org membership. In the model, this would require the organization gate (②) to allow non-members to access specific resources. The model handles this with the `guest` relation on organization: `permission access = member + guest`. The guest gets per-resource bindings (⑥) without full org membership.

**Verdict: Clean fit. The model handles everything GitHub does, including edge cases like outside collaborators and fine-grained PATs.**

---

### 3.2 Jira

**Authorization concepts:** Site → Projects → Issues. Global permissions (admin, browse users). Project roles (Admin, Member, Viewer) via permission schemes. Issue security levels. Workflow transitions gated by permissions. Field-level security. Groups for bulk assignment. Custom project role types. Notification schemes.

**Mapping:**

| Concept                             | Primitive          | Fit quality                                                          |
| ----------------------------------- | ------------------ | -------------------------------------------------------------------- |
| Jira site                           | ② Organization     | Top-level boundary.                                                  |
| Projects                            | project definition | Container with role bindings.                                        |
| Permission schemes                  | ④ Role             | Templates of permissions applied to projects. Exactly role aliasing. |
| Issue security levels               | ⑤ Classification   | Mandatory gate on issue visibility.                                  |
| Workflow transitions                | ⑦ Constraint       | State machine position → allowed actions per role.                   |
| Field-level security                | ⑤ Classification   | Property-level classification.                                       |
| Groups                              | team definition    | Groups for bulk assignment.                                          |
| Project roles (Admin/Member/Viewer) | ⑥ Relationship     | Per-project bindings.                                                |
| Global permissions                  | ④ Role             | Site-scoped role permissions.                                        |
| Reporter/Assignee/Watcher           | ⑥ Relationship     | Per-issue resource relationships.                                    |

**Analysis:** Jira's "permission scheme" concept is the most interesting mapping. A permission scheme is a named template that defines which project roles get which permissions. When you apply a scheme to a project, it instantiates role bindings. This is _exactly_ the role aliasing layer in the model — backend uses generic scheme IDs, each project maps to specific role-permission combinations.

Jira's issue security levels are a direct classification case. A "Confidential" issue is only visible to users with the corresponding security level clearance. This maps to the classification slots on organization, with the semantics defined per-Jira-site.

Workflow transitions gated by permissions are a clean ⑦ Constraint case. "Only Approvers can transition from Review to Done" is a workflow-state constraint.

**What pushes the model:** Jira's "scheme" pattern (permission scheme, notification scheme, workflow scheme) applies configuration templates at the project level. The model handles the _authorization_ scheme (permission schemes → role aliasing). The notification and workflow schemes are Service Plane configuration, not authorization. The model correctly excludes them.

**Verdict: Strong fit. Permission schemes map directly to role aliasing. Issue security levels are classification. Workflow transitions are constraints.**

---

### 3.3 Google Workspace (Drive + Admin)

**Authorization concepts:** Organization → Organizational Units (OUs) → Users. Shared Drives → Folders → Files. File roles (Owner, Editor, Commenter, Viewer). Folder inheritance. Link sharing (Anyone with link, Anyone in org, Specific people). Admin roles with delegated administration. DLP (Data Loss Prevention) policies. IRM (Information Rights Management). Target audiences for sharing.

**Mapping:**

| Concept                                    | Primitive                  | Fit quality                                    |
| ------------------------------------------ | -------------------------- | ---------------------------------------------- |
| Google Workspace org                       | ② Organization             | Direct.                                        |
| Organizational Units (OUs)                 | ③ Scope                    | Admin delegation hierarchy.                    |
| Shared Drives                              | Container (like workspace) | Collaboration boundary.                        |
| Folders                                    | Container (like folder)    | Intermediate container with inheritance.       |
| Files                                      | Resource (like dataset)    | Leaf resource.                                 |
| File roles (Owner/Editor/Commenter/Viewer) | ⑥ Relationship             | Per-resource bindings.                         |
| Folder inheritance                         | Container hierarchy        | "Containers set defaults, resources override." |
| Link sharing (anyone with link)            | ⑥ Relationship             | Special anonymous/org-wide relation.           |
| Admin roles                                | ④ Role                     | Org-scoped administrative capabilities.        |
| DLP labels                                 | ⑤ Classification           | Mandatory control on sensitive data.           |
| Target audiences                           | ③ Scope OR team            | Named groups for sharing suggestions.          |

**Analysis:** Google Drive's folder → file inheritance is the canonical case for "containers set defaults, resources override." When you share a folder with Editor access, all files inside inherit it. When you share a specific file with a different role, that _adds_ to the inherited access (it doesn't replace it — same as the model's additive `+` operator).

Google Drive's "link sharing" modes are interesting. "Anyone with the link" creates an anonymous relationship — in SpiceDB terms, a relation to a special `everyone` principal. "Anyone in the organization" creates a relation to the org itself. "Specific people" creates individual relations. All three are ⑥ Relationship, just with different principal targets.

**Where the model needs thought:** Google Drive allows removing inherited access at the file level. If a folder grants Editor to Alice, the folder owner can go to a specific file and remove Alice's access to just that file. This is subtractive override — the model's additive-only approach (as recommended for SmartMarket) wouldn't support this. Google implements this as "remove inherited permission" which effectively creates an exclusion. If you need this capability, the `excluded` relation pattern from scope_node should be added to the resource definitions.

**DLP as mandatory control:** Google Workspace's DLP policies scan content and apply labels (e.g., "Contains credit card numbers"). These labels can restrict sharing — you can't share DLP-labeled files outside the org even if you have Owner access. This is exactly ⑤ Classification: mandatory controls that override discretionary grants. The model's four classification slots handle this.

**Verdict: Strong fit. Folder inheritance is the model's container pattern. Link sharing maps to relationship variants. DLP is classification. Subtractive overrides at file level require the excluded relation pattern.**

---

### 3.4 Salesforce

**Authorization concepts:** Organization → Profiles → Users. Role hierarchy for record visibility (record-level sharing). Permission Sets (additive permissions). Sharing Rules (ownership-based and criteria-based). Organization-Wide Defaults (OWD — private, public read, public read/write). Field-Level Security (FLS). Territory Management. Custom permissions. Sharing Sets. Named Credentials.

**Mapping:**

| Concept                         | Primitive        | Fit quality                                                     |
| ------------------------------- | ---------------- | --------------------------------------------------------------- |
| Salesforce org                  | ② Organization   | Direct.                                                         |
| Profiles                        | ④ Role           | Base role assignment (one per user).                            |
| Permission Sets                 | ④ Role           | Additive role extensions (many per user).                       |
| Role Hierarchy (for visibility) | ③ Scope          | This IS a scope hierarchy — managers see subordinates' records. |
| Organization-Wide Defaults      | ⑤ Classification | Object-level baseline visibility setting.                       |
| Sharing Rules (ownership-based) | ⑥ Relationship   | Owner shares with group based on ownership.                     |
| Sharing Rules (criteria-based)  | ⑦ Constraint     | Runtime criteria evaluation (e.g., region = "West").            |
| Field-Level Security            | ⑤ Classification | Property-level classification gate.                             |
| Territory Management            | ③ Scope          | Geographic scope dimension.                                     |
| Record ownership                | ⑥ Relationship   | Owner relation on record.                                       |
| Manual sharing                  | ⑥ Relationship   | Discretionary per-record grant.                                 |

**Analysis:** Salesforce is the most complex authorization system in common enterprise use, and it maps surprisingly well to the seven primitives.

The key insight: **Salesforce's "role hierarchy" is not a role lattice — it's a scope hierarchy.** In Salesforce, if Alice is above Bob in the role hierarchy, Alice can see all of Bob's records. The hierarchy determines _visibility_, not _capability_. Alice and Bob might have identical Permission Sets (same actions), but Alice sees more records because of her position. This is exactly ③ Scope — a hierarchy where assignment at a node grants visibility downward.

Salesforce's OWD (Organization-Wide Default) per object type is a classification-like concept. Setting an object's OWD to "Private" means no one sees others' records by default — then the role hierarchy, sharing rules, and manual sharing _open up_ access. Setting it to "Public Read/Write" means everyone sees everything — then field-level security and sharing rules _restrict_ access. This is the mandatory/discretionary split from the model: OWD is the mandatory baseline, sharing rules are discretionary extensions.

**Where Salesforce stresses the model:** Salesforce's criteria-based sharing rules are the most complex constraint type. "Share all Opportunities where Amount > $1M and Region = 'West' with the VP-West group." This is a ⑦ Constraint that combines resource properties (Amount, Region) with group membership. The model's constraint evaluator handles this — it evaluates conditions against live PostgreSQL state — but the _rule definition_ needs to be stored somewhere. In the model, this would be a `policy` record in the Control Plane that the constraint evaluator loads.

**Territory Management is a second scope dimension.** Salesforce allows both role hierarchy AND territory hierarchy to independently determine record visibility. Users can be assigned to territories, and records can be assigned to territories. Visibility flows through both hierarchies independently, then results are unioned. This maps to the model's orthogonal scope intersection — except in Salesforce the scopes are _unioned_ (you see records if you're authorized by role hierarchy OR territory), while the authz model's scopes are _intersected_ (you must be authorized by ALL applicable scope dimensions). This is a significant difference.

**The union vs. intersection question:** Salesforce uses union (scope A OR scope B grants access). The authz model uses intersection (scope A AND scope B required). Both are valid but serve different purposes. Union is more permissive — good for "multiple paths to access." Intersection is more restrictive — good for "multi-dimensional security clearance." The model should acknowledge that some products need union semantics for scopes. This could be a per-scope-dimension configuration: some dimensions intersect, some union.

**Verdict: Strong fit with one model adjustment needed. The scope union vs. intersection semantic should be configurable per scope dimension. Salesforce's role hierarchy is a clean scope mapping. OWD is a classification-like baseline. Criteria-based sharing rules are constraint policies.**

---

### 3.5 Palantir Foundry

**Authorization concepts:** Organizations as hard tenant walls. Spaces for collaboration. Projects as primary security boundary. Markings (mandatory orthogonal classification). Project roles (Owner, Editor, Viewer, Discoverer). Object security (row-level). Property security (column-level). Groups with project role inheritance. Branching and transactions with permission inheritance.

**Mapping:**

| Concept                                        | Primitive                  | Fit quality                                         |
| ---------------------------------------------- | -------------------------- | --------------------------------------------------- |
| Organization                                   | ② Organization             | Direct. Hard tenant wall.                           |
| Space                                          | Container (like workspace) | Collaboration scope.                                |
| Project                                        | project definition         | Primary security boundary.                          |
| Markings                                       | ⑤ Classification           | This is where the model borrowed from. Exact match. |
| Project roles (Owner/Editor/Viewer/Discoverer) | ⑥ Relationship             | Per-project bindings.                               |
| Object security (row-level)                    | ontology_object definition | Row-level access on domain entities.                |
| Property security (column-level)               | ⑤ Classification           | Classification gates specific properties.           |
| Groups                                         | team definition            | Groups with role inheritance.                       |
| Discoverer role                                | ⑥ Relationship             | Can see resource exists, cannot read content.       |

**Analysis:** Foundry maps almost perfectly because the model was partially derived from studying it. The four classification slots were directly inspired by Foundry's Markings system.

**The "Discoverer" role is interesting.** Foundry has four project roles: Owner > Editor > Viewer > Discoverer. The Discoverer can see that a resource exists (name, description, metadata) but cannot read its content. This is a permission level below "view" — call it "discover" or "list." The model's SpiceDB schema has `view` and `edit` but not `discover`. Adding it is straightforward:

```
definition project {
  relation discoverer: principal
  permission discover = (discoverer + viewer + editor + owner) & org->access
  permission view = (viewer + editor + owner) & org->access
  permission edit = (editor + owner) & org->access
}
```

This is a useful addition for any product where resource discovery and resource access are separate privileges (common in data platforms).

**Foundry's branching model:** Foundry allows creating branches of datasets (like Git branches for data). Permissions on a branch inherit from the parent dataset's project. This is container inheritance operating on a versioning dimension — the model handles it through the dataset → project → workspace chain without changes.

**Verdict: Near-perfect fit. Model was partially derived from Foundry. "Discoverer" permission level is a useful addition to the SpiceDB schema.**

---

## 4. Cross-Product Findings

### 4.1 What Works Across All Products

**① Principal** — universal. Every product has users, service accounts, and increasingly AI agents. The trait-based approach (type as a field, not a schema partition) holds.

**② Organization** — universal. Every product has a top-level tenant boundary. The model's "first gate, evaluated first, invisible not denied" rule holds.

**④ Role** — universal. Every product aggregates permissions into named roles. The lattice/hierarchy structure handles both simple (SmartMarket: Admin/Analyst) and complex (TrafiCure: 5-level hierarchy, SmartInventory: per-entity permission matrix) cases.

**⑥ Relationship** — universal. Every product has per-resource access grants (owner, editor, viewer, assignee).

### 4.2 What Varies and Needs Flexibility

**③ Scope — union vs. intersection semantics.** The model assumes scope dimensions intersect (AND). Salesforce uses union (OR) for role hierarchy vs. territory. The fix is to make the combination operator configurable per scope dimension pair.

**⑤ Classification — sensitivity vs. state vs. visibility.** Classification is used for three different things across products: data sensitivity (Foundry Markings, DLP labels), data lifecycle state (SmartInventory: Planned/As-Built/Dormant), and visibility baseline (Salesforce OWD, GitHub repo visibility). The model's four generic slots handle all three, but the _semantics_ vary significantly. The Ontology Registry mapping each slot to org-specific meaning is the right approach — just be explicit that classification slots aren't only about "sensitivity."

**⑦ Constraint — the catch-all.** Constraints handle everything from GPS proximity (TrafiCure) to criteria-based sharing rules (Salesforce) to branch protection (GitHub) to workflow transitions (Jira). This is by design — the constraint primitive is intentionally broad. But it means the constraint evaluator needs to be extensible. Each product will need product-specific constraint types. The model should provide the framework (evaluate constraints against live state, short-circuit on failure, audit the result) and let each product register its constraint types.

### 4.3 What the Model Doesn't Cover (and Shouldn't)

**Notification and configuration schemes.** Jira has notification schemes, TrafiCure has per-role notification thresholds, GitHub has watch/notification settings. These are keyed by role but are not authorization — they're application behavior. Correctly excluded from the model. They belong in Service Plane Tier 3 config.

**Audit and compliance reporting.** All products need audit trails of authorization decisions. The model mentions audit but doesn't specify the audit schema. This is a Control Plane concern, not an authorization model concern.

**Self-service permission requests.** "Request access" workflows (common in Google Workspace, Salesforce, Foundry) are workflow concerns, not authorization model concerns. The model evaluates permissions; the workflow system manages the process of granting them.

### 4.4 Model Adjustments Recommended

**1. Add `discover` permission level.** Multiple products (Foundry, Google Drive, potentially SmartMarket) need a permission below `view` that allows seeing a resource exists without reading its content. Add to project, dataset, and ontology_object definitions.

**2. Make scope combination operator configurable.** Default to intersection (AND) for security-sensitive products. Allow union (OR) for products where multiple independent paths to access are desirable. This is a per-product or per-scope-dimension-pair configuration.

**3. Add `excluded` relation on resource containers.** The folder and project definitions should support exclusions for products that need subtractive overrides (Google Drive, potentially SmartMarket folders). Not all products need this — make it opt-in.

**4. Add `manager` relation on principal.** TrafiCure and SmartInventory both use reporting manager relationships for access determination (manager sees subordinate data) and workflow (manager approves actions). Add to the principal definition.

**5. Lifecycle state as constraint, not classification.** SmartInventory's Planned/As-Built/Dormant should be a ⑦ Constraint, not a ⑤ Classification. Classification is for sensitivity; lifecycle state is a resource property that gates action eligibility. The constraint evaluator checks `resource.lifecycle_state IN user.allowed_states`.

**6. Anonymous/public access as a relationship target.** Google Drive's "anyone with the link" and GitHub's public repos need a way to express access for unauthenticated or all-org principals. Add special principal references (`principal:*` for public, `org:{id}:members` for all-org) that can be relationship targets.

---

## 5. Scorecard

| Product              | Primitives Used | Clean Fit |            Stretch             | Breaks |
| -------------------- | :-------------: | :-------: | :----------------------------: | :----: |
| **SmartMarket**      |      ①②④⑤⑥      |    5/5    |               —                |   —    |
| **TrafiCure**        |     ①②③④⑥⑦      |    6/6    |      Proximity constraint      |   —    |
| **SmartInventory**   |     ①②③④⑤⑥⑦     |    5/7    | Lifecycle state, entity matrix |   —    |
| **GitHub**           |     ①②④⑤⑥⑦      |    6/6    |       Fine-grained PATs        |   —    |
| **Jira**             |     ①②④⑤⑥⑦      |    6/6    |               —                |   —    |
| **Google Workspace** |     ①②③④⑤⑥      |    5/6    |     Subtractive overrides      |   —    |
| **Salesforce**       |     ①②③④⑤⑥⑦     |    5/7    | Scope union, criteria sharing  |   —    |
| **Palantir Foundry** |      ①②④⑤⑥      |    5/5    |               —                |   —    |

Nothing breaks. The model handles every product tested with at most two "stretch" cases per product. The five recommended adjustments (discover permission, configurable scope operators, exclusions on containers, manager relation, public access targets) are additions, not redesigns.

---

## 6. What This Tells Us About the Model

The seven-primitive framework is genuinely reductive — it's not just a relabeling of concepts. The proof is that wildly different authorization systems (SmartInventory's 360-permission matrix, Salesforce's criteria-based sharing rules, TrafiCure's proximity-based alerts, GitHub's branch protection) all decompose into compositions of the same seven primitives.

The model's strongest property is that adding a new product doesn't change the SpiceDB schema. SmartMarket, TrafiCure, SmartInventory, and any future product all use the same ~50-line schema. Product-specific semantics (what roles mean, what scopes represent, what classifications gate) live in the Ontology Registry and runtime constraint evaluators, not in the authorization infrastructure.

The model's weakest point is the constraint primitive (⑦). It's correct but underspecified. "Evaluate conditions against live state" is the right abstraction, but each product needs a different set of condition types, and there's no shared framework for defining, registering, and evaluating them. This is the next design task: a constraint type registry with a standard evaluation interface.
