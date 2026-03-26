import { t, type UnwrapSchema } from "elysia";

export const BuildModel = {
  triggerBuildBody: t.Object({ moduleName: t.Optional(t.String()) }),
  idParams: t.Object({ id: t.String() }),
  moduleNameParams: t.Object({ name: t.String() }),
  registerVersionBody: t.Object({
    version: t.String(),
    compatibilityRange: t.Optional(t.String()),
    schemaVersion: t.Optional(t.String()),
  }),
  createRepoBody: t.Object({
    name: t.String(),
    slug: t.Optional(t.String()),
    kind: t.String(),
    teamId: t.String(),
    gitUrl: t.String(),
    defaultBranch: t.String(),
    moduleId: t.Optional(t.String()),
  }),
  listReposQuery: t.Object({
    moduleId: t.Optional(t.String()),
    limit: t.Optional(t.Number()),
    offset: t.Optional(t.Number()),
  }),
  listArtifactsQuery: t.Object({
    limit: t.Optional(t.Number()),
    offset: t.Optional(t.Number()),
  }),
  createArtifactBody: t.Object({
    imageRef: t.String(),
    imageDigest: t.String(),
    sizeBytes: t.Optional(t.Number()),
  }),
  linkComponentArtifactBody: t.Object({
    moduleVersionId: t.String(),
    componentId: t.String(),
    artifactId: t.String(),
  }),
  validateConventionBody: t.Object({
    type: t.Union([t.Literal("branch"), t.Literal("commit")]),
    value: t.String(),
    conventions: t.Optional(t.Any()),
  }),
  createGitHostProviderBody: t.Object({
    name: t.String(),
    hostType: t.String(),
    apiBaseUrl: t.String(),
    authMode: t.String(),
    credentialsEnc: t.Optional(t.String()),
    teamId: t.String(),
  }),
  updateGitHostProviderBody: t.Object({
    name: t.Optional(t.String()),
    credentialsEnc: t.Optional(t.String()),
    authMode: t.Optional(t.String()),
  }),
  listGitHostProvidersQuery: t.Object({
    teamId: t.Optional(t.String()),
    limit: t.Optional(t.Number()),
    offset: t.Optional(t.Number()),
  }),
  repoSlugParams: t.Object({ id: t.String(), repoSlug: t.String() }),
  prParams: t.Object({
    id: t.String(),
    repoSlug: t.String(),
    prNumber: t.Numeric(),
  }),
  listPullRequestsQuery: t.Object({
    state: t.Optional(t.String()),
  }),
  createPullRequestBody: t.Object({
    title: t.String(),
    body: t.Optional(t.String()),
    head: t.String(),
    base: t.String(),
    draft: t.Optional(t.Boolean()),
  }),
  mergePullRequestBody: t.Object({
    method: t.Optional(
      t.Union([
        t.Literal("merge"),
        t.Literal("squash"),
        t.Literal("rebase"),
      ]),
    ),
  }),
} as const;

export type BuildModels = {
  [K in keyof typeof BuildModel]: UnwrapSchema<(typeof BuildModel)[K]>;
};
