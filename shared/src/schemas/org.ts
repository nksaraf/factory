/**
 * Zod schemas for the `org` schema — "Who & What Actors"
 * Single source of truth. TS types derived via z.infer<>.
 */

import { z } from "zod";
import { BitemporalSchema, EntityMetadataSchema } from "./common";

// ── Team ────────────────────────────────────────────────────

export const TeamTypeSchema = z.enum(["team", "business-unit", "product-area"]);
export type TeamType = z.infer<typeof TeamTypeSchema>;

export const TeamSpecSchema = z.object({
  description: z.string().optional(),
  slackChannel: z.string().optional(),
  oncallUrl: z.string().optional(),
});
export type TeamSpec = z.infer<typeof TeamSpecSchema>;

export const TeamSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  type: TeamTypeSchema.default("team"),
  parentTeamId: z.string().nullable(),
  spec: TeamSpecSchema,
  metadata: EntityMetadataSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
}).merge(BitemporalSchema);
export type Team = z.infer<typeof TeamSchema>;

// ── Principal ───────────────────────────────────────────────

export const PrincipalTypeSchema = z.enum(["human", "agent", "service-account"]);
export type PrincipalType = z.infer<typeof PrincipalTypeSchema>;

export const PrincipalSpecSchema = z.object({
  authUserId: z.string().optional(),
  avatarUrl: z.string().optional(),
  email: z.string().email().optional(),
  displayName: z.string().optional(),
  status: z.enum(["active", "inactive", "deactivated"]).optional(),
});
export type PrincipalSpec = z.infer<typeof PrincipalSpecSchema>;

export const PrincipalSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  type: PrincipalTypeSchema,
  primaryTeamId: z.string().nullable(),
  spec: PrincipalSpecSchema,
  metadata: EntityMetadataSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
}).merge(BitemporalSchema);
export type Principal = z.infer<typeof PrincipalSchema>;

// ── Membership ──────────────────────────────────────────────

export const MembershipRoleSchema = z.enum(["member", "lead", "admin"]);
export type MembershipRole = z.infer<typeof MembershipRoleSchema>;

export const MembershipSpecSchema = z.object({
  role: MembershipRoleSchema.default("member"),
});
export type MembershipSpec = z.infer<typeof MembershipSpecSchema>;

export const MembershipSchema = z.object({
  id: z.string(),
  principalId: z.string(),
  teamId: z.string(),
  spec: MembershipSpecSchema,
  createdAt: z.coerce.date(),
});
export type Membership = z.infer<typeof MembershipSchema>;

// ── Scope ───────────────────────────────────────────────────

export const ScopeTypeSchema = z.enum(["team", "resource", "custom"]);
export type ScopeType = z.infer<typeof ScopeTypeSchema>;

export const ScopeSpecSchema = z.object({
  description: z.string().optional(),
  permissions: z.array(z.string()).default([]),
});
export type ScopeSpec = z.infer<typeof ScopeSpecSchema>;

export const ScopeSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  type: ScopeTypeSchema,
  teamId: z.string().nullable(),
  spec: ScopeSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Scope = z.infer<typeof ScopeSchema>;

// ── Identity Link ───────────────────────────────────────────

export const IdentityProviderSchema = z.enum([
  "github",
  "google",
  "slack",
  "jira",
  "claude",
  "cursor",
]);
export type IdentityProvider = z.infer<typeof IdentityProviderSchema>;

export const IdentityLinkSpecSchema = z.object({
  externalUsername: z.string().optional(),
  accessToken: z.string().optional(), // encrypted at rest
  refreshToken: z.string().optional(), // encrypted at rest
  expiresAt: z.coerce.date().optional(),
  scopes: z.array(z.string()).optional(),
  profileData: z.record(z.string()).optional(),
  email: z.string().optional(),
  syncStatus: z.enum(["idle", "syncing", "error"]).optional(),
  lastSyncAt: z.coerce.date().optional(),
  syncError: z.string().optional(),
});
export type IdentityLinkSpec = z.infer<typeof IdentityLinkSpecSchema>;

export const IdentityLinkSchema = z.object({
  id: z.string(),
  type: IdentityProviderSchema,
  principalId: z.string(),
  externalId: z.string(),
  spec: IdentityLinkSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type IdentityLink = z.infer<typeof IdentityLinkSchema>;

// ── Agent ───────────────────────────────────────────────────

export const AgentTypeSchema = z.enum([
  "engineering",
  "qa",
  "product",
  "security",
  "ops",
  "external-mcp",
]);
export type AgentType = z.infer<typeof AgentTypeSchema>;

export const AutonomyLevelSchema = z.enum([
  "observer",
  "advisor",
  "executor",
  "operator",
  "supervisor",
]);
export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;

export const RelationshipSchema = z.enum(["personal", "team", "org"]);
export type Relationship = z.infer<typeof RelationshipSchema>;

export const CollaborationModeSchema = z.enum([
  "solo",
  "pair",
  "crew",
  "hierarchy",
]);
export type CollaborationMode = z.infer<typeof CollaborationModeSchema>;

export const AgentSpecSchema = z.object({
  autonomyLevel: AutonomyLevelSchema.default("advisor"),
  relationship: RelationshipSchema.default("team"),
  collaborationMode: CollaborationModeSchema.default("solo"),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
  capabilities: z.record(z.boolean()).default({}),
  config: z.record(z.string()).default({}),
  guardrails: z.object({
    maxTokensPerRequest: z.number().int().optional(),
    allowedTools: z.array(z.string()).optional(),
    blockedTools: z.array(z.string()).optional(),
    requireApprovalFor: z.array(z.string()).optional(),
  }).default({}),
});
export type AgentSpec = z.infer<typeof AgentSpecSchema>;

export const AgentSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  type: AgentTypeSchema,
  principalId: z.string(),
  reportsToAgentId: z.string().nullable(),
  status: z.enum(["active", "disabled"]).default("active"),
  spec: AgentSpecSchema,
  metadata: EntityMetadataSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Agent = z.infer<typeof AgentSchema>;

// ── Role Preset ─────────────────────────────────────────────

export const RolePresetSpecSchema = z.object({
  description: z.string().optional(),
  defaults: z.object({
    autonomyLevel: AutonomyLevelSchema.optional(),
    relationship: RelationshipSchema.optional(),
    collaborationMode: CollaborationModeSchema.optional(),
    systemPrompt: z.string().optional(),
    capabilities: z.record(z.boolean()).optional(),
    guardrails: z.record(z.unknown()).optional(),
  }).default({}),
});
export type RolePresetSpec = z.infer<typeof RolePresetSpecSchema>;

export const RolePresetSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  orgId: z.string().nullable(),
  spec: RolePresetSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type RolePreset = z.infer<typeof RolePresetSchema>;

// ── Job ─────────────────────────────────────────────────────

export const JobModeSchema = z.enum([
  "conversational",
  "autonomous",
  "observation",
]);
export type JobMode = z.infer<typeof JobModeSchema>;

export const JobTriggerSchema = z.enum([
  "mention",
  "event",
  "schedule",
  "delegation",
  "manual",
]);
export type JobTrigger = z.infer<typeof JobTriggerSchema>;

export const JobStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobSpecSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  outcome: z.record(z.unknown()).optional(),
  cost: z.object({
    inputTokens: z.number().int().default(0),
    outputTokens: z.number().int().default(0),
    costMicrodollars: z.number().int().default(0),
  }).optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type JobSpec = z.infer<typeof JobSpecSchema>;

export const JobSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  delegatedByAgentId: z.string().nullable(),
  parentJobId: z.string().nullable(),
  status: JobStatusSchema.default("pending"),
  mode: JobModeSchema.default("conversational"),
  trigger: JobTriggerSchema.default("manual"),
  spec: JobSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Job = z.infer<typeof JobSchema>;

// ── Memory ──────────────────────────────────────────────────

export const MemoryTypeSchema = z.enum([
  "fact",
  "preference",
  "decision",
  "pattern",
  "relationship",
  "signal",
]);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

export const MemoryLayerSchema = z.enum(["session", "team", "org"]);
export type MemoryLayer = z.infer<typeof MemoryLayerSchema>;

export const MemorySpecSchema = z.object({
  content: z.string(),
  confidence: z.number().min(0).max(1).default(0.5),
  source: z.string().optional(),
  embedding: z.array(z.number()).optional(),
  supersededById: z.string().optional(),
});
export type MemorySpec = z.infer<typeof MemorySpecSchema>;

export const MemorySchema = z.object({
  id: z.string(),
  type: MemoryTypeSchema,
  layer: MemoryLayerSchema.default("session"),
  status: z.enum(["proposed", "approved", "superseded", "archived"]).default("proposed"),
  sourceAgentId: z.string().nullable(),
  approvedByPrincipalId: z.string().nullable(),
  spec: MemorySpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Memory = z.infer<typeof MemorySchema>;

// ── Tool Credential ─────────────────────────────────────────

export const ToolCredentialSpecSchema = z.object({
  provider: z.string(),
  encryptedKey: z.string(),
  label: z.string().optional(),
  lastUsedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
});
export type ToolCredentialSpec = z.infer<typeof ToolCredentialSpecSchema>;

export const ToolCredentialSchema = z.object({
  id: z.string(),
  principalId: z.string(),
  spec: ToolCredentialSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ToolCredential = z.infer<typeof ToolCredentialSchema>;

// ── Tool Usage ──────────────────────────────────────────────

export const ToolUsageSpecSchema = z.object({
  inputTokens: z.number().int().default(0),
  outputTokens: z.number().int().default(0),
  cacheReadTokens: z.number().int().default(0),
  model: z.string().optional(),
  provider: z.string().optional(),
});
export type ToolUsageSpec = z.infer<typeof ToolUsageSpecSchema>;

export const ToolUsageSchema = z.object({
  id: z.string(),
  principalId: z.string(),
  tool: z.string(),
  costMicrodollars: z.number().int().default(0),
  spec: ToolUsageSpecSchema,
  createdAt: z.coerce.date(),
});
export type ToolUsage = z.infer<typeof ToolUsageSchema>;

// ── Messaging Provider ──────────────────────────────────────

export const MessagingProviderTypeSchema = z.enum([
  "slack",
  "teams",
  "google-chat",
]);
export type MessagingProviderType = z.infer<typeof MessagingProviderTypeSchema>;

export const MessagingProviderSpecSchema = z.object({
  webhookUrl: z.string().optional(),
  botToken: z.string().optional(), // encrypted at rest
  workspaceId: z.string().optional(), // Slack workspace ID
  tenantId: z.string().optional(), // Teams tenant ID
  status: z.enum(["active", "inactive", "error"]).default("active"),
});
export type MessagingProviderSpec = z.infer<typeof MessagingProviderSpecSchema>;

export const MessagingProviderSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  type: MessagingProviderTypeSchema,
  teamId: z.string(),
  spec: MessagingProviderSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type MessagingProvider = z.infer<typeof MessagingProviderSchema>;

// ── SSH Key ─────────────────────────────────────────────────

export const SshKeyTypeSchema = z.enum(["ed25519", "rsa", "ecdsa"]);
export type SshKeyType = z.infer<typeof SshKeyTypeSchema>;

export const SshKeySpecSchema = z.object({
  publicKey: z.string(),
  comment: z.string().optional(),
  revokedAt: z.coerce.date().optional(),
});
export type SshKeySpec = z.infer<typeof SshKeySpecSchema>;

export const SshKeySchema = z.object({
  id: z.string(),
  type: SshKeyTypeSchema,
  principalId: z.string(),
  fingerprint: z.string(),
  spec: SshKeySpecSchema,
  createdAt: z.coerce.date(),
});
export type SshKey = z.infer<typeof SshKeySchema>;

// ── Input Schemas (CREATE / UPDATE) ────────────────────────

export const CreateTeamSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: TeamTypeSchema.optional(),
  parentTeamId: z.string().optional(),
  spec: TeamSpecSchema.default({}),
});
export const UpdateTeamSchema = CreateTeamSchema.partial();

export const CreatePrincipalSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: PrincipalTypeSchema,
  primaryTeamId: z.string().optional(),
  spec: PrincipalSpecSchema.default({}),
});
export const UpdatePrincipalSchema = CreatePrincipalSchema.partial();

export const CreateAgentSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: AgentTypeSchema,
  principalId: z.string(),
  reportsToAgentId: z.string().optional(),
  spec: AgentSpecSchema.default({}),
});
export const UpdateAgentSchema = CreateAgentSchema.partial();

export const CreateRolePresetSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  orgId: z.string().optional(),
  spec: RolePresetSpecSchema.default({}),
});
export const UpdateRolePresetSchema = CreateRolePresetSchema.partial();

export const CreateScopeSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: ScopeTypeSchema,
  teamId: z.string().optional(),
  spec: ScopeSpecSchema.default({}),
});
export const UpdateScopeSchema = CreateScopeSchema.partial();

export const CreateMessagingProviderSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: MessagingProviderTypeSchema,
  teamId: z.string(),
  spec: MessagingProviderSpecSchema.default({}),
});
export const UpdateMessagingProviderSchema = CreateMessagingProviderSchema.partial();

// ── Config Var (plain-text) ──────────────────────────────────

export const ConfigVarScopeTypeSchema = z.enum(["org", "team", "principal", "system"]);
export type ConfigVarScopeType = z.infer<typeof ConfigVarScopeTypeSchema>;

export const ConfigVarSpecSchema = z.object({
  description: z.string().optional(),
  sensitive: z.boolean().default(false),
});
export type ConfigVarSpec = z.infer<typeof ConfigVarSpecSchema>;

export const ConfigVarSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  scopeType: ConfigVarScopeTypeSchema,
  scopeId: z.string(),
  environment: z.string().default("all"),
  value: z.string(),
  spec: ConfigVarSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ConfigVar = z.infer<typeof ConfigVarSchema>;

export const CreateConfigVarSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  scopeType: ConfigVarScopeTypeSchema,
  scopeId: z.string(),
  environment: z.string().default("all"),
  value: z.string(),
  spec: ConfigVarSpecSchema.default({}),
});
export const UpdateConfigVarSchema = CreateConfigVarSchema.partial();

// ── Org Secret (envelope-encrypted) ─────────────────────────

export const OrgSecretScopeTypeSchema = z.enum(["org", "team", "principal", "system"]);
export type OrgSecretScopeType = z.infer<typeof OrgSecretScopeTypeSchema>;

export const OrgSecretSpecSchema = z.object({
  description: z.string().optional(),
  rotationPolicy: z.enum(["manual", "30d", "90d", "365d"]).default("manual"),
  lastRotatedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
});
export type OrgSecretSpec = z.infer<typeof OrgSecretSpecSchema>;

export const OrgSecretSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  scopeType: OrgSecretScopeTypeSchema,
  scopeId: z.string(),
  environment: z.string().default("all"),
  keyVersion: z.number().int().default(1),
  createdBy: z.string().nullable(),
  spec: OrgSecretSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type OrgSecret = z.infer<typeof OrgSecretSchema>;

export const CreateOrgSecretSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  scopeType: OrgSecretScopeTypeSchema,
  scopeId: z.string(),
  environment: z.string().default("all"),
  value: z.string().min(1),
  spec: OrgSecretSpecSchema.default({}),
});
export const UpdateOrgSecretSchema = CreateOrgSecretSchema.partial();
