import type { DxBase } from "../dx-root.js"
import { runContextStatus } from "../handlers/context-status.js"
import { resolveSiteBackend } from "../lib/site-backend.js"
import { resolveDxContext } from "../lib/dx-context.js"
import { exitWithError } from "../lib/cli-exit.js"

import { toDxFlags } from "./dx-flags.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("status", [
  "$ dx status              Check API and git status",
  "$ dx status --json       Machine-readable status",
  "$ dx status --site staging   Check remote site status",
])

export function statusCommand(app: DxBase) {
  return app
    .sub("status")
    .meta({ description: "Status of the current context" })
    .flags({
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
          const backend = resolveSiteBackend({ siteSlug })
          const state = await backend.getState()
          const spec = state.spec
          const status = state.status

          console.log(`Site: ${spec.site.slug} (${spec.site.type})`)
          console.log(`Mode: ${spec.mode}`)
          console.log(`Phase: ${status.phase}`)
          console.log(`Updated: ${status.updatedAt}`)
          console.log(`Systems: ${spec.systemDeployments.length} deployment(s)`)
          for (const sd of spec.systemDeployments) {
            const linked = sd.linkedRef ? " (linked)" : ""
            console.log(
              `  ${sd.slug}: ${sd.componentDeployments.length} component(s)${linked}`
            )
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          exitWithError(f, msg)
        }
        return
      }

      await runContextStatus(f)
    })
}
