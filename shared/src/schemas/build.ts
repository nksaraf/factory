/**
 * Zod schemas for the `build` schema — "How It's Built"
 * Single source of truth. TS types derived via z.infer<>.
 */

import { z } from "zod";
import { BitemporalSchema } from "./common";

// ── Repo ────────────────────────────────────────────────────

export const RepoKindSchema = z.enum([
  "product-module",
  "platform-module",
  "library",
  "vendor-module",
  "client-project",
  "infra",
  "docs",
  "tool",
]);
export type RepoKind = z.infer<typeof RepoKindSchema>;

export const RepoSpecSchema = z.object({
  url: z.string(),
  defaultBranch: z.string().default("main"),
  kind: RepoKindSchema.default("product-module"),
  description: z.string().optional(),
  language: z.string().optional(),
});
export type RepoSpec = z.infer<typeof RepoSpecSchema>;

export const RepoSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  systemId: z.string().nullable(),
  gitHostProviderId: z.string().nullable(),
  teamId: z.string().nullable(),
  spec: RepoSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
}).merge(BitemporalSchema);
export type Repo = z.infer<typeof RepoSchema>;

// ── System Version ──────────────────────────────────────────

export const SystemVersionSpecSchema = z.object({
  compatibilityRange: z.string().optional(),
  commitSha: z.string().optional(),
  releaseNotes: z.string().optional(),
});
export type SystemVersionSpec = z.infer<typeof SystemVersionSpecSchema>;

export const SystemVersionSchema = z.object({
  id: z.string(),
  systemId: z.string(),
  version: z.string(),
  spec: SystemVersionSpecSchema,
  createdAt: z.coerce.date(),
});
export type SystemVersion = z.infer<typeof SystemVersionSchema>;

// ── Pipeline Run ────────────────────────────────────────────

export const PipelineTriggerSchema = z.enum([
  "push",
  "pull_request",
  "manual",
  "schedule",
  "tag",
]);
export type PipelineTrigger = z.infer<typeof PipelineTriggerSchema>;

export const PipelineStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export type PipelineStatus = z.infer<typeof PipelineStatusSchema>;

export const PipelineRunSpecSchema = z.object({
  trigger: PipelineTriggerSchema,
  branch: z.string().optional(),
  startedAt: z.coerce.date().optional(),
  completedAt: z.coerce.date().optional(),
  durationMs: z.number().int().optional(),
  error: z.string().optional(),
});
export type PipelineRunSpec = z.infer<typeof PipelineRunSpecSchema>;

export const PipelineRunSchema = z.object({
  id: z.string(),
  repoId: z.string(),
  webhookEventId: z.string().nullable(),
  status: PipelineStatusSchema.default("pending"),
  commitSha: z.string().nullable(),
  spec: PipelineRunSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type PipelineRun = z.infer<typeof PipelineRunSchema>;

// ── Pipeline Step ───────────────────────────────────────────

export const PipelineStepSpecSchema = z.object({
  name: z.string(),
  status: PipelineStatusSchema.default("pending"),
  command: z.string().optional(),
  logs: z.string().optional(),
  durationMs: z.number().int().optional(),
  exitCode: z.number().int().optional(),
  startedAt: z.coerce.date().optional(),
  completedAt: z.coerce.date().optional(),
});
export type PipelineStepSpec = z.infer<typeof PipelineStepSpecSchema>;

export const PipelineStepSchema = z.object({
  id: z.string(),
  pipelineRunId: z.string(),
  spec: PipelineStepSpecSchema,
  createdAt: z.coerce.date(),
});
export type PipelineStep = z.infer<typeof PipelineStepSchema>;

// ── Git Host Provider ───────────────────────────────────────

export const GitHostTypeSchema = z.enum([
  "github",
  "gitlab",
  "gitea",
  "bitbucket",
]);
export type GitHostType = z.infer<typeof GitHostTypeSchema>;

export const GitHostProviderSpecSchema = z.object({
  apiUrl: z.string(),
  authMode: z.enum(["token", "app", "oauth"]).optional(),
  credentialsRef: z.string().optional(),
  webhookSecret: z.string().optional(),
  status: z.enum(["active", "inactive", "error"]).optional(),
  syncStatus: z.enum(["idle", "syncing", "error"]).optional(),
  lastSyncAt: z.coerce.date().optional(),
});
export type GitHostProviderSpec = z.infer<typeof GitHostProviderSpecSchema>;

export const GitHostProviderSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  type: GitHostTypeSchema,
  spec: GitHostProviderSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type GitHostProvider = z.infer<typeof GitHostProviderSchema>;

// ── GitHub App Installation ─────────────────────────────────

export const GithubAppInstallationSpecSchema = z.object({
  installationId: z.number().int(),
  accountLogin: z.string(),
  accountType: z.enum(["user", "organization"]).optional(),
  permissionsGranted: z.record(z.string()).default({}),
  suspendedAt: z.coerce.date().optional(),
});
export type GithubAppInstallationSpec = z.infer<typeof GithubAppInstallationSpecSchema>;

export const GithubAppInstallationSchema = z.object({
  id: z.string(),
  gitHostProviderId: z.string(),
  spec: GithubAppInstallationSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type GithubAppInstallation = z.infer<typeof GithubAppInstallationSchema>;

// ── Webhook Event ───────────────────────────────────────────
// Canonical definition lives in org.ts — re-exported via barrel.

// ── Git Sync ────────────────────────────────────────────────

export const GitRepoSyncSpecSchema = z.object({
  lastSyncAt: z.coerce.date().optional(),
  syncStatus: z.enum(["idle", "syncing", "error"]).default("idle"),
  error: z.string().optional(),
});
export type GitRepoSyncSpec = z.infer<typeof GitRepoSyncSpecSchema>;

export const GitUserSyncSpecSchema = z.object({
  principalId: z.string().optional(),
  externalUsername: z.string().optional(),
  avatarUrl: z.string().optional(),
});
export type GitUserSyncSpec = z.infer<typeof GitUserSyncSpecSchema>;

// ── Work Tracking ───────────────────────────────────────────

export const WorkTrackerTypeSchema = z.enum(["jira", "linear"]);
export type WorkTrackerType = z.infer<typeof WorkTrackerTypeSchema>;

export const WorkTrackerProviderSpecSchema = z.object({
  apiUrl: z.string(),
  credentialsRef: z.string().optional(),
  status: z.enum(["active", "inactive", "error"]).optional(),
  lastSyncAt: z.coerce.date().optional(),
});
export type WorkTrackerProviderSpec = z.infer<typeof WorkTrackerProviderSpecSchema>;

export const WorkTrackerProviderSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  type: WorkTrackerTypeSchema,
  teamId: z.string().nullable(),
  spec: WorkTrackerProviderSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type WorkTrackerProvider = z.infer<typeof WorkTrackerProviderSchema>;

export const WorkItemTypeSchema = z.enum(["epic", "story", "task", "bug"]);
export type WorkItemType = z.infer<typeof WorkItemTypeSchema>;

export const WorkItemSpecSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  priority: z.enum(["critical", "high", "medium", "low", "none"]).default("medium"),
  url: z.string().optional(),
  storyPoints: z.number().optional(),
});
export type WorkItemSpec = z.infer<typeof WorkItemSpecSchema>;

export const WorkItemSchema = z.object({
  id: z.string(),
  type: WorkItemTypeSchema,
  systemId: z.string().nullable(),
  workTrackerProviderId: z.string(),
  status: z.string(),
  externalId: z.string(),
  assignee: z.string().nullable(),
  spec: WorkItemSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type WorkItem = z.infer<typeof WorkItemSchema>;

// ── Input Schemas (CREATE / UPDATE) ────────────────────────

export const CreateRepoSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  systemId: z.string().optional(),
  gitHostProviderId: z.string().optional(),
  teamId: z.string().optional(),
  spec: RepoSpecSchema,
});
export const UpdateRepoSchema = CreateRepoSchema.partial();

export const CreateGitHostProviderSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: GitHostTypeSchema,
  spec: GitHostProviderSpecSchema,
});
export const UpdateGitHostProviderSchema = CreateGitHostProviderSchema.partial();

export const CreateWorkTrackerProviderSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: WorkTrackerTypeSchema,
  teamId: z.string().optional(),
  spec: WorkTrackerProviderSpecSchema,
});
export const UpdateWorkTrackerProviderSchema = CreateWorkTrackerProviderSchema.partial();
