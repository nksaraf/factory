import type { EventSpec } from "@smp/factory-shared/schemas/events"
import type {
  AgentSpec,
  ChannelSpec,
  ConfigVarSpec,
  DocumentSpec,
  DocumentVersionSpec,
  EntityRelationshipSpec,
  ExchangeSpec,
  IdentityLinkSpec,
  JobSpec,
  MembershipSpec,
  MemorySpec,
  MessageSpec,
  MessagingProviderSpec,
  OrgSecretSpec,
  PrincipalSpec,
  RolePresetSpec,
  ScopeSpec,
  SshKeySpec,
  TeamSpec,
  ThreadChannelSpec,
  ThreadSpec,
  ThreadTurnSpec,
  ToolCallSpec,
  ToolCredentialSpec,
  ToolUsageSpec,
  WebhookEventSpec,
} from "@smp/factory-shared/schemas/org"
import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

import { newId } from "../../lib/id"
import {
  bitemporalCols,
  createdAt,
  metadataCol,
  orgSchema,
  specCol,
  updatedAt,
} from "./helpers"

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
    parentTeamId: text("parent_team_id").references((): any => team.id, {
      onDelete: "set null",
    }),
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
  ]
)

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
  ]
)

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
      t.teamId
    ),
    index("org_membership_team_idx").on(t.teamId),
  ]
)

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
  ]
)

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
    uniqueIndex("org_identity_link_type_external_unique").on(
      t.type,
      t.externalId
    ),
    uniqueIndex("org_identity_link_principal_type_unique").on(
      t.principalId,
      t.type
    ),
    index("org_identity_link_type_idx").on(t.type),
    index("org_identity_link_principal_idx").on(t.principalId),
  ]
)

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
  ]
)

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
  ]
)

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
      { onDelete: "set null" }
    ),
    parentJobId: text("parent_job_id"),
    workflowRunId: text("workflow_run_id"),
    channelId: text("channel_id"),
    entityKind: text("entity_kind"),
    entityId: text("entity_id"),
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
    index("org_job_workflow_run_idx").on(t.workflowRunId),
    index("org_job_channel_idx").on(t.channelId),
    index("org_job_entity_idx").on(t.entityKind, t.entityId),
    index("org_job_status_idx").on(t.status),
    index("org_job_mode_idx").on(t.mode),
  ]
)

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
    sourceAgentId: text("source_agent_id").references(() => agent.id, {
      onDelete: "set null",
    }),
    approvedByPrincipalId: text("approved_by_principal_id").references(
      () => principal.id,
      { onDelete: "set null" }
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
  ]
)

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
  (t) => [index("org_tool_credential_principal_idx").on(t.principalId)]
)

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
    index("org_tool_usage_principal_created_idx").on(
      t.principalId,
      t.createdAt
    ),
  ]
)

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
  ]
)

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
  ]
)

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
      t.environment
    ),
    index("org_config_var_scope_idx").on(t.scopeType, t.scopeId),
    index("org_config_var_env_idx").on(t.environment),
  ]
)

// ─── Entity Relationship ────────────────────────────────────
// Cross-entity graph edges for dependency graphs, ownership, and topology.

export const entityRelationship = orgSchema.table(
  "entity_relationship",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("erel")),
    type: text("type").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id").notNull(),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    spec: specCol<EntityRelationshipSpec>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("org_entity_rel_unique").on(
      t.type,
      t.sourceKind,
      t.sourceId,
      t.targetKind,
      t.targetId
    ),
    index("org_entity_rel_type_idx").on(t.type),
    index("org_entity_rel_source_idx").on(t.sourceKind, t.sourceId),
    index("org_entity_rel_target_idx").on(t.targetKind, t.targetId),
  ]
)

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
      t.environment
    ),
    index("org_secret_scope_idx").on(t.scopeType, t.scopeId),
    index("org_secret_env_idx").on(t.environment),
    index("org_secret_key_version_idx").on(t.keyVersion),
  ]
)

// ─── Channel ─────────────────────────────────────────────
// Persistent surface where threads live (IDE, Slack, terminal, PR, etc).

export const channel = orgSchema.table(
  "channel",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("chan")),
    kind: text("kind").notNull(),
    externalId: text("external_id"),
    name: text("name"),
    repoSlug: text("repo_slug"),
    status: text("status").notNull().default("active"),
    spec: specCol<ChannelSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("org_channel_kind_external_unique").on(t.kind, t.externalId),
    index("org_channel_kind_idx").on(t.kind),
    index("org_channel_repo_slug_idx").on(t.repoSlug),
    index("org_channel_status_idx").on(t.status),
  ]
)

// ─── Thread ──────────────────────────────────────────────
// Universal conversation primitive: IDE sessions, chats, terminal sessions, reviews, autonomous work.

export const thread = orgSchema.table(
  "thread",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("thrd")),
    type: text("type").notNull(),
    source: text("source").notNull(),
    externalId: text("external_id"),
    principalId: text("principal_id").references(() => principal.id, {
      onDelete: "set null",
    }),
    agentId: text("agent_id").references(() => agent.id, {
      onDelete: "set null",
    }),
    jobId: text("job_id").references(() => job.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("active"),
    channelId: text("channel_id").references(() => channel.id, {
      onDelete: "set null",
    }),
    repoSlug: text("repo_slug"),
    branch: text("branch"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    parentThreadId: text("parent_thread_id"),
    spec: specCol<ThreadSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("org_thread_source_external_unique").on(t.source, t.externalId),
    index("org_thread_type_idx").on(t.type),
    index("org_thread_source_idx").on(t.source),
    index("org_thread_principal_idx").on(t.principalId),
    index("org_thread_agent_idx").on(t.agentId),
    index("org_thread_job_idx").on(t.jobId),
    index("org_thread_status_idx").on(t.status),
    index("org_thread_channel_idx").on(t.channelId),
    index("org_thread_repo_slug_idx").on(t.repoSlug),
    index("org_thread_started_at_idx").on(t.startedAt),
    index("org_thread_parent_idx").on(t.parentThreadId),
    index("org_thread_spec_gin_idx").using("gin", t.spec),
  ]
)

// ─── Thread Turn ─────────────────────────────────────────
// Single exchange within a thread (prompt/response, command/output, message).

export const threadTurn = orgSchema.table(
  "thread_turn",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("turn")),
    threadId: text("thread_id")
      .notNull()
      .references(() => thread.id, { onDelete: "cascade" }),
    turnIndex: integer("turn_index").notNull(),
    role: text("role").notNull(),
    spec: specCol<ThreadTurnSpec>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("org_thread_turn_thread_index_unique").on(
      t.threadId,
      t.turnIndex
    ),
    index("org_thread_turn_thread_idx").on(t.threadId),
    index("org_thread_turn_spec_gin_idx").using("gin", t.spec),
  ]
)

// ─── Thread Participant ──────────────────────────────────
// Multi-participant join table for threads.

export const threadParticipant = orgSchema.table(
  "thread_participant",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("tprt")),
    threadId: text("thread_id")
      .notNull()
      .references(() => thread.id, { onDelete: "cascade" }),
    principalId: text("principal_id")
      .notNull()
      .references(() => principal.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
    spec: specCol<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("org_thread_participant_unique").on(
      t.threadId,
      t.principalId,
      t.role
    ),
    index("org_thread_participant_thread_idx").on(t.threadId),
    index("org_thread_participant_principal_idx").on(t.principalId),
    index("org_thread_participant_role_idx").on(t.role),
  ]
)

// ─── Thread Channel (surface) ────────────────────────────
// Links a thread to additional channels (surfaces) beyond its origin channelId.
// E.g. mirror a Claude Code session to a Slack thread.

export const threadChannel = orgSchema.table(
  "thread_channel",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("tc")),
    threadId: text("thread_id")
      .notNull()
      .references(() => thread.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    status: text("status").notNull().default("connected"),
    spec: specCol<ThreadChannelSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("org_thread_channel_unique").on(t.threadId, t.channelId),
    index("org_thread_channel_thread_idx").on(t.threadId),
    index("org_thread_channel_channel_idx").on(t.channelId),
    index("org_thread_channel_status_idx").on(t.status),
  ]
)

// ─── Message ─────────────────────────────────────────────
// Source of truth for thread interactions. One row per wire-level message.
// Content blocks stored as JSONB array (verbatim from source).

export const message = orgSchema.table(
  "message",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("msg")),
    threadId: text("thread_id")
      .notNull()
      .references(() => thread.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    role: text("role").notNull(),
    source: text("source").notNull(),
    content: jsonb("content").notNull().$type<Record<string, unknown>[]>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    spec: specCol<MessageSpec>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("org_message_thread_idx").on(t.threadId),
    index("org_message_thread_started_idx").on(t.threadId, t.startedAt),
    index("org_message_parent_idx").on(t.parentId),
    index("org_message_role_idx").on(t.role),
    index("org_message_source_idx").on(t.source),
    index("org_message_spec_gin_idx").using("gin", t.spec),
    index("org_message_content_gin_idx").using("gin", t.content),
  ]
)

// ─── Exchange ────────────────────────────────────────────
// Semantic span: user question → everything the agent did → final response.
// Derived and materialized for fast rendering of exchange summary cards.

export const exchange = orgSchema.table(
  "exchange",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("exch")),
    threadId: text("thread_id")
      .notNull()
      .references(() => thread.id, { onDelete: "cascade" }),
    triggerMessageId: text("trigger_message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    terminalMessageId: text("terminal_message_id").references(
      () => message.id,
      {
        onDelete: "set null",
      }
    ),
    status: text("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    spec: specCol<ExchangeSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("org_exchange_thread_idx").on(t.threadId),
    index("org_exchange_thread_started_idx").on(t.threadId, t.startedAt),
    index("org_exchange_status_idx").on(t.status),
    index("org_exchange_trigger_idx").on(t.triggerMessageId),
    index("org_exchange_spec_gin_idx").using("gin", t.spec),
  ]
)

// ─── Tool Call ───────────────────────────────────────────
// Projection of tool_use content blocks for queryability and FK targets.
// id = tool_use_id from the source content block.

export const toolCall = orgSchema.table(
  "tool_call",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => thread.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    exchangeId: text("exchange_id").references(() => exchange.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    resultMessageId: text("result_message_id").references(() => message.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("pending"),
    isError: boolean("is_error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    spec: specCol<ToolCallSpec>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("org_tool_call_thread_idx").on(t.threadId),
    index("org_tool_call_message_idx").on(t.messageId),
    index("org_tool_call_exchange_idx").on(t.exchangeId),
    index("org_tool_call_name_idx").on(t.name),
    index("org_tool_call_name_thread_idx").on(t.name, t.threadId),
    index("org_tool_call_status_idx").on(t.status),
    index("org_tool_call_result_msg_idx").on(t.resultMessageId),
    index("org_tool_call_input_gin_idx").using("gin", t.input),
    index("org_tool_call_spec_gin_idx").using("gin", t.spec),
  ]
)

// ─── Webhook Event ────────────────────────────────────────
// Universal webhook event log for all external integrations.

export const webhookEvent = orgSchema.table(
  "webhook_event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("whe")),
    source: text("source").notNull(),
    providerId: text("provider_id").notNull(),
    deliveryId: text("delivery_id").notNull(),
    actorId: text("actor_id"),
    eventType: text("event_type"),
    entityId: text("entity_id"),
    spec: specCol<WebhookEventSpec>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("org_webhook_event_source_provider_delivery_unique").on(
      t.source,
      t.providerId,
      t.deliveryId
    ),
    index("org_webhook_event_source_idx").on(t.source),
    index("org_webhook_event_provider_idx").on(t.providerId),
    index("org_webhook_event_created_idx").on(t.createdAt),
    index("org_webhook_event_actor_idx").on(t.actorId),
    index("org_webhook_event_event_type_idx").on(t.eventType),
    index("org_webhook_event_entity_idx").on(t.entityId),
    index("org_webhook_event_actor_created_idx").on(t.actorId, t.createdAt),
    index("org_webhook_event_event_type_created_idx").on(
      t.eventType,
      t.createdAt
    ),
    index("org_webhook_event_spec_gin_idx").using("gin", t.spec),
  ]
)

// ─── Event (Universal Event Log) ──────────────────────────────────
// Replaces webhook_event as the single event store.
// All producers (reconciler, webhooks, agents, CLI, API mutations)
// write canonical events here via emitEvent().

export const event = orgSchema.table(
  "event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("evt")),
    topic: text("topic").notNull(),
    source: text("source").notNull(),
    severity: text("severity").notNull().default("info"),

    correlationId: text("correlation_id"),
    parentEventId: text("parent_event_id"),

    principalId: text("principal_id"),
    entityKind: text("entity_kind"),
    entityId: text("entity_id"),

    scopeKind: text("scope_kind").notNull().default("org"),
    scopeId: text("scope_id").notNull().default("default"),

    rawEventType: text("raw_event_type"),
    idempotencyKey: text("idempotency_key"),
    schemaVersion: integer("schema_version").notNull().default(1),

    spec: specCol<EventSpec>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("org_event_topic_idx").on(t.topic),
    index("org_event_source_idx").on(t.source),
    index("org_event_entity_idx").on(t.entityKind, t.entityId),
    index("org_event_principal_idx").on(t.principalId),
    index("org_event_occurred_idx").on(t.occurredAt),
    index("org_event_correlation_idx").on(t.correlationId),
    index("org_event_parent_idx").on(t.parentEventId),
    index("org_event_severity_idx").on(t.severity),
    uniqueIndex("org_event_idempotency_unique").on(t.idempotencyKey),
    index("org_event_spec_gin_idx").using("gin", t.spec),
  ]
)

// ─── Event Outbox ──────────────────────────────────────────────
// Transactional outbox for reliable NATS publishing.
// Written in the same DB transaction as org.event.
// The outbox relay polls for pending rows, publishes to NATS,
// and marks them as published.

export const eventOutbox = orgSchema.table(
  "event_outbox",
  {
    eventId: text("event_id")
      .primaryKey()
      .references(() => event.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: createdAt(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [index("org_event_outbox_pending_idx").on(t.createdAt)]
)

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
     * E.g. god-workflow stores { branchName, workbenchId, jobId, prNumber, prUrl, previewUrl }.
     */
    state: jsonb("state")
      .notNull()
      .default(sql`'{}'`),

    /** Workflow-defined phase label for display/API. */
    phase: text("phase").notNull().default("started"),

    /** Execution status. */
    status: text("status").notNull().default("running"), // running | succeeded | failed | cancelled

    /** Error message if failed. */
    error: text("error"),

    /** Parent workflow run for child/sub-workflows. */
    parentWorkflowRunId: text("parent_workflow_run_id"),

    /** Workflow-specific configuration. */
    config: jsonb("config")
      .notNull()
      .default(sql`'{}'`),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("org_wf_run_workflow_name_idx").on(t.workflowName),
    index("org_wf_run_status_idx").on(t.status),
    index("org_wf_run_parent_idx").on(t.parentWorkflowRunId),
  ]
)

// ─── Event Subscription ──────────────────────────────────
// Unified event subscription: covers both transient workflow triggers
// and persistent notification streams.
//
// kind = "trigger": fire-once, wakes a workflow, has expiresAt
// kind = "stream":  persistent, delivers to channels, ongoing

export interface EventSubscriptionSpec {
  muted?: boolean
  mutedUntil?: string
  quietHoursStart?: string
  quietHoursEnd?: string
  timezone?: string
  escalationPolicy?: {
    steps: Array<{
      delayMinutes: number
      targetPrincipalId: string
    }>
  }
}

export const eventSubscription = orgSchema.table(
  "event_subscription",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("esub")),

    name: text("name"),

    kind: text("kind").notNull(),

    status: text("status").notNull().default("active"),

    topicFilter: text("topic_filter").notNull(),

    matchFields: jsonb("match_fields"),

    minSeverity: text("min_severity"),

    scopeKind: text("scope_kind"),
    scopeId: text("scope_id"),

    ownerKind: text("owner_kind").notNull(),
    ownerId: text("owner_id").notNull(),

    spec: specCol<EventSubscriptionSpec>(),

    expiresAt: timestamp("expires_at", { withTimezone: true }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("org_esub_topic_filter_idx").on(t.topicFilter),
    index("org_esub_kind_idx").on(t.kind),
    index("org_esub_status_idx").on(t.status),
    index("org_esub_owner_idx").on(t.ownerKind, t.ownerId),
    index("org_esub_match_fields_gin_idx").using(
      "gin",
      sql`COALESCE(${t.matchFields}, '{}'::jsonb)`
    ),
  ]
)

// ─── Event Subscription Channel ─────────────────────────
// How a stream subscription delivers — many channels per subscription.
// Only used for kind = "stream". Triggers don't have channels.

export interface EventSubscriptionChannelSpec {
  rateLimit?: { maxPerHour: number }
  batchWindow?: string
  schedule?: string
  template?: string
}

export const eventSubscriptionChannel = orgSchema.table(
  "event_subscription_channel",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("esch")),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => eventSubscription.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull(),
    delivery: text("delivery").notNull(),
    minSeverity: text("min_severity"),
    spec: specCol<EventSubscriptionChannelSpec>(),
    lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("org_esch_sub_idx").on(t.subscriptionId),
    index("org_esch_channel_idx").on(t.channelId),
    index("org_esch_delivery_idx").on(t.delivery),
  ]
)

// ─── Event Delivery ─────────────────────────────────────────────
// Tracks delivery status for each event × subscription channel combination.

export const eventDelivery = orgSchema.table(
  "event_delivery",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("edlv")),
    eventId: text("event_id").notNull(),
    subscriptionChannelId: text("subscription_channel_id").notNull(),
    status: text("status").notNull().default("pending"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    spec: jsonb("spec").$type<{
      error?: string
      retryCount?: number
      renderOutput?: unknown
      directNotification?: boolean
      recipientPrincipalId?: string
    }>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("org_edlv_status_idx")
      .on(t.status)
      .where(sql`${t.status} IN ('pending', 'buffered')`),
    index("org_edlv_event_idx").on(t.eventId),
    index("org_edlv_channel_idx").on(t.subscriptionChannelId),
  ]
)

// ─── Event Aggregate ────────────────────────────────────────────
// Collects events during storm conditions into summary records.

export const eventAggregate = orgSchema.table(
  "event_aggregate",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("eagg")),
    correlationId: text("correlation_id"),
    topicPrefix: text("topic_prefix").notNull(),
    scopeId: text("scope_id"),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }),
    eventCount: bigint("event_count", { mode: "number" }).notNull().default(0),
    sampleEventId: text("sample_event_id"),
    maxSeverity: text("max_severity").notNull().default("info"),
    status: text("status").notNull().default("open"),
    spec: jsonb("spec").$type<{
      summary?: string
      eventIds?: string[]
    }>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("org_eagg_status_idx")
      .on(t.status)
      .where(sql`${t.status} = 'open'`),
    index("org_eagg_topic_scope_idx").on(t.topicPrefix, t.scopeId),
  ]
)

// ─── Event Alert ────────────────────────────────────────────────
// Tracks acknowledgment and escalation for warning+ severity events.

export const eventAlert = orgSchema.table(
  "event_alert",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("ealt")),
    eventId: text("event_id"),
    aggregateId: text("aggregate_id"),
    subscriptionId: text("subscription_id").notNull(),
    severity: text("severity").notNull(),
    status: text("status").notNull().default("firing"),
    acknowledgedBy: text("acknowledged_by"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    escalationStep: bigint("escalation_step", { mode: "number" })
      .notNull()
      .default(0),
    nextEscalation: timestamp("next_escalation", { withTimezone: true }),
    spec: jsonb("spec").$type<{
      escalationPolicy?: unknown
      notificationHistory?: Array<{ channel: string; deliveredAt: string }>
    }>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("org_ealt_status_idx")
      .on(t.status)
      .where(sql`${t.status} IN ('firing', 'escalated')`),
    index("org_ealt_escalation_idx")
      .on(t.nextEscalation)
      .where(sql`${t.status} IN ('firing', 'escalated')`),
  ]
)

// ─── Document ─────────────────────────────────────────────────
// Generic document store: plans, PRDs, HLDs, LLDs, ADRs, decks, etc.
// Content lives on filesystem; this table holds metadata + pointers.

export const document = orgSchema.table(
  "document",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("doc")),
    slug: text("slug").notNull(),
    title: text("title"),
    type: text("type").notNull(),
    source: text("source"),
    contentPath: text("content_path"),
    contentHash: text("content_hash"),
    sizeBytes: integer("size_bytes"),
    threadId: text("thread_id").references(() => thread.id, {
      onDelete: "set null",
    }),
    channelId: text("channel_id").references(() => channel.id, {
      onDelete: "set null",
    }),
    spec: specCol<DocumentSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("org_document_slug_unique").on(t.slug),
    index("org_document_type_idx").on(t.type),
    index("org_document_source_idx").on(t.source),
    index("org_document_thread_idx").on(t.threadId),
  ]
)

export const documentVersion = orgSchema.table(
  "document_version",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("docv")),
    documentId: text("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    contentPath: text("content_path").notNull(),
    contentHash: text("content_hash"),
    sizeBytes: integer("size_bytes"),
    source: text("source"),
    threadId: text("thread_id").references(() => thread.id, {
      onDelete: "set null",
    }),
    sourceTurnId: text("source_turn_id").references(() => threadTurn.id, {
      onDelete: "set null",
    }),
    sourceMessageId: text("source_message_id").references(() => message.id, {
      onDelete: "set null",
    }),
    sourceToolCallId: text("source_tool_call_id").references(
      () => toolCall.id,
      {
        onDelete: "set null",
      }
    ),
    spec: specCol<DocumentVersionSpec>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("org_docver_doc_version_unique").on(t.documentId, t.version),
    index("org_docver_document_idx").on(t.documentId),
    index("org_docver_source_turn_idx").on(t.sourceTurnId),
    index("org_docver_source_message_idx").on(t.sourceMessageId),
    index("org_docver_source_tool_call_idx").on(t.sourceToolCallId),
  ]
)

// ─── Idempotency Key (platform infrastructure) ──────────────

export const idempotencyKey = orgSchema.table(
  "idempotency_key",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("idk")),
    key: text("key").notNull(),
    userId: text("user_id").notNull().default("anonymous"),
    requestMethod: text("request_method").notNull(),
    requestPath: text("request_path").notNull(),
    requestBody: jsonb("request_body")
      .notNull()
      .default(sql`'{}'`),
    responseCode: integer("response_code"),
    responseBody: jsonb("response_body"),
    lockedAt: timestamp("locked_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("org_idempotency_key_user_key").on(t.userId, t.key),
    index("org_idempotency_key_expires_idx").on(t.expiresAt),
  ]
)
