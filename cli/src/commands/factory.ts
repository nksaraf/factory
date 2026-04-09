import { getFactoryRestClient } from "../client.js"
import type { DxBase } from "../dx-root.js"
import { exitWithError } from "../lib/cli-exit.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { toDxFlags } from "./dx-flags.js"
import { stubRun } from "./stub-run.js"

type SyncProviderRow = {
  id?: string
  slug?: string
  name?: string
}

type SyncInvocation = {
  provider: string
  name: string
  result: unknown
}

function formatSyncResult(result: unknown): string {
  if (!result || typeof result !== "object") return JSON.stringify(result)

  const row = result as Record<string, unknown>
  if (
    typeof row.created === "number" &&
    typeof row.updated === "number" &&
    typeof row.removed === "number"
  ) {
    return `${row.created} created, ${row.updated} updated, ${row.removed} removed`
  }

  const projects = row.projects as Record<string, unknown> | undefined
  const items = row.items as Record<string, unknown> | undefined
  if (projects && items) {
    return [
      `projects ${projects.created ?? 0}/${projects.updated ?? 0}/${projects.total ?? 0}`,
      `items ${items.created ?? 0}/${items.updated ?? 0}/${items.total ?? 0}`,
    ].join(" | ")
  }

  return JSON.stringify(result)
}

async function runEntitySync(
  module: string,
  entity: string,
  providerFilter?: string
): Promise<SyncInvocation[]> {
  const client = await getFactoryRestClient()
  const rows = ((await client.listEntities(module, entity)).data ??
    []) as Record<string, unknown>[]
  const providers = rows as SyncProviderRow[]
  const targets = providerFilter
    ? providers.filter(
        (row) => row.slug === providerFilter || row.id === providerFilter
      )
    : providers

  if (providerFilter && targets.length === 0) {
    throw new Error(`Provider not found: ${providerFilter}`)
  }

  const results: SyncInvocation[] = []
  for (const provider of targets) {
    const slugOrId = provider.slug ?? provider.id
    if (!slugOrId) continue
    const response = await client.entityAction(module, entity, slugOrId, "sync")
    results.push({
      provider: slugOrId,
      name: provider.name ?? slugOrId,
      result: response.data,
    })
  }

  return results
}

async function printSyncResults(
  flags: Record<string, unknown>,
  label: string,
  results: SyncInvocation[]
) {
  const f = toDxFlags(flags)
  if (f.json) {
    console.log(JSON.stringify({ label, results }, null, 2))
    return
  }

  if (results.length === 0) {
    console.log(`No ${label.toLowerCase()} providers found.`)
    return
  }

  console.log(`${label} sync`)
  for (const entry of results) {
    console.log(
      `  ${entry.name} (${entry.provider}): ${formatSyncResult(entry.result)}`
    )
  }
}

setExamples("factory", [
  "$ dx factory login                 Sign in to Factory",
  "$ dx factory login --ci            Non-interactive sign-in for CI",
  "$ dx factory logout                Sign out",
  "$ dx factory status                Auth + API status",
  "$ dx factory ops                   View all background operation status",
  "$ dx factory ops proxmox           Detail view for a specific operation",
  "$ dx factory ops proxmox --trigger Manually trigger an operation run",
  "$ dx factory sync git              Sync repos from git host providers",
  "$ dx factory sync work-tracker     Sync projects and issues from work trackers",
  "$ dx factory hosts list            List managed hosts",
  "$ dx factory connect <url>         Point CLI at a factory instance",
  "$ dx factory install               Install the factory platform",
])

export function factoryCommand(app: DxBase) {
  return (
    app
      .sub("factory")
      .meta({ description: "Factory platform operations" })

      // ── status ──
      .command("status", (c) =>
        c
          .meta({ description: "Factory API health, repo, and PR status" })
          .run(async ({ flags }) => {
            const { runFactoryStatus } =
              await import("../handlers/factory-status.js")
            await runFactoryStatus(toDxFlags(flags))
          })
      )

      // ── health ──
      .command("health", (c) =>
        c
          .meta({ description: "Deep health check of factory services" })
          .run(async ({ flags }) => {
            const { runFactoryHealth } =
              await import("../handlers/factory-health.js")
            await runFactoryHealth(toDxFlags(flags))
          })
      )

      // ── connect ──
      .command("connect", (c) =>
        c
          .meta({ description: "Point CLI at a factory instance" })
          .args([
            {
              name: "url",
              type: "string",
              description: "Factory URL (e.g. https://factory.example.com)",
            },
          ])
          .run(async ({ args, flags }) => {
            const { runFactoryConnect } =
              await import("../handlers/factory-connect.js")
            await runFactoryConnect(toDxFlags(flags), {
              url: args.url as string | undefined,
            })
          })
      )

      // ── config ──
      .command("config", (c) =>
        c
          .meta({ description: "View factory configuration" })
          .run(async ({ flags }) => {
            const { runFactoryConfig } =
              await import("../handlers/factory-config.js")
            await runFactoryConfig(toDxFlags(flags))
          })
      )

      // ── login (direct — replaces dx auth login) ──
      .command("login", (c) =>
        c
          .meta({
            description:
              "Sign in to Factory (configure registries + SSH hosts)",
          })
          .flags({
            email: { type: "string", short: "e", description: "Account email" },
            password: {
              type: "string",
              description: "Password (omit for hidden prompt)",
            },
            ci: {
              type: "boolean",
              description: "Non-interactive mode for CI (uses env vars)",
            },
          })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            const { runAuthLogin } = await import("../handlers/auth-login.js")
            await runAuthLogin(f, {
              email: f.email as string | undefined,
              password: f.password as string | undefined,
              ci: !!flags.ci,
            })
          })
      )

      // ── logout (direct — replaces dx auth logout) ──
      .command("logout", (c) =>
        c
          .meta({ description: "Sign out and remove local session" })
          .run(async ({ flags }) => {
            const { runAuthLogout } = await import("../handlers/auth-logout.js")
            await runAuthLogout(toDxFlags(flags))
          })
      )

      // ── whoami ──
      .command("whoami", (c) =>
        c
          .meta({ description: "Print the current signed-in user" })
          .run(async ({ flags }) => {
            const { runWhoami } = await import("../handlers/whoami.js")
            await runWhoami(toDxFlags(flags))
          })
      )

      // ── install ──
      .command("install", (c) =>
        c
          .meta({ description: "Install the factory platform on this node" })
          .flags({
            bundle: {
              type: "string",
              short: "b",
              description: "Path to offline bundle directory",
            },
            force: {
              type: "boolean",
              description: "Force install over existing installation",
            },
            fresh: {
              type: "boolean",
              description:
                "Ignore saved install progress and start from phase 1",
            },
            kubeconfig: {
              type: "string",
              short: "k",
              description: "Path to kubeconfig for a remote cluster",
            },
          })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            try {
              // Re-use the install handler but force the factory role
              const { spawnSync } = await import("node:child_process")
              const args = ["install", "--role", "factory"]
              if (flags.bundle) args.push("--bundle", flags.bundle as string)
              if (flags.force) args.push("--force")
              if (flags.fresh) args.push("--fresh")
              if (flags.kubeconfig)
                args.push("--kubeconfig", flags.kubeconfig as string)
              if (f.json) args.push("--json")
              if (f.verbose) args.push("--verbose")
              if (f.debug) args.push("--debug")

              const result = spawnSync(
                process.argv[0],
                [process.argv[1], ...args],
                {
                  stdio: "inherit",
                  env: process.env,
                }
              )
              process.exit(result.status ?? 1)
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
      )

      // ── upgrade ──
      .command("upgrade", (c) =>
        c
          .meta({ description: "Upgrade an existing factory installation" })
          .flags({
            bundle: {
              type: "string",
              short: "b",
              description: "Path to offline bundle directory",
            },
            version: { type: "string", description: "Target version" },
          })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            try {
              const { spawnSync } = await import("node:child_process")
              const args = ["install", "upgrade"]
              if (flags.bundle) args.push("--bundle", flags.bundle as string)
              if (flags.version) args.push("--version", flags.version as string)
              if (f.verbose) args.push("--verbose")
              if (f.json) args.push("--json")
              if (f.debug) args.push("--debug")

              const result = spawnSync(
                process.argv[0],
                [process.argv[1], ...args],
                {
                  stdio: "inherit",
                  env: process.env,
                }
              )
              process.exit(result.status ?? 1)
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
      )

      // ── uninstall ──
      .command("uninstall", (c) =>
        c
          .meta({ description: "Tear down the factory platform" })
          .flags({
            keepK3s: {
              type: "boolean",
              description: "Keep k3s installed (only remove dx-platform)",
            },
          })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            try {
              const { spawnSync } = await import("node:child_process")
              const args = ["install", "uninstall"]
              if (flags.keepK3s) args.push("--keepK3s")
              if (f.verbose) args.push("--verbose")
              if (f.json) args.push("--json")
              if (f.debug) args.push("--debug")

              const result = spawnSync(
                process.argv[0],
                [process.argv[1], ...args],
                {
                  stdio: "inherit",
                  env: process.env,
                }
              )
              process.exit(result.status ?? 1)
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
      )

      // ── ops ──
      .command("ops", (c) =>
        c
          .meta({
            description: "View background operation status and trigger runs",
          })
          .args([
            {
              name: "name",
              type: "string",
              description:
                "Operation name (e.g. reconciler, proxmox, identity)",
            },
          ])
          .flags({
            trigger: {
              type: "boolean",
              short: "t",
              description: "Trigger a manual run",
            },
          })
          .run(async ({ args, flags }) => {
            const { runFactoryOps } = await import("../handlers/factory-ops.js")
            await runFactoryOps(toDxFlags(flags), {
              name: args.name as string | undefined,
              trigger: !!flags.trigger,
            })
          })
      )

      // ── logs ──
      .command("logs", (c) =>
        c
          .meta({ description: "Query factory platform logs" })
          .flags({
            op: {
              type: "string",
              description:
                "Filter by operation name (e.g. reconciler, proxmox)",
            },
            run: { type: "string", description: "Filter by operation run ID" },
            since: {
              type: "string",
              description: "Time window (e.g. 1h, 30m, 2d)",
            },
            level: {
              type: "string",
              short: "l",
              description: "Log level filter (debug, info, warn, error)",
            },
            grep: {
              type: "string",
              short: "g",
              description: "Text filter (regex)",
            },
            follow: {
              type: "boolean",
              short: "f",
              description: "Stream logs in real-time (SSE)",
            },
            limit: {
              type: "number",
              short: "n",
              description: "Max entries to return (default 100)",
            },
          })
          .run(async ({ flags }) => {
            const { runFactoryLogs } =
              await import("../handlers/factory-logs.js")
            await runFactoryLogs(toDxFlags(flags), {
              op: flags.op as string | undefined,
              run: flags.run as string | undefined,
              since: flags.since as string | undefined,
              level: flags.level as string | undefined,
              grep: flags.grep as string | undefined,
              follow: !!flags.follow,
              limit: flags.limit as number | undefined,
            })
          })
      )

      // ── events ──
      .command("events", (c) =>
        c
          .meta({ description: "Factory audit log and platform events" })
          .run(stubRun)
      )

      // ── sync ──
      .command("sync", (c) =>
        c
          .meta({ description: "Sync factory state" })
          .command("git", (sub) =>
            sub
              .meta({ description: "Sync repos from git host providers" })
              .flags({
                provider: {
                  type: "string",
                  description: "Git host provider slug or ID",
                },
              })
              .run(async ({ flags }) => {
                try {
                  const results = await runEntitySync(
                    "build",
                    "git-host-providers",
                    flags.provider as string | undefined
                  )
                  await printSyncResults(flags, "Git", results)
                } catch (err) {
                  exitWithError(
                    toDxFlags(flags),
                    err instanceof Error ? err.message : String(err)
                  )
                }
              })
          )
          .command("work-tracker", (sub) =>
            sub
              .meta({
                description:
                  "Sync projects and issues from work tracker providers",
              })
              .flags({
                provider: {
                  type: "string",
                  description: "Work tracker provider slug or ID",
                },
              })
              .run(async ({ flags }) => {
                try {
                  const results = await runEntitySync(
                    "build",
                    "work-tracker-providers",
                    flags.provider as string | undefined
                  )
                  await printSyncResults(flags, "Work tracker", results)
                } catch (err) {
                  exitWithError(
                    toDxFlags(flags),
                    err instanceof Error ? err.message : String(err)
                  )
                }
              })
          )
          .command("all", (sub) =>
            sub
              .meta({ description: "Run git host and work tracker syncs" })
              .run(async ({ flags }) => {
                try {
                  const gitResults = await runEntitySync(
                    "build",
                    "git-host-providers"
                  )
                  const trackerResults = await runEntitySync(
                    "build",
                    "work-tracker-providers"
                  )
                  const f = toDxFlags(flags)
                  if (f.json) {
                    console.log(
                      JSON.stringify(
                        {
                          git: gitResults,
                          workTracker: trackerResults,
                        },
                        null,
                        2
                      )
                    )
                    return
                  }
                  await printSyncResults(flags, "Git", gitResults)
                  await printSyncResults(flags, "Work tracker", trackerResults)
                } catch (err) {
                  exitWithError(
                    toDxFlags(flags),
                    err instanceof Error ? err.message : String(err)
                  )
                }
              })
          )
          .command("hosts", (sub) =>
            sub
              .meta({
                description:
                  "Re-fetch host inventory, update SSH config, clear stale host keys",
              })
              .run(stubRun)
          )
      )

      // ── hosts ──
      .command("hosts", (c) =>
        c
          .meta({ description: "Factory host management" })
          .command("list", (sub) =>
            sub
              .meta({ description: "List all managed hosts with status" })
              .run(stubRun)
          )
          .command("update", (sub) =>
            sub
              .meta({ description: "Update host IP address" })
              .args([
                { name: "name", type: "string", description: "Host name" },
              ])
              .flags({
                ip: { type: "string", description: "New IP address" },
              })
              .run(stubRun)
          )
      )
  )
}
