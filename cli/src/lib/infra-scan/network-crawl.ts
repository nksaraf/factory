/**
 * Network crawl — recursive host scanning for building full network graphs.
 *
 * Starting from a reverse proxy's discovered routes, crawls backend hosts
 * to resolve domain → proxy → host → compose project → service:port chains.
 */
import {
  styleBold,
  styleError,
  styleMuted,
  styleSuccess,
} from "../../cli-style.js"
import { type SshOptions, buildSshArgs } from "../ssh-utils.js"
import type { ScanResult, ScanReverseProxy } from "./types.js"

// ── Types ────────────────────────────────────────────────────

export interface HostScanEntry {
  ip: string
  /** Backend routes from the proxy pointing at this host */
  backends: { port: number; routerName: string; domains: string[] }[]
  /** Scan result from this host (null if scan failed) */
  scanResult: ScanResult | null
  /** Error message if scan failed */
  error?: string
  /** Services on this host matched to backend ports */
  resolvedServices: ResolvedBackendService[]
}

export interface ResolvedBackendService {
  /** The port the proxy routes to */
  port: number
  /** Domains that route to this port */
  domains: string[]
  /** The Traefik router name */
  routerName: string
  /** Matched service from the host scan */
  service?: {
    name: string
    displayName?: string
    composeProject?: string
    image?: string
    runtime: string
  }
}

// ── Scanner ──────────────────────────────────────────────────

/** Port-to-container mapping from `docker port` */
interface PortMapping {
  hostPort: number
  containerName: string
  composeProject: string
  composeService: string
  image: string
}

/**
 * Scan a remote host via SSH.
 * Runs the Linux collector for basic infra data AND collects
 * docker port mappings for matching backend ports to containers.
 */
async function scanRemoteHost(
  ip: string,
  sshUser: string = "lepton"
): Promise<{
  scanResult: ScanResult
  portMappings: PortMapping[]
}> {
  const { LINUX_COLLECTOR_SCRIPT } = await import("./collectors/linux.js")

  const sshOpts: SshOptions = {
    host: ip,
    user: sshUser,
    tty: "none",
    hostKeyCheck: "accept-new",
  }

  // Run the collector and docker port mapping in parallel
  const sshBaseArgs = buildSshArgs(sshOpts)

  const collectorProc = Bun.spawn(["ssh", ...sshBaseArgs, "bash -s"], {
    stdin: new Blob([LINUX_COLLECTOR_SCRIPT]),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  })

  // Get docker published ports → container mapping
  // Uses `docker ps` for names/images/ports, then parses compose naming convention
  const portMapCmd = `docker ps --format '{{.Names}}|{{.Image}}|{{.Ports}}' 2>/dev/null`
  const portMapProc = Bun.spawn(["ssh", ...sshBaseArgs, portMapCmd], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
  })

  const [collectorStdout, collectorStderr, portMapStdout] = await Promise.all([
    new Response(collectorProc.stdout).text(),
    new Response(collectorProc.stderr).text(),
    new Response(portMapProc.stdout).text(),
  ])

  const collectorExit = await collectorProc.exited
  await portMapProc.exited

  if (collectorExit !== 0) {
    throw new Error(
      collectorStderr.trim() || `SSH exited with code ${collectorExit}`
    )
  }

  const jsonStart = collectorStdout.indexOf("{")
  if (jsonStart === -1) {
    throw new Error(`No JSON output from host ${ip}`)
  }

  const scanResult = JSON.parse(collectorStdout.slice(jsonStart)) as ScanResult

  // Parse port mappings: "name|image|ports"
  // Container name convention: "{project}-{service}-{number}" or just "{name}"
  // Ports format: "0.0.0.0:9000->9000/tcp, [::]:9000->9000/tcp, 9443/tcp"
  const portMappings: PortMapping[] = []
  for (const line of portMapStdout.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split("|")
    if (parts.length < 3) continue

    const [containerName, image, portsStr] = parts
    if (!portsStr) continue

    // Parse compose project/service from container name
    // Convention: "{project}-{service}-{number}" e.g. "factory-infra-gateway-1"
    let composeProject = ""
    let composeService = containerName
    const nameMatch = containerName.match(/^(.+?)-(.+)-\d+$/)
    if (nameMatch) {
      composeProject = nameMatch[1]
      composeService = nameMatch[2]
    }

    // Extract published host ports: "0.0.0.0:9000->9000/tcp"
    const seen = new Set<number>()
    for (const m of portsStr.matchAll(/0\.0\.0\.0:(\d+)->/g)) {
      const hostPort = parseInt(m[1], 10)
      if (!seen.has(hostPort)) {
        seen.add(hostPort)
        portMappings.push({
          hostPort,
          containerName,
          composeProject,
          composeService,
          image,
        })
      }
    }
  }

  return { scanResult, portMappings }
}

/**
 * Match proxy backend ports to services discovered on a host.
 * Uses port mappings (docker ps), compose services, and port/process data.
 */
function matchBackendsToServices(
  backends: { port: number; routerName: string; domains: string[] }[],
  scanResult: ScanResult,
  portMappings: PortMapping[]
): ResolvedBackendService[] {
  const resolved: ResolvedBackendService[] = []

  for (const backend of backends) {
    let service: ResolvedBackendService["service"]

    // 1. Try docker port mappings (most reliable)
    const portMap = portMappings.find((pm) => pm.hostPort === backend.port)
    if (portMap) {
      service = {
        name: portMap.composeService,
        displayName: portMap.containerName,
        composeProject: portMap.composeProject,
        image: portMap.image,
        runtime: "docker",
      }
    }

    // 2. Try compose services from collector
    if (!service) {
      const svc = scanResult.services.find((s) =>
        s.ports.includes(backend.port)
      )
      if (svc) {
        service = {
          name: svc.name,
          displayName: svc.displayName,
          composeProject: svc.composeProject,
          image: svc.image,
          runtime: svc.runtime,
        }
      }
    }

    // 3. Fall back to port/process data
    if (!service) {
      const portEntry = scanResult.ports.find(
        (p) => p.port === backend.port && p.protocol === "tcp"
      )
      if (portEntry?.process) {
        service = {
          name: portEntry.process,
          displayName: portEntry.process,
          runtime: "process",
        }
      }
    }

    resolved.push({
      port: backend.port,
      domains: backend.domains,
      routerName: backend.routerName,
      service,
    })
  }

  return resolved
}

// ── Main crawl function ──────────────────────────────────────

/**
 * Crawl backend hosts discovered from a reverse proxy.
 * Scans each unique host IP via SSH in parallel, then matches
 * backend ports to discovered services.
 *
 * @param backendHosts Map of IP → backend info from extractBackendHosts()
 * @param sshUser SSH user for connecting to backend hosts
 * @param concurrency Max number of parallel SSH connections
 * @param verbose Print progress to stderr
 */
export async function crawlBackendHosts(
  backendHosts: Map<
    string,
    { port: number; routerName: string; domains: string[] }[]
  >,
  options: {
    sshUser?: string
    concurrency?: number
    verbose?: boolean
  } = {}
): Promise<HostScanEntry[]> {
  const { sshUser = "lepton", concurrency = 5, verbose = true } = options

  const hostIps = [...backendHosts.keys()].sort()
  if (verbose) {
    console.log(
      styleBold(`\n  Network Crawl: ${hostIps.length} backend hosts discovered`)
    )
  }

  const results: HostScanEntry[] = []

  // Process hosts in batches for concurrency control
  for (let i = 0; i < hostIps.length; i += concurrency) {
    const batch = hostIps.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map(async (ip) => {
        const backends = backendHosts.get(ip)!
        const entry: HostScanEntry = {
          ip,
          backends,
          scanResult: null,
          resolvedServices: [],
        }

        try {
          if (verbose) {
            process.stderr.write(`    scanning ${ip}...`)
          }
          const { scanResult, portMappings } = await scanRemoteHost(ip, sshUser)
          entry.scanResult = scanResult

          // Match backend ports to services
          entry.resolvedServices = matchBackendsToServices(
            backends,
            scanResult,
            portMappings
          )

          const resolved = entry.resolvedServices.filter(
            (r) => r.service
          ).length
          const total = entry.resolvedServices.length
          if (verbose) {
            process.stderr.write(
              ` ${styleSuccess("✓")} ${resolved}/${total} ports matched\n`
            )
          }
        } catch (err) {
          entry.error = err instanceof Error ? err.message : String(err)
          if (verbose) {
            process.stderr.write(
              ` ${styleError("✗")} ${styleMuted(entry.error.slice(0, 60))}\n`
            )
          }
        }

        return entry
      })
    )

    results.push(...batchResults)
  }

  return results
}

// ── Display ──────────────────────────────────────────────────

/**
 * Print a summary of the network crawl results.
 */
export function printNetworkCrawlSummary(
  proxy: ScanReverseProxy,
  hostScans: HostScanEntry[]
): void {
  const successful = hostScans.filter((h) => h.scanResult)
  const failed = hostScans.filter((h) => !h.scanResult)
  const totalResolved = hostScans.reduce(
    (sum, h) => sum + h.resolvedServices.filter((r) => r.service).length,
    0
  )
  const totalUnresolved = hostScans.reduce(
    (sum, h) => sum + h.resolvedServices.filter((r) => !r.service).length,
    0
  )

  console.log(
    styleBold(`\n  Network Graph — ${proxy.engine} v${proxy.version ?? "?"}`)
  )
  console.log(
    `    Hosts scanned: ${successful.length} reachable, ${failed.length} unreachable`
  )
  console.log(
    `    Routes resolved: ${totalResolved} matched, ${totalUnresolved} unmatched (stale?)\n`
  )

  // Show resolved routes grouped by host
  for (const host of hostScans) {
    if (!host.scanResult) continue

    const hostname = host.scanResult.hostname ?? host.ip
    const projects = host.scanResult.composeProjects
      .map((p) => p.name)
      .join(", ")
    console.log(
      `    ${styleBold(hostname)} ${styleMuted(`(${host.ip})`)} ${projects ? styleMuted(`[${projects}]`) : ""}`
    )

    for (const rs of host.resolvedServices) {
      const domain = rs.domains[0] ?? "(rule-based)"
      if (rs.service) {
        const target = rs.service.composeProject
          ? `${rs.service.composeProject}/${rs.service.name}`
          : rs.service.name
        console.log(
          `      ${domain}  →  :${rs.port}  →  ${styleSuccess(target)}`
        )
      } else {
        console.log(
          `      ${domain}  →  :${rs.port}  →  ${styleError("no match")} ${styleMuted("(stale route?)")}`
        )
      }
    }
  }

  // Show unreachable hosts
  if (failed.length > 0) {
    console.log(styleMuted(`\n    Unreachable hosts:`))
    for (const host of failed) {
      const domains = host.backends
        .flatMap((b) => b.domains)
        .slice(0, 3)
        .join(", ")
      console.log(
        `      ${styleError("✗")} ${host.ip} ${styleMuted(`(${domains}${host.backends.length > 3 ? "..." : ""})`)}`
      )
    }
  }

  console.log()
}
