import { useState } from "react";

const mono = "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace";
const sans = "'DM Sans', system-ui, sans-serif";

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: SCALING TO CLOUD-PLATFORM LEVEL
// ═══════════════════════════════════════════════════════════════════════════════

const SCALING_PROBLEM = `// THE CONFLATION
//
// Current model: 1 action = 1 slot
//   issue.view     → slot_1
//   issue.edit     → slot_2
//   issue.assign   → slot_3
//   ... max 8
//
// Cloud platform: 200 API operations per service
//   ec2:DescribeInstances
//   ec2:RunInstances
//   ec2:TerminateInstances
//   ec2:StartInstances
//   ec2:StopInstances
//   ec2:CreateSecurityGroup
//   ec2:AuthorizeSecurityGroupIngress
//   ... 195 more
//
// You can't give each a slot. But you don't NEED to.
//
// AWS doesn't have 200 permission LEVELS. It has 5 ACCESS LEVELS:
//   List  — ec2:DescribeInstances, ec2:DescribeVpcs, ...
//   Read  — ec2:GetConsoleOutput, ec2:GetPasswordData, ...
//   Write — ec2:RunInstances, ec2:TerminateInstances, ...
//   Permissions Management — ec2:CreateSecurityGroup, ...
//   Tagging — ec2:CreateTags, ec2:DeleteTags, ...
//
// THE FIX: Decouple actions from slots.
// Slots = permission GROUPS (bounded: max 8)
// Actions = operations within a group (unbounded)
// A group can contain 1 action or 50 actions.`;

const EVOLVED_YAML_SPEC = `# ════════════════════════════════════════════════════════════
# auth.yaml v2 — Actions decoupled from permission groups
# ════════════════════════════════════════════════════════════
#
# CHANGE: 'actions' are now grouped into 'permission_groups'.
# Each group maps to one SpiceDB slot (max 8 groups).
# Each group contains 1-N actions (unbounded).
# The runtime checks: "does principal have group X?"
# Then validates: "is the requested action in group X?"
#
# For simple apps (Jira, Vercel): 1 action per group.
# For cloud platforms (AWS, GCP): 50 actions per group.

module: <module_name>
product: <product_name>
version: 2                          # v2 schema

scopes:
  <scope_name>:
    label: <string>
    actions: [<action_name>]

resources:
  <type_name>:
    label: <string>
    root: <boolean>
    contained_by: [<parent_type>]

    # ── PERMISSION GROUPS (max 8, map to SpiceDB slots) ──
    groups:
      <group_name>:                  # e.g., "read", "write", "admin"
        label: <string>
        cascade: <boolean>           # inherit from parent?
        implies: [<group_name>]      # other GROUPS this implies
        requires: [<group_name>]     # other GROUPS that must ALL pass

        # Actions in this group (unbounded count)
        actions:
          - <action_name>            # e.g., "ec2:RunInstances"
          - <action_name>            # e.g., "ec2:TerminateInstances"

        # OR: shorthand for single-action groups
        # actions: [view]

    # ── SCOPE BINDINGS (unchanged) ──
    scopes:
      <scope_name>:
        required: <boolean>
        groups:                      # binds GROUPS to scope actions
          <group_name>: <scope_action>

    # ── CONDITIONS (ABAC — NEW) ──
    conditions:
      <condition_name>:
        description: <string>
        # What context keys are available for this resource type
        keys:
          <key_name>:
            type: <string>           # string, number, boolean, string[], ip_cidr
            source: <string>         # 'request' | 'resource' | 'principal' | 'environment'
        # Which groups can have conditions attached
        applicable_groups: [<group_name>]

    markings:
      enabled: <boolean>
      propagate_to_children: <boolean>

roles:
  <role_name>:
    label: <string>
    grants:
      <resource_type>:
        groups: [<group_name>]       # grant entire groups
        # OR fine-grained:
        actions: [<action_name>]     # grant specific actions within groups`;

const GCP_COMPUTE_YAML = `# ════════════════════════════════════════════════════════════
# GCP Compute Engine — Cloud Platform Scale
# ════════════════════════════════════════════════════════════
# 70+ predefined roles, 200+ permissions.
# Modeled with 7 permission groups containing many actions.

module: gcp_compute
product: gcp
version: 2

scopes:
  region:
    label: Region
    actions: [view, operate]
  network:
    label: VPC Network
    actions: [view, manage]

resources:

  compute_instance:
    label: Compute Instance
    contained_by: [project]

    groups:
      list:
        label: List
        cascade: true
        actions:
          - compute.instances.list
          - compute.instances.aggregatedList
          - compute.zones.list
          - compute.regions.list
          - compute.machineTypes.list

      read:
        label: Read
        cascade: true
        implies: [list]
        actions:
          - compute.instances.get
          - compute.instances.getSerialPortOutput
          - compute.instances.getScreenshot
          - compute.instances.getShieldedInstanceIdentity
          - compute.instances.getGuestAttributes
          - compute.instances.getEffectiveFirewalls
          - compute.instances.getIamPolicy
          - compute.disks.get
          - compute.disks.list

      operate:
        label: Operate (Start/Stop/Reset)
        cascade: false
        implies: [read]
        actions:
          - compute.instances.start
          - compute.instances.stop
          - compute.instances.reset
          - compute.instances.resume
          - compute.instances.suspend
          - compute.instances.setMachineType
          - compute.instances.setLabels
          - compute.instances.setMetadata
          - compute.instances.setTags

      write:
        label: Write (Create/Modify/Delete)
        cascade: false
        implies: [operate]
        actions:
          - compute.instances.create
          - compute.instances.delete
          - compute.instances.attachDisk
          - compute.instances.detachDisk
          - compute.instances.addAccessConfig
          - compute.instances.deleteAccessConfig
          - compute.instances.setDiskAutoDelete
          - compute.instances.setScheduling
          - compute.instances.setServiceAccount
          - compute.instances.update
          - compute.instances.updateDisplayDevice
          - compute.instances.updateNetworkInterface
          - compute.instances.updateShieldedInstanceConfig
          - compute.disks.create
          - compute.disks.delete
          - compute.disks.resize
          - compute.disks.update

      network_manage:
        label: Network Management
        cascade: false
        implies: [read]
        actions:
          - compute.firewalls.create
          - compute.firewalls.delete
          - compute.firewalls.get
          - compute.firewalls.list
          - compute.firewalls.update
          - compute.networks.create
          - compute.networks.delete
          - compute.networks.get
          - compute.networks.list
          - compute.networks.updatePolicy
          - compute.subnetworks.create
          - compute.subnetworks.delete
          - compute.subnetworks.use

      ssh:
        label: SSH / OS Login
        cascade: false
        implies: [read]
        actions:
          - compute.instances.osLogin
          - compute.instances.osAdminLogin
          - compute.instances.setMetadata   # for SSH key injection
          - compute.projects.setCommonInstanceMetadata

      admin:
        label: Compute Admin
        cascade: false
        implies: [write, network_manage, ssh]
        actions:
          - compute.instances.setIamPolicy
          - compute.instances.getIamPolicy
          - compute.disks.setIamPolicy
          - compute.projects.setUsageExportBucket

    scopes:
      region:
        required: false
        groups:
          read: view
          operate: operate
          write: operate
          admin: operate
      network:
        required: false
        groups:
          network_manage: manage

    conditions:
      instance_type_restriction:
        description: Restrict actions to specific machine types
        keys:
          machine_type:
            type: string
            source: resource
          # e.g., condition: machine_type IN ["e2-micro", "e2-small"]
        applicable_groups: [write, operate]

      time_window:
        description: Restrict actions to specific time windows
        keys:
          request_time:
            type: string     # ISO 8601
            source: environment
          day_of_week:
            type: string
            source: environment
        applicable_groups: [write, operate, ssh]

      source_ip:
        description: Restrict by source IP
        keys:
          source_ip:
            type: ip_cidr
            source: request
        applicable_groups: [ssh, admin]

    markings:
      enabled: true
      propagate_to_children: false

roles:
  compute_admin:
    label: Compute Admin
    grants:
      compute_instance:
        groups: [admin]

  compute_operator:
    label: Compute Operator
    description: Can start/stop/reset but not create/delete
    grants:
      compute_instance:
        groups: [operate]

  compute_viewer:
    label: Compute Viewer
    grants:
      compute_instance:
        groups: [read]

  compute_network_admin:
    label: Network Admin
    grants:
      compute_instance:
        groups: [read, network_manage]

  # Fine-grained: specific actions within a group
  compute_ssh_only:
    label: SSH Only
    description: Can SSH but can't modify instances
    grants:
      compute_instance:
        groups: [ssh]
        # At runtime, this principal can ONLY call actions
        # in the 'ssh' group, not 'operate' or 'write'`;

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: ABAC CONDITIONS
// ═══════════════════════════════════════════════════════════════════════════════

const ABAC_DESIGN = `// ═══════════════════════════════════════════════════════════════
// ABAC CONDITIONS — WHERE THEY LIVE IN THE STACK
// ═══════════════════════════════════════════════════════════════
//
// Three layers, not one:
//
// ┌─────────────────────────────────────────────────────────┐
// │ LAYER 1: auth.yaml                                      │
// │ Declares condition SCHEMAS — what keys exist, what       │
// │ types they have, which groups they apply to.             │
// │ This is compile-time metadata.                          │
// │ "This resource type supports IP-based restrictions."     │
// ├─────────────────────────────────────────────────────────┤
// │ LAYER 2: condition_policy (PostgreSQL)                   │
// │ Stores condition INSTANCES — actual rules attached to    │
// │ specific role bindings or resource grants.               │
// │ "nikhil's write access requires source_ip in 10.0.0.0/8"│
// │ Created at runtime by admins via API/UI.                │
// ├─────────────────────────────────────────────────────────┤
// │ LAYER 3: Runtime Evaluator                              │
// │ Evaluates conditions against request context at check    │
// │ time. Runs AFTER slot check passes, BEFORE returning     │
// │ allowed. Uses SpiceDB caveats for simple conditions,     │
// │ application-layer evaluation for complex ones.          │
// └─────────────────────────────────────────────────────────┘

// ── auth.yaml declares the condition schema ──

conditions:
  instance_type_restriction:
    description: "Restrict to specific machine types"
    keys:
      machine_type: { type: string, source: resource }
    applicable_groups: [write, operate]

// ── PostgreSQL stores condition instances ──

CREATE TABLE iam.condition_policy (
    id                TEXT PRIMARY KEY,
    org_id            TEXT NOT NULL,
    
    -- What this condition is attached to
    -- Can be on a role_binding, a direct grant, or a resource type
    target_type       TEXT NOT NULL,     -- 'role_binding' | 'grant' | 'resource_type_default'
    target_id         TEXT NOT NULL,     -- FK to role_binding or grant
    
    -- Which condition schema from auth.yaml
    condition_name    TEXT NOT NULL,     -- 'instance_type_restriction'
    resource_type     TEXT NOT NULL,     -- 'compute_instance'
    
    -- The actual condition expression
    -- Using a simplified Cedar-like syntax
    expression        JSONB NOT NULL,
    -- Examples:
    -- {"operator": "in", "key": "machine_type", "values": ["e2-micro", "e2-small"]}
    -- {"operator": "cidr_match", "key": "source_ip", "value": "10.0.0.0/8"}
    -- {"operator": "between", "key": "request_time", "min": "09:00", "max": "17:00"}
    -- {"operator": "eq", "key": "day_of_week", "values": ["Mon","Tue","Wed","Thu","Fri"]}
    
    -- Compound conditions (AND/OR)
    -- {"all": [
    --   {"operator": "in", "key": "machine_type", "values": ["e2-micro"]},
    --   {"operator": "cidr_match", "key": "source_ip", "value": "10.0.0.0/8"}
    -- ]}
    
    effect            TEXT NOT NULL DEFAULT 'restrict',  -- 'restrict' | 'require'
    -- restrict: narrows an existing grant (permission boundary)
    -- require: adds a mandatory check (can't access without passing)
    
    created_by        TEXT,
    created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_condition_target ON iam.condition_policy(target_type, target_id);
CREATE INDEX idx_condition_resource ON iam.condition_policy(resource_type, condition_name);

// ── Runtime evaluates ──

async function evaluateConditions(
  principalId: string,
  resourceId: string,
  action: string,
  requestContext: RequestContext,
): Promise<{ passed: boolean; failedCondition?: string }> {

  // Get all condition policies that apply to this check
  const conditions = await db.query(\`
    SELECT cp.* FROM iam.condition_policy cp
    WHERE cp.resource_type = $1
    AND (
      -- Conditions on the principal's role bindings
      (cp.target_type = 'role_binding' AND cp.target_id IN (
        SELECT rb.id FROM iam.role_binding rb 
        WHERE rb.principal_id = $2
      ))
      OR
      -- Conditions on the resource type default
      (cp.target_type = 'resource_type_default' AND cp.target_id = $1)
    )
  \`, [resourceType, principalId]);

  for (const condition of conditions) {
    const result = evaluateExpression(
      condition.expression,
      requestContext,    // { source_ip, request_time, day_of_week, ... }
      resourceContext,   // { machine_type, region, tags, ... }
      principalContext,  // { department, clearance_level, ... }
    );
    
    if (!result.passed) {
      return { 
        passed: false, 
        failedCondition: condition.condition_name 
      };
    }
  }

  return { passed: true };
}`;

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: DATA OWNERSHIP
// ═══════════════════════════════════════════════════════════════════════════════

const DATA_OWNERSHIP = `// ═══════════════════════════════════════════════════════════════
// DATA OWNERSHIP: AUTH SERVICE DB vs APPLICATION DB
// ═══════════════════════════════════════════════════════════════
//
// THE PROBLEM:
// 
// Auth Service DB (iam.*)         Application DB (app.*)
// ─────────────────────           ─────────────────────
// resource_type                   projects
// resource_type_action            epics
// role_definition                 issues
// role_binding                    documents
// principal_marking               datasets
// resource_marking                traffic_plans
// condition_policy                ...
// scope_node                      
// scope_type                      
//                                 
// BOTH need to know about "project1":
// Auth: resource:project1#slot_3@principal:vikrant
// App:  projects table row with id=project1, name="Q4 Planning"
//
// WHO OWNS THE RESOURCE RECORD?
// WHO CREATES IT? WHO DELETES IT?
// HOW DO THEY STAY IN SYNC?

// ═══════════════════════════════════════════════════════════════
// THE ANSWER: APPLICATION OWNS, AUTH PROJECTS
// ═══════════════════════════════════════════════════════════════
//
// The application is the SOURCE OF TRUTH for resource existence.
// The auth service is a DERIVED PROJECTION for permission checks.
//
// When the app creates a project:
//   1. App inserts into app.projects (source of truth)
//   2. App publishes ResourceCreated event
//   3. Auth service creates SpiceDB tuples:
//      - resource:project1#org@organization:lepton
//      - resource:project1#parent@resource:folder1
//      - resource:project1#slot_6@principal:creator (owner)
//   4. Auth service inserts into iam.resource_registry (derived)
//
// When the app deletes a project:
//   1. App soft-deletes in app.projects
//   2. App publishes ResourceDeleted event
//   3. Auth service deletes all SpiceDB tuples for project1
//   4. Auth service removes from iam.resource_registry
//
// The auth service NEVER creates a resource on its own.
// The app NEVER writes to iam.* tables directly.
//
// ═══════════════════════════════════════════════════════════════

// ── What each database owns ──

// AUTH SERVICE DB (iam.*)
// Owns: authorization metadata
// ├── resource_type              # what types exist (from auth.yaml compiler)
// ├── resource_type_action       # what actions exist per type
// ├── resource_type_scope_binding
// ├── scope_type                 # what scope dimensions exist
// ├── scope_type_action
// ├── scope_node                 # scope hierarchy (regions, departments)
// ├── role_definition            # what roles exist
// ├── role_binding               # who has what role where
// ├── marking_type               # what marking categories exist
// ├── marking                    # what markings exist
// ├── resource_marking           # which markings on which resources
// ├── principal_marking          # which principals hold which clearances
// ├── condition_policy           # ABAC conditions
// ├── resource_registry          # DERIVED: lightweight resource index
// └── outbox                     # events for SpiceDB sync

// APPLICATION DB (app.*)
// Owns: domain data
// ├── projects                   # the actual project with name, description, etc.
// ├── issues                     # the actual issue with title, body, status, etc.
// ├── documents                  # the actual document content
// ├── datasets                   # the actual data
// └── ... domain tables

// SPICEDB
// Owns: nothing (it's a derived cache)
// Contains: permission tuples, rebuilt from iam.* via outbox

// ── The resource_registry: auth's lightweight view ──

CREATE TABLE iam.resource_registry (
    -- NOT the source of truth. Derived from app events.
    id              TEXT PRIMARY KEY,        -- same ID as app.projects.id
    org_id          TEXT NOT NULL,
    resource_type   TEXT NOT NULL,           -- 'project', 'issue', 'dataset'
    parent_id       TEXT,                    -- parent resource ID (for cascade)
    
    -- Minimal metadata needed for auth decisions
    -- NOT domain data (no project name, description, status)
    created_by      TEXT NOT NULL,           -- principal who created it
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Scope bindings (which scope nodes this resource is tagged with)
    -- Denormalized for fast lookup
    scope_bindings  JSONB DEFAULT '{}',
    -- e.g., {"region": "scope_node:region_seoul", "department": "scope_node:dept_planning"}
    
    -- Marking count (for fast "has any markings?" check)
    marking_count   SMALLINT DEFAULT 0
);

CREATE INDEX idx_resource_registry_type ON iam.resource_registry(resource_type, org_id);
CREATE INDEX idx_resource_registry_parent ON iam.resource_registry(parent_id);`;

const SYNC_PATTERNS = `// ═══════════════════════════════════════════════════════════════
// SYNC PATTERNS: APP → AUTH → SPICEDB
// ═══════════════════════════════════════════════════════════════
//
// PATTERN 1: TRANSACTIONAL OUTBOX (recommended)
//
// The app and auth service share NO database.
// Sync happens via events (NATS JetStream).
//
// App creates project:
//   1. BEGIN transaction
//   2. INSERT INTO app.projects (id, name, org_id, parent_id, created_by)
//   3. INSERT INTO app.outbox (event_type, payload)
//      payload: {
//        event: "resource.created",
//        resource_id: "project1",
//        resource_type: "project",
//        org_id: "lepton",
//        parent_id: "folder1",
//        created_by: "nikhil",
//        scope_bindings: {"region": "region_jharkhand"}
//      }
//   4. COMMIT
//
// Outbox publisher reads app.outbox → publishes to NATS
//
// Auth service consumes event:
//   1. INSERT INTO iam.resource_registry
//   2. Write SpiceDB tuples:
//      resource:project1#org@organization:lepton
//      resource:project1#parent@resource:folder1
//      resource:project1#slot_6@principal:nikhil  (creator → admin)
//      resource:project1#scope@scope_node:region_jharkhand
//   3. If resource type has markings from parent:
//      Copy parent's markings → iam.resource_marking
//   4. ACK event

// ═══════════════════════════════════════════════════════════════
// PATTERN 2: SHARED SCHEMA (simpler, less isolation)
//
// Auth tables (iam.*) and app tables (app.*) live in the SAME
// PostgreSQL database, different schemas. The app writes to both
// in the same transaction.
//
// App creates project:
//   1. BEGIN transaction
//   2. INSERT INTO app.projects (...)
//   3. INSERT INTO iam.resource_registry (...)
//   4. INSERT INTO iam.outbox (...)  -- for SpiceDB sync
//   5. COMMIT
//
// Advantages: atomic consistency (no eventual consistency window)
// Disadvantages: tight coupling, shared DB = shared failure domain
//
// RECOMMENDED FOR: small deployments, air-gapped sites
// NOT RECOMMENDED FOR: SaaS shared (auth service should be independent)

// ═══════════════════════════════════════════════════════════════
// WHAT THE APP MUST TELL THE AUTH SERVICE (event contract)
// ═══════════════════════════════════════════════════════════════

interface ResourceEvent {
  event: 'resource.created' | 'resource.updated' | 'resource.deleted' 
       | 'resource.moved' | 'resource.scope_changed';
  
  resource_id: string;
  resource_type: string;           // must match auth.yaml type name
  org_id: string;
  
  // For created/moved
  parent_id?: string;              // parent resource ID
  created_by?: string;             // principal ID (gets owner/admin slot)
  
  // For scope changes
  scope_bindings?: Record<string, string>;   // scope_type → scope_node_id
  
  // For marking propagation (auth service handles automatically)
  // No need to send markings — auth service copies from parent
}

interface PermissionGrantEvent {
  event: 'grant.created' | 'grant.revoked';
  
  resource_id: string;
  resource_type: string;
  principal_id: string;
  
  // What's being granted/revoked
  group_name?: string;             // e.g., "edit" — resolved to slot by auth service
  action_name?: string;            // e.g., "compute.instances.start" — for fine-grained
  role_name?: string;              // e.g., "project_admin" — for role-based grants
  
  // Optional: conditions on this grant
  conditions?: ConditionExpression[];
}

interface ScopeAssignmentEvent {
  event: 'scope.assigned' | 'scope.revoked';
  
  scope_node_id: string;
  scope_type: string;
  principal_id: string;
  group_name: string;              // scope group being granted (e.g., "manage")
}

// ═══════════════════════════════════════════════════════════════
// WHO CALLS WHAT — THE API BOUNDARY
// ═══════════════════════════════════════════════════════════════
//
// Application calls Auth Service API:
//   POST /auth/check          — "can principal X do action Y on resource Z?"
//   POST /auth/check-bulk     — batch check
//   POST /auth/list-resources — "what resources can principal X access?"
//   POST /auth/grant          — grant permission (app initiates, auth writes)
//   POST /auth/revoke         — revoke permission
//
// Auth Service calls SpiceDB:
//   CheckPermission
//   LookupResources
//   WriteRelationships
//   DeleteRelationships
//   BulkCheckPermission
//
// Application NEVER calls SpiceDB directly.
// Auth Service NEVER reads app.* tables.
//
// ═══════════════════════════════════════════════════════════════

// ── The complete check flow ──

async function checkPermission(req: CheckRequest): Promise<CheckResult> {
  const { principal_id, resource_id, action } = req;

  // 1. Get resource from auth's registry (NOT from app DB)
  const resource = await authDb.query(
    'SELECT * FROM iam.resource_registry WHERE id = $1',
    [resource_id]
  );

  // 2. Get type config from cached registry
  const typeConfig = registry.getType(resource.resource_type);

  // 3. Resolve action → group
  const group = registry.getGroupForAction(resource.resource_type, action);
  
  // 4. Marking check (PostgreSQL, mandatory)
  const markingResult = await checkMarkings(principal_id, resource_id);
  if (!markingResult.cleared) {
    return { allowed: false, reason: 'marking_denied', invisible: true };
  }

  // 5. Scope check (SpiceDB, if scope binding exists)
  const scopeResult = await checkScopes(
    principal_id, resource, action, group, typeConfig
  );
  if (!scopeResult.allowed) {
    return { allowed: false, reason: 'scope_denied' };
  }

  // 6. Slot check (SpiceDB)
  const slotResult = await checkSlot(principal_id, resource_id, group);
  if (!slotResult.allowed) {
    return { allowed: false, reason: 'permission_denied' };
  }

  // 7. Condition evaluation (ABAC, if conditions exist)
  const conditionResult = await evaluateConditions(
    principal_id, resource_id, resource.resource_type, action, req.context
  );
  if (!conditionResult.passed) {
    return { allowed: false, reason: 'condition_failed', 
             condition: conditionResult.failedCondition };
  }

  // 8. Fine-grained action check (for cloud-platform level)
  //    If the principal was granted a specific action (not the whole group),
  //    verify the requested action is in their granted set.
  if (typeConfig.has_fine_grained_actions) {
    const actionResult = await checkActionGrant(
      principal_id, resource_id, action
    );
    if (!actionResult.allowed) {
      return { allowed: false, reason: 'action_not_granted' };
    }
  }

  return { allowed: true };
}`;

const FULL_EVAL_CHAIN = `// ═══════════════════════════════════════════════════════════════
// THE COMPLETE 7-STEP EVALUATION CHAIN (REVISED)
// ═══════════════════════════════════════════════════════════════
//
// Request: "Can principal P do action A on resource R?"
//
// ┌───────────────────────────────────────────────────────────┐
// │ 1. ORG MEMBERSHIP (mandatory)                             │
// │    SpiceDB: embedded in slot permissions (org->access)     │
// │    Fail: invisible                                        │
// ├───────────────────────────────────────────────────────────┤
// │ 2. MARKING CLEARANCE (mandatory)                          │
// │    PostgreSQL: principal holds ALL markings on resource    │
// │    Fail: invisible                                        │
// ├───────────────────────────────────────────────────────────┤
// │ 3. SCOPE CHECK (discretionary)                            │
// │    SpiceDB: scope_node slot for this group × scope_type   │
// │    Fail: action denied                                    │
// ├───────────────────────────────────────────────────────────┤
// │ 4. PERMISSION GROUP CHECK (discretionary)                 │
// │    SpiceDB: resource slot (cascade/local) + implies DAG   │
// │    Fail: action denied                                    │
// ├───────────────────────────────────────────────────────────┤
// │ 5. ABAC CONDITION CHECK (conditional)                     │
// │    Runtime: evaluate condition_policy expressions against  │
// │    request context (IP, time, tags, resource attributes)  │
// │    Fail: action denied                                    │
// ├───────────────────────────────────────────────────────────┤
// │ 6. FINE-GRAINED ACTION CHECK (optional, cloud-platform)   │
// │    Runtime: is the specific API action in the principal's  │
// │    granted action set within the group?                   │
// │    Fail: action denied                                    │
// ├───────────────────────────────────────────────────────────┤
// │ 7. PROPERTY FILTERING (mandatory, ontology objects only)  │
// │    SpiceDB: clearance slots on ontology_object             │
// │    Fail: property = null                                  │
// └───────────────────────────────────────────────────────────┘
//
// Steps 5 and 6 are NEW. They only fire when:
// - Step 5: condition_policy rows exist for this principal/resource/type
// - Step 6: resource type has fine-grained actions (cloud-platform mode)
// 
// For simple apps (Jira, Vercel): steps 5 and 6 are skipped.
// Total latency: ~4ms (same as before).
//
// For cloud-platform apps: steps 5 and 6 add ~1-2ms.
// Total latency: ~6ms.`;

// ═══════════════════════════════════════════════════════════════════════════════
// V1 vs V2 comparison for simple app
// ═══════════════════════════════════════════════════════════════════════════════

const V1_VS_V2 = `// ═══════════════════════════════════════════════════════════════
// V1 vs V2 — FOR SIMPLE APPS (backward compatible)
// ═══════════════════════════════════════════════════════════════

// V1 (current) — 1 action per slot
resources:
  issue:
    actions:
      view:
        label: View
        cascade: true
      edit:
        label: Edit
        cascade: true
        implies: [view]
      assign:
        label: Assign
        cascade: false
        implies: [view]

// V2 — same thing, but groups wrap single actions
resources:
  issue:
    groups:
      view:
        label: View
        cascade: true
        actions: [view]           # single action = same as v1
      edit:
        label: Edit
        cascade: true
        implies: [view]
        actions: [edit]           # single action = same as v1
      assign:
        label: Assign
        cascade: false
        implies: [view]
        actions: [assign]         # single action = same as v1

// THE COMPILER TREATS THESE IDENTICALLY.
// v1 syntax is sugar: compiler auto-wraps each action in a group.
// v2 is explicit: groups contain actions.
//
// So v1 auth.yaml files work unchanged. The compiler detects
// 'actions' (v1) vs 'groups' (v2) and normalizes to v2 internally.
// No migration needed for existing modules.

// ═══════════════════════════════════════════════════════════════
// WHEN TO USE V2 (multi-action groups)
// ═══════════════════════════════════════════════════════════════
//
// USE V1 when: your resource type has ≤8 meaningful actions.
// This covers: Jira, Salesforce, Vercel, SmartMarket, Trafficure,
// and ~95% of SaaS applications.
//
// USE V2 when: your resource type has >8 API operations that
// naturally group into ≤8 permission levels.
// This covers: cloud infrastructure (AWS, GCP), API gateways,
// platform services with many endpoints.`;

// ═══════════════════════════════════════════════════════════════════════════════
// DB OWNERSHIP DIAGRAM
// ═══════════════════════════════════════════════════════════════════════════════

const OWNERSHIP_DIAGRAM = `// ═══════════════════════════════════════════════════════════════
// DATA FLOW: APPLICATION → AUTH → SPICEDB
// ═══════════════════════════════════════════════════════════════
//
//   APPLICATION DB             AUTH SERVICE DB           SPICEDB
//   (app.*)                    (iam.*)                   (tuples)
//   ─────────────              ─────────────             ─────────
//                              
//   ┌──────────┐   event       ┌──────────────┐  outbox  ┌────────┐
//   │ projects │───────────────│ resource_    │─────────│ tuples │
//   │ issues   │  "resource.   │  registry    │  write   │        │
//   │ docs     │   created"    │ (derived)    │  rels    │        │
//   │ datasets │               │              │         │        │
//   └──────────┘               │ role_binding │         │        │
//        │                     │ marking      │         │        │
//        │                     │ condition    │         │        │
//        │                     │ scope_node   │         └────────┘
//        │                     └──────────────┘              │
//        │                          │                        │
//        │                          │                        │
//        ▼                          ▼                        ▼
//   "What is this              "Who can access          "Does this
//    project's name?"           this project?"           tuple exist?"
//                              
//                              
//   APP OWNS:                  AUTH OWNS:                SPICEDB:
//   - Domain data              - Permission metadata     - Derived cache
//   - Business logic           - Role bindings           - Rebuilt from
//   - Resource lifecycle       - Markings/clearances       iam.* outbox
//   - UI/API                   - Scope hierarchy
//                              - Condition policies
//                              - Resource registry (lightweight)
//
// GOLDEN RULES:
// 1. App NEVER reads/writes iam.* tables
// 2. Auth NEVER reads/writes app.* tables  
// 3. SpiceDB is always rebuildable from iam.* state
// 4. App communicates to Auth via events (outbox) and API calls
// 5. Auth communicates to App via... nothing. Auth is a service.
//    App calls Auth. Auth doesn't call App.
// 6. The resource_registry in iam.* is a CACHE, not a source of truth.
//    If it drifts, rebuild from app events.`;

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

const TABS = [
  { id: "scaling", label: "Cloud-Scale Actions" },
  { id: "v2spec", label: "auth.yaml v2" },
  { id: "gcp_example", label: "GCP Compute" },
  { id: "abac", label: "ABAC Conditions" },
  { id: "ownership", label: "Data Ownership" },
  { id: "sync", label: "Sync Patterns" },
  { id: "eval", label: "7-Step Chain" },
  { id: "compat", label: "v1 Compat" },
];

const Badge = ({ text, color = "#71717a", small = false }) => (
  <span style={{
    display: "inline-block", padding: small ? "1px 5px" : "2px 7px",
    borderRadius: "3px", fontSize: small ? "9px" : "10px", fontWeight: 700,
    fontFamily: mono, color, backgroundColor: `${color}12`, border: `1px solid ${color}25`,
    letterSpacing: "0.03em",
  }}>{text}</span>
);

const Code = ({ children, maxHeight = null }) => (
  <pre style={{
    padding: "14px 16px", borderRadius: "6px", border: "1px solid #1a1a22",
    backgroundColor: "#08080c", fontSize: "10.5px", fontFamily: mono,
    lineHeight: "1.65", color: "#a1a1aa", overflow: "auto", maxHeight,
    whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0,
  }}>{children}</pre>
);

export default function ExpandedAuth() {
  const [tab, setTab] = useState("scaling");

  return (
    <div style={{
      minHeight: "100vh", backgroundColor: "#0a0a0c", color: "#e4e4e7",
      fontFamily: sans, padding: "20px",
    }}>
      <div style={{ marginBottom: "20px" }}>
        <div style={{
          fontSize: "9px", fontWeight: 800, fontFamily: mono,
          color: "#f59e0b", letterSpacing: "0.12em", marginBottom: "4px",
        }}>PLATFORM FABRIC — AUTH ARCHITECTURE v2</div>
        <div style={{ fontSize: "18px", fontWeight: 700, color: "#fafafa" }}>
          Cloud-Scale Permissions, ABAC, & Data Ownership
        </div>
        <div style={{ fontSize: "11px", color: "#52525b", marginTop: "3px" }}>
          Permission groups · ABAC conditions · App ↔ Auth boundary · 7-step evaluation
        </div>
      </div>

      <div style={{
        display: "flex", gap: "1px", marginBottom: "16px",
        borderRadius: "5px", overflow: "hidden", border: "1px solid #18181b",
        backgroundColor: "#0d0d0f", padding: "2px", flexWrap: "wrap",
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "6px 11px", borderRadius: "3px", border: "none", cursor: "pointer",
            fontSize: "10.5px", fontWeight: 600, fontFamily: sans, transition: "all 0.12s",
            backgroundColor: tab === t.id ? "#1c1c24" : "transparent",
            color: tab === t.id ? "#fafafa" : "#52525b",
          }}>{t.label}</button>
        ))}
      </div>

      {tab === "scaling" && (
        <div>
          <div style={{
            padding: "8px 12px", borderRadius: "5px", marginBottom: "12px",
            border: "1px solid #f59e0b25", backgroundColor: "#0e0c08",
            fontSize: "11px", color: "#fde68a", lineHeight: "1.7",
          }}>
            The 8-slot limit isn't the problem. The conflation of "action" with "slot" is.
            Cloud platforms have 200 API operations but only ~5 permission LEVELS.
            Decouple them: slots = permission groups (bounded), actions = operations within groups (unbounded).
          </div>
          <Code maxHeight="700px">{SCALING_PROBLEM}</Code>
        </div>
      )}

      {tab === "v2spec" && (
        <div>
          <div style={{
            padding: "8px 12px", borderRadius: "5px", marginBottom: "12px",
            border: "1px solid #22c55e25", backgroundColor: "#080e08",
            fontSize: "11px", color: "#86efac", lineHeight: "1.7",
          }}>
            auth.yaml v2 adds <code style={{ fontFamily: mono }}>groups</code> (which wrap actions) and 
            <code style={{ fontFamily: mono }}> conditions</code> (ABAC schemas). v1 syntax still works — the 
            compiler auto-wraps single actions into groups. Backward compatible.
          </div>
          <Code maxHeight="700px">{EVOLVED_YAML_SPEC}</Code>
        </div>
      )}

      {tab === "gcp_example" && (
        <div>
          <div style={{
            padding: "8px 12px", borderRadius: "5px", marginBottom: "12px",
            border: "1px solid #3b82f625", backgroundColor: "#080a0e",
            fontSize: "11px", color: "#93c5fd", lineHeight: "1.7",
          }}>
            GCP Compute Engine: 70+ permissions bucketed into 7 permission groups.
            Each group maps to one SpiceDB slot. The <code style={{ fontFamily: mono }}>conditions</code> section
            declares ABAC schemas for instance type, time window, and source IP restrictions.
          </div>
          <Code maxHeight="700px">{GCP_COMPUTE_YAML}</Code>
        </div>
      )}

      {tab === "abac" && (
        <div>
          <div style={{
            padding: "8px 12px", borderRadius: "5px", marginBottom: "12px",
            border: "1px solid #c084fc25", backgroundColor: "#0c080e",
            fontSize: "11px", color: "#d8b4fe", lineHeight: "1.7",
          }}>
            ABAC lives across three layers: auth.yaml declares condition SCHEMAS (compile-time),
            PostgreSQL stores condition INSTANCES (runtime-configured by admins),
            and the runtime evaluator checks them against request context (check-time).
          </div>
          <Code maxHeight="700px">{ABAC_DESIGN}</Code>
        </div>
      )}

      {tab === "ownership" && (
        <div>
          <div style={{
            padding: "8px 12px", borderRadius: "5px", marginBottom: "12px",
            border: "1px solid #ef444425", backgroundColor: "#0e0808",
            fontSize: "11px", color: "#fca5a5", lineHeight: "1.7",
          }}>
            <strong>Application owns resources. Auth projects permissions.</strong> The app creates projects in 
            its DB. The auth service maintains a lightweight <code style={{ fontFamily: mono }}>resource_registry</code> (derived) 
            and SpiceDB tuples (derived). Neither reads the other's tables. Events are the sync mechanism.
          </div>
          <Code maxHeight="700px">{DATA_OWNERSHIP}</Code>
        </div>
      )}

      {tab === "sync" && (
        <div>
          <div style={{
            padding: "8px 12px", borderRadius: "5px", marginBottom: "12px",
            border: "1px solid #f59e0b25", backgroundColor: "#0e0c08",
            fontSize: "11px", color: "#fde68a", lineHeight: "1.7",
          }}>
            Two patterns: transactional outbox (recommended for SaaS) and shared schema (simpler, for 
            air-gapped sites). The event contract defines exactly what the app must tell the auth service.
          </div>
          <Code maxHeight="700px">{SYNC_PATTERNS}</Code>
        </div>
      )}

      {tab === "eval" && (
        <div>
          <div style={{
            padding: "8px 12px", borderRadius: "5px", marginBottom: "12px",
            border: "1px solid #818cf825", backgroundColor: "#08080e",
            fontSize: "11px", color: "#a5b4fc", lineHeight: "1.7",
          }}>
            The evaluation chain grows from 5 to 7 steps. Steps 5 (ABAC conditions) and 6 
            (fine-grained action check) are NEW but only fire when applicable. Simple apps skip them.
          </div>
          <Code maxHeight="700px">{FULL_EVAL_CHAIN}</Code>
        </div>
      )}

      {tab === "compat" && (
        <div>
          <div style={{
            padding: "8px 12px", borderRadius: "5px", marginBottom: "12px",
            border: "1px solid #22c55e25", backgroundColor: "#080e08",
            fontSize: "11px", color: "#86efac", lineHeight: "1.7",
          }}>
            v1 auth.yaml files work unchanged. The compiler treats <code style={{ fontFamily: mono }}>actions</code> (v1) 
            as sugar for single-action groups. No migration needed. Use v2's <code style={{ fontFamily: mono }}>groups</code> only 
            when you need {">"} 8 API operations per resource type.
          </div>
          <Code maxHeight="700px">{V1_VS_V2}</Code>
        </div>
      )}
    </div>
  );
}
