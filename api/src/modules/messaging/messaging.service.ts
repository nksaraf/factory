import { eq, and, sql } from "drizzle-orm"
import type { Database } from "../../db/connection"
import {
  messagingProvider,
  channel,
  thread,
  threadTurn,
  identityLink,
  principal,
} from "../../db/schema/org"
import { getMessagingAdapter } from "../../adapters/adapter-registry"
import type {
  MessagingConfig,
  MessagingType,
} from "../../adapters/messaging-adapter"
import type {
  MessagingProviderSpec,
  ChannelSpec,
  ThreadSpec,
  IdentityLinkSpec,
} from "@smp/factory-shared/schemas/org"
import { allocateSlug } from "../../lib/slug"
import { logger } from "../../logger"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function providerConfig(
  provider: typeof messagingProvider.$inferSelect
): MessagingConfig {
  const spec = provider.spec as MessagingProviderSpec
  return {
    botToken: spec?.botToken ?? "",
    signingSecret: spec?.signingSecret ?? "",
    workspaceExternalId: spec?.workspaceId ?? undefined,
  }
}

// ---------------------------------------------------------------------------
// Provider CRUD
// ---------------------------------------------------------------------------

export async function listMessagingProviders(
  db: Database,
  filters?: { status?: string }
) {
  const rows = await db.select().from(messagingProvider)
  if (filters?.status) {
    return {
      data: rows.filter(
        (r) => (r.spec as MessagingProviderSpec)?.status === filters.status
      ),
      total: rows.filter(
        (r) => (r.spec as MessagingProviderSpec)?.status === filters.status
      ).length,
    }
  }
  return { data: rows, total: rows.length }
}

export async function getMessagingProvider(db: Database, idOrSlug: string) {
  let rows = await db
    .select()
    .from(messagingProvider)
    .where(eq(messagingProvider.id, idOrSlug))
  if (rows.length === 0) {
    rows = await db
      .select()
      .from(messagingProvider)
      .where(eq(messagingProvider.slug, idOrSlug))
  }
  return rows[0] ?? null
}

export async function createMessagingProvider(
  db: Database,
  data: {
    name: string
    type: string
    teamId: string
    workspaceId?: string
    botToken?: string
    signingSecret?: string
  }
) {
  const slug = await allocateSlug({
    baseLabel: data.name,
    isTaken: async (s) => {
      const existing = await db
        .select()
        .from(messagingProvider)
        .where(eq(messagingProvider.slug, s))
      return existing.length > 0
    },
  })
  const rows = await db
    .insert(messagingProvider)
    .values({
      name: data.name,
      slug,
      type: data.type,
      teamId: data.teamId,
      spec: {
        workspaceId: data.workspaceId,
        botToken: data.botToken,
        signingSecret: data.signingSecret,
        status: "active",
      } satisfies MessagingProviderSpec,
    })
    .returning()
  return rows[0]
}

export async function testMessagingProviderConnection(
  db: Database,
  providerId: string
) {
  const provider = await getMessagingProvider(db, providerId)
  if (!provider) return { ok: false, error: "provider_not_found" }

  const adapter = getMessagingAdapter(provider.type as MessagingType)
  return adapter.testConnection(providerConfig(provider))
}

// ---------------------------------------------------------------------------
// Channel Mapping (org.channel with kind='slack')
// ---------------------------------------------------------------------------

export async function mapChannel(
  db: Database,
  data: {
    messagingProviderId: string
    externalChannelId: string
    externalChannelName?: string
    entityKind: string
    entityId: string
    isDefault?: boolean
  }
) {
  const rows = await db
    .insert(channel)
    .values({
      kind: "slack",
      externalId: data.externalChannelId,
      name: data.externalChannelName ?? null,
      spec: {
        messagingProviderId: data.messagingProviderId,
        entityKind: data.entityKind,
        entityId: data.entityId,
        isDefault: data.isDefault ?? false,
      } satisfies ChannelSpec,
    })
    .returning()
  return rows[0]
}

export async function unmapChannel(db: Database, channelId: string) {
  await db.delete(channel).where(eq(channel.id, channelId))
}

export async function listChannelMappings(db: Database, providerId: string) {
  const rows = await db
    .select()
    .from(channel)
    .where(
      and(
        eq(channel.kind, "slack"),
        sql`${channel.spec}->>'messagingProviderId' = ${providerId}`
      )
    )
  return { data: rows, total: rows.length }
}

export async function resolveChannelContext(
  db: Database,
  providerId: string,
  externalChannelId: string
) {
  const rows = await db
    .select()
    .from(channel)
    .where(
      and(
        eq(channel.kind, "slack"),
        eq(channel.externalId, externalChannelId),
        sql`${channel.spec}->>'messagingProviderId' = ${providerId}`
      )
    )
    .limit(1)
  if (rows.length === 0) return null
  const spec = rows[0].spec as ChannelSpec
  return { entityKind: spec.entityKind ?? "", entityId: spec.entityId ?? "" }
}

// ---------------------------------------------------------------------------
// Identity Resolution (org.identity_link)
// ---------------------------------------------------------------------------

export async function resolveMessagingUser(
  db: Database,
  providerKind: string,
  externalUserId: string
): Promise<string | null> {
  const rows = await db
    .select({ principalId: identityLink.principalId })
    .from(identityLink)
    .where(
      and(
        eq(identityLink.type, providerKind),
        eq(identityLink.externalId, externalUserId)
      )
    )
    .limit(1)
  return rows[0]?.principalId ?? null
}

export async function syncProviderUsers(
  db: Database,
  providerId: string
): Promise<{ linked: number; unlinked: number; total: number }> {
  const provider = await getMessagingProvider(db, providerId)
  if (!provider) throw new Error("provider_not_found")

  const adapter = getMessagingAdapter(provider.type as MessagingType)
  const externalUsers = await adapter.listUsers(providerConfig(provider))

  let linked = 0
  let unlinked = 0

  for (const extUser of externalUsers) {
    if (extUser.isBot || extUser.deleted || !extUser.email) {
      continue
    }

    // Find a principal by email in spec JSONB
    const principals = await db
      .select()
      .from(principal)
      .where(sql`${principal.spec}->>'email' = ${extUser.email}`)
      .limit(1)

    if (principals.length === 0) {
      unlinked++
      continue
    }

    const prin = principals[0]

    // Check if link already exists
    const existingLinks = await db
      .select()
      .from(identityLink)
      .where(
        and(
          eq(identityLink.type, provider.type),
          eq(identityLink.externalId, extUser.id)
        )
      )
      .limit(1)

    if (existingLinks.length > 0) {
      // Update if principal changed
      if (existingLinks[0].principalId !== prin.id) {
        await db
          .update(identityLink)
          .set({
            principalId: prin.id,
            spec: {
              email: extUser.email,
              externalUsername: extUser.displayName,
              profileData: {
                realName: extUser.realName,
                avatarUrl: extUser.avatarUrl,
              },
            } as IdentityLinkSpec,
            updatedAt: new Date(),
          })
          .where(eq(identityLink.id, existingLinks[0].id))
      }
      linked++
      continue
    }

    // Create new identity link
    await db.insert(identityLink).values({
      principalId: prin.id,
      type: provider.type,
      externalId: extUser.id,
      spec: {
        externalUsername: extUser.displayName,
        email: extUser.email,
        profileData: {
          realName: extUser.realName,
          avatarUrl: extUser.avatarUrl,
        },
      } as IdentityLinkSpec,
    })
    linked++
  }

  logger.info(
    { providerId, linked, unlinked, total: externalUsers.length },
    "messaging user sync complete"
  )

  return { linked, unlinked, total: externalUsers.length }
}

export async function linkMessagingUser(
  db: Database,
  providerKind: string,
  externalUserId: string,
  principalId: string
) {
  await db
    .insert(identityLink)
    .values({
      principalId,
      type: providerKind,
      externalId: externalUserId,
    })
    .onConflictDoUpdate({
      target: [identityLink.type, identityLink.externalId],
      set: { principalId, updatedAt: new Date() },
    })
}

export async function unlinkMessagingUser(
  db: Database,
  providerKind: string,
  externalUserId: string
) {
  await db
    .delete(identityLink)
    .where(
      and(
        eq(identityLink.type, providerKind),
        eq(identityLink.externalId, externalUserId)
      )
    )
}

// ---------------------------------------------------------------------------
// Message Threads (org.thread with type='chat', source='slack')
// ---------------------------------------------------------------------------

export async function getOrCreateThread(
  db: Database,
  data: {
    messagingProviderId: string
    externalChannelId: string
    externalThreadId: string
    initiatorPrincipalId?: string
    subject?: string
  }
) {
  // Try to find existing thread by source + external ID
  const existing = await db
    .select()
    .from(thread)
    .where(
      and(
        eq(thread.source, "slack"),
        eq(thread.externalId, data.externalThreadId)
      )
    )
    .limit(1)

  if (existing.length > 0) return existing[0]

  // Resolve the channel to link the thread
  const channelRows = await db
    .select()
    .from(channel)
    .where(
      and(
        eq(channel.kind, "slack"),
        eq(channel.externalId, data.externalChannelId)
      )
    )
    .limit(1)

  const rows = await db
    .insert(thread)
    .values({
      type: "chat",
      source: "slack",
      externalId: data.externalThreadId,
      principalId: data.initiatorPrincipalId ?? null,
      channelId: channelRows[0]?.id ?? null,
      status: "active",
      startedAt: new Date(),
      spec: {
        title: data.subject,
        messagingProviderId: data.messagingProviderId,
      } satisfies ThreadSpec,
    })
    .returning()
  return rows[0]
}

export async function appendMessage(
  db: Database,
  threadId: string,
  message: {
    role: string
    text: string
    externalUserId?: string
    principalId?: string
    timestamp: string
  }
) {
  await db.execute(sql`
    INSERT INTO org.thread_turn (thread_id, turn_index, role, spec)
    VALUES (
      ${threadId},
      (SELECT COALESCE(MAX(turn_index), -1) + 1 FROM org.thread_turn WHERE thread_id = ${threadId}),
      ${message.role},
      ${JSON.stringify({ message: message.text, timestamp: message.timestamp })}::jsonb
    )
  `)

  await db
    .update(thread)
    .set({ updatedAt: new Date() })
    .where(eq(thread.id, threadId))
}

export async function resolveThread(db: Database, threadId: string) {
  await db
    .update(thread)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(thread.id, threadId))
}

export async function listThreads(
  db: Database,
  providerId: string,
  filters?: { status?: string }
) {
  const condition = filters?.status
    ? and(
        sql`${thread.spec}->>'messagingProviderId' = ${providerId}`,
        eq(thread.status, filters.status)
      )
    : sql`${thread.spec}->>'messagingProviderId' = ${providerId}`

  const rows = await db.select().from(thread).where(condition)
  return { data: rows, total: rows.length }
}

export async function getThread(db: Database, threadId: string) {
  const rows = await db
    .select()
    .from(thread)
    .where(eq(thread.id, threadId))
    .limit(1)
  return rows[0] ?? null
}
