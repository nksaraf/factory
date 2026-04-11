import { and, desc, eq, gte, lte, ne, sql } from "drizzle-orm"
import type { Database } from "../../db/connection"
import {
  identityLink,
  principal,
  membership,
  secret,
  toolCredential,
  toolUsage,
} from "../../db/schema/org-v2"
import { allocateSlug } from "../../lib/slug"
import type { PrincipalProfile } from "@smp/factory-shared"

const PROFILE_MERGE_PRIORITY: string[] = ["github", "google", "slack", "jira"]

export class IdentityService {
  constructor(private readonly db: Database) {}

  // ─── Principal Resolution ───────────────────────────────────

  async resolveOrCreatePrincipal(opts: {
    authUserId: string
    email?: string
    name?: string
    provider?: string
    externalUserId?: string
    externalLogin?: string
    profileData?: Record<string, unknown>
  }) {
    // Try to find existing principal by authUserId (stored in spec JSONB)
    const [existing] = await this.db
      .select()
      .from(principal)
      .where(sql`${principal.spec}->>'authUserId' = ${opts.authUserId}`)
      .limit(1)

    if (existing) return existing

    // Create new principal
    const displayName = opts.name || opts.email?.split("@")[0] || "user"
    const slug = await allocateSlug({
      baseLabel: displayName,
      explicitSlug: undefined,
      isTaken: async (s) => {
        const [r] = await this.db
          .select()
          .from(principal)
          .where(eq(principal.slug, s))
          .limit(1)
        return r != null
      },
    })

    const [created] = await this.db
      .insert(principal)
      .values({
        name: displayName,
        slug,
        type: "human",
        spec: {
          authUserId: opts.authUserId,
          email: opts.email ?? undefined,
          status: "active",
        },
        metadata: {},
      })
      .returning()

    // If provider info was given, create the identity link
    if (opts.provider && opts.externalUserId) {
      await this.linkIdentity(created.id, opts.provider, {
        externalUserId: opts.externalUserId,
        externalLogin: opts.externalLogin,
        email: opts.email,
        profileData: opts.profileData ?? {},
      })
    }

    return created
  }

  async getPrincipalByAuthUserId(authUserId: string) {
    const [row] = await this.db
      .select()
      .from(principal)
      .where(sql`${principal.spec}->>'authUserId' = ${authUserId}`)
      .limit(1)
    return row ?? null
  }

  async findPrincipalByEmail(email: string) {
    const [row] = await this.db
      .select()
      .from(principal)
      .where(sql`${principal.spec}->>'email' = ${email}`)
      .limit(1)
    return row ?? null
  }

  /**
   * Find a principal by an existing identity link from another provider.
   * e.g., if a GitHub user has login "jdoe" and we already have a Slack identity
   * link with externalUsername "jdoe" pointing to a principal, return that principal.
   */
  async findPrincipalByExternalLogin(login: string, excludeProvider?: string) {
    const conditions = [
      sql`${identityLink.spec}->>'externalUsername' = ${login}`,
    ]
    if (excludeProvider) {
      conditions.push(ne(identityLink.type, excludeProvider))
    }

    const [link] = await this.db
      .select({ principalId: identityLink.principalId })
      .from(identityLink)
      .where(and(...conditions))
      .limit(1)

    if (!link) return null

    const [found] = await this.db
      .select()
      .from(principal)
      .where(eq(principal.id, link.principalId))
      .limit(1)
    return found ?? null
  }

  /**
   * Multi-signal principal resolution. Tries matching in order of confidence:
   * 1. Email (highest confidence)
   * 2. Existing identity link for same provider + externalId
   * 3. Cross-provider login/username match
   *
   * Returns { principal, matchSignal } or null if no match found.
   */
  async findPrincipalMultiSignal(opts: {
    email: string | null
    login: string | null
    externalUserId: string
    provider: string
  }): Promise<{
    principal: typeof principal.$inferSelect
    matchSignal: string
  } | null> {
    // 1. Email match (highest confidence)
    if (opts.email) {
      const found = await this.findPrincipalByEmail(opts.email)
      if (found) return { principal: found, matchSignal: "email" }
    }

    // 2. Existing identity link for same provider + externalId
    const existingLink = await this.db
      .select({ principalId: identityLink.principalId })
      .from(identityLink)
      .where(
        and(
          eq(identityLink.type, opts.provider),
          eq(identityLink.externalId, opts.externalUserId)
        )
      )
      .limit(1)

    if (existingLink.length > 0) {
      const [found] = await this.db
        .select()
        .from(principal)
        .where(eq(principal.id, existingLink[0].principalId))
        .limit(1)
      if (found) return { principal: found, matchSignal: "existing-link" }
    }

    // 3. Cross-provider login match (lower confidence)
    if (opts.login) {
      const found = await this.findPrincipalByExternalLogin(
        opts.login,
        opts.provider
      )
      if (found)
        return { principal: found, matchSignal: "cross-provider-login" }
    }

    return null
  }

  /**
   * Mark a principal as deactivated (departed employee).
   * Preserves identity links and attributions, just changes status in spec.
   */
  async deactivatePrincipal(principalId: string) {
    const [row] = await this.db
      .update(principal)
      .set({
        spec: sql`${principal.spec} || '{"status":"deactivated"}'::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(principal.id, principalId))
      .returning()
    return row ?? null
  }

  // ─── Identity Links ────────────────────────────────────────

  async linkIdentity(
    principalId: string,
    provider: string,
    data: {
      externalUserId: string
      externalLogin?: string
      email?: string
      profileData?: Record<string, unknown>
    }
  ) {
    const spec = {
      externalUsername: data.externalLogin ?? undefined,
      email: data.email ?? undefined,
      profileData: data.profileData ?? {},
      scopes: [] as string[],
    }

    const [row] = await this.db
      .insert(identityLink)
      .values({
        principalId,
        type: provider,
        externalId: data.externalUserId,
        spec,
      } as any)
      .onConflictDoUpdate({
        target: [identityLink.principalId, identityLink.type],
        set: {
          externalId: data.externalUserId,
          spec: sql`${identityLink.spec} || ${JSON.stringify(spec)}::jsonb`,
          updatedAt: new Date(),
        },
      })
      .returning()
    return row
  }

  async unlinkIdentity(principalId: string, provider: string) {
    await this.db
      .delete(identityLink)
      .where(
        and(
          eq(identityLink.principalId, principalId),
          eq(identityLink.type, provider)
        )
      )
  }

  async getLinkedIdentities(principalId: string) {
    return this.db
      .select()
      .from(identityLink)
      .where(eq(identityLink.principalId, principalId))
  }

  // ─── Profile Merge ─────────────────────────────────────────

  async refreshPrincipalProfile(principalId: string) {
    const links = await this.getLinkedIdentities(principalId)
    const [found] = await this.db
      .select()
      .from(principal)
      .where(eq(principal.id, principalId))
      .limit(1)

    if (!found) return null

    const userOverrides = (found.metadata as Record<string, unknown>)
      ?.userOverrides as Partial<PrincipalProfile> | undefined

    // Build merged profile from identity links in priority order
    const merged: PrincipalProfile = {}

    // Apply provider data in reverse priority (lowest first, highest overwrites)
    for (const provider of [...PROFILE_MERGE_PRIORITY].reverse()) {
      const link = links.find((l) => l.type === provider)
      if (!link) continue

      const data = (link.spec as Record<string, unknown>)?.profileData as
        | Record<string, unknown>
        | undefined
      if (!data) continue

      if (data.avatarUrl) merged.avatarUrl = data.avatarUrl as string
      if (data.displayName) merged.displayName = data.displayName as string
      if (data.bio)
        merged.bio = data.bio as string

        // Store provider-specific sub-object
      ;(merged as Record<string, unknown>)[provider] = data
    }

    // User overrides always win
    if (userOverrides) {
      Object.assign(merged, userOverrides)
    }

    // Update principal spec with merged profile data
    const currentSpec = (found.spec ?? {}) as Record<string, unknown>
    const updatedSpec = {
      ...currentSpec,
      avatarUrl: merged.avatarUrl ?? currentSpec.avatarUrl,
      displayName: merged.displayName ?? currentSpec.displayName,
    }

    await this.db
      .update(principal)
      .set({ spec: updatedSpec as any, updatedAt: new Date() })
      .where(eq(principal.id, principalId))

    return merged
  }

  async updateProfileOverrides(
    principalId: string,
    overrides: Partial<PrincipalProfile>
  ) {
    const [found] = await this.db
      .select()
      .from(principal)
      .where(eq(principal.id, principalId))
      .limit(1)

    if (!found) return null

    const metadata = (found.metadata ?? {}) as Record<string, unknown>
    metadata.userOverrides = {
      ...((metadata.userOverrides as Record<string, unknown>) ?? {}),
      ...overrides,
    }

    await this.db
      .update(principal)
      .set({ metadata: metadata as any, updatedAt: new Date() })
      .where(eq(principal.id, principalId))

    return this.refreshPrincipalProfile(principalId)
  }

  // ─── Principal Merge ───────────────────────────────────────

  /**
   * Merge duplicate principals into one within a transaction.
   * Moves identity links, team memberships, tool credentials, tool usage,
   * and secret attribution from `duplicateId` to `keepId`, then deletes
   * the duplicate principal.
   * Returns the number of identity links moved.
   */
  async mergePrincipals(keepId: string, duplicateId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      // ── Identity links ──────────────────────────────────
      const dupLinks = await tx
        .select()
        .from(identityLink)
        .where(eq(identityLink.principalId, duplicateId))

      const keepLinks = await tx
        .select()
        .from(identityLink)
        .where(eq(identityLink.principalId, keepId))

      const keepProviders = new Set(keepLinks.map((l) => l.type))
      let moved = 0

      for (const link of dupLinks) {
        if (keepProviders.has(link.type)) {
          await tx.delete(identityLink).where(eq(identityLink.id, link.id))
        } else {
          await tx
            .update(identityLink)
            .set({ principalId: keepId, updatedAt: new Date() })
            .where(eq(identityLink.id, link.id))
          moved++
        }
      }

      // ── Team memberships ────────────────────────────────
      const dupMemberships = await tx
        .select()
        .from(membership)
        .where(eq(membership.principalId, duplicateId))

      const keepMemberships = await tx
        .select()
        .from(membership)
        .where(eq(membership.principalId, keepId))

      const keepTeams = new Set(keepMemberships.map((m) => m.teamId))

      for (const m of dupMemberships) {
        if (keepTeams.has(m.teamId)) {
          await tx.delete(membership).where(eq(membership.id, m.id))
        } else {
          await tx
            .update(membership)
            .set({ principalId: keepId })
            .where(eq(membership.id, m.id))
        }
      }

      // ── Tool credentials ────────────────────────────────
      const dupCreds = await tx
        .select()
        .from(toolCredential)
        .where(eq(toolCredential.principalId, duplicateId))

      for (const c of dupCreds) {
        await tx
          .update(toolCredential)
          .set({ principalId: keepId })
          .where(eq(toolCredential.id, c.id))
      }

      // ── Tool usage ──────────────────────────────────────
      await tx
        .update(toolUsage)
        .set({ principalId: keepId })
        .where(eq(toolUsage.principalId, duplicateId))

      // ── Secret attribution ──────────────────────────────
      await tx
        .update(secret)
        .set({ createdBy: keepId })
        .where(eq(secret.createdBy, duplicateId))

      // ── Promote email ───────────────────────────────────
      const [keepPrincipal] = await tx
        .select()
        .from(principal)
        .where(eq(principal.id, keepId))
        .limit(1)
      const [dupPrincipal] = await tx
        .select()
        .from(principal)
        .where(eq(principal.id, duplicateId))
        .limit(1)

      const keepEmail = (keepPrincipal?.spec as Record<string, unknown>)?.email
      const dupEmail = (dupPrincipal?.spec as Record<string, unknown>)?.email

      if (dupPrincipal && keepPrincipal && !keepEmail && dupEmail) {
        await tx
          .update(principal)
          .set({
            spec: sql`${principal.spec} || ${JSON.stringify({ email: dupEmail })}::jsonb`,
            updatedAt: new Date(),
          })
          .where(eq(principal.id, keepId))
      }

      // ── Delete duplicate ────────────────────────────────
      await tx.delete(principal).where(eq(principal.id, duplicateId))

      return moved
    })
  }

  // ─── Tool Credentials ──────────────────────────────────────

  async createToolCredential(
    principalId: string,
    body: { provider: string; keyName: string; keyHash: string }
  ) {
    const keyPrefix = body.keyHash.slice(0, 8)
    const [row] = await this.db
      .insert(toolCredential)
      .values({
        principalId,
        spec: {
          provider: body.provider,
          encryptedKey: body.keyHash,
          label: body.keyName,
        },
      })
      .returning()
    return row
  }

  async listToolCredentials(principalId: string) {
    return this.db
      .select()
      .from(toolCredential)
      .where(eq(toolCredential.principalId, principalId))
  }

  async revokeToolCredential(principalId: string, credentialId: string) {
    // In v2, toolCredential doesn't have a status column — delete instead
    const [row] = await this.db
      .delete(toolCredential)
      .where(
        and(
          eq(toolCredential.id, credentialId),
          eq(toolCredential.principalId, principalId)
        )
      )
      .returning()
    return row ?? null
  }

  // ─── Tool Usage ────────────────────────────────────────────

  async reportToolUsage(
    principalId: string,
    body: {
      tool: string
      sessionId?: string
      model?: string
      inputTokens?: number
      outputTokens?: number
      cacheReadTokens?: number
      costMicrodollars?: number
      metadata?: Record<string, unknown>
    }
  ) {
    const [row] = await this.db
      .insert(toolUsage)
      .values({
        principalId,
        tool: body.tool,
        costMicrodollars: body.costMicrodollars ?? 0,
        spec: {
          inputTokens: body.inputTokens ?? 0,
          outputTokens: body.outputTokens ?? 0,
          cacheReadTokens: body.cacheReadTokens ?? 0,
          model: body.model,
        },
      })
      .returning()
    return row
  }

  async queryToolUsage(
    principalId: string,
    q?: {
      tool?: string
      since?: string
      until?: string
      limit?: number
      offset?: number
    }
  ) {
    const conditions = [eq(toolUsage.principalId, principalId)]
    if (q?.tool) conditions.push(eq(toolUsage.tool, q.tool))
    if (q?.since) conditions.push(gte(toolUsage.createdAt, new Date(q.since)))
    if (q?.until) conditions.push(lte(toolUsage.createdAt, new Date(q.until)))

    const rows = await this.db
      .select()
      .from(toolUsage)
      .where(and(...conditions))
      .orderBy(desc(toolUsage.createdAt))
      .limit(q?.limit ?? 100)
      .offset(q?.offset ?? 0)

    return { data: rows, count: rows.length }
  }
}
