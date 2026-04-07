import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { newId } from "../../lib/id";
import { messageThread, orgPrincipal } from "./org";

export const factoryAgent = pgSchema("factory_agent");

// ─── Role Preset ────────────────────────────────────────────
// Named convenience configurations for agents. Platform provides
// defaults (orgId=null); orgs can create custom presets.

export const rolePreset = factoryAgent.table(
  "role_preset",
  {
    rolePresetId: text("role_preset_id")
      .primaryKey()
      .$defaultFn(() => newId("rpre")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    orgId: text("org_id"),
    description: text("description"),
    defaults: jsonb("defaults").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("role_preset_slug_unique").on(t.slug),
    index("role_preset_org_idx").on(t.orgId),
  ]
);

// ─── Agent ──────────────────────────────────────────────────
// Persistent identity for an AI actor in the org. Configured
// along dimensions (autonomy, relationship, collaboration)
// rather than a flat type enum.

export const agent = factoryAgent.table(
  "agent",
  {
    agentId: text("agent_id")
      .primaryKey()
      .$defaultFn(() => newId("agt")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    // Deprecated: use rolePresetSlug instead
    agentType: text("agent_type").notNull(),
    principalId: text("principal_id").references(
      () => orgPrincipal.principalId,
      { onDelete: "set null" }
    ),
    status: text("status").notNull().default("active"),
    capabilities: jsonb("capabilities").notNull().default({}),

    // ── New dimensions ──
    rolePresetSlug: text("role_preset_slug"),
    autonomyLevel: text("autonomy_level").notNull().default("executor"),
    relationship: text("relationship").notNull().default("team"),
    relationshipEntityId: text("relationship_entity_id"),
    collaborationMode: text("collaboration_mode").notNull().default("solo"),
    reportsToAgentId: text("reports_to_agent_id"),
    config: jsonb("config").notNull().default({}),
    trustScore: real("trust_score").notNull().default(0.5),
    guardrails: jsonb("guardrails").notNull().default({}),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("agent_name_unique").on(t.name),
    uniqueIndex("agent_slug_unique").on(t.slug),
    index("agent_preset_idx").on(t.rolePresetSlug),
    index("agent_relationship_idx").on(t.relationship, t.relationshipEntityId),
    index("agent_reports_to_idx").on(t.reportsToAgentId),
    check(
      "agent_type_valid",
      sql`${t.agentType} IN ('engineering', 'qa', 'product', 'security', 'ops', 'external-mcp')`
    ),
    check(
      "agent_status_valid",
      sql`${t.status} IN ('active', 'disabled')`
    ),
    check(
      "agent_autonomy_level_valid",
      sql`${t.autonomyLevel} IN ('observer', 'advisor', 'executor', 'operator', 'supervisor')`
    ),
    check(
      "agent_relationship_valid",
      sql`${t.relationship} IN ('personal', 'team', 'org')`
    ),
    check(
      "agent_collaboration_mode_valid",
      sql`${t.collaborationMode} IN ('solo', 'pair', 'crew', 'hierarchy')`
    ),
  ]
);

// ─── Agent Execution (deprecated) ───────────────────────────
// Kept for backward compatibility. New code should use the job table.

export const agentExecution = factoryAgent.table(
  "agent_execution",
  {
    executionId: text("execution_id")
      .primaryKey()
      .$defaultFn(() => newId("aex")),
    agentId: text("agent_id")
      .notNull()
      .references(() => agent.agentId, { onDelete: "cascade" }),
    task: text("task").notNull(),
    status: text("status").notNull().default("pending"),
    costCents: integer("cost_cents"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "agent_execution_status_valid",
      sql`${t.status} IN ('pending', 'running', 'succeeded', 'failed')`
    ),
  ]
);

// ─── Job ────────────────────────────────────────────────────
// A unit of work an agent performs: conversation, bug fix,
// code review, observation, standup collection, etc.

export const job = factoryAgent.table(
  "job",
  {
    jobId: text("job_id")
      .primaryKey()
      .$defaultFn(() => newId("job")),
    agentId: text("agent_id")
      .notNull()
      .references(() => agent.agentId, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    trigger: text("trigger").notNull(),

    // What it's working on
    entityKind: text("entity_kind"),
    entityId: text("entity_id"),

    // Where the interaction happens
    channelKind: text("channel_kind"),
    channelId: text("channel_id"),
    messageThreadId: text("message_thread_id").references(
      () => messageThread.messageThreadId,
      { onDelete: "set null" }
    ),

    // Delegation
    parentJobId: text("parent_job_id"),
    delegatedByAgentId: text("delegated_by_agent_id").references(
      () => agent.agentId,
      { onDelete: "set null" }
    ),

    // Execution
    status: text("status").notNull().default("pending"),
    task: text("task").notNull(),
    outcome: jsonb("outcome"),
    costCents: integer("cost_cents"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    // Audit
    humanOverride: boolean("human_override").notNull().default(false),
    overrideNote: text("override_note"),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (t) => [
    index("job_agent_idx").on(t.agentId),
    index("job_status_idx").on(t.status),
    index("job_entity_idx").on(t.entityKind, t.entityId),
    index("job_parent_idx").on(t.parentJobId),
    index("job_message_thread_idx").on(t.messageThreadId),
    check(
      "job_mode_valid",
      sql`${t.mode} IN ('conversational', 'autonomous', 'observation')`
    ),
    check(
      "job_trigger_valid",
      sql`${t.trigger} IN ('mention', 'event', 'schedule', 'delegation', 'manual')`
    ),
    check(
      "job_status_valid",
      sql`${t.status} IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')`
    ),
    check(
      "job_channel_kind_valid",
      sql`${t.channelKind} IS NULL OR ${t.channelKind} IN ('slack', 'cli', 'web', 'internal')`
    ),
  ]
);
