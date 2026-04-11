/**
 * Build controller.
 *
 * Route → table mapping:
 *   /build/repos                → build.repo
 *   /build/git-host-providers   → build.git_host_provider
 *   /build/work-tracker-providers → build.work_tracker_provider
 *   /build/pipeline-runs        → build.pipeline_run
 */
import {
  validateBranchName,
  validateCommitMessage,
} from "@smp/factory-shared/conventions"
import { parseConventionsInput } from "@smp/factory-shared/conventions-schema"
import {
  CreatePullRequestBody,
  CreatePullRequestBodyLegacy,
  MergePullRequestBody,
  MergePullRequestBodyLegacy,
  TriggerBuildBody,
} from "@smp/factory-shared/schemas/actions"
import {
  CreateGitHostProviderSchema,
  CreateRepoSchema,
  CreateWorkTrackerProjectSchema,
  CreateWorkTrackerProviderSchema,
  UpdateGitHostProviderSchema,
  UpdateRepoSchema,
  UpdateWorkTrackerProjectSchema,
  UpdateWorkTrackerProviderSchema,
} from "@smp/factory-shared/schemas/build"
import { eq } from "drizzle-orm"
import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import {
  gitHostProvider,
  pipelineRun,
  pipelineStep,
  repo,
  workItem,
  workTrackerProject,
  workTrackerProjectMapping,
  workTrackerProvider,
} from "../../db/schema/build-v2"
import { ontologyRoutes } from "../../lib/crud"
import { newId } from "../../lib/id"
import { GitHostService } from "./git-host.service"
import { syncWorkTracker } from "./work-tracker.service"

export function buildControllerV2(db: Database) {
  const gitHostSvc = new GitHostService(db)

  return (
    new Elysia({ prefix: "/build" })

      // ── Repos ──────────────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "build",
          entity: "repos",
          singular: "repo",
          table: repo,
          slugColumn: repo.slug,
          idColumn: repo.id,
          createSchema: CreateRepoSchema,
          updateSchema: UpdateRepoSchema,
          deletable: "bitemporal",
          bitemporal: { validTo: repo.validTo, systemTo: repo.systemTo },
          relations: {
            "pipeline-runs": {
              path: "pipeline-runs",
              table: pipelineRun,
              fk: pipelineRun.repoId,
            },
          },
          actions: {
            "trigger-build": {
              bodySchema: TriggerBuildBody,
              handler: async ({ db, entity, body }) => {
                const b = body as TriggerBuildBody
                const [run] = await db
                  .insert(pipelineRun)
                  .values({
                    id: newId("prun"),
                    repoId: entity.id as string,
                    status: "pending",
                    commitSha: b.commitSha ?? null,
                    spec: { trigger: "manual", branch: b.branch } as any,
                  })
                  .returning()
                return run
              },
            },
            "create-pr": {
              bodySchema: CreatePullRequestBody,
              handler: async ({ entity, body }) => {
                const b = body as CreatePullRequestBody
                const providerId = entity.gitHostProviderId as string | null
                if (!providerId)
                  throw new Error("Repo has no git host provider configured")
                return gitHostSvc.createPullRequest(
                  providerId,
                  entity.slug as string,
                  {
                    title: b.title,
                    body: b.body,
                    head: b.head,
                    base: b.base,
                  }
                )
              },
            },
            "merge-pr": {
              bodySchema: MergePullRequestBody,
              handler: async ({ entity, body }) => {
                const b = body as MergePullRequestBody
                const providerId = entity.gitHostProviderId as string | null
                if (!providerId)
                  throw new Error("Repo has no git host provider configured")
                await gitHostSvc.mergePullRequest(
                  providerId,
                  entity.slug as string,
                  b.prNumber,
                  b.mergeMethod
                )
                return { merged: true, prNumber: b.prNumber }
              },
            },
          },
        })
      )

      // ── Git Host Providers ─────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "build",
          entity: "git-host-providers",
          singular: "git host provider",
          table: gitHostProvider,
          slugColumn: gitHostProvider.slug,
          idColumn: gitHostProvider.id,
          createSchema: CreateGitHostProviderSchema,
          updateSchema: UpdateGitHostProviderSchema,
          deletable: true,
          relations: {
            repos: {
              path: "repos",
              table: repo,
              fk: repo.gitHostProviderId,
              bitemporal: { validTo: repo.validTo, systemTo: repo.systemTo },
            },
          },
          actions: {
            sync: {
              handler: async ({ entity }) => {
                return gitHostSvc.triggerFullSync(entity.id as string)
              },
            },
            /** @deprecated Use POST /repos/:slug/create-pr instead */
            "create-pr": {
              bodySchema: CreatePullRequestBodyLegacy,
              handler: async ({ entity, body }) => {
                const b = body as CreatePullRequestBodyLegacy
                return gitHostSvc.createPullRequest(
                  entity.id as string,
                  b.repoSlug,
                  {
                    title: b.title,
                    body: b.body,
                    head: b.head,
                    base: b.base,
                  }
                )
              },
            },
            /** @deprecated Use POST /repos/:slug/merge-pr instead */
            "merge-pr": {
              bodySchema: MergePullRequestBodyLegacy,
              handler: async ({ entity, body }) => {
                const b = body as MergePullRequestBodyLegacy
                await gitHostSvc.mergePullRequest(
                  entity.id as string,
                  b.repoSlug,
                  b.prNumber,
                  b.mergeMethod
                )
                return { merged: true, prNumber: b.prNumber }
              },
            },
          },
        })
      )

      // ── Work Tracker Providers ─────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "build",
          entity: "work-tracker-providers",
          singular: "work tracker provider",
          table: workTrackerProvider,
          slugColumn: workTrackerProvider.slug,
          idColumn: workTrackerProvider.id,
          createSchema: CreateWorkTrackerProviderSchema,
          updateSchema: UpdateWorkTrackerProviderSchema,
          deletable: true,
          relations: {
            "work-tracker-projects": {
              path: "work-tracker-projects",
              table: workTrackerProject,
              fk: workTrackerProject.workTrackerProviderId,
            },
            "work-items": {
              path: "work-items",
              table: workItem,
              fk: workItem.workTrackerProviderId,
            },
            "project-mappings": {
              path: "project-mappings",
              table: workTrackerProjectMapping,
              fk: workTrackerProjectMapping.workTrackerProviderId,
            },
          },
          actions: {
            "test-connection": {
              handler: async ({ entity }) => {
                // Return the current spec status — actual connection test
                // requires the work tracker adapter (wired separately)
                const spec = entity.spec as Record<string, unknown>
                return {
                  connected: spec.status === "active",
                  status: spec.status,
                }
              },
            },
            sync: {
              handler: async ({ entity }) => {
                return syncWorkTracker(db, entity.id as string)
              },
            },
          },
        })
      )

      // ── Work Tracker Projects ───────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "build",
          entity: "work-tracker-projects",
          singular: "work tracker project",
          table: workTrackerProject,
          slugColumn: workTrackerProject.slug,
          idColumn: workTrackerProject.id,
          createSchema: CreateWorkTrackerProjectSchema,
          updateSchema: UpdateWorkTrackerProjectSchema,
          deletable: true,
        })
      )

      // ── Pipeline Runs ──────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "build",
          entity: "pipeline-runs",
          singular: "pipeline run",
          table: pipelineRun,
          slugColumn: pipelineRun.id, // no slug — use id
          idColumn: pipelineRun.id,
          relations: {
            steps: {
              path: "steps",
              table: pipelineStep,
              fk: pipelineStep.pipelineRunId,
            },
          },
          actions: {
            cancel: {
              handler: async ({ db, entity }) => {
                const [row] = await db
                  .update(pipelineRun)
                  .set({ status: "cancelled", updatedAt: new Date() })
                  .where(eq(pipelineRun.id, entity.id as string))
                  .returning()
                return row
              },
            },
          },
        })
      )

      // ── Conventions Validate ────────────────────────────────
      .post(
        "/conventions/validate",
        ({ body }) => {
          const b = body as {
            type?: string
            value?: string
            conventions?: unknown
          }
          if (!b.type || !b.value) {
            return new Response(
              JSON.stringify({
                error: {
                  code: "validation_error",
                  message: "type and value are required",
                },
              }),
              { status: 400, headers: { "content-type": "application/json" } }
            )
          }
          const config = parseConventionsInput(b.conventions)
          const result =
            b.type === "branch"
              ? validateBranchName(b.value, config)
              : validateCommitMessage(b.value, config)
          return { success: true, data: result }
        },
        {
          detail: {
            tags: ["build/conventions"],
            summary: "Validate branch or commit against conventions",
          },
        }
      )
  )
}
