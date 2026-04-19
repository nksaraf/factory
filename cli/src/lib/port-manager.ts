/**
 * Port allocation and persistence.
 *
 * Auto-assigns free host ports to compose services and persists assignments.
 * Supports multi-port services via compound keys (service/portName).
 */
import type { CatalogSystem } from "@smp/factory-shared/catalog"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { dirname, join } from "node:path"

const MAX_PORT_RETRIES = 100
const HOST_REGISTRY_DIR = join(
  process.env.HOME ?? process.env.USERPROFILE ?? "/tmp",
  ".dx"
)
const HOST_REGISTRY_FILE = join(HOST_REGISTRY_DIR, "host-ports.json")

interface PortReservation {
  port: number
  pinned: boolean
}

interface HostPortEntry {
  port: number
  project: string
  service: string
  updatedAt: string
}

function readHostRegistry(): HostPortEntry[] {
  if (!existsSync(HOST_REGISTRY_FILE)) return []
  try {
    return JSON.parse(readFileSync(HOST_REGISTRY_FILE, "utf-8"))
  } catch {
    return []
  }
}

function writeHostRegistry(entries: HostPortEntry[]): void {
  mkdirSync(HOST_REGISTRY_DIR, { recursive: true })
  writeFileSync(HOST_REGISTRY_FILE, JSON.stringify(entries, null, 2) + "\n")
}

function hostRegistryPortsExcluding(projectId: string): Set<number> {
  const entries = readHostRegistry()
  const ports = new Set<number>()
  for (const e of entries) {
    if (e.project !== projectId) ports.add(e.port)
  }
  return ports
}

function updateHostRegistry(
  projectId: string,
  allocations: Record<string, number>
): void {
  const entries = readHostRegistry().filter((e) => e.project !== projectId)
  const now = new Date().toISOString()
  for (const [service, port] of Object.entries(allocations)) {
    entries.push({ port, project: projectId, service, updatedAt: now })
  }
  writeHostRegistry(entries)
}

export interface PortRequest {
  name: string
  preferred?: number
}

export interface NamedPortRequest {
  name: string
  preferred?: number
}

export interface ServicePortRequest {
  service: string
  ports: NamedPortRequest[]
}

/**
 * Check if a port is available on both 127.0.0.1 and 0.0.0.0.
 * Docker binds on 0.0.0.0, so we must check both interfaces.
 */
export async function isPortFree(port: number): Promise<boolean> {
  for (const host of ["127.0.0.1", "0.0.0.0"]) {
    const free = await new Promise<boolean>((resolve) => {
      const server = createServer()
      server.once("error", () => resolve(false))
      server.once("listening", () => {
        server.close(() => resolve(true))
      })
      server.listen(port, host)
    })
    if (!free) return false
  }
  return true
}

/**
 * Allocate a single free port by binding to :0, avoiding reserved ports.
 */
export async function allocatePort(reserved: Set<number>): Promise<number> {
  for (let i = 0; i < MAX_PORT_RETRIES; i++) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer()
      server.once("error", reject)
      server.once("listening", () => {
        const addr = server.address()
        const p = typeof addr === "object" && addr ? addr.port : 0
        server.close(() => resolve(p))
      })
      server.listen(0, "127.0.0.1")
    })
    if (!reserved.has(port)) return port
  }
  throw new Error("Failed to allocate a free port after retries")
}

// ---------------------------------------------------------------------------
// Env var helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a catalog port name for use as an env var suffix.
 * Strips the "port-" prefix from auto-generated names, leaving just the number.
 */
function normalizePortRole(name: string): string {
  // "port-8080" → "8080", "smtp" → "smtp", "http" → "http"
  if (name.startsWith("port-")) return name.slice(5)
  return name
}

/**
 * Build env var map for a service's ports.
 *
 * - 1 port  → SERVICE_PORT
 * - >1 port → SERVICE_ROLE_PORT for each (no plain alias)
 */
export function portEnvVars(
  service: string,
  ports: Record<string, number>
): Record<string, string> {
  const base = service.toUpperCase().replace(/-/g, "_")
  const env: Record<string, string> = {}
  const names = Object.keys(ports)

  if (names.length === 1) {
    env[`${base}_PORT`] = String(ports[names[0]])
  } else {
    for (const role of names) {
      const normalized = normalizePortRole(role)
      const roleSuffix = normalized.toUpperCase().replace(/-/g, "_")
      env[`${base}_${roleSuffix}_PORT`] = String(ports[role])
    }
  }
  return env
}

/**
 * Build ServicePortRequest[] from a CatalogSystem.
 * Iterates all components + resources, collecting their port arrays.
 */
export function catalogToPortRequests(
  catalog: CatalogSystem
): ServicePortRequest[] {
  const requests: ServicePortRequest[] = []

  const entities = [
    ...Object.entries(catalog.components),
    ...Object.entries(catalog.resources),
  ]

  for (const [name, entity] of entities) {
    const ports = entity.spec.ports
    if (!ports || ports.length === 0) continue

    requests.push({
      service: name,
      ports: ports.map((p) => ({
        name: p.name,
        preferred: p.port,
      })),
    })
  }

  return requests
}

/**
 * Print a port table to stdout.
 *
 * @param resolved - service → { portName → hostPort }
 * @param verbose  - also print env var names
 */
export function printPortTable(
  resolved: Record<string, Record<string, number>>,
  verbose = false
): void {
  const services = Object.keys(resolved).sort()
  if (services.length === 0) return

  // Compute column width from longest service name
  const maxNameLen = Math.max(...services.map((s) => s.length))
  const pad = maxNameLen + 2

  console.log("")
  for (const service of services) {
    const ports = resolved[service]
    const portNames = Object.keys(ports)
    const envMap = verbose ? portEnvVars(service, ports) : {}

    for (let i = 0; i < portNames.length; i++) {
      const role = portNames[i]
      const port = ports[role]
      const label = i === 0 ? service.padEnd(pad) : "".padEnd(pad)
      const url = `http://localhost:${port}`
      const roleHint =
        portNames.length > 1 ? ` (${normalizePortRole(role)})` : ""

      if (verbose) {
        const envVar = Object.entries(envMap).find(
          ([_, v]) => v === String(port)
        )
        const envHint = envVar ? `  ${envVar[0]}` : ""
        console.log(`  ${label}${url}${roleHint}${envHint}`)
      } else {
        console.log(`  ${label}${url}${roleHint}`)
      }
    }
  }
  console.log("")
}

// ---------------------------------------------------------------------------
// PortManager
// ---------------------------------------------------------------------------

/**
 * Manages persistent port reservations for compose services.
 */
export class PortManager {
  private readonly reservationsFile: string
  private readonly projectId: string

  constructor(
    private readonly stateDir: string,
    projectId?: string
  ) {
    this.reservationsFile = join(stateDir, "ports.json")
    this.projectId = projectId ?? stateDir
  }

  private read(): Record<string, PortReservation> {
    if (!existsSync(this.reservationsFile)) return {}
    try {
      const raw = readFileSync(this.reservationsFile, "utf-8")
      const data = JSON.parse(raw) as Record<string, PortReservation>
      // Migrate old flat keys: "infra-postgres" → "infra-postgres/default"
      let migrated = false
      for (const key of Object.keys(data)) {
        if (!key.includes("/")) {
          data[`${key}/default`] = data[key]
          delete data[key]
          migrated = true
        }
      }
      if (migrated) this.write(data)
      return data
    } catch {
      return {}
    }
  }

  private write(data: Record<string, PortReservation>): void {
    mkdirSync(this.stateDir, { recursive: true })
    writeFileSync(this.reservationsFile, JSON.stringify(data, null, 2) + "\n")
  }

  /**
   * Resolve a single port by key. Reuses persistent assignments when possible,
   * respects pinned ports, and tries preferred port before fallback.
   */
  private async resolveOne(
    key: string,
    preferred: number | undefined,
    reservations: Record<string, PortReservation>,
    allReserved: Set<number>
  ): Promise<number> {
    const existing = reservations[key]

    if (existing && existing.pinned) {
      if (!(await isPortFree(existing.port))) {
        throw new Error(
          `Pinned port ${existing.port} for ${key} is in use by another process`
        )
      }
      return existing.port
    }

    if (existing && (await isPortFree(existing.port))) {
      return existing.port
    }

    let port: number
    if (
      preferred !== undefined &&
      !allReserved.has(preferred) &&
      (await isPortFree(preferred))
    ) {
      port = preferred
    } else {
      port = await allocatePort(allReserved)
    }

    allReserved.add(port)
    reservations[key] = { port, pinned: false }
    return port
  }

  /**
   * Resolve ports for a list of requests (legacy single-port API).
   */
  async resolve(requests: PortRequest[]): Promise<Record<string, number>> {
    // Wrap into ServicePortRequest with "default" port name
    const multi = requests.map((r) => ({
      service: r.name,
      ports: [{ name: "default", preferred: r.preferred }],
    }))
    const resolved = await this.resolveMulti(multi)
    const result: Record<string, number> = {}
    for (const [service, ports] of Object.entries(resolved)) {
      result[service] = Object.values(ports)[0]
    }
    return result
  }

  /**
   * Resolve ports for multi-port services. Each service can have multiple
   * named ports. Uses compound keys (service/portName) in storage.
   */
  async resolveMulti(
    requests: ServicePortRequest[]
  ): Promise<Record<string, Record<string, number>>> {
    const reservations = this.read()
    const allReserved = new Set<number>(
      Object.values(reservations).map((r) => r.port)
    )

    // Exclude ports claimed by other projects on this host
    for (const p of hostRegistryPortsExcluding(this.projectId)) {
      allReserved.add(p)
    }

    // Also exclude ports claimed by global SSH forwards
    try {
      const { ForwardState } = await import("./forward-state.js")
      for (const p of new ForwardState().reservedPorts()) {
        allReserved.add(p)
      }
    } catch {
      // forward-state not available — skip
    }
    const result: Record<string, Record<string, number>> = {}

    for (const req of requests) {
      result[req.service] = {}
      for (const portReq of req.ports) {
        const key = `${req.service}/${portReq.name}`
        const port = await this.resolveOne(
          key,
          portReq.preferred,
          reservations,
          allReserved
        )
        result[req.service][portReq.name] = port
      }
    }

    this.write(reservations)

    // Update host-level registry so other projects see our allocations
    const flatAllocations: Record<string, number> = {}
    for (const [service, ports] of Object.entries(result)) {
      for (const [name, port] of Object.entries(ports)) {
        flatAllocations[`${service}/${name}`] = port
      }
    }
    updateHostRegistry(this.projectId, flatAllocations)

    return result
  }

  /**
   * Pin a service port to a specific value.
   */
  pin(service: string, port: number, portName = "default"): void {
    const key = `${service}/${portName}`
    const reservations = this.read()
    for (const [k, v] of Object.entries(reservations)) {
      if (v.port === port && k !== key) {
        throw new Error(`Port ${port} is already reserved by ${k}`)
      }
    }
    reservations[key] = { port, pinned: true }
    this.write(reservations)
  }

  /**
   * Clear reservations. If a service name is given, only that service's ports
   * are removed; otherwise all reservations are cleared.
   */
  clear(service?: string): void {
    if (service) {
      const reservations = this.read()
      let changed = false
      for (const key of Object.keys(reservations)) {
        if (key === service || key.startsWith(`${service}/`)) {
          delete reservations[key]
          changed = true
        }
      }
      if (changed) this.write(reservations)
    } else {
      this.write({})
    }
  }

  /**
   * Return the current reservations as a sorted array.
   */
  status(): Array<{ name: string; port: number; pinned: boolean }> {
    const reservations = this.read()
    return Object.entries(reservations)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, data]) => ({
        name,
        port: data.port,
        pinned: data.pinned,
      }))
  }

  /**
   * Write port assignments as environment variables to a file.
   * Accepts a pre-built env var map (from portEnvVars()).
   */
  writeEnvFile(envVars: Record<string, string>, envPath: string): void {
    const dir = dirname(envPath)
    mkdirSync(dir, { recursive: true })

    const lines: string[] = []
    for (const name of Object.keys(envVars).sort()) {
      lines.push(`${name}=${envVars[name]}`)
    }
    writeFileSync(envPath, lines.join("\n") + "\n")
  }
}
