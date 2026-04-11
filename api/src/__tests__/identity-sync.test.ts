import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"
import { createTestContext, truncateAllTables } from "../test-helpers"
import { IdentityService } from "../modules/identity/identity.service"
import { IdentitySyncService } from "../modules/identity/identity-sync.service"
import { createSpecRefResolver } from "../lib/spec-ref-resolver"
import type { Database } from "../db/connection"
import type { PGlite } from "@electric-sql/pglite"
import type { SecretBackend } from "../lib/secrets/secret-backend"
import type { ExternalIdentityUser } from "../adapters/identity-provider-adapter"
import {
  principal,
  identityLink,
  team,
  messagingProvider,
  configVar,
} from "../db/schema/org"
import { gitHostProvider } from "../db/schema/build"
import { eq, and } from "drizzle-orm"

// ── Mock SecretBackend ──────────────────────────────────────────

class MockSecretBackend implements SecretBackend {
  private store = new Map<string, string>()

  setSecret(key: string, value: string) {
    this.store.set(key, value)
  }

  async set(params: { key: string; value: string }) {
    this.store.set(params.key, params.value)
  }

  async get(params: { key: string; scopeType: string }) {
    return this.store.get(params.key) ?? null
  }

  async list() {
    return []
  }

  async remove() {
    return true
  }

  async resolve() {
    return []
  }
}

// ── Helpers ─────────────────────────────────────────────────────

async function createTeam(db: Database, slug: string) {
  const [t] = await db
    .insert(team)
    .values({ name: slug, slug, type: "team" })
    .returning()
  return t
}

async function createPrincipal(
  db: Database,
  opts: { name: string; email?: string; status?: string }
) {
  const svc = new IdentityService(db)
  return svc.resolveOrCreatePrincipal({
    authUserId: `auth:${opts.name}`,
    email: opts.email,
    name: opts.name,
  })
}

async function createIdentityLink(
  db: Database,
  principalId: string,
  provider: string,
  opts: { externalUserId: string; externalLogin?: string; email?: string }
) {
  const svc = new IdentityService(db)
  return svc.linkIdentity(principalId, provider, {
    externalUserId: opts.externalUserId,
    externalLogin: opts.externalLogin,
    email: opts.email,
  })
}

// ── Tests ───────────────────────────────────────────────────────

describe("identity sync", () => {
  let db: Database
  let client: PGlite

  beforeAll(async () => {
    const ctx = await createTestContext()
    db = ctx.db as unknown as Database
    client = ctx.client
  })

  afterAll(async () => {
    await client.close()
  })

describe("IdentityService - Multi-signal matching", () => {
  let svc: IdentityService

  beforeAll(() => {
    svc = new IdentityService(db)
  })

  beforeEach(async () => {
    await truncateAllTables(client)
  })

  describe("findPrincipalByEmail", () => {
    it("finds a principal by email", async () => {
      const p = await createPrincipal(db, {
        name: "alice",
        email: "alice@example.com",
      })
      const found = await svc.findPrincipalByEmail("alice@example.com")
      expect(found).not.toBeNull()
      expect(found!.id).toBe(p.id)
    })

    it("returns null when no match", async () => {
      const found = await svc.findPrincipalByEmail("nobody@example.com")
      expect(found).toBeNull()
    })
  })

  describe("findPrincipalMultiSignal", () => {
    it("matches by email (highest confidence)", async () => {
      const p = await createPrincipal(db, {
        name: "bob",
        email: "bob@example.com",
      })

      const result = await svc.findPrincipalMultiSignal({
        email: "bob@example.com",
        login: "totally-different-login",
        externalUserId: "999",
        provider: "github",
      })

      expect(result).not.toBeNull()
      expect(result!.principal.id).toBe(p.id)
      expect(result!.matchSignal).toBe("email")
    })

    it("matches by existing identity link when email is null", async () => {
      const p = await createPrincipal(db, {
        name: "carol",
        email: "carol@example.com",
      })
      await createIdentityLink(db, p.id, "github", {
        externalUserId: "gh-123",
        externalLogin: "carol-gh",
      })

      const result = await svc.findPrincipalMultiSignal({
        email: null,
        login: "carol-gh",
        externalUserId: "gh-123",
        provider: "github",
      })

      expect(result).not.toBeNull()
      expect(result!.principal.id).toBe(p.id)
      expect(result!.matchSignal).toBe("existing-link")
    })

    it("matches by cross-provider login when email and link are missing", async () => {
      const p = await createPrincipal(db, {
        name: "dave",
        email: "dave@example.com",
      })
      // Dave has a Slack identity link with login "dave"
      await createIdentityLink(db, p.id, "slack", {
        externalUserId: "slack-456",
        externalLogin: "dave",
      })

      // Now trying to match from GitHub with same login but no email
      const result = await svc.findPrincipalMultiSignal({
        email: null,
        login: "dave",
        externalUserId: "gh-new-789",
        provider: "github",
      })

      expect(result).not.toBeNull()
      expect(result!.principal.id).toBe(p.id)
      expect(result!.matchSignal).toBe("cross-provider-login")
    })

    it("returns null when no signals match", async () => {
      const result = await svc.findPrincipalMultiSignal({
        email: null,
        login: "unknown-user",
        externalUserId: "ext-999",
        provider: "github",
      })

      expect(result).toBeNull()
    })

    it("prefers email over existing link", async () => {
      // Create two different principals
      const alice = await createPrincipal(db, {
        name: "alice2",
        email: "alice2@example.com",
      })
      const bob = await createPrincipal(db, {
        name: "bob2",
        email: "bob2@example.com",
      })

      // Bob has an existing link for this external user
      await createIdentityLink(db, bob.id, "github", {
        externalUserId: "gh-conflict",
        externalLogin: "conflicted",
      })

      // But the external user's email matches Alice
      const result = await svc.findPrincipalMultiSignal({
        email: "alice2@example.com",
        login: "conflicted",
        externalUserId: "gh-conflict",
        provider: "github",
      })

      // Email should win
      expect(result!.principal.id).toBe(alice.id)
      expect(result!.matchSignal).toBe("email")
    })
  })

  describe("deactivatePrincipal", () => {
    it("marks a principal as deactivated", async () => {
      const p = await createPrincipal(db, {
        name: "departed",
        email: "departed@example.com",
      })
      expect((p.spec as Record<string, unknown>).status).toBe("active")

      const deactivated = await svc.deactivatePrincipal(p.id)
      expect(deactivated).not.toBeNull()
      expect((deactivated!.spec as Record<string, unknown>).status).toBe(
        "deactivated"
      )
    })

    it("preserves identity links after deactivation", async () => {
      const p = await createPrincipal(db, {
        name: "leaving",
        email: "leaving@example.com",
      })
      await createIdentityLink(db, p.id, "github", {
        externalUserId: "gh-leaving",
        externalLogin: "leaving",
        email: "leaving@example.com",
      })

      await svc.deactivatePrincipal(p.id)

      // Identity links should still exist
      const links = await svc.getLinkedIdentities(p.id)
      expect(links).toHaveLength(1)
      expect(links[0].type).toBe("github")
    })
  })

  describe("linkIdentity - idempotency", () => {
    it("upserts without error on duplicate (principalId, provider)", async () => {
      const p = await createPrincipal(db, {
        name: "idem",
        email: "idem@example.com",
      })

      // Link twice with same provider
      await svc.linkIdentity(p.id, "github", {
        externalUserId: "gh-100",
        externalLogin: "idem-v1",
        email: "idem@example.com",
      })

      await svc.linkIdentity(p.id, "github", {
        externalUserId: "gh-100",
        externalLogin: "idem-sync",
        email: "idem@example.com",
      })

      const links = await svc.getLinkedIdentities(p.id)
      expect(links).toHaveLength(1)
      expect((links[0].spec as Record<string, unknown>).externalUsername).toBe(
        "idem-sync"
      ) // updated
    })
  })
})

describe("IdentitySyncService - Secret resolution", () => {
  let secrets: MockSecretBackend

  beforeEach(async () => {
    await truncateAllTables(client)
    secrets = new MockSecretBackend()
  })

  it("constructs without error", () => {
    const svc = new IdentitySyncService(db, secrets)
    expect(svc).toBeDefined()
  })

  it("syncAllIdentities returns empty results when no providers configured", async () => {
    const svc = new IdentitySyncService(db, secrets)
    const results = await svc.syncAllIdentities()
    // No providers configured → no discovery results (but profile refresh still runs)
    expect(results).toEqual([])
  })
})

describe("IdentitySyncService - Discovery sync with profile merge", () => {
  let svc: IdentityService

  beforeAll(() => {
    svc = new IdentityService(db)
  })

  beforeEach(async () => {
    await truncateAllTables(client)
  })

  it("refreshPrincipalProfile merges data from multiple providers", async () => {
    const p = await createPrincipal(db, {
      name: "multi",
      email: "multi@example.com",
    })

    // Link with GitHub profile data
    await svc.linkIdentity(p.id, "github", {
      externalUserId: "gh-multi",
      externalLogin: "multi-gh",
      email: "multi@example.com",
      profileData: {
        avatarUrl: "https://github.com/avatar.jpg",
        displayName: "Multi User (GH)",
        bio: "I code things",
      },
    })

    // Link with Slack profile data
    await svc.linkIdentity(p.id, "slack", {
      externalUserId: "slack-multi",
      externalLogin: "multi-slack",
      email: "multi@example.com",
      profileData: {
        displayName: "Multi User (Slack)",
        avatarUrl: "https://slack.com/avatar.jpg",
      },
    })

    const profile = await svc.refreshPrincipalProfile(p.id)
    expect(profile).not.toBeNull()

    // GitHub has highest priority, so its values should win
    expect(profile!.avatarUrl).toBe("https://github.com/avatar.jpg")
    expect(profile!.displayName).toBe("Multi User (GH)")
    expect(profile!.bio).toBe("I code things")
  })

  it("user overrides always win over provider data", async () => {
    const p = await createPrincipal(db, {
      name: "override",
      email: "override@example.com",
    })

    await svc.linkIdentity(p.id, "github", {
      externalUserId: "gh-override",
      email: "override@example.com",
      profileData: {
        displayName: "Provider Name",
        avatarUrl: "https://provider/avatar.jpg",
      },
    })

    // Set user overrides
    await svc.updateProfileOverrides(p.id, {
      displayName: "My Custom Name",
    })

    const [row] = await db
      .select()
      .from(principal)
      .where(eq(principal.id, p.id))
      .limit(1)

    const spec = row.spec as Record<string, unknown>
    expect(spec.displayName).toBe("My Custom Name")
    // Avatar should still come from provider since no override was set
    expect(spec.avatarUrl).toBe("https://provider/avatar.jpg")
  })
})

describe("IdentitySyncService - Departed user handling", () => {
  let svc: IdentityService

  beforeAll(() => {
    svc = new IdentityService(db)
  })

  beforeEach(async () => {
    await truncateAllTables(client)
  })

  it("deactivated principal retains all identity links", async () => {
    const p = await createPrincipal(db, {
      name: "ex-emp",
      email: "ex@example.com",
    })

    // Link to multiple providers
    await svc.linkIdentity(p.id, "github", {
      externalUserId: "gh-ex",
      externalLogin: "ex-emp",
      email: "ex@example.com",
    })
    await svc.linkIdentity(p.id, "slack", {
      externalUserId: "slack-ex",
      externalLogin: "ex-emp",
      email: "ex@example.com",
    })

    // Deactivate
    await svc.deactivatePrincipal(p.id)

    // All links preserved
    const links = await svc.getLinkedIdentities(p.id)
    expect(links).toHaveLength(2)

    // Principal status is deactivated (in spec JSONB)
    const [row] = await db
      .select()
      .from(principal)
      .where(eq(principal.id, p.id))
      .limit(1)
    expect((row.spec as Record<string, unknown>).status).toBe("deactivated")
  })

  it("deactivated principal can still be found by email for attribution", async () => {
    const p = await createPrincipal(db, {
      name: "past",
      email: "past@example.com",
    })
    await svc.deactivatePrincipal(p.id)

    // Should still be findable by email
    const found = await svc.findPrincipalByEmail("past@example.com")
    expect(found).not.toBeNull()
    expect(found!.id).toBe(p.id)
    expect((found!.spec as Record<string, unknown>).status).toBe("deactivated")
  })
})

describe("Adapter registry", () => {
  it("returns identity provider adapters for all supported types", async () => {
    const { getIdentityProviderAdapter } =
      await import("../adapters/adapter-registry")

    const github = getIdentityProviderAdapter("github")
    expect(github.provider).toBe("github")

    const slack = getIdentityProviderAdapter("slack")
    expect(slack.provider).toBe("slack")

    const jira = getIdentityProviderAdapter("jira")
    expect(jira.provider).toBe("jira")

    const google = getIdentityProviderAdapter("google")
    expect(google.provider).toBe("google")
  })

  it("throws for unknown provider type", async () => {
    const { getIdentityProviderAdapter } =
      await import("../adapters/adapter-registry")

    expect(() => getIdentityProviderAdapter("unknown" as any)).toThrow(
      /No identity provider adapter/
    )
  })
})

describe("Google adapter - fetchUsers returns empty", () => {
  it("returns empty array (no bulk discovery)", async () => {
    const { GoogleIdentityProviderAdapter } =
      await import("../adapters/identity-provider-adapter-google")
    const adapter = new GoogleIdentityProviderAdapter()
    const users = await adapter.fetchUsers({ token: "fake" })
    expect(users).toEqual([])
  })
})

describe("Spec ref resolver", () => {
  let secrets: MockSecretBackend

  beforeEach(async () => {
    await truncateAllTables(client)
    secrets = new MockSecretBackend()
  })

  it("passes through plain string values unchanged", async () => {
    const resolver = createSpecRefResolver(db, secrets)
    const result = await resolver.resolve({
      token: "ghp_abc123",
      org: "my-org",
    })
    expect(result.token).toBe("ghp_abc123")
    expect(result.org).toBe("my-org")
  })

  it("resolves $secret(key) references via SecretBackend", async () => {
    secrets.setSecret("github-token", "ghp_resolved_token")
    const resolver = createSpecRefResolver(db, secrets)

    const result = await resolver.resolve({
      token: "$secret(github-token)",
      org: "my-org",
    })

    expect(result.token).toBe("ghp_resolved_token")
    expect(result.org).toBe("my-org")
  })

  it("resolves $var(key) references via configVar table", async () => {
    // Insert a config var
    await db.insert(configVar).values({
      slug: "github-org",
      name: "GitHub Org",
      scopeType: "org",
      scopeId: "default",
      value: "my-github-org",
    })

    const resolver = createSpecRefResolver(db, secrets, {
      scopeType: "org",
      scopeId: "default",
    })

    const result = await resolver.resolve({
      org: "$var(github-org)",
      token: "ghp_inline",
    })

    expect(result.org).toBe("my-github-org")
    expect(result.token).toBe("ghp_inline")
  })

  it("returns null for unresolvable $secret references", async () => {
    const resolver = createSpecRefResolver(db, secrets)
    const result = await resolver.resolve({
      token: "$secret(nonexistent-key)",
    })
    expect(result.token).toBeNull()
  })

  it("returns null for unresolvable $var references", async () => {
    const resolver = createSpecRefResolver(db, secrets)
    const result = await resolver.resolve({
      org: "$var(nonexistent-var)",
    })
    expect(result.org).toBeNull()
  })

  it("handles mixed inline and reference values", async () => {
    secrets.setSecret("slack-bot-token", "xoxb-resolved")

    const resolver = createSpecRefResolver(db, secrets)
    const result = await resolver.resolve({
      token: "$secret(slack-bot-token)",
      name: "My Slack Workspace",
      count: 42,
    })

    expect(result.token).toBe("xoxb-resolved")
    expect(result.name).toBe("My Slack Workspace")
    // Non-string values are passed through unchanged
    expect(result.count).toBe(42)
  })

  it("does not modify the original spec object", async () => {
    secrets.setSecret("my-key", "resolved-value")
    const resolver = createSpecRefResolver(db, secrets)

    const original = { token: "$secret(my-key)", org: "test" }
    const result = await resolver.resolve(original)

    expect(original.token).toBe("$secret(my-key)")
    expect(result.token).toBe("resolved-value")
  })

  it("resolves multiple $secret refs in same spec", async () => {
    secrets.setSecret("jira-token", "api-token-123")
    secrets.setSecret("jira-admin-email", "admin@company.com")

    const resolver = createSpecRefResolver(db, secrets)
    const result = await resolver.resolve({
      token: "$secret(jira-token)",
      adminEmail: "$secret(jira-admin-email)",
      apiBaseUrl: "https://company.atlassian.net",
    })

    expect(result.token).toBe("api-token-123")
    expect(result.adminEmail).toBe("admin@company.com")
    expect(result.apiBaseUrl).toBe("https://company.atlassian.net")
  })

  it("ignores strings that look like $secret but have wrong format", async () => {
    const resolver = createSpecRefResolver(db, secrets)
    const result = await resolver.resolve({
      a: "$secret()", // empty key
      b: "$secret", // no parens
      c: "prefix$secret(key)", // not at start
      d: "$secret(key)suffix", // not at end
    })

    // None of these should be resolved — they should pass through
    expect(result.a).toBe("$secret()")
    expect(result.b).toBe("$secret")
    expect(result.c).toBe("prefix$secret(key)")
    expect(result.d).toBe("$secret(key)suffix")
  })
})

describe("IdentitySyncService - Spec-based provider config", () => {
  let secrets: MockSecretBackend

  beforeEach(async () => {
    await truncateAllTables(client)
    secrets = new MockSecretBackend()
  })

  it("syncAllIdentities with spec-based GitHub provider resolves $secret token", async () => {
    secrets.setSecret("gh-token", "ghp_test_token_123")

    const team = await createTeam(db, "test-team")

    // Insert a git_host_provider with spec-based config
    await db.insert(gitHostProvider).values({
      name: "GitHub",
      slug: "github-main",
      type: "github",
      spec: {
        apiUrl: "https://api.github.com",
        authMode: "token",
        status: "active",
        credentialsRef: "$secret(gh-token)",
      },
    })

    const svc = new IdentitySyncService(db, secrets)
    // This will attempt to fetch users from GitHub with the resolved token.
    // The API call will fail (invalid token), but the config resolution succeeds.
    // We expect a result with errors (API failure), not a crash from missing token.
    const results = await svc.syncAllIdentities()
    expect(results).toHaveLength(1)
    expect(results[0].provider).toBe("github")
    // The sync attempted (token resolved) but the API call failed
    expect(results[0].errors).toBe(1)
  })

  it("syncAllIdentities with spec-based Slack provider resolves $secret token", async () => {
    secrets.setSecret("slack-token", "xoxb-test-slack-token")

    const team = await createTeam(db, "test-team-slack")

    await db.insert(messagingProvider).values({
      name: "Slack",
      slug: "slack-main",
      type: "slack",
      teamId: team.id,
      spec: {
        status: "active",
        botToken: "$secret(slack-token)",
      },
    })

    const svc = new IdentitySyncService(db, secrets)
    const results = await svc.syncAllIdentities()
    expect(results).toHaveLength(1)
    expect(results[0].provider).toBe("slack")
    // Token resolved, API call will fail with invalid token
    expect(results[0].errors).toBe(1)
  })

  it("skips provider when spec $secret ref is unresolvable", async () => {
    // No secrets set — the $secret ref will resolve to null
    const team = await createTeam(db, "test-team-no-secret")

    await db.insert(gitHostProvider).values({
      name: "GitHub Missing",
      slug: "github-missing",
      type: "github",
      spec: {
        apiUrl: "https://api.github.com",
        authMode: "token",
        status: "active",
        credentialsRef: "$secret(nonexistent-token)",
      },
    })

    const svc = new IdentitySyncService(db, secrets)
    const results = await svc.syncAllIdentities()
    // Provider should be skipped (no token) — no results
    expect(results).toHaveLength(0)
  })

  it("resolves inline token from spec when no $secret ref is used", async () => {
    await createTeam(db, "test-team-inline")

    // Insert a git_host_provider with inline token in spec
    await db.insert(gitHostProvider).values({
      name: "GitHub Inline",
      slug: "github-inline",
      type: "github",
      spec: {
        apiUrl: "https://api.github.com",
        authMode: "token",
        status: "active",
        credentialsRef: "ghp_inline_token",
      },
    })

    const svc = new IdentitySyncService(db, secrets)
    const results = await svc.syncAllIdentities()
    // Inline token resolved, API call will fail with invalid token
    expect(results).toHaveLength(1)
    expect(results[0].provider).toBe("github")
    expect(results[0].errors).toBe(1) // API fails, but config resolved
  })

  it("resolves inline botToken from Slack spec when no $secret ref is used", async () => {
    const team = await createTeam(db, "test-team-inline-slack")

    await db.insert(messagingProvider).values({
      name: "Slack Inline",
      slug: "slack-inline",
      type: "slack",
      teamId: team.id,
      spec: {
        status: "active",
        botToken: "xoxb-inline-bot-token",
      },
    })

    const svc = new IdentitySyncService(db, secrets)
    const results = await svc.syncAllIdentities()
    // Find the Slack result (other providers from prior tests may also be present)
    const slackResult = results.find((r) => r.provider === "slack")
    expect(slackResult).toBeDefined()
    expect(slackResult!.errors).toBe(1) // API fails, but config resolved
  })
})

describe("IdentityService - No-email cross-provider dedup", () => {
  let svc: IdentityService

  beforeAll(() => {
    svc = new IdentityService(db)
  })

  beforeEach(async () => {
    await truncateAllTables(client)
  })

  it("findPrincipalByExternalLogin finds cross-provider match", async () => {
    const p = await createPrincipal(db, {
      name: "sam",
      email: "sam@example.com",
    })

    // Sam has a Slack link with login "sammy"
    await createIdentityLink(db, p.id, "slack", {
      externalUserId: "slack-sam",
      externalLogin: "sammy",
    })

    // Search for "sammy" from GitHub (excluding slack would still find it via cross-match)
    const found = await svc.findPrincipalByExternalLogin("sammy", "github")
    expect(found).not.toBeNull()
    expect(found!.id).toBe(p.id)
  })

  it("findPrincipalByExternalLogin returns null for same-provider match", async () => {
    const p = await createPrincipal(db, { name: "onlygithub" })

    // Only has a GitHub link with login "onlygithub"
    await createIdentityLink(db, p.id, "github", {
      externalUserId: "gh-only",
      externalLogin: "onlygithub",
    })

    // Searching from GitHub should NOT match (same provider, not cross-provider)
    const found = await svc.findPrincipalByExternalLogin("onlygithub", "github")
    expect(found).toBeNull()
  })

  it("findPrincipalByExternalLogin returns null when no links exist", async () => {
    const found = await svc.findPrincipalByExternalLogin("nobody")
    expect(found).toBeNull()
  })
})

describe("IdentityService - Profile merge priority order", () => {
  let svc: IdentityService

  beforeAll(() => {
    svc = new IdentityService(db)
  })

  beforeEach(async () => {
    await truncateAllTables(client)
  })

  it("github > google > slack > jira priority for all profile fields", async () => {
    const p = await createPrincipal(db, {
      name: "priority-test",
      email: "pt@example.com",
    })

    // Link all four providers with conflicting profile data
    await svc.linkIdentity(p.id, "jira", {
      externalUserId: "jira-1",
      profileData: {
        avatarUrl: "https://jira.com/avatar.jpg",
        displayName: "Jira Name",
        bio: "Jira bio",
      },
    })
    await svc.linkIdentity(p.id, "slack", {
      externalUserId: "slack-1",
      profileData: {
        avatarUrl: "https://slack.com/avatar.jpg",
        displayName: "Slack Name",
        bio: "Slack bio",
      },
    })
    await svc.linkIdentity(p.id, "google", {
      externalUserId: "google-1",
      profileData: {
        avatarUrl: "https://google.com/avatar.jpg",
        displayName: "Google Name",
        bio: "Google bio",
      },
    })
    await svc.linkIdentity(p.id, "github", {
      externalUserId: "gh-1",
      profileData: {
        avatarUrl: "https://github.com/avatar.jpg",
        displayName: "GitHub Name",
        bio: "GitHub bio",
      },
    })

    const profile = await svc.refreshPrincipalProfile(p.id)
    expect(profile).not.toBeNull()

    // GitHub has highest priority — all fields should come from GitHub
    expect(profile!.avatarUrl).toBe("https://github.com/avatar.jpg")
    expect(profile!.displayName).toBe("GitHub Name")
    expect(profile!.bio).toBe("GitHub bio")
  })

  it("falls through to lower-priority provider when higher has no data", async () => {
    const p = await createPrincipal(db, {
      name: "fallthrough",
      email: "ft@example.com",
    })

    // Slack has bio, GitHub does not
    await svc.linkIdentity(p.id, "slack", {
      externalUserId: "slack-ft",
      profileData: {
        bio: "Slack bio content",
        avatarUrl: "https://slack.com/avatar.jpg",
      },
    })
    await svc.linkIdentity(p.id, "github", {
      externalUserId: "gh-ft",
      profileData: {
        avatarUrl: "https://github.com/avatar.jpg",
        displayName: "GitHub User",
        // no bio
      },
    })

    const profile = await svc.refreshPrincipalProfile(p.id)
    expect(profile).not.toBeNull()

    // GitHub wins for avatar and displayName
    expect(profile!.avatarUrl).toBe("https://github.com/avatar.jpg")
    expect(profile!.displayName).toBe("GitHub User")
    // Slack bio survives because GitHub didn't set it
    expect(profile!.bio).toBe("Slack bio content")
  })

  it("returns null for nonexistent principal", async () => {
    const profile = await svc.refreshPrincipalProfile("nonexistent-id")
    expect(profile).toBeNull()
  })
})

describe("IdentityService - Tool credentials", () => {
  let svc: IdentityService

  beforeAll(() => {
    svc = new IdentityService(db)
  })

  beforeEach(async () => {
    await truncateAllTables(client)
  })

  it("creates and lists tool credentials", async () => {
    const p = await createPrincipal(db, {
      name: "tooluser",
      email: "tool@example.com",
    })

    const cred = await svc.createToolCredential(p.id, {
      provider: "openai",
      keyName: "My API Key",
      keyHash: "abc123def456",
    })

    const credSpec = cred.spec as Record<string, unknown>
    expect(credSpec.provider).toBe("openai")
    expect(credSpec.label).toBe("My API Key")

    const list = await svc.listToolCredentials(p.id)
    expect(list).toHaveLength(1)
    expect((list[0].spec as Record<string, unknown>).label).toBe("My API Key")
  })

  it("revokeToolCredential marks credential as revoked", async () => {
    const p = await createPrincipal(db, {
      name: "revoker",
      email: "rev@example.com",
    })

    const cred = await svc.createToolCredential(p.id, {
      provider: "anthropic",
      keyName: "Test Key",
      keyHash: "xyz789abc",
    })

    const revoked = await svc.revokeToolCredential(p.id, cred.id)
    expect(revoked).not.toBeNull()

    // revokeToolCredential deletes the row — list should be empty
    const list = await svc.listToolCredentials(p.id)
    expect(list).toHaveLength(0)
  })
})

describe("IdentityService - Tool usage tracking", () => {
  let svc: IdentityService

  beforeAll(() => {
    svc = new IdentityService(db)
  })

  beforeEach(async () => {
    await truncateAllTables(client)
  })

  it("reports and queries tool usage", async () => {
    const p = await createPrincipal(db, {
      name: "usageuser",
      email: "usage@example.com",
    })

    await svc.reportToolUsage(p.id, {
      tool: "claude",
      model: "claude-sonnet-4-6",
      inputTokens: 100,
      outputTokens: 200,
    })

    await svc.reportToolUsage(p.id, {
      tool: "claude",
      model: "claude-opus-4-6",
      inputTokens: 500,
      outputTokens: 1000,
    })

    const result = await svc.queryToolUsage(p.id)
    expect(result.count).toBe(2)
    expect(result.data).toHaveLength(2)
  })

  it("filters tool usage by tool name", async () => {
    const p = await createPrincipal(db, {
      name: "filteruser",
      email: "filter@example.com",
    })

    await svc.reportToolUsage(p.id, { tool: "claude" })
    await svc.reportToolUsage(p.id, { tool: "copilot" })

    const result = await svc.queryToolUsage(p.id, { tool: "claude" })
    expect(result.count).toBe(1)
    expect(result.data[0].tool).toBe("claude")
  })
})
})
