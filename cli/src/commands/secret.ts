import type { DxBase } from "../dx-root.js"

import { exitWithError } from "../lib/cli-exit.js"
import { toDxFlags } from "./dx-flags.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("secret", [
  "$ dx secret set DB_PASSWORD s3cret          Set a secret (org scope)",
  "$ dx secret set API_KEY val --local         Set a local-only secret",
  "$ dx secret get DB_PASSWORD                 Get a secret value",
  "$ dx secret list                            List secrets",
  "$ dx secret list --local                    List local secrets",
  "$ dx secret rm DB_PASSWORD                  Remove a secret",
  "$ dx secret set KEY val --scope team --team platform   Set team-scoped secret",
  "$ dx secret set KEY val --env production    Set production-only secret",
])

const SCOPE_FLAGS = {
  local: {
    type: "boolean" as const,
    alias: "l",
    description: "Use local secret store (~/.config/dx/secrets.json)",
  },
  scope: {
    type: "string" as const,
    description:
      "Secret scope: org, team, project, system, site, deployment (default: org)",
  },
  team: {
    type: "string" as const,
    description: "Team slug (for team scope)",
  },
  project: {
    type: "string" as const,
    description: "Project slug (for project scope)",
  },
  system: {
    type: "string" as const,
    description: "System slug (for system scope)",
  },
  site: {
    type: "string" as const,
    description: "Site slug (for site scope)",
  },
  deployment: {
    type: "string" as const,
    description: "Deployment slug (for deployment scope)",
  },
  env: {
    type: "string" as const,
    description: "Environment: production, development, preview",
  },
}

export function secretCommand(app: DxBase) {
  return app
    .sub("secret")
    .meta({ description: "Manage secrets (local and remote)" })
    .command("set", (c) =>
      c
        .meta({ description: "Set a secret" })
        .args([
          {
            name: "key",
            type: "string",
            required: true,
            description: "Secret key (env var name)",
          },
          {
            name: "value",
            type: "string",
            required: true,
            description: "Secret value",
          },
        ])
        .flags(SCOPE_FLAGS)
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags)
          try {
            const { secretSet } = await import("../handlers/secret.js")
            await secretSet(args.key as string, args.value as string, {
              local: flags.local as boolean | undefined,
              scope: flags.scope as string | undefined,
              team: flags.team as string | undefined,
              project: flags.project as string | undefined,
              system: flags.system as string | undefined,
              site: flags.site as string | undefined,
              deployment: flags.deployment as string | undefined,
              env: flags.env as string | undefined,
              json: f.json,
            })
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err))
          }
        })
    )
    .command("get", (c) =>
      c
        .meta({ description: "Get a secret value" })
        .args([
          {
            name: "key",
            type: "string",
            required: true,
            description: "Secret key",
          },
        ])
        .flags(SCOPE_FLAGS)
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags)
          try {
            const { secretGet } = await import("../handlers/secret.js")
            await secretGet(args.key as string, {
              local: flags.local as boolean | undefined,
              scope: flags.scope as string | undefined,
              team: flags.team as string | undefined,
              project: flags.project as string | undefined,
              system: flags.system as string | undefined,
              site: flags.site as string | undefined,
              deployment: flags.deployment as string | undefined,
              env: flags.env as string | undefined,
              json: f.json,
            })
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err))
          }
        })
    )
    .command("list", (c) =>
      c
        .meta({ description: "List secrets" })
        .flags(SCOPE_FLAGS)
        .run(async ({ flags }) => {
          const f = toDxFlags(flags)
          try {
            const { secretList } = await import("../handlers/secret.js")
            await secretList({
              local: flags.local as boolean | undefined,
              scope: flags.scope as string | undefined,
              team: flags.team as string | undefined,
              project: flags.project as string | undefined,
              system: flags.system as string | undefined,
              site: flags.site as string | undefined,
              deployment: flags.deployment as string | undefined,
              env: flags.env as string | undefined,
              json: f.json,
            })
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err))
          }
        })
    )
    .command("rm", (c) =>
      c
        .meta({ description: "Remove a secret" })
        .args([
          {
            name: "key",
            type: "string",
            required: true,
            description: "Secret key",
          },
        ])
        .flags(SCOPE_FLAGS)
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags)
          try {
            const { secretRemove } = await import("../handlers/secret.js")
            await secretRemove(args.key as string, {
              local: flags.local as boolean | undefined,
              scope: flags.scope as string | undefined,
              team: flags.team as string | undefined,
              project: flags.project as string | undefined,
              system: flags.system as string | undefined,
              site: flags.site as string | undefined,
              deployment: flags.deployment as string | undefined,
              env: flags.env as string | undefined,
              json: f.json,
            })
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err))
          }
        })
    )
    .command("rotate", (c) =>
      c
        .meta({ description: "Rotate a secret (re-encrypt or set new value)" })
        .args([
          {
            name: "key",
            type: "string",
            required: true,
            description: "Secret key",
          },
          {
            name: "value",
            type: "string",
            description: "New value (optional, re-encrypts if omitted)",
          },
        ])
        .flags(SCOPE_FLAGS)
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags)
          try {
            const { secretRotate } = await import("../handlers/secret.js")
            await secretRotate(args.key as string, {
              value: args.value as string | undefined,
              local: flags.local as boolean | undefined,
              scope: flags.scope as string | undefined,
              team: flags.team as string | undefined,
              project: flags.project as string | undefined,
              system: flags.system as string | undefined,
              site: flags.site as string | undefined,
              deployment: flags.deployment as string | undefined,
              env: flags.env as string | undefined,
              json: f.json,
            })
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err))
          }
        })
    )
}
