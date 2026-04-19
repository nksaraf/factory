import type { DxBase } from "../dx-root.js"
import { runContextStatus } from "../handlers/context-status.js"
import { resolveSiteBackend } from "../lib/site-backend.js"
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
          const backend = await resolveSiteBackend({ siteSlug })
          const state = await backend.getState()
          const spec = state.spec
          const status = state.status

          console.log(`Site:     ${spec.site.slug} (${spec.site.type})`)
          console.log(`Mode:     ${spec.mode}`)
          console.log(`Phase:    ${status.phase}`)
          console.log(`Updated:  ${status.updatedAt}`)
          console.log("")
          for (const sd of spec.systemDeployments as any[]) {
            const realmInfo = sd.realm
              ? ` on ${sd.realm.slug} (${sd.realm.type})`
              : ""
            const linked = sd.linkedRef ? " (linked)" : ""
            console.log(`System:   ${sd.systemSlug}${linked}`)
            if (realmInfo)
              console.log(`Realm:    ${sd.realm.slug} (${sd.realm.type})`)
            console.log(`Components:`)
            for (const cd of sd.componentDeployments) {
              const phase = cd.status?.phase ?? "unknown"
              const image = cd.spec?.desiredImage
                ? cd.spec.desiredImage.split("/").pop()?.substring(0, 40)
                : ""
              console.log(
                `  ${cd.componentSlug.padEnd(28)} ${phase.padEnd(10)} ${image}`
              )
            }
            console.log("")
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
