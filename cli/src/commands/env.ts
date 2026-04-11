import {
  type NormalizedProfileEntry,
  normalizeProfileEntry,
} from "@smp/factory-shared/connection-context-schemas"
import { loadConnectionProfile } from "@smp/factory-shared/connection-profile-loader"
import {
  formatResolvedEnv,
  resolveEnvVars,
} from "@smp/factory-shared/env-resolution"

import type { DxBase } from "../dx-root.js"
import { resolveDxContext } from "../lib/dx-context.js"
import {
  mergeConnectionSources,
  parseConnectFlags,
  parseConnectToFlag,
  parseEnvFlags,
} from "../lib/parse-connect-flags.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { toDxFlags } from "./dx-flags.js"

setExamples("env", [
  "$ dx env resolve                   Resolve environment variables",
  "$ dx env resolve --export          Export as shell vars",
])

export function envCommand(app: DxBase) {
  return app
    .sub("env")
    .meta({ description: "Environment variable resolution" })
    .command("resolve", (c) =>
      c
        .meta({ description: "Resolve and display environment variables" })
        .flags({
          "connect-to": {
            type: "string",
            description: "Connect all deps to a deployment target",
          },
          connect: {
            type: "string",
            short: "c",
            description: "Selective connection: dep:target (repeatable)",
          },
          profile: {
            type: "string",
            short: "p",
            description: "Connection profile name",
          },
          env: {
            type: "string",
            short: "e",
            description: "Env var override: KEY=VALUE (repeatable)",
          },
          export: {
            type: "boolean",
            description: "Output in export format (shell-eval compatible)",
          },
          scope: {
            type: "string",
            description:
              'Resolution scope: "org", "team", or "project" (fetches from Factory API)',
          },
          team: {
            type: "string",
            description: "Team slug (used with --scope)",
          },
          project: {
            type: "string",
            description: "Project slug (used with --scope)",
          },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags)

          try {
            // Remote scope-based resolution
            if (flags.scope) {
              const validScopes = [
                "org",
                "team",
                "project",
                "principal",
                "system",
              ]
              const scopeVal = flags.scope as string
              if (!validScopes.includes(scopeVal)) {
                console.error(
                  `Error: Invalid scope "${scopeVal}". Must be one of: ${validScopes.join(", ")}`
                )
                process.exit(1)
              }
              const { resolveEnvScope } =
                await import("../handlers/env-scope.js")
              await resolveEnvScope({
                scope: scopeVal,
                team: flags.team as string | undefined,
                project: flags.project as string | undefined,
                env: flags.env as string | undefined,
                export: flags.export as boolean | undefined,
                json: f.json,
              })
              return
            }
            const ctx = await resolveDxContext({ need: "project" })
            const project = ctx.project

            // Resolve profile name: --connect-to and --profile both load a named profile
            const profileName =
              (flags["connect-to"] as string | undefined) ??
              (flags.profile as string | undefined)

            // Load merged profile (connect entries + env vars)
            const profile = profileName
              ? loadConnectionProfile(project.rootDir, profileName)
              : null

            const profileEnv = profile?.env ?? {}

            // Build connection overrides
            let profileOverrides:
              | Record<string, NormalizedProfileEntry>
              | undefined
            if (profile && Object.keys(profile.connect).length > 0) {
              profileOverrides = {}
              for (const [key, entry] of Object.entries(profile.connect)) {
                profileOverrides[key] = normalizeProfileEntry(entry)
              }
            }

            const connectToOverrides = flags["connect-to"]
              ? parseConnectToFlag(
                  flags["connect-to"] as string,
                  project.catalog
                )
              : undefined

            const connectFlags = flags.connect
              ? parseConnectFlags(
                  Array.isArray(flags.connect)
                    ? flags.connect
                    : [flags.connect as string]
                )
              : undefined

            const overrides = mergeConnectionSources(
              profileOverrides,
              connectToOverrides,
              connectFlags
            )

            // Parse --env flags
            const envFlags = flags.env
              ? parseEnvFlags(
                  Array.isArray(flags.env) ? flags.env : [flags.env as string]
                )
              : undefined

            // Profile env is the tier overlay (merged — no separate tier file)
            const tierOverlay =
              Object.keys(profileEnv).length > 0 ? profileEnv : undefined

            const resolved = resolveEnvVars({
              catalog: project.catalog,
              tierOverlay,
              connectionOverrides: overrides,
              cliEnvFlags: envFlags,
            })

            if (f.json) {
              console.log(JSON.stringify(resolved.envVars, null, 2))
            } else if (flags.export) {
              console.log(formatResolvedEnv(resolved.envVars, "export"))
            } else {
              console.log(formatResolvedEnv(resolved.envVars, "annotated"))
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            console.error(`Error: ${msg}`)
            process.exit(1)
          }
        })
    )
}
