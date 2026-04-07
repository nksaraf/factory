import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { allocateSlug } from "../../lib/slug";
import { gitHostProvider, gitRepoSync, gitUserSync, repo } from "../../db/schema/build-v2";
import { getGitHostAdapter } from "../../adapters/adapter-registry";
import type { GitHostAdapter, GitHostAdapterConfig, GitHostPullRequestCreate, GitHostType } from "../../adapters/git-host-adapter";
import type { GitHostProviderSpec } from "@smp/factory-shared/schemas/build";
import type { AuthAdminClient } from "../../lib/auth-admin-client";

// ---------------------------------------------------------------------------
// Spec helpers — v2 stores credentials & config in the JSONB `spec` column
// ---------------------------------------------------------------------------

function providerSpec(provider: { spec: unknown }): GitHostProviderSpec {
  return (provider.spec ?? {}) as GitHostProviderSpec;
}

/**
 * Build adapter config from v2 provider spec.
 * Supports credentialsRef as plain token, JSON object, or $secret() reference.
 */
function adapterConfigFromSpec(spec: GitHostProviderSpec): Partial<GitHostAdapterConfig> {
  const ref = spec.credentialsRef;
  if (!ref) return {};
  const trimmed = ref.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return { token: trimmed };
    }
  }
  return { token: trimmed };
}

export type CreateProviderBody = {
  name: string;
  type: string;
  spec: {
    apiUrl: string;
    authMode?: string;
    credentialsRef?: string;
  };
};

export class GitHostService {
  constructor(private readonly db: Database) {}

  async createProvider(body: CreateProviderBody) {
    const slug = await allocateSlug({
      baseLabel: body.name,
      explicitSlug: undefined,
      isTaken: async (s) => {
        const [r] = await this.db
          .select()
          .from(gitHostProvider)
          .where(eq(gitHostProvider.slug, s))
          .limit(1);
        return r != null;
      },
    });
    const [row] = await this.db
      .insert(gitHostProvider)
      .values({
        name: body.name,
        slug,
        type: body.type,
        spec: {
          apiUrl: body.spec.apiUrl,
          authMode: body.spec.authMode as any,
          credentialsRef: body.spec.credentialsRef,
          status: "active",
          syncStatus: "idle",
        } satisfies GitHostProviderSpec,
      })
      .returning();
    return row;
  }

  async getProvider(id: string) {
    const [row] = await this.db
      .select()
      .from(gitHostProvider)
      .where(eq(gitHostProvider.id, id))
      .limit(1);
    return row ?? null;
  }

  async listProviders(q?: {
    limit?: number;
    offset?: number;
  }) {
    const limit = Math.min(q?.limit ?? 50, 200);
    const offset = q?.offset ?? 0;
    const rows = await this.db
      .select()
      .from(gitHostProvider)
      .orderBy(desc(gitHostProvider.createdAt))
      .limit(limit)
      .offset(offset);
    return { data: rows };
  }

  async updateProvider(
    id: string,
    body: { name?: string; spec?: Record<string, unknown> },
  ) {
    const existing = await this.getProvider(id);
    if (!existing) return null;
    const updates: Record<string, unknown> = {};
    if (body.name) updates.name = body.name;
    if (body.spec) {
      updates.spec = { ...providerSpec(existing), ...body.spec };
    }
    const [row] = await this.db
      .update(gitHostProvider)
      .set(updates)
      .where(eq(gitHostProvider.id, id))
      .returning();
    return row ?? null;
  }

  async deleteProvider(id: string) {
    await this.db
      .delete(gitHostProvider)
      .where(eq(gitHostProvider.id, id));
  }

  async triggerFullSync(
    providerId: string,
    opts?: { adapter?: GitHostAdapter },
  ): Promise<{ created: number; updated: number; removed: number }> {
    const provider = await this.getProvider(providerId);
    if (!provider) throw new Error(`Provider not found: ${providerId}`);

    const spec = providerSpec(provider);

    // Update sync status in spec
    await this.db
      .update(gitHostProvider)
      .set({ spec: { ...spec, syncStatus: "syncing" } satisfies GitHostProviderSpec })
      .where(eq(gitHostProvider.id, providerId));

    const adapter =
      opts?.adapter ??
      getGitHostAdapter(provider.type as GitHostType, {
        ...adapterConfigFromSpec(spec),
        apiBaseUrl: spec.apiUrl,
      });

    try {
      const remoteRepos = await adapter.listRepos();

      // Load existing sync records for this provider
      const existingSyncs = await this.db
        .select()
        .from(gitRepoSync)
        .where(eq(gitRepoSync.gitHostProviderId, providerId));

      const existingByExtId = new Map(
        existingSyncs.map((s) => [s.externalRepoId, s]),
      );
      const remoteExtIds = new Set(remoteRepos.map((r) => r.externalId));

      let created = 0;
      let updated = 0;
      let removed = 0;

      // Create or update repos
      for (const remote of remoteRepos) {
        const existing = existingByExtId.get(remote.externalId);

        if (!existing) {
          // Create new repo + sync record
          const repoSlug = await allocateSlug({
            baseLabel: remote.name,
            explicitSlug: undefined,
            isTaken: async (s) => {
              const [r] = await this.db
                .select()
                .from(repo)
                .where(eq(repo.slug, s))
                .limit(1);
              return r != null;
            },
          });

          const [newRepo] = await this.db
            .insert(repo)
            .values({
              name: remote.name,
              slug: repoSlug,
              gitHostProviderId: providerId,
              spec: {
                url: remote.gitUrl,
                defaultBranch: remote.defaultBranch,
                kind: this.inferRepoKind(remote.topics) as any,
              },
            })
            .returning();

          await this.db.insert(gitRepoSync).values({
            repoId: newRepo.id,
            gitHostProviderId: providerId,
            externalRepoId: remote.externalId,
            spec: { syncStatus: "idle" },
          });

          created++;
        } else {
          // Update sync record timestamp
          await this.db
            .update(gitRepoSync)
            .set({
              spec: { ...(existing.spec as Record<string, unknown>), lastSyncAt: new Date() } as any,
            })
            .where(eq(gitRepoSync.id, existing.id));
          updated++;
        }
      }

      // Remove sync records for repos that no longer exist remotely
      for (const existing of existingSyncs) {
        if (!remoteExtIds.has(existing.externalRepoId)) {
          await this.db
            .delete(gitRepoSync)
            .where(eq(gitRepoSync.id, existing.id));
          removed++;
        }
      }

      // Update provider sync status
      await this.db
        .update(gitHostProvider)
        .set({
          spec: {
            ...spec,
            syncStatus: "idle",
            lastSyncAt: new Date(),
          } satisfies GitHostProviderSpec,
        })
        .where(eq(gitHostProvider.id, providerId));

      return { created, updated, removed };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.db
        .update(gitHostProvider)
        .set({
          spec: {
            ...spec,
            syncStatus: "error",
          } satisfies GitHostProviderSpec,
        })
        .where(eq(gitHostProvider.id, providerId));
      throw err;
    }
  }

  async syncDevelopers(
    providerId: string,
    opts?: { adapter?: GitHostAdapter; authClient?: AuthAdminClient },
  ): Promise<{ synced: number; skipped: number; failed: number }> {
    const provider = await this.getProvider(providerId);
    if (!provider) throw new Error(`Provider not found: ${providerId}`);

    const spec = providerSpec(provider);
    const adapter =
      opts?.adapter ??
      getGitHostAdapter(provider.type as GitHostType, {
        ...adapterConfigFromSpec(spec),
        apiBaseUrl: spec.apiUrl,
      });

    const authClient = opts?.authClient;
    const members = await adapter.listOrgMembers();

    let synced = 0;
    let skipped = 0;
    let failed = 0;

    for (const member of members) {
      if (!member.email) {
        skipped++;
        continue;
      }

      // Check if already synced
      const [existing] = await this.db
        .select()
        .from(gitUserSync)
        .where(
          and(
            eq(gitUserSync.gitHostProviderId, providerId),
            eq(gitUserSync.externalUserId, member.externalUserId),
          ),
        )
        .limit(1);

      if (existing) {
        skipped++;
        continue;
      }

      // Create shadow user via auth admin client
      let authUserId: string | null = null;
      if (authClient) {
        const user = await authClient.createUser({
          name: member.name ?? member.login,
          email: member.email,
          data: {
            userType: "github_linked",
            metadata: {
              githubLogin: member.login,
              githubId: member.externalUserId,
              avatarUrl: member.avatarUrl,
            },
          },
        });
        if (user) {
          authUserId = user.id;
        } else {
          failed++;
          continue;
        }
      }

      // Insert sync record — v2 stores user metadata in spec JSONB
      await this.db.insert(gitUserSync).values({
        gitHostProviderId: providerId,
        externalUserId: member.externalUserId,
        spec: {
          principalId: authUserId || undefined,
          externalUsername: member.login,
          avatarUrl: member.avatarUrl ?? undefined,
        },
      });

      synced++;
    }

    return { synced, skipped, failed };
  }

  async reportBuildStatus(
    repoId: string,
    sha: string,
    status: import("../../adapters/git-host-adapter").GitHostCommitStatus,
  ): Promise<void> {
    // Find the gitRepoSync record for this repo
    const [sync] = await this.db
      .select()
      .from(gitRepoSync)
      .where(eq(gitRepoSync.repoId, repoId))
      .limit(1);

    if (!sync) return;

    const provider = await this.getProvider(sync.gitHostProviderId);
    if (!provider) return;

    const spec = providerSpec(provider);
    const adapter = getGitHostAdapter(provider.type as GitHostType, {
      ...adapterConfigFromSpec(spec),
      apiBaseUrl: spec.apiUrl,
    });

    // v2: externalFullName is no longer a column — resolve from repo
    const [repoRow] = await this.db
      .select()
      .from(repo)
      .where(eq(repo.id, sync.repoId))
      .limit(1);

    if (!repoRow) return;

    // Use the repo name as a fallback; the sync externalRepoId is the external ID
    // For GitHub, we need the full name (owner/repo) — this may need to come from the adapter
    const fullName = repoRow.name; // TODO: resolve full name properly
    await adapter.postCommitStatus(fullName, sha, status);
  }

  /** Map GitHub permission to factory role */
  static mapGitHubRoleToFactoryRole(ghRole: string): string {
    switch (ghRole) {
      case "admin":
        return "maintainer";
      case "write":
      case "push":
        return "developer";
      case "read":
      case "pull":
      default:
        return "viewer";
    }
  }

  private async resolveRepoFullName(
    providerId: string,
    repoSlug: string,
  ): Promise<{ adapter: GitHostAdapter; externalFullName: string }> {
    const provider = await this.getProvider(providerId);
    if (!provider) throw new Error(`Provider not found: ${providerId}`);

    // Find the repo by slug
    const [repoRow] = await this.db
      .select()
      .from(repo)
      .where(eq(repo.slug, repoSlug))
      .limit(1);

    if (!repoRow) throw new Error(`Repo not found: ${repoSlug}`);

    // Find the sync record linking repo to this provider
    const [sync] = await this.db
      .select()
      .from(gitRepoSync)
      .where(
        and(
          eq(gitRepoSync.gitHostProviderId, providerId),
          eq(gitRepoSync.repoId, repoRow.id),
        ),
      )
      .limit(1);

    if (!sync) throw new Error(`Repo not synced with provider: ${repoSlug}`);

    const spec = providerSpec(provider);
    const adapter = getGitHostAdapter(provider.type as GitHostType, {
      ...adapterConfigFromSpec(spec),
      apiBaseUrl: spec.apiUrl,
    });

    // v2: externalFullName stored in sync externalRepoId (the external identifier)
    return { adapter, externalFullName: sync.externalRepoId };
  }

  async listPullRequests(
    providerId: string,
    repoSlug: string,
    filters?: { state?: string },
  ) {
    const { adapter, externalFullName } = await this.resolveRepoFullName(providerId, repoSlug);
    return adapter.listPullRequests(externalFullName, {
      state: (filters?.state as "open" | "closed" | "all") ?? "open",
    });
  }

  async createPullRequest(
    providerId: string,
    repoSlug: string,
    pr: GitHostPullRequestCreate,
  ) {
    const { adapter, externalFullName } = await this.resolveRepoFullName(providerId, repoSlug);
    return adapter.createPullRequest(externalFullName, pr);
  }

  async getPullRequest(
    providerId: string,
    repoSlug: string,
    prNumber: number,
  ) {
    const { adapter, externalFullName } = await this.resolveRepoFullName(providerId, repoSlug);
    return adapter.getPullRequest(externalFullName, prNumber);
  }

  async mergePullRequest(
    providerId: string,
    repoSlug: string,
    prNumber: number,
    method?: string,
  ) {
    const { adapter, externalFullName } = await this.resolveRepoFullName(providerId, repoSlug);
    await adapter.mergePullRequest(
      externalFullName,
      prNumber,
      method as "merge" | "squash" | "rebase" | undefined,
    );
  }

  async getPullRequestChecks(
    providerId: string,
    repoSlug: string,
    prNumber: number,
  ) {
    const { adapter, externalFullName } = await this.resolveRepoFullName(providerId, repoSlug);
    return adapter.getPullRequestChecks(externalFullName, prNumber);
  }

  private inferRepoKind(topics?: string[]): string {
    if (!topics || topics.length === 0) return "tool";
    const topicSet = new Set(topics.map((t) => t.toLowerCase()));
    if (topicSet.has("product-module")) return "product-module";
    if (topicSet.has("platform-module")) return "platform-module";
    if (topicSet.has("library") || topicSet.has("lib")) return "library";
    if (topicSet.has("vendor-module")) return "vendor-module";
    if (topicSet.has("infra") || topicSet.has("infrastructure")) return "infra";
    if (topicSet.has("docs") || topicSet.has("documentation")) return "docs";
    if (topicSet.has("client-project")) return "client-project";
    return "tool";
  }
}
