import { styleBold, styleMuted, styleServiceStatus } from "../cli-style.js"
import type { DxBase } from "../dx-root.js"
import {
  type UnifiedServiceStatus,
  getUnifiedServices,
} from "../handlers/context-status.js"
import { exitWithError } from "../lib/cli-exit.js"
import { resolveDxContext } from "../lib/dx-context.js"
import { resolveSiteBackend } from "../lib/site-backend.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { toDxFlags } from "./dx-flags.js"

setExamples("ps", [
  "$ dx ps              List running services",
  "$ dx ps --all        Include stopped/exited services",
  "$ dx ps --json       Machine-readable output",
  "$ dx ps --site staging   List services on remote site",
])

export function psCommand(app: DxBase) {
  return app
    .sub("ps")
    .meta({ description: "List running services (docker + dev)" })
    .flags({
      all: {
        type: "boolean",
        alias: "a",
        description: "Include stopped/exited services",
      },
      site: {
        type: "string" as const,
        description: "Remote site slug (omit for local)",
      },
    })
    .run(async ({ flags }) => {
      const f = toDxFlags(flags)
      const siteSlug = flags.site as string | undefined

      if (siteSlug) {
        try {
          const backend = await resolveSiteBackend({ siteSlug })
          const sds = await backend.getSystemDeployments()
          const services: UnifiedServiceStatus[] = []
          for (const sd of sds) {
            for (const cd of sd.componentDeployments) {
              services.push({
                name: cd.componentSlug,
                runtime: cd.mode === "native" ? "dev" : "docker",
                status: cd.status.phase ?? "unknown",
                ports: cd.status.port ? `:${cd.status.port}` : "",
                pid: cd.status.pid ?? undefined,
              })
            }
          }
          if (f.json) {
            console.log(JSON.stringify({ success: true, services }, null, 2))
            return
          }
          if (services.length === 0) {
            console.log(styleMuted(`No services found on site ${siteSlug}.`))
            return
          }
          const nameW = 28
          const runtimeW = 10
          const statusW = 14
          console.log(
            `${styleBold("NAME".padEnd(nameW))}${styleBold("RUNTIME".padEnd(runtimeW))}${styleBold("STATUS".padEnd(statusW))}${styleBold("PORTS")}`
          )
          for (const svc of services) {
            const pid = svc.pid ? ` PID ${svc.pid}` : ""
            const ports = svc.ports ? `${svc.ports}${pid}` : pid.trim()
            const paddedStatus = svc.status.padEnd(statusW)
            console.log(
              `${svc.name.padEnd(nameW)}${svc.runtime.padEnd(runtimeW)}${styleServiceStatus(paddedStatus)}${styleMuted(ports)}`
            )
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          exitWithError(f, msg)
        }
        return
      }

      try {
        const ctx = await resolveDxContext({ need: "project" })
        const project = ctx.project

        const all = getUnifiedServices(project.rootDir, project.composeFiles)

        // Filter to running-only unless --all
        const services = flags.all
          ? all
          : all.filter(
              (s) =>
                s.status === "running" ||
                s.status.includes("healthy") ||
                s.status.includes("starting")
            )

        if (f.json) {
          console.log(JSON.stringify({ success: true, services }, null, 2))
          return
        }

        if (services.length === 0) {
          console.log(
            styleMuted("No services running. Use dx up or dx dev to start.")
          )
          return
        }

        // Header
        const nameW = 28
        const runtimeW = 10
        const statusW = 14
        console.log(
          `${styleBold("NAME".padEnd(nameW))}${styleBold("RUNTIME".padEnd(runtimeW))}${styleBold("STATUS".padEnd(statusW))}${styleBold("PORTS")}`
        )

        for (const svc of services) {
          const pid = svc.pid ? ` PID ${svc.pid}` : ""
          const ports = svc.ports ? `${svc.ports}${pid}` : pid.trim()
          // Pad the raw status first, then apply color styling (avoids ANSI escape code width issues)
          const paddedStatus = svc.status.padEnd(statusW)
          console.log(
            `${svc.name.padEnd(nameW)}${svc.runtime.padEnd(runtimeW)}${styleServiceStatus(paddedStatus)}${styleMuted(ports)}`
          )
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        exitWithError(f, msg)
      }
    })
}
