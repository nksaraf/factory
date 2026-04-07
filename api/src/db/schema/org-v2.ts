import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { newId } from "../../lib/id";
import {
  orgSchema,
  createdAt,
  updatedAt,
  metadataCol,
  specCol,
  bitemporalCols,
} from "./helpers";

import type {
  TeamSpec,
  PrincipalSpec,
  MembershipSpec,
  ScopeSpec,
  IdentityLinkSpec,
  AgentSpec,
  RolePresetSpec,
  JobSpec,
  MemorySpec,
  ToolCredentialSpec,
  ToolUsageSpec,
  MessagingProviderSpec,
  SshKeySpec,
  ConfigVarSpec,
  OrgSecretSpec,
} from "@smp/factory-shared/schemas/org";

// ─── Team ────────────────────────────────────────────────────
// Hierarchical org unit: team, business-unit, or product-area.

export const team = orgSchema.table(
  "team",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("team")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull().default("team"),
    parentTeamId: text("parent_team_id").references((): any => team.id, { onDelete: "set null" }),
    spec: specCol<TeamSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...bitemporalCols(),

  },
  (t) => [
    // Partial unique indexes (WHERE valid_to IS NULL AND system_to IS NULL) in migration;
    // Drizzle can't express WHERE clauses on indexes.
    index("org_team_slug_idx").on(t.slug),
    index("org_team_name_idx").on(t.name),
    index("org_team_parent_team_idx").on(t.parentTeamId),
    index("org_team_type_idx").on(t.type),
    check(
      "org_team_type_valid",
      sql`${t.type} IN ('team', 'business-unit', 'product-area')`,
    ),
  ],
);

// ─── Principal ───────────────────────────────────────────────
// Unifies all actors: human users, agents, service accounts.

export const principal = orgSchema.table(
  "principal",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("prin")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    primaryTeamId: text("primary_team_id").references(() => team.id, {
      onDelete: "set null",
    }),
    spec: specCol<PrincipalSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...bitemporalCols(),

  },
  (t) => [
    // Partial unique index in migration (bitemporal)
    index("org_principal_slug_idx").on(t.slug),
    index("org_principal_type_idx").on(t.type),
    index("org_principal_primary_team_idx").on(t.primaryTeamId),
    check(
      "org_principal_type_valid",
      sql`${t.type} IN ('human', 'agent', 'service-account')`,
    ),
  ],
);

// ─── Membership ──────────────────────────────────────────────
// Multi-team membership join table.

export const membership = orgSchema.table(
  "membership",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("ptm")),
    principalId: text("principal_id")
      .notNull()
      .references(() => principal.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    spec: specCol<MembershipSpec>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("org_membership_principal_team_unique").on(
      t.principalId,
      t.teamId,
    ),
    index("org_membership_team_idx").on(t.teamId),
  ],
);

// ─── Scope ───────────────────────────────────────────────────
// Authorization scopes: team-derived, resource-level, or custom.

export const scope = orgSchema.table(
  "scope",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("scope")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    teamId: text("team_id").references(() => team.id, {
      onDelete: "set null",
    }),
    spec: specCol<ScopeSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("org_scope_slug_unique").on(t.slug),
    index("org_scope_type_idx").on(t.type),
    index("org_scope_team_idx").on(t.teamId),
    check(
      "org_scope_type_valid",
      sql`${t.type} IN ('team', 'resource', 'custom')`,
    ),
  ],
);

// ─── Identity Link ──────────────────────────────────────────
// Multi-provider identity linking for principals.

export const identityLink = orgSchema.table(
  "identity_link",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("idlk")),
    type: text("type").notNull(),
    principalId: text("principal_id")
      .notNull()
      .references(() => principal.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    spec: specCol<IdentityLinkSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("org_identity_link_type_external_unique").on(t.type, t.externalId),
    uniqueIndex("org_identity_link_principal_type_unique").on(t.principalId, t.type),
    index("org_identity_link_type_idx").on(t.type),
    index("org_identity_link_principal_idx").on(t.principalId),
    check(
      "org_identity_link_type_valid",
      sql`${t.type} IN ('github', 'google', 'slack', 'jira', 'claude', 'cursor')`,
    ),
  ],
);

// ─── Agent ──────────────────────────────────────────────────
// Persistent AI actor identity with role type and reporting hierarchy.

export const agent = orgSchema.table(
  "agent",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("agt")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    principalId: text("principal_id")
      .notNull()
      .references(() => principal.id),
    reportsToAgentId: text("reports_to_agent_id"),
    status: text("status").notNull().default("active"),
    spec: specCol<AgentSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("org_agent_slug_unique").on(t.slug),
    uniqueIndex("org_agent_name_unique").on(t.name),
    index("org_agent_type_idx").on(t.type),
    index("org_agent_principal_idx").on(t.principalId),
    index("org_agent_reports_to_idx").on(t.reportsToAgentId),
    index("org_agent_status_idx").on(t.status),
    check(
      "org_agent_status_valid",
      sql`${t.status} IN ('active', 'disabled')`,
    ),
    check(
      "org_agent_type_valid",
      sql`${t.type} IN ('engineering', 'qa', 'product', 'security', 'ops', 'external-mcp')`,
    ),
  ],
);

// ─── Role Preset ────────────────────────────────────────────
// Named convenience configurations for agents. System presets have orgId=null.

export const rolePreset = orgSchema.table(
  "role_preset",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("rpre")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    orgId: text("org_id"),
    spec: specCol<RolePresetSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("org_role_preset_slug_unique").on(t.slug),
    index("org_role_preset_org_idx").on(t.orgId),
  ],
);

// ─── Job ────────────────────────────────────────────────────
// Discrete unit of work assigned to an agent.

export const job = orgSchema.table(
  "job",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("job")),
    agentId: text("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    delegatedByAgentId: text("delegated_by_agent_id").references(
      () => agent.id,
      { onDelete: "set null" },
    ),
    parentJobId: text("parent_job_id"),
    status: text("status").notNull().default("pending"),
    mode: text("mode").notNull().default("conversational"),
    trigger: text("trigger").notNull().default("manual"),
    spec: specCol<JobSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("org_job_agent_idx").on(t.agentId),
    index("org_job_delegated_by_idx").on(t.delegatedByAgentId),
    index("org_job_parent_idx").on(t.parentJobId),
    index("org_job_status_idx").on(t.status),
    index("org_job_mode_idx").on(t.mode),
    check(
      "org_job_status_valid",
      sql`${t.status} IN ('pending', 'running', 'completed', 'failed', 'cancelled')`,
    ),
    check(
      "org_job_mode_valid",
      sql`${t.mode} IN ('conversational', 'autonomous', 'observation')`,
    ),
    check(
      "org_job_trigger_valid",
      sql`${t.trigger} IN ('mention', 'event', 'schedule', 'delegation', 'manual')`,
    ),
  ],
);

// ─── Memory ────────────────────────────────────────────────
// Layered knowledge system for agents.

export const memory = orgSchema.table(
  "memory",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("mem")),
    type: text("type").notNull(),
    layer: text("layer").notNull().default("session"),
    status: text("status").notNull().default("proposed"),
    sourceAgentId: text("source_agent_id").references(() => agent.id, { onDelete: "set null" }),
    approvedByPrincipalId: text("approved_by_principal_id").references(
      () => principal.id,
      { onDelete: "set null" },
    ),
    spec: specCol<MemorySpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("org_memory_type_idx").on(t.type),
    index("org_memory_layer_idx").on(t.layer),
    index("org_memory_status_idx").on(t.status),
    index("org_memory_source_agent_idx").on(t.sourceAgentId),
    index("org_memory_approved_by_idx").on(t.approvedByPrincipalId),
    check(
      "org_memory_type_valid",
      sql`${t.type} IN ('fact', 'preference', 'decision', 'pattern', 'relationship', 'signal')`,
    ),
    check(
      "org_memory_layer_valid",
      sql`${t.layer} IN ('session', 'team', 'org')`,
    ),
    check(
      "org_memory_status_valid",
      sql`${t.status} IN ('proposed', 'approved', 'superseded', 'archived')`,
    ),
  ],
);

// ─── Tool Credential ────────────────────────────────────────
// API keys / credentials for developer tools.

export const toolCredential = orgSchema.table(
  "tool_credential",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("tcred")),
    principalId: text("principal_id")
      .notNull()
      .references(() => principal.id, { onDelete: "cascade" }),
    spec: specCol<ToolCredentialSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("org_tool_credential_principal_idx").on(t.principalId),
  ],
);

// ─── Tool Usage ─────────────────────────────────────────────
// Usage tracking for any tool by any principal.

export const toolUsage = orgSchema.table(
  "tool_usage",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("tusg")),
    principalId: text("principal_id")
      .notNull()
      .references(() => principal.id, { onDelete: "cascade" }),
    tool: text("tool").notNull(),
    costMicrodollars: integer("cost_microdollars").notNull().default(0),
    spec: specCol<ToolUsageSpec>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("org_tool_usage_principal_idx").on(t.principalId),
    index("org_tool_usage_tool_created_idx").on(t.tool, t.createdAt),
    index("org_tool_usage_principal_created_idx").on(t.principalId, t.createdAt),
  ],
);

// ─── Messaging Provider ─────────────────────────────────────
// Connected messaging workspaces (Slack, Teams, Google Chat).

export const messagingProvider = orgSchema.table(
  "messaging_provider",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("msgp")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id),
    spec: specCol<MessagingProviderSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("org_messaging_provider_slug_unique").on(t.slug),
    index("org_messaging_provider_type_idx").on(t.type),
    index("org_messaging_provider_team_idx").on(t.teamId),
    check(
      "org_messaging_provider_type_valid",
      sql`${t.type} IN ('slack', 'teams', 'google-chat')`,
    ),
  ],
);

// ─── SSH Key ────────────────────────────────────────────────
// SSH keys belonging to principals.

export const sshKey = orgSchema.table(
  "ssh_key",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("sshk")),
    type: text("type").notNull(),
    principalId: text("principal_id")
      .notNull()
      .references(() => principal.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    spec: specCol<SshKeySpec>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("org_ssh_key_fingerprint_unique").on(t.fingerprint),
    index("org_ssh_key_type_idx").on(t.type),
    index("org_ssh_key_principal_idx").on(t.principalId),
    check(
      "org_ssh_key_type_valid",
      sql`${t.type} IN ('ed25519', 'rsa', 'ecdsa')`,
    ),
  ],
);

// ─── Config Var ─────────────────────────────────────────────
// Plain-text configuration variables. Readable by anyone with scope access.

export const configVar = orgSchema.table(
  "config_var",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("cvar")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    environment: text("environment").notNull().default("all"),
    value: text("value").notNull(),
    spec: specCol<ConfigVarSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("org_config_var_slug_scope_env_unique").on(
      t.slug,
      t.scopeType,
      t.scopeId,
      t.environment,
    ),
    index("org_config_var_scope_idx").on(t.scopeType, t.scopeId),
    index("org_config_var_env_idx").on(t.environment),
    check(
      "org_config_var_scope_type_valid",
      sql`${t.scopeType} IN ('org', 'team', 'project', 'principal', 'system')`,
    ),
  ],
);

// ─── Secret ─────────────────────────────────────────────────
// Encrypted secrets stored directly in the database using envelope encryption.
// AES-256-GCM with keyVersion for rotation support.

export const secret = orgSchema.table(
  "secret",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("sec")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    environment: text("environment").notNull().default("all"),
    encryptedValue: text("encrypted_value").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    createdBy: text("created_by").references(() => principal.id, {
      onDelete: "set null",
    }),
    spec: specCol<OrgSecretSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("org_secret_slug_scope_env_unique").on(
      t.slug,
      t.scopeType,
      t.scopeId,
      t.environment,
    ),
    index("org_secret_scope_idx").on(t.scopeType, t.scopeId),
    index("org_secret_env_idx").on(t.environment),
    index("org_secret_key_version_idx").on(t.keyVersion),
    check(
      "org_secret_scope_type_valid",
      sql`${t.scopeType} IN ('org', 'team', 'project', 'principal', 'system')`,
    ),
  ],
);

// ─── Workflow Run ─────────────────────────────────────────
// Tracks each workflow execution with JSONB state.

export const workflowRun = orgSchema.table(
  "workflow_run",
  {
    workflowRunId: text("workflow_run_id")
      .primaryKey()
      .$defaultFn(() => newId("wfr")),

    /** Registered workflow name, e.g. "god-workflow", "code-review". */
    workflowName: text("workflow_name").notNull(),

    /** How this run was triggered. */
    trigger: text("trigger").notNull(), // "jira_webhook" | "github_webhook" | "cli" | "manual" | "schedule" | "workflow"

    /** Raw trigger payload for debugging. */
    triggerPayload: jsonb("trigger_payload"),

    /** Validated input passed to the workflow function. */
    input: jsonb("input").notNull(),

    /** Final output on completion. */
    output: jsonb("output"),

    /**
     * Mutable scratch pad — each workflow writes its own shape here.
     * E.g. god-workflow stores { branchName, workspaceId, jobId, prNumber, prUrl, previewUrl }.
     */
    state: jsonb("state").notNull().default(sql`'{}'`),

    /** Workflow-defined phase label for display/API. */
    phase: text("phase").notNull().default("started"),

    /** Execution status. */
    status: text("status").notNull().default("running"), // running | succeeded | failed | cancelled

    /** Error message if failed. */
    error: text("error"),

    /** Parent workflow run for child/sub-workflows. */
    parentWorkflowRunId: text("parent_workflow_run_id"),

    /** Workflow-specific configuration. */
    config: jsonb("config").notNull().default(sql`'{}'`),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("org_wf_run_workflow_name_idx").on(t.workflowName),
    index("org_wf_run_status_idx").on(t.status),
    index("org_wf_run_parent_idx").on(t.parentWorkflowRunId),
  ],
);

// ─── Event Subscription ──────────────────────────────────
// Inngest-style event subscriptions for content-based routing.

export const eventSubscription = orgSchema.table(
  "event_subscription",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("esub")),

    /** The workflow run that registered this subscription. */
    workflowRunId: text("workflow_run_id").notNull(),

    /** Event name to match, e.g. "workspace.ready", "pr.opened". */
    eventName: text("event_name").notNull(),

    /**
     * JSONB fields that must be a subset of the emitted event data.
     * Uses Postgres <@ (contained-by) operator for matching.
     * E.g. { "workspaceId": "wks_abc123" }
     */
    matchFields: jsonb("match_fields").notNull(),

    createdAt: createdAt(),

    /** Auto-expire stale subscriptions. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [
    index("org_esub_event_name_idx").on(t.eventName),
    index("org_esub_workflow_run_idx").on(t.workflowRunId),
    // GIN index for JSONB containment queries on matchFields
    index("org_esub_match_fields_gin_idx").using("gin", t.matchFields),
  ],
);
