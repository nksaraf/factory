/**
 * IdentityProviderAdapter — interface for fetching user identities from
 * external providers (GitHub, Slack, Jira, Google) for email-based linking
 * to internal principals.
 *
 * Follows Pattern B (stateless, per-call config) — credentials are resolved
 * from the SecretBackend by the caller and passed as plaintext.
 */

export type IdentityProviderType = "github" | "slack" | "jira" | "google";

export interface ExternalIdentityUser {
  externalUserId: string;
  email: string | null;
  login: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  profileData: Record<string, unknown>;
  isBot: boolean;
  deleted: boolean;
}

export interface IdentityProviderConfig {
  /** Plaintext token — resolved from SecretBackend before calling adapter. */
  token: string;
  /** e.g., Jira Cloud URL, GitHub Enterprise URL. */
  apiBaseUrl?: string;
  /** e.g., GitHub org name. */
  org?: string;
  /** Provider-specific extras (e.g., Jira account email for basic auth). */
  extra?: Record<string, unknown>;
}

export interface IdentityProviderAdapter {
  readonly provider: IdentityProviderType;

  /**
   * Fetch all users from this provider source.
   * Used for bulk discovery — returns normalized user records for email-based matching.
   */
  fetchUsers(config: IdentityProviderConfig): Promise<ExternalIdentityUser[]>;

  /**
   * Fetch a single user's updated profile by externalUserId.
   * Used during periodic refresh of existing identity links.
   */
  fetchUserProfile(
    config: IdentityProviderConfig,
    externalUserId: string,
  ): Promise<ExternalIdentityUser | null>;
}
