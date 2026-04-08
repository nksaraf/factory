import type {
  IdentityProviderAdapter,
  IdentityProviderConfig,
  ExternalIdentityUser,
} from "./identity-provider-adapter";
import { slack, type SlackMember } from "./slack-client";

function toExternalUser(member: SlackMember): ExternalIdentityUser {
  return {
    externalUserId: member.id,
    email: member.profile?.email ?? null,
    login: member.name ?? null,
    displayName: member.profile?.display_name || member.name || member.id,
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
}

export class SlackIdentityProviderAdapter implements IdentityProviderAdapter {
  readonly provider = "slack" as const;

  async fetchUsers(config: IdentityProviderConfig): Promise<ExternalIdentityUser[]> {
    const members = await slack.usersList(config.token);
    return members.map(toExternalUser);
  }

  async fetchUserProfile(
    config: IdentityProviderConfig,
    externalUserId: string,
  ): Promise<ExternalIdentityUser | null> {
    const member = await slack.usersInfo(config.token, externalUserId);
    if (!member) return null;
    return toExternalUser(member);
  }
}
