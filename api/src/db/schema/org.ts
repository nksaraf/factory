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

export const factoryOrg = pgSchema("factory_org");

// ─── Team ────────────────────────────────────────────────────
// Hierarchical org unit. Serves as catalog Group entity.
// Team hierarchy maps to authorization scopes.

export const orgTeam = factoryOrg.table(
  "team",
  {
    teamId: text("team_id")
      .primaryKey()
      .$defaultFn(() => newId("team")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    type: text("type").notNull().default("team"),
    parentTeamId: text("parent_team_id"),
    description: text("description"),
    profile: jsonb("profile").notNull().default({}),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("org_team_slug_unique").on(t.slug),
    uniqueIndex("org_team_name_unique").on(t.name),
    index("org_team_parent_idx").on(t.parentTeamId),
    check(
      "org_team_type_valid",
      sql`${t.type} IN ('team', 'business-unit', 'product-area')`
    ),
  ]
);

// ─── Principal ───────────────────────────────────────────────
// Unifies all actors: human users, agents, service accounts.
// Serves as catalog User entity.

export const orgPrincipal = factoryOrg.table(
  "principal",
  {
    principalId: text("principal_id")
      .primaryKey()
      .$defaultFn(() => newId("prin")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    type: text("type").notNull(),
    authUserId: text("auth_user_id"),
    agentId: text("agent_id"),
    teamId: text("team_id").references(() => orgTeam.teamId, {
      onDelete: "set null",
    }),
    email: text("email"),
    profile: jsonb("profile").notNull().default({}),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("org_principal_slug_unique").on(t.slug),
    index("org_principal_auth_user_idx").on(t.authUserId),
    index("org_principal_agent_idx").on(t.agentId),
    index("org_principal_team_idx").on(t.teamId),
    check(
      "org_principal_type_valid",
      sql`${t.type} IN ('user', 'agent', 'service_account')`
    ),
    check(
      "org_principal_status_valid",
      sql`${t.status} IN ('active', 'suspended', 'deactivated')`
    ),
  ]
);

// ─── Principal Team Membership ───────────────────────────────
// Multi-team membership (primary team is on principal row).

export const orgPrincipalTeamMembership = factoryOrg.table(
  "principal_team_membership",
  {
    membershipId: text("membership_id")
      .primaryKey()
      .$defaultFn(() => newId("ptm")),
    principalId: text("principal_id")
      .notNull()
      .references(() => orgPrincipal.principalId, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => orgTeam.teamId, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("org_membership_unique").on(t.principalId, t.teamId),
    index("org_membership_team_idx").on(t.teamId),
    check(
      "org_membership_role_valid",
      sql`${t.role} IN ('member', 'lead', 'admin')`
    ),
  ]
);

// ─── Scope ───────────────────────────────────────────────────
// Authorization scopes. Teams auto-create scopes, but scopes
// can also exist per-resource independently.

export const orgScope = factoryOrg.table(
  "scope",
  {
    scopeId: text("scope_id")
      .primaryKey()
      .$defaultFn(() => newId("scope")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    type: text("type").notNull(),
    parentScopeId: text("parent_scope_id"),
    teamId: text("team_id").references(() => orgTeam.teamId, {
      onDelete: "cascade",
    }),
    resourceKind: text("resource_kind"),
    resourceId: text("resource_id"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("org_scope_slug_unique").on(t.slug),
    index("org_scope_parent_idx").on(t.parentScopeId),
    index("org_scope_team_idx").on(t.teamId),
    index("org_scope_resource_idx").on(t.resourceKind, t.resourceId),
    check(
      "org_scope_type_valid",
      sql`${t.type} IN ('team', 'resource', 'custom')`
    ),
  ]
);

// ─── Identity Link ──────────────────────────────────────────
// Unified multi-provider identity linking. Generalizes git_user_sync
// to support GitHub, Google, Slack, Jira, Claude, Cursor, etc.

export const identityLink = factoryOrg.table(
  "identity_link",
  {
    identityLinkId: text("identity_link_id")
      .primaryKey()
      .$defaultFn(() => newId("idlk")),
    principalId: text("principal_id")
      .notNull()
      .references(() => orgPrincipal.principalId, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalUserId: text("external_user_id").notNull(),
    externalLogin: text("external_login"),
    email: text("email"),
    authUserId: text("auth_user_id"),
    profileData: jsonb("profile_data").notNull().default({}),
    tokenEnc: text("token_enc"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: text("scopes").array(),
    syncStatus: text("sync_status").notNull().default("idle"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    syncError: text("sync_error"),
    linkedAt: timestamp("linked_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("org_identity_link_provider_external_unique").on(
      t.provider,
      t.externalUserId
    ),
    uniqueIndex("org_identity_link_principal_provider_unique").on(
      t.principalId,
      t.provider
    ),
    index("org_identity_link_principal_idx").on(t.principalId),
    index("org_identity_link_email_idx").on(t.email),
    check(
      "org_identity_link_provider_valid",
      sql`${t.provider} IN ('github', 'google', 'slack', 'jira', 'claude', 'cursor')`
    ),
    check(
      "org_identity_link_sync_status_valid",
      sql`${t.syncStatus} IN ('idle', 'syncing', 'error')`
    ),
  ]
);

// ─── Tool Credential ────────────────────────────────────────
// API keys / credentials for developer tools (Claude, Cursor, etc.)

export const toolCredential = factoryOrg.table(
  "tool_credential",
  {
    toolCredentialId: text("tool_credential_id")
      .primaryKey()
      .$defaultFn(() => newId("tcred")),
    principalId: text("principal_id")
      .notNull()
      .references(() => orgPrincipal.principalId, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    keyName: text("key_name").notNull(),
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("org_tool_credential_unique").on(
      t.principalId,
      t.provider,
      t.keyName
    ),
    check(
      "org_tool_credential_status_valid",
      sql`${t.status} IN ('active', 'revoked')`
    ),
  ]
);

// ─── Tool Usage ─────────────────────────────────────────────
// Usage tracking for any tool by any principal.

export const toolUsage = factoryOrg.table(
  "tool_usage",
  {
    usageId: text("usage_id")
      .primaryKey()
      .$defaultFn(() => newId("tusg")),
    principalId: text("principal_id")
      .notNull()
      .references(() => orgPrincipal.principalId, { onDelete: "cascade" }),
    tool: text("tool").notNull(),
    sessionId: text("session_id"),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").default(0),
    costMicrodollars: integer("cost_microdollars").notNull().default(0),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (t) => [
    index("org_tool_usage_principal_recorded_idx").on(
      t.principalId,
      t.recordedAt
    ),
    index("org_tool_usage_tool_recorded_idx").on(t.tool, t.recordedAt),
  ]
);

// ─── Messaging Provider ─────────────────────────────────────
// Connected messaging workspaces (Slack, Teams, Google Chat).

export const messagingProvider = factoryOrg.table(
  "messaging_provider",
  {
    messagingProviderId: text("messaging_provider_id")
      .primaryKey()
      .$defaultFn(() => newId("msgp")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind").notNull(),
    teamId: text("team_id")
      .notNull()
      .references(() => orgTeam.teamId),
    workspaceExternalId: text("workspace_external_id"),
    botTokenEnc: text("bot_token_enc"),
    signingSecret: text("signing_secret"),
    status: text("status").notNull().default("active"),
    syncStatus: text("sync_status").notNull().default("idle"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    syncError: text("sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("org_messaging_provider_slug_unique").on(t.slug),
    index("org_messaging_provider_team_idx").on(t.teamId),
    check(
      "org_messaging_provider_kind_valid",
      sql`${t.kind} IN ('slack', 'teams', 'google-chat')`
    ),
    check(
      "org_messaging_provider_status_valid",
      sql`${t.status} IN ('active', 'inactive', 'error')`
    ),
    check(
      "org_messaging_provider_sync_status_valid",
      sql`${t.syncStatus} IN ('idle', 'syncing', 'error')`
    ),
  ]
);

// ─── Channel Mapping ────────────────────────────────────────
// Links messaging channels to Factory entities (module, team, domain).

export const channelMapping = factoryOrg.table(
  "channel_mapping",
  {
    channelMappingId: text("channel_mapping_id")
      .primaryKey()
      .$defaultFn(() => newId("chm")),
    messagingProviderId: text("messaging_provider_id")
      .notNull()
      .references(() => messagingProvider.messagingProviderId, {
        onDelete: "cascade",
      }),
    externalChannelId: text("external_channel_id").notNull(),
    externalChannelName: text("external_channel_name"),
    entityKind: text("entity_kind").notNull(),
    entityId: text("entity_id").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("org_channel_mapping_provider_channel_unique").on(
      t.messagingProviderId,
      t.externalChannelId
    ),
    index("org_channel_mapping_entity_idx").on(t.entityKind, t.entityId),
    check(
      "org_channel_mapping_entity_kind_valid",
      sql`${t.entityKind} IN ('module', 'team', 'domain')`
    ),
  ]
);

// ─── Message Thread ─────────────────────────────────────────
// Persisted agent interaction threads for audit and agent memory.

export const messageThread = factoryOrg.table(
  "message_thread",
  {
    messageThreadId: text("message_thread_id")
      .primaryKey()
      .$defaultFn(() => newId("mthr")),
    messagingProviderId: text("messaging_provider_id")
      .notNull()
      .references(() => messagingProvider.messagingProviderId, {
        onDelete: "cascade",
      }),
    externalChannelId: text("external_channel_id").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    initiatorPrincipalId: text("initiator_principal_id").references(
      () => orgPrincipal.principalId,
      { onDelete: "set null" }
    ),
    subject: text("subject"),
    status: text("status").notNull().default("active"),
    messages: jsonb("messages").notNull().default([]),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("org_message_thread_provider_thread_unique").on(
      t.messagingProviderId,
      t.externalThreadId
    ),
    index("org_message_thread_channel_idx").on(
      t.messagingProviderId,
      t.externalChannelId
    ),
    index("org_message_thread_initiator_idx").on(t.initiatorPrincipalId),
    check(
      "org_message_thread_status_valid",
      sql`${t.status} IN ('active', 'resolved', 'archived')`
    ),
  ]
);

// ─── Secret ──────────────────────────────────────────────────
// Encrypted env-var secrets scoped to org / team / project / environment.
// Vercel-style hierarchy: org < team < project, with optional environment overlay.

export const orgSecret = factoryOrg.table(
  "secret",
  {
    secretId: text("secret_id")
      .primaryKey()
      .$defaultFn(() => newId("sec")),
    key: text("key").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id"),
    environment: text("environment"),
    createdBy: text("created_by").references(() => orgPrincipal.principalId, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("org_secret_key_scope_env_unique").on(
      t.key,
      t.scopeType,
      t.scopeId,
      t.environment,
    ),
    index("org_secret_scope_idx").on(t.scopeType, t.scopeId),
    index("org_secret_environment_idx").on(t.environment),
    check(
      "org_secret_scope_type_valid",
      sql`${t.scopeType} IN ('org', 'team', 'project', 'environment')`,
    ),
    check(
      "org_secret_environment_valid",
      sql`${t.environment} IS NULL OR ${t.environment} IN ('production', 'development', 'preview')`,
    ),
  ],
);

// ─── Memory ────────────────────────────────────────────────
// Layered knowledge system for agents. v1: CRUD management only.
// Layers: session (per-job), team (shared), org (company-wide).

export const memory = factoryOrg.table(
  "memory",
  {
    memoryId: text("memory_id")
      .primaryKey()
      .$defaultFn(() => newId("mem")),
    orgId: text("org_id").notNull(),

    // Layer
    layer: text("layer").notNull(),
    layerEntityId: text("layer_entity_id").notNull(),

    // Content
    type: text("type").notNull(),
    content: text("content").notNull(),
    embedding: text("embedding"),
    tags: jsonb("tags").notNull().default([]),

    // Provenance
    sourceJobId: text("source_job_id"),
    sourceAgentId: text("source_agent_id"),
    promotedFromId: text("promoted_from_id"),

    // Lifecycle
    status: text("status").notNull().default("active"),
    confidence: real("confidence").notNull().default(1.0),
    approvedByPrincipalId: text("approved_by_principal_id").references(
      () => orgPrincipal.principalId,
      { onDelete: "set null" }
    ),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    accessCount: integer("access_count").notNull().default(0),
    supersededById: text("superseded_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("memory_org_layer_idx").on(t.orgId, t.layer),
    index("memory_layer_entity_idx").on(t.layer, t.layerEntityId),
    index("memory_status_idx").on(t.status),
    index("memory_source_job_idx").on(t.sourceJobId),
    index("memory_source_agent_idx").on(t.sourceAgentId),
    check(
      "memory_layer_valid",
      sql`${t.layer} IN ('session', 'team', 'org')`
    ),
    check(
      "memory_type_valid",
      sql`${t.type} IN ('fact', 'preference', 'decision', 'pattern', 'relationship', 'signal')`
    ),
    check(
      "memory_status_valid",
      sql`${t.status} IN ('proposed', 'active', 'archived', 'superseded')`
    ),
  ]
);
