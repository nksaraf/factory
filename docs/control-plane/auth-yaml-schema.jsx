import { useState, useMemo } from "react";

const mono = "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace";
const sans = "'DM Sans', system-ui, sans-serif";

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH SCHEMA SPEC
// ═══════════════════════════════════════════════════════════════════════════════

const SPEC = `# ════════════════════════════════════════════════════════════
# AUTH SCHEMA SPEC — auth.yaml
# ════════════════════════════════════════════════════════════
#
# This file declares the authorization model for a module.
# It lives at: <module>/auth.yaml
# It is compiled by: dx module auth compile
# It produces:
#   - PG migration (iam.resource_type, iam.resource_type_action, etc.)
#   - Runtime config (cached in-process by auth interpreter)
#   - Validation report (slot conflicts, cycle detection, etc.)
#
# The compiler assigns slot numbers automatically. Authors never
# see or think about slots. They declare intent, the platform
# maps to implementation.
#
# ════════════════════════════════════════════════════════════

# Module identity
module: <module_name>          # e.g., "project_management", "smart_market"
product: <product_name>        # e.g., "trafficure", "smartmarket"
version: 1                     # schema version (bumped on breaking changes)

# ─── SCOPE TYPES ────────────────────────────────────────
# What organizational dimensions do resources in this module
# participate in? These reference platform-level or org-level
# scope types. The module doesn't create scope types — it
# declares which ones it uses and what actions it needs on them.
#
# If the module needs a NEW scope type that doesn't exist,
# it declares it here and the compiler creates it.

scopes:
  <scope_name>:                # e.g., "team", "region", "department"
    label: <string>
    actions:                   # what permissions exist on this scope dimension
      - <action_name>         # e.g., "view", "manage", "lead"
    # Optional: declare a new scope type (if not already platform-defined)
    # create: true            # default: false (references existing scope type)

# ─── RESOURCE TYPES ─────────────────────────────────────
# What things exist in this module that need authorization.
# Each resource type gets its own action set, containment
# rules, cascade config, and scope bindings.

resources:
  <type_name>:                 # e.g., "project", "epic", "issue"
    label: <string>
    description: <string>      # optional
    root: <boolean>            # can exist without a parent? default: false

    # What types can contain this type
    contained_by:
      - <parent_type_name>     # e.g., "project" for epics

    # ── ACTIONS ──
    # What can users do to this resource type?
    # The compiler assigns slot numbers and builds the implies/requires DAG.
    actions:
      <action_name>:           # e.g., "view", "edit", "assign", "transition"
        label: <string>
        cascade: <boolean>     # inherit from parent resource? default: true
        implies:               # optional: this action grants these other actions
          - <action_name>
        requires:              # optional: ALL of these must independently pass
          - <action_name>

    # ── SCOPE BINDINGS ──
    # Which scope dimensions apply, and which scope action
    # is required for each resource action.
    scopes:
      <scope_name>:
        required: <boolean>    # must every instance be tagged with this scope?
        actions:               # resource_action → scope_action mapping
          <resource_action>: <scope_action>

    # ── MARKINGS ──
    # Does this resource type support markings?
    markings:
      enabled: <boolean>       # default: true
      propagate_to_children: <boolean>  # default: true

# ─── ROLES ──────────────────────────────────────────────
# Pre-defined bundles of actions. These are convenience
# groupings — the platform's role system uses these as
# templates for default role definitions.

roles:
  <role_name>:                 # e.g., "admin", "member", "viewer"
    label: <string>
    description: <string>
    # Which actions on which resource types this role grants
    grants:
      <resource_type>:
        - <action_name>`;

// ═══════════════════════════════════════════════════════════════════════════════
// JIRA-LIKE EXAMPLE
// ═══════════════════════════════════════════════════════════════════════════════

const JIRA_YAML = `# ════════════════════════════════════════════════════════════
# auth.yaml — Project Management Module (Jira-like)
# ════════════════════════════════════════════════════════════

module: project_management
product: platform_fabric
version: 1

# ─── Scopes ─────────────────────────────────────────────

scopes:
  team:
    label: Team
    actions:
      - view        # can see work items assigned to this team
      - manage      # can assign/reassign within this team

# ─── Resource Types ─────────────────────────────────────

resources:

  project:
    label: Project
    root: true
    contained_by: []            # top-level, can also be in folders

    actions:
      discover:
        label: Discover
        cascade: true
      view:
        label: View
        cascade: true
        implies: [discover]
      edit:
        label: Edit
        cascade: true
        implies: [view]
      configure:
        label: Configure Project
        cascade: false          # project config doesn't cascade from parent folder
        implies: [view]
      manage_members:
        label: Manage Members
        cascade: false
        implies: [view]
      admin:
        label: Admin
        cascade: false
        implies: [edit, configure, manage_members]

    scopes:
      team:
        required: false
        actions:
          view: view
          edit: manage
          configure: manage

    markings:
      enabled: true
      propagate_to_children: true

  epic:
    label: Epic
    contained_by: [project]

    actions:
      view:
        label: View
        cascade: true           # cascades from parent project
        implies: []
      edit:
        label: Edit
        cascade: true
        implies: [view]
      create_children:
        label: Create Issues
        cascade: false          # explicitly granted, not inherited from project.edit
        implies: [view]
      admin:
        label: Admin
        cascade: false
        implies: [edit, create_children]

    scopes:
      team:
        required: false
        actions:
          view: view
          edit: manage

    markings:
      enabled: true
      propagate_to_children: true

  issue:
    label: Issue
    contained_by: [epic, project]   # can be directly in a project (no epic)

    actions:
      view:
        label: View
        cascade: true           # cascades from parent epic or project
        implies: []
      comment:
        label: Comment
        cascade: true           # anyone who can view parent can comment
        implies: [view]
      edit:
        label: Edit
        cascade: true
        implies: [comment]
      assign:
        label: Assign
        cascade: false          # assigning is a distinct capability
        implies: [view]
      transition:
        label: Transition Status
        cascade: false          # moving issues through workflow
        implies: [view]
      delete:
        label: Delete
        cascade: false
        implies: [view]
      admin:
        label: Admin
        cascade: false
        implies: [edit, assign, transition, delete]

    scopes:
      team:
        required: true          # every issue must belong to a team
        actions:
          view: view
          edit: manage
          assign: manage
          transition: manage

    markings:
      enabled: true
      propagate_to_children: false  # issues are leaf nodes

  attachment:
    label: Attachment
    contained_by: [issue]

    actions:
      view:
        label: View
        cascade: true
      upload:
        label: Upload
        cascade: false
        implies: [view]
      delete:
        label: Delete
        cascade: false
        implies: [view]

    scopes: {}

    markings:
      enabled: true
      propagate_to_children: false

# ─── Roles (templates) ─────────────────────────────────

roles:
  project_admin:
    label: Project Admin
    description: Full control over a project and all its contents
    grants:
      project: [admin]
      epic: [admin]
      issue: [admin]
      attachment: [delete, upload]

  project_member:
    label: Project Member
    description: Can create and edit work items
    grants:
      project: [edit]
      epic: [edit, create_children]
      issue: [edit, assign, transition]
      attachment: [upload]

  project_viewer:
    label: Viewer
    description: Read-only access
    grants:
      project: [view]
      epic: [view]
      issue: [view]
      attachment: [view]

  issue_triager:
    label: Issue Triager
    description: Can view and assign issues, but not edit content
    grants:
      project: [view]
      epic: [view]
      issue: [view, assign, transition]`;

// ═══════════════════════════════════════════════════════════════════════════════
// SMARTMARKET EXAMPLE
// ═══════════════════════════════════════════════════════════════════════════════

const SMARTMARKET_YAML = `# ════════════════════════════════════════════════════════════
# auth.yaml — SmartMarket Module
# ════════════════════════════════════════════════════════════

module: smart_market
product: smartmarket
version: 1

scopes:
  region:
    label: Region
    actions:
      - view
      - manage
  channel:
    label: Distribution Channel
    actions:
      - view
      - manage

resources:

  workspace:
    label: Workspace
    root: true
    contained_by: []

    actions:
      discover:
        label: Discover
        cascade: true
      view:
        label: View
        cascade: true
        implies: [discover]
      edit:
        label: Edit
        cascade: true
        implies: [view]
      configure:
        label: Configure
        cascade: false
        implies: [view]
      admin:
        label: Admin
        cascade: false
        implies: [edit, configure]

    scopes:
      region:
        required: false
        actions:
          view: view
          edit: manage

    markings:
      enabled: true
      propagate_to_children: true

  discovery_board:
    label: Discovery Board
    contained_by: [workspace]

    actions:
      view:
        label: View
        cascade: true
      edit:
        label: Edit
        cascade: true
        implies: [view]
      run_analysis:
        label: Run Analysis
        cascade: false
        implies: [view]
      export:
        label: Export Data
        cascade: false
        implies: [view]
        requires: [view]        # redundant here but shows the pattern
      admin:
        label: Admin
        cascade: false
        implies: [edit, run_analysis, export]

    scopes:
      region:
        required: true
        actions:
          view: view
          edit: manage
          run_analysis: view
          export: manage
      channel:
        required: false
        actions:
          view: view

    markings:
      enabled: true
      propagate_to_children: true

  report:
    label: Report
    contained_by: [discovery_board, workspace]

    actions:
      view:
        label: View
        cascade: true
      edit:
        label: Edit
        cascade: false          # reports are authored, not inherited
        implies: [view]
      approve:
        label: Approve
        cascade: false
        implies: [view]
      publish:
        label: Publish
        cascade: false
        requires: [edit, approve]   # must have BOTH to publish
      share:
        label: Share Externally
        cascade: false
        implies: [view]
      admin:
        label: Admin
        cascade: false
        implies: [edit, approve, publish, share]

    scopes:
      region:
        required: true
        actions:
          view: view
          publish: manage
          share: manage

    markings:
      enabled: true
      propagate_to_children: false

  dataset:
    label: Dataset
    contained_by: [workspace]

    actions:
      view:
        label: View
        cascade: true
      query:
        label: Query
        cascade: true
        implies: [view]
      edit:
        label: Edit Schema
        cascade: false
        implies: [view]
      ingest:
        label: Ingest Data
        cascade: false
        implies: [view]
      admin:
        label: Admin
        cascade: false
        implies: [query, edit, ingest]

    scopes:
      region:
        required: false
        actions:
          view: view
          edit: manage
          ingest: manage

    markings:
      enabled: true
      propagate_to_children: false

roles:
  workspace_admin:
    label: Workspace Admin
    grants:
      workspace: [admin]
      discovery_board: [admin]
      report: [admin]
      dataset: [admin]

  analyst:
    label: Analyst
    grants:
      workspace: [view]
      discovery_board: [edit, run_analysis, export]
      report: [edit]
      dataset: [query]

  consumer:
    label: Report Consumer
    grants:
      workspace: [view]
      discovery_board: [view]
      report: [view]
      dataset: [view]`;

// ═══════════════════════════════════════════════════════════════════════════════
// COMPILER OUTPUT
// ═══════════════════════════════════════════════════════════════════════════════

const COMPILER_OUTPUT = `$ dx module auth compile --input ./auth.yaml --dry-run

╔══════════════════════════════════════════════════════════════╗
║  AUTH SCHEMA COMPILER v1.0                                   ║
║  Module: project_management | Product: platform_fabric       ║
╚══════════════════════════════════════════════════════════════╝

── VALIDATION ─────────────────────────────────────────────────

  ✓ All resource types have valid containment references
  ✓ No circular containment detected
  ✓ All scope references resolve to declared scopes
  ✓ All role grants reference valid (resource_type, action) pairs
  ✓ No cycles in implies graph
  ✓ Requires references resolve (publish requires [edit, approve])
  ✓ Max actions per type: 7 (issue) — within 8-slot limit
  ✓ Scope type "team" — checking platform registry...
    → "team" not found. Will be created as module-scoped scope type.

── SLOT ASSIGNMENT ────────────────────────────────────────────

  Resource type: project (6 actions → 6 slots)
  ┌──────────────────┬──────┬─────────┬──────────────────────────┐
  │ Action           │ Slot │ Mode    │ Implies                  │
  ├──────────────────┼──────┼─────────┼──────────────────────────┤
  │ discover         │   1  │ cascade │                          │
  │ view             │   2  │ cascade │ discover                 │
  │ edit             │   3  │ cascade │ view                     │
  │ configure        │   4  │ local   │ view                     │
  │ manage_members   │   5  │ local   │ view                     │
  │ admin            │   6  │ local   │ edit, configure,         │
  │                  │      │         │ manage_members           │
  └──────────────────┴──────┴─────────┴──────────────────────────┘

  Resource type: epic (4 actions → 4 slots)
  ┌──────────────────┬──────┬─────────┬──────────────────────────┐
  │ Action           │ Slot │ Mode    │ Implies                  │
  ├──────────────────┼──────┼─────────┼──────────────────────────┤
  │ view             │   1  │ cascade │                          │
  │ edit             │   2  │ cascade │ view                     │
  │ create_children  │   3  │ local   │ view                     │
  │ admin            │   4  │ local   │ edit, create_children    │
  └──────────────────┴──────┴─────────┴──────────────────────────┘

  Resource type: issue (7 actions → 7 slots)
  ┌──────────────────┬──────┬─────────┬──────────────────────────┐
  │ Action           │ Slot │ Mode    │ Implies                  │
  ├──────────────────┼──────┼─────────┼──────────────────────────┤
  │ view             │   1  │ cascade │                          │
  │ comment          │   2  │ cascade │ view                     │
  │ edit             │   3  │ cascade │ comment                  │
  │ assign           │   4  │ local   │ view                     │
  │ transition       │   5  │ local   │ view                     │
  │ delete           │   6  │ local   │ view                     │
  │ admin            │   7  │ local   │ edit, assign, transition,│
  │                  │      │         │ delete                   │
  └──────────────────┴──────┴─────────┴──────────────────────────┘

  Resource type: attachment (3 actions → 3 slots)
  ┌──────────────────┬──────┬─────────┬──────────────────────────┐
  │ Action           │ Slot │ Mode    │ Implies                  │
  ├──────────────────┼──────┼─────────┼──────────────────────────┤
  │ view             │   1  │ cascade │                          │
  │ upload           │   2  │ local   │ view                     │
  │ delete           │   3  │ local   │ view                     │
  └──────────────────┴──────┴─────────┴──────────────────────────┘

  Scope type: team (2 actions → 2 scope slots)
  ┌──────────────────┬──────┐
  │ Action           │ Slot │
  ├──────────────────┼──────┤
  │ view             │   1  │
  │ manage           │   2  │
  └──────────────────┴──────┘

── SCOPE BINDINGS ─────────────────────────────────────────────

  project × team:
    view      → team.view    (scope slot 1)
    edit      → team.manage  (scope slot 2)
    configure → team.manage  (scope slot 2)

  epic × team:
    view → team.view    (scope slot 1)
    edit → team.manage  (scope slot 2)

  issue × team (required):
    view       → team.view    (scope slot 1)
    edit       → team.manage  (scope slot 2)
    assign     → team.manage  (scope slot 2)
    transition → team.manage  (scope slot 2)

── ROLE TEMPLATES ─────────────────────────────────────────────

  project_admin:
    project:    slot_6 (admin)
    epic:       slot_4 (admin)
    issue:      slot_7 (admin)
    attachment: slot_2 (upload), slot_3 (delete)

  project_member:
    project:    slot_3 (edit)
    epic:       slot_2 (edit), slot_3 (create_children)
    issue:      slot_3 (edit), slot_4 (assign), slot_5 (transition)
    attachment: slot_2 (upload)

  project_viewer:
    project:    slot_2 (view)
    epic:       slot_1 (view)
    issue:      slot_1 (view)
    attachment: slot_1 (view)

  issue_triager:
    project:    slot_2 (view)
    epic:       slot_1 (view)
    issue:      slot_1 (view), slot_4 (assign), slot_5 (transition)

── GENERATED ARTIFACTS ────────────────────────────────────────

  migrations/
    20260328_001_project_management_auth.sql    (14 INSERTs)
  config/
    project_management.auth.json               (runtime config)

  Run with --apply to execute migration.`;

// ═══════════════════════════════════════════════════════════════════════════════
// DX CLI COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

const DX_COMMANDS = `# ─── Auth Schema Lifecycle ───────────────────────────────

# Validate schema without applying
dx module auth validate ./auth.yaml

# Compile and show what would be generated (dry run)
dx module auth compile --input ./auth.yaml --dry-run

# Compile and apply migration
dx module auth compile --input ./auth.yaml --apply

# Diff: show what changed between current registry and new schema
dx module auth diff ./auth.yaml

# Export: reverse-engineer auth.yaml from existing registry entries
dx module auth export --module project_management > auth.yaml

# ─── Schema Versioning ──────────────────────────────────

# When you bump the version field in auth.yaml, the compiler
# generates a MIGRATION, not a fresh insert. It diffs against
# the current registry state and produces:
#   - New actions: INSERT into resource_type_action
#   - Removed actions: soft-delete (mark inactive, don't drop tuples)
#   - Changed cascade: UPDATE cascade_from_parent
#   - Changed implies: UPDATE implies array
#   - New resource types: INSERT into resource_type + actions
#   - Removed types: soft-delete + warning about orphan tuples
#   - Slot reassignment: BLOCKED (would break existing tuples)

# Example: adding a "link" action to issues
# In auth.yaml, add under issue.actions:
#   link:
#     label: Link Issues
#     cascade: false
#     implies: [view]
#
# Then:
dx module auth diff ./auth.yaml
# Output:
#   + issue.link → slot_8 (next available), mode: local, implies: [view]
#   No breaking changes detected.

dx module auth compile --input ./auth.yaml --apply
# Generates:
#   INSERT INTO iam.resource_type_action
#     (resource_type_id, name, label, slot, cascade_from_parent, implies)
#   VALUES ('<issue_type_id>', 'link', 'Link Issues', 8, false, '{view}');

# ─── Validation Rules ───────────────────────────────────

# The compiler enforces:
# 1. Max 8 actions per resource type (slot limit)
# 2. No cycles in implies graph
# 3. Requires references exist as actions on the same type
# 4. Contained_by references exist as resource types in the same module
#    (or are platform-level types like "folder")
# 5. Scope bindings reference declared scopes
# 6. Scope action mappings reference valid scope actions
# 7. Role grants reference valid (type, action) pairs
# 8. No slot reassignment on version bump (would break tuples)
# 9. Hierarchical marking types need ordered levels
# 10. Required scope bindings can't be added to existing types
#     with untagged instances (data migration needed first)`;

// ═══════════════════════════════════════════════════════════════════════════════
// MIGRATION SQL EXAMPLE
// ═══════════════════════════════════════════════════════════════════════════════

const MIGRATION_SQL = `-- ════════════════════════════════════════════════════════════
-- GENERATED BY: dx module auth compile
-- Module: project_management | Version: 1
-- Generated: 2026-03-28T14:30:00Z
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ── Scope type ──────────────────────────────────────────
INSERT INTO iam.scope_type (id, org_id, name, label, system)
VALUES ('st_team', 'platform', 'team', 'Team', false);

INSERT INTO iam.scope_type_action (id, scope_type_id, name, label, slot)
VALUES
  ('sta_team_view',   'st_team', 'view',   'View',   1),
  ('sta_team_manage', 'st_team', 'manage', 'Manage', 2);

-- ── Resource type: project ──────────────────────────────
INSERT INTO iam.resource_type (id, org_id, name, label, allow_root, system)
VALUES ('rt_project', 'platform', 'project', 'Project', true, false);

INSERT INTO iam.resource_type_action
  (id, resource_type_id, name, label, slot, cascade_from_parent, implies, requires, system)
VALUES
  ('rta_prj_discover', 'rt_project', 'discover',       'Discover',        1, true,  '{}',                                '{}', false),
  ('rta_prj_view',     'rt_project', 'view',            'View',            2, true,  '{"discover"}',                      '{}', false),
  ('rta_prj_edit',     'rt_project', 'edit',            'Edit',            3, true,  '{"view"}',                          '{}', false),
  ('rta_prj_config',   'rt_project', 'configure',       'Configure',       4, false, '{"view"}',                          '{}', false),
  ('rta_prj_members',  'rt_project', 'manage_members',  'Manage Members',  5, false, '{"view"}',                          '{}', false),
  ('rta_prj_admin',    'rt_project', 'admin',           'Admin',           6, false, '{"edit","configure","manage_members"}', '{}', false);

INSERT INTO iam.resource_type_scope_binding
  (id, resource_type_id, scope_type_id, required, action_mapping)
VALUES
  ('rtsb_prj_team', 'rt_project', 'st_team', false,
   '{"view":"view","edit":"manage","configure":"manage"}');

-- ── Resource type: issue ────────────────────────────────
INSERT INTO iam.resource_type (id, org_id, name, label, allow_root, system)
VALUES ('rt_issue', 'platform', 'issue', 'Issue', false, false);

INSERT INTO iam.resource_type_action
  (id, resource_type_id, name, label, slot, cascade_from_parent, implies, requires, system)
VALUES
  ('rta_iss_view',       'rt_issue', 'view',       'View',              1, true,  '{}',                                      '{}', false),
  ('rta_iss_comment',    'rt_issue', 'comment',    'Comment',           2, true,  '{"view"}',                                '{}', false),
  ('rta_iss_edit',       'rt_issue', 'edit',       'Edit',              3, true,  '{"comment"}',                             '{}', false),
  ('rta_iss_assign',     'rt_issue', 'assign',     'Assign',            4, false, '{"view"}',                                '{}', false),
  ('rta_iss_transition', 'rt_issue', 'transition', 'Transition Status', 5, false, '{"view"}',                                '{}', false),
  ('rta_iss_delete',     'rt_issue', 'delete',     'Delete',            6, false, '{"view"}',                                '{}', false),
  ('rta_iss_admin',      'rt_issue', 'admin',      'Admin',             7, false, '{"edit","assign","transition","delete"}',  '{}', false);

INSERT INTO iam.resource_type_scope_binding
  (id, resource_type_id, scope_type_id, required, action_mapping)
VALUES
  ('rtsb_iss_team', 'rt_issue', 'st_team', true,
   '{"view":"view","edit":"manage","assign":"manage","transition":"manage"}');

INSERT INTO iam.resource_type_containment (id, parent_type_id, child_type_id)
VALUES
  ('rtc_prj_epic', 'rt_project', 'rt_epic'),
  ('rtc_epic_iss', 'rt_epic', 'rt_issue'),
  ('rtc_prj_iss',  'rt_project', 'rt_issue'),     -- issues can be directly in project
  ('rtc_iss_att',  'rt_issue', 'rt_attachment');

-- ... (epic and attachment INSERTs follow same pattern)

COMMIT;`;

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

const TABS = [
  { id: "spec", label: "Schema Spec" },
  { id: "jira", label: "Jira Example" },
  { id: "smartmarket", label: "SmartMarket" },
  { id: "compiler", label: "Compiler Output" },
  { id: "migration", label: "Migration SQL" },
  { id: "dx", label: "dx CLI" },
  { id: "design", label: "Design Notes" },
];

const Badge = ({ text, color = "#71717a", small = false }) => (
  <span style={{
    display: "inline-block", padding: small ? "1px 5px" : "2px 7px",
    borderRadius: "3px", fontSize: small ? "9px" : "10px", fontWeight: 700,
    fontFamily: mono, color, backgroundColor: `${color}12`, border: `1px solid ${color}25`,
    letterSpacing: "0.03em",
  }}>{text}</span>
);

const Code = ({ children, maxHeight = null, lang = "" }) => (
  <pre style={{
    padding: "14px 16px", borderRadius: "6px", border: "1px solid #1a1a22",
    backgroundColor: "#08080c", fontSize: "11px", fontFamily: mono,
    lineHeight: "1.7", color: "#a1a1aa", overflow: "auto", maxHeight,
    whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0,
  }}>{children}</pre>
);

const DESIGN_NOTES = [
  {
    title: "Why YAML and not a DSL?",
    content: `YAML is universally understood. Every developer reads it. No parser to build, no syntax to learn. 
The auth model is declarative config, not logic — YAML fits perfectly. If we ever hit YAML's expressiveness 
ceiling (unlikely for authorization declarations), we can add a thin superset (like Helm's template functions) 
without abandoning the base format.

Alternatives considered:
• CUE (too niche, learning curve)
• Protobuf (great for schemas, poor for this kind of config)
• Custom DSL (maintenance burden, no ecosystem)
• JSON (no comments, harder to read)
• TOML (nested structures are awkward)`,
  },
  {
    title: "Slot assignment strategy",
    content: `The compiler assigns slots using a simple rule: cascade actions get lower slot numbers, local actions get 
higher ones. Within each group, assignment follows declaration order.

WHY: This isn't semantically meaningful (slots are addresses, not ranks), but it makes the SpiceDB tuples 
slightly more readable during debugging. All cascade actions cluster in lower slots, all local in upper.

CRITICAL RULE: Slot numbers are NEVER reassigned on version bumps. If issue.view was slot_1 in v1, it stays 
slot_1 forever. If an action is removed, its slot becomes reserved (never reused). This prevents existing 
SpiceDB tuples from silently changing meaning.

The compiler tracks slot history in a .auth.lock file (similar to package-lock.json) that records which slot 
was assigned to which (type, action) pair. This file is committed to source control.`,
  },
  {
    title: "Where does auth.yaml live?",
    content: `<module_root>/
├── auth.yaml                    # authorization schema
├── auth.lock                    # slot assignment history (generated, committed)
├── module.yaml                  # module metadata
├── src/
│   ├── ...
└── migrations/
    └── auth/
        ├── 001_initial.sql      # generated by compiler
        └── 002_add_link.sql     # generated by compiler on v2

auth.yaml is version-controlled alongside the module's code. Changes go through PR review.
The compiler runs in CI to validate and generate migrations. No manual SQL for auth changes.`,
  },
  {
    title: "Cross-module references",
    content: `A module can reference resource types from other modules in contained_by:

  resources:
    report:
      contained_by: [smartmarket:workspace, smartmarket:discovery_board]

The compiler resolves cross-module references by checking the target module's registry entries.
If the target module hasn't been compiled yet, the compiler emits a warning (not an error) — 
this allows modules to be developed in parallel.

Scope types are platform-global. A module that declares scopes: { region: ... } is referencing 
the platform's "region" scope type, not creating a new one. Only create: true creates a new scope type.`,
  },
  {
    title: "Role templates vs runtime roles",
    content: `The 'roles' section in auth.yaml creates TEMPLATES, not rigid role definitions. At runtime:

• Org admins can create custom roles by composing any subset of actions from any resource type
• The template roles are the defaults shown in the admin UI
• Templates can be org-aliased (Samsung calls "project_member" → "Project Contributor")
• Templates participate in the role lattice — custom roles can inherit from templates

The compiler generates role_definition and role_permission entries in the iam schema.
These are seed data, not constraints — orgs can diverge freely.`,
  },
  {
    title: "What about ontology objects?",
    content: `auth.yaml covers RESOURCE authorization (platform containers with user-defined actions).
Ontology objects (domain data entities) have a DIFFERENT declaration mechanism:

  <module>/ontology.yaml         # defines object types, link types, properties
  <module>/auth.yaml             # defines resource types, actions, scopes

Ontology objects use the fixed ontology_object SpiceDB definition (owner/editor/viewer + 4 clearance 
slots). Their property-level security is declared in ontology.yaml, not auth.yaml:

  object_types:
    incident:
      properties:
        description: { type: text }
        casualty_details: { type: text, clearance: FORENSIC }      # → clearance_slot_2
        responding_officers: { type: text, clearance: OFFICER_PII } # → clearance_slot_3

The ontology compiler maps clearances to slots. The auth compiler maps actions to slots.
They're parallel systems that compose at runtime.`,
  },
  {
    title: "The .auth.lock file",
    content: `# auth.lock — DO NOT EDIT MANUALLY
# Generated by: dx module auth compile
# This file records slot assignments to prevent breaking changes.

module: project_management
product: platform_fabric

slot_assignments:
  project:
    discover: 1
    view: 2
    edit: 3
    configure: 4
    manage_members: 5
    admin: 6
  epic:
    view: 1
    edit: 2
    create_children: 3
    admin: 4
  issue:
    view: 1
    comment: 2
    edit: 3
    assign: 4
    transition: 5
    delete: 6
    admin: 7
  attachment:
    view: 1
    upload: 2
    delete: 3

scope_slot_assignments:
  team:
    view: 1
    manage: 2

# If you delete an action, add it here to prevent slot reuse:
# reserved_slots:
#   issue:
#     8: "link (removed in v3)"`,
  },
];

export default function AuthSchemaYAML() {
  const [tab, setTab] = useState("jira");
  const [designNote, setDesignNote] = useState(0);

  return (
    <div style={{
      minHeight: "100vh", backgroundColor: "#0a0a0c", color: "#e4e4e7",
      fontFamily: sans, padding: "20px",
    }}>
      {/* Header */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{
          fontSize: "9px", fontWeight: 800, fontFamily: mono,
          color: "#22c55e", letterSpacing: "0.12em", marginBottom: "4px",
        }}>PLATFORM FABRIC — AUTHORIZATION AS CODE</div>
        <div style={{ fontSize: "18px", fontWeight: 700, color: "#fafafa" }}>
          auth.yaml — Declarative Auth Schema for Module Authors
        </div>
        <div style={{ fontSize: "11px", color: "#52525b", marginTop: "3px" }}>
          Declare resource types · Compile to registry + migrations · Version-controlled · dx CLI
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

      {/* SPEC */}
      {tab === "spec" && (
        <div>
          <div style={{
            padding: "8px 12px", borderRadius: "5px", marginBottom: "12px",
            border: "1px solid #22c55e25", backgroundColor: "#080e08",
            fontSize: "11px", color: "#86efac", lineHeight: "1.7",
          }}>
            This is the schema specification. Module authors write <code style={{ fontFamily: mono }}>auth.yaml</code> following 
            this format. The compiler (<code style={{ fontFamily: mono }}>dx module auth compile</code>) validates, assigns slots, 
            and generates PG migrations. Authors never see slot numbers.
          </div>
          <Code maxHeight="700px">{SPEC}</Code>
        </div>
      )}

      {/* JIRA */}
      {tab === "jira" && (
        <div>
          <div style={{
            padding: "8px 12px", borderRadius: "5px", marginBottom: "12px",
            border: "1px solid #3b82f625", backgroundColor: "#080a0e",
            fontSize: "11px", color: "#93c5fd", lineHeight: "1.7",
          }}>
            A Jira-like project management module. Notice how the author thinks in domain terms — 
            "an issue has view, comment, edit, assign, transition, delete, admin" — not slots. 
            The cascade/implies/requires model captures real PM semantics: assigning an issue is a 
            distinct capability from editing it, and it doesn't cascade from the parent project.
          </div>
          <Code maxHeight="700px">{JIRA_YAML}</Code>
        </div>
      )}

      {/* SMARTMARKET */}
      {tab === "smartmarket" && (
        <div>
          <div style={{
            padding: "8px 12px", borderRadius: "5px", marginBottom: "12px",
            border: "1px solid #f59e0b25", backgroundColor: "#0e0c08",
            fontSize: "11px", color: "#fde68a", lineHeight: "1.7",
          }}>
            SmartMarket's auth model. Key patterns: discovery boards have <code style={{ fontFamily: mono }}>run_analysis</code> (domain-specific), 
            reports have <code style={{ fontFamily: mono }}>publish</code> which <code style={{ fontFamily: mono }}>requires: [edit, approve]</code> (separation 
            of duties), and datasets have <code style={{ fontFamily: mono }}>ingest</code> (data pipeline permission). Two scope dimensions: region + channel.
          </div>
          <Code maxHeight="700px">{SMARTMARKET_YAML}</Code>
        </div>
      )}

      {/* COMPILER */}
      {tab === "compiler" && (
        <div>
          <div style={{
            padding: "8px 12px", borderRadius: "5px", marginBottom: "12px",
            border: "1px solid #c084fc25", backgroundColor: "#0c080e",
            fontSize: "11px", color: "#d8b4fe", lineHeight: "1.7",
          }}>
            The compiler validates the schema, assigns slot numbers, resolves cross-references, 
            and generates PG migration SQL + runtime config JSON. Dry-run mode shows everything 
            without applying.
          </div>
          <Code maxHeight="700px">{COMPILER_OUTPUT}</Code>
        </div>
      )}

      {/* MIGRATION */}
      {tab === "migration" && (
        <div>
          <div style={{
            padding: "8px 12px", borderRadius: "5px", marginBottom: "12px",
            border: "1px solid #22c55e25", backgroundColor: "#080e08",
            fontSize: "11px", color: "#86efac", lineHeight: "1.7",
          }}>
            Generated SQL migration. The author never writes this — the compiler produces it.
            Note how slot numbers are assigned automatically and the implies arrays are translated 
            from action names.
          </div>
          <Code maxHeight="700px">{MIGRATION_SQL}</Code>
        </div>
      )}

      {/* DX CLI */}
      {tab === "dx" && (
        <div>
          <div style={{
            padding: "8px 12px", borderRadius: "5px", marginBottom: "12px",
            border: "1px solid #f59e0b25", backgroundColor: "#0e0c08",
            fontSize: "11px", color: "#fde68a", lineHeight: "1.7",
          }}>
            The <code style={{ fontFamily: mono }}>dx module auth</code> command tree. Validates, compiles, diffs, 
            and exports auth schemas. Integrates with module lifecycle and CI/CD.
          </div>
          <Code maxHeight="700px">{DX_COMMANDS}</Code>
        </div>
      )}

      {/* DESIGN NOTES */}
      {tab === "design" && (
        <div>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
            gap: "4px", marginBottom: "14px",
          }}>
            {DESIGN_NOTES.map((n, i) => (
              <button key={i} onClick={() => setDesignNote(i)} style={{
                padding: "5px 8px", borderRadius: "4px", border: "none", cursor: "pointer",
                fontSize: "9px", fontWeight: 600, fontFamily: mono, textAlign: "left",
                backgroundColor: designNote === i ? "#1c1c24" : "#0d0d0f",
                color: designNote === i ? "#fafafa" : "#52525b",
              }}>
                {n.title.length > 24 ? n.title.slice(0, 22) + "…" : n.title}
              </button>
            ))}
          </div>

          <div style={{
            borderRadius: "6px", border: "1px solid #18181b", overflow: "hidden",
          }}>
            <div style={{
              padding: "10px 14px", backgroundColor: "#0e0e12",
              borderBottom: "1px solid #18181b",
              fontSize: "12px", fontWeight: 700, color: "#e4e4e7",
            }}>
              {DESIGN_NOTES[designNote].title}
            </div>
            <div style={{ padding: "12px 14px" }}>
              <Code maxHeight="400px">{DESIGN_NOTES[designNote].content}</Code>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
