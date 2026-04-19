import { existsSync } from "node:fs"
import { basename, join } from "node:path"

import type { DxBase } from "../dx-root.js"
import { exitWithError } from "../lib/cli-exit.js"
import { Compose, isDockerRunning } from "../lib/docker.js"
import { resolveDxContext } from "../lib/dx-context.js"
import { SiteManager } from "../lib/site-manager.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { killProcessTree } from "../site/execution/native.js"
import { toDxFlags } from "./dx-flags.js"

setExamples("down", [
  "$ dx down                Tear down all services",
  "$ dx down --volumes      Also remove volumes",
])

export function downCommand(app: DxBase) {
  return app
    .sub("down")
    .meta({ description: "Tear down the docker compose stack" })
    .flags({
      volumes: {
        type: "boolean",
        alias: "v",
        description: "Remove named volumes declared in the compose file",
      },
    })
    .run(async ({ flags }) => {
      const f = toDxFlags(flags)
      try {
        const ctx = await resolveDxContext({ need: "project" })
        const project = ctx.project

        // Kill native dev servers first (works even without Docker)
        const site = SiteManager.load(project.rootDir)
        if (site) {
          for (const sd of site.getSpec().systemDeployments) {
            for (const cd of sd.componentDeployments) {
              if (cd.mode === "native" && cd.status.pid != null) {
                try {
                  killProcessTree(cd.status.pid)
                  if (!f.quiet) {
                    console.log(
                      `Stopped ${cd.componentSlug} (PID ${cd.status.pid})`
                    )
                  }
                } catch {
                  /* already gone */
                }
              }
            }
          }
        }

        // Compose down (only if Docker is running and compose files exist)
        if (project.composeFiles.length > 0 && isDockerRunning()) {
          const allProfiles = project.allProfiles
          const envPath = join(project.rootDir, ".dx", "ports.env")
          const compose = new Compose(
            project.composeFiles,
            basename(project.rootDir),
            existsSync(envPath) ? envPath : undefined
          )

          if (f.verbose) {
            if (allProfiles.length > 0) {
              console.log(`Profiles: ${allProfiles.join(", ")}`)
            }
            console.log(`Compose files: ${project.composeFiles.join(", ")}`)
          }

          compose.down({
            profiles: allProfiles.length > 0 ? allProfiles : undefined,
            volumes: !!flags.volumes,
          })
        }

        if (site) {
          site.setPhase("stopped")
          site.save()
        }

        if (!f.json) {
          const volMsg = flags.volumes ? " (volumes removed)" : ""
          console.log(`Site stopped${volMsg}`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        exitWithError(f, msg)
      }
    })
}
