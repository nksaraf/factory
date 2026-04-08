import { WebClient } from "@slack/web-api";
import type {
  IdentityProviderAdapter,
  IdentityProviderConfig,
  ExternalIdentityUser,
} from "./identity-provider-adapter";
import { slackClient, withSocketRetry } from "./slack-client";

/**
 * Slack identity provider adapter.
 *
 * Discovery: lists workspace members via users.list.
 * Profile refresh: fetches a single user via users.info.
 *
 * API methods used:
 * - fetchUsers: users.list (paginated)
 * - fetchUserProfile: users.info
 */
export class SlackIdentityProviderAdapter implements IdentityProviderAdapter {
  readonly provider = "slack" as const;

  private client(token: string): WebClient {
    return slackClient(token);
  }

  async fetchUsers(config: IdentityProviderConfig): Promise<ExternalIdentityUser[]> {
    return withSocketRetry("slack.users.list", async () => {
    const client = this.client(config.token);
    const users: ExternalIdentityUser[] = [];
    let cursor: string | undefined;

    do {
      const result = await client.users.list({ limit: 200, cursor });

      for (const member of result.members ?? []) {
        users.push({
          externalUserId: member.id!,
          email: member.profile?.email ?? null,
          login: member.name ?? null,
          displayName:
            member.profile?.display_name || member.name || member.id!,
          avatarUrl: member.profile?.image_72 ?? null,
          bio: member.profile?.status_text ?? null,
          profileData: {
            realName: member.real_name ?? null,
            displayName: member.profile?.display_name ?? null,
            avatarUrl: member.profile?.image_72 ?? null,
            title: member.profile?.title ?? null,
            phone: member.profile?.phone ?? null,
            statusText: member.profile?.status_text ?? null,
            statusEmoji: member.profile?.status_emoji ?? null,
          },
          isBot: member.is_bot ?? false,
          deleted: member.deleted ?? false,
        });
      }

      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    return users;
    }); // withSocketRetry
  }

  async fetchUserProfile(
    config: IdentityProviderConfig,
    externalUserId: string,
  ): Promise<ExternalIdentityUser | null> {
    const client = this.client(config.token);

    try {
      const result = await client.users.info({ user: externalUserId });
      const member = result.user;
      if (!member) return null;

      return {
        externalUserId: member.id!,
        email: member.profile?.email ?? null,
        login: member.name ?? null,
        displayName:
          member.profile?.display_name || member.name || member.id!,
        avatarUrl: member.profile?.image_72 ?? null,
        bio: member.profile?.status_text ?? null,
        profileData: {
          realName: member.real_name ?? null,
          displayName: member.profile?.display_name ?? null,
          avatarUrl: member.profile?.image_72 ?? null,
          title: member.profile?.title ?? null,
          phone: member.profile?.phone ?? null,
          statusText: member.profile?.status_text ?? null,
          statusEmoji: member.profile?.status_emoji ?? null,
        },
        isBot: member.is_bot ?? false,
        deleted: member.deleted ?? false,
      };
    } catch {
      return null;
    }
  }
}
