import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { allocateSlug } from "../../lib/slug";
import { gitHostProvider, gitRepoSync, gitUserSync, repo } from "../../db/schema/build";
import { createGitHostAdapter, type GitHostAdapterConfig } from "../../adapters/adapter-registry";
import type { GitHostAdapter, GitHostPullRequestCreate } from "../../adapters/git-host-adapter";
import type { AuthAdminClient } from "../../lib/auth-admin-client";

/**
 * Parse the credentialsEnc field. Supports:
 * - Plain string token (legacy)
 * - JSON object with { token, org, webhookSecret, ... }
 */
function parseCredentials(credentialsEnc: string | null | undefined): Partial<GitHostAdapterConfig> {
  if (!credentialsEnc) return {};
  const trimmed = credentialsEnc.trim();
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
  hostType: string;
  apiBaseUrl: string;
  authMode: string;
  credentialsEnc?: string;
  teamId: string;
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
        hostType: body.hostType,
        apiBaseUrl: body.apiBaseUrl,
        authMode: body.authMode,
        credentialsEnc: body.credentialsEnc ?? null,
        teamId: body.teamId,
      })
      .returning();
    return row;
  }

  async getProvider(id: string) {
    const [row] = await this.db
      .select()
      .from(gitHostProvider)
      .where(eq(gitHostProvider.gitHostProviderId, id))
      .limit(1);
    return row ?? null;
  }

  async listProviders(q?: {
    teamId?: string;
    limit?: number;
    offset?: number;
  }) {
    const limit = Math.min(q?.limit ?? 50, 200);
    const offset = q?.offset ?? 0;
    const base = this.db.select().from(gitHostProvider);
    const rows = q?.teamId
      ? await base
          .where(eq(gitHostProvider.teamId, q.teamId))
          .orderBy(desc(gitHostProvider.createdAt))
          .limit(limit)
          .offset(offset)
      : await base
          .orderBy(desc(gitHostProvider.createdAt))
          .limit(limit)
          .offset(offset);
    return { data: rows };
  }

  async updateProvider(
    id: string,
    body: Partial<
      Pick<CreateProviderBody, "name" | "credentialsEnc" | "authMode">
    >,
  ) {
    const [row] = await this.db
      .update(gitHostProvider)
      .set(body)
      .where(eq(gitHostProvider.gitHostProviderId, id))
      .returning();
    return row ?? null;
  }

  async deleteProvider(id: string) {
    await this.db
      .delete(gitHostProvider)
      .where(eq(gitHostProvider.gitHostProviderId, id));
  }

  async triggerFullSync(
    providerId: string,
    opts?: { adapter?: GitHostAdapter },
  ): Promise<{ created: number; updated: number; removed: number }> {
    const provider = await this.getProvider(providerId);
    if (!provider) throw new Error(`Provider not found: ${providerId}`);

    // Update sync status
    await this.db
      .update(gitHostProvider)
      .set({ syncStatus: "syncing" })
      .where(eq(gitHostProvider.gitHostProviderId, providerId));

    const adapter =
      opts?.adapter ??
      createGitHostAdapter(provider.hostType, {
        ...parseCredentials(provider.credentialsEnc),
        apiBaseUrl: provider.apiBaseUrl,
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
          const slug = await allocateSlug({
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
              slug,
              kind: this.inferRepoKind(remote.topics),
              gitUrl: remote.gitUrl,
              defaultBranch: remote.defaultBranch,
              teamId: provider.teamId,
              gitHostProviderId: providerId,
            })
            .returning();

          await this.db.insert(gitRepoSync).values({
            repoId: newRepo.repoId,
            gitHostProviderId: providerId,
            externalRepoId: remote.externalId,
            externalFullName: remote.fullName,
            isPrivate: remote.isPrivate,
          });

          created++;
        } else {
          // Update metadata if changed
          if (existing.externalFullName !== remote.fullName || existing.isPrivate !== remote.isPrivate) {
            await this.db
              .update(gitRepoSync)
              .set({
                externalFullName: remote.fullName,
                isPrivate: remote.isPrivate,
                lastSyncAt: new Date(),
              })
              .where(eq(gitRepoSync.gitRepoSyncId, existing.gitRepoSyncId));
            updated++;
          }
        }
      }

      // Remove sync records for repos that no longer exist remotely
      for (const existing of existingSyncs) {
        if (!remoteExtIds.has(existing.externalRepoId)) {
          await this.db
            .delete(gitRepoSync)
            .where(eq(gitRepoSync.gitRepoSyncId, existing.gitRepoSyncId));
          removed++;
        }
      }

      // Update provider sync status
      await this.db
        .update(gitHostProvider)
        .set({ syncStatus: "idle", lastSyncAt: new Date(), syncError: null })
        .where(eq(gitHostProvider.gitHostProviderId, providerId));

      return { created, updated, removed };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.db
        .update(gitHostProvider)
        .set({ syncStatus: "error", syncError: errorMessage })
        .where(eq(gitHostProvider.gitHostProviderId, providerId));
      throw err;
    }
  }

  async syncDevelopers(
    providerId: string,
    opts?: { adapter?: GitHostAdapter; authClient?: AuthAdminClient },
  ): Promise<{ synced: number; skipped: number; failed: number }> {
    const provider = await this.getProvider(providerId);
    if (!provider) throw new Error(`Provider not found: ${providerId}`);

    const adapter =
      opts?.adapter ??
      createGitHostAdapter(provider.hostType, {
        ...parseCredentials(provider.credentialsEnc),
        apiBaseUrl: provider.apiBaseUrl,
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

      // Insert sync record
      await this.db.insert(gitUserSync).values({
        gitHostProviderId: providerId,
        externalUserId: member.externalUserId,
        externalLogin: member.login,
        authUserId,
        email: member.email,
        name: member.name,
        avatarUrl: member.avatarUrl,
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

    const adapter = createGitHostAdapter(provider.hostType, {
      ...parseCredentials(provider.credentialsEnc),
      apiBaseUrl: provider.apiBaseUrl,
    });

    await adapter.postCommitStatus(sync.externalFullName, sha, status);
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
          eq(gitRepoSync.repoId, repoRow.repoId),
        ),
      )
      .limit(1);

    if (!sync) throw new Error(`Repo not synced with provider: ${repoSlug}`);

    const adapter = createGitHostAdapter(provider.hostType, {
      ...parseCredentials(provider.credentialsEnc),
      apiBaseUrl: provider.apiBaseUrl,
    });

    return { adapter, externalFullName: sync.externalFullName };
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
