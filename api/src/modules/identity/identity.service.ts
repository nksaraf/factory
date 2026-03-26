import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { Database } from "../../db/connection";
import {
  identityLink,
  orgPrincipal,
  toolCredential,
  toolUsage,
} from "../../db/schema/org";
import { allocateSlug } from "../../lib/slug";
import type { PrincipalProfile } from "@smp/factory-shared";

const PROFILE_MERGE_PRIORITY: string[] = [
  "github",
  "google",
  "slack",
  "jira",
];

export class IdentityService {
  constructor(private readonly db: Database) {}

  // ─── Principal Resolution ───────────────────────────────────

  async resolveOrCreatePrincipal(opts: {
    authUserId: string;
    email?: string;
    name?: string;
    provider?: string;
    externalUserId?: string;
    externalLogin?: string;
    profileData?: Record<string, unknown>;
  }) {
    // Try to find existing principal by authUserId
    const [existing] = await this.db
      .select()
      .from(orgPrincipal)
      .where(eq(orgPrincipal.authUserId, opts.authUserId))
      .limit(1);

    if (existing) return existing;

    // Create new principal
    const displayName = opts.name || opts.email?.split("@")[0] || "user";
    const slug = await allocateSlug({
      baseLabel: displayName,
      explicitSlug: undefined,
      isTaken: async (s) => {
        const [r] = await this.db
          .select()
          .from(orgPrincipal)
          .where(eq(orgPrincipal.slug, s))
          .limit(1);
        return r != null;
      },
    });

    const [principal] = await this.db
      .insert(orgPrincipal)
      .values({
        name: displayName,
        slug,
        type: "user",
        authUserId: opts.authUserId,
        email: opts.email ?? null,
        profile: {},
        status: "active",
        metadata: {},
      })
      .returning();

    // If provider info was given, create the identity link
    if (opts.provider && opts.externalUserId) {
      await this.linkIdentity(principal.principalId, opts.provider, {
        externalUserId: opts.externalUserId,
        externalLogin: opts.externalLogin,
        email: opts.email,
        authUserId: opts.authUserId,
        profileData: opts.profileData ?? {},
      });
    }

    return principal;
  }

  async getPrincipalByAuthUserId(authUserId: string) {
    const [row] = await this.db
      .select()
      .from(orgPrincipal)
      .where(eq(orgPrincipal.authUserId, authUserId))
      .limit(1);
    return row ?? null;
  }

  // ─── Identity Links ────────────────────────────────────────

  async linkIdentity(
    principalId: string,
    provider: string,
    data: {
      externalUserId: string;
      externalLogin?: string;
      email?: string;
      authUserId?: string;
      profileData?: Record<string, unknown>;
    },
  ) {
    const [row] = await this.db
      .insert(identityLink)
      .values({
        principalId,
        provider,
        externalUserId: data.externalUserId,
        externalLogin: data.externalLogin ?? null,
        email: data.email ?? null,
        authUserId: data.authUserId ?? null,
        profileData: data.profileData ?? {},
      })
      .onConflictDoUpdate({
        target: [identityLink.principalId, identityLink.provider],
        set: {
          externalUserId: data.externalUserId,
          externalLogin: data.externalLogin ?? null,
          email: data.email ?? null,
          authUserId: data.authUserId ?? null,
          profileData: data.profileData ?? {},
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async unlinkIdentity(principalId: string, provider: string) {
    await this.db
      .delete(identityLink)
      .where(
        and(
          eq(identityLink.principalId, principalId),
          eq(identityLink.provider, provider),
        ),
      );
  }

  async getLinkedIdentities(principalId: string) {
    return this.db
      .select()
      .from(identityLink)
      .where(eq(identityLink.principalId, principalId));
  }

  // ─── Profile Merge ─────────────────────────────────────────

  async refreshPrincipalProfile(principalId: string) {
    const links = await this.getLinkedIdentities(principalId);
    const [principal] = await this.db
      .select()
      .from(orgPrincipal)
      .where(eq(orgPrincipal.principalId, principalId))
      .limit(1);

    if (!principal) return null;

    const userOverrides =
      (principal.metadata as Record<string, unknown>)?.userOverrides as
        | Partial<PrincipalProfile>
        | undefined;

    // Build merged profile from identity links in priority order
    const merged: PrincipalProfile = {};

    // Apply provider data in reverse priority (lowest first, highest overwrites)
    for (const provider of [...PROFILE_MERGE_PRIORITY].reverse()) {
      const link = links.find((l) => l.provider === provider);
      if (!link) continue;

      const data = link.profileData as Record<string, unknown>;
      if (data.avatarUrl && !merged.avatarUrl)
        merged.avatarUrl = data.avatarUrl as string;
      if (data.displayName && !merged.displayName)
        merged.displayName = data.displayName as string;
      if (data.bio && !merged.bio) merged.bio = data.bio as string;

      // Store provider-specific sub-object
      (merged as Record<string, unknown>)[provider] = data;
    }

    // User overrides always win
    if (userOverrides) {
      Object.assign(merged, userOverrides);
    }

    await this.db
      .update(orgPrincipal)
      .set({ profile: merged, updatedAt: new Date() })
      .where(eq(orgPrincipal.principalId, principalId));

    return merged;
  }

  async updateProfileOverrides(
    principalId: string,
    overrides: Partial<PrincipalProfile>,
  ) {
    const [principal] = await this.db
      .select()
      .from(orgPrincipal)
      .where(eq(orgPrincipal.principalId, principalId))
      .limit(1);

    if (!principal) return null;

    const metadata = (principal.metadata ?? {}) as Record<string, unknown>;
    metadata.userOverrides = {
      ...((metadata.userOverrides as Record<string, unknown>) ?? {}),
      ...overrides,
    };

    await this.db
      .update(orgPrincipal)
      .set({ metadata, updatedAt: new Date() })
      .where(eq(orgPrincipal.principalId, principalId));

    return this.refreshPrincipalProfile(principalId);
  }

  // ─── Tool Credentials ──────────────────────────────────────

  async createToolCredential(
    principalId: string,
    body: { provider: string; keyName: string; keyHash: string },
  ) {
    const keyPrefix = body.keyHash.slice(0, 8);
    const [row] = await this.db
      .insert(toolCredential)
      .values({
        principalId,
        provider: body.provider,
        keyName: body.keyName,
        keyHash: body.keyHash,
        keyPrefix,
      })
      .returning();
    return row;
  }

  async listToolCredentials(principalId: string) {
    return this.db
      .select({
        toolCredentialId: toolCredential.toolCredentialId,
        principalId: toolCredential.principalId,
        provider: toolCredential.provider,
        keyName: toolCredential.keyName,
        keyPrefix: toolCredential.keyPrefix,
        status: toolCredential.status,
        createdAt: toolCredential.createdAt,
        lastUsedAt: toolCredential.lastUsedAt,
      })
      .from(toolCredential)
      .where(
        and(
          eq(toolCredential.principalId, principalId),
          eq(toolCredential.status, "active"),
        ),
      );
  }

  async revokeToolCredential(principalId: string, credentialId: string) {
    const [row] = await this.db
      .update(toolCredential)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(
        and(
          eq(toolCredential.toolCredentialId, credentialId),
          eq(toolCredential.principalId, principalId),
        ),
      )
      .returning();
    return row ?? null;
  }

  // ─── Tool Usage ────────────────────────────────────────────

  async reportToolUsage(
    principalId: string,
    body: {
      tool: string;
      sessionId?: string;
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      costMicrodollars?: number;
      metadata?: Record<string, unknown>;
    },
  ) {
    const [row] = await this.db
      .insert(toolUsage)
      .values({
        principalId,
        tool: body.tool,
        sessionId: body.sessionId ?? null,
        model: body.model ?? null,
        inputTokens: body.inputTokens ?? 0,
        outputTokens: body.outputTokens ?? 0,
        cacheReadTokens: body.cacheReadTokens ?? 0,
        costMicrodollars: body.costMicrodollars ?? 0,
        metadata: body.metadata ?? {},
      })
      .returning();
    return row;
  }

  async queryToolUsage(
    principalId: string,
    q?: {
      tool?: string;
      since?: string;
      until?: string;
      limit?: number;
      offset?: number;
    },
  ) {
    const conditions = [eq(toolUsage.principalId, principalId)];
    if (q?.tool) conditions.push(eq(toolUsage.tool, q.tool));
    if (q?.since) conditions.push(gte(toolUsage.recordedAt, new Date(q.since)));
    if (q?.until) conditions.push(lte(toolUsage.recordedAt, new Date(q.until)));

    const rows = await this.db
      .select()
      .from(toolUsage)
      .where(and(...conditions))
      .orderBy(desc(toolUsage.recordedAt))
      .limit(q?.limit ?? 100)
      .offset(q?.offset ?? 0);

    return { data: rows, count: rows.length };
  }
}
