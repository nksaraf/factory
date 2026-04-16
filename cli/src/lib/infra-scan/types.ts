import type { NetworkCrawlResult } from "@smp/factory-shared/schemas/infra"

/**
 * Types for infra scan collectors.
 * Mirrors HostScanResultSchema from shared/src/schemas/infra.ts for CLI use.
 */

export type ScanPort = {
  port: number
  protocol: "tcp" | "udp"
  address?: string
  process?: string
  pid?: number
  state?: string
}

export type ScanService = {
  name: string
  displayName?: string
  realmType:
    | "docker-compose"
    | "systemd"
    | "iis"
    | "windows-service"
    | "process"
  status: string
  ports: number[]
  image?: string
  command?: string
  pid?: number
  composeProject?: string
  metadata?: Record<string, string>
}

export type ScanRealm = {
  type: "docker-engine" | "systemd" | "iis" | "windows-service" | "process"
  version?: string
  status?: string
}

export type ScanComposeProject = {
  name: string
  workingDir?: string
  status?: string
  services: string[]
}

export type CollectorStatus = {
  name: string
  status: "ok" | "failed" | "skipped"
  error?: string
  count?: number
}

// ── Reverse proxy scan types ────────────────────────────────

export type ScanBackend = {
  url: string
  weight?: number
  /** Resolved container info — populated by matching backend IP to container IPs */
  container?: {
    name: string
    composeProject: string
    composeService: string
  }
  /** Resolved host info — populated when backend IP matches a known host */
  hostIp?: string
}

export type ScanRouter = {
  name: string
  rule: string
  domains: string[]
  pathPrefixes: string[]
  entrypoints: string[]
  service: string
  tls?: { certResolver?: string; passthrough?: boolean }
  middlewares: string[]
  backends: ScanBackend[]
  status?: string
  provider?: string
}

export type ScanEntrypoint = {
  name: string
  port: number
  protocol: string
}

export type ScanReverseProxy = {
  name: string
  engine: "traefik" | "nginx" | "caddy" | "haproxy"
  version?: string
  containerName?: string
  pid?: number
  apiUrl?: string
  entrypoints: ScanEntrypoint[]
  routers: ScanRouter[]
}

// ── Top-level scan result ───────────────────────────────────

/** Docker container IP mapping entry — used to resolve Traefik backend IPs to containers */
export type ContainerIpEntry = {
  ip: string
  containerName: string
  composeProject: string
  composeService: string
  /** Host-side port bindings, e.g. [8002] for "0.0.0.0:8002->7777/tcp". */
  hostPorts?: number[]
}

export type {
  NetworkCrawlResolvedService,
  NetworkCrawlHostEntry,
  NetworkCrawlResult,
} from "@smp/factory-shared/schemas/infra"

export type ScanResult = {
  scannedAt: string
  scanDurationMs?: number
  os?: "linux" | "windows" | "macos"
  arch?: "amd64" | "arm64"
  hostname?: string
  ipAddress?: string
  realms: ScanRealm[]
  services: ScanService[]
  ports: ScanPort[]
  composeProjects: ScanComposeProject[]
  collectors: CollectorStatus[]
  reverseProxies?: ScanReverseProxy[]
  /** Container IP→name mapping for resolving proxy backends to containers */
  containerIpMap?: ContainerIpEntry[]
  /** Network crawl results from recursive host scanning */
  networkCrawl?: NetworkCrawlResult
}
