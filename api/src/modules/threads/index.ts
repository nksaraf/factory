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
import { eq } from "drizzle-orm"
import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import {
  channel,
  thread,
  threadParticipant,
  threadTurn,
} from "../../db/schema/org"
import { ontologyRoutes } from "../../lib/crud"

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
