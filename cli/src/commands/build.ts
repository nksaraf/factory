import { join, resolve } from "node:path"

import type { DxBase } from "../dx-root.js"
import { exitWithError } from "../lib/cli-exit.js"
import { dockerBuild } from "../lib/docker.js"
import { resolveDxContext } from "../lib/dx-context.js"

import { toDxFlags } from "./dx-flags.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("build", [
  "$ dx build               Build all components",
  "$ dx build api           Build specific component",
])

function imageTag(system: string, component: string): string {
  const safe = `${system}-${component}`
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
  return `${safe}:latest`
}

export function buildCommand(app: DxBase) {
  return app
    .sub("build")
    .meta({ description: "Build artifacts" })
    .args([
      {
        name: "components",
        type: "string",
        variadic: true,
        description: "Component names to build (default: all)",
      },
    ])
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags)
      try {
        const ctx = await resolveDxContext({ need: "project" })
        const project = ctx.project
        const componentNames = Object.keys(project.catalog.components)
        const names =
          args.components?.length && args.components.length > 0
            ? args.components
            : componentNames
        for (const name of names) {
          const comp = project.catalog.components[name]
          if (!comp) {
            exitWithError(f, `Unknown component "${name}"`)
          }
          const build = comp!.spec.build
          if (!build) {
            exitWithError(f, `Component "${name}" has no build context`)
          }
          const context = resolve(project.rootDir, build!.context)
          const dockerfileName = build!.dockerfile ?? "Dockerfile"
          const dockerfilePath = join(context, dockerfileName)
          const tag = imageTag(project.name, name)
          if (f.verbose) {
            console.log(
              `docker build -t ${tag} -f ${dockerfilePath} ${context}`
            )
          }
          dockerBuild(context, dockerfilePath, tag)
          if (!f.json) {
            console.log(`Built ${tag}`)
          }
        }
        if (f.json) {
          console.log(JSON.stringify({ success: true, exitCode: 0 }))
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        exitWithError(f, msg)
      }
    })
}
