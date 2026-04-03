import { t, type UnwrapSchema } from "elysia"

export const PreviewModel = {
  slugParams: t.Object({ slug: t.String() }),

  createPreviewBody: t.Object({
    name: t.String(),
    sourceBranch: t.String(),
    commitSha: t.String(),
    repo: t.String(),
    prNumber: t.Optional(t.Number()),
    siteName: t.String(),
    siteId: t.Optional(t.String()),
    clusterId: t.Optional(t.String()),
    ownerId: t.String(),
    createdBy: t.String(),
    authMode: t.Optional(t.String()),
    expiresAt: t.Optional(t.String()),
    imageRef: t.Optional(t.String()),
  }),

  deliverImageBody: t.Object({
    imageRef: t.String(),
  }),

  extendBody: t.Object({
    days: t.Number({ minimum: 1, maximum: 90 }),
  }),

  listPreviewsQuery: t.Object({
    siteId: t.Optional(t.String()),
    status: t.Optional(t.String()),
    sourceBranch: t.Optional(t.String()),
    repo: t.Optional(t.String()),
  }),

  updatePreviewStatusBody: t.Object({
    status: t.Optional(t.String()),
    runtimeClass: t.Optional(t.String()),
    statusMessage: t.Optional(t.String()),
    commitSha: t.Optional(t.String()),
  }),
} as const

export type PreviewModels = {
  [K in keyof typeof PreviewModel]: UnwrapSchema<(typeof PreviewModel)[K]>
}
