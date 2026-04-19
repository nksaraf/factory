/**
 * Traefik reverse proxy collector.
 * Queries the Traefik API to discover routers, services, entrypoints.
 */
import type {
  ContainerIpEntry,
  ScanBackend,
  ScanEntrypoint,
  ScanReverseProxy,
  ScanRouter,
} from "../types.js"

// ── Traefik API response types ──────────────────────────────

interface TraefikOverview {
  http: {
    routers: { total: number }
    services: { total: number }
    middlewares: { total: number }
  }
  tcp: { routers: { total: number }; services: { total: number } }
  features: Record<string, unknown>
  providers: string[]
}

interface TraefikVersion {
  Version: string
  Codename: string
  startDate: string
}

interface TraefikEntrypoint {
  name: string
  address: string
}

interface TraefikRouter {
  name: string
  rule: string
  service: string
  entryPoints?: string[]
  middlewares?: string[]
  tls?: { certResolver?: string; passthrough?: boolean; options?: string }
  status: string
  provider: string
  priority?: number
  using?: string[]
}

interface TraefikService {
  name: string
  provider: string
  type: string
  status: string
  loadBalancer?: {
    servers?: { url: string; weight?: number }[]
    passHostHeader?: boolean
  }
  serverStatus?: Record<string, string>
  usedBy?: string[]
}

// ── Rule parsing ────────────────────────────────────────────

/**
 * Parse Traefik rule string to extract Host() and PathPrefix() matchers.
 * Examples:
 *   "Host(`api.example.com`)" → { domains: ["api.example.com"], pathPrefixes: [] }
 *   "Host(`api.example.com`) && PathPrefix(`/api/`)" → { domains: ["api.example.com"], pathPrefixes: ["/api/"] }
 *   "Host(`a.com`, `b.com`)" → { domains: ["a.com", "b.com"], pathPrefixes: [] }
 *   "HostRegexp(`{subdomain:[a-z]+}.example.com`)" → { domains: ["*.example.com"], pathPrefixes: [] }
 */
export function parseTraefikRule(rule: string): {
  domains: string[]
  pathPrefixes: string[]
} {
  const domains: string[] = []
  const pathPrefixes: string[] = []

  // Match Host(`...`) — may contain multiple comma-separated hosts
  const hostMatches = rule.matchAll(/Host\(`([^`]+(?:`,\s*`[^`]+)*)`\)/g)
  for (const m of hostMatches) {
    // Split on "`, `" for multi-host rules
    const hosts = m[1].split(/`,\s*`/)
    domains.push(...hosts)
  }

  // Match HostRegexp — convert to wildcard notation
  const hostRegexpMatches = rule.matchAll(/HostRegexp\(`([^`]+)`\)/g)
  for (const m of hostRegexpMatches) {
    // Convert `{subdomain:[a-z]+}.example.com` → `*.example.com`
    const pattern = m[1].replace(/\{[^}]+\}/g, "*")
    domains.push(pattern)
  }

  // Match PathPrefix(`...`)
  const pathMatches = rule.matchAll(/PathPrefix\(`([^`]+)`\)/g)
  for (const m of pathMatches) {
    pathPrefixes.push(m[1])
  }

  return { domains, pathPrefixes }
}

// ── API fetching ────────────────────────────────────────────

async function fetchTraefikApi<T>(apiUrl: string, path: string): Promise<T> {
  const url = `${apiUrl.replace(/\/$/, "")}${path}`
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: "application/json" },
  })
  if (!resp.ok) {
    throw new Error(
      `Traefik API ${path} returned ${resp.status}: ${resp.statusText}`
    )
  }
  return resp.json() as Promise<T>
}

// ── Main collector ──────────────────────────────────────────

/**
 * Query a Traefik instance's API and return discovered routes.
 * @param apiUrl Base URL of the Traefik API (e.g., "http://192.168.1.59:8085")
 * @param containerIpMap Optional mapping of container IPs to names — used to resolve backends to containers
 */
export async function collectTraefikRoutes(
  apiUrl: string,
  containerIpMap?: ContainerIpEntry[],
  fetchJson: <T>(apiUrl: string, path: string) => Promise<T> = fetchTraefikApi
): Promise<ScanReverseProxy> {
  // Fetch version, entrypoints, routers, and services in parallel
  const [version, entrypoints, routers, services] = await Promise.all([
    fetchJson<TraefikVersion>(apiUrl, "/api/version").catch(() => null),
    fetchJson<TraefikEntrypoint[]>(apiUrl, "/api/entrypoints").catch(() => []),
    fetchJson<TraefikRouter[]>(apiUrl, "/api/http/routers"),
    fetchJson<TraefikService[]>(apiUrl, "/api/http/services"),
  ])

  // Build container lookups for resolving backends.
  // Traefik backend URLs can reference containers by either IP (172.x.x.x)
  // or by compose service DNS name (e.g. http://data-management:8091).
  const ipLookup = new Map<string, ContainerIpEntry>()
  const serviceNameLookup = new Map<string, ContainerIpEntry[]>()
  const hostPortLookup = new Map<number, ContainerIpEntry>()
  if (containerIpMap) {
    for (const entry of containerIpMap) {
      ipLookup.set(entry.ip, entry)
      const existing = serviceNameLookup.get(entry.composeService) ?? []
      existing.push(entry)
      serviceNameLookup.set(entry.composeService, existing)
      for (const hp of entry.hostPorts ?? []) hostPortLookup.set(hp, entry)
    }
  }

  const HOST_ALIASES = new Set([
    "host.docker.internal",
    "gateway.docker.internal",
    "localhost",
    "127.0.0.1",
  ])

  // Build service lookup: service name → backends
  const serviceMap = new Map<string, ScanBackend[]>()
  for (const svc of services) {
    const backends: ScanBackend[] = []
    if (svc.loadBalancer?.servers) {
      for (const server of svc.loadBalancer.servers) {
        const backend: ScanBackend = { url: server.url, weight: server.weight }

        try {
          const u = new URL(server.url)
          const hostname = u.hostname
          // 1. Try IP lookup (container IPs like 172.x.x.x)
          let containerEntry = ipLookup.get(hostname)
          // 2. Fall back to compose service name (Docker DNS)
          if (!containerEntry) {
            const matches = serviceNameLookup.get(hostname)
            if (matches && matches.length > 0) containerEntry = matches[0]
          }
          // 3. Fall back to host-port mapping for localhost / host.docker.internal
          if (!containerEntry && HOST_ALIASES.has(hostname)) {
            const port = parseInt(u.port, 10)
            if (Number.isFinite(port)) {
              containerEntry = hostPortLookup.get(port) ?? undefined
            }
          }
          if (containerEntry) {
            backend.container = {
              name: containerEntry.containerName,
              composeProject: containerEntry.composeProject,
              composeService: containerEntry.composeService,
            }
          } else {
            backend.hostIp = hostname
          }
        } catch {
          /* invalid URL — skip resolution */
        }

        backends.push(backend)
      }
    }
    serviceMap.set(svc.name, backends)
  }

  // Parse entrypoints
  const parsedEntrypoints: ScanEntrypoint[] = entrypoints.map((ep) => {
    const portMatch = ep.address.match(/:(\d+)$/)
    const port = portMatch ? parseInt(portMatch[1], 10) : 0
    // Infer protocol from name/port
    let protocol = "http"
    if (ep.name === "websecure" || port === 443) protocol = "https"
    else if (
      ep.name.includes("tcp") ||
      ep.name.includes("db") ||
      ep.name.includes("ldap")
    )
      protocol = "tcp"
    return { name: ep.name, port, protocol }
  })

  // Parse routers
  const parsedRouters: ScanRouter[] = routers
    .filter((r) => r.status === "enabled" && !r.service.includes("@internal"))
    .map((r) => {
      const { domains, pathPrefixes } = parseTraefikRule(r.rule)

      // Resolve backends from the service name
      // Traefik service names in routers don't include @provider suffix,
      // but service list entries do. Try both.
      const backends =
        serviceMap.get(r.service + "@" + r.provider) ??
        serviceMap.get(r.service) ??
        []

      return {
        name: r.name,
        rule: r.rule,
        domains,
        pathPrefixes,
        entrypoints: r.entryPoints ?? r.using ?? [],
        service: r.service,
        priority: r.priority,
        tls: r.tls
          ? {
              certResolver: r.tls.certResolver,
              passthrough: r.tls.passthrough,
            }
          : undefined,
        middlewares: r.middlewares ?? [],
        backends,
        status: r.status,
        provider: r.provider,
      }
    })

  return {
    name: "traefik",
    engine: "traefik",
    version: version?.Version,
    apiUrl,
    entrypoints: parsedEntrypoints,
    routers: parsedRouters,
  }
}

// ── Container IP mapping ────────────────────────────────────

/**
 * Collect a mapping of Docker container IPs to their compose project/service names.
 * Runs `docker inspect` on all running containers.
 * Works both locally and via SSH.
 */
export async function collectContainerIpMap(
  sshArgs?: string[]
): Promise<ContainerIpEntry[]> {
  // Columns: name | ip | compose-project | compose-service | port-map-json | cmd-json
  // port-map-json captures container→host port bindings as {"8080/tcp":"8085",...}
  const inspectCmd = `docker ps -q | xargs -I{} docker inspect {} --format '{{.Name}}|{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{json .NetworkSettings.Ports}}|{{json .Config.Cmd}}'`

  let args: string[]
  if (sshArgs) {
    args = ["ssh", ...sshArgs, inspectCmd]
  } else {
    args = ["bash", "-c", inspectCmd]
  }

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  })

  const stdout = await new Response(proc.stdout).text()
  await proc.exited

  const entries: ContainerIpEntry[] = []
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // Split on first 4 pipes only — remaining fields are JSON that may contain pipes
    const firstPipes: string[] = []
    let rest = trimmed
    for (let i = 0; i < 4; i++) {
      const idx = rest.indexOf("|")
      if (idx === -1) break
      firstPipes.push(rest.slice(0, idx))
      rest = rest.slice(idx + 1)
    }
    if (firstPipes.length < 4) continue
    const containerName = firstPipes[0].replace(/^\//, "")
    const ip = firstPipes[1]
    const composeProject = firstPipes[2]
    const composeService = firstPipes[3]
    if (!ip || !composeProject || !composeService) continue

    // rest = "port-map-json|cmd-json" — split on last unbracketed pipe
    // Port map JSON: {"8080/tcp":[{"HostIp":"0.0.0.0","HostPort":"8085"}],...}
    let hostPorts: number[] = []
    let exposedPorts: number[] = []
    const portMap: Record<string, number> = {}
    let cmd: string[] | undefined

    // Find the boundary between ports JSON and cmd JSON
    // Ports JSON starts with { or null, cmd JSON starts with [ or null
    const cmdIdx = rest.lastIndexOf("|[")
    const cmdNullIdx = rest.lastIndexOf("|null")
    const splitIdx = Math.max(cmdIdx, cmdNullIdx)

    const portsRaw = splitIdx > 0 ? rest.slice(0, splitIdx) : rest
    const cmdRaw = splitIdx > 0 ? rest.slice(splitIdx + 1) : ""

    try {
      const ports = JSON.parse(portsRaw) as Record<
        string,
        Array<{ HostIp: string; HostPort: string }> | null
      >
      if (ports) {
        for (const [containerPort, bindings] of Object.entries(ports)) {
          const cp = parseInt(containerPort, 10)
          if (Number.isFinite(cp)) exposedPorts.push(cp)
          if (bindings) {
            for (const b of bindings) {
              const hp = parseInt(b.HostPort, 10)
              if (Number.isFinite(hp) && hp > 0) {
                hostPorts.push(hp)
                portMap[String(cp)] = hp
              }
            }
          }
        }
      }
    } catch {
      // not valid JSON
    }

    if (cmdRaw && cmdRaw !== "null") {
      try {
        cmd = JSON.parse(cmdRaw) as string[]
      } catch {
        // not valid JSON
      }
    }

    hostPorts = [...new Set(hostPorts)]
    exposedPorts = [...new Set(exposedPorts)]

    entries.push({
      ip,
      containerName,
      composeProject,
      composeService,
      hostPorts: hostPorts.length ? hostPorts : undefined,
      exposedPorts: exposedPorts.length ? exposedPorts : undefined,
      portMap: Object.keys(portMap).length ? portMap : undefined,
      cmd,
    })
  }

  return entries
}

/**
 * Detect Traefik API URL from a scan service.
 * Checks for known Traefik container images and process names.
 * Returns the API URL if detected, null otherwise.
 */
/**
 * Read the Traefik API entrypoint port from the container's command args.
 *
 * When `--api.insecure=true` is set, Traefik serves the API on the `traefik`
 * entrypoint. The port defaults to 8080 unless overridden with
 * `--entrypoints.traefik.address=:XXXX`.
 */
export function detectTraefikApiUrl(
  service: {
    name: string
    image?: string
    ports: number[]
    cmd?: string[]
    metadata?: Record<string, string>
  },
  hostAddress: string = "localhost"
): string | null {
  const isTraefik =
    service.image?.startsWith("traefik:") ||
    service.image?.startsWith("traefik/") ||
    service.name === "traefik" ||
    service.name === "reverse-proxy"

  if (!isTraefik) return null

  const cmd = service.cmd ?? []

  // Check if the API is enabled
  const hasApi =
    cmd.some((a) => a === "--api.insecure=true") ||
    cmd.some((a) => a === "--api.dashboard=true")

  if (!hasApi && cmd.length > 0) return null

  // Read the traefik entrypoint port from static config
  const traefikEp = cmd.find((a) =>
    a.startsWith("--entrypoints.traefik.address=")
  )
  if (traefikEp) {
    const portMatch = traefikEp.match(/:(\d+)$/)
    if (portMatch) {
      return `http://${hostAddress}:${portMatch[1]}`
    }
  }

  // Default: Traefik API entrypoint is 8080
  return `http://${hostAddress}:8080`
}

/**
 * Extract unique backend host IPs from a reverse proxy's routers.
 * Skips Docker-internal IPs (172.x.x.x) and localhost.
 * Returns a map of IP → backend ports used on that IP.
 */
export function extractBackendHosts(
  proxy: ScanReverseProxy
): Map<string, { port: number; routerName: string; domains: string[] }[]> {
  const hosts = new Map<
    string,
    { port: number; routerName: string; domains: string[] }[]
  >()

  for (const router of proxy.routers) {
    for (const backend of router.backends) {
      if (backend.container) continue // already resolved to container
      try {
        const u = new URL(backend.url)
        const ip = u.hostname
        // Skip Docker-internal and localhost
        if (
          ip.startsWith("172.") ||
          ip.startsWith("10.") ||
          ip === "127.0.0.1" ||
          ip === "localhost"
        )
          continue

        const port =
          parseInt(u.port, 10) || (u.protocol === "https:" ? 443 : 80)
        const existing = hosts.get(ip) ?? []
        existing.push({
          port,
          routerName: router.name,
          domains: router.domains,
        })
        hosts.set(ip, existing)
      } catch {
        /* invalid URL */
      }
    }
  }

  return hosts
}
