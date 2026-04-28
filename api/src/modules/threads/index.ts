/**
 * Threads controller.
 *
 * Route → table mapping:
 *   /threads/channels      → org.channel
 *   /threads/threads       → org.thread
 *   /threads/turns         → org.thread_turn
 *   /threads/participants  → org.thread_participant
 */
import {
  CompleteThreadBody,
  ForkThreadBody,
} from "@smp/factory-shared/schemas/actions"
import {
  CreateChannelSchema,
  CreateThreadSchema,
  CreateThreadTurnSchema,
  UpdateChannelSchema,
  UpdateThreadSchema,
} from "@smp/factory-shared/schemas/org"
import { and, eq, inArray, max, sql } from "drizzle-orm"
import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import {
  channel,
  document,
  documentVersion,
  thread,
  threadParticipant,
  threadTurn,
} from "../../db/schema/org"
import { ontologyRoutes } from "../../lib/crud"
import { extractPlanReferences } from "../../lib/plan-paths"

export function threadsController(db: Database) {
  return (
    new Elysia({ prefix: "/threads" })

      // ── Channels ──────────────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "org",
          entity: "channels",
          singular: "channel",
          table: channel,
          slugColumn: channel.id, // no slug — use id
          idColumn: channel.id,
          prefix: "chan",
          kindAlias: "channel",
          createSchema: CreateChannelSchema,
          updateSchema: UpdateChannelSchema,
          deletable: true,
          relations: {
            threads: {
              path: "threads",
              table: thread,
              fk: thread.channelId,
            },
          },
        })
      )

      // ── Threads ───────────────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "org",
          entity: "threads",
          singular: "thread",
          table: thread,
          slugColumn: thread.id, // no slug — use id
          idColumn: thread.id,
          prefix: "thrd",
          kindAlias: "thread",
          createSchema: CreateThreadSchema,
          updateSchema: UpdateThreadSchema,
          deletable: true,
          relations: {
            turns: {
              path: "turns",
              table: threadTurn,
              fk: threadTurn.threadId,
            },
            participants: {
              path: "participants",
              table: threadParticipant,
              fk: threadParticipant.threadId,
            },
          },
          actions: {
            complete: {
              bodySchema: CompleteThreadBody,
              handler: async ({ db, entity, body }) => {
                const b = body as CompleteThreadBody
                const spec = entity.spec as Record<string, unknown>
                const [row] = await db
                  .update(thread)
                  .set({
                    status: "completed",
                    endedAt: new Date(),
                    spec: { ...spec, result: b.result } as any,
                    updatedAt: new Date(),
                  })
                  .where(eq(thread.id, entity.id as string))
                  .returning()
                return row
              },
            },
            fail: {
              handler: async ({ db, entity }) => {
                const [row] = await db
                  .update(thread)
                  .set({
                    status: "failed",
                    endedAt: new Date(),
                    updatedAt: new Date(),
                  })
                  .where(eq(thread.id, entity.id as string))
                  .returning()
                return row
              },
            },
            abandon: {
              handler: async ({ db, entity }) => {
                const [row] = await db
                  .update(thread)
                  .set({
                    status: "abandoned",
                    endedAt: new Date(),
                    updatedAt: new Date(),
                  })
                  .where(eq(thread.id, entity.id as string))
                  .returning()
                return row
              },
            },
            fork: {
              bodySchema: ForkThreadBody,
              handler: async ({ db, entity, body }) => {
                const b = body as ForkThreadBody
                const parentSpec = entity.spec as Record<string, unknown>
                const [forked] = await db
                  .insert(thread)
                  .values({
                    type: entity.type as string,
                    source: (b.source as string) ?? (entity.source as string),
                    principalId: entity.principalId as string | null,
                    agentId: entity.agentId as string | null,
                    jobId: entity.jobId as string | null,
                    channelId: entity.channelId as string | null,
                    repoSlug: entity.repoSlug as string | null,
                    branch: entity.branch as string | null,
                    startedAt: new Date(),
                    parentThreadId: entity.id as string,
                    spec: {
                      ...parentSpec,
                      continuationNote: b.continuationNote,
                      ...b.spec,
                    } as any,
                  })
                  .returning()
                return forked
              },
            },
          },
        })
      )

      // ── Thread Turns ──────────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "org",
          entity: "turns",
          singular: "thread turn",
          table: threadTurn,
          slugColumn: threadTurn.id, // no slug — use id
          idColumn: threadTurn.id,
          prefix: "turn",
          kindAlias: "thread-turn",
          createSchema: CreateThreadTurnSchema,
          deletable: true,
        })
      )

      // ── Thread Participants ───────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "org",
          entity: "participants",
          singular: "thread participant",
          table: threadParticipant,
          slugColumn: threadParticipant.id, // no slug — use id
          idColumn: threadParticipant.id,
          deletable: true,
        })
      )

      // ── Thread-scoped plans (authored + referenced) ───────────
      // Uses :slugOrId to stay compatible with the ontologyRoutes generator
      // above which registers other /threads/:slugOrId/* sub-paths.
      .get("/threads/:slugOrId/plans", async ({ params }) => {
        const threadId = params.slugOrId

        const authored = await db
          .select({
            slug: document.slug,
            title: document.title,
            source: document.source,
            threadId: document.threadId,
            spec: document.spec,
            createdAt: document.createdAt,
            updatedAt: document.updatedAt,
          })
          .from(document)
          .where(
            and(eq(document.type, "plan"), eq(document.threadId, threadId))
          )

        // Only project the toolInput field (not the whole spec) and only
        // pull tool-role turns. Capped at 5000 to keep memory bounded for
        // very long threads. Plan references in non-tool turns are vanishingly rare.
        const TURN_SCAN_CAP = 5000
        const turnRows = await db.execute(sql`
          SELECT spec->>'toolInput' AS tool_input
          FROM org.thread_turn
          WHERE thread_id = ${threadId}
            AND role = 'tool'
            AND spec ? 'toolInput'
          LIMIT ${TURN_SCAN_CAP}
        `)

        const referencedSlugs = new Set<string>()
        for (const r of (turnRows as any).rows ?? []) {
          const refs = extractPlanReferences(r.tool_input)
          for (const ref of refs) referencedSlugs.add(ref.slug)
        }

        const authoredSlugs = new Set(authored.map((r) => r.slug))
        const missingRefSlugs = Array.from(referencedSlugs).filter(
          (s) => !authoredSlugs.has(s)
        )

        let referenced: typeof authored = []
        if (missingRefSlugs.length > 0) {
          referenced = await db
            .select({
              slug: document.slug,
              title: document.title,
              source: document.source,
              threadId: document.threadId,
              spec: document.spec,
              createdAt: document.createdAt,
              updatedAt: document.updatedAt,
            })
            .from(document)
            .where(
              and(
                eq(document.type, "plan"),
                inArray(document.slug, missingRefSlugs)
              )
            )
        }

        const allDocs = [...authored, ...referenced]
        if (allDocs.length === 0) {
          return { plans: [] }
        }

        const latestRows = await db
          .select({
            slug: document.slug,
            maxVersion: max(documentVersion.version),
          })
          .from(document)
          .innerJoin(
            documentVersion,
            eq(documentVersion.documentId, document.id)
          )
          .where(
            inArray(
              document.slug,
              allDocs.map((d) => d.slug)
            )
          )
          .groupBy(document.slug)

        const latestBySlug = new Map(
          latestRows.map((r) => [r.slug, r.maxVersion ?? null])
        )

        const base = (
          process.env.FACTORY_URL ??
          process.env.BETTER_AUTH_BASE_URL ??
          "https://factory.lepton.software"
        ).replace(/\/$/, "")
        const plans = allDocs
          .map((r) => {
            const spec = (r.spec ?? {}) as Record<string, unknown>
            return {
              slug: r.slug,
              title: r.title,
              source: r.source,
              latestVersion: latestBySlug.get(r.slug) ?? null,
              threadId: r.threadId,
              sourceTurnId: null as string | null,
              editCount: (spec.editCount as number | undefined) ?? 0,
              stub: (spec.stub as boolean | undefined) ?? false,
              authored: r.threadId === threadId,
              referenced: r.threadId !== threadId,
              updatedAt: r.updatedAt
                ? new Date(r.updatedAt).toISOString()
                : null,
              createdAt: r.createdAt
                ? new Date(r.createdAt).toISOString()
                : null,
              viewUrl: `${base}/api/v1/factory/documents/${encodeURIComponent(r.slug)}/view`,
            }
          })
          .sort((a, b) => {
            const at = a.updatedAt ? Date.parse(a.updatedAt) : 0
            const bt = b.updatedAt ? Date.parse(b.updatedAt) : 0
            return bt - at
          })

        return { plans }
      })
  )
}

import type { OntologyRouteConfig } from "../../lib/crud"

export const threadsOntologyConfigs: Pick<
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
    entity: "channels",
    singular: "channel",
    table: channel,
    slugColumn: channel.id,
    idColumn: channel.id,
    prefix: "chan",
    kindAlias: "channel",
  },
  {
    entity: "threads",
    singular: "thread",
    table: thread,
    slugColumn: thread.id,
    idColumn: thread.id,
    prefix: "thrd",
    kindAlias: "thread",
  },
  {
    entity: "turns",
    singular: "thread turn",
    table: threadTurn,
    slugColumn: threadTurn.id,
    idColumn: threadTurn.id,
    prefix: "turn",
    kindAlias: "thread-turn",
  },
]
