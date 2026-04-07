import type {
  IdentityProviderAdapter,
  IdentityProviderConfig,
  ExternalIdentityUser,
} from "./identity-provider-adapter";

/**
 * Jira/Atlassian identity provider adapter.
 *
 * Discovery: lists Atlassian Cloud users via REST API v3.
 * Profile refresh: fetches a single user by accountId.
 *
 * Auth: Basic auth with `email:apiToken` (base64).
 * Config.token = API token, config.extra.email = Atlassian account email.
 *
 * API endpoints used:
 * - fetchUsers: GET /rest/api/3/users/search (paginated)
 * - fetchUserProfile: GET /rest/api/3/user?accountId={id}
 */
export class JiraIdentityProviderAdapter implements IdentityProviderAdapter {
  readonly provider = "jira" as const;

  private authHeader(config: IdentityProviderConfig): string {
    const email = (config.extra?.email as string) ?? "";
    return `Basic ${Buffer.from(`${email}:${config.token}`).toString("base64")}`;
  }

  private baseUrl(config: IdentityProviderConfig): string {
    return (config.apiBaseUrl ?? "").replace(/\/$/, "");
  }

  async fetchUsers(config: IdentityProviderConfig): Promise<ExternalIdentityUser[]> {
    const base = this.baseUrl(config);
    const auth = this.authHeader(config);
    const users: ExternalIdentityUser[] = [];
    let startAt = 0;
    const maxResults = 200;

    while (true) {
      const url = `${base}/rest/api/3/users/search?startAt=${startAt}&maxResults=${maxResults}`;
      const res = await fetch(url, {
        headers: { Authorization: auth, Accept: "application/json" },
      });

      if (!res.ok) {
        throw new Error(`Jira users/search failed: ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as JiraUser[];
      if (data.length === 0) break;

      for (const u of data) {
        // Skip app users and customer accounts
        if (u.accountType !== "atlassian") continue;

        users.push(toExternalUser(u));
      }

      if (data.length < maxResults) break;
      startAt += maxResults;
    }

    return users;
  }

  async fetchUserProfile(
    config: IdentityProviderConfig,
    externalUserId: string,
  ): Promise<ExternalIdentityUser | null> {
    const base = this.baseUrl(config);
    const auth = this.authHeader(config);

    try {
      const url = `${base}/rest/api/3/user?accountId=${encodeURIComponent(externalUserId)}`;
      const res = await fetch(url, {
        headers: { Authorization: auth, Accept: "application/json" },
      });

      if (!res.ok) return null;

      const u = (await res.json()) as JiraUser;
      return toExternalUser(u);
    } catch {
      return null;
    }
  }
}

// ── Jira REST types ────────────────────────────────────────────

interface JiraUser {
  accountId: string;
  accountType: string;
  emailAddress?: string;
  displayName?: string;
  avatarUrls?: Record<string, string>;
  active?: boolean;
  locale?: string;
  timeZone?: string;
}

function toExternalUser(u: JiraUser): ExternalIdentityUser {
  return {
    externalUserId: u.accountId,
    email: u.emailAddress ?? null,
    login: null,
    displayName: u.displayName ?? null,
    avatarUrl: u.avatarUrls?.["48x48"] ?? null,
    bio: null,
    profileData: {
      accountId: u.accountId,
      displayName: u.displayName,
      avatarUrl: u.avatarUrls?.["48x48"],
      active: u.active,
      locale: u.locale,
      timeZone: u.timeZone,
    },
    isBot: u.accountType !== "atlassian",
    deleted: u.active === false,
  };
}
