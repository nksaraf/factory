import { useState, useMemo } from "react";

const mono = "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace";
const sans = "'DM Sans', system-ui, sans-serif";

// ═══════════════════════════════════════════════════════════════════════════════
// EVALUATION CHAIN
// ═══════════════════════════════════════════════════════════════════════════════

const EVAL_STEPS = [
  {
    step: 1,
    name: "Org Membership",
    type: "mandatory",
    engine: "SpiceDB",
    desc: "Is the principal a member or guest of the resource's organization?",
    check: "organization:samsung#access@principal:sonu",
    failBehavior: "Resource is completely invisible. Not even listed in search results.",
    notes: "Already embedded in slot permissions via (... & org->access). No extra call needed — SpiceDB evaluates this as part of every has_slot_N check.",
  },
  {
    step: 2,
    name: "Marking Clearance",
    type: "mandatory",
    engine: "PostgreSQL + Runtime",
    desc: "Does the principal hold ALL markings applied to this resource?",
    check: `SELECT NOT EXISTS (
  SELECT 1 FROM iam.resource_marking rm
  WHERE rm.resource_id = $resource_id
  AND NOT EXISTS (
    SELECT 1 FROM iam.principal_marking pm
    WHERE pm.principal_id = $principal_id
    AND pm.marking_id = rm.marking_id
    AND (pm.expires_at IS NULL OR pm.expires_at > now())
  )
) AS cleared;`,
    failBehavior: "Resource invisible. Even if principal is Owner/Admin on the parent project, markings block access. Mandatory > discretionary.",
    notes: "Pure PostgreSQL. No SpiceDB involvement. Binary AND-logic: must hold EVERY marking. One missing = denied. Typical check: <1ms with indexed lookups.",
  },
  {
    step: 3,
    name: "Scope Check",
    type: "discretionary",
    engine: "SpiceDB",
    desc: "Does the principal have the required scope permission for this action?",
    check: "scope_node:region_seoul#has_slot_2@principal:vinay",
    failBehavior: "Action denied, but resource remains visible if view scope passes.",
    notes: "Only checked if resource_type_scope_binding exists for this (resource_type, scope_type, action) combination. Scope slot numbering is independent from resource slot numbering.",
  },
  {
    step: 4,
    name: "Resource Permission",
    type: "discretionary",
    engine: "SpiceDB + Runtime",
    desc: "Does the principal have the required permission slot (with implies/requires resolution)?",
    check: "resource:tp_001#has_slot_2_local@principal:sonu",
    failBehavior: "Action denied.",
    notes: "Uses _cascade or _local variant based on registry. Implies graph walked for fallback. Requires checked as AND-intersection. BulkCheckPermission for batching.",
  },
  {
    step: 5,
    name: "Property Filtering",
    type: "mandatory",
    engine: "Runtime + Ontology Registry",
    desc: "Which properties of this object can the principal see?",
    check: `// For each property group on this ontology object type:
// Registry: incident.casualty_details → clearance_slot_2
// Check: ontology_object:inc_001#clearance_2_holder@principal:arjun
// If fails: casualty_details = null in response`,
    failBehavior: "Property value masked to null. Object still visible, but sensitive fields hidden.",
    notes: "Only applies to ontology objects (domain data), NOT platform resources (folders, projects). Uses clearance slots on ontology_object definition (separate from resource slots).",
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// POSTGRESQL SCHEMA FOR MARKINGS
// ═══════════════════════════════════════════════════════════════════════════════

const MARKING_SCHEMA = `-- ════════════════════════════════════════════════════════════
-- MARKING SYSTEM (Mandatory Access Control)
-- PostgreSQL — NOT in SpiceDB
-- ════════════════════════════════════════════════════════════

-- What categories of markings exist
CREATE TABLE iam.marking_type (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    org_id          TEXT NOT NULL,
    name            TEXT NOT NULL,           -- 'sensitivity', 'jurisdiction', 'regulatory', 'compartment'
    label           TEXT NOT NULL,           -- 'Data Sensitivity', 'Jurisdiction', 'Regulatory Tag'
    description     TEXT,
    
    -- Is this marking type hierarchical?
    -- hierarchical: levels have ordering (PUBLIC < INTERNAL < CONFIDENTIAL < RESTRICTED)
    -- binary: you either hold the marking or you don't (PII, VIP_OPS, FORENSIC)
    mode            TEXT NOT NULL DEFAULT 'binary',   -- 'hierarchical' | 'binary'
    
    -- Who can manage markings of this type
    admin_only      BOOLEAN DEFAULT true,    -- only org admins can grant/revoke
    
    system          BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    UNIQUE(org_id, name)
);

-- Individual markings within a type
CREATE TABLE iam.marking (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    marking_type_id TEXT NOT NULL REFERENCES iam.marking_type(id) ON DELETE CASCADE,
    org_id          TEXT NOT NULL,
    name            TEXT NOT NULL,           -- 'restricted', 'pii', 'vip_ops', 'eu_gdpr'
    label           TEXT NOT NULL,           -- 'Restricted', 'PII', 'VIP Operations'
    description     TEXT,
    
    -- For hierarchical marking types: position in order (higher = more restrictive)
    -- NULL for binary marking types
    level           SMALLINT,               -- e.g., PUBLIC=1, INTERNAL=2, CONFIDENTIAL=3, RESTRICTED=4
    
    -- Visual
    color           TEXT,                    -- hex color for UI badge
    icon            TEXT,                    -- icon identifier
    
    system          BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    UNIQUE(org_id, name)
);

CREATE INDEX idx_marking_type ON iam.marking(marking_type_id);

-- ════════════════════════════════════════════════════════════
-- MARKING ASSIGNMENTS (on resources and ontology objects)
-- ════════════════════════════════════════════════════════════

-- Which markings are applied to which resources
CREATE TABLE iam.resource_marking (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    resource_id     TEXT NOT NULL,           -- resource or ontology_object ID
    resource_kind   TEXT NOT NULL,           -- 'resource' | 'ontology_object'
    marking_id      TEXT NOT NULL REFERENCES iam.marking(id) ON DELETE CASCADE,
    
    -- Provenance: how was this marking applied?
    source          TEXT NOT NULL DEFAULT 'direct',  -- 'direct' | 'inherited_parent' | 'inherited_lineage'
    source_id       TEXT,                    -- parent resource_id or source dataset_id
    
    -- Can this marking be removed by the resource owner?
    -- false = only marking admin can remove (enforced for lineage-inherited markings)
    owner_removable BOOLEAN DEFAULT false,
    
    applied_by      TEXT,                    -- principal who applied it
    applied_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    UNIQUE(resource_id, marking_id)
);

CREATE INDEX idx_resource_marking_resource ON iam.resource_marking(resource_id);
CREATE INDEX idx_resource_marking_marking ON iam.resource_marking(marking_id);

-- ════════════════════════════════════════════════════════════
-- PRINCIPAL CLEARANCES (who holds which markings)
-- ════════════════════════════════════════════════════════════

-- Which principals hold clearance for which markings
CREATE TABLE iam.principal_marking (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    principal_id    TEXT NOT NULL,
    marking_id      TEXT NOT NULL REFERENCES iam.marking(id) ON DELETE CASCADE,
    org_id          TEXT NOT NULL,
    
    -- Time-bounded clearance (optional)
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,             -- NULL = permanent
    
    -- Provenance
    granted_by      TEXT,                    -- principal who granted
    source          TEXT NOT NULL DEFAULT 'direct',  -- 'direct' | 'role_derived' | 'directory_sync'
    
    UNIQUE(principal_id, marking_id)
);

CREATE INDEX idx_principal_marking_principal ON iam.principal_marking(principal_id);
CREATE INDEX idx_principal_marking_marking ON iam.principal_marking(marking_id);

-- ════════════════════════════════════════════════════════════
-- MARKING PROPAGATION RULES
-- ════════════════════════════════════════════════════════════

-- Defines how markings propagate through containment and lineage
CREATE TABLE iam.marking_propagation_rule (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    marking_type_id TEXT NOT NULL REFERENCES iam.marking_type(id) ON DELETE CASCADE,
    
    -- Propagation modes
    propagate_to_children   BOOLEAN DEFAULT true,   -- folder marking → contents
    propagate_through_lineage BOOLEAN DEFAULT true,  -- input dataset marking → output dataset
    
    -- Can propagation be stopped?
    allow_stop_propagation  BOOLEAN DEFAULT false,  -- requires marking admin + audit log
    
    UNIQUE(marking_type_id)
);

-- ════════════════════════════════════════════════════════════
-- PROPERTY-LEVEL CLEARANCE MAPPING (for Ontology objects)
-- ════════════════════════════════════════════════════════════

-- Maps object type properties to marking requirements
-- This is the bridge between markings and property-level security
CREATE TABLE iam.ontology_property_marking (
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    ontology_type_id    TEXT NOT NULL,        -- from Ontology Registry
    property_name       TEXT NOT NULL,        -- 'casualty_details', 'officer_names', 'pricing_data'
    marking_id          TEXT NOT NULL REFERENCES iam.marking(id) ON DELETE CASCADE,
    
    -- SpiceDB clearance slot for fast path
    clearance_slot      SMALLINT,            -- 1-4, maps to ontology_object.clearance_N_holder
    
    UNIQUE(ontology_type_id, property_name, marking_id)
);`;

// ═══════════════════════════════════════════════════════════════════════════════
// THE THREE LAYERS
// ═══════════════════════════════════════════════════════════════════════════════

const LAYERS = [
  {
    id: "mandatory",
    name: "Mandatory Layer",
    color: "#ef4444",
    engine: "PostgreSQL + Runtime",
    desc: "Non-bypassable. Centrally administered. No discretionary override possible.",
    components: [
      { name: "Org Membership", detail: "SpiceDB (embedded in slot permissions via org->access). Binary: member/guest or not." },
      { name: "Marking Clearance", detail: "PostgreSQL. Resource carries markings. Principal carries clearances. Must hold ALL. AND-logic." },
      { name: "Marking Propagation", detail: "Write-time. Container→children. Lineage: input→output. Can't launder markings through ETL." },
    ],
  },
  {
    id: "discretionary",
    name: "Discretionary Layer",
    color: "#3b82f6",
    engine: "SpiceDB + Registry + Runtime",
    desc: "Delegated to resource owners. Configurable per resource type. Slot-based.",
    components: [
      { name: "Scope Check", detail: "SpiceDB scope_node slots. Which region/department/topology can you operate in?" },
      { name: "Resource Permission", detail: "SpiceDB resource slots. 8 slots × cascade/local. Implies/requires DAG." },
      { name: "Resource Type Registry", detail: "PostgreSQL. Maps action names → slot numbers. Defines cascade and implication rules." },
    ],
  },
  {
    id: "property",
    name: "Property Layer",
    color: "#f59e0b",
    engine: "SpiceDB clearance slots + Ontology Registry",
    desc: "Column-level security for ontology objects. Which fields can you see?",
    components: [
      { name: "Clearance Slots", detail: "4 slots on ontology_object definition. Mapped to marking requirements by Ontology Registry." },
      { name: "Null Masking", detail: "Application layer. If principal lacks clearance for property group, value = null in response." },
      { name: "Not on resources", detail: "Folders, projects, documents don't have property-level security. Only ontology objects (domain data)." },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// ONTOLOGY OBJECT SPICEDB DEFINITION (with clearance slots)
// ═══════════════════════════════════════════════════════════════════════════════

const ONTOLOGY_SCHEMA = `// ─── Ontology Object (domain data — separate from resource) ───
// This is the definition from our earlier design, unchanged.
// It handles domain entities: road segments, challans, service
// tickets, incidents, parking zones, etc.
//
// Key difference from resource:
//   resource = platform containers (folders, projects, documents)
//   ontology_object = domain data (things that exist in the real world)
//
// Ontology objects have PROPERTY-LEVEL security via clearance slots.
// Resources do not.

definition ontology_object {
  // ── Resource binding ──
  // Every ontology object lives inside a dataset,
  // which lives inside a project (resource hierarchy).
  relation dataset: dataset
  
  // ── Domain scoping ──
  relation scope: scope_node      // region, topology, etc.
  relation org: organization

  // ── Discretionary roles ──
  relation owner: principal
  relation editor: principal
  relation viewer: principal

  // ── Clearance holders (property-level security) ──
  // 4 generic clearance slots. The Ontology Registry maps:
  //   Org A: slot_1 = VIP_OPS, slot_2 = FORENSIC, slot_3 = INTEL
  //   Org B: slot_1 = SUBSCRIBER_PII, slot_2 = FINANCIAL
  // These are NOT the same as resource slots or scope slots.
  relation clearance_1_holder: principal | role#member
  relation clearance_2_holder: principal | role#member
  relation clearance_3_holder: principal | role#member
  relation clearance_4_holder: principal | role#member

  // ── Base permissions ──
  // Note: markings are checked BEFORE these in the runtime.
  // If marking check fails, these are never evaluated.
  permission view = (viewer + editor + owner)
                    & org->access
  permission edit = (editor + owner)
                    & org->access
  permission admin = owner & org->access

  // ── Property-level permissions ──
  // "Can see properties in clearance group N?"
  // Composes with base view: must be able to view the object
  // AND hold the clearance for the property group.
  permission view_clearance_1 = view & clearance_1_holder
  permission view_clearance_2 = view & clearance_2_holder
  permission view_clearance_3 = view & clearance_3_holder
  permission view_clearance_4 = view & clearance_4_holder
}

// ── Dataset (bridge between resource hierarchy and ontology) ──

definition dataset {
  relation project: resource      // lives inside a project resource
  relation org: organization

  // Inherits permissions from parent project resource
  // The slot checked depends on the action:
  //   dataset.view → project.has_slot_2_cascade (project.view = slot 2)
  //   dataset.edit → project.has_slot_3_cascade (project.edit = slot 3)
  // This mapping is in the Registry.
}`;

// ═══════════════════════════════════════════════════════════════════════════════
// CONCRETE EXAMPLES
// ═══════════════════════════════════════════════════════════════════════════════

const EXAMPLES = [
  {
    id: "marking_gate",
    title: "Marking Gates Access (Samsung)",
    scenario: "Samsung has a traffic_plan marked CONFIDENTIAL. Sonu has edit permission but lacks CONFIDENTIAL clearance.",
    markings: [
      "iam.marking_type: sensitivity (hierarchical, org: samsung)",
      "iam.marking: public (level=1), internal (level=2), confidential (level=3), restricted (level=4)",
      "",
      "iam.resource_marking: tp_001 → confidential (source: direct)",
      "",
      "iam.principal_marking: sonu → internal (level=2)",
      "iam.principal_marking: vinay → confidential (level=3)",
    ],
    steps: [
      { check: "Org membership", detail: "organization:samsung#access@principal:sonu → ✓", pass: true },
      { check: "Marking clearance", detail: "tp_001 has marking: confidential (level=3). Sonu has clearance: internal (level=2). 2 < 3 → ✗ DENIED", pass: false },
      { check: "—", detail: "Steps 3-5 never reached. Resource is invisible to sonu.", pass: null },
    ],
    result: "✗ DENIED at marking layer. Sonu can't even see tp_001 exists, despite having slot_2 (edit) and slot_3 (simulate) grants.",
  },
  {
    id: "marking_pass",
    title: "Marking Passes, Slot Check Follows (Samsung)",
    scenario: "Vinay has CONFIDENTIAL clearance and edit+approve grants on tp_001.",
    markings: [
      "iam.principal_marking: vinay → confidential (level=3)",
      "tp_001 has marking: confidential (level=3). Vinay clearance: level=3. 3 ≥ 3 → ✓",
    ],
    steps: [
      { check: "Org membership", detail: "organization:samsung#access@principal:vinay → ✓", pass: true },
      { check: "Marking clearance", detail: "confidential(3) ≥ confidential(3) → ✓", pass: true },
      { check: "Scope (region)", detail: "scope_node:region_korea#has_slot_2@principal:vinay → ✓ (manage on korea)", pass: true },
      { check: "Resource slot", detail: "resource:tp_001#has_slot_4_local@principal:vinay → ✓ (approve)", pass: true },
      { check: "Property filter", detail: "N/A — traffic_plan is a resource, not ontology_object", pass: true },
    ],
    result: "✓ ALLOWED. Vinay passes mandatory (marking) + discretionary (scope + slot) checks.",
  },
  {
    id: "propagation_container",
    title: "Container Propagation (Lepton)",
    scenario: "folder1 is marked INTERNAL. project1 is inside folder1. Does project1 inherit the INTERNAL marking?",
    markings: [
      "iam.resource_marking: folder1 → internal (source: direct)",
      "",
      "// On project1 creation inside folder1, propagation trigger fires:",
      "INSERT INTO iam.resource_marking (resource_id, marking_id, source, source_id)",
      "VALUES ('project1', 'internal_id', 'inherited_parent', 'folder1');",
      "",
      "// project1 now carries INTERNAL marking (inherited, not directly applied)",
      "// Owner of project1 cannot remove it (owner_removable = false)",
      "// Only marking admin can remove inherited markings",
    ],
    steps: [
      { check: "folder1 marking", detail: "INTERNAL (direct)", pass: null },
      { check: "project1 marking", detail: "INTERNAL (inherited from folder1)", pass: null },
      { check: "Principal without INTERNAL", detail: "Cannot see project1, even if they have edit slot on it", pass: false },
      { check: "Remove parent marking?", detail: "If folder1's INTERNAL is removed, project1's inherited marking is also removed (cascade)", pass: null },
    ],
    result: "Markings propagate down the containment hierarchy. Inherited markings cannot be removed by resource owners.",
  },
  {
    id: "propagation_lineage",
    title: "Lineage Propagation (Data Pipeline)",
    scenario: "Dataset A is marked PII + SUBSCRIBER_DATA. Pipeline transforms A → B. Does B inherit markings?",
    markings: [
      "iam.resource_marking: dataset_A → pii (source: direct)",
      "iam.resource_marking: dataset_A → subscriber_data (source: direct)",
      "",
      "// Pipeline creates dataset_B from dataset_A",
      "// Data Plane's pipeline executor triggers marking propagation:",
      "INSERT INTO iam.resource_marking (resource_id, marking_id, source, source_id)",
      "VALUES ('dataset_B', 'pii_id', 'inherited_lineage', 'dataset_A');",
      "INSERT INTO iam.resource_marking (resource_id, marking_id, source, source_id)",
      "VALUES ('dataset_B', 'subscriber_data_id', 'inherited_lineage', 'dataset_A');",
      "",
      "// Even if the pipeline strips PII columns, the marking persists",
      "// Only a marking admin can explicitly stop propagation (with audit log)",
    ],
    steps: [
      { check: "Dataset A markings", detail: "PII + SUBSCRIBER_DATA (direct)", pass: null },
      { check: "Pipeline A → B", detail: "Output inherits ALL input markings", pass: null },
      { check: "Dataset B markings", detail: "PII + SUBSCRIBER_DATA (inherited_lineage from A)", pass: null },
      { check: "Stop propagation?", detail: "Marking admin can run stop_propagation(dataset_B, pii) with audit log + approval", pass: null },
    ],
    result: "You can't launder markings through ETL. Classification travels with the data, not the container.",
  },
  {
    id: "property_level",
    title: "Property-Level Security (Ontology Object)",
    scenario: "Incident object has description (unclassified), casualty_details (FORENSIC clearance), responding_officers (OFFICER_PII clearance).",
    markings: [
      "// Ontology Registry mapping:",
      "// incident.casualty_details → clearance_slot_2 → marking: FORENSIC",
      "// incident.responding_officers → clearance_slot_3 → marking: OFFICER_PII",
      "",
      "// SpiceDB tuples:",
      "ontology_object:inc_001#clearance_2_holder@principal:forensic_analyst",
      "ontology_object:inc_001#clearance_3_holder@principal:hr_admin",
      "",
      "// Principal 'arjun' has NEITHER clearance",
      "// Principal 'forensic_analyst' has FORENSIC (clearance_slot_2)",
      "// Principal 'hr_admin' has OFFICER_PII (clearance_slot_3)",
    ],
    steps: [
      { check: "arjun views inc_001", detail: "Object visible (passes base view). casualty_details = null. responding_officers = null.", pass: null },
      { check: "forensic_analyst views", detail: "casualty_details = visible ✓. responding_officers = null ✗.", pass: null },
      { check: "hr_admin views", detail: "casualty_details = null ✗. responding_officers = visible ✓.", pass: null },
      { check: "Both clearances", detail: "A principal with BOTH sees all properties.", pass: true },
    ],
    result: "Same object, different views per principal. SpiceDB resolves via view_clearance_N. Application null-masks denied properties.",
  },
  {
    id: "multi_marking",
    title: "Multiple Markings (AND Logic)",
    scenario: "A resource has THREE markings: CONFIDENTIAL + PII + EU_GDPR. Principal must hold ALL three.",
    markings: [
      "iam.resource_marking: report_42 → confidential",
      "iam.resource_marking: report_42 → pii",
      "iam.resource_marking: report_42 → eu_gdpr",
      "",
      "// Principal A: holds confidential + pii (missing eu_gdpr)",
      "// Principal B: holds confidential + pii + eu_gdpr",
    ],
    steps: [
      { check: "Principal A", detail: "Has 2/3 markings. Missing eu_gdpr. → ✗ DENIED (must hold ALL)", pass: false },
      { check: "Principal B", detail: "Has 3/3 markings. → ✓ PASSED", pass: true },
      { check: "SQL check", detail: "NOT EXISTS (marking on resource WHERE principal doesn't hold it)", pass: null },
    ],
    result: "AND-logic. One missing marking = invisible. No partial access. No OR-exceptions (except CBAC for government use cases).",
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// WHY NOT SPICEDB FOR MARKINGS
// ═══════════════════════════════════════════════════════════════════════════════

const WHY_NOT_SPICEDB = [
  {
    problem: "Universal quantifier",
    detail: 'SpiceDB checks "does principal have relation R to object O?" (existential). Markings require "for EVERY marking M on resource R, does principal hold M?" (universal). SpiceDB has no native universal quantifier. You\'d need N separate checks where N = number of markings on the resource.',
  },
  {
    problem: "Set membership, not graph traversal",
    detail: "Marking checks are simple set membership (does principal hold marking X?). No hierarchy walking, no cascading, no relationship traversal. PostgreSQL handles this in microseconds with indexed lookups. SpiceDB's graph engine is overkill.",
  },
  {
    problem: "Hierarchical markings need comparison",
    detail: "For hierarchical marking types (PUBLIC < INTERNAL < CONFIDENTIAL), the check is numeric: principal.level ≥ resource.level. SpiceDB has no numeric comparison. PostgreSQL does this trivially.",
  },
  {
    problem: "Dynamic marking count per resource",
    detail: "A resource can have 0 to N markings. If modeled as SpiceDB relations, you'd need dynamic-length relation lists. The slot pattern (clearance_1 through clearance_4) works for property-level gating (bounded, known count per type). But object-level markings are unbounded.",
  },
  {
    problem: "Write-time propagation",
    detail: "Marking propagation (container → children, lineage: input → output) is a WRITE-TIME concern. When a resource is created inside a marked folder, the inherited marking is written immediately. This is a PostgreSQL trigger or application-level hook, not a SpiceDB graph traversal at read time.",
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// THE FULL PICTURE
// ═══════════════════════════════════════════════════════════════════════════════

const FULL_ARCHITECTURE = `// ═══════════════════════════════════════════════════════════════
// THE COMPLETE EVALUATION CHAIN
// ═══════════════════════════════════════════════════════════════
//
// Request: "Can principal P do action A on resource R?"
//
// ┌─────────────────────────────────────────────────────┐
// │ 1. ORG MEMBERSHIP (mandatory)                       │
// │    Engine: SpiceDB (embedded in slot permissions)    │
// │    Check:  org->access                              │
// │    Fail:   invisible                                │
// ├─────────────────────────────────────────────────────┤
// │ 2. MARKING CLEARANCE (mandatory)                    │
// │    Engine: PostgreSQL + Runtime                      │
// │    Check:  principal holds ALL markings on resource  │
// │    Fail:   invisible                                │
// ├─────────────────────────────────────────────────────┤
// │ 3. SCOPE CHECK (discretionary)                      │
// │    Engine: SpiceDB (scope_node slots)                │
// │    Check:  scope_node#has_slot_N (from binding)      │
// │    Fail:   action denied, resource may still be      │
// │            visible if view scope passes              │
// ├─────────────────────────────────────────────────────┤
// │ 4. RESOURCE PERMISSION (discretionary)              │
// │    Engine: SpiceDB (resource slots) + Runtime        │
// │    Check:  resource#has_slot_N_cascade/local          │
// │            + implies graph + requires intersection   │
// │    Fail:   action denied                            │
// ├─────────────────────────────────────────────────────┤
// │ 5. PROPERTY FILTERING (mandatory, ontology only)    │
// │    Engine: SpiceDB clearance slots + Ontology Reg    │
// │    Check:  ontology_object#view_clearance_N           │
// │    Fail:   property value = null in response         │
// └─────────────────────────────────────────────────────┘
//
// KEY RULES:
// • Mandatory steps (1, 2, 5) cannot be overridden by any discretionary grant
// • Step 2 (markings) is PostgreSQL, NOT SpiceDB
// • Step 5 (property filtering) only applies to ontology_objects, not resources
// • Steps 3+4 use the slot-based SpiceDB schema from our revised design
// • All 5 steps can be batched: 1 PG query (markings) + 1 BulkCheck (slots+scope)

// ═══════════════════════════════════════════════════════════════
// RUNTIME IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

async function authorize(
  principalId: string,
  resourceId: string,
  action: string,
): Promise<AuthzResult> {
  
  const resource = await db.getResource(resourceId);
  const typeConfig = registry.getType(resource.resource_type);

  // ── STEP 2: Marking clearance (mandatory gate) ──
  // Step 1 (org) is embedded in SpiceDB slot permissions
  const markingResult = await checkMarkings(principalId, resourceId);
  if (!markingResult.cleared) {
    return { allowed: false, reason: 'marking_denied', invisible: true };
  }

  // ── STEP 3: Scope check ──
  const scopeResult = await checkScopes(principalId, resourceId, action, typeConfig);
  if (!scopeResult.allowed) {
    return { allowed: false, reason: 'scope_denied', invisible: false };
  }

  // ── STEP 4: Resource permission ──
  const slotResult = await checkSlots(principalId, resourceId, action, typeConfig);
  if (!slotResult.allowed) {
    return { allowed: false, reason: 'permission_denied', invisible: false };
  }

  return { allowed: true, reason: 'all_checks_passed', invisible: false };
}

// Marking check — pure PostgreSQL
async function checkMarkings(
  principalId: string,
  resourceId: string,
): Promise<{ cleared: boolean }> {
  
  const result = await db.query(\`
    SELECT NOT EXISTS (
      SELECT 1 FROM iam.resource_marking rm
      JOIN iam.marking m ON m.id = rm.marking_id
      LEFT JOIN iam.principal_marking pm 
        ON pm.principal_id = $1 
        AND pm.marking_id = rm.marking_id
        AND (pm.expires_at IS NULL OR pm.expires_at > now())
      LEFT JOIN iam.marking pm_level_marking
        ON pm_level_marking.id = pm.marking_id
      WHERE rm.resource_id = $2
      AND (
        -- Binary marking: principal must hold it exactly
        (m.level IS NULL AND pm.id IS NULL)
        OR
        -- Hierarchical marking: principal's level must be >= resource's level
        (m.level IS NOT NULL AND (
          pm.id IS NULL 
          OR (SELECT MAX(m2.level) FROM iam.principal_marking pm2
              JOIN iam.marking m2 ON m2.id = pm2.marking_id
              WHERE pm2.principal_id = $1
              AND m2.marking_type_id = m.marking_type_id
              AND (pm2.expires_at IS NULL OR pm2.expires_at > now())
             ) < m.level
        ))
      )
    ) AS cleared
  \`, [principalId, resourceId]);
  
  return { cleared: result.rows[0].cleared };
}

// For listing: scope predicate compiler generates SQL WHERE
// that pre-filters resources the principal can see
function markingPredicate(principalId: string): string {
  return \`
    NOT EXISTS (
      SELECT 1 FROM iam.resource_marking rm
      JOIN iam.marking m ON m.id = rm.marking_id
      WHERE rm.resource_id = r.id
      AND NOT EXISTS (
        SELECT 1 FROM iam.principal_marking pm
        WHERE pm.principal_id = '\${principalId}'
        AND pm.marking_id = rm.marking_id
        AND (pm.expires_at IS NULL OR pm.expires_at > now())
      )
    )
  \`;
}`;

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

const TABS = [
  { id: "chain", label: "Eval Chain" },
  { id: "layers", label: "Three Layers" },
  { id: "markings", label: "Marking Schema" },
  { id: "ontology", label: "Property Security" },
  { id: "examples", label: "Examples" },
  { id: "why", label: "Why Not SpiceDB" },
  { id: "code", label: "Runtime Code" },
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
    backgroundColor: "#08080c", fontSize: "11px", fontFamily: mono,
    lineHeight: "1.7", color: "#a1a1aa", overflow: "auto", maxHeight,
    whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0,
  }}>{children}</pre>
);

export default function MarkingsIntegration() {
  const [tab, setTab] = useState("chain");
  const [example, setExample] = useState("marking_gate");

  const currentExample = EXAMPLES.find(e => e.id === example);

  return (
    <div style={{
      minHeight: "100vh", backgroundColor: "#0a0a0c", color: "#e4e4e7",
      fontFamily: sans, padding: "20px",
    }}>
      {/* Header */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{
          fontSize: "9px", fontWeight: 800, fontFamily: mono,
          color: "#ef4444", letterSpacing: "0.12em", marginBottom: "4px",
        }}>PLATFORM FABRIC — MANDATORY ACCESS CONTROL</div>
        <div style={{ fontSize: "18px", fontWeight: 700, color: "#fafafa" }}>
          Classifications, Markings & Property-Level Security
        </div>
        <div style={{ fontSize: "11px", color: "#52525b", marginTop: "3px" }}>
          Mandatory before discretionary · Markings in PostgreSQL · Clearance slots in SpiceDB · 5-step evaluation
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", gap: "1px", marginBottom: "16px",
        borderRadius: "5px", overflow: "hidden", border: "1px solid #18181b",
        backgroundColor: "#0d0d0f", padding: "2px",
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

      {/* ═══ EVAL CHAIN TAB ═══ */}
      {tab === "chain" && (
        <div>
          {EVAL_STEPS.map((step, i) => (
            <div key={i} style={{
              marginBottom: "8px", borderRadius: "6px",
              border: `1px solid ${step.type === "mandatory" ? "#ef444425" : step.type === "discretionary" ? "#3b82f625" : "#f59e0b25"}`,
              overflow: "hidden",
            }}>
              <div style={{
                padding: "8px 14px", display: "flex", alignItems: "center", gap: "8px",
                backgroundColor: step.type === "mandatory" ? "#0e0808" : step.type === "discretionary" ? "#080a0e" : "#0e0c08",
                borderBottom: "1px solid #18181b",
              }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: "20px", height: "20px", borderRadius: "50%", fontSize: "10px",
                  fontWeight: 700, fontFamily: mono,
                  backgroundColor: step.type === "mandatory" ? "#ef444415" : "#3b82f615",
                  color: step.type === "mandatory" ? "#ef4444" : "#3b82f6",
                }}>{step.step}</span>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#e4e4e7" }}>{step.name}</span>
                <Badge text={step.type.toUpperCase()} color={step.type === "mandatory" ? "#ef4444" : step.type === "discretionary" ? "#3b82f6" : "#f59e0b"} small />
                <Badge text={step.engine} color="#71717a" small />
              </div>
              <div style={{ padding: "10px 14px" }}>
                <div style={{ fontSize: "11px", color: "#a1a1aa", marginBottom: "6px", lineHeight: "1.6" }}>
                  {step.desc}
                </div>
                <Code>{step.check}</Code>
                <div style={{
                  marginTop: "6px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px",
                }}>
                  <div style={{
                    padding: "6px 10px", borderRadius: "4px", backgroundColor: "#0e0808",
                    border: "1px solid #ef444415",
                  }}>
                    <div style={{ fontSize: "9px", fontWeight: 700, fontFamily: mono, color: "#ef4444", marginBottom: "2px" }}>ON FAILURE</div>
                    <div style={{ fontSize: "10px", color: "#fca5a5", lineHeight: "1.5" }}>{step.failBehavior}</div>
                  </div>
                  <div style={{
                    padding: "6px 10px", borderRadius: "4px", backgroundColor: "#080a0e",
                    border: "1px solid #3b82f615",
                  }}>
                    <div style={{ fontSize: "9px", fontWeight: 700, fontFamily: mono, color: "#3b82f6", marginBottom: "2px" }}>NOTES</div>
                    <div style={{ fontSize: "10px", color: "#93c5fd", lineHeight: "1.5" }}>{step.notes}</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ THREE LAYERS TAB ═══ */}
      {tab === "layers" && (
        <div>
          {LAYERS.map((layer, i) => (
            <div key={i} style={{
              marginBottom: "12px", borderRadius: "6px",
              border: `1px solid ${layer.color}25`,
              overflow: "hidden",
            }}>
              <div style={{
                padding: "10px 14px",
                backgroundColor: `${layer.color}08`,
                borderBottom: `1px solid ${layer.color}15`,
                display: "flex", alignItems: "center", gap: "10px",
              }}>
                <span style={{ fontSize: "13px", fontWeight: 700, color: "#e4e4e7" }}>{layer.name}</span>
                <Badge text={layer.engine} color={layer.color} />
              </div>
              <div style={{ padding: "10px 14px" }}>
                <div style={{ fontSize: "11px", color: "#a1a1aa", marginBottom: "10px", lineHeight: "1.6" }}>
                  {layer.desc}
                </div>
                {layer.components.map((c, j) => (
                  <div key={j} style={{
                    padding: "6px 10px", marginBottom: j < layer.components.length - 1 ? "4px" : 0,
                    borderRadius: "4px", backgroundColor: "#0a0a0e",
                    border: "1px solid #18181b",
                  }}>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "#e4e4e7" }}>{c.name}: </span>
                    <span style={{ fontSize: "11px", color: "#71717a", lineHeight: "1.6" }}>{c.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div style={{
            padding: "12px 14px", borderRadius: "6px",
            border: "1px solid #4ade8025", backgroundColor: "#0a120a",
            fontSize: "11px", color: "#86efac", lineHeight: "1.7", fontFamily: mono,
          }}>
{`KEY RULE: Mandatory > Discretionary. Always.

Even if principal is Owner/Admin on a resource:
• Missing org membership → invisible
• Missing marking clearance → invisible  
• Missing property clearance → field = null

No role, no cascade, no implies chain can override a mandatory denial.`}
          </div>
        </div>
      )}

      {/* ═══ MARKING SCHEMA TAB ═══ */}
      {tab === "markings" && (
        <div>
          <div style={{
            padding: "8px 12px", borderRadius: "5px", marginBottom: "12px",
            border: "1px solid #ef444425", backgroundColor: "#0e0808",
            fontSize: "11px", color: "#fca5a5", lineHeight: "1.7",
          }}>
            Markings live in PostgreSQL, NOT SpiceDB. They're checked before any SpiceDB call.
            A marking is a binary access requirement — you either hold it or you don't.
            Multiple markings on a resource use AND-logic: must hold ALL of them.
          </div>
          <Code maxHeight="700px">{MARKING_SCHEMA}</Code>
        </div>
      )}

      {/* ═══ ONTOLOGY/PROPERTY TAB ═══ */}
      {tab === "ontology" && (
        <div>
          <div style={{
            padding: "8px 12px", borderRadius: "5px", marginBottom: "12px",
            border: "1px solid #f59e0b25", backgroundColor: "#0e0c08",
            fontSize: "11px", color: "#fde68a", lineHeight: "1.7",
          }}>
            <strong>Property-level security only applies to ontology objects</strong> (domain data), NOT platform resources 
            (folders, projects). Object-level markings (PostgreSQL) gate the whole object.
            Clearance slots (SpiceDB) gate individual properties. These are two different mechanisms.
          </div>

          <Code maxHeight="500px">{ONTOLOGY_SCHEMA}</Code>

          <div style={{ marginTop: "12px" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#e4e4e7", marginBottom: "8px" }}>
              Resource vs Ontology Object — Security Model Comparison
            </div>
            <div style={{
              borderRadius: "6px", border: "1px solid #18181b", overflow: "hidden",
              fontSize: "10.5px", fontFamily: mono,
            }}>
              <div style={{
                display: "grid", gridTemplateColumns: "160px 1fr 1fr",
                padding: "6px 12px", backgroundColor: "#0e0e12",
                borderBottom: "1px solid #18181b",
                fontSize: "9px", fontWeight: 800, color: "#52525b", letterSpacing: "0.05em",
              }}>
                <span>DIMENSION</span><span>RESOURCE (folder, project)</span><span>ONTOLOGY OBJECT (road segment, incident)</span>
              </div>
              {[
                ["Object-level marking", "✓ PostgreSQL (AND-logic)", "✓ PostgreSQL (AND-logic)"],
                ["Property-level gating", "✗ Not supported", "✓ SpiceDB clearance slots (4 slots)"],
                ["Permission slots", "8 slots (cascade/local)", "3 fixed: owner/editor/viewer"],
                ["Parent cascade", "✓ via resource#parent", "✗ (inherits from dataset→project)"],
                ["Scope binding", "✓ via resource_type_scope_binding", "✓ via scope relation"],
                ["Containment", "resource → resource (folder→project)", "ontology_object → dataset → resource"],
                ["User-defined actions", "✓ via registry (8 slots)", "✗ fixed: view/edit/admin"],
                ["Lineage propagation", "✗ (not a data pipeline output)", "✓ markings propagate through ETL"],
              ].map(([dim, res, onto], i) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "160px 1fr 1fr",
                  padding: "5px 12px",
                  borderBottom: i < 7 ? "1px solid #111114" : "none",
                  backgroundColor: i % 2 === 0 ? "transparent" : "#0a0a0e08",
                }}>
                  <span style={{ color: "#a1a1aa", fontWeight: 600 }}>{dim}</span>
                  <span style={{ color: res.startsWith("✓") ? "#86efac" : "#71717a" }}>{res}</span>
                  <span style={{ color: onto.startsWith("✓") ? "#86efac" : "#71717a" }}>{onto}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ EXAMPLES TAB ═══ */}
      {tab === "examples" && (
        <div>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
            gap: "4px", marginBottom: "14px",
          }}>
            {EXAMPLES.map(e => {
              const isActive = example === e.id;
              const resultPass = e.result.startsWith("✓");
              return (
                <button key={e.id} onClick={() => setExample(e.id)} style={{
                  padding: "5px 8px", borderRadius: "4px", border: "none", cursor: "pointer",
                  fontSize: "9px", fontWeight: 600, fontFamily: mono, textAlign: "left",
                  backgroundColor: isActive ? "#1c1c24" : "#0d0d0f",
                  color: isActive ? "#fafafa" : "#52525b",
                  borderLeft: `2px solid ${resultPass ? "#4ade80" : e.result.startsWith("✗") ? "#f87171" : "#f59e0b"}`,
                }}>
                  {e.title.length > 36 ? e.title.slice(0, 34) + "…" : e.title}
                </button>
              );
            })}
          </div>

          {currentExample && (
            <div style={{
              borderRadius: "6px", border: "1px solid #18181b", overflow: "hidden",
            }}>
              <div style={{
                padding: "10px 14px", backgroundColor: "#0e0e12",
                borderBottom: "1px solid #18181b",
              }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#e4e4e7", marginBottom: "4px" }}>
                  {currentExample.title}
                </div>
                <div style={{ fontSize: "11px", color: "#a1a1aa", lineHeight: "1.6" }}>
                  {currentExample.scenario}
                </div>
              </div>

              <div style={{ padding: "10px 14px", borderBottom: "1px solid #18181b" }}>
                <div style={{ fontSize: "9px", fontWeight: 700, fontFamily: mono, color: "#52525b", marginBottom: "4px", letterSpacing: "0.05em" }}>
                  SETUP
                </div>
                <Code maxHeight="180px">{currentExample.markings.join("\n")}</Code>
              </div>

              {currentExample.steps.map((step, i) => (
                <div key={i} style={{
                  padding: "5px 14px",
                  borderBottom: i < currentExample.steps.length - 1 ? "1px solid #111114" : "none",
                  display: "flex", gap: "10px", alignItems: "flex-start",
                }}>
                  <span style={{
                    fontSize: "10px", fontWeight: 700, fontFamily: mono,
                    color: step.pass === true ? "#4ade80" : step.pass === false ? "#f87171" : "#71717a",
                    minWidth: "160px", paddingTop: "1px",
                  }}>{step.check}</span>
                  <span style={{
                    fontSize: "10.5px", fontFamily: mono, lineHeight: "1.6",
                    color: step.pass === true ? "#a1a1aa" : step.pass === false ? "#fca5a5" : "#71717a",
                  }}>{step.detail}</span>
                </div>
              ))}

              <div style={{
                padding: "8px 14px",
                backgroundColor: currentExample.result.startsWith("✓") ? "#0a120a" : currentExample.result.startsWith("✗") ? "#120a0a" : "#0e0c08",
                borderTop: "1px solid #18181b",
                fontSize: "11px", fontFamily: mono, fontWeight: 700, lineHeight: "1.6",
                color: currentExample.result.startsWith("✓") ? "#86efac" : currentExample.result.startsWith("✗") ? "#fca5a5" : "#fde68a",
              }}>
                {currentExample.result}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ WHY NOT SPICEDB TAB ═══ */}
      {tab === "why" && (
        <div>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#e4e4e7", marginBottom: "12px" }}>
            Why Markings Live in PostgreSQL, Not SpiceDB
          </div>
          {WHY_NOT_SPICEDB.map((item, i) => (
            <div key={i} style={{
              marginBottom: "8px", padding: "10px 14px", borderRadius: "6px",
              border: "1px solid #18181b", backgroundColor: "#0d0d0f",
            }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#e4e4e7", marginBottom: "4px" }}>
                {item.problem}
              </div>
              <div style={{ fontSize: "11px", color: "#71717a", lineHeight: "1.7" }}>
                {item.detail}
              </div>
            </div>
          ))}

          <div style={{
            marginTop: "12px", padding: "12px 14px", borderRadius: "6px",
            border: "1px solid #4ade8025", backgroundColor: "#0a120a",
          }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#4ade80", fontFamily: mono, marginBottom: "4px" }}>
              THE EXCEPTION: PROPERTY-LEVEL CLEARANCE
            </div>
            <div style={{ fontSize: "11px", color: "#86efac", lineHeight: "1.7" }}>
              Property-level clearances on ontology objects DO use SpiceDB (clearance_1_holder through clearance_4_holder).
              This works because: (a) the slot count is bounded per object type (max 4),
              (b) the check composes with base view permission via AND (view_clearance_N = view & clearance_N_holder),
              and (c) SpiceDB's graph engine adds value here because clearance can be granted via roles (role#member).
              Object-level markings = PostgreSQL. Property-level clearances = SpiceDB. Different problems, different tools.
            </div>
          </div>
        </div>
      )}

      {/* ═══ RUNTIME CODE TAB ═══ */}
      {tab === "code" && (
        <div>
          <div style={{
            padding: "8px 12px", borderRadius: "5px", marginBottom: "12px",
            border: "1px solid #c084fc25", backgroundColor: "#0c080e",
            fontSize: "11px", color: "#d8b4fe", lineHeight: "1.7",
          }}>
            The full authorize() function showing the 5-step chain. Note how marking check (PostgreSQL) runs BEFORE
            any SpiceDB call. If markings fail, we never hit SpiceDB — saving the network round-trip.
          </div>
          <Code maxHeight="700px">{FULL_ARCHITECTURE}</Code>
        </div>
      )}
    </div>
  );
}
