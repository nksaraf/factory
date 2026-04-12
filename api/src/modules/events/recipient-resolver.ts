import { eq } from "drizzle-orm"

import type { Database } from "../../db/connection"
import { membership, principal, team } from "../../db/schema/org"
import { logger } from "../../logger"

interface RecipientAddress {
  kind: "principal" | "team" | "on-call"
  id: string
}

export interface ResolvedRecipient {
  principalId: string
  channels: string[]
}

const DEFAULT_CHANNELS = ["slack", "web"]

export function parseRecipient(to: string): RecipientAddress {
  if (to.startsWith("team:")) {
    return { kind: "team", id: to.slice(5) }
  }
  if (to.startsWith("on-call:")) {
    return { kind: "on-call", id: to.slice(8) }
  }
  return { kind: "principal", id: to }
}

export function getNotificationChannels(
  spec: Record<string, unknown> | null | undefined
): string[] {
  if (!spec) return DEFAULT_CHANNELS
  const prefs = spec.notificationPreferences as
    | {
        defaultChannels?: string[]
        muted?: boolean
      }
    | undefined
  if (!prefs) return DEFAULT_CHANNELS
  if (prefs.muted) return []
  return prefs.defaultChannels ?? DEFAULT_CHANNELS
}

export async function resolveRecipients(
  db: Database,
  to: string,
  channelOverrides?: string[]
): Promise<ResolvedRecipient[]> {
  const addr = parseRecipient(to)

  switch (addr.kind) {
    case "principal":
      return resolvePrincipal(db, addr.id, channelOverrides)
    case "team":
      return resolveTeam(db, addr.id, channelOverrides)
    case "on-call":
      return resolveOnCall(db, addr.id, channelOverrides)
    default:
      return []
  }
}

async function resolvePrincipal(
  db: Database,
  principalId: string,
  channelOverrides?: string[]
): Promise<ResolvedRecipient[]> {
  const rows = await db
    .select({ id: principal.id, spec: principal.spec })
    .from(principal)
    .where(eq(principal.id, principalId))
    .limit(1)

  if (rows.length === 0) {
    logger.warn({ principalId }, "recipient-resolver: principal not found")
    return []
  }

  const spec = rows[0].spec as Record<string, unknown> | null
  const channels = channelOverrides ?? getNotificationChannels(spec)
  return [{ principalId: rows[0].id, channels }]
}

async function resolveTeam(
  db: Database,
  teamSlug: string,
  channelOverrides?: string[]
): Promise<ResolvedRecipient[]> {
  // Find team by slug
  const teams = await db
    .select({ id: team.id })
    .from(team)
    .where(eq(team.slug, teamSlug))
    .limit(1)

  if (teams.length === 0) {
    logger.warn({ teamSlug }, "recipient-resolver: team not found")
    return []
  }

  // Get all members with their principal data
  const members = await db
    .select({
      principalId: membership.principalId,
      principalSpec: principal.spec,
    })
    .from(membership)
    .innerJoin(principal, eq(membership.principalId, principal.id))
    .where(eq(membership.teamId, teams[0].id))

  return members.map((m) => ({
    principalId: m.principalId,
    channels:
      channelOverrides ??
      getNotificationChannels(m.principalSpec as Record<string, unknown>),
  }))
}

async function resolveOnCall(
  db: Database,
  teamSlug: string,
  channelOverrides?: string[]
): Promise<ResolvedRecipient[]> {
  // For now, on-call resolves to the team lead or first member.
  // In the future, integrate with PagerDuty/Opsgenie schedule.
  logger.debug(
    { teamSlug },
    "recipient-resolver: on-call resolving to team members (schedule integration pending)"
  )
  return resolveTeam(db, teamSlug, channelOverrides)
}
