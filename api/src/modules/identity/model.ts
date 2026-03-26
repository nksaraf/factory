import { t, type UnwrapSchema } from "elysia";

export const IdentityModel = {
  providerParams: t.Object({ provider: t.String() }),
  idParams: t.Object({ id: t.String() }),

  linkIdentityBody: t.Object({
    externalUserId: t.String(),
    externalLogin: t.Optional(t.String()),
    email: t.Optional(t.String()),
    authUserId: t.Optional(t.String()),
    profileData: t.Optional(t.Record(t.String(), t.Unknown())),
  }),

  updateProfileBody: t.Object({
    displayName: t.Optional(t.String()),
    avatarUrl: t.Optional(t.String()),
    bio: t.Optional(t.String()),
    timezone: t.Optional(t.String()),
  }),

  createToolCredentialBody: t.Object({
    provider: t.String(),
    keyName: t.String(),
    key: t.String(),
  }),

  reportToolUsageBody: t.Object({
    tool: t.String(),
    sessionId: t.Optional(t.String()),
    model: t.Optional(t.String()),
    inputTokens: t.Optional(t.Number()),
    outputTokens: t.Optional(t.Number()),
    cacheReadTokens: t.Optional(t.Number()),
    costMicrodollars: t.Optional(t.Number()),
    metadata: t.Optional(t.Record(t.String(), t.Unknown())),
  }),

  toolUsageQuery: t.Object({
    tool: t.Optional(t.String()),
    since: t.Optional(t.String()),
    until: t.Optional(t.String()),
    limit: t.Optional(t.Number()),
    offset: t.Optional(t.Number()),
  }),
} as const;

export type IdentityModels = {
  [K in keyof typeof IdentityModel]: UnwrapSchema<(typeof IdentityModel)[K]>;
};
