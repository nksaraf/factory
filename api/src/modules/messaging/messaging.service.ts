import { eq, and } from "drizzle-orm";
import type { Database } from "../../db/connection";
import {
  messagingProvider,
  channelMapping,
  messageThread,
  identityLink,
  orgPrincipal,
} from "../../db/schema/org";
import { getMessagingAdapter } from "../../adapters/adapter-registry";
import type { MessagingConfig } from "../../adapters/messaging-adapter";
import { allocateSlug } from "../../lib/slug";
import { logger } from "../../logger";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function providerConfig(
  provider: typeof messagingProvider.$inferSelect,
): MessagingConfig {
  return {
    botToken: provider.botTokenEnc ?? "",
    signingSecret: provider.signingSecret ?? "",
    workspaceExternalId: provider.workspaceExternalId ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Provider CRUD
// ---------------------------------------------------------------------------

export async function listMessagingProviders(
  db: Database,
  filters?: { status?: string },
) {
  let query = db.select().from(messagingProvider);
  if (filters?.status) {
    query = query.where(
      eq(messagingProvider.status, filters.status),
    ) as typeof query;
  }
  const rows = await query;
  return { data: rows, total: rows.length };
}

export async function getMessagingProvider(db: Database, idOrSlug: string) {
  // Try by ID first, then by slug
  let rows = await db
    .select()
    .from(messagingProvider)
    .where(eq(messagingProvider.messagingProviderId, idOrSlug));
  if (rows.length === 0) {
    rows = await db
      .select()
      .from(messagingProvider)
      .where(eq(messagingProvider.slug, idOrSlug));
  }
  return rows[0] ?? null;
}

export async function createMessagingProvider(
  db: Database,
  data: {
    name: string;
    kind: string;
    teamId: string;
    workspaceExternalId?: string;
    botTokenEnc?: string;
    signingSecret?: string;
  },
) {
  const slug = await allocateSlug({
    baseLabel: data.name,
    isTaken: async (s) => {
      const existing = await db
        .select()
        .from(messagingProvider)
        .where(eq(messagingProvider.slug, s));
      return existing.length > 0;
    },
  });
  const rows = await db
    .insert(messagingProvider)
    .values({
      name: data.name,
      slug,
      kind: data.kind,
      teamId: data.teamId,
      workspaceExternalId: data.workspaceExternalId,
      botTokenEnc: data.botTokenEnc,
      signingSecret: data.signingSecret,
    })
    .returning();
  return rows[0];
}

export async function testMessagingProviderConnection(
  db: Database,
  providerId: string,
) {
  const provider = await getMessagingProvider(db, providerId);
  if (!provider) return { ok: false, error: "provider_not_found" };

  const adapter = getMessagingAdapter(provider.kind);
  return adapter.testConnection(providerConfig(provider));
}

// ---------------------------------------------------------------------------
// Channel Mapping
// ---------------------------------------------------------------------------

export async function mapChannel(
  db: Database,
  data: {
    messagingProviderId: string;
    externalChannelId: string;
    externalChannelName?: string;
    entityKind: string;
    entityId: string;
    isDefault?: boolean;
  },
) {
  const rows = await db
    .insert(channelMapping)
    .values({
      messagingProviderId: data.messagingProviderId,
      externalChannelId: data.externalChannelId,
      externalChannelName: data.externalChannelName,
      entityKind: data.entityKind,
      entityId: data.entityId,
      isDefault: data.isDefault ?? false,
    })
    .returning();
  return rows[0];
}

export async function unmapChannel(db: Database, channelMappingId: string) {
  await db
    .delete(channelMapping)
    .where(eq(channelMapping.channelMappingId, channelMappingId));
}

export async function listChannelMappings(
  db: Database,
  providerId: string,
) {
  const rows = await db
    .select()
    .from(channelMapping)
    .where(eq(channelMapping.messagingProviderId, providerId));
  return { data: rows, total: rows.length };
}

export async function resolveChannelContext(
  db: Database,
  providerId: string,
  externalChannelId: string,
) {
  const rows = await db
    .select()
    .from(channelMapping)
    .where(
      and(
        eq(channelMapping.messagingProviderId, providerId),
        eq(channelMapping.externalChannelId, externalChannelId),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  return { entityKind: rows[0].entityKind, entityId: rows[0].entityId };
}

// ---------------------------------------------------------------------------
// Identity Resolution (uses existing identityLink table)
// ---------------------------------------------------------------------------

export async function resolveMessagingUser(
  db: Database,
  providerKind: string,
  externalUserId: string,
): Promise<string | null> {
  const rows = await db
    .select({ principalId: identityLink.principalId })
    .from(identityLink)
    .where(
      and(
        eq(identityLink.provider, providerKind),
        eq(identityLink.externalUserId, externalUserId),
      ),
    )
    .limit(1);
  return rows[0]?.principalId ?? null;
}

export async function syncProviderUsers(
  db: Database,
  providerId: string,
): Promise<{ linked: number; unlinked: number; total: number }> {
  const provider = await getMessagingProvider(db, providerId);
  if (!provider) throw new Error("provider_not_found");

  const adapter = getMessagingAdapter(provider.kind);
  const externalUsers = await adapter.listUsers(providerConfig(provider));

  let linked = 0;
  let unlinked = 0;

  for (const extUser of externalUsers) {
    if (extUser.isBot || extUser.deleted || !extUser.email) {
      continue;
    }

    // Find a principal by email
    const principals = await db
      .select()
      .from(orgPrincipal)
      .where(eq(orgPrincipal.email, extUser.email))
      .limit(1);

    if (principals.length === 0) {
      unlinked++;
      continue;
    }

    const principal = principals[0];

    // Check if link already exists
    const existingLinks = await db
      .select()
      .from(identityLink)
      .where(
        and(
          eq(identityLink.provider, provider.kind),
          eq(identityLink.externalUserId, extUser.id),
        ),
      )
      .limit(1);

    if (existingLinks.length > 0) {
      // Update if principal changed
      if (existingLinks[0].principalId !== principal.principalId) {
        await db
          .update(identityLink)
          .set({
            principalId: principal.principalId,
            email: extUser.email,
            externalLogin: extUser.displayName,
            profileData: {
              realName: extUser.realName,
              avatarUrl: extUser.avatarUrl,
            },
            updatedAt: new Date(),
          })
          .where(
            eq(identityLink.identityLinkId, existingLinks[0].identityLinkId),
          );
      }
      linked++;
      continue;
    }

    // Create new identity link
    await db.insert(identityLink).values({
      principalId: principal.principalId,
      provider: provider.kind,
      externalUserId: extUser.id,
      externalLogin: extUser.displayName,
      email: extUser.email,
      profileData: {
        realName: extUser.realName,
        avatarUrl: extUser.avatarUrl,
      },
    });
    linked++;
  }

  logger.info(
    { providerId, linked, unlinked, total: externalUsers.length },
    "messaging user sync complete",
  );

  return { linked, unlinked, total: externalUsers.length };
}

export async function linkMessagingUser(
  db: Database,
  providerKind: string,
  externalUserId: string,
  principalId: string,
) {
  await db
    .insert(identityLink)
    .values({
      principalId,
      provider: providerKind,
      externalUserId,
    })
    .onConflictDoUpdate({
      target: [identityLink.provider, identityLink.externalUserId],
      set: { principalId, updatedAt: new Date() },
    });
}

export async function unlinkMessagingUser(
  db: Database,
  providerKind: string,
  externalUserId: string,
) {
  await db
    .delete(identityLink)
    .where(
      and(
        eq(identityLink.provider, providerKind),
        eq(identityLink.externalUserId, externalUserId),
      ),
    );
}

// ---------------------------------------------------------------------------
// Message Threads
// ---------------------------------------------------------------------------

export async function getOrCreateThread(
  db: Database,
  data: {
    messagingProviderId: string;
    externalChannelId: string;
    externalThreadId: string;
    initiatorPrincipalId?: string;
    subject?: string;
  },
) {
  // Try to find existing thread
  const existing = await db
    .select()
    .from(messageThread)
    .where(
      and(
        eq(messageThread.messagingProviderId, data.messagingProviderId),
        eq(messageThread.externalThreadId, data.externalThreadId),
      ),
    )
    .limit(1);

  if (existing.length > 0) return existing[0];

  // Create new thread
  const rows = await db
    .insert(messageThread)
    .values({
      messagingProviderId: data.messagingProviderId,
      externalChannelId: data.externalChannelId,
      externalThreadId: data.externalThreadId,
      initiatorPrincipalId: data.initiatorPrincipalId,
      subject: data.subject,
    })
    .returning();
  return rows[0];
}

export async function appendMessage(
  db: Database,
  threadId: string,
  message: {
    role: string;
    text: string;
    externalUserId?: string;
    principalId?: string;
    timestamp: string;
  },
) {
  const thread = await db
    .select()
    .from(messageThread)
    .where(eq(messageThread.messageThreadId, threadId))
    .limit(1);

  if (thread.length === 0) throw new Error("thread_not_found");

  const messages = (thread[0].messages as unknown[]) ?? [];
  messages.push(message);

  await db
    .update(messageThread)
    .set({ messages, updatedAt: new Date() })
    .where(eq(messageThread.messageThreadId, threadId));
}

export async function resolveThread(db: Database, threadId: string) {
  await db
    .update(messageThread)
    .set({ status: "resolved", updatedAt: new Date() })
    .where(eq(messageThread.messageThreadId, threadId));
}

export async function listThreads(
  db: Database,
  providerId: string,
  filters?: { status?: string },
) {
  const condition = filters?.status
    ? and(
        eq(messageThread.messagingProviderId, providerId),
        eq(messageThread.status, filters.status),
      )
    : eq(messageThread.messagingProviderId, providerId);

  const rows = await db
    .select()
    .from(messageThread)
    .where(condition);
  return { data: rows, total: rows.length };
}

export async function getThread(db: Database, threadId: string) {
  const rows = await db
    .select()
    .from(messageThread)
    .where(eq(messageThread.messageThreadId, threadId))
    .limit(1);
  return rows[0] ?? null;
}
