import type {
  GitHostProviderSpec,
  GitRepoSyncSpec,
  GitUserSyncSpec,
  GithubAppInstallationSpec,
  PipelineRunSpec,
  PipelineStepSpec,
  RepoSpec,
  SystemVersionSpec,
  WorkItemSpec,
  WorkTrackerProjectSpec,
  WorkTrackerProviderSpec,
} from "@smp/factory-shared/schemas/build"
import type { WebhookEventSpec } from "@smp/factory-shared/schemas/org"
import { index, text, uniqueIndex } from "drizzle-orm/pg-core"

import { newId } from "../../lib/id"
import {
  bitemporalCols,
  buildSchema,
  createdAt,
  specCol,
  updatedAt,
} from "./helpers"
import { team } from "./org"
import { artifact, component, system } from "./software"

// ─── Git Host Provider ──────────────────────────────────────

export const gitHostProvider = buildSchema.table(
  "git_host_provider",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("ghp")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    spec: specCol<GitHostProviderSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("build_git_host_provider_slug_unique").on(t.slug),
    index("build_git_host_provider_type_idx").on(t.type),
  ]
)

// ─── Repo ───────────────────────────────────────────────────

export const repo = buildSchema.table(
  "repo",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("repo")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    systemId: text("system_id").references(() => system.id),
    gitHostProviderId: text("git_host_provider_id").references(
      () => gitHostProvider.id
    ),
    teamId: text("team_id").references(() => team.id),
    spec: specCol<RepoSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...bitemporalCols(),
  },
  (t) => [
    // Partial unique index in migration (bitemporal)
    index("build_repo_slug_idx").on(t.slug),
    index("build_repo_system_idx").on(t.systemId),
    index("build_repo_git_host_provider_idx").on(t.gitHostProviderId),
    index("build_repo_team_idx").on(t.teamId),
  ]
)

// ─── System Version ─────────────────────────────────────────

export const systemVersion = buildSchema.table(
  "system_version",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("sver")),
    systemId: text("system_id")
      .notNull()
      .references(() => system.id),
    version: text("version").notNull(),
    spec: specCol<SystemVersionSpec>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("build_system_version_system_version_unique").on(
      t.systemId,
      t.version
    ),
    index("build_system_version_system_idx").on(t.systemId),
  ]
)

// ─── Webhook Event ──────────────────────────────────────────

export const webhookEvent = buildSchema.table(
  "webhook_event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("whe")),
    gitHostProviderId: text("git_host_provider_id")
      .notNull()
      .references(() => gitHostProvider.id, { onDelete: "cascade" }),
    deliveryId: text("delivery_id").notNull(),
    spec: specCol<WebhookEventSpec>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("build_webhook_event_provider_delivery_unique").on(
      t.gitHostProviderId,
      t.deliveryId
    ),
    index("build_webhook_event_provider_idx").on(t.gitHostProviderId),
  ]
)

// ─── Pipeline Run ───────────────────────────────────────────

export const pipelineRun = buildSchema.table(
  "pipeline_run",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("prun")),
    repoId: text("repo_id")
      .notNull()
      .references(() => repo.id, { onDelete: "cascade" }),
    webhookEventId: text("webhook_event_id").references(() => webhookEvent.id),
    status: text("status").notNull().default("pending"),
    commitSha: text("commit_sha"),
    spec: specCol<PipelineRunSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("build_pipeline_run_repo_idx").on(t.repoId),
    index("build_pipeline_run_webhook_event_idx").on(t.webhookEventId),
    index("build_pipeline_run_status_idx").on(t.status),
    index("build_pipeline_run_commit_idx").on(t.commitSha),
  ]
)

// ─── Pipeline Step ──────────────────────────────────────────

export const pipelineStep = buildSchema.table(
  "pipeline_step",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("pstp")),
    pipelineRunId: text("pipeline_run_id")
      .notNull()
      .references(() => pipelineRun.id, { onDelete: "cascade" }),
    spec: specCol<PipelineStepSpec>(),
    createdAt: createdAt(),
  },
  (t) => [index("build_pipeline_step_pipeline_run_idx").on(t.pipelineRunId)]
)

// ─── Github App Installation ────────────────────────────────

export const githubAppInstallation = buildSchema.table(
  "github_app_installation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("ghi")),
    gitHostProviderId: text("git_host_provider_id")
      .notNull()
      .references(() => gitHostProvider.id, { onDelete: "cascade" }),
    spec: specCol<GithubAppInstallationSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("build_github_app_installation_git_host_provider_idx").on(
      t.gitHostProviderId
    ),
  ]
)

// ─── Git Repo Sync ──────────────────────────────────────────

export const gitRepoSync = buildSchema.table(
  "git_repo_sync",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("grs")),
    repoId: text("repo_id")
      .notNull()
      .references(() => repo.id, { onDelete: "cascade" }),
    gitHostProviderId: text("git_host_provider_id")
      .notNull()
      .references(() => gitHostProvider.id, { onDelete: "cascade" }),
    externalRepoId: text("external_repo_id").notNull(),
    spec: specCol<GitRepoSyncSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("build_git_repo_sync_provider_external_unique").on(
      t.gitHostProviderId,
      t.externalRepoId
    ),
    index("build_git_repo_sync_repo_idx").on(t.repoId),
    index("build_git_repo_sync_git_host_provider_idx").on(t.gitHostProviderId),
  ]
)

// ─── Git User Sync ──────────────────────────────────────────

export const gitUserSync = buildSchema.table(
  "git_user_sync",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("gus")),
    gitHostProviderId: text("git_host_provider_id")
      .notNull()
      .references(() => gitHostProvider.id, { onDelete: "cascade" }),
    externalUserId: text("external_user_id").notNull(),
    spec: specCol<GitUserSyncSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("build_git_user_sync_provider_user_unique").on(
      t.gitHostProviderId,
      t.externalUserId
    ),
    index("build_git_user_sync_git_host_provider_idx").on(t.gitHostProviderId),
  ]
)

// ─── Work Tracker Provider ──────────────────────────────────

export const workTrackerProvider = buildSchema.table(
  "work_tracker_provider",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("wtp")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    teamId: text("team_id").references(() => team.id),
    spec: specCol<WorkTrackerProviderSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("build_work_tracker_provider_slug_unique").on(t.slug),
    index("build_work_tracker_provider_type_idx").on(t.type),
    index("build_work_tracker_provider_team_idx").on(t.teamId),
  ]
)

// ─── Work Tracker Project Mapping ───────────────────────────

export const workTrackerProjectMapping = buildSchema.table(
  "work_tracker_project_mapping",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("wtpm")),
    workTrackerProviderId: text("work_tracker_provider_id")
      .notNull()
      .references(() => workTrackerProvider.id, { onDelete: "cascade" }),
    systemId: text("system_id")
      .notNull()
      .references(() => system.id),
    externalProjectId: text("external_project_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("build_work_tracker_project_mapping_provider_system_unique").on(
      t.workTrackerProviderId,
      t.systemId
    ),
    index("build_work_tracker_project_mapping_system_idx").on(t.systemId),
  ]
)

// ─── Work Tracker Project ───────────────────────────────────

export const workTrackerProject = buildSchema.table(
  "work_tracker_project",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("wtpj")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    workTrackerProviderId: text("work_tracker_provider_id")
      .notNull()
      .references(() => workTrackerProvider.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    spec: specCol<WorkTrackerProjectSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("build_work_tracker_project_slug_unique").on(t.slug),
    uniqueIndex("build_work_tracker_project_provider_external_unique").on(
      t.workTrackerProviderId,
      t.externalId
    ),
    index("build_work_tracker_project_provider_idx").on(
      t.workTrackerProviderId
    ),
  ]
)

// ─── Work Item ──────────────────────────────────────────────

export const workItem = buildSchema.table(
  "work_item",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("wi")),
    type: text("type").notNull(),
    systemId: text("system_id").references(() => system.id),
    workTrackerProviderId: text("work_tracker_provider_id")
      .notNull()
      .references(() => workTrackerProvider.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("backlog"),
    externalId: text("external_id").notNull(),
    assignee: text("assignee"),
    spec: specCol<WorkItemSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("build_work_item_provider_external_unique").on(
      t.workTrackerProviderId,
      t.externalId
    ),
    index("build_work_item_type_idx").on(t.type),
    index("build_work_item_system_idx").on(t.systemId),
    index("build_work_item_work_tracker_provider_idx").on(
      t.workTrackerProviderId
    ),
    index("build_work_item_status_idx").on(t.status),
    index("build_work_item_assignee_idx").on(t.assignee),
  ]
)

// ─── Component Artifact (junction) ─────────────────────
// Links a system version's component to a specific artifact build.

export const componentArtifact = buildSchema.table(
  "component_artifact",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("cart")),
    systemVersionId: text("system_version_id")
      .notNull()
      .references(() => systemVersion.id, { onDelete: "cascade" }),
    componentId: text("component_id")
      .notNull()
      .references(() => component.id),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifact.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("build_component_artifact_unique").on(
      t.systemVersionId,
      t.componentId,
      t.artifactId
    ),
    index("build_component_artifact_version_idx").on(t.systemVersionId),
    index("build_component_artifact_component_idx").on(t.componentId),
  ]
)
