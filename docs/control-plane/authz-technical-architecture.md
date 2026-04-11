# Authorization Technical Architecture

**Platform Fabric · better-auth + SpiceDB + PostgreSQL**

Version 1.0 · March 2026

---

## 1. Stack

| Concern                            | Component                       | Notes                                                                                                                                  |
| ---------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Identity, sessions, org management | **better-auth**                 | Embedded library. PostgreSQL adapter. Organization plugin for multi-tenancy. SSO/SAML, SCIM, 2FA, API keys, passkeys, JWT via plugins. |
| Structural authorization (ReBAC)   | **SpiceDB**                     | Evaluates scope hierarchies, org membership, classification clearances, resource relationships. Sub-5ms cached checks.                 |
| Source of truth                    | **PostgreSQL**                  | All auth state. better-auth tables + IAM extensions + Ontology Registry + constraint state.                                            |
| PostgreSQL → SpiceDB sync          | **Transactional outbox**        | Outbox event written in same transaction as business write. Background consumer writes SpiceDB tuples.                                 |
| Decision composition               | **Custom Runtime** (TypeScript) | Composes better-auth sessions + SpiceDB checks + Ontology Registry + constraint evaluation.                                            |
| Edge auth                          | **Traefik ForwardAuth**         | Intercepts requests, calls custom runtime, passes auth context to services via headers.                                                |
| Audit storage                      | **ClickHouse**                  | Authorization decisions emitted via OpenTelemetry structured events.                                                                   |

### Why better-auth

better-auth runs as a library in the backend process. No separate identity server to deploy. Writes directly to PostgreSQL. For air-gapped Sites, this eliminates a critical infrastructure dependency. The organization plugin provides multi-tenancy (orgs, members, teams, roles, invitations) with dynamic access control out of the box. SSO/SAML, SCIM, API keys, 2FA, and passkeys extend via plugins, all writing to the same database.

### Why SpiceDB as derived view

SpiceDB excels at fast relationship evaluation, not at being a general-purpose database. Treating it as derived from PostgreSQL avoids dual-write consistency problems. If SpiceDB is lost, it is rebuilt from PostgreSQL. The outbox pattern makes sync reliable and retryable.

---

## 2. PostgreSQL Schema Layout

```
PostgreSQL
├── auth.*                    ← better-auth managed (DO NOT modify directly)
│   ├── user                   ← all principal types (human, service, agent)
│   ├── session                ← active sessions with activeOrganizationId
│   ├── account                ← OAuth/social linked accounts
│   ├── verification           ← email verification, password reset tokens
│   ├── organization           ← orgs (tenant boundary)
│   ├── member                 ← org membership
│   ├── invitation             ← pending org invitations
│   ├── team                   ← teams within orgs
│   ├── team_member            ← team membership
│   ├── organization_role      ← dynamic roles per org (better-auth DAC)
│   ├── organization_permission ← permissions per role
│   ├── api_key                ← API keys for service accounts
│   └── two_factor             ← 2FA configuration
│
├── iam.*                     ← Platform Fabric authorization extensions
│   ├── scope_type             ← registry of scope dimensions per org
│   ├── scope_node             ← ALL hierarchies (region, topology, channel, dept)
│   ├── scope_assignment       ← principal → scope_node bindings
│   ├── scope_exclusion        ← explicit deny overrides
│   ├── classification_type    ← classification categories per org
│   ├── classification_label   ← labels within each category
│   ├── classification_grant   ← principal clearances (org-wide)
│   ├── resource_classification ← labels applied to resources/objects
│   ├── permission_definition  ← product:module:resource:action registry
│   ├── role_permission        ← role → permission mappings
│   ├── role_parent            ← role lattice edges (DAG)
│   ├── entitlement            ← org → product/module entitlements
│   └── authz_outbox           ← transactional outbox for SpiceDB sync
│
├── ontology.*                ← Ontology Registry (type metadata)
│   ├── object_type_definition  ← per org, per type, versioned
│   ├── property_definition     ← property schemas with classification slot mapping
│   ├── action_type_definition  ← authorized actions per type
│   ├── link_type_definition    ← typed relationships between types
│   ├── state_machine_definition ← workflow states and transitions
│   └── state_permission_mapping ← state → allowed actions per role
│
├── constraint.*              ← Runtime constraint state
│   ├── skill_definition        ← org-defined skill catalog
│   ├── skill_certification     ← principal × skill × expiry
│   ├── financial_authority     ← principal × cost_center × threshold
│   ├── financial_ledger        ← cumulative tracking
│   ├── approval_request        ← N-of-M approval state
│   ├── jit_grant               ← time-bounded temporary elevations
│   └── break_glass_log         ← emergency override audit
│
└── audit.*                   ← Immutable audit trail
    ├── auth_decision_log
    ├── admin_action_log
    └── hierarchy_mutation_log
```

---

## 3. better-auth Configuration

```typescript
import { betterAuth } from "better-auth"
import { organization } from "better-auth/plugins"
import { twoFactor } from "better-auth/plugins"
import { apiKey } from "better-auth/plugins"
import { bearer } from "better-auth/plugins"
import { sso } from "better-auth/plugins"
import { scim } from "better-auth/plugins"
import { admin } from "better-auth/plugins"
import { jwt } from "better-auth/plugins"
import { Pool } from "pg"
import { spicedbSyncPlugin } from "./plugins/spicedb-sync"
import { ac } from "./permissions"

export const auth = betterAuth({
  database: new Pool({
    connectionString: process.env.DATABASE_URL,
    options: "-c search_path=auth",
  }),

  advanced: { database: { generateId: "uuid" } },
  experimental: { joins: true },

  session: {
    expiresIn: 60 * 60 * 24, // 24 hours
    updateAge: 60 * 60, // refresh every hour
  },

  user: {
    additionalFields: {
      principalType: {
        type: "string",
        required: true,
        defaultValue: "human",
        // human | service_account | ai_agent | external_vendor
      },
      displayPosition: {
        type: "string",
        required: false,
        // Informational only — NOT used for authorization
      },
    },
  },

  plugins: [
    organization({
      ac,
      dynamicAccessControl: { enabled: true },
      schema: {
        organization: {
          additionalFields: {
            orgType: {
              type: "string",
              defaultValue: "team",
              // personal | team | enterprise | vendor_namespace
            },
            parentOrgId: {
              type: "string",
              required: false,
            },
            permissionCeiling: {
              type: "string", // JSON: max permission set for vendor namespaces
              required: false,
            },
            expiresAt: {
              type: "date", // mandatory for vendor_namespace
              required: false,
            },
          },
        },
        member: {
          additionalFields: {
            membershipType: {
              type: "string",
              defaultValue: "member",
              // member | guest | admin
            },
          },
        },
      },
    }),
    twoFactor(),
    apiKey(),
    bearer(),
    jwt(),
    sso(),
    scim(),
    admin(),
    spicedbSyncPlugin(), // custom: syncs auth changes to SpiceDB via outbox
  ],
})
```

---

## 4. IAM Extension Tables (DDL)

### 4.1 Scope System

```sql
CREATE TABLE iam.scope_type (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES auth.organization(id),
  name TEXT NOT NULL,              -- 'region', 'topology', 'channel', 'department'
  display_name TEXT NOT NULL,
  inherits_down BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, name)
);

CREATE TABLE iam.scope_node (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES auth.organization(id),
  scope_type_id UUID NOT NULL REFERENCES iam.scope_type(id),
  parent_id UUID REFERENCES iam.scope_node(id),
  name TEXT NOT NULL,
  code TEXT,                       -- slug for API usage
  level_name TEXT,                 -- org-defined: 'Country', 'Circle', 'Zone'
  depth INT NOT NULL DEFAULT 0,
  path TEXT NOT NULL,              -- materialized path: '/root/zone1/divA'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, scope_type_id, code)
);
CREATE INDEX idx_scope_node_path ON iam.scope_node USING btree(org_id, scope_type_id, path text_pattern_ops);

CREATE TABLE iam.scope_assignment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES auth.user(id),
  scope_node_id UUID NOT NULL REFERENCES iam.scope_node(id),
  org_id UUID NOT NULL REFERENCES auth.organization(id),
  granted_by UUID REFERENCES auth.user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(principal_id, scope_node_id)
);

CREATE TABLE iam.scope_exclusion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES auth.user(id),
  scope_node_id UUID NOT NULL REFERENCES iam.scope_node(id),
  org_id UUID NOT NULL REFERENCES auth.organization(id),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(principal_id, scope_node_id)
);
```

### 4.2 Classification System

```sql
CREATE TABLE iam.classification_type (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES auth.organization(id),
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  slot_number INT NOT NULL,        -- maps to SpiceDB cls_1..cls_4
  is_hard_gate BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, slot_number),
  CHECK(slot_number BETWEEN 1 AND 4)
);

CREATE TABLE iam.classification_label (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  classification_type_id UUID NOT NULL REFERENCES iam.classification_type(id),
  org_id UUID NOT NULL REFERENCES auth.organization(id),
  name TEXT NOT NULL,
  severity_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(classification_type_id, name)
);

CREATE TABLE iam.classification_grant (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES auth.user(id),
  classification_label_id UUID NOT NULL REFERENCES iam.classification_label(id),
  org_id UUID NOT NULL REFERENCES auth.organization(id),
  granted_by UUID REFERENCES auth.user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(principal_id, classification_label_id)
);

CREATE TABLE iam.resource_classification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type TEXT NOT NULL,
  resource_id UUID NOT NULL,
  classification_label_id UUID NOT NULL REFERENCES iam.classification_label(id),
  org_id UUID NOT NULL REFERENCES auth.organization(id),
  applied_by UUID REFERENCES auth.user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(resource_type, resource_id, classification_label_id)
);
```

### 4.3 Role Lattice (extends better-auth's organization roles)

```sql
-- Role lattice edges (DAG). Extends better-auth's organization_role table.
CREATE TABLE iam.role_parent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_role_id UUID NOT NULL,  -- references auth.organization_role(id)
  parent_role_id UUID NOT NULL, -- references auth.organization_role(id)
  org_id UUID NOT NULL REFERENCES auth.organization(id),
  UNIQUE(child_role_id, parent_role_id)
);

-- Fine-grained permissions (product:module:resource:action)
CREATE TABLE iam.permission_definition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,       -- 'trafficure:planning:simulation:create'
  product TEXT NOT NULL,
  module TEXT NOT NULL,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  description TEXT
);

-- Role → permission mapping
CREATE TABLE iam.role_permission (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL,         -- references auth.organization_role(id)
  permission_id UUID NOT NULL REFERENCES iam.permission_definition(id),
  org_id UUID NOT NULL REFERENCES auth.organization(id),
  UNIQUE(role_id, permission_id)
);

-- Entitlements (org → product/module access from Commerce Plane)
CREATE TABLE iam.entitlement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES auth.organization(id),
  product TEXT NOT NULL,
  module TEXT,                    -- NULL = full product access
  status TEXT NOT NULL DEFAULT 'active', -- active | suspended | expired
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ,
  UNIQUE(org_id, product, module)
);
```

### 4.4 Transactional Outbox

```sql
CREATE TABLE iam.authz_outbox (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  org_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  retry_count INT NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX idx_outbox_unprocessed ON iam.authz_outbox(created_at) WHERE processed_at IS NULL;
```

### 4.5 Ontology Registry

```sql
CREATE TABLE ontology.object_type_definition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES auth.organization(id),
  name TEXT NOT NULL,                    -- 'incident', 'road_segment', 'network_element'
  backing_spicedb_definition TEXT NOT NULL DEFAULT 'ontology_object',
  scope_types TEXT[] NOT NULL DEFAULT '{}', -- ['region'], ['region','topology']
  mandatory_control_property TEXT,       -- 'region_id'
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, name)
);

CREATE TABLE ontology.property_definition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type_id UUID NOT NULL REFERENCES ontology.object_type_definition(id),
  name TEXT NOT NULL,
  data_type TEXT NOT NULL,               -- 'string', 'int', 'json', 'ref:officer', etc.
  is_primary_key BOOLEAN NOT NULL DEFAULT false,
  cls_slot INT,                          -- NULL = no classification gate; 1-4 = clearance slot
  description TEXT,
  UNIQUE(object_type_id, name)
);

CREATE TABLE ontology.state_machine_definition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type_id UUID NOT NULL REFERENCES ontology.object_type_definition(id),
  states TEXT[] NOT NULL,                -- ['open','assigned','investigating','resolved','closed']
  transitions JSONB NOT NULL,            -- { "open": ["assigned"], "assigned": ["investigating","escalated"], ... }
  UNIQUE(object_type_id)
);

CREATE TABLE ontology.state_permission_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_machine_id UUID NOT NULL REFERENCES ontology.state_machine_definition(id),
  state TEXT NOT NULL,
  action TEXT NOT NULL,
  min_role TEXT,                          -- minimum role required in this state
  min_tier INT,                           -- minimum support tier (if applicable)
  UNIQUE(state_machine_id, state, action)
);

CREATE TABLE ontology.action_type_definition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type_id UUID NOT NULL REFERENCES ontology.object_type_definition(id),
  name TEXT NOT NULL,                     -- 'create', 'update', 'escalate', 'close'
  min_rank INT,
  required_clearance_slots INT[],         -- [1, 2] = needs slot 1 AND slot 2
  description TEXT,
  UNIQUE(object_type_id, name)
);
```

### 4.6 Constraint State

```sql
CREATE TABLE constraint.skill_definition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES auth.organization(id),
  name TEXT NOT NULL,
  family TEXT,                        -- grouping: 'fiber', 'rf', 'tower'
  parent_skill_id UUID REFERENCES constraint.skill_definition(id),
  UNIQUE(org_id, name)
);

CREATE TABLE constraint.skill_certification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES auth.user(id),
  skill_id UUID NOT NULL REFERENCES constraint.skill_definition(id),
  org_id UUID NOT NULL REFERENCES auth.organization(id),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  issuing_authority TEXT,
  UNIQUE(principal_id, skill_id)
);

CREATE TABLE constraint.financial_authority (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES auth.user(id),
  org_id UUID NOT NULL REFERENCES auth.organization(id),
  cost_center TEXT NOT NULL,
  max_single_amount NUMERIC NOT NULL,    -- per-transaction limit
  max_cumulative NUMERIC NOT NULL,       -- per-period limit
  period TEXT NOT NULL DEFAULT 'monthly', -- monthly | quarterly | annual
  UNIQUE(principal_id, cost_center)
);

CREATE TABLE constraint.financial_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES auth.user(id),
  cost_center TEXT NOT NULL,
  period_key TEXT NOT NULL,              -- '2026-03' for monthly
  cumulative_amount NUMERIC NOT NULL DEFAULT 0,
  UNIQUE(principal_id, cost_center, period_key)
);

CREATE TABLE constraint.approval_request (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type TEXT NOT NULL,
  resource_id UUID NOT NULL,
  action TEXT NOT NULL,
  org_id UUID NOT NULL REFERENCES auth.organization(id),
  requester_id UUID NOT NULL REFERENCES auth.user(id),
  required_approvals INT NOT NULL,       -- N
  approver_pool UUID[] NOT NULL,         -- M approver IDs
  received_approvals UUID[] NOT NULL DEFAULT '{}', -- collected so far
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | expired | rejected
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE constraint.jit_grant (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES auth.user(id),
  org_id UUID NOT NULL REFERENCES auth.organization(id),
  grant_type TEXT NOT NULL,              -- 'scope_elevation', 'role_elevation', 'classification_grant'
  grant_details JSONB NOT NULL,          -- what's being temporarily granted
  granted_by UUID NOT NULL REFERENCES auth.user(id),
  reason TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ                 -- if manually revoked before expiry
);
CREATE INDEX idx_jit_active ON constraint.jit_grant(principal_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE constraint.break_glass_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES auth.user(id),
  org_id UUID NOT NULL REFERENCES auth.organization(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID NOT NULL,
  justification TEXT NOT NULL,
  invoked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.user(id),
  review_outcome TEXT                    -- 'approved' | 'flagged' | 'violation'
);
```

---

## 5. SpiceDB Schema

Complete schema. ~50 lines. Never changes for new object types, scopes, or classifications.

```zed
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

definition workspace {
  relation org: organization
  relation member: principal
  permission access = member + org->access
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

definition team {
  relation member: principal
  relation lead: principal
  permission member_access = member + lead
}

definition product {}
definition module {}
```

---

## 6. Outbox Consumer

The only component that writes to SpiceDB. Polls `iam.authz_outbox` for unprocessed events, translates them to SpiceDB tuple operations, and marks them processed.

```typescript
import { SpiceDBClient } from "@authzed/authzed-node"
import { Pool } from "pg"

export class OutboxConsumer {
  constructor(
    private db: Pool,
    private spicedb: SpiceDBClient
  ) {}

  async start() {
    while (true) {
      const events = await this.poll(100)
      if (events.length === 0) {
        await sleep(100)
        continue
      }

      const writes = events.flatMap((e) => this.toTupleWrites(e))
      const deletes = events.flatMap((e) => this.toTupleDeletions(e))

      try {
        await this.spicedb.writeRelationships({
          updates: [
            ...writes.map((t) => ({
              operation: "OPERATION_TOUCH",
              relationship: t,
            })),
            ...deletes.map((t) => ({
              operation: "OPERATION_DELETE",
              relationship: t,
            })),
          ],
        })
        await this.markProcessed(events.map((e) => e.id))
      } catch (err) {
        await this.markRetry(
          events.map((e) => e.id),
          String(err)
        )
      }
    }
  }

  private toTupleWrites(event: OutboxEvent) {
    const { event_type: type, payload: p } = event
    const rel = (
      resType: string,
      resId: string,
      relation: string,
      subType: string,
      subId: string
    ) => ({
      resource: { objectType: resType, objectId: resId },
      relation,
      subject: { object: { objectType: subType, objectId: subId } },
    })

    switch (type) {
      case "MEMBER_ADDED":
        return [
          rel(
            "organization",
            p.org_id,
            p.membership_type === "guest" ? "guest" : "member",
            "principal",
            p.user_id
          ),
        ]
      case "SCOPE_ASSIGNED":
        return [
          rel(
            "scope_node",
            p.scope_node_id,
            "assigned",
            "principal",
            p.principal_id
          ),
        ]
      case "SCOPE_EXCLUDED":
        return [
          rel(
            "scope_node",
            p.scope_node_id,
            "excluded",
            "principal",
            p.principal_id
          ),
        ]
      case "SCOPE_NODE_CREATED":
        return p.parent_id
          ? [rel("scope_node", p.node_id, "parent", "scope_node", p.parent_id)]
          : []
      case "SCOPE_NODE_MOVED":
        return [
          rel("scope_node", p.node_id, "parent", "scope_node", p.new_parent_id),
        ]
      case "CLASSIFICATION_GRANTED":
        return [
          rel(
            "organization",
            p.org_id,
            `cls_${p.slot_number}_holder`,
            "principal",
            p.principal_id
          ),
        ]
      case "TEAM_MEMBER_ADDED":
        return [rel("team", p.team_id, "member", "principal", p.user_id)]
      case "ENTITLEMENT_GRANTED":
        return [
          rel(
            "organization",
            p.org_id,
            "entitled_product",
            "product",
            p.product_id
          ),
        ]
      case "ONTOLOGY_OBJECT_CREATED":
        return [
          rel("ontology_object", p.object_id, "org", "organization", p.org_id),
          rel(
            "ontology_object",
            p.object_id,
            "scope",
            "scope_node",
            p.scope_node_id
          ),
          rel(
            "ontology_object",
            p.object_id,
            "dataset",
            "dataset",
            p.dataset_id
          ),
        ]
      case "RESOURCE_SHARED":
        return [
          rel(
            "ontology_object",
            p.resource_id,
            p.grant_level,
            "principal",
            p.grantee_id
          ),
        ]
      default:
        return []
    }
  }

  private toTupleDeletions(event: OutboxEvent) {
    const { event_type: type, payload: p } = event
    const rel = (
      resType: string,
      resId: string,
      relation: string,
      subType: string,
      subId: string
    ) => ({
      resource: { objectType: resType, objectId: resId },
      relation,
      subject: { object: { objectType: subType, objectId: subId } },
    })

    switch (type) {
      case "MEMBER_REMOVED":
        return [
          rel(
            "organization",
            p.org_id,
            p.membership_type === "guest" ? "guest" : "member",
            "principal",
            p.user_id
          ),
        ]
      case "SCOPE_REMOVED":
        return [
          rel(
            "scope_node",
            p.scope_node_id,
            "assigned",
            "principal",
            p.principal_id
          ),
        ]
      case "CLASSIFICATION_REVOKED":
        return [
          rel(
            "organization",
            p.org_id,
            `cls_${p.slot_number}_holder`,
            "principal",
            p.principal_id
          ),
        ]
      case "TEAM_MEMBER_REMOVED":
        return [rel("team", p.team_id, "member", "principal", p.user_id)]
      default:
        return []
    }
  }

  private async poll(limit: number) {
    return (
      await this.db.query(
        `SELECT id, event_type, payload, org_id FROM iam.authz_outbox
       WHERE processed_at IS NULL AND retry_count < 5
       ORDER BY id ASC LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [limit]
      )
    ).rows
  }

  private async markProcessed(ids: number[]) {
    await this.db.query(
      `UPDATE iam.authz_outbox SET processed_at = now() WHERE id = ANY($1)`,
      [ids]
    )
  }

  private async markRetry(ids: number[], error: string) {
    await this.db.query(
      `UPDATE iam.authz_outbox SET retry_count = retry_count + 1, error = $2 WHERE id = ANY($1)`,
      [ids, error]
    )
  }
}
```

---

## 7. Custom Runtime

The authorization decision engine. Sits behind Traefik ForwardAuth.

```typescript
import { SpiceDBClient } from "@authzed/authzed-node"
import { auth } from "./auth"
import { OntologyRegistry } from "./ontology-registry"
import { ConstraintEvaluator } from "./constraint-evaluator"
import { RoleLatticeCache } from "./role-lattice-cache"

export class AuthzRuntime {
  constructor(
    private spicedb: SpiceDBClient,
    private registry: OntologyRegistry,
    private constraints: ConstraintEvaluator,
    private lattice: RoleLatticeCache
  ) {}

  async authorize(req: AuthzRequest): Promise<AuthzDecision> {
    // ① Resolve session (better-auth)
    const session = await auth.api.getSession({
      headers: { authorization: `Bearer ${req.token}` },
    })
    if (!session?.user) return deny("authentication")
    const { user, session: sess } = session
    const orgId = sess.activeOrganizationId
    if (!orgId) return deny("no_active_org")

    // ② Org entitlement (SpiceDB)
    if (req.product) {
      const entitled = await this.checkEntitlement(
        orgId,
        req.product,
        req.module
      )
      if (!entitled) return deny("entitlement")
    }

    // ⑦ Time constraints (runtime → Postgres)
    const timeOk = await this.constraints.checkTimeWindows(user.id, orgId)
    if (!timeOk) return deny("time_constraint")

    // ③ Scope (SpiceDB — if resource has scope)
    if (req.resourceId) {
      const scopeOk = await this.spicedb.checkPermission({
        resource: { objectType: "ontology_object", objectId: req.resourceId },
        permission: req.action === "read" ? "view" : "edit",
        subject: { object: { objectType: "principal", objectId: user.id } },
      })
      if (!scopeOk.permissionship) return deny("scope")
    }

    // ④ Role (cached lattice)
    if (req.product && req.module && req.resourceType && req.action) {
      const perm = `${req.product}:${req.module}:${req.resourceType}:${req.action}`
      if (!this.lattice.has(user.id, orgId, perm))
        return deny("role_permission")
    }

    // ⑦ Constraints (skill, workflow state, financial, approval)
    if (req.resourceId) {
      const c = await this.constraints.evaluateAll(
        user.id,
        orgId,
        req.resourceType,
        req.resourceId,
        req.action
      )
      if (!c.passed) return deny(c.failedConstraint)
    }

    // ⑤ Property filter (SpiceDB bulk check for classification slots)
    let propertyFilter: Record<string, boolean> | undefined
    if (req.resourceId && req.action === "read") {
      propertyFilter = await this.resolvePropertyVisibility(
        user.id,
        req.resourceId,
        req.resourceType,
        orgId
      )
    }

    // ⑦ Explicit deny
    const denyCheck = await this.constraints.checkExplicitDenies(
      user.id,
      orgId,
      req.resourceType,
      req.resourceId
    )
    if (denyCheck) return deny("explicit_deny")

    return { allowed: true, principalId: user.id, orgId, propertyFilter }
  }

  private async resolvePropertyVisibility(
    principalId: string,
    objectId: string,
    objectType: string,
    orgId: string
  ) {
    const meta = this.registry.getType(objectType, orgId)
    if (!meta) return undefined

    const usedSlots = new Set(
      meta.properties.filter((p) => p.cls_slot).map((p) => p.cls_slot)
    )
    const slotResults: Record<number, boolean> = {}

    for (const slot of usedSlots) {
      const check = await this.spicedb.checkPermission({
        resource: { objectType: "ontology_object", objectId },
        permission: `view_cls_${slot}`,
        subject: { object: { objectType: "principal", objectId: principalId } },
      })
      slotResults[slot] = !!check.permissionship
    }

    const filter: Record<string, boolean> = {}
    for (const prop of meta.properties) {
      filter[prop.name] = prop.cls_slot
        ? (slotResults[prop.cls_slot] ?? false)
        : true
    }
    return filter
  }

  private async checkEntitlement(
    orgId: string,
    product: string,
    module?: string
  ): Promise<boolean> {
    // Check Postgres entitlement table (cached)
    // This is faster than SpiceDB for simple lookups
    return this.registry.hasEntitlement(orgId, product, module)
  }
}

function deny(step: string): AuthzDecision {
  return { allowed: false, failedStep: step }
}
```

---

## 8. Traefik ForwardAuth

```yaml
http:
  middlewares:
    platform-auth:
      forwardAuth:
        address: "http://site-control-auth:4000/authorize"
        authResponseHeaders:
          - X-Principal-Id
          - X-Org-Id
          - X-Principal-Type
          - X-Property-Filter
          - X-ZedToken

  routers:
    api:
      rule: "PathPrefix(`/api`)"
      middlewares: [platform-auth]
      service: site-service-api
```

The ForwardAuth endpoint:

```typescript
import { Hono } from "hono"
import { AuthzRuntime } from "./runtime"

const app = new Hono()
const runtime = new AuthzRuntime(/* ... */)

app.all("/authorize", async (c) => {
  const decision = await runtime.authorize({
    token: c.req.header("Authorization")?.replace("Bearer ", "") || "",
    method: c.req.header("X-Forwarded-Method") || "GET",
    path: c.req.header("X-Forwarded-Uri") || "/",
  })

  if (!decision.allowed) return c.text("Forbidden", 403)

  return c.text("OK", 200, {
    "X-Principal-Id": decision.principalId,
    "X-Org-Id": decision.orgId,
    "X-Property-Filter": decision.propertyFilter
      ? JSON.stringify(decision.propertyFilter)
      : "",
  })
})
```

---

## 9. Data Flow

```
REQUEST FLOW

  Client → Traefik → ForwardAuth → Custom Runtime → Service → PostgreSQL
                          │
                          ├── better-auth: validate session
                          ├── SpiceDB: structural auth (scope, org, classification)
                          ├── Ontology Registry: property-to-slot mapping (cached)
                          └── Constraint Evaluator: time, state, skill, financial, approval

WRITE FLOW

  Application → PostgreSQL ─── SAME TRANSACTION ──→ business write + outbox event
                                                          │
                                                    Outbox Consumer
                                                          │
                                                       SpiceDB
                                                    (derived view)

CONSISTENCY

  PostgreSQL                          SpiceDB
  ┌─────────────────────┐            ┌─────────────────────┐
  │ Source of truth      │───outbox──→│ Derived (< 500ms)   │
  │ All auth state       │            │ Structural only     │
  │ Written by app code  │            │ Written by consumer │
  └─────────────────────┘            └─────────────────────┘
```

---

## 10. Schema Growth

| Event                                                  | SpiceDB schema change?       |
| ------------------------------------------------------ | ---------------------------- |
| New tenant signs up                                    | No                           |
| Tenant creates new object type                         | No                           |
| Tenant adds clearance-gated property                   | No                           |
| New scope dimension (e.g., cost center)                | No                           |
| New classification category fits existing slot         | No                           |
| Need 5th classification slot                           | Yes (adds 3 lines, one-time) |
| New resource type (e.g., Notebook)                     | Yes (rare, platform-level)   |
| Object type needs specialized auth (e.g., self-access) | Yes (very rare)              |
| New constraint category                                | No (runtime code only)       |

SpiceDB schema is an infrastructure artifact that changes quarterly at most. Dynamic growth happens in the Ontology Registry and constraint tables.

---

## 11. Reconciliation

Periodic job compares PostgreSQL state with SpiceDB relationships. Detects and repairs drift. Runs hourly (configurable). Alerts on any discrepancy found.

Reconciles: scope assignments, org memberships, classification grants, team memberships, entitlements, ontology object bindings.

---

## 12. Deployment Topology

```
Per Site (SaaS or Self-Hosted):

  ┌─────────────┐     ┌──────────────┐     ┌────────────┐
  │   Traefik    │────→│ Auth Service  │────→│  SpiceDB   │
  │  (gateway)   │     │ (Runtime +    │     │            │
  │              │     │  better-auth) │     └────────────┘
  └──────┬───────┘     └──────┬───────┘           ↑
         │                    │                    │
         │              ┌─────┴──────┐     ┌──────┴───────┐
         │              │ PostgreSQL │────→│   Outbox     │
         └─────────────→│            │     │  Consumer    │
                        └────────────┘     └──────────────┘

Air-gapped: identical topology. No external dependencies.
better-auth embedded = no identity server to deploy.
SpiceDB runs alongside = no external auth service.
```
