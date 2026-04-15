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
  DeliverImageBody,
  MergePullRequestBody,
  MergePullRequestBodyLegacy,
  TriggerBuildBody,
} from "@smp/factory-shared/schemas/actions"
import type { ComponentDeploymentSpec } from "@smp/factory-shared/schemas/ops"
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
import { eq, sql } from "drizzle-orm"
import { Elysia, t } from "elysia"

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
} from "../../db/schema/build"
import { componentDeployment, systemDeployment } from "../../db/schema/ops"
import { team } from "../../db/schema/org"
import { component, system } from "../../db/schema/software"
import { logger } from "../../logger"
import { ontologyRoutes } from "../../lib/crud"
import { newId } from "../../lib/id"
import { GitHostService } from "./git-host.service"
import { syncWorkTracker } from "./work-tracker.service"

export function buildController(db: Database) {
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
          prefix: "repo",
          kindAlias: "repo",
          slugRefs: {
            systemSlug: {
              fk: "systemId",
              lookupTable: system,
              lookupSlugCol: system.slug,
              lookupIdCol: system.id,
            },
            teamSlug: {
              fk: "teamId",
              lookupTable: team,
              lookupSlugCol: team.slug,
              lookupIdCol: team.id,
            },
            gitHostProviderSlug: {
              fk: "gitHostProviderId",
              lookupTable: gitHostProvider,
              lookupSlugCol: gitHostProvider.slug,
              lookupIdCol: gitHostProvider.id,
            },
          },
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
                    spec: { trigger: "manual", branch: b.branch },
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
          prefix: "ghp",
          kindAlias: "git-host-provider",
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
          prefix: "wtp",
          kindAlias: "work-tracker-provider",
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
          prefix: "wtpj",
          kindAlias: "work-tracker-project",
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

      // ── Image Delivery ─────────────────────────────────────────
      .post(
        "/images/deliver",
        async ({ body }) => {
          const {
            repo: repoName,
            commitSha,
            imageRef,
            branch,
          } = body as DeliverImageBody

          const imageName = imageRef.includes("@")
            ? imageRef.split("@")[0]
            : imageRef.lastIndexOf(":") > imageRef.lastIndexOf("/")
              ? imageRef.slice(0, imageRef.lastIndexOf(":"))
              : imageRef
          const components = await db
            .select()
            .from(component)
            .where(sql`${component.spec}->>'imageName' = ${imageName}`)

          if (components.length === 0) {
            return {
              success: true,
              matched: 0,
              updated: 0,
              created: 0,
              componentDeploymentIds: [],
              message: `No components match image ${imageName}`,
            }
          }

          const componentIds = components.map((c) => c.id)

          const componentIdList = sql.join(
            componentIds.map((id) => sql`${id}`),
            sql`, `
          )

          const allCds = await db
            .select()
            .from(componentDeployment)
            .where(
              sql`${componentDeployment.componentId} IN (${componentIdList})
                AND (${componentDeployment.spec}->>'mode' IS NULL OR ${componentDeployment.spec}->>'mode' = 'deployed')`
            )

          const activeCds = allCds.filter((cd) => {
            const phase = cd.status?.phase ?? "pending"
            return phase !== "destroying" && phase !== "stopped"
          })

          const updatedIds: string[] = []
          const createdIds: string[] = []

          for (const cd of activeCds) {
            const spec = (cd.spec ?? {}) as ComponentDeploymentSpec
            const updatedSpec: ComponentDeploymentSpec = {
              ...spec,
              desiredImage: imageRef,
              sourceCommitSha: commitSha,
              ...(branch ? { sourceBranch: branch } : {}),
            }

            await db
              .update(componentDeployment)
              .set({
                spec: updatedSpec,
                status: {
                  phase: "provisioning",
                  driftDetected: false,
                  statusMessage: `Image delivered: ${branch ?? "unknown"}@${commitSha.slice(0, 8)}`,
                },
                generation: sql`${componentDeployment.generation} + 1`,
                updatedAt: new Date(),
              })
              .where(eq(componentDeployment.id, cd.id))

            updatedIds.push(cd.id)
          }

          const coveredComponentIds = new Set(
            allCds.map((cd) => cd.componentId)
          )
          const uncoveredComponents = components.filter(
            (c) => !coveredComponentIds.has(c.id)
          )

          if (uncoveredComponents.length > 0) {
            const activeSds = await db
              .select()
              .from(systemDeployment)
              .where(
                sql`COALESCE((${systemDeployment.status}->>'phase'), 'active') NOT IN ('destroying', 'destroyed', 'failed')`
              )

            for (const comp of uncoveredComponents) {
              const matchingSds = activeSds.filter(
                (sd) => sd.systemId === comp.systemId
              )
              for (const sd of matchingSds) {
                const rows = await db.execute(sql`
                  INSERT INTO ops.component_deployment (id, system_deployment_id, component_id, spec, status)
                  SELECT ${newId("cdp")}, ${sd.id}, ${comp.id},
                    ${sql`${JSON.stringify({ mode: "deployed", desiredImage: imageRef, sourceCommitSha: commitSha, ...(branch ? { sourceBranch: branch } : {}), replicas: 1 })}::jsonb`},
                    ${sql`${JSON.stringify({ phase: "provisioning", statusMessage: `Image delivered: ${branch ?? "unknown"}@${commitSha.slice(0, 8)}` })}::jsonb`}
                  WHERE NOT EXISTS (
                    SELECT 1 FROM ops.component_deployment
                    WHERE system_deployment_id = ${sd.id}
                      AND component_id = ${comp.id}
                  )
                  RETURNING id
                `)
                const result = rows as {
                  rows?: Array<{ id: string }>
                } & Array<{ id: string }>
                const created = result?.[0] ?? result?.rows?.[0]
                if (created?.id) createdIds.push(created.id)
              }
            }
          }

          const allIds = [...updatedIds, ...createdIds]

          logger.info(
            {
              imageRef,
              repo: repoName,
              commitSha: commitSha.slice(0, 8),
              matched: components.length,
              updated: updatedIds.length,
              created: createdIds.length,
            },
            "Image delivery: updated component deployments"
          )

          return {
            success: true,
            matched: components.length,
            updated: updatedIds.length,
            created: createdIds.length,
            componentDeploymentIds: allIds,
          }
        },
        {
          body: t.Object({
            repo: t.String(),
            commitSha: t.String(),
            imageRef: t.String(),
            branch: t.Optional(t.String()),
            dockerfilePath: t.Optional(t.String()),
          }),
          detail: {
            tags: ["build/images"],
            summary:
              "Notify Factory of a new image build — matches component by imageName, updates existing and creates new deployed CDs",
          },
        }
      )
  )
}

import type { OntologyRouteConfig } from "../../lib/crud"

export const buildOntologyConfigs: Pick<
  OntologyRouteConfig<any>,
  | "entity"
  | "singular"
  | "table"
  | "slugColumn"
  | "idColumn"
  | "prefix"
  | "slugRefs"
  | "kindAlias"
  | "createSchema"
>[] = [
  {
    entity: "repos",
    singular: "repo",
    table: repo,
    slugColumn: repo.slug,
    idColumn: repo.id,
    prefix: "repo",
    kindAlias: "repo",
    slugRefs: {
      systemSlug: {
        fk: "systemId",
        lookupTable: system,
        lookupSlugCol: system.slug,
        lookupIdCol: system.id,
      },
      teamSlug: {
        fk: "teamId",
        lookupTable: team,
        lookupSlugCol: team.slug,
        lookupIdCol: team.id,
      },
      gitHostProviderSlug: {
        fk: "gitHostProviderId",
        lookupTable: gitHostProvider,
        lookupSlugCol: gitHostProvider.slug,
        lookupIdCol: gitHostProvider.id,
      },
    },
  },
  {
    entity: "git-host-providers",
    singular: "git host provider",
    table: gitHostProvider,
    slugColumn: gitHostProvider.slug,
    idColumn: gitHostProvider.id,
    prefix: "ghp",
    kindAlias: "git-host-provider",
  },
  {
    entity: "work-tracker-providers",
    singular: "work tracker provider",
    table: workTrackerProvider,
    slugColumn: workTrackerProvider.slug,
    idColumn: workTrackerProvider.id,
    prefix: "wtp",
    kindAlias: "work-tracker-provider",
  },
  {
    entity: "work-tracker-projects",
    singular: "work tracker project",
    table: workTrackerProject,
    slugColumn: workTrackerProject.slug,
    idColumn: workTrackerProject.id,
    prefix: "wtpj",
    kindAlias: "work-tracker-project",
  },
]
