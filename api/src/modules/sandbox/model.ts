import { t, type UnwrapSchema } from "elysia"

export const SandboxModel = {
  idParams: t.Object({ id: t.String() }),

  // Access sub-resource params
  accessParams: t.Object({ id: t.String(), principalId: t.String() }),

  // Sandbox lifecycle
  createSandboxBody: t.Object({
    name: t.String(),
    slug: t.Optional(t.String()),
    runtimeType: t.Optional(t.String()),
    templateId: t.Optional(t.String()),
    ownerId: t.String(),
    ownerType: t.String(),
    trigger: t.Optional(t.String()),
    ttlMinutes: t.Optional(t.Number()),
    cpu: t.Optional(t.String()),
    memory: t.Optional(t.String()),
    storageGb: t.Optional(t.Number()),
    dockerCacheGb: t.Optional(t.Number()),
    repos: t.Optional(t.Array(t.Object({
      url: t.String(),
      branch: t.Optional(t.String()),
      clonePath: t.Optional(t.String()),
    }))),
    devcontainerConfig: t.Optional(t.Record(t.String(), t.Unknown())),
    devcontainerImage: t.Optional(t.String()),
    gpu: t.Optional(t.Boolean()),
  }),
  listSandboxesQuery: t.Object({
    ownerId: t.Optional(t.String()),
    ownerType: t.Optional(t.String()),
    runtimeType: t.Optional(t.String()),
    status: t.Optional(t.String()),
  }),
  resizeSandboxBody: t.Object({
    cpu: t.Optional(t.String()),
    memory: t.Optional(t.String()),
    storageGb: t.Optional(t.Number()),
  }),
  extendSandboxBody: t.Object({
    additionalMinutes: t.Number(),
  }),

  // Snapshots
  createSnapshotBody: t.Object({
    name: t.String(),
    description: t.Optional(t.String()),
  }),
  cloneSnapshotBody: t.Object({
    name: t.String(),
    ownerId: t.String(),
    ownerType: t.String(),
  }),

  // Access / sharing
  grantAccessBody: t.Object({
    principalId: t.String(),
    principalType: t.String(),
    role: t.String(),
    grantedBy: t.String(),
  }),

  // Templates
  listTemplatesQuery: t.Object({
    runtimeType: t.Optional(t.String()),
  }),
  createTemplateBody: t.Object({
    name: t.String(),
    slug: t.Optional(t.String()),
    runtimeType: t.String(),
    image: t.Optional(t.String()),
    defaultCpu: t.Optional(t.String()),
    defaultMemory: t.Optional(t.String()),
    defaultStorageGb: t.Optional(t.Number()),
    defaultDockerCacheGb: t.Optional(t.Number()),
    vmTemplateRef: t.Optional(t.String()),
    defaultTtlMinutes: t.Optional(t.Number()),
    preInstalledTools: t.Optional(t.Array(t.Unknown())),
    description: t.Optional(t.String()),
    isDefault: t.Optional(t.Boolean()),
  }),
} as const

export type SandboxModels = {
  [K in keyof typeof SandboxModel]: UnwrapSchema<(typeof SandboxModel)[K]>
}
