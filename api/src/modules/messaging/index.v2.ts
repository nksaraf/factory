/**
 * Messaging controller.
 *
 * Route → table mapping:
 *   /messaging/providers → org.messaging_provider
 */
import {
  LinkMessagingUserBody,
  MapChannelBody,
} from "@smp/factory-shared/schemas/actions"
import {
  CreateMessagingProviderSchema,
  UpdateMessagingProviderSchema,
} from "@smp/factory-shared/schemas/org"
import { eq } from "drizzle-orm"
import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import { messagingProvider } from "../../db/schema/org-v2"
import { ontologyRoutes } from "../../lib/crud"

export function messagingControllerV2(db: Database) {
  return new Elysia({ prefix: "/messaging" }).use(
    ontologyRoutes(db, {
      schema: "org",
      entity: "providers",
      singular: "messaging provider",
      table: messagingProvider,
      slugColumn: messagingProvider.slug,
      idColumn: messagingProvider.id,
      createSchema: CreateMessagingProviderSchema,
      updateSchema: UpdateMessagingProviderSchema,
      deletable: true,
      actions: {
        test: {
          handler: async ({ entity }) => {
            // Return current provider status — actual connection test
            // requires the messaging adapter (wired separately)
            const spec = entity.spec as Record<string, unknown>
            return { connected: spec.status === "active", status: spec.status }
          },
        },
        "sync-users": {
          handler: async ({ db, entity }) => {
            const spec = entity.spec as Record<string, unknown>
            const [row] = await db
              .update(messagingProvider)
              .set({
                spec: { ...spec, lastSyncAt: new Date() } as any,
                updatedAt: new Date(),
              })
              .where(eq(messagingProvider.id, entity.id as string))
              .returning()
            return row
          },
        },
        "map-channel": {
          bodySchema: MapChannelBody,
          handler: async ({ db, entity, body }) => {
            const b = body as MapChannelBody
            const spec = entity.spec as Record<string, unknown>
            const channels = (spec.channelMappings ?? []) as Array<
              Record<string, unknown>
            >
            channels.push({
              externalChannelId: b.externalChannelId,
              externalChannelName: b.externalChannelName,
              teamId: b.teamId,
              mappedAt: new Date(),
            })
            const [row] = await db
              .update(messagingProvider)
              .set({
                spec: { ...spec, channelMappings: channels } as any,
                updatedAt: new Date(),
              })
              .where(eq(messagingProvider.id, entity.id as string))
              .returning()
            return row
          },
        },
        "unmap-channel": {
          bodySchema: MapChannelBody,
          handler: async ({ db, entity, body }) => {
            const b = body as MapChannelBody
            const spec = entity.spec as Record<string, unknown>
            const channels = (
              (spec.channelMappings ?? []) as Array<Record<string, unknown>>
            ).filter((ch) => ch.externalChannelId !== b.externalChannelId)
            const [row] = await db
              .update(messagingProvider)
              .set({
                spec: { ...spec, channelMappings: channels } as any,
                updatedAt: new Date(),
              })
              .where(eq(messagingProvider.id, entity.id as string))
              .returning()
            return row
          },
        },
        "link-user": {
          bodySchema: LinkMessagingUserBody,
          handler: async ({ db, entity, body }) => {
            const b = body as LinkMessagingUserBody
            const spec = entity.spec as Record<string, unknown>
            const links = (spec.userMappings ?? []) as Array<
              Record<string, unknown>
            >
            links.push({
              externalUserId: b.externalUserId,
              principalId: b.principalId,
              linkedAt: new Date(),
            })
            const [row] = await db
              .update(messagingProvider)
              .set({
                spec: { ...spec, userMappings: links } as any,
                updatedAt: new Date(),
              })
              .where(eq(messagingProvider.id, entity.id as string))
              .returning()
            return row
          },
        },
      },
    })
  )
}
