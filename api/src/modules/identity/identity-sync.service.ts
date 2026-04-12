import { eq, and, sql } from "drizzle-orm"
import type { Database } from "../../db/connection"
import { identityLink, principal, messagingProvider } from "../../db/schema/org"
import { gitHostProvider, workTrackerProvider } from "../../db/schema/build"
import { IdentityService } from "./identity.service"
import { getIdentityProviderAdapter } from "../../adapters/adapter-registry"
import type {
  ExternalIdentityUser,
  IdentityProviderConfig,
  IdentityProviderType,
} from "../../adapters/identity-provider-adapter"
import { refreshGoogleAccessToken } from "../../adapters/identity-provider-adapter-google"
import type { SecretBackend } from "../../lib/secrets/secret-backend"
import { createSpecRefResolver } from "../../lib/spec-ref-resolver"
import { logger } from "../../logger"

export interface IdentitySyncResult {
  provider: string
  linked: number
  created: number
  skipped: number
  deactivated: number
  errors: number
}

/**
 * Orchestrates identity sync across all configured providers.
 *
 * Pass 1 — Discovery: fetch users from provider APIs, match by email, create/link principals.
 * Pass 2 — Refresh: update profileData for existing identity links with valid tokens.
 */
export class IdentitySyncService {
  private readonly identityService: IdentityService
  private cachedProviderConfigs: Array<{
    provider: IdentityProviderType
    config: IdentityProviderConfig
    sourceId: string
  }> | null = null

  constructor(
    private readonly db: Database,
    private readonly secrets: SecretBackend
  ) {
    this.identityService = new IdentityService(db)
  }

  async syncAllIdentities(): Promise<IdentitySyncResult[]> {
    const results: IdentitySyncResult[] = []
    const failedProviders = new Set<IdentityProviderType>()

    // ── Pass 1: Discovery ───────────────────────────────────────
    const providerConfigs = await this.gatherProviderConfigs()
    this.cachedProviderConfigs = providerConfigs

    try {
      const PROVIDER_TIMEOUT_MS = 60_000 // 60s per provider
      for (const { provider, config, sourceId } of providerConfigs) {
        try {
          const result = await Promise.race([
            this.runDiscoverySync(provider, config),
            new Promise<never>((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      `${provider} sync timed out after ${PROVIDER_TIMEOUT_MS}ms`
                    )
                  ),
                PROVIDER_TIMEOUT_MS
              )
            ),
          ])
          results.push(result)
          logger.info(
            { sourceId, ...result },
            "identity discovery sync complete"
          )
        } catch (err) {
          logger.error(
            { err, provider, sourceId },
            "identity discovery sync failed"
          )
          failedProviders.add(provider)
          results.push({
            provider,
            linked: 0,
            created: 0,
            skipped: 0,
            deactivated: 0,
            errors: 1,
          })
        }
      }

      // ── Pass 1.5: Fuzzy name merge ────────────────────────────
      const mergeResult = await this.runFuzzyNameMerge()
      if (mergeResult.merged > 0) {
        results.push({
          provider: "name-merge",
          linked: mergeResult.merged,
          created: 0,
          skipped: mergeResult.skipped,
          deactivated: 0,
          errors: 0,
        })
      }

      // ── Pass 2: Profile refresh (skip failed providers) ───────
      await this.runProfileRefresh(failedProviders)
    } finally {
      this.cachedProviderConfigs = null
    }

    return results
  }

  // ─── Discovery sync ───────��─────────────────────────────────

  // ─── Export / Import ─────────────────────────────────────────

  /**
   * Export users from a provider's API without writing to DB.
   * Returns the raw ExternalIdentityUser[] for serialization.
   */
  async exportUsers(
    providerType: IdentityProviderType
  ): Promise<ExternalIdentityUser[]> {
    const configs = await this.gatherProviderConfigs()
    const match = configs.find((c) => c.provider === providerType)
    if (!match) throw new Error(`No active ${providerType} provider configured`)

    const adapter = getIdentityProviderAdapter(providerType)
    return adapter.fetchUsers(match.config)
  }

  /**
   * Run cross-provider passes after import: fuzzy name merge + profile refresh.
   * Call this after one or more importUsers() calls to reconcile across providers.
   */
  async runCrossProviderSync(
    skipProviders?: Set<IdentityProviderType>
  ): Promise<IdentitySyncResult[]> {
    const results: IdentitySyncResult[] = []

    const mergeResult = await this.runFuzzyNameMerge()
    if (mergeResult.merged > 0) {
      results.push({
        provider: "name-merge",
        linked: mergeResult.merged,
        created: 0,
        skipped: mergeResult.skipped,
        deactivated: 0,
        errors: 0,
      })
    }

    await this.runProfileRefresh(skipProviders)

    return results
  }

  /**
   * Import pre-fetched external users into the DB — create/link principals
   * and identity links. Accepts users from any source (API, file, HTTP).
   */
  async importUsers(
    providerType: IdentityProviderType,
    externalUsers: ExternalIdentityUser[]
  ): Promise<IdentitySyncResult> {
    let linked = 0
    let created = 0
    let skipped = 0
    let deactivated = 0
    let errors = 0
    const affectedPrincipalIds = new Set<string>()

    for (const extUser of externalUsers) {
      // Skip bots always
      if (extUser.isBot) {
        skipped++
        continue
      }

      try {
        // Handle deleted/departed users — deactivate their principal
        if (extUser.deleted) {
          await this.handleDepartedUser(extUser, providerType)
          deactivated++
          continue
        }

        // Multi-signal matching: email → existing link → cross-provider login
        const match = await this.identityService.findPrincipalMultiSignal({
          email: extUser.email,
          login: extUser.login,
          externalUserId: extUser.externalUserId,
          provider: providerType,
        })

        if (match) {
          // Upsert identity link for matched principal
          await this.identityService.linkIdentity(
            match.principal.id,
            providerType,
            {
              externalUserId: extUser.externalUserId,
              externalLogin: extUser.login ?? undefined,
              email: extUser.email ?? undefined,
              profileData: extUser.profileData,
            }
          )

          logger.debug(
            {
              provider: providerType,
              externalUserId: extUser.externalUserId,
              principalId: match.principal.id,
              matchSignal: match.matchSignal,
            },
            "identity linked via multi-signal match"
          )

          linked++
          affectedPrincipalIds.add(match.principal.id)
        } else if (extUser.email) {
          // No match found but we have an email — auto-create principal
          const created_principal =
            await this.identityService.resolveOrCreatePrincipal({
              authUserId: `pending:${providerType}:${extUser.externalUserId}`,
              email: extUser.email,
              name:
                extUser.displayName ??
                extUser.login ??
                extUser.email.split("@")[0],
              provider: providerType,
              externalUserId: extUser.externalUserId,
              externalLogin: extUser.login ?? undefined,
              profileData: extUser.profileData,
            })
          created++
          affectedPrincipalIds.add(created_principal.id)
        } else {
          // No email and no multi-signal match — try cross-provider login one more time
          let existingPrincipal = extUser.login
            ? await this.identityService.findPrincipalByExternalLogin(
                extUser.login,
                providerType
              )
            : null

          if (existingPrincipal) {
            await this.identityService.linkIdentity(
              existingPrincipal.id,
              providerType,
              {
                externalUserId: extUser.externalUserId,
                externalLogin: extUser.login ?? undefined,
                profileData: extUser.profileData,
              }
            )
            linked++
            affectedPrincipalIds.add(existingPrincipal.id)
          } else {
            // Truly no match — create a stub principal from login/display name
            const displayName =
              extUser.displayName ?? extUser.login ?? extUser.externalUserId
            const created_principal =
              await this.identityService.resolveOrCreatePrincipal({
                authUserId: `pending:${providerType}:${extUser.externalUserId}`,
                name: displayName,
                provider: providerType,
                externalUserId: extUser.externalUserId,
                externalLogin: extUser.login ?? undefined,
                profileData: extUser.profileData,
              })
            created++
            affectedPrincipalIds.add(created_principal.id)
          }
        }
      } catch (err) {
        logger.error(
          {
            err,
            provider: providerType,
            externalUserId: extUser.externalUserId,
          },
          "identity link failed for user"
        )
        errors++
      }
    }

    // Refresh merged profiles for all affected principals
    for (const principalId of affectedPrincipalIds) {
      try {
        await this.identityService.refreshPrincipalProfile(principalId)
      } catch (err) {
        logger.error(
          { err, principalId },
          "profile merge failed after discovery sync"
        )
      }
    }

    return {
      provider: providerType,
      linked,
      created,
      skipped,
      deactivated,
      errors,
    }
  }

  private async runDiscoverySync(
    providerType: IdentityProviderType,
    config: IdentityProviderConfig
  ): Promise<IdentitySyncResult> {
    const adapter = getIdentityProviderAdapter(providerType)
    const externalUsers = await adapter.fetchUsers(config)
    return this.importUsers(providerType, externalUsers)
  }

  /**
   * Handle a user that has been deleted/deactivated in the external provider.
   * If they have an existing identity link, mark their principal as deactivated.
   */
  private async handleDepartedUser(
    extUser: {
      externalUserId: string
      login: string | null
      email: string | null
    },
    providerType: IdentityProviderType
  ): Promise<void> {
    const existingLinks = await this.db
      .select({ principalId: identityLink.principalId })
      .from(identityLink)
      .where(
        and(
          eq(identityLink.type, providerType),
          eq(identityLink.externalId, extUser.externalUserId)
        )
      )
      .limit(1)

    if (existingLinks.length === 0) return

    const principalId = existingLinks[0].principalId
    await this.identityService.deactivatePrincipal(principalId)

    logger.info(
      {
        provider: providerType,
        externalUserId: extUser.externalUserId,
        principalId,
      },
      "principal deactivated — user departed from provider"
    )
  }

  // ─── Fuzzy name merge ───────────────────���──────────────────

  private async runFuzzyNameMerge(): Promise<{
    merged: number
    skipped: number
  }> {
    // Get all principals with their identity links
    const rows = await this.db
      .select({
        principalId: principal.id,
        name: principal.name,
        email: sql<string>`${principal.spec}->>'email'`.as("email"),
        createdAt: principal.createdAt,
        provider: identityLink.type,
      })
      .from(principal)
      .innerJoin(identityLink, eq(identityLink.principalId, principal.id))

    // Build a map: normalizedName → Map<provider, principalId[]>
    const nameMap = new Map<string, Map<string, string[]>>()

    for (const row of rows) {
      const norm = normalizeName(row.name)
      if (!norm || norm.length < 3) continue

      if (!nameMap.has(norm)) nameMap.set(norm, new Map())
      const provMap = nameMap.get(norm)!
      if (!provMap.has(row.provider)) provMap.set(row.provider, [])

      const ids = provMap.get(row.provider)!
      if (!ids.includes(row.principalId)) ids.push(row.principalId)
    }

    let merged = 0
    let skipped = 0

    for (const [, provMap] of nameMap) {
      if (provMap.size < 2) continue

      let ambiguous = false
      for (const [, ids] of provMap) {
        if (ids.length > 1) {
          ambiguous = true
          break
        }
      }
      if (ambiguous) {
        skipped++
        continue
      }

      const principalIds = [
        ...new Set([...provMap.values()].map((ids) => ids[0])),
      ]
      if (principalIds.length < 2) continue

      // Pick the principal to keep: prefer the one with an email, then oldest
      const principals = await Promise.all(
        principalIds.map(async (id) => {
          const [p] = await this.db
            .select()
            .from(principal)
            .where(eq(principal.id, id))
            .limit(1)
          return p
        })
      )

      const sorted = principals.filter(Boolean).sort((a, b) => {
        const aEmail = (a.spec as Record<string, unknown>)?.email
        const bEmail = (b.spec as Record<string, unknown>)?.email
        if (aEmail && !bEmail) return -1
        if (!aEmail && bEmail) return 1
        return (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0)
      })

      if (sorted.length < 2) continue

      const keep = sorted[0]
      const duplicates = sorted.slice(1)

      for (const dup of duplicates) {
        try {
          const moved = await this.identityService.mergePrincipals(
            keep.id,
            dup.id
          )
          logger.info(
            { keepId: keep.id, dupId: dup.id, name: keep.name, moved },
            "fuzzy name merge: principals merged"
          )
          merged++
        } catch (err) {
          logger.warn(
            { err, keepId: keep.id, dupId: dup.id },
            "fuzzy name merge: failed to merge"
          )
          skipped++
        }
      }
    }

    if (merged > 0 || skipped > 0) {
      logger.info({ merged, skipped }, "fuzzy name merge complete")
    }

    return { merged, skipped }
  }

  // ─── Profile refresh ───────────────────────────────────────

  private async runProfileRefresh(
    skipProviders?: Set<IdentityProviderType>
  ): Promise<void> {
    // syncStatus is inside spec JSONB
    const links = await this.db
      .select()
      .from(identityLink)
      .where(
        sql`${identityLink.spec}->>'syncStatus' = 'idle' OR ${identityLink.spec}->>'syncStatus' IS NULL`
      )

    if (links.length === 0) return

    // Filter out links for providers that failed discovery (e.g. unreachable API)
    const refreshableLinks = skipProviders?.size
      ? links.filter((l) => !skipProviders.has(l.type as IdentityProviderType))
      : links

    const skippedCount = links.length - refreshableLinks.length
    if (skippedCount > 0) {
      logger.info(
        { skippedCount, skipProviders: [...(skipProviders ?? [])] },
        "skipping profile refresh for failed providers"
      )
    }

    if (refreshableLinks.length === 0) return

    logger.info(
      { count: refreshableLinks.length },
      "refreshing identity link profiles"
    )

    const principalIds = new Set<string>()

    for (const link of refreshableLinks) {
      try {
        // Mark as syncing
        await this.db
          .update(identityLink)
          .set({
            spec: sql`${identityLink.spec} || '{"syncStatus":"syncing"}'::jsonb`,
          })
          .where(eq(identityLink.id, link.id))

        const provider = link.type as IdentityProviderType
        const adapter = getIdentityProviderAdapter(provider)

        // Build config for profile refresh
        const config = await this.buildRefreshConfig(link)
        if (!config) {
          // No token available — skip but don't error
          await this.db
            .update(identityLink)
            .set({
              spec: sql`${identityLink.spec} || ${JSON.stringify({ syncStatus: "idle", lastSyncAt: new Date().toISOString() })}::jsonb`,
            })
            .where(eq(identityLink.id, link.id))
          continue
        }

        const profile = await adapter.fetchUserProfile(config, link.externalId)

        if (profile) {
          const specUpdate: Record<string, unknown> = {
            profileData: profile.profileData,
            syncStatus: "idle",
            lastSyncAt: new Date().toISOString(),
            syncError: null,
          }
          if (profile.email) specUpdate.email = profile.email
          if (profile.login) specUpdate.externalUsername = profile.login

          await this.db
            .update(identityLink)
            .set({
              spec: sql`${identityLink.spec} || ${JSON.stringify(specUpdate)}::jsonb`,
            })
            .where(eq(identityLink.id, link.id))
        } else {
          await this.db
            .update(identityLink)
            .set({
              spec: sql`${identityLink.spec} || '{"syncStatus":"idle","syncError":null}'::jsonb`,
              updatedAt: new Date(),
            })
            .where(eq(identityLink.id, link.id))
        }

        principalIds.add(link.principalId)
      } catch (err) {
        logger.error(
          { err, identityLinkId: link.id, provider: link.type },
          "identity link profile refresh failed"
        )
        await this.db
          .update(identityLink)
          .set({
            spec: sql`${identityLink.spec} || ${JSON.stringify({
              syncStatus: "error",
              syncError: err instanceof Error ? err.message : "unknown error",
            })}::jsonb`,
          })
          .where(eq(identityLink.id, link.id))
      }
    }

    // Refresh merged profiles for affected principals
    for (const principalId of principalIds) {
      try {
        await this.identityService.refreshPrincipalProfile(principalId)
      } catch (err) {
        logger.error(
          { err, principalId },
          "profile merge failed after identity refresh"
        )
      }
    }
  }

  // ─── Provider config gathering ──────────────────────────────

  private async gatherProviderConfigs(): Promise<
    Array<{
      provider: IdentityProviderType
      config: IdentityProviderConfig
      sourceId: string
    }>
  > {
    const resolver = createSpecRefResolver(this.db, this.secrets)
    const configs: Array<{
      provider: IdentityProviderType
      config: IdentityProviderConfig
      sourceId: string
    }> = []

    // GitHub — from build.git_host_provider table
    const ghProviders = await this.db
      .select()
      .from(gitHostProvider)
      .where(
        and(
          sql`${gitHostProvider.spec}->>'status' = 'active'`,
          eq(gitHostProvider.type, "github")
        )
      )

    for (const ghp of ghProviders) {
      const spec = ghp.spec as Record<string, unknown>
      const resolved = await resolver.resolve(spec as Record<string, string>)
      const token = resolved.token ?? resolved.credentialsRef
      if (!token) continue

      configs.push({
        provider: "github",
        config: {
          token: token as string,
          apiBaseUrl: (resolved.apiUrl ?? spec.apiUrl) as string | undefined,
          org: resolved.org as string | undefined,
        },
        sourceId: ghp.id,
      })
    }

    // Slack — from org.messaging_provider table
    const slackProviders = await this.db
      .select()
      .from(messagingProvider)
      .where(
        and(
          sql`${messagingProvider.spec}->>'status' = 'active'`,
          eq(messagingProvider.type, "slack")
        )
      )

    for (const sp of slackProviders) {
      const spec = sp.spec as Record<string, unknown>
      const resolved = await resolver.resolve(spec as Record<string, string>)
      const token = resolved.token ?? resolved.botToken
      if (!token) continue

      configs.push({
        provider: "slack",
        config: { token: token as string },
        sourceId: sp.id,
      })
    }

    // Jira — from build.work_tracker_provider table
    const jiraProviders = await this.db
      .select()
      .from(workTrackerProvider)
      .where(
        and(
          sql`${workTrackerProvider.spec}->>'status' = 'active'`,
          eq(workTrackerProvider.type, "jira")
        )
      )

    for (const jtp of jiraProviders) {
      const spec = jtp.spec as Record<string, unknown>
      const resolved = await resolver.resolve(spec as Record<string, string>)
      const token = resolved.token ?? resolved.credentialsRef
      if (!token) continue

      configs.push({
        provider: "jira",
        config: {
          token: token as string,
          apiBaseUrl: (resolved.apiUrl ?? spec.apiUrl) as string | undefined,
          extra: { email: resolved.adminEmail },
        },
        sourceId: jtp.id,
      })
    }

    return configs
  }

  /**
   * Build a config for refreshing a single identity link's profile.
   * Uses per-user tokens from spec.accessToken,
   * or falls back to org-level provider tokens.
   */
  private async buildRefreshConfig(
    link: typeof identityLink.$inferSelect
  ): Promise<IdentityProviderConfig | null> {
    const provider = link.type as IdentityProviderType
    const spec = (link.spec ?? {}) as Record<string, unknown>
    const accessToken = spec.accessToken as string | undefined
    const refreshToken = spec.refreshToken as string | undefined
    const expiresAt = spec.expiresAt
      ? new Date(spec.expiresAt as string)
      : undefined

    // Per-user token (e.g., Google OAuth)
    if (accessToken) {
      // Handle Google token refresh
      if (provider === "google" && refreshToken) {
        const now = new Date()
        if (expiresAt && expiresAt < now) {
          const clientId = await this.secrets.get({
            key: "google-oauth-client-id",
            scopeType: "org",
          })
          const clientSecret = await this.secrets.get({
            key: "google-oauth-client-secret",
            scopeType: "org",
          })

          if (clientId && clientSecret) {
            const refreshed = await refreshGoogleAccessToken({
              refreshToken,
              clientId,
              clientSecret,
            })

            // Update the stored token in spec
            await this.db
              .update(identityLink)
              .set({
                spec: sql`${identityLink.spec} || ${JSON.stringify({
                  accessToken: refreshed.accessToken,
                  expiresAt: refreshed.expiresAt.toISOString(),
                })}::jsonb`,
              })
              .where(eq(identityLink.id, link.id))

            return { token: refreshed.accessToken }
          }
        }
        return { token: accessToken }
      }

      return { token: accessToken }
    }

    // Fall back to org-level provider token
    const providerConfigs =
      this.cachedProviderConfigs ?? (await this.gatherProviderConfigs())
    const match = providerConfigs.find((c) => c.provider === provider)
    return match?.config ?? null
  }
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Normalize a name for fuzzy matching: lowercase, strip non-alphanumeric.
 */
function normalizeName(name: string | null): string {
  if (!name) return ""
  return name.toLowerCase().replace(/[^a-z0-9]/g, "")
}
