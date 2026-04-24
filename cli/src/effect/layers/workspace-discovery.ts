import { Effect, Layer } from "effect"
import { hostname } from "node:os"
import {
  WorkspaceDiscovery,
  type DiscoveredWorkspace,
} from "../services/workspace-discovery.js"
import type { FocusSystem } from "../services/site-config.js"

export const WorkspaceDiscoveryLive = Layer.succeed(
  WorkspaceDiscovery,
  WorkspaceDiscovery.of({
    discover: Effect.tryPromise({
      try: async () => {
        const { resolveDxContext } = await import("../../lib/dx-context.js")
        const ctx = await resolveDxContext({ need: "project" })

        const project = ctx.project
        const workbenchSlug =
          ctx.workbench?.name ?? hostname().replace(/\.local$/, "")

        const focusSystem: FocusSystem = {
          name: project.name,
          sdSlug: project.name,
          rootDir: project.rootDir,
          catalog: project.catalog,
          composeFiles: project.composeFiles,
          conventions: project.conventions,
          dxConfig: project.dxConfig,
          packages: project.monorepoPackages,
        }

        return {
          focusSystem,
          workbench: ctx.workbench
            ? {
                slug: ctx.workbench.name,
                kind: ctx.workbench.kind,
                dir: ctx.workbench.dir,
                branch: ctx.workbench.branch ?? undefined,
              }
            : null,
          host: {
            factoryUrl: ctx.host?.factory?.url ?? null,
          },
          raw: ctx,
        } satisfies DiscoveredWorkspace
      },
      catch: (e) =>
        new Error(
          `Failed to discover workspace: ${e instanceof Error ? e.message : String(e)}`
        ),
    }).pipe(Effect.orDie, Effect.withSpan("WorkspaceDiscovery.discover")),
  })
)
