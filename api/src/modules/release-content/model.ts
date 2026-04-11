import { t } from "elysia"

export const ReleaseContentModel = {
  versionParams: t.Object({ version: t.String() }),

  generateBody: t.Object({
    repoFullName: t.String({ description: "Full repo name (owner/repo)" }),
    outputs: t.Optional(
      t.Array(
        t.Union([
          t.Literal("changelog"),
          t.Literal("release-notes"),
          t.Literal("api-docs"),
          t.Literal("internal-docs"),
          t.Literal("announcement"),
        ])
      )
    ),
    changelogPath: t.Optional(t.String()),
    docsDir: t.Optional(t.String()),
  }),
}
