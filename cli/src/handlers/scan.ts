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

// Conductor first so workbench channels exist when claude-code/cursor events reference them
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
  const deep = !!(flags as any).deep

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
          realmType: string
        }
      }[]
      scanResult?: Record<string, unknown>
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
            // Preserve full scan data for --deep mode
            scanResult: entry.scanResult
              ? (entry.scanResult as unknown as Record<string, unknown>)
              : undefined,
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
    // Strip full scanResult from crawl entries before sending — they're huge and
    // only needed CLI-side for --deep. The API only needs IP/hostname/reachable/resolvedServices.
    const apiPayload = { ...finalResult }
    if (apiPayload.networkCrawl) {
      apiPayload.networkCrawl = {
        ...apiPayload.networkCrawl,
        hostEntries: apiPayload.networkCrawl.hostEntries.map(
          ({ scanResult: _sr, ...rest }) => rest
        ),
      }
    }
    if (!json) {
      const payloadJson = JSON.stringify({ scanResult: apiPayload })
      process.stderr.write(
        `\n  Submitting scan (${(payloadJson.length / 1024).toFixed(0)}KB)...`
      )
    }
    const response = await rest.infraAction("hosts", hostSlug, "scan", {
      scanResult: apiPayload,
    })
    // API returns { data: ReconciliationSummary, action: "scan" }
    const reconciliation = (response as any)?.data ?? response

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

    // ── Step 8: Deep scan — submit scans for discovered hosts ──
    const recon = reconciliation as {
      discoveredHosts?: {
        hosts?: { slug: string; ip: string; reachable: boolean }[]
      }
    }
    const discoveredReachable = (recon.discoveredHosts?.hosts ?? []).filter(
      (h) => h.reachable
    )

    if (deep && discoveredReachable.length > 0) {
      const crawlEntries =
        finalResult.networkCrawl?.hostEntries ??
        scanResult.networkCrawl?.hostEntries ??
        []
      const visited = new Set<string>([hostSlug])

      if (!json) {
        console.log(
          styleBold(
            `\n  Deep scan: ${discoveredReachable.length} reachable hosts to catalog`
          )
        )
      }

      for (const discovered of discoveredReachable) {
        if (visited.has(discovered.slug)) continue
        visited.add(discovered.slug)

        // Find this host's full scan data from the crawl
        const crawlEntry = crawlEntries.find((e) => e.ip === discovered.ip)
        if (!crawlEntry?.scanResult) {
          if (!json) {
            console.log(
              `    ${styleMuted(discovered.slug)} (${discovered.ip}) — no scan data, skipped`
            )
          }
          continue
        }

        try {
          if (!json)
            process.stderr.write(`    ${discovered.slug} (${discovered.ip})...`)
          const deepResponse = await rest.infraAction(
            "hosts",
            discovered.slug,
            "scan",
            { scanResult: crawlEntry.scanResult }
          )
          const deepRecon = ((deepResponse as any)?.data ??
            deepResponse) as Record<string, unknown>
          if (!json) {
            const comp = deepRecon.components as {
              created: number
              updated: number
            }
            const rts = deepRecon.routes as {
              created: number
              updated: number
            }
            const compTotal = (comp?.created ?? 0) + (comp?.updated ?? 0)
            const rteTotal = (rts?.created ?? 0) + (rts?.updated ?? 0)
            console.log(
              ` ${styleSuccess("✓")} ${compTotal} components, ${rteTotal} routes`
            )
          }
        } catch (err) {
          if (!json) {
            const msg = err instanceof Error ? err.message : String(err)
            console.log(` ${styleError("✗")} ${msg.slice(0, 80)}`)
          }
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    exitWithError(flags, `Failed to submit scan: ${msg}`)
  }

  // Force exit — SSH child processes from network crawl can keep the event loop alive
  process.exit(0)
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

  // Realms
  if (result.realms.length > 0) {
    console.log(styleBold("  Realms"))
    for (const rt of result.realms) {
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
        `    ${svc.name.padEnd(24)} ${styleMuted(svc.realmType.padEnd(16))} ${ports}`
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
  realms?: { created: number; updated: number }
  components?: { created: number; updated: number; decommissioned: number }
  site?: { created: boolean; siteId: string }
  systemDeployments?: { created: number; updated: number }
  componentDeployments?: { created: number; updated: number }
  routes?: { created: number; updated: number; stale: number }
  networkLinks?: { created: number; updated: number; stale: number }
  discoveredHosts?: {
    created: number
    existing: number
    hosts: { slug: string; ip: string; reachable: boolean; created: boolean }[]
  }
}): void {
  const sys = recon.systems ?? { created: 0, updated: 0 }
  const rt = recon.realms ?? { created: 0, updated: 0 }
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
    parts.push(`${rt.created + rt.updated} realms`)
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
  const dh = recon.discoveredHosts ?? { created: 0, existing: 0, hosts: [] }
  if (dh.hosts.length > 0) {
    const reachable = dh.hosts.filter((h) => h.reachable).length
    parts.push(
      `${dh.hosts.length} discovered hosts (${dh.created} new, ${reachable} reachable)`
    )
  }

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

// ── Inventory export ─────────────────────────────────────────

async function runInventoryExport(
  outputDir: string | undefined,
  kinds: string[] | undefined,
  jsonOutput: boolean,
): Promise<void> {
  const { stringify: toYaml } = await import("yaml")
  const { mkdirSync, writeFileSync } = await import("node:fs")
  const { join } = await import("node:path")
  const { cwd } = await import("node:process")

  const outDir = outputDir ?? join(cwd(), ".factory", "inventory")
  mkdirSync(outDir, { recursive: true })

  const rest = await getFactoryRestClient()
  const response = await rest.inventoryExport(kinds) as any
  const exportedKinds: { kind: string; entities: Record<string, unknown>[] }[] =
    response?.data ?? []

  if (jsonOutput) {
    console.log(JSON.stringify(exportedKinds, null, 2))
    process.exit(0)
  }

  // Write one YAML file per kind, prefixed to preserve topological order
  const kindOrder = [
    "estate", "team", "principal", "scope",
    "realm", "host", "service", "ip-address", "dns-domain",
    "network-link", "route", "secret",
  ]
  const sortedKinds = [
    ...kindOrder.filter((k) => exportedKinds.some((e) => e.kind === k)),
    ...exportedKinds.map((e) => e.kind).filter((k) => !kindOrder.includes(k)),
  ]

  let fileIndex = 1
  for (const kind of sortedKinds) {
    const group = exportedKinds.find((e) => e.kind === kind)
    if (!group || group.entities.length === 0) continue

    const prefix = String(fileIndex).padStart(2, "0")
    const filename = `${prefix}-${kind}s.yaml`
    const yamlContent =
      `version: "1"\n\n# ${kind} entities — exported from Factory DB\nentities:\n` +
      group.entities
        .map((e) => toYaml([e], { indent: 2 }).replace(/^- /, "  - ").replace(/\n  /g, "\n    "))
        .join("")

    writeFileSync(join(outDir, filename), yamlContent, "utf8")
    console.log(`  ${styleBold(filename)}  ${styleMuted(`(${group.entities.length} ${kind}${group.entities.length === 1 ? "" : "s"})`)}`)
    fileIndex++
  }

  const total = exportedKinds.reduce((s, g) => s + g.entities.length, 0)
  console.log(`\nExported ${total} entities to ${outDir}`)
  process.exit(0)
}

// ── Inventory scan ──────────────────────────────────────────

async function runInventoryScan(
  path: string,
  dryRun: boolean,
  jsonOutput: boolean,
): Promise<void> {
  const { loadInventoryFiles } = await import("../lib/infra-scan/inventory-loader.js")
  const entities = loadInventoryFiles(path)

  const count = entities.length
  if (!jsonOutput) {
    console.log(`Loaded ${count} ${count === 1 ? "entity" : "entities"} from ${path}`)
    if (dryRun) console.log("Dry run — no changes will be committed\n")
  }

  const rest = await getFactoryRestClient()
  const response = await rest.inventoryScan(entities, dryRun)
  const summary = (response as any)?.data ?? response

  if (jsonOutput) {
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  if (summary.dryRun) console.log("(dry run — rolled back)\n")

  let anyOutput = false
  for (const [kind, s] of Object.entries(summary.byKind ?? {}) as [string, { created: number; updated: number; unchanged: number }][]) {
    if (s.created + s.updated > 0) {
      console.log(
        `  ${kind.padEnd(24)} +${s.created} created  ~${s.updated} updated  ${s.unchanged} unchanged`
      )
      anyOutput = true
    }
  }
  if (!anyOutput) console.log("  No changes — all entities already up to date")

  const errors = summary.errors ?? []
  if (errors.length > 0) {
    console.error(`\n  ${errors.length} error(s):`)
    for (const e of errors) {
      console.error(`    [${e.kind}] ${String(e.slug)}: ${e.error}`)
    }
  }

  process.exit(0)
}

// ── Main entry point ────────────────────────────────────────

export async function runScan(flags: DxFlags, target?: string): Promise<void> {
  if ((flags as any).export) {
    return runInventoryExport(
      (flags as any).output as string | undefined,
      ((flags as any).kinds as string | undefined)?.split(",").map((k: string) => k.trim()).filter(Boolean),
      !!flags.json,
    )
  }

  if ((flags as any).file) {
    return runInventoryScan(
      (flags as any).file as string,
      !!((flags as any)["dry-run"] ?? (flags as any).dryRun),
      !!flags.json,
    )
  }

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
