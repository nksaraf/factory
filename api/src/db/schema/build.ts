import { sql } from "drizzle-orm";
import { bigint, boolean, check, jsonb, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { newId } from "../../lib/id";
import { orgTeam } from "./org";
import { componentSpec, productModule } from "./product";

export const factoryBuild = pgSchema("factory_build");

export const gitHostProvider = factoryBuild.table(
  "git_host_provider",
  {
    gitHostProviderId: text("git_host_provider_id")
      .primaryKey()
      .$defaultFn(() => newId("ghp")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    hostType: text("host_type").notNull(),
    apiBaseUrl: text("api_base_url").notNull(),
    authMode: text("auth_mode").notNull(),
    credentialsEnc: text("credentials_enc"),
    spec: jsonb("spec").notNull().default({}),
    status: text("status").notNull().default("active"),
    teamId: text("team_id")
      .notNull()
      .references(() => orgTeam.teamId),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    syncStatus: text("sync_status").notNull().default("idle"),
    syncError: text("sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("git_host_provider_slug_unique").on(t.slug),
    check("git_host_provider_host_type_valid", sql`${t.hostType} IN ('github', 'gitlab', 'gitea', 'bitbucket')`),
    check("git_host_provider_auth_mode_valid", sql`${t.authMode} IN ('pat', 'github_app', 'oauth')`),
    check("git_host_provider_status_valid", sql`${t.status} IN ('active', 'inactive', 'error')`),
    check("git_host_provider_sync_status_valid", sql`${t.syncStatus} IN ('idle', 'syncing', 'error')`),
  ]
);

export const repo = factoryBuild.table(
  "repo",
  {
    repoId: text("repo_id")
      .primaryKey()
      .$defaultFn(() => newId("repo")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind").notNull(),
    moduleId: text("module_id").references(() => productModule.moduleId, {
      onDelete: "set null",
    }),
    gitHostProviderId: text("git_host_provider_id").references(
      () => gitHostProvider.gitHostProviderId,
      { onDelete: "set null" },
    ),
    teamId: text("team_id")
      .notNull()
      .references(() => orgTeam.teamId),
    gitUrl: text("git_url").notNull(),
    defaultBranch: text("default_branch").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("repo_name_unique").on(t.name),
    uniqueIndex("repo_slug_unique").on(t.slug),
    check(
      "repo_kind_valid",
      sql`${t.kind} IN ('product-module', 'platform-module', 'library', 'vendor-module', 'client-project', 'infra', 'docs', 'tool')`
    ),
  ]
);

export const moduleVersion = factoryBuild.table(
  "module_version",
  {
    moduleVersionId: text("module_version_id")
      .primaryKey()
      .$defaultFn(() => newId("mv")),
    moduleId: text("module_id")
      .notNull()
      .references(() => productModule.moduleId, { onDelete: "cascade" }),
    version: text("version").notNull(),
    compatibilityRange: text("compatibility_range"),
    schemaVersion: text("schema_version"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("module_version_module_version_unique").on(t.moduleId, t.version),
  ]
);

export const artifact = factoryBuild.table("artifact", {
  artifactId: text("artifact_id")
    .primaryKey()
    .$defaultFn(() => newId("art")),
  kind: text("kind").notNull().default("container_image"),
  imageRef: text("image_ref").notNull(),
  imageDigest: text("image_digest").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  builtAt: timestamp("built_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check(
    "artifact_kind_valid",
    sql`${t.kind} IN ('container_image', 'binary', 'archive', 'package', 'bundle')`
  ),
]);

export const componentArtifact = factoryBuild.table(
  "component_artifact",
  {
    componentArtifactId: text("component_artifact_id")
      .primaryKey()
      .$defaultFn(() => newId("ca")),
    moduleVersionId: text("module_version_id")
      .notNull()
      .references(() => moduleVersion.moduleVersionId, { onDelete: "cascade" }),
    componentId: text("component_id")
      .notNull()
      .references(() => componentSpec.componentId, { onDelete: "cascade" }),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifact.artifactId, { onDelete: "cascade" }),
  }
);

export const githubAppInstallation = factoryBuild.table(
  "github_app_installation",
  {
    installationId: text("installation_id")
      .primaryKey()
      .$defaultFn(() => newId("ghi")),
    gitHostProviderId: text("git_host_provider_id")
      .notNull()
      .references(() => gitHostProvider.gitHostProviderId, { onDelete: "cascade" }),
    githubAppId: text("github_app_id").notNull(),
    githubInstallationId: text("github_installation_id").notNull(),
    privateKeyEnc: text("private_key_enc").notNull(),
    webhookSecret: text("webhook_secret").notNull(),
    permissionsGranted: jsonb("permissions_granted").default({}),
    accountLogin: text("account_login"),
    accountType: text("account_type"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    tokenCacheEnc: text("token_cache_enc"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }
);

export const webhookEvent = factoryBuild.table(
  "webhook_event",
  {
    webhookEventId: text("webhook_event_id")
      .primaryKey()
      .$defaultFn(() => newId("whe")),
    gitHostProviderId: text("git_host_provider_id")
      .notNull()
      .references(() => gitHostProvider.gitHostProviderId, { onDelete: "cascade" }),
    deliveryId: text("delivery_id").notNull(),
    eventType: text("event_type").notNull(),
    action: text("action"),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    errorMessage: text("error_message"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("webhook_event_delivery_unique").on(t.gitHostProviderId, t.deliveryId),
    check("webhook_event_status_valid", sql`${t.status} IN ('pending', 'processing', 'completed', 'failed')`),
  ]
);

export const pipelineRun = factoryBuild.table(
  "pipeline_run",
  {
    pipelineRunId: text("pipeline_run_id")
      .primaryKey()
      .$defaultFn(() => newId("prun")),
    repoId: text("repo_id").references(() => repo.repoId, { onDelete: "set null" }),
    triggerEvent: text("trigger_event").notNull(),
    triggerRef: text("trigger_ref").notNull(),
    commitSha: text("commit_sha").notNull(),
    workflowFile: text("workflow_file"),
    status: text("status").notNull().default("pending"),
    sandboxId: text("sandbox_id"),
    webhookEventId: text("webhook_event_id").references(
      () => webhookEvent.webhookEventId,
      { onDelete: "set null" },
    ),
    triggerActor: text("trigger_actor"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    check(
      "pipeline_run_trigger_event_valid",
      sql`${t.triggerEvent} IN ('push', 'pull_request', 'manual', 'schedule')`,
    ),
    check(
      "pipeline_run_status_valid",
      sql`${t.status} IN ('pending', 'queued', 'running', 'success', 'failure', 'cancelled', 'timed_out')`,
    ),
  ],
);

export const pipelineStepRun = factoryBuild.table(
  "pipeline_step_run",
  {
    pipelineStepRunId: text("pipeline_step_run_id")
      .primaryKey()
      .$defaultFn(() => newId("pstp")),
    pipelineRunId: text("pipeline_run_id")
      .notNull()
      .references(() => pipelineRun.pipelineRunId, { onDelete: "cascade" }),
    jobName: text("job_name").notNull(),
    stepName: text("step_name"),
    status: text("status").notNull().default("pending"),
    exitCode: bigint("exit_code", { mode: "number" }),
    logUrl: text("log_url"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    check(
      "pipeline_step_run_status_valid",
      sql`${t.status} IN ('pending', 'running', 'success', 'failure', 'skipped', 'cancelled')`,
    ),
  ],
);

export const gitRepoSync = factoryBuild.table(
  "git_repo_sync",
  {
    gitRepoSyncId: text("git_repo_sync_id")
      .primaryKey()
      .$defaultFn(() => newId("grs")),
    repoId: text("repo_id")
      .notNull()
      .references(() => repo.repoId, { onDelete: "cascade" }),
    gitHostProviderId: text("git_host_provider_id")
      .notNull()
      .references(() => gitHostProvider.gitHostProviderId, { onDelete: "cascade" }),
    externalRepoId: text("external_repo_id").notNull(),
    externalFullName: text("external_full_name").notNull(),
    isPrivate: boolean("is_private").notNull().default(true),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    syncError: text("sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("git_repo_sync_provider_external_unique").on(t.gitHostProviderId, t.externalRepoId),
  ]
);

export const gitUserSync = factoryBuild.table(
  "git_user_sync",
  {
    gitUserSyncId: text("git_user_sync_id")
      .primaryKey()
      .$defaultFn(() => newId("gus")),
    gitHostProviderId: text("git_host_provider_id")
      .notNull()
      .references(() => gitHostProvider.gitHostProviderId, { onDelete: "cascade" }),
    externalUserId: text("external_user_id").notNull(),
    externalLogin: text("external_login").notNull(),
    authUserId: text("auth_user_id"),
    email: text("email"),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("git_user_sync_provider_external_unique").on(t.gitHostProviderId, t.externalUserId),
  ]
);
