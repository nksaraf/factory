import type { DxBase } from "../dx-root.js"
import {
  type DiscoveredStack,
  type DiscoveryResult,
  discoverHost,
} from "../handlers/ops-discover.js"
import {
  type ImportPlan,
  buildImportPlan,
  executeImportPlan,
  inferSystemSlug,
} from "../handlers/ops-import.js"
import { syncHost } from "../handlers/ops-sync.js"
import { printTable } from "../output.js"
import { setExamples } from "../plugins/examples-plugin.js"
import {
  styleBold,
  styleError,
  styleMuted,
  styleSuccess,
  styleWarn,
} from "./list-helpers.js"
import { stubRun } from "./stub-run.js"

setExamples("ops", [
  "$ dx ops discover --on lepton-59         Discover compose stacks on a host",
  "$ dx ops import --on lepton-59 --dry-run Preview entities to create",
  "$ dx ops import --on lepton-59           Import into Factory",
  "$ dx ops sync --on lepton-59             Check for drift",
  "$ dx ops restart <target>              Restart a service",
  "$ dx ops scale <target> --replicas 3   Scale a service",
])

export function opsCommand(app: DxBase) {
  return app
    .sub("ops")
    .meta({
      description:
        "Platform operations, compose discovery/import, and service controls",
    })

    .run(() => {
      console.log(
        styleBold("dx ops") + " — Compose stacks, drift checks, and controls\n"
      )
      console.log("Commands:")
      console.log(
        "  dx ops discover --on <host>           Discover compose stacks"
      )
      console.log("  dx ops import --on <host> --dry-run   Preview import plan")
      console.log("  dx ops import --on <host>             Import into Factory")
      console.log("  dx ops sync --on <host>               Check for drift")
      console.log("  dx ops restart <target>               Restart a service")
      console.log("  dx ops scale <target>                 Scale a service")
      console.log("")
      console.log("Examples:")
      console.log(styleMuted("  dx ops discover --on lepton-59 --user lepton"))
      console.log(
        styleMuted("  dx ops import --on lepton-59 --user lepton --dry-run")
      )
    })

    .command("restart", (c) =>
      c.meta({ description: "Restart services" }).run(stubRun)
    )
    .command("scale", (c) =>
      c.meta({ description: "Scale services" }).run(stubRun)
    )

    .command("discover", (c) =>
      c
        .meta({
          description: "Discover docker compose stacks on remote hosts",
        })
        .flags({
          on: { type: "string", description: "Target machine slug" },
          user: { type: "string", description: "Override SSH user" },
        })
        .run(async ({ flags }) => {
          const slug = flags.on as string | undefined
          const json = flags.json as boolean | undefined
          const userOverride = flags.user as string | undefined

          if (!slug) {
            console.error(styleError("--on <host> is required"))
            process.exit(1)
          }

          console.error(styleMuted(`Discovering compose stacks on ${slug}...`))
          const result = await discoverHost(slug, { userOverride })

          if (result.error) {
            console.error(styleError(`Failed: ${result.error}`))
            process.exit(1)
          }

          if (json) {
            console.log(JSON.stringify(buildJsonOutput(result), null, 2))
            return
          }

          printDiscoveryResult(result)
        })
    )

    .command("import", (c) =>
      c
        .meta({ description: "Import discovered stacks into Factory" })
        .flags({
          on: { type: "string", description: "Target machine slug" },
          user: { type: "string", description: "Override SSH user" },
          "dry-run": {
            type: "boolean",
            description: "Preview without creating",
          },
          site: { type: "string", description: "Site name prefix" },
        })
        .run(async ({ flags }) => {
          const slug = flags.on as string | undefined
          const json = flags.json as boolean | undefined
          const userOverride = flags.user as string | undefined
          const dryRun = flags["dry-run"] as boolean | undefined
          const siteName = flags.site as string | undefined

          if (!slug) {
            console.error(styleError("--on <host> is required"))
            process.exit(1)
          }

          console.error(styleMuted(`Discovering compose stacks on ${slug}...`))
          const result = await discoverHost(slug, { userOverride })

          if (result.error) {
            console.error(styleError(`Discovery failed: ${result.error}`))
            process.exit(1)
          }

          console.error(styleMuted(`Building import plan...`))
          const plan = await buildImportPlan(result, { siteName })

          if (json) {
            console.log(JSON.stringify({ dryRun: !!dryRun, plan }, null, 2))
            return
          }

          printImportPlan(plan)

          if (dryRun) {
            console.log("")
            console.log(
              styleMuted(
                "Dry run — no changes made. Remove --dry-run to import."
              )
            )
            return
          }

          console.log("")
          console.error(styleMuted(`Importing into Factory...`))
          const importResult = await executeImportPlan(plan)

          console.log("")
          if (importResult.created.length > 0) {
            console.log(
              styleSuccess(`Created ${importResult.created.length} entities:`)
            )
            for (const e of importResult.created) {
              console.log(
                `  ${styleSuccess("+")} ${e.entity} ${styleBold(e.slug)}`
              )
            }
          }

          if (importResult.updated.length > 0) {
            console.log(
              styleWarn(`Updated ${importResult.updated.length} entities:`)
            )
            for (const e of importResult.updated) {
              console.log(
                `  ${styleWarn("~")} ${e.entity} ${styleBold(e.slug)}`
              )
            }
          }

          if (importResult.errors.length > 0) {
            console.log(styleError(`Errors (${importResult.errors.length}):`))
            for (const e of importResult.errors) {
              console.log(
                `  ${styleError("✗")} ${e.entity} ${e.slug}: ${e.error}`
              )
            }
          }

          if (importResult.errors.length === 0) {
            console.log("")
            console.log(styleSuccess("Import complete."))
          }
        })
    )

    .command("sync", (c) =>
      c
        .meta({
          description: "Check for drift between Factory and live state",
        })
        .flags({
          on: { type: "string", description: "Target machine slug" },
          user: { type: "string", description: "Override SSH user" },
        })
        .run(async ({ flags }) => {
          const slug = flags.on as string | undefined
          const json = flags.json as boolean | undefined
          const userOverride = flags.user as string | undefined

          if (!slug) {
            console.error(styleError("--on <host> is required"))
            process.exit(1)
          }

          console.error(styleMuted(`Syncing ${slug}...`))
          const syncResult = await syncHost(slug, { userOverride })

          if (json) {
            console.log(JSON.stringify(syncResult, null, 2))
            return
          }

          printSyncResult(syncResult)
        })
    )
}

function printDiscoveryResult(result: DiscoveryResult) {
  const { stacks, host, target } = result
  const totalContainers = stacks.reduce(
    (sum, s) => sum + s.containers.length,
    0
  )

  console.log("")
  console.log(
    styleBold(`${host}`) +
      ` (${target.user}@${target.host}) — ` +
      styleBold(`${stacks.length} projects`) +
      `, ${totalContainers} containers`
  )
  console.log("")

  const rows = stacks
    .sort((a, b) => b.containers.length - a.containers.length)
    .map((s) => formatStackRow(s))

  console.log(
    printTable(["PROJECT", "SERVICES", "STATUS", "HEALTH", "SYSTEM"], rows)
  )

  printHealthWarnings(stacks)
  printParseErrors(stacks)
}

function formatStackRow(s: DiscoveredStack): string[] {
  const statusMatch = s.project.status.match(/^(\w+)/)
  const status = statusMatch ? statusMatch[1] : s.project.status
  const statusColored =
    status === "running"
      ? styleSuccess("● running")
      : status === "exited"
        ? styleError("● exited")
        : styleWarn(`● ${status}`)

  const unhealthyCount = s.containers.filter(
    (c) => c.health === "unhealthy"
  ).length
  const health =
    unhealthyCount > 0
      ? styleError(`⚠ ${unhealthyCount} unhealthy`)
      : styleSuccess("✓ healthy")

  return [
    s.project.name,
    String(s.containers.length),
    statusColored,
    health,
    styleMuted(inferSystemType(s)),
  ]
}

function inferSystemType(s: DiscoveredStack): string {
  return inferSystemSlug(s)
}

function printHealthWarnings(stacks: DiscoveredStack[]) {
  const unhealthy = stacks.filter((s) =>
    s.containers.some((c) => c.health === "unhealthy")
  )
  if (unhealthy.length > 0) {
    console.log("")
    console.log(styleWarn("Health issues:"))
    for (const s of unhealthy) {
      const bad = s.containers
        .filter((c) => c.health === "unhealthy")
        .map((c) => c.service || c.name)
      console.log(
        `  ${styleBold(s.project.name)}: ${bad.join(", ")} ${styleError("unhealthy")}`
      )
    }
  }
}

function printParseErrors(stacks: DiscoveredStack[]) {
  const errored = stacks.filter((s) => s.error)
  if (errored.length > 0) {
    console.log("")
    console.log(styleWarn("Parse errors:"))
    for (const s of errored) {
      console.log(`  ${styleBold(s.project.name)}: ${s.error}`)
    }
  }
}

function printImportPlan(plan: ImportPlan) {
  console.log("")
  console.log(styleBold("Import Plan"))
  console.log("")

  const hostAction =
    plan.host.action === "create"
      ? styleSuccess("+ create")
      : styleMuted("  exists")
  console.log(
    `${hostAction}  infra.host          ${styleBold(plan.host.slug)} (${plan.host.type}, ${plan.host.ip})`
  )

  const dockerAction =
    plan.dockerRealm.action === "create"
      ? styleSuccess("+ create")
      : styleMuted("  exists")
  console.log(
    `${dockerAction}  infra.realm         ${styleBold(plan.dockerRealm.slug)} (docker-engine)`
  )

  console.log("")

  for (const stack of plan.stacks) {
    console.log(styleBold(`  ${stack.project}`))

    const siteAction =
      stack.site.action === "create" ? styleSuccess("+") : styleMuted("=")
    console.log(
      `    ${siteAction} site              ${stack.site.slug} (${stack.site.type})`
    )

    const sysAction =
      stack.system.action === "create" ? styleSuccess("+") : styleMuted("=")
    console.log(`    ${sysAction} system            ${stack.system.slug}`)

    const rtAction =
      stack.composeRealm.action === "create"
        ? styleSuccess("+")
        : styleMuted("=")
    console.log(`    ${rtAction} realm             ${stack.composeRealm.slug}`)

    const depAction =
      stack.deployment.action === "create" ? styleSuccess("+") : styleMuted("=")
    console.log(`    ${depAction} deployment        ${stack.deployment.slug}`)

    const newComps = stack.components.filter((c) => c.action === "create")
    const existComps = stack.components.filter((c) => c.action === "exists")
    if (newComps.length > 0 || existComps.length > 0) {
      const parts = []
      if (newComps.length > 0)
        parts.push(styleSuccess(`+${newComps.length} new`))
      if (existComps.length > 0)
        parts.push(styleMuted(`${existComps.length} exist`))
      console.log(
        `    ${newComps.length > 0 ? styleSuccess("+") : styleMuted("=")} components       ${parts.join(", ")}`
      )
    }

    console.log("")
  }

  const totalNew =
    (plan.host.action === "create" ? 1 : 0) +
    (plan.dockerRealm.action === "create" ? 1 : 0) +
    plan.stacks.reduce(
      (sum, s) =>
        sum +
        (s.site.action === "create" ? 1 : 0) +
        (s.system.action === "create" ? 1 : 0) +
        (s.composeRealm.action === "create" ? 1 : 0) +
        (s.deployment.action === "create" ? 1 : 0) +
        s.components.filter((c) => c.action === "create").length,
      0
    )

  const totalExist =
    (plan.host.action === "exists" ? 1 : 0) +
    (plan.dockerRealm.action === "exists" ? 1 : 0) +
    plan.stacks.reduce(
      (sum, s) =>
        sum +
        (s.site.action === "exists" ? 1 : 0) +
        (s.system.action === "exists" ? 1 : 0) +
        (s.composeRealm.action === "exists" ? 1 : 0) +
        (s.deployment.action === "exists" ? 1 : 0) +
        s.components.filter((c) => c.action === "exists").length,
      0
    )

  console.log(
    `${styleSuccess(`${totalNew} to create`)}, ${styleMuted(`${totalExist} already exist`)}`
  )
}

function printSyncResult(result: {
  host: string
  stacks: Array<{
    project: string
    status: "in-sync" | "drifted" | "missing-in-factory" | "missing-on-host"
    issues: string[]
  }>
}) {
  console.log("")
  console.log(styleBold(`Sync: ${result.host}`))
  console.log("")

  const rows = result.stacks.map((s) => {
    const statusStr =
      s.status === "in-sync"
        ? styleSuccess("● in-sync")
        : s.status === "drifted"
          ? styleError("● drifted")
          : s.status === "missing-in-factory"
            ? styleWarn("● not imported")
            : styleError("● missing on host")

    const issues = s.issues.length > 0 ? s.issues.join("; ") : styleMuted("-")
    return [s.project, statusStr, issues]
  })

  console.log(printTable(["PROJECT", "STATUS", "ISSUES"], rows))

  const drifted = result.stacks.filter((s) => s.status === "drifted")
  const missing = result.stacks.filter((s) => s.status === "missing-in-factory")

  if (drifted.length > 0) {
    console.log("")
    console.log(
      styleError(`${drifted.length} stacks drifted from Factory state.`)
    )
  }
  if (missing.length > 0) {
    console.log(
      styleWarn(
        `${missing.length} stacks not yet imported. Run: dx ops import --on ${result.host}`
      )
    )
  }
  if (drifted.length === 0 && missing.length === 0) {
    console.log("")
    console.log(styleSuccess("All stacks in sync."))
  }
}

function buildJsonOutput(result: DiscoveryResult) {
  return {
    host: result.host,
    target: {
      host: result.target.host,
      user: result.target.user,
      port: result.target.port,
    },
    projects: result.stacks.map((s) => ({
      name: s.project.name,
      status: s.project.status,
      configFiles: s.project.configFiles,
      system: inferSystemType(s),
      containers: s.containers.map((c) => ({
        name: c.name,
        image: c.image,
        service: c.service,
        status: c.status,
        health: c.health,
        ports: c.ports,
      })),
      components: s.catalog
        ? Object.keys(s.catalog.components ?? {}).length
        : 0,
      resources: s.catalog ? Object.keys(s.catalog.resources ?? {}).length : 0,
      error: s.error,
    })),
    summary: {
      projects: result.stacks.length,
      containers: result.stacks.reduce(
        (sum, s) => sum + s.containers.length,
        0
      ),
      unhealthy: result.stacks.reduce(
        (sum, s) =>
          sum + s.containers.filter((c) => c.health === "unhealthy").length,
        0
      ),
    },
  }
}
