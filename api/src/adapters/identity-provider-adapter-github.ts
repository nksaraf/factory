import { Octokit } from "@octokit/rest";
import type {
  IdentityProviderAdapter,
  IdentityProviderConfig,
  ExternalIdentityUser,
} from "./identity-provider-adapter";

/**
 * GitHub identity provider adapter.
 *
 * Discovery: lists org members via REST API, then fetches each user's
 * public profile for email/name/avatar.
 *
 * API methods used:
 * - fetchUsers: orgs.listMembers (paginated) + users.getByUsername (per member)
 * - fetchUserProfile: users.getByUsername
 */
export class GitHubIdentityProviderAdapter implements IdentityProviderAdapter {
  readonly provider = "github" as const;

  private octokit(token: string, apiBaseUrl?: string): Octokit {
    return new Octokit({
      auth: token,
      ...(apiBaseUrl && apiBaseUrl !== "https://api.github.com"
        ? { baseUrl: apiBaseUrl }
        : {}),
    });
  }

  async fetchUsers(config: IdentityProviderConfig): Promise<ExternalIdentityUser[]> {
    const kit = this.octokit(config.token, config.apiBaseUrl);

    let org = config.org;
    if (!org) {
      const { data: orgs } = await kit.rest.orgs.listForAuthenticatedUser();
      if (orgs.length === 0) return [];
      org = orgs[0].login;
    }

    const members = await kit.paginate(kit.rest.orgs.listMembers, {
      org,
      per_page: 100,
    });

    // Fetch full profile for each member (concurrency-limited)
    const users: ExternalIdentityUser[] = [];
    const concurrency = 5;

    for (let i = 0; i < members.length; i += concurrency) {
      const batch = members.slice(i, i + concurrency);
      const profiles = await Promise.allSettled(
        batch.map((m) => this.fetchUserProfile(config, m.login)),
      );

      for (const result of profiles) {
        if (result.status === "fulfilled" && result.value) {
          users.push(result.value);
        }
      }
    }

    return users;
  }

  /**
   * Fetch a GitHub user profile.
   * Accepts either a login (username) or a numeric user ID string.
   * During discovery, login is passed; during profile refresh, the stored numeric ID is passed.
   */
  async fetchUserProfile(
    config: IdentityProviderConfig,
    externalUserId: string,
  ): Promise<ExternalIdentityUser | null> {
    const kit = this.octokit(config.token, config.apiBaseUrl);

    try {
      // If externalUserId is numeric, use /user/:id endpoint; otherwise use /users/:username
      const isNumeric = /^\d+$/.test(externalUserId);
      const { data: u } = isNumeric
        ? await kit.request("GET /user/{account_id}", { account_id: Number(externalUserId) })
        : await kit.rest.users.getByUsername({ username: externalUserId });

      return {
        externalUserId: String(u.id),
        email: u.email ?? null,
        login: u.login,
        displayName: u.name ?? u.login,
        avatarUrl: u.avatar_url ?? null,
        bio: u.bio ?? null,
        profileData: {
          login: u.login,
          avatarUrl: u.avatar_url,
          bio: u.bio,
          company: u.company,
          location: u.location,
          blog: u.blog,
          twitterUsername: u.twitter_username,
          publicRepos: u.public_repos,
        },
        isBot: u.type === "Bot",
        deleted: false,
      };
    } catch {
      return null;
    }
  }
}
