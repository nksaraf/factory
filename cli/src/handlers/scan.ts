/**
 * Handler for `dx scan` — scans IDE sessions and/or infrastructure hosts, syncing to Factory.
 */
import { hostname } from "node:os"
import { homedir } from "node:os"

import {
  styleBold,
  styleError,
  styleMuted,
  styleSuccess,
} from "../cli-style.js"
import { getFactoryRestClient } from "../client.js"
import { exitWithError } from "../lib/cli-exit.js"
import { EntityFinder } from "../lib/entity-finder.js"
import { collectLocal } from "../lib/infra-scan/collectors/local.js"
import { collectRemote } from "../lib/infra-scan/collectors/remote.js"
import { extractBackendHosts } from "../lib/infra-scan/collectors/traefik.js"
import {
  crawlBackendHosts,
  printNetworkCrawlSummary,
} from "../lib/infra-scan/network-crawl.js"
import {
  type ComponentOverride,
  type ExistingComponent,
  type ExistingSystem,
  type SystemAssignment,
  applyScanOverrides,
  printMachineSummary,
  promptCatchAllSystem,
  promptComponentOverrides,
  promptHostRegistration,
  promptSystemAssignment,
} from "../lib/infra-scan/scan-prompts.js"
import type { CollectorStatus, ScanResult } from "../lib/infra-scan/types.js"
import {
  countSessions as countCCSessions,
  ingestClaudeCode,
} from "../lib/ingest/claude-code.js"
import type { IngestOptions, IngestResult } from "../lib/ingest/common.js"
import {
  getClaudeCodeProjectsDir,
  getConductorDbPath,
  getCursorDbPath,
} from "../lib/ingest/common.js"
import {
  countSessions as countConductorSessions,
  ingestConductor,
} from "../lib/ingest/conductor.js"
import {
  countConversations as countCursorConvos,
  ingestCursor,
} from "../lib/ingest/cursor.js"
import type { DxFlags } from "../stub.js"

// ── IDE source types ────────────────────────────────────────

type SourceInfo = {
  name: string
  available: boolean
  path: string | null
  count: number
  ingest: (opts: IngestOptions) => Promise<IngestResult>
}

// Conductor first so workspace channels exist when claude-code/cursor events reference them
const VALID_SOURCES = ["conductor", "claude-code", "cursor"] as const
type SourceName = (typeof VALID_SOURCES)[number]

function isIdeSource(target: string): target is SourceName {
  return VALID_SOURCES.includes(target as SourceName)
}

function detectSources(): Record<SourceName, SourceInfo> {
  const ccDir = getClaudeCodeProjectsDir()
  const conductorDb = getConductorDbPath()
  const cursorDb = getCursorDbPath()

  return {
    conductor: {
      name: "Conductor",
      available: conductorDb !== null,
      path: conductorDb,
      count: conductorDb ? countConductorSessions() : 0,
      ingest: ingestConductor,
    },
    "claude-code": {
      name: "Claude Code",
      available: ccDir !== null,
      path: ccDir ?? `${homedir()}/.claude/projects`,
      count: ccDir ? countCCSessions() : 0,
      ingest: ingestClaudeCode,
    },
    cursor: {
      name: "Cursor",
      available: cursorDb !== null,
      path: cursorDb ?? `${homedir()}/.cursor/ai-tracking/ai-code-tracking.db`,
      count: cursorDb ? countCursorConvos() : 0,
      ingest: ingestCursor,
    },
  }
}

// ── Scanner mode ────────────────────────────────────────────

type ScannerMode = "ide" | "infra" | "all"

function parseScannerMode(flags: DxFlags): ScannerMode {
  const scanner = (flags as any).scanner as string | undefined
  if (!scanner) return "all"
  if (scanner === "ide" || scanner === "infra" || scanner === "all")
    return scanner
  return "all"
}

// ── IDE scan ────────────────────────────────────────────────

async function runIdeScan(flags: DxFlags, target?: string): Promise<void> {
  const opts: IngestOptions = {
    since: (flags as any).since
      ? new Date((flags as any).since as string)
      : undefined,
    dryRun: !!(flags as any)["dry-run"] || !!(flags as any).dryRun,
    limit: (flags as any).limit
      ? parseInt((flags as any).limit as string, 10)
      : Infinity,
    verbose: !!flags.verbose,
  }

  const sources = detectSources()
  const targets: SourceName[] =
    target && isIdeSource(target)
      ? [target]
      : (Object.keys(sources) as SourceName[]).filter(
          (k) => sources[k].available
        )

  if (!flags.json) {
    console.log(styleBold("\nIDE Session Sources\n"))
    for (const [, info] of Object.entries(sources)) {
      if (info.available) {
        console.log(
          `  ${styleSuccess("found")}  ${styleBold(info.name.padEnd(14))} ${styleMuted(info.path ?? "")} ${styleMuted(`(${info.count} sessions)`)}`
        )
      } else {
        console.log(
          `  ${styleMuted("--")}     ${styleMuted(info.name.padEnd(14))} ${styleMuted("not found")}`
        )
      }
    }
    console.log()
  }

  if (target && isIdeSource(target) && !sources[target].available) {
    exitWithError(
      flags,
      `${sources[target].name} not found at expected location.`
    )
    return
  }

  if (targets.length === 0) {
    if (!flags.json) {
      console.log(styleMuted("No IDE session sources found on this machine.\n"))
    }
    return
  }

  if (opts.dryRun && !flags.json) {
    console.log(styleMuted("Dry run — events will be printed, not sent.\n"))
  }

  let totalSent = 0
  let totalDups = 0
  let totalErrors = 0

  for (const name of targets) {
    const info = sources[name]
    if (!flags.json) console.error(`--- ${info.name} ---`)

    try {
      const result = await info.ingest(opts)
      totalSent += result.sent
      totalDups += result.duplicates
      totalErrors += result.errors
      if (!flags.json) {
        console.error(
          `  ${result.sent} sent, ${result.duplicates} duplicates, ${result.errors} errors\n`
        )
      }
    } catch (err) {
      totalErrors++
      const msg = err instanceof Error ? err.message : String(err)
      if (!flags.json) console.error(`  Error: ${msg}\n`)
    }
  }

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          scanner: "ide",
          success: totalErrors === 0,
          sent: totalSent,
          duplicates: totalDups,
          errors: totalErrors,
          sources: targets,
          dryRun: opts.dryRun,
        },
        null,
        2
      )
    )
  } else {
    console.log(
      styleBold(
        `IDE: ${totalSent} sent, ${totalDups} duplicates, ${totalErrors} errors`
      )
    )
  }
}

// ── Infra scan ──────────────────────────────────────────────

function detectOs(): "linux" | "windows" | "macos" {
  if (process.platform === "darwin") return "macos"
  if (process.platform === "win32") return "windows"
  return "linux"
}

function detectArch(): "amd64" | "arm64" {
  return process.arch === "arm64" ? "arm64" : "amd64"
}

async function runInfraScan(flags: DxFlags, target?: string): Promise<void> {
  const dryRun = !!(flags as any)["dry-run"] || !!(flags as any).dryRun
  const json = !!flags.json

  // ── Step 1: Run collector ──────────────────────────────────
  let scanResult: ScanResult
  let existingHostSlug: string | undefined

  if (target) {
    // Remote scan — resolve host via EntityFinder
    if (!json) {
      console.log(styleBold(`\nInfra Scan: resolving ${target}...\n`))
    }

    const finder = new EntityFinder()
    const entity = await finder.resolve(target)

    if (!entity) {
      exitWithError(
        flags,
        `Unknown target "${target}". Not a known IDE source or registered host.`
      )
      return
    }

    if (entity.type !== "host") {
      exitWithError(
        flags,
        `Target "${target}" resolved to a ${entity.type}, not a host. Only hosts can be infra-scanned.`
      )
      return
    }

    existingHostSlug = entity.slug

    if (!json) {
      console.log(
        styleBold(
          `Scanning host ${entity.displayName} (${entity.sshHost ?? "unknown"}) via SSH...\n`
        )
      )
    }

    const os = ((entity as any).os as "linux" | "windows" | "macos") ?? "linux"
    scanResult = await collectRemote(entity, os)
  } else {
    // Local scan
    if (!json) {
      console.log(styleBold("\nScanning localhost...\n"))
    }
    scanResult = await collectLocal()
  }

  // ── Step 2: Display machine summary ────────────────────────
  if (!json) {
    printMachineSummary(scanResult)
  }

  // ── Step 3: Host resolution & registration ─────────────────
  // Create a single API client for all subsequent calls
  let rest: Awaited<ReturnType<typeof getFactoryRestClient>> | null = null
  if (!dryRun) {
    try {
      rest = await getFactoryRestClient()
    } catch {
      // API unavailable — will proceed without API calls
    }
  }

  let hostSlug: string
  let hostCreated = false

  if (existingHostSlug) {
    // Remote scan — host already exists in Factory
    hostSlug = existingHostSlug
  } else {
    // Local scan — check if this host already exists
    let existingHost: Record<string, unknown> | null = null

    if (rest) {
      try {
        const hosts = await rest.listEntities("infra", "hosts")
        const hostList = hosts.data ?? []
        // Match by hostname or IP address
        existingHost =
          (hostList.find((h: Record<string, unknown>) => {
            const spec = h.spec as Record<string, unknown> | undefined
            return (
              spec?.hostname === scanResult.hostname ||
              (scanResult.ipAddress && spec?.ipAddress === scanResult.ipAddress)
            )
          }) as Record<string, unknown> | null) ?? null
      } catch {
        // API unavailable — continue with registration flow
      }
    }

    if (existingHost) {
      hostSlug = existingHost.slug as string
      if (!json) {
        console.log(
          styleMuted(`  Host "${hostSlug}" already registered in Factory.\n`)
        )
      }
    } else {
      // New host — prompt for registration details
      const registration = await promptHostRegistration(scanResult, json)

      if (!registration || !registration.register) {
        if (!json) {
          console.log(styleMuted("  Host registration skipped.\n"))
        }
        // Still show scan results in dry-run even without registration
        if (dryRun) {
          printInfraScanSummary(scanResult, scanResult.hostname ?? "unknown")
          console.log(styleMuted("\nDry run — no entities created/updated.\n"))
        }
        return
      }

      hostSlug = registration.slug

      if (rest) {
        try {
          await rest.request("POST", "/api/v1/factory/infra/hosts", {
            slug: registration.slug,
            name: registration.name,
            type: "bare-metal",
            spec: {
              hostname: scanResult.hostname ?? hostname(),
              os: scanResult.os ?? detectOs(),
              arch: scanResult.arch ?? detectArch(),
              ipAddress: scanResult.ipAddress,
              role: registration.role,
            },
          })
          hostCreated = true
          if (!json) {
            console.log(styleSuccess(`  ✓ Host "${hostSlug}" registered.\n`))
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          exitWithError(flags, `Failed to register host: ${msg}`)
          return
        }
      }
    }
  }

  // ── Step 4: Display collector results ──────────────────────
  if (!json) {
    printInfraScanSummary(scanResult, hostSlug)
  }

  // ── Step 4b: Network crawl (recursive host scanning) ───────
  if (scanResult.reverseProxies && scanResult.reverseProxies.length > 0) {
    const allHostEntries: {
      ip: string
      hostname?: string
      reachable: boolean
      error?: string
      resolvedServices: {
        port: number
        domains: string[]
        routerName: string
        service?: {
          name: string
          displayName?: string
          composeProject?: string
          image?: string
          runtime: string
        }
      }[]
    }[] = []

    for (const proxy of scanResult.reverseProxies) {
      const backendHosts = extractBackendHosts(proxy)
      if (backendHosts.size > 0) {
        const hostScans = await crawlBackendHosts(backendHosts, {
          verbose: !json,
        })
        if (!json) printNetworkCrawlSummary(proxy, hostScans)

        // Collect crawl results for API payload
        for (const entry of hostScans) {
          allHostEntries.push({
            ip: entry.ip,
            hostname: entry.scanResult?.hostname,
            reachable: !!entry.scanResult,
            error: entry.error,
            resolvedServices: entry.resolvedServices.map((rs) => ({
              port: rs.port,
              domains: rs.domains,
              routerName: rs.routerName,
              service: rs.service,
            })),
          })
        }
      }
    }

    if (allHostEntries.length > 0) {
      scanResult.networkCrawl = {
        crawledAt: new Date(),
        hostEntries: allHostEntries,
      }
    }
  }

  // ── Step 5: System & component assignment prompts ───────────
  // Fetch existing systems and components for assignment choices
  let existingSystems: ExistingSystem[] = []
  let existingComponents: ExistingComponent[] = []
  if (rest) {
    try {
      const [systemsResp, componentsResp] = await Promise.all([
        rest.listEntities("software", "systems"),
        rest.listEntities("software", "components"),
      ])
      existingSystems = (systemsResp.data ?? []).map(
        (s: Record<string, unknown>) => ({
          slug: s.slug as string,
          name: (s.name as string) ?? (s.slug as string),
        })
      )
      existingComponents = (componentsResp.data ?? []).map(
        (c: Record<string, unknown>) => ({
          slug: c.slug as string,
          name: (c.name as string) ?? (c.slug as string),
          systemSlug: c.systemSlug as string | undefined,
        })
      )
    } catch {
      // API unavailable — no existing entities to offer
    }
  }

  // Prompt for each compose project (system assignment + component review)
  const composeOverrides = new Map<string, SystemAssignment>()
  const allComponentOverrides: ComponentOverride[] = []

  for (const proj of scanResult.composeProjects) {
    const projServices = scanResult.services.filter(
      (s) => s.composeProject === proj.name
    )
    const assignment = await promptSystemAssignment(
      proj.name,
      projServices.length || proj.services.length,
      existingSystems,
      json
    )
    composeOverrides.set(proj.name, assignment)

    // If not skipped, prompt for component-level overrides
    if (assignment.action !== "skip") {
      const systemLabel = assignment.systemName || proj.name
      const cmpOverrides = await promptComponentOverrides(
        projServices,
        systemLabel,
        existingComponents,
        json
      )
      allComponentOverrides.push(...cmpOverrides)
    }
  }

  // Prompt for ungrouped services (non-compose processes with listening ports)
  let catchAllOverride: SystemAssignment | null = null
  const ungroupedServices = scanResult.services.filter((s) => !s.composeProject)
  if (ungroupedServices.length > 0) {
    catchAllOverride = await promptCatchAllSystem(
      hostSlug,
      ungroupedServices.length,
      existingSystems,
      json
    )

    // If not skipped, prompt for component-level overrides on ungrouped services
    if (catchAllOverride.action !== "skip") {
      const systemLabel = catchAllOverride.systemName || `${hostSlug}-services`
      const cmpOverrides = await promptComponentOverrides(
        ungroupedServices,
        systemLabel,
        existingComponents,
        json
      )
      allComponentOverrides.push(...cmpOverrides)
    }
  }

  // ── Step 6: Apply overrides to scan result ─────────────────
  const finalResult = applyScanOverrides(
    scanResult,
    composeOverrides,
    catchAllOverride,
    allComponentOverrides.length > 0 ? allComponentOverrides : undefined
  )

  // ── Dry run — print and exit ───────────────────────────────
  if (dryRun) {
    if (json) {
      console.log(
        JSON.stringify(
          {
            scanner: "infra",
            host: hostSlug,
            hostCreated: false,
            scanResult: finalResult,
            composeOverrides: Object.fromEntries(composeOverrides),
            catchAllOverride,
          },
          null,
          2
        )
      )
    } else {
      console.log(styleMuted("\nDry run — no entities created/updated.\n"))
    }
    return
  }

  // ── Step 7: POST to API ────────────────────────────────────
  if (!rest) {
    exitWithError(flags, "Cannot submit scan — API client unavailable.")
    return
  }
  try {
    const reconciliation = await rest.infraAction("hosts", hostSlug, "scan", {
      scanResult: finalResult,
    })

    if (json) {
      console.log(
        JSON.stringify(
          {
            scanner: "infra",
            host: hostSlug,
            hostCreated,
            scanResult: finalResult,
            reconciliation,
          },
          null,
          2
        )
      )
    } else {
      printReconciliationSummary(reconciliation as any)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    exitWithError(flags, `Failed to submit scan: ${msg}`)
  }
}

// ── Output formatting ───────────────────────────────────────

function printInfraScanSummary(result: ScanResult, hostSlug: string): void {
  // Collectors status
  if (result.collectors.length > 0) {
    console.log(styleBold("  Collectors"))
    for (const c of result.collectors) {
      const icon =
        c.status === "ok"
          ? styleSuccess("✓")
          : c.status === "failed"
            ? styleError("✗")
            : styleMuted("--")
      const countStr = c.count !== undefined ? `${c.count} found` : ""
      const errorStr = c.error ? styleMuted(`(${c.error})`) : ""
      console.log(
        `    ${icon} ${c.name.padEnd(16)} ${countStr} ${errorStr}`.trimEnd()
      )
    }
    console.log()
  }

  // Runtimes
  if (result.runtimes.length > 0) {
    console.log(styleBold("  Runtimes"))
    for (const rt of result.runtimes) {
      console.log(
        `    ${rt.type.padEnd(20)} ${styleMuted(rt.version ?? "")}  ${rt.status ?? ""}`
      )
    }
    console.log()
  }

  // Compose projects
  if (result.composeProjects.length > 0) {
    console.log(styleBold("  Compose Projects"))
    for (const proj of result.composeProjects) {
      console.log(
        `    ${styleBold(proj.name)} (${proj.services.length} services)`
      )
      const projServices = result.services.filter(
        (s) => s.composeProject === proj.name
      )
      for (const svc of projServices) {
        const ports =
          svc.ports.length > 0 ? styleMuted(`:${svc.ports.join(", :")}`) : ""
        console.log(`      ${svc.name.padEnd(24)} ${ports}`)
      }
    }
    console.log()
  }

  // Other services (non-compose)
  const otherServices = result.services.filter((s) => !s.composeProject)
  if (otherServices.length > 0) {
    console.log(styleBold(`  Other Services → system: ${hostSlug}-services`))
    for (const svc of otherServices) {
      const ports =
        svc.ports.length > 0 ? styleMuted(`:${svc.ports.join(", :")}`) : ""
      console.log(
        `    ${svc.name.padEnd(24)} ${styleMuted(svc.runtime.padEnd(16))} ${ports}`
      )
    }
    console.log()
  }

  // Reverse proxies
  if (result.reverseProxies && result.reverseProxies.length > 0) {
    console.log(styleBold("  Reverse Proxies"))
    for (const proxy of result.reverseProxies) {
      const version = proxy.version ? ` v${proxy.version}` : ""
      const routerCount = proxy.routers.length
      console.log(
        `    ${styleSuccess("✓")} ${proxy.engine}${version}       ${routerCount} routers`
      )

      // Show entrypoints
      const epNames = proxy.entrypoints
        .map((ep) => `${ep.name}(:${ep.port})`)
        .join(", ")
      console.log(`      ${styleMuted(`Entrypoints: ${epNames}`)}`)

      // Show routers grouped by domain — limit display
      const routersByDomain = new Map<string, typeof proxy.routers>()
      for (const r of proxy.routers) {
        const domain = r.domains[0] ?? "(rule-based)"
        const existing = routersByDomain.get(domain) ?? []
        existing.push(r)
        routersByDomain.set(domain, existing)
      }

      let shown = 0
      const MAX_DISPLAY = 20
      for (const [domain, routers] of routersByDomain) {
        if (shown >= MAX_DISPLAY) {
          console.log(
            styleMuted(`      ... and ${routerCount - shown} more routers`)
          )
          break
        }
        for (const r of routers) {
          if (shown >= MAX_DISPLAY) break
          const path = r.pathPrefixes.length > 0 ? r.pathPrefixes[0] : ""
          const b = r.backends[0]
          let target: string
          if (b?.container) {
            target = `${b.container.composeProject}/${b.container.composeService}`
          } else if (b) {
            target = b.url
          } else {
            target = styleMuted("no-backend")
          }
          const tls = r.tls
            ? styleMuted(` (TLS: ${r.tls.certResolver ?? "yes"})`)
            : ""
          console.log(`      ${domain}${path}  →  ${target}${tls}`)
          shown++
        }
      }
    }
    console.log()
  }

  // Port summary
  const tcpPorts = result.ports.filter((p) => p.protocol === "tcp").length
  const udpPorts = result.ports.filter((p) => p.protocol === "udp").length
  console.log(
    styleMuted(
      `  Ports: ${tcpPorts} TCP listening, ${udpPorts} UDP listening\n`
    )
  )
}

function printReconciliationSummary(recon: {
  systems?: { created: number; updated: number }
  runtimes?: { created: number; updated: number }
  components?: { created: number; updated: number; decommissioned: number }
  site?: { created: boolean; siteId: string }
  systemDeployments?: { created: number; updated: number }
  componentDeployments?: { created: number; updated: number }
  routes?: { created: number; updated: number; stale: number }
  networkLinks?: { created: number; updated: number; stale: number }
}): void {
  const sys = recon.systems ?? { created: 0, updated: 0 }
  const rt = recon.runtimes ?? { created: 0, updated: 0 }
  const cmp = recon.components ?? { created: 0, updated: 0, decommissioned: 0 }
  const sdp = recon.systemDeployments ?? { created: 0, updated: 0 }
  const cdp = recon.componentDeployments ?? { created: 0, updated: 0 }
  const rte = recon.routes ?? { created: 0, updated: 0, stale: 0 }
  const lnk = recon.networkLinks ?? { created: 0, updated: 0, stale: 0 }
  const siteCreated = recon.site?.created ? 1 : 0

  const totalCreated =
    sys.created +
    rt.created +
    cmp.created +
    sdp.created +
    cdp.created +
    rte.created +
    lnk.created +
    siteCreated
  const totalUpdated =
    sys.updated +
    rt.updated +
    cmp.updated +
    sdp.updated +
    cdp.updated +
    rte.updated +
    lnk.updated

  const parts: string[] = []
  if (siteCreated > 0) parts.push("1 site")
  if (sys.created + sys.updated > 0)
    parts.push(`${sys.created + sys.updated} systems`)
  if (rt.created + rt.updated > 0)
    parts.push(`${rt.created + rt.updated} runtimes`)
  if (cmp.created + cmp.updated + cmp.decommissioned > 0) {
    parts.push(`${cmp.created + cmp.updated + cmp.decommissioned} components`)
  }
  if (sdp.created + sdp.updated > 0)
    parts.push(`${sdp.created + sdp.updated} system deployments`)
  if (cdp.created + cdp.updated > 0)
    parts.push(`${cdp.created + cdp.updated} component deployments`)
  if (rte.created + rte.updated + rte.stale > 0)
    parts.push(`${rte.created + rte.updated} routes`)
  if (lnk.created + lnk.updated > 0)
    parts.push(`${lnk.created + lnk.updated} links`)

  const actions: string[] = []
  if (totalCreated > 0) actions.push(`${totalCreated} created`)
  if (totalUpdated > 0) actions.push(`${totalUpdated} updated`)
  if (cmp.decommissioned > 0)
    actions.push(`${cmp.decommissioned} decommissioned`)
  if (rte.stale > 0) actions.push(`${rte.stale} stale routes`)

  console.log(
    styleBold(`  Summary: ${parts.join(", ")} | ${actions.join(", ")}\n`)
  )
}

// ── Main entry point ────────────────────────────────────────

export async function runScan(flags: DxFlags, target?: string): Promise<void> {
  const mode = parseScannerMode(flags)

  // If target is a known IDE source, force IDE mode regardless of --scanner flag
  if (target && isIdeSource(target)) {
    await runIdeScan(flags, target)
    return
  }

  // If target is provided and not an IDE source, it's a host slug → infra scan
  if (target) {
    await runInfraScan(flags, target)
    return
  }

  // No target — run based on scanner mode
  switch (mode) {
    case "ide":
      await runIdeScan(flags)
      break
    case "infra":
      await runInfraScan(flags)
      break
    case "all":
      await runIdeScan(flags)
      await runInfraScan(flags)
      break
  }
}
