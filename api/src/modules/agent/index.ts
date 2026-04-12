/**
 * Agent controller.
 *
 * Route → table mapping:
 *   /agent/agents       → org.agent
 *   /agent/presets      → org.role_preset
 *   /agent/jobs         → org.job
 *   /agent/memories     → org.memory
 */
import {
  ApproveMemoryBody,
  CompleteJobBody,
  FailJobBody,
  OverrideJobBody,
  PromoteMemoryBody,
  SupersedeMemoryBody,
} from "@smp/factory-shared/schemas/actions"
import {
  CreateAgentSchema,
  CreateRolePresetSchema,
  UpdateAgentSchema,
  UpdateRolePresetSchema,
} from "@smp/factory-shared/schemas/org"
import { eq } from "drizzle-orm"
import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import { agent, job, memory, rolePreset } from "../../db/schema/org"
import { ontologyRoutes } from "../../lib/crud"

export function agentController(db: Database) {
  return (
    new Elysia({ prefix: "/agent" })

      // ── Agents ─────────────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "org",
          entity: "agents",
          singular: "agent",
          table: agent,
          slugColumn: agent.slug,
          idColumn: agent.id,
          prefix: "agt",
          kindAlias: "agent",
          createSchema: CreateAgentSchema,
          updateSchema: UpdateAgentSchema,
          deletable: true,
          relations: {
            jobs: {
              path: "jobs",
              table: job,
              fk: job.agentId,
            },
          },
        })
      )

      // ── Role Presets ───────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "org",
          entity: "presets",
          singular: "role preset",
          table: rolePreset,
          slugColumn: rolePreset.slug,
          idColumn: rolePreset.id,
          prefix: "rpre",
          kindAlias: "role-preset",
          createSchema: CreateRolePresetSchema,
          updateSchema: UpdateRolePresetSchema,
          deletable: true,
        })
      )

      // ── Jobs ───────────────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "org",
          entity: "jobs",
          singular: "job",
          table: job,
          slugColumn: job.id, // no slug — use id
          idColumn: job.id,
          prefix: "job",
          kindAlias: "job",
          actions: {
            start: {
              handler: async ({ db, entity }) => {
                const [row] = await db
                  .update(job)
                  .set({ status: "running", updatedAt: new Date() })
                  .where(eq(job.id, entity.id as string))
                  .returning()
                return row
              },
            },
            complete: {
              bodySchema: CompleteJobBody,
              handler: async ({ db, entity, body }) => {
                const b = body as CompleteJobBody
                const [row] = await db
                  .update(job)
                  .set({
                    status: "completed",
                    spec: {
                      ...(entity.spec as any),
                      outcome: b.outcome,
                      cost: {
                        ...(entity.spec as any)?.cost,
                        costMicrodollars: (b.costCents ?? 0) * 10_000,
                      },
                    } as any,
                    updatedAt: new Date(),
                  })
                  .where(eq(job.id, entity.id as string))
                  .returning()
                return row
              },
            },
            fail: {
              bodySchema: FailJobBody,
              handler: async ({ db, entity, body }) => {
                const b = body as FailJobBody
                const [row] = await db
                  .update(job)
                  .set({
                    status: "failed",
                    spec: {
                      ...(entity.spec as any),
                      outcome: b.outcome,
                    } as any,
                    updatedAt: new Date(),
                  })
                  .where(eq(job.id, entity.id as string))
                  .returning()
                return row
              },
            },
            cancel: {
              handler: async ({ db, entity }) => {
                const [row] = await db
                  .update(job)
                  .set({ status: "cancelled", updatedAt: new Date() })
                  .where(eq(job.id, entity.id as string))
                  .returning()
                return row
              },
            },
            override: {
              bodySchema: OverrideJobBody,
              handler: async ({ db, entity, body }) => {
                const b = body as OverrideJobBody
                const spec = entity.spec as Record<string, unknown>
                const [row] = await db
                  .update(job)
                  .set({
                    spec: {
                      ...spec,
                      metadata: {
                        ...((spec.metadata as any) ?? {}),
                        humanOverride: true,
                        overrideNote: b.note,
                      },
                    } as any,
                    updatedAt: new Date(),
                  })
                  .where(eq(job.id, entity.id as string))
                  .returning()
                return row
              },
            },
          },
        })
      )

      // ── Memories ───────────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "org",
          entity: "memories",
          singular: "memory",
          table: memory,
          slugColumn: memory.id, // no slug — use id
          idColumn: memory.id,
          prefix: "mem",
          kindAlias: "memory",
          deletable: true,
          actions: {
            approve: {
              bodySchema: ApproveMemoryBody,
              handler: async ({ db, entity, body }) => {
                const b = body as ApproveMemoryBody
                const [row] = await db
                  .update(memory)
                  .set({
                    status: "approved",
                    approvedByPrincipalId: b.approvedByPrincipalId,
                    updatedAt: new Date(),
                  })
                  .where(eq(memory.id, entity.id as string))
                  .returning()
                return row
              },
            },
            supersede: {
              bodySchema: SupersedeMemoryBody,
              handler: async ({ db, entity, body }) => {
                const b = body as SupersedeMemoryBody
                const spec = entity.spec as Record<string, unknown>
                const [row] = await db
                  .update(memory)
                  .set({
                    status: "superseded",
                    spec: { ...spec, supersededById: b.replacementId } as any,
                    updatedAt: new Date(),
                  })
                  .where(eq(memory.id, entity.id as string))
                  .returning()
                return row
              },
            },
            promote: {
              bodySchema: PromoteMemoryBody,
              handler: async ({ db, entity, body }) => {
                const b = body as PromoteMemoryBody
                // Promote: copy the memory to org layer
                const spec = entity.spec as Record<string, unknown>
                const [row] = await db
                  .update(memory)
                  .set({
                    layer: "org",
                    spec: { ...spec, promotedToOrgId: b.targetOrgId } as any,
                    updatedAt: new Date(),
                  })
                  .where(eq(memory.id, entity.id as string))
                  .returning()
                return row
              },
            },
          },
        })
      )
  )
}

import type { OntologyRouteConfig } from "../../lib/crud"

export const agentOntologyConfigs: Pick<
  OntologyRouteConfig<any>,
  | "entity"
  | "singular"
  | "table"
  | "slugColumn"
  | "idColumn"
  | "prefix"
  | "kindAlias"
  | "createSchema"
>[] = [
  {
    entity: "agents",
    singular: "agent",
    table: agent,
    slugColumn: agent.slug,
    idColumn: agent.id,
    prefix: "agt",
    kindAlias: "agent",
  },
  {
    entity: "presets",
    singular: "role preset",
    table: rolePreset,
    slugColumn: rolePreset.slug,
    idColumn: rolePreset.id,
    prefix: "rpre",
    kindAlias: "role-preset",
  },
  {
    entity: "jobs",
    singular: "job",
    table: job,
    slugColumn: job.id,
    idColumn: job.id,
    prefix: "job",
    kindAlias: "job",
  },
  {
    entity: "memories",
    singular: "memory",
    table: memory,
    slugColumn: memory.id,
    idColumn: memory.id,
    prefix: "mem",
    kindAlias: "memory",
  },
]
