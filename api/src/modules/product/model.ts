import { t, type UnwrapSchema } from "elysia"

export const ProductModel = {
  // Module
  moduleNameParams: t.Object({ name: t.String() }),
  registerModuleBody: t.Object({
    name: t.String(),
    teamId: t.String(),
    product: t.Optional(t.String()),
  }),

  // Work item
  workItemIdParams: t.Object({ id: t.String() }),
  createWorkItemBody: t.Object({
    title: t.String(),
    moduleId: t.Optional(t.String()),
    status: t.Optional(t.String()),
    kind: t.Optional(t.String()),
    priority: t.Optional(t.String()),
    description: t.Optional(t.String()),
    labels: t.Optional(t.Array(t.String())),
    parentWorkItemId: t.Optional(t.String()),
  }),
  updateWorkItemBody: t.Object({
    title: t.Optional(t.String()),
    status: t.Optional(t.String()),
    kind: t.Optional(t.String()),
    priority: t.Optional(t.String()),
    description: t.Optional(t.String()),
    labels: t.Optional(t.Array(t.String())),
    assignee: t.Optional(t.String()),
    parentWorkItemId: t.Optional(t.String()),
  }),

  // Work tracker provider
  idParams: t.Object({ id: t.String() }),
  listWorkTrackerProvidersQuery: t.Object({
    status: t.Optional(t.String()),
  }),
  createWorkTrackerProviderBody: t.Object({
    name: t.String(),
    kind: t.Union([t.Literal("jira"), t.Literal("linear")]),
    apiUrl: t.String(),
    credentialsRef: t.Optional(t.String()),
    defaultProjectKey: t.Optional(t.String()),
  }),
  updateWorkTrackerProviderBody: t.Object({
    name: t.Optional(t.String()),
    apiUrl: t.Optional(t.String()),
    credentialsRef: t.Optional(t.String()),
    defaultProjectKey: t.Optional(t.String()),
    status: t.Optional(
      t.Union([t.Literal("active"), t.Literal("inactive")])
    ),
    syncEnabled: t.Optional(t.Boolean()),
    syncIntervalMinutes: t.Optional(t.Number()),
  }),

  // Project mapping
  listProjectMappingsQuery: t.Object({
    workTrackerProviderId: t.String(),
  }),
  createProjectMappingBody: t.Object({
    workTrackerProviderId: t.String(),
    moduleId: t.String(),
    externalProjectId: t.String(),
    externalProjectName: t.Optional(t.String()),
    syncDirection: t.Optional(
      t.Union([
        t.Literal("pull"),
        t.Literal("push"),
        t.Literal("bidirectional"),
      ])
    ),
    filterQuery: t.Optional(t.String()),
  }),

  // Push work item
  pushWorkItemBody: t.Object({
    workTrackerProviderId: t.String(),
  }),

  // PRD epic flow
  createEpicFromPrdBody: t.Object({
    workTrackerProviderId: t.String(),
    moduleId: t.String(),
    epic: t.Object({
      title: t.String(),
      description: t.String(),
    }),
    stories: t.Array(
      t.Object({
        title: t.String(),
        description: t.String(),
        kind: t.Optional(t.String()),
        priority: t.Optional(t.String()),
      })
    ),
  }),
} as const

export type ProductModels = {
  [K in keyof typeof ProductModel]: UnwrapSchema<(typeof ProductModel)[K]>
}
