import { and, eq } from "drizzle-orm"

import type { Database } from "../../db/connection"
import { identityLink, principal } from "../../db/schema/org"
import { logger } from "../../logger"

export interface ChannelAddress {
  provider: string
  target: string
}

export function parseChannelAddress(channelId: string): ChannelAddress | null {
  const colonIdx = channelId.indexOf(":")
  if (colonIdx === -1) return null
  return {
    provider: channelId.slice(0, colonIdx),
    target: channelId.slice(colonIdx + 1),
  }
}

export async function resolveDeliveryTarget(
  db: Database,
  address: ChannelAddress,
  ownerId: string
): Promise<ChannelAddress | null> {
  if (!address.target.startsWith("@")) {
    return address
  }

  if (address.provider === "email") {
    return resolveEmailTarget(db, ownerId)
  }

  if (address.provider === "web") {
    return { provider: "web", target: ownerId }
  }

  return resolveIdentityLinkTarget(db, address.provider, ownerId)
}

async function resolveIdentityLinkTarget(
  db: Database,
  provider: string,
  principalId: string
): Promise<ChannelAddress | null> {
  const rows = await db
    .select({ externalId: identityLink.externalId })
    .from(identityLink)
    .where(
      and(
        eq(identityLink.principalId, principalId),
        eq(identityLink.type, provider)
      )
    )
    .limit(1)

  if (rows.length === 0) {
    logger.debug(
      { provider, principalId },
      "identity-resolver: no identity link found"
    )
    return null
  }

  return { provider, target: rows[0].externalId }
}

async function resolveEmailTarget(
  db: Database,
  principalId: string
): Promise<ChannelAddress | null> {
  const rows = await db
    .select({ spec: principal.spec })
    .from(principal)
    .where(eq(principal.id, principalId))
    .limit(1)

  const spec = rows[0]?.spec as { email?: string } | null
  if (!spec?.email) {
    logger.debug({ principalId }, "identity-resolver: no email found")
    return null
  }

  return { provider: "email", target: spec.email }
}
