import type { DxBase } from "../dx-root.js"
import { toDxFlags } from "./dx-flags.js"
import { exitWithError } from "../lib/cli-exit.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("org identity", [
  "$ dx org identity list                          List all principals with provider links",
  "$ dx org identity show nikhil-saraf              Show principal details + linked identities",
  "$ dx org identity link nikhil-saraf github 12345 Manually link a GitHub identity",
  "$ dx org identity unlink nikhil-saraf jira       Remove a provider link",
  "$ dx org identity merge keep-slug dup-slug       Merge duplicate into kept principal",
  "$ dx org identity sync                           Trigger identity sync now",
  "$ dx org identity unmatched --provider github    Show principals missing GitHub",
])

export function orgCommand(app: DxBase) {
  return app
    .sub("org")
    .meta({ description: "Organization management" })
    .command("identity", (c) =>
      c
        .meta({ description: "Identity & principal management" })
        .command("list", (sub) =>
          sub.meta({ description: "List all principals with provider links" }).run(async ({ flags }) => {
            const f = toDxFlags(flags)
            try {
              const { runIdentityList } = await import("../handlers/org-identity.js")
              await runIdentityList(f)
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          }),
        )
        .command("show", (sub) =>
          sub
            .meta({ description: "Show principal details" })
            .args([{ name: "slug", type: "string", required: true, description: "Principal slug or ID" }])
            .run(async ({ args, flags }) => {
              const f = toDxFlags(flags)
              try {
                const { runIdentityShow } = await import("../handlers/org-identity.js")
                await runIdentityShow(f, args.slug)
              } catch (err) {
                exitWithError(f, err instanceof Error ? err.message : String(err))
              }
            }),
        )
        .command("link", (sub) =>
          sub
            .meta({ description: "Link an external identity to a principal" })
            .args([
              { name: "principal", type: "string", required: true, description: "Principal slug or ID" },
              { name: "provider", type: "string", required: true, description: "Provider (github, slack, jira, google)" },
              { name: "externalId", type: "string", required: true, description: "External user ID" },
            ])
            .flags({
              name: { type: "string" as const, description: "Display name for this identity" },
            })
            .run(async ({ args, flags }) => {
              const f = toDxFlags(flags)
              try {
                const { runIdentityLink } = await import("../handlers/org-identity.js")
                await runIdentityLink(f, args.principal, args.provider, args.externalId, flags.name as string | undefined)
              } catch (err) {
                exitWithError(f, err instanceof Error ? err.message : String(err))
              }
            }),
        )
        .command("unlink", (sub) =>
          sub
            .meta({ description: "Remove a provider link from a principal" })
            .args([
              { name: "principal", type: "string", required: true, description: "Principal slug or ID" },
              { name: "provider", type: "string", required: true, description: "Provider to unlink" },
            ])
            .run(async ({ args, flags }) => {
              const f = toDxFlags(flags)
              try {
                const { runIdentityUnlink } = await import("../handlers/org-identity.js")
                await runIdentityUnlink(f, args.principal, args.provider)
              } catch (err) {
                exitWithError(f, err instanceof Error ? err.message : String(err))
              }
            }),
        )
        .command("merge", (sub) =>
          sub
            .meta({ description: "Merge a duplicate principal into another" })
            .args([
              { name: "keep", type: "string", required: true, description: "Principal to keep (slug or ID)" },
              { name: "duplicate", type: "string", required: true, description: "Principal to merge & delete (slug or ID)" },
            ])
            .run(async ({ args, flags }) => {
              const f = toDxFlags(flags)
              try {
                const { runIdentityMerge } = await import("../handlers/org-identity.js")
                await runIdentityMerge(f, args.keep, args.duplicate)
              } catch (err) {
                exitWithError(f, err instanceof Error ? err.message : String(err))
              }
            }),
        )
        .command("sync", (sub) =>
          sub.meta({ description: "Trigger identity sync across all providers" }).run(async ({ flags }) => {
            const f = toDxFlags(flags)
            try {
              const { runIdentitySync } = await import("../handlers/org-identity.js")
              await runIdentitySync(f)
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          }),
        )
        .command("unmatched", (sub) =>
          sub
            .meta({ description: "Show principals missing provider links" })
            .flags({
              provider: { type: "string" as const, description: "Filter to principals missing this provider" },
            })
            .run(async ({ flags }) => {
              const f = toDxFlags(flags)
              try {
                const { runIdentityUnmatched } = await import("../handlers/org-identity.js")
                await runIdentityUnmatched(f, { provider: flags.provider as string | undefined })
              } catch (err) {
                exitWithError(f, err instanceof Error ? err.message : String(err))
              }
            }),
        ),
    )
}
