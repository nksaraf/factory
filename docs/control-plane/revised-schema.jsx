import { useState, useMemo, useCallback } from "react"

const mono = "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace"
const sans = "'DM Sans', system-ui, sans-serif"

// ═══════════════════════════════════════════════════════════════════════════════
// FULL SPICEDB SCHEMA — REVISED
// ═══════════════════════════════════════════════════════════════════════════════

const SCHEMA_SECTIONS = [
  {
    id: "identity",
    label: "Identity & Org",
    schema: `// ─── Identity ──────────────────────────────────────────
// Principal is the universal subject. Type is encoded in
// the object ID namespace: user:nikhil, svc:pipeline,
// agent:traffic-bot.

definition principal {}

definition organization {
  relation member: principal
  relation guest: principal
  permission access = member + guest
}

definition role {
  relation org: organization
  relation member: principal
}`,
    notes:
      "No changes from before. Principal, organization, and role remain stable.",
  },
  {
    id: "scope",
    label: "Scope Nodes",
    schema: `// ─── Scope Hierarchy ───────────────────────────────────
// One definition handles ALL scope dimensions: region,
// topology, department, channel, skill_family, etc.
// The scope_type is metadata in the Registry, not schema.
//
// KEY CHANGE: Scope has its OWN slot mapping, independent
// from resource slots. Scope slots answer "what can this
// principal do within this scope boundary?" — not "what
// can they do to a specific resource."

definition scope_node {
  relation org: organization
  relation parent: scope_node
  relation member: principal
  relation excluded: principal

  // Scope membership (cascades down the hierarchy)
  permission in_scope = (member - excluded)
                        + (parent->in_scope - excluded)

  // ── Scope permission slots ──
  // These are SCOPE-SPECIFIC. They do NOT share numbering
  // with resource slots. Registry maps independently:
  //   scope_type "region":  slot_1 = view, slot_2 = manage
  //   scope_type "department": slot_1 = participate, slot_2 = lead
  //
  // Max 4 scope permission slots (scopes need fewer than resources)
  relation slot_1: principal | role#member
  relation slot_2: principal | role#member
  relation slot_3: principal | role#member
  relation slot_4: principal | role#member

  // Each scope slot cascades from parent scope node
  permission has_slot_1 = ((slot_1 - excluded) & org->access)
                          + (parent->has_slot_1 - excluded)
  permission has_slot_2 = ((slot_2 - excluded) & org->access)
                          + (parent->has_slot_2 - excluded)
  permission has_slot_3 = ((slot_3 - excluded) & org->access)
                          + (parent->has_slot_3 - excluded)
  permission has_slot_4 = ((slot_4 - excluded) & org->access)
                          + (parent->has_slot_4 - excluded)
}`,
    notes: `CRITICAL FIX: Scope slots are independent from resource slots. scope_node.slot_1 is NOT resource.slot_1. The Registry maps them separately. This means a scope_type "region" can define slot_1="view", slot_2="manage" while resource_type "project" defines slot_1="discover", slot_2="view" — no coupling.

The runtime composes: resourceCheck AND scopeCheck. Two SpiceDB calls, but slot mappings never collide.`,
  },
  {
    id: "resource",
    label: "Resource (8 Slots)",
    schema: `// ─── Resource ──────────────────────────────────────────
// Generic definition for ALL resource types: folders,
// projects, documents, traffic plans, datasets, etc.
//
// 8 permission SLOTS (not tiers — no implied ordering).
// Each slot has two modes:
//   _cascade: inherits from parent resource
//   _local:   direct grant only, no parent inheritance
//
// SCOPE IS NOT IN THESE EXPRESSIONS. Scope checks happen
// at runtime as a separate AND. This decouples scope slot
// numbering from resource slot numbering.

definition resource {
  relation org: organization
  relation parent: resource
  relation excluded: principal

  // Scope binding — used for scope membership queries,
  // NOT for permission cascade.
  relation scope: scope_node

  // ── 8 generic permission slots ──
  // Slot numbers have NO inherent ordering or hierarchy.
  // "slot_5" is not "higher" than "slot_3".
  // The Registry assigns meaning per resource type.
  relation slot_1: principal | role#member
  relation slot_2: principal | role#member
  relation slot_3: principal | role#member
  relation slot_4: principal | role#member
  relation slot_5: principal | role#member
  relation slot_6: principal | role#member
  relation slot_7: principal | role#member
  relation slot_8: principal | role#member

  // ── CASCADING: inherits from parent resource ──
  // Used when registry says cascade_from_parent=true
  permission has_slot_1_cascade = ((slot_1 - excluded) & org->access)
    + (parent->has_slot_1_cascade - excluded)
  permission has_slot_2_cascade = ((slot_2 - excluded) & org->access)
    + (parent->has_slot_2_cascade - excluded)
  permission has_slot_3_cascade = ((slot_3 - excluded) & org->access)
    + (parent->has_slot_3_cascade - excluded)
  permission has_slot_4_cascade = ((slot_4 - excluded) & org->access)
    + (parent->has_slot_4_cascade - excluded)
  permission has_slot_5_cascade = ((slot_5 - excluded) & org->access)
    + (parent->has_slot_5_cascade - excluded)
  permission has_slot_6_cascade = ((slot_6 - excluded) & org->access)
    + (parent->has_slot_6_cascade - excluded)
  permission has_slot_7_cascade = ((slot_7 - excluded) & org->access)
    + (parent->has_slot_7_cascade - excluded)
  permission has_slot_8_cascade = ((slot_8 - excluded) & org->access)
    + (parent->has_slot_8_cascade - excluded)

  // ── LOCAL: direct grant only, no parent inheritance ──
  // Used when registry says cascade_from_parent=false
  permission has_slot_1_local = (slot_1 - excluded) & org->access
  permission has_slot_2_local = (slot_2 - excluded) & org->access
  permission has_slot_3_local = (slot_3 - excluded) & org->access
  permission has_slot_4_local = (slot_4 - excluded) & org->access
  permission has_slot_5_local = (slot_5 - excluded) & org->access
  permission has_slot_6_local = (slot_6 - excluded) & org->access
  permission has_slot_7_local = (slot_7 - excluded) & org->access
  permission has_slot_8_local = (slot_8 - excluded) & org->access
}`,
    notes: `8 slots × 2 modes = 16 permissions. Schema never changes when resource types are added.

IMPORTANT: No scope->has_slot_N in these expressions. Scope is composed at runtime. This is the fix for the slot-coupling problem.

If you ever need >8 slots per type, either split the type or add slot_9/slot_10 (one-time WriteSchema).`,
  },
]

const FULL_SCHEMA = SCHEMA_SECTIONS.map((s) => s.schema).join("\n\n")

// ═══════════════════════════════════════════════════════════════════════════════
// PG REGISTRY (REVISED)
// ═══════════════════════════════════════════════════════════════════════════════

const PG_REGISTRY = `-- ════════════════════════════════════════════════════════════
-- RESOURCE TYPE REGISTRY
-- ════════════════════════════════════════════════════════════

CREATE TABLE iam.resource_type (
    id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    org_id               TEXT NOT NULL,        -- 'platform' for built-ins
    name                 TEXT NOT NULL,         -- 'folder', 'project', 'traffic_plan'
    label                TEXT NOT NULL,
    description          TEXT,
    allow_root           BOOLEAN DEFAULT false, -- can exist without parent?
    supports_classification BOOLEAN DEFAULT false,
    system               BOOLEAN DEFAULT false, -- platform-defined, can't be deleted
    metadata             JSONB DEFAULT '{}',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(org_id, name)
);

CREATE TABLE iam.resource_type_action (
    id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    resource_type_id     TEXT NOT NULL REFERENCES iam.resource_type(id) ON DELETE CASCADE,
    name                 TEXT NOT NULL,         -- 'view', 'edit', 'simulate', 'approve'
    label                TEXT NOT NULL,
    description          TEXT,

    -- SpiceDB mapping
    slot                 SMALLINT NOT NULL,     -- 1–8, maps to slot_N in SpiceDB
    cascade_from_parent  BOOLEAN DEFAULT true,  -- use _cascade or _local variant?

    -- Implication graph (DAG, not chain)
    implies              TEXT[] DEFAULT '{}',   -- actions this GRANTS (one-way)
    requires             TEXT[] DEFAULT '{}',   -- actions that must ALL pass (AND)

    sort_order           SMALLINT DEFAULT 0,
    system               BOOLEAN DEFAULT false,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(resource_type_id, name),
    UNIQUE(resource_type_id, slot),
    CHECK(slot BETWEEN 1 AND 8)
);

CREATE TABLE iam.resource_type_containment (
    id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    parent_type_id       TEXT NOT NULL REFERENCES iam.resource_type(id) ON DELETE CASCADE,
    child_type_id        TEXT NOT NULL REFERENCES iam.resource_type(id) ON DELETE CASCADE,
    max_depth            SMALLINT,
    UNIQUE(parent_type_id, child_type_id)
);

-- ════════════════════════════════════════════════════════════
-- SCOPE TYPE REGISTRY (independent slot mapping)
-- ════════════════════════════════════════════════════════════

CREATE TABLE iam.scope_type (
    id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    org_id               TEXT NOT NULL,
    name                 TEXT NOT NULL,         -- 'region', 'topology', 'department'
    label                TEXT NOT NULL,
    default_inheritance  TEXT NOT NULL DEFAULT 'downward',
    max_depth            SMALLINT,
    system               BOOLEAN DEFAULT false,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(org_id, name)
);

CREATE TABLE iam.scope_type_action (
    id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    scope_type_id        TEXT NOT NULL REFERENCES iam.scope_type(id) ON DELETE CASCADE,
    name                 TEXT NOT NULL,         -- 'view', 'manage', 'lead'
    label                TEXT NOT NULL,
    slot                 SMALLINT NOT NULL,     -- 1–4, maps to scope_node.slot_N
    implies              TEXT[] DEFAULT '{}',
    UNIQUE(scope_type_id, name),
    UNIQUE(scope_type_id, slot),
    CHECK(slot BETWEEN 1 AND 4)
);

-- Declares which scope dimensions a resource type participates in
-- and which scope action is required for each resource action
CREATE TABLE iam.resource_type_scope_binding (
    id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    resource_type_id     TEXT NOT NULL REFERENCES iam.resource_type(id) ON DELETE CASCADE,
    scope_type_id        TEXT NOT NULL REFERENCES iam.scope_type(id) ON DELETE CASCADE,
    required             BOOLEAN DEFAULT false,

    -- Maps resource actions to scope actions
    -- e.g., {"view": "view", "edit": "manage", "admin": "manage"}
    -- resource action → scope action that must be satisfied
    action_mapping       JSONB NOT NULL DEFAULT '{}',

    UNIQUE(resource_type_id, scope_type_id)
);`

// ═══════════════════════════════════════════════════════════════════════════════
// SEED DATA (fully worked examples)
// ═══════════════════════════════════════════════════════════════════════════════

const SEED_TYPES = [
  {
    id: "folder",
    org: "platform",
    label: "Folder",
    system: true,
    actions: [
      { name: "discover", slot: 1, cascade: true, implies: [], requires: [] },
      {
        name: "view",
        slot: 2,
        cascade: true,
        implies: ["discover"],
        requires: [],
      },
      { name: "edit", slot: 3, cascade: true, implies: ["view"], requires: [] },
      {
        name: "share",
        slot: 4,
        cascade: false,
        implies: ["view"],
        requires: [],
      },
      {
        name: "admin",
        slot: 5,
        cascade: false,
        implies: ["edit", "share"],
        requires: [],
      },
    ],
    scopes: [],
  },
  {
    id: "project",
    org: "platform",
    label: "Project",
    system: true,
    actions: [
      { name: "discover", slot: 1, cascade: true, implies: [], requires: [] },
      {
        name: "view",
        slot: 2,
        cascade: true,
        implies: ["discover"],
        requires: [],
      },
      { name: "edit", slot: 3, cascade: true, implies: ["view"], requires: [] },
      {
        name: "configure",
        slot: 4,
        cascade: false,
        implies: ["view"],
        requires: [],
      },
      {
        name: "deploy",
        slot: 5,
        cascade: false,
        implies: ["view"],
        requires: [],
      },
      {
        name: "admin",
        slot: 6,
        cascade: false,
        implies: ["edit", "configure", "deploy", "share"],
        requires: [],
      },
      {
        name: "share",
        slot: 7,
        cascade: false,
        implies: ["view"],
        requires: [],
      },
    ],
    scopes: [
      {
        type: "region",
        required: false,
        mapping: { view: "view", edit: "manage", admin: "manage" },
      },
    ],
  },
  {
    id: "traffic_plan",
    org: "samsung",
    label: "Traffic Plan",
    system: false,
    actions: [
      { name: "view", slot: 1, cascade: true, implies: [], requires: [] },
      {
        name: "edit",
        slot: 2,
        cascade: false,
        implies: ["view"],
        requires: [],
      },
      {
        name: "simulate",
        slot: 3,
        cascade: false,
        implies: ["view"],
        requires: [],
      },
      {
        name: "approve",
        slot: 4,
        cascade: false,
        implies: ["view"],
        requires: [],
      },
      {
        name: "publish",
        slot: 5,
        cascade: false,
        implies: [],
        requires: ["edit", "approve"],
      },
      {
        name: "admin",
        slot: 6,
        cascade: false,
        implies: ["edit", "simulate", "approve", "publish"],
        requires: [],
      },
    ],
    scopes: [
      {
        type: "region",
        required: true,
        mapping: {
          view: "view",
          edit: "manage",
          simulate: "view",
          approve: "manage",
          publish: "manage",
        },
      },
      {
        type: "department",
        required: false,
        mapping: { edit: "participate", approve: "lead" },
      },
    ],
  },
  {
    id: "reg_document",
    org: "abudhabi_dot",
    label: "Regulated Document",
    system: false,
    actions: [
      { name: "discover", slot: 1, cascade: true, implies: [], requires: [] },
      {
        name: "view",
        slot: 2,
        cascade: true,
        implies: ["discover"],
        requires: [],
      },
      {
        name: "comment",
        slot: 3,
        cascade: false,
        implies: ["view"],
        requires: [],
      },
      {
        name: "edit",
        slot: 4,
        cascade: false,
        implies: ["view"],
        requires: [],
      },
      {
        name: "review",
        slot: 5,
        cascade: false,
        implies: ["view", "comment"],
        requires: [],
      },
      {
        name: "approve",
        slot: 6,
        cascade: false,
        implies: ["view"],
        requires: ["review"],
      },
      {
        name: "publish",
        slot: 7,
        cascade: false,
        implies: [],
        requires: ["approve", "edit"],
      },
      {
        name: "admin",
        slot: 8,
        cascade: false,
        implies: ["edit", "review", "approve", "publish", "comment"],
        requires: [],
      },
    ],
    scopes: [
      {
        type: "region",
        required: true,
        mapping: {
          view: "view",
          edit: "manage",
          approve: "manage",
          publish: "manage",
        },
      },
    ],
  },
]

// ═══════════════════════════════════════════════════════════════════════════════
// CONCRETE TUPLES & RESOLUTION SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════════

const TUPLES = `// ─── Organizations ──────────────────────────────────────
organization:lepton#member@principal:nikhil
organization:lepton#member@principal:vikrant
organization:lepton#member@principal:amaan
organization:lepton#guest@principal:sonu
organization:samsung#member@principal:sonu
organization:samsung#member@principal:vinay

// ─── Roles ─────────────────────────────────────────────
role:lepton_admin#org@organization:lepton
role:lepton_admin#member@principal:nikhil

role:samsung_ops#org@organization:samsung
role:samsung_ops#member@principal:sonu
role:samsung_ops#member@principal:vinay

// ─── Scope nodes (region dimension) ────────────────────
// Lepton's region hierarchy
scope_node:region_india#org@organization:lepton
scope_node:region_bihar#org@organization:lepton
scope_node:region_jharkhand#org@organization:lepton
scope_node:region_patna#org@organization:lepton

scope_node:region_bihar#parent@scope_node:region_india
scope_node:region_jharkhand#parent@scope_node:region_india
scope_node:region_patna#parent@scope_node:region_bihar

// Scope slot assignments (scope_type "region": slot_1=view, slot_2=manage)
scope_node:region_india#slot_1@principal:nikhil         // nikhil can "view" in all india
scope_node:region_india#slot_2@principal:nikhil         // nikhil can "manage" in all india
scope_node:region_patna#slot_1@principal:vikrant        // vikrant can "view" in patna only
scope_node:region_jharkhand#slot_1@principal:amaan      // amaan can "view" in jharkhand
scope_node:region_jharkhand#slot_2@principal:amaan      // amaan can "manage" in jharkhand
scope_node:region_bihar#excluded@principal:nikhil       // nikhil EXCLUDED from bihar subtree

// Samsung's region hierarchy
scope_node:region_korea#org@organization:samsung
scope_node:region_seoul#org@organization:samsung
scope_node:region_seoul#parent@scope_node:region_korea
scope_node:region_korea#slot_1@principal:sonu           // sonu views all korea
scope_node:region_korea#slot_2@principal:vinay          // vinay manages all korea

// ─── Scope nodes (department dimension) ────────────────
scope_node:dept_engineering#org@organization:samsung
scope_node:dept_planning#org@organization:samsung

// Dept scope_type: slot_1=participate, slot_2=lead
scope_node:dept_planning#slot_1@principal:sonu          // sonu participates in planning
scope_node:dept_planning#slot_2@principal:vinay         // vinay leads planning

// ─── Resources (Lepton) ───────────────────────────────
// folder1: edit=slot_3 (from folder registry)
resource:folder1#org@organization:lepton
resource:folder1#slot_3@principal:sonu                  // sonu can "edit" folder1

// project1: parent is folder1
resource:project1#org@organization:lepton
resource:project1#parent@resource:folder1
resource:project1#slot_3@role:lepton_admin#member       // lepton_admin role → "edit"
resource:project1#slot_3@principal:vikrant              // vikrant direct "edit"
resource:project1#slot_5@principal:vikrant              // vikrant direct "deploy"

// project1 scoped to region_jharkhand
resource:project1#scope@scope_node:region_jharkhand

// ─── Resources (Samsung) ──────────────────────────────
// traffic_plan tp_001
resource:tp_001#org@organization:samsung
resource:tp_001#scope@scope_node:region_seoul           // scoped to seoul region
resource:tp_001#scope@scope_node:dept_planning          // scoped to planning dept
resource:tp_001#slot_2@principal:sonu                   // sonu can "edit"
resource:tp_001#slot_3@principal:sonu                   // sonu can "simulate"
resource:tp_001#slot_4@principal:vinay                  // vinay can "approve"
resource:tp_001#slot_2@principal:vinay                  // vinay can "edit"`

const SCENARIOS = [
  {
    id: "cascade",
    title: "Parent Cascade (edit cascades, configure doesn't)",
    question: 'Can sonu "edit" project1?',
    type: "project",
    principal: "sonu",
    action: "edit",
    steps: [
      {
        phase: "registry",
        label: "Resolve type",
        detail: 'project1 → resource_type = "project"',
        pass: null,
      },
      {
        phase: "registry",
        label: "Lookup action",
        detail:
          "project.edit → slot: 3, cascade_from_parent: true, implies: [view], requires: []",
        pass: null,
      },
      {
        phase: "spicedb",
        label: "Choose SpiceDB perm",
        detail: "cascade=true → has_slot_3_cascade",
        pass: null,
      },
      {
        phase: "spicedb",
        label: "Check resource",
        detail: "resource:project1#has_slot_3_cascade@principal:sonu",
        pass: null,
      },
      {
        phase: "spicedb",
        label: "Direct slot_3?",
        detail: "resource:project1#slot_3@principal:sonu → ✗ NO",
        pass: false,
      },
      {
        phase: "spicedb",
        label: "Parent cascade",
        detail:
          "project1.parent = folder1 → resource:folder1#has_slot_3_cascade@principal:sonu",
        pass: null,
      },
      {
        phase: "spicedb",
        label: "folder1 direct",
        detail: "resource:folder1#slot_3@principal:sonu → ✓ HAS",
        pass: true,
      },
      {
        phase: "spicedb",
        label: "Org check",
        detail: "organization:lepton#guest@principal:sonu → ✓ PASS",
        pass: true,
      },
      {
        phase: "scope",
        label: "Scope required?",
        detail: "project.edit has scope binding: region → manage required",
        pass: null,
      },
      {
        phase: "scope",
        label: "Resource scope",
        detail: "project1#scope = scope_node:region_jharkhand",
        pass: null,
      },
      {
        phase: "scope",
        label: "Scope check",
        detail:
          "scope_node:region_jharkhand#has_slot_2@principal:sonu → ✗ NO (sonu has no region manage)",
        pass: false,
      },
      {
        phase: "result",
        label: "RESULT",
        detail:
          "✗ DENIED — sonu has edit via parent cascade but fails scope check (no 'manage' in jharkhand region)",
        pass: false,
      },
    ],
  },
  {
    id: "cascade_no_scope",
    title: "Parent Cascade (no scope binding)",
    question: 'Can sonu "edit" folder1? (folders have no scope binding)',
    type: "folder",
    principal: "sonu",
    action: "edit",
    steps: [
      {
        phase: "registry",
        label: "Resolve type",
        detail: 'folder1 → resource_type = "folder"',
        pass: null,
      },
      {
        phase: "registry",
        label: "Lookup action",
        detail:
          "folder.edit → slot: 3, cascade_from_parent: true, implies: [view], requires: []",
        pass: null,
      },
      {
        phase: "spicedb",
        label: "Choose SpiceDB perm",
        detail: "cascade=true → has_slot_3_cascade",
        pass: null,
      },
      {
        phase: "spicedb",
        label: "Check resource",
        detail: "resource:folder1#has_slot_3_cascade@principal:sonu",
        pass: null,
      },
      {
        phase: "spicedb",
        label: "Direct slot_3?",
        detail: "resource:folder1#slot_3@principal:sonu → ✓ HAS",
        pass: true,
      },
      {
        phase: "spicedb",
        label: "Org check",
        detail: "organization:lepton#guest@principal:sonu → ✓ PASS",
        pass: true,
      },
      {
        phase: "scope",
        label: "Scope required?",
        detail: "folder type has NO scope bindings → skip scope check",
        pass: true,
      },
      {
        phase: "result",
        label: "RESULT",
        detail: "✓ ALLOWED — direct grant, no scope required for folders",
        pass: true,
      },
    ],
  },
  {
    id: "non_cascade",
    title: "Non-Cascading Action (configure doesn't inherit from parent)",
    question: 'Can sonu "configure" project1?',
    type: "project",
    principal: "sonu",
    action: "configure",
    steps: [
      {
        phase: "registry",
        label: "Resolve type",
        detail: 'project1 → resource_type = "project"',
        pass: null,
      },
      {
        phase: "registry",
        label: "Lookup action",
        detail:
          "project.configure → slot: 4, cascade_from_parent: false, implies: [view], requires: []",
        pass: null,
      },
      {
        phase: "spicedb",
        label: "Choose SpiceDB perm",
        detail: "cascade=false → has_slot_4_local",
        pass: null,
      },
      {
        phase: "spicedb",
        label: "Check resource",
        detail: "resource:project1#has_slot_4_local@principal:sonu",
        pass: null,
      },
      {
        phase: "spicedb",
        label: "Direct slot_4?",
        detail: "resource:project1#slot_4@principal:sonu → ✗ NO",
        pass: false,
      },
      {
        phase: "implies",
        label: "Parent cascade?",
        detail:
          "cascade_from_parent=false → NOT checked. Folder1's grants do NOT propagate.",
        pass: null,
      },
      {
        phase: "implies",
        label: "Implied by higher?",
        detail: "Which actions imply configure? → admin (slot_6)",
        pass: null,
      },
      {
        phase: "spicedb",
        label: "Check admin",
        detail: "resource:project1#has_slot_6_local@principal:sonu → ✗ NO",
        pass: false,
      },
      {
        phase: "result",
        label: "RESULT",
        detail:
          "✗ DENIED — configure is non-cascading, sonu has no direct configure or admin on project1",
        pass: false,
      },
    ],
  },
  {
    id: "dag_not_chain",
    title: "DAG Permissions (configure ≠ deploy, both independent)",
    question:
      'Can vikrant "deploy" project1? (has edit + deploy, not configure)',
    type: "project",
    principal: "vikrant",
    action: "deploy",
    steps: [
      {
        phase: "registry",
        label: "Resolve type",
        detail: 'project1 → resource_type = "project"',
        pass: null,
      },
      {
        phase: "registry",
        label: "Lookup action",
        detail:
          "project.deploy → slot: 5, cascade_from_parent: false, implies: [view], requires: []",
        pass: null,
      },
      {
        phase: "spicedb",
        label: "Choose SpiceDB perm",
        detail: "cascade=false → has_slot_5_local",
        pass: null,
      },
      {
        phase: "spicedb",
        label: "Check resource",
        detail: "resource:project1#has_slot_5_local@principal:vikrant",
        pass: null,
      },
      {
        phase: "spicedb",
        label: "Direct slot_5?",
        detail: "resource:project1#slot_5@principal:vikrant → ✓ HAS",
        pass: true,
      },
      {
        phase: "spicedb",
        label: "Org check",
        detail: "organization:lepton#member@principal:vikrant → ✓ PASS",
        pass: true,
      },
      {
        phase: "scope",
        label: "Scope check (region)",
        detail: "project.deploy has no scope mapping → skip",
        pass: true,
      },
      {
        phase: "result",
        label: "RESULT",
        detail:
          "✓ ALLOWED — vikrant has deploy directly. Note: vikrant does NOT have configure (slot_4). deploy and configure are independent branches in the DAG.",
        pass: true,
      },
    ],
  },
  {
    id: "requires",
    title: "Intersection Requirement (publish requires edit AND approve)",
    question: 'Can sonu "publish" traffic plan tp_001?',
    type: "traffic_plan",
    principal: "sonu",
    action: "publish",
    steps: [
      {
        phase: "registry",
        label: "Resolve type",
        detail: 'tp_001 → resource_type = "traffic_plan" (org: samsung)',
        pass: null,
      },
      {
        phase: "registry",
        label: "Lookup action",
        detail:
          "traffic_plan.publish → slot: 5, cascade: false, implies: [], requires: [edit, approve]",
        pass: null,
      },
      {
        phase: "requires",
        label: "REQUIRES check",
        detail:
          "publish has requires: [edit, approve] → must check BOTH independently",
        pass: null,
      },
      {
        phase: "spicedb",
        label: "Check 'edit'",
        detail:
          "traffic_plan.edit → slot_2, local → resource:tp_001#has_slot_2_local@principal:sonu",
        pass: null,
      },
      {
        phase: "spicedb",
        label: "Direct slot_2?",
        detail: "resource:tp_001#slot_2@principal:sonu → ✓ HAS",
        pass: true,
      },
      {
        phase: "spicedb",
        label: "Check 'approve'",
        detail:
          "traffic_plan.approve → slot_4, local → resource:tp_001#has_slot_4_local@principal:sonu",
        pass: null,
      },
      {
        phase: "spicedb",
        label: "Direct slot_4?",
        detail: "resource:tp_001#slot_4@principal:sonu → ✗ NO",
        pass: false,
      },
      {
        phase: "implies",
        label: "Implied by admin?",
        detail:
          "admin (slot_6) implies approve → resource:tp_001#has_slot_6_local@principal:sonu → ✗ NO",
        pass: false,
      },
      {
        phase: "result",
        label: "RESULT",
        detail:
          "✗ DENIED — sonu has edit but NOT approve. Publish REQUIRES both. Even though sonu can simulate and edit, they can't publish without approval authority.",
        pass: false,
      },
    ],
  },
  {
    id: "requires_pass",
    title: "Intersection Satisfied (vinay can publish)",
    question: 'Can vinay "publish" traffic plan tp_001?',
    type: "traffic_plan",
    principal: "vinay",
    action: "publish",
    steps: [
      {
        phase: "registry",
        label: "Resolve type",
        detail: 'tp_001 → resource_type = "traffic_plan" (org: samsung)',
        pass: null,
      },
      {
        phase: "registry",
        label: "Lookup action",
        detail:
          "traffic_plan.publish → slot: 5, cascade: false, requires: [edit, approve]",
        pass: null,
      },
      {
        phase: "requires",
        label: "REQUIRES check",
        detail: "Must pass BOTH edit AND approve",
        pass: null,
      },
      {
        phase: "spicedb",
        label: "Check 'edit'",
        detail:
          "slot_2, local → resource:tp_001#has_slot_2_local@principal:vinay → ✓ HAS",
        pass: true,
      },
      {
        phase: "spicedb",
        label: "Check 'approve'",
        detail:
          "slot_4, local → resource:tp_001#has_slot_4_local@principal:vinay → ✓ HAS",
        pass: true,
      },
      {
        phase: "spicedb",
        label: "Org check",
        detail: "organization:samsung#member@principal:vinay → ✓ PASS",
        pass: true,
      },
      {
        phase: "scope",
        label: "Region scope",
        detail:
          "tp_001#scope = region_seoul. publish→manage. scope_node:region_seoul → parent:region_korea",
        pass: null,
      },
      {
        phase: "scope",
        label: "Region check",
        detail:
          "scope_node:region_korea#has_slot_2@principal:vinay → ✓ (vinay has manage on all korea)",
        pass: true,
      },
      {
        phase: "scope",
        label: "Dept scope",
        detail:
          "tp_001#scope = dept_planning. publish→(not mapped for dept) → skip",
        pass: true,
      },
      {
        phase: "result",
        label: "RESULT",
        detail:
          "✓ ALLOWED — vinay has both edit AND approve, passes region scope check via korea parent cascade",
        pass: true,
      },
    ],
  },
  {
    id: "scope_exclusion",
    title: "Scope Exclusion Override (nikhil excluded from bihar)",
    question: 'Can nikhil "edit" a project scoped to region_patna?',
    type: "project",
    principal: "nikhil",
    action: "edit",
    steps: [
      {
        phase: "registry",
        label: "Setup",
        detail:
          "Assume project2 scoped to region_patna, nikhil has edit via lepton_admin role",
        pass: null,
      },
      {
        phase: "spicedb",
        label: "Resource check",
        detail: "nikhil has slot_3 via role:lepton_admin#member → ✓ HAS",
        pass: true,
      },
      {
        phase: "scope",
        label: "Region scope",
        detail: "project.edit → region.manage (slot_2) required",
        pass: null,
      },
      {
        phase: "scope",
        label: "Scope resolution",
        detail:
          "scope_node:region_patna → parent: region_bihar → parent: region_india",
        pass: null,
      },
      {
        phase: "scope",
        label: "India slot_2?",
        detail:
          "scope_node:region_india#slot_2@principal:nikhil → ✓ HAS (would cascade down)",
        pass: true,
      },
      {
        phase: "scope",
        label: "Bihar exclusion!",
        detail:
          "scope_node:region_bihar#excluded@principal:nikhil → ✓ EXCLUDED",
        pass: false,
      },
      {
        phase: "scope",
        label: "Exclusion propagates",
        detail:
          "Bihar exclusion blocks cascade to patna. nikhil's india grant doesn't reach patna.",
        pass: false,
      },
      {
        phase: "result",
        label: "RESULT",
        detail:
          "✗ DENIED — nikhil has manage for all india BUT is excluded from bihar subtree. Patna is under bihar, so scope check fails.",
        pass: false,
      },
    ],
  },
  {
    id: "eight_slot",
    title: "8-Slot Type (regulated document with approval chain)",
    question: 'Can someone "approve" a regulated document? (requires review)',
    type: "reg_document",
    principal: "reviewer_x",
    action: "approve",
    steps: [
      {
        phase: "registry",
        label: "Resolve type",
        detail: "reg_document: 8 actions across 8 slots",
        pass: null,
      },
      {
        phase: "registry",
        label: "Lookup action",
        detail:
          "reg_document.approve → slot: 6, cascade: false, implies: [view], requires: [review]",
        pass: null,
      },
      {
        phase: "requires",
        label: "REQUIRES check",
        detail:
          "approve requires [review] → must independently check review first",
        pass: null,
      },
      {
        phase: "spicedb",
        label: "Check 'review'",
        detail: "slot_5, local → must have direct review grant",
        pass: null,
      },
      {
        phase: "spicedb",
        label: "Then check 'approve'",
        detail: "slot_6, local → must also have direct approve grant",
        pass: null,
      },
      {
        phase: "registry",
        label: "Implication chain",
        detail:
          "review implies [view, comment] → if you can review, you can also view and comment automatically",
        pass: null,
      },
      {
        phase: "registry",
        label: "Publish requires",
        detail:
          "publish (slot_7) requires [approve, edit] → separation of duties enforced by schema",
        pass: null,
      },
      {
        phase: "result",
        label: "Architecture note",
        detail:
          "8 slots used. discover→view→comment→edit→review→approve→publish→admin. Each with independent cascade and requires config. No chain assumption.",
        pass: null,
      },
    ],
  },
]

// ═══════════════════════════════════════════════════════════════════════════════
// RUNTIME INTERPRETER (REVISED)
// ═══════════════════════════════════════════════════════════════════════════════

const RUNTIME_CODE = `// ═══════════════════════════════════════════════════════════════
// Runtime Authorization Interpreter
// Translates: "can principal X do action Y on resource Z?"
// Into: SpiceDB slot checks + scope checks + requires/implies
// ═══════════════════════════════════════════════════════════════

interface ActionConfig {
  slot: number;                    // 1-8
  cascade_from_parent: boolean;
  implies: string[];               // actions this grants
  requires: string[];              // actions that must ALL pass
}

interface ScopeBinding {
  scope_type: string;              // "region", "department"
  required: boolean;
  action_mapping: Record<string, string>;  // resource_action → scope_action
}

async function checkPermission(
  principalId: string,
  resourceId: string,
  action: string,
): Promise<{ allowed: boolean; reason: string }> {

  // ── Step 1: Resolve resource type ──
  const resource = await db.getResource(resourceId);
  const typeConfig = registry.getType(resource.resource_type);

  // ── Step 2: Check the action (with requires + implies) ──
  const result = await checkAction(
    principalId, resourceId, resource, typeConfig, action, new Set()
  );
  if (!result.allowed) return result;

  // ── Step 3: Check scope bindings (separate from SpiceDB resource check) ──
  const scopeBindings = registry.getScopeBindings(resource.resource_type);
  for (const binding of scopeBindings) {
    const scopeAction = binding.action_mapping[action];
    if (!scopeAction) continue;  // this resource action has no scope requirement for this dimension

    const scopeNodes = await db.getResourceScopes(resourceId, binding.scope_type);
    if (scopeNodes.length === 0 && binding.required) {
      return { allowed: false, reason: \`resource missing required scope: \${binding.scope_type}\` };
    }

    // Must pass scope check on AT LEAST ONE bound scope node
    const scopeSlot = registry.getScopeAction(binding.scope_type, scopeAction);
    let scopePassed = scopeNodes.length === 0;  // no scope = no check needed
    for (const scopeNode of scopeNodes) {
      const scopeResult = await spicedb.check({
        resource: { type: "scope_node", id: scopeNode },
        permission: \`has_slot_\${scopeSlot.slot}\`,
        subject: { type: "principal", id: principalId },
      });
      if (scopeResult.allowed) { scopePassed = true; break; }
    }
    if (!scopePassed) {
      return { allowed: false, reason: \`scope check failed: \${binding.scope_type}.\${scopeAction}\` };
    }
  }

  return { allowed: true, reason: "all checks passed" };
}

async function checkAction(
  principalId: string,
  resourceId: string,
  resource: Resource,
  typeConfig: TypeConfig,
  action: string,
  visited: Set<string>,          // cycle detection for implies graph
): Promise<{ allowed: boolean; reason: string }> {

  if (visited.has(action)) return { allowed: false, reason: "cycle" };
  visited.add(action);

  const actionConfig = typeConfig.actions[action];
  if (!actionConfig) return { allowed: false, reason: \`unknown action: \${action}\` };

  // ── REQUIRES: all must independently pass ──
  if (actionConfig.requires.length > 0) {
    for (const req of actionConfig.requires) {
      const reqResult = await checkAction(
        principalId, resourceId, resource, typeConfig, req, new Set(visited)
      );
      if (!reqResult.allowed) {
        return { allowed: false, reason: \`requires \${req}: \${reqResult.reason}\` };
      }
    }
  }

  // ── DIRECT: check this action's slot ──
  const perm = actionConfig.cascade_from_parent
    ? \`has_slot_\${actionConfig.slot}_cascade\`
    : \`has_slot_\${actionConfig.slot}_local\`;

  const directResult = await spicedb.check({
    resource: { type: "resource", id: resourceId },
    permission: perm,
    subject: { type: "principal", id: principalId },
  });
  if (directResult.allowed) return { allowed: true, reason: \`direct: \${action}\` };

  // ── IMPLIED BY: check actions that imply this one ──
  const impliedBy = registry.getActionsThatImply(resource.resource_type, action);
  for (const higher of impliedBy) {
    const higherResult = await checkAction(
      principalId, resourceId, resource, typeConfig, higher, visited
    );
    if (higherResult.allowed) {
      return { allowed: true, reason: \`implied by \${higher}\` };
    }
  }

  return { allowed: false, reason: \`no grant for \${action}\` };
}

// ── OPTIMIZED: Bulk check with BulkCheckPermission ──
// In practice, don't do sequential checks.
// Collect all needed (resource, permission, subject) triples
// and batch them in one BulkCheckPermission RPC.

async function checkPermissionBulk(
  principalId: string,
  resourceId: string,
  action: string,
): Promise<boolean> {

  const resource = await db.getResource(resourceId);
  const typeConfig = registry.getType(resource.resource_type);
  const actionConfig = typeConfig.actions[action];

  // Collect ALL possible permission checks upfront
  const checks: CheckItem[] = [];

  // The direct slot
  checks.push({
    resource: { type: "resource", id: resourceId },
    permission: actionConfig.cascade_from_parent
      ? \`has_slot_\${actionConfig.slot}_cascade\`
      : \`has_slot_\${actionConfig.slot}_local\`,
    subject: { type: "principal", id: principalId },
    label: \`direct:\${action}\`,
  });

  // All actions that imply this one
  const impliedBy = registry.getActionsThatImply(resource.resource_type, action);
  for (const higher of impliedBy) {
    const hc = typeConfig.actions[higher];
    checks.push({
      resource: { type: "resource", id: resourceId },
      permission: hc.cascade_from_parent
        ? \`has_slot_\${hc.slot}_cascade\`
        : \`has_slot_\${hc.slot}_local\`,
      subject: { type: "principal", id: principalId },
      label: \`implied:\${higher}\`,
    });
  }

  // Scope checks
  const scopeBindings = registry.getScopeBindings(resource.resource_type);
  const scopeNodes = await db.getResourceScopes(resourceId);
  for (const binding of scopeBindings) {
    const scopeAction = binding.action_mapping[action];
    if (!scopeAction) continue;
    const scopeSlot = registry.getScopeAction(binding.scope_type, scopeAction);
    for (const node of scopeNodes.filter(s => s.type === binding.scope_type)) {
      checks.push({
        resource: { type: "scope_node", id: node.id },
        permission: \`has_slot_\${scopeSlot.slot}\`,
        subject: { type: "principal", id: principalId },
        label: \`scope:\${binding.scope_type}.\${scopeAction}\`,
      });
    }
  }

  // ONE round trip
  const results = await spicedb.bulkCheck(checks);

  // Evaluate: (directOrImplied) AND (allScopesPassed)
  // ... compose results based on registry rules
}`

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

const TABS = [
  { id: "schema", label: "SpiceDB Schema" },
  { id: "registry", label: "PG Registry" },
  { id: "tuples", label: "Tuples" },
  { id: "scenarios", label: "Scenarios" },
  { id: "runtime", label: "Runtime Code" },
  { id: "types", label: "Type Explorer" },
]

const phaseColors = {
  registry: "#818cf8",
  spicedb: "#3b82f6",
  scope: "#f59e0b",
  implies: "#c084fc",
  requires: "#fb923c",
  result: "#71717a",
}

const Badge = ({ text, color = "#71717a", small = false }) => (
  <span
    style={{
      display: "inline-block",
      padding: small ? "1px 5px" : "2px 7px",
      borderRadius: "3px",
      fontSize: small ? "9px" : "10px",
      fontWeight: 700,
      fontFamily: mono,
      color,
      backgroundColor: `${color}12`,
      border: `1px solid ${color}25`,
      letterSpacing: "0.03em",
    }}
  >
    {text}
  </span>
)

const Code = ({ children, maxHeight = null }) => (
  <pre
    style={{
      padding: "14px 16px",
      borderRadius: "6px",
      border: "1px solid #1a1a22",
      backgroundColor: "#08080c",
      fontSize: "11px",
      fontFamily: mono,
      lineHeight: "1.7",
      color: "#a1a1aa",
      overflow: "auto",
      maxHeight,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      margin: 0,
    }}
  >
    {children}
  </pre>
)

export default function RevisedSchema() {
  const [tab, setTab] = useState("schema")
  const [schemaSection, setSchemaSection] = useState("identity")
  const [scenario, setScenario] = useState("cascade")
  const [selectedType, setSelectedType] = useState("folder")

  const currentScenario = SCENARIOS.find((s) => s.id === scenario)
  const currentType = SEED_TYPES.find((t) => t.id === selectedType)

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#0a0a0c",
        color: "#e4e4e7",
        fontFamily: sans,
        padding: "20px",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: "20px" }}>
        <div
          style={{
            fontSize: "9px",
            fontWeight: 800,
            fontFamily: mono,
            color: "#f59e0b",
            letterSpacing: "0.12em",
            marginBottom: "4px",
          }}
        >
          PLATFORM FABRIC — AUTHORIZATION v2
        </div>
        <div
          style={{
            fontSize: "18px",
            fontWeight: 700,
            color: "#fafafa",
            letterSpacing: "-0.01em",
          }}
        >
          User-Defined Resource Types — Revised Schema
        </div>
        <div style={{ fontSize: "11px", color: "#52525b", marginTop: "3px" }}>
          Slots (not tiers) · Decoupled scope · Requires/Implies DAG · 8 slots
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: "1px",
          marginBottom: "16px",
          borderRadius: "5px",
          overflow: "hidden",
          border: "1px solid #18181b",
          backgroundColor: "#0d0d0f",
          padding: "2px",
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "6px 12px",
              borderRadius: "3px",
              border: "none",
              cursor: "pointer",
              fontSize: "10.5px",
              fontWeight: 600,
              fontFamily: sans,
              transition: "all 0.12s",
              backgroundColor: tab === t.id ? "#1c1c24" : "transparent",
              color: tab === t.id ? "#fafafa" : "#52525b",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══ SCHEMA TAB ═══ */}
      {tab === "schema" && (
        <div>
          <div
            style={{
              display: "flex",
              gap: "1px",
              marginBottom: "12px",
              borderRadius: "4px",
              overflow: "hidden",
              border: "1px solid #18181b",
              backgroundColor: "#0d0d0f",
              padding: "2px",
            }}
          >
            {SCHEMA_SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSchemaSection(s.id)}
                style={{
                  padding: "5px 10px",
                  borderRadius: "3px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "10px",
                  fontWeight: 600,
                  fontFamily: mono,
                  backgroundColor:
                    schemaSection === s.id ? "#1c1c24" : "transparent",
                  color: schemaSection === s.id ? "#fafafa" : "#52525b",
                }}
              >
                {s.label}
              </button>
            ))}
            <button
              onClick={() => setSchemaSection("full")}
              style={{
                padding: "5px 10px",
                borderRadius: "3px",
                border: "none",
                cursor: "pointer",
                fontSize: "10px",
                fontWeight: 600,
                fontFamily: mono,
                marginLeft: "auto",
                backgroundColor:
                  schemaSection === "full" ? "#1c1c24" : "transparent",
                color: schemaSection === "full" ? "#f59e0b" : "#52525b",
              }}
            >
              FULL SCHEMA
            </button>
          </div>

          {schemaSection === "full" ? (
            <Code maxHeight="600px">{FULL_SCHEMA}</Code>
          ) : (
            (() => {
              const section = SCHEMA_SECTIONS.find(
                (s) => s.id === schemaSection
              )
              return (
                <div>
                  <Code maxHeight="500px">{section.schema}</Code>
                  <div
                    style={{
                      marginTop: "10px",
                      padding: "10px 14px",
                      borderRadius: "5px",
                      border: "1px solid #4ade8025",
                      backgroundColor: "#0a120a",
                      fontSize: "11px",
                      color: "#86efac",
                      lineHeight: "1.7",
                      fontFamily: mono,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {section.notes}
                  </div>
                </div>
              )
            })()
          )}
        </div>
      )}

      {/* ═══ REGISTRY TAB ═══ */}
      {tab === "registry" && (
        <div>
          <div
            style={{
              padding: "8px 12px",
              borderRadius: "5px",
              marginBottom: "12px",
              border: "1px solid #3b82f625",
              backgroundColor: "#080c14",
              fontSize: "11px",
              color: "#93c5fd",
              lineHeight: "1.7",
            }}
          >
            <strong>Key addition:</strong>{" "}
            <code style={{ fontFamily: mono }}>
              resource_type_scope_binding
            </code>{" "}
            table decouples scope slot numbering from resource slot numbering.
            Each resource type declares which scope dimensions it participates
            in and maps its actions to scope actions independently.
          </div>
          <Code maxHeight="600px">{PG_REGISTRY}</Code>
        </div>
      )}

      {/* ═══ TUPLES TAB ═══ */}
      {tab === "tuples" && (
        <div>
          <div
            style={{
              padding: "8px 12px",
              borderRadius: "5px",
              marginBottom: "12px",
              border: "1px solid #f59e0b25",
              backgroundColor: "#0e0c08",
              fontSize: "11px",
              color: "#fde68a",
              lineHeight: "1.7",
            }}
          >
            Note how <code style={{ fontFamily: mono }}>slot_N</code> is used
            instead of semantic names.
            <code style={{ fontFamily: mono }}>
              {" "}
              resource:project1#slot_3
            </code>{" "}
            means "project.edit" because the registry maps project.edit → slot
            3. Samsung's traffic_plan maps edit → slot 2 (different number, same
            semantics).
          </div>
          <Code maxHeight="700px">{TUPLES}</Code>
        </div>
      )}

      {/* ═══ SCENARIOS TAB ═══ */}
      {tab === "scenarios" && (
        <div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "4px",
              marginBottom: "14px",
            }}
          >
            {SCENARIOS.map((s) => {
              const isActive = scenario === s.id
              const isPass = s.steps[s.steps.length - 1].pass
              return (
                <button
                  key={s.id}
                  onClick={() => setScenario(s.id)}
                  style={{
                    padding: "6px 8px",
                    borderRadius: "4px",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "9px",
                    fontWeight: 600,
                    fontFamily: mono,
                    textAlign: "left",
                    backgroundColor: isActive ? "#1c1c24" : "#0d0d0f",
                    color: isActive ? "#fafafa" : "#52525b",
                    borderLeft: `2px solid ${isPass === true ? "#4ade80" : isPass === false ? "#f87171" : "#52525b"}`,
                  }}
                >
                  {s.title.length > 40 ? s.title.slice(0, 38) + "…" : s.title}
                </button>
              )
            })}
          </div>

          {currentScenario && (
            <div
              style={{
                borderRadius: "6px",
                border: "1px solid #18181b",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "10px 14px",
                  backgroundColor: "#0e0e12",
                  borderBottom: "1px solid #18181b",
                }}
              >
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "#e4e4e7",
                    marginBottom: "2px",
                  }}
                >
                  {currentScenario.title}
                </div>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 700,
                    color: "#fafafa",
                    fontFamily: mono,
                  }}
                >
                  {currentScenario.question}
                </div>
              </div>

              {currentScenario.steps.map((step, i) => {
                const isResult = step.phase === "result"
                const phaseColor = phaseColors[step.phase] || "#71717a"
                return (
                  <div
                    key={i}
                    style={{
                      padding: "5px 14px",
                      display: "flex",
                      gap: "8px",
                      alignItems: "flex-start",
                      borderBottom:
                        i < currentScenario.steps.length - 1
                          ? "1px solid #111114"
                          : "none",
                      backgroundColor: isResult
                        ? step.pass
                          ? "#0a160a"
                          : "#160a0a"
                        : i % 2 === 0
                          ? "transparent"
                          : "#0a0a0e08",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "8px",
                        fontWeight: 700,
                        fontFamily: mono,
                        color: phaseColor,
                        minWidth: "52px",
                        paddingTop: "3px",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {step.phase}
                    </span>
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        fontFamily: mono,
                        color: isResult
                          ? step.pass
                            ? "#4ade80"
                            : "#f87171"
                          : "#a1a1aa",
                        minWidth: "130px",
                        paddingTop: "1px",
                      }}
                    >
                      {step.label}
                    </span>
                    <span
                      style={{
                        fontSize: "10.5px",
                        fontFamily: mono,
                        lineHeight: "1.6",
                        color: isResult
                          ? step.pass
                            ? "#86efac"
                            : "#fca5a5"
                          : step.pass === true
                            ? "#a1a1aa"
                            : step.pass === false
                              ? "#f8717199"
                              : "#71717a",
                      }}
                    >
                      {step.detail}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ RUNTIME TAB ═══ */}
      {tab === "runtime" && (
        <div>
          <div
            style={{
              padding: "8px 12px",
              borderRadius: "5px",
              marginBottom: "12px",
              border: "1px solid #c084fc25",
              backgroundColor: "#0c080e",
              fontSize: "11px",
              color: "#d8b4fe",
              lineHeight: "1.7",
            }}
          >
            Two versions shown: sequential (readable) and bulk-optimized
            (production). The bulk version collects ALL possible checks upfront
            and fires one{" "}
            <code style={{ fontFamily: mono }}>BulkCheckPermission</code> RPC.
          </div>
          <Code maxHeight="700px">{RUNTIME_CODE}</Code>
        </div>
      )}

      {/* ═══ TYPE EXPLORER TAB ═══ */}
      {tab === "types" && (
        <div>
          <div
            style={{
              display: "flex",
              gap: "4px",
              marginBottom: "14px",
            }}
          >
            {SEED_TYPES.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedType(t.id)}
                style={{
                  padding: "6px 12px",
                  borderRadius: "4px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "10.5px",
                  fontWeight: 600,
                  fontFamily: sans,
                  backgroundColor:
                    selectedType === t.id ? "#1c1c24" : "#0d0d0f",
                  color: selectedType === t.id ? "#fafafa" : "#52525b",
                }}
              >
                {t.label}
                <span
                  style={{
                    marginLeft: "6px",
                    fontSize: "9px",
                    color: "#71717a",
                  }}
                >
                  {t.org}
                </span>
              </button>
            ))}
          </div>

          {currentType && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "12px",
              }}
            >
              {/* Actions */}
              <div
                style={{
                  borderRadius: "6px",
                  border: "1px solid #18181b",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "8px 14px",
                    backgroundColor: "#0e0e12",
                    borderBottom: "1px solid #18181b",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#e4e4e7",
                    }}
                  >
                    {currentType.label} Actions
                  </span>
                  <Badge
                    text={`${currentType.actions.length} slots used`}
                    color="#4ade80"
                    small
                  />
                  {currentType.system && (
                    <Badge text="SYSTEM" color="#3b82f6" small />
                  )}
                  {!currentType.system && (
                    <Badge text="USER-DEFINED" color="#f59e0b" small />
                  )}
                </div>

                {currentType.actions.map((a, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "6px 14px",
                      borderBottom:
                        i < currentType.actions.length - 1
                          ? "1px solid #111114"
                          : "none",
                      fontSize: "10.5px",
                      fontFamily: mono,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        marginBottom: "2px",
                      }}
                    >
                      <span
                        style={{
                          color: "#e4e4e7",
                          fontWeight: 700,
                          minWidth: "80px",
                        }}
                      >
                        {a.name}
                      </span>
                      <Badge text={`slot_${a.slot}`} color="#f59e0b" small />
                      <Badge
                        text={a.cascade ? "cascade" : "local"}
                        color={a.cascade ? "#4ade80" : "#f87171"}
                        small
                      />
                    </div>
                    {a.implies.length > 0 && (
                      <div
                        style={{
                          color: "#818cf8",
                          fontSize: "9.5px",
                          paddingLeft: "4px",
                        }}
                      >
                        implies: [{a.implies.join(", ")}]
                      </div>
                    )}
                    {a.requires.length > 0 && (
                      <div
                        style={{
                          color: "#fb923c",
                          fontSize: "9.5px",
                          paddingLeft: "4px",
                          fontWeight: 700,
                        }}
                      >
                        REQUIRES: [{a.requires.join(", ")}]
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* DAG Visualization + Scope */}
              <div>
                {/* Permission DAG */}
                <div
                  style={{
                    borderRadius: "6px",
                    border: "1px solid #18181b",
                    overflow: "hidden",
                    marginBottom: "12px",
                  }}
                >
                  <div
                    style={{
                      padding: "8px 14px",
                      backgroundColor: "#0e0e12",
                      borderBottom: "1px solid #18181b",
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#e4e4e7",
                    }}
                  >
                    Permission DAG (implies graph)
                  </div>
                  <div
                    style={{
                      padding: "12px 14px",
                      fontFamily: mono,
                      fontSize: "11px",
                      lineHeight: "1.8",
                      color: "#71717a",
                      whiteSpace: "pre",
                    }}
                  >
                    {(() => {
                      const actions = currentType.actions
                      const lines = []

                      // Find top-level (implied by nothing)
                      const allImplied = new Set(
                        actions.flatMap((a) => a.implies)
                      )
                      const allRequired = new Set(
                        actions.flatMap((a) => a.requires)
                      )
                      const roots = actions.filter(
                        (a) => !allImplied.has(a.name)
                      )
                      const leaves = actions.filter(
                        (a) => a.implies.length === 0 && a.requires.length === 0
                      )

                      lines.push(`// ${currentType.label} permission graph`)
                      lines.push("")
                      for (const a of actions) {
                        const parts = []
                        if (a.implies.length > 0) {
                          parts.push(`implies → [${a.implies.join(", ")}]`)
                        }
                        if (a.requires.length > 0) {
                          parts.push(`REQUIRES → [${a.requires.join(" AND ")}]`)
                        }
                        const suffix =
                          parts.length > 0 ? `  // ${parts.join("  ")}` : ""
                        const marker = a.cascade ? "↓" : "•"
                        const cascadeTag = a.cascade ? "cascade" : "local "
                        lines.push(
                          `${marker} slot_${a.slot} ${a.name.padEnd(12)} [${cascadeTag}]${suffix}`
                        )
                      }
                      lines.push("")
                      lines.push(`↓ = cascades from parent resource`)
                      lines.push(`• = direct grant only`)

                      return lines.join("\n")
                    })()}
                  </div>
                </div>

                {/* Scope bindings */}
                <div
                  style={{
                    borderRadius: "6px",
                    border: "1px solid #18181b",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      padding: "8px 14px",
                      backgroundColor: "#0e0e12",
                      borderBottom: "1px solid #18181b",
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#e4e4e7",
                    }}
                  >
                    Scope Bindings
                  </div>
                  <div style={{ padding: "10px 14px" }}>
                    {currentType.scopes.length === 0 ? (
                      <div
                        style={{
                          fontSize: "11px",
                          color: "#52525b",
                          fontFamily: mono,
                        }}
                      >
                        No scope bindings — permissions checked without scope
                        constraints
                      </div>
                    ) : (
                      currentType.scopes.map((s, i) => (
                        <div
                          key={i}
                          style={{
                            marginBottom:
                              i < currentType.scopes.length - 1 ? "10px" : 0,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                              marginBottom: "4px",
                            }}
                          >
                            <Badge text={s.type} color="#f59e0b" />
                            {s.required && (
                              <Badge text="REQUIRED" color="#f87171" small />
                            )}
                          </div>
                          <div
                            style={{
                              fontFamily: mono,
                              fontSize: "10px",
                              color: "#71717a",
                              lineHeight: "1.8",
                              paddingLeft: "8px",
                            }}
                          >
                            {Object.entries(s.mapping).map(([ra, sa]) => (
                              <div key={ra}>
                                <span style={{ color: "#a1a1aa" }}>{ra}</span>
                                <span style={{ color: "#52525b" }}>
                                  {" "}
                                  → scope.
                                </span>
                                <span style={{ color: "#f59e0b" }}>{sa}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
