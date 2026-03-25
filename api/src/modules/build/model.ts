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
} as const;

export type BuildModels = {
  [K in keyof typeof BuildModel]: UnwrapSchema<(typeof BuildModel)[K]>;
};
