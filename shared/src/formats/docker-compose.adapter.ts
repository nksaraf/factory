/**
 * docker-compose format adapter.
 *
 * Reads a docker-compose.yaml and converts it to a CatalogSystem.
 * Uses image-name heuristics, labels, env vars, and depends_on to build
 * a rich catalog model with proper port names, API declarations,
 * documentation links, and inter-service connections.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { parse as parseYaml } from "yaml"

import type {
  CatalogAPI,
  CatalogComponent,
  CatalogConnection,
  CatalogLifecycle,
  CatalogPort,
  CatalogResource,
  CatalogSystem,
  CatalogSystemDependency,
} from "../catalog"
import { catalogSystemDependencySchema } from "../catalog"
import type {
  CatalogFormatAdapter,
  CatalogGenerateResult,
  CatalogParseResult,
} from "../catalog-registry"
import type { ComposeService } from "../compose-gen"
import { composeToYaml, generateComposeFromCatalog } from "../compose-gen"
import { parseGatewayConfigs } from "./gateway-config-parsers"

// ─── Env var interpolation ───────────────────────────────────

/**
 * Resolve `${VAR:-default}` and `${VAR-default}` patterns in a string,
 * matching docker compose behavior. Unresolvable vars become empty string.
 */
export function resolveComposeEnvVar(
  value: string,
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >
): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    // ${VAR:-default} — use default if unset or empty
    const colonDash = expr.indexOf(":-")
    if (colonDash !== -1) {
      const varName = expr.slice(0, colonDash)
      const defaultVal = expr.slice(colonDash + 2)
      return env[varName] || defaultVal
    }
    // ${VAR-default} — use default only if unset
    const dash = expr.indexOf("-")
    if (dash !== -1) {
      const varName = expr.slice(0, dash)
      const defaultVal = expr.slice(dash + 1)
      return env[varName] ?? defaultVal
    }
    // ${VAR:+alternate} — use alternate if set and non-empty
    const colonPlus = expr.indexOf(":+")
    if (colonPlus !== -1) {
      const varName = expr.slice(0, colonPlus)
      const altVal = expr.slice(colonPlus + 2)
      return env[varName] ? altVal : ""
    }
    // ${VAR} — simple substitution
    return env[expr] ?? ""
  })
}

/**
 * Resolve all env var references in a record of environment variables.
 */
function resolveEnvRecord(
  envMap: Record<string, string> | undefined,
  processEnv: Record<string, string | undefined>
): Record<string, string> {
  if (!envMap) return {}
  const resolved: Record<string, string> = {}
  for (const [key, value] of Object.entries(envMap)) {
    resolved[key] = resolveComposeEnvVar(value, processEnv)
  }
  return resolved
}

/**
 * Normalize environment from compose — handles both record and array forms.
 * Exported for use by compose-env-propagation module.
 */
export function normalizeEnvironment(env: unknown): Record<string, string> {
  if (!env) return {}
  if (Array.isArray(env)) {
    const result: Record<string, string> = {}
    for (const item of env) {
      const s = String(item)
      const eqIdx = s.indexOf("=")
      if (eqIdx > 0) {
        result[s.slice(0, eqIdx)] = s.slice(eqIdx + 1)
      } else {
        result[s] = ""
      }
    }
    return result
  }
  if (typeof env === "object") {
    const result: Record<string, string> = {}
    for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
      result[k] = v == null ? "" : String(v)
    }
    return result
  }
  return {}
}

// ─── Heuristics ──────────────────────────────────────────────

/** Well-known infrastructure images → resource type. */
const INFRA_IMAGE_PATTERNS: [RegExp, string][] = [
  [/^postgres/i, "database"],
  [/^postgis/i, "database"],
  [/^timescale/i, "database"],
  [/^mysql/i, "database"],
  [/^mariadb/i, "database"],
  [/^clickhouse/i, "database"],
  [/^mongo/i, "database"],
  [/^redis/i, "cache"],
  [/^valkey/i, "cache"],
  [/^memcached/i, "cache"],
  [/^rabbitmq/i, "queue"],
  [/^nats/i, "queue"],
  [/^kafka/i, "queue"],
  [/^zookeeper/i, "queue"],
  [/^minio/i, "storage"],
  [/^localstack/i, "storage"],
  [/^elasticsearch/i, "search"],
  [/^opensearch/i, "search"],
  [/^meilisearch/i, "search"],
  [/^solr/i, "search"],
  [/^traefik/i, "gateway"],
  [/^nginx/i, "gateway"],
  [/^envoy/i, "gateway"],
  [/^haproxy/i, "gateway"],
  [/^apisix/i, "gateway"],
  [/^kong/i, "gateway"],
  [/^pgbouncer/i, "database"],
  [/^pgpool/i, "database"],
  [/^mailhog/i, "other"],
  [/^adminer/i, "other"],
  [/^phpmyadmin/i, "other"],
]

function inferResourceTypeFromImage(image: string): string | null {
  // Strip registry/org prefix and tag: "asia-south2-docker.pkg.dev/org/docker/name:tag" → "name"
  const parts = image.split("/")
  const last = parts[parts.length - 1] ?? image
  const imageName = last.split(":")[0] ?? last
  for (const [pattern, type] of INFRA_IMAGE_PATTERNS) {
    if (pattern.test(imageName)) return type
  }
  return null
}

/** Well-known port numbers → protocol and name. */
const KNOWN_PORTS: Record<number, { name: string; protocol: string }> = {
  80: { name: "http", protocol: "http" },
  443: { name: "https", protocol: "https" },
  3000: { name: "http", protocol: "http" },
  5432: { name: "postgres", protocol: "tcp" },
  3306: { name: "mysql", protocol: "tcp" },
  6379: { name: "redis", protocol: "tcp" },
  5672: { name: "amqp", protocol: "tcp" },
  15672: { name: "management", protocol: "http" },
  27017: { name: "mongodb", protocol: "tcp" },
  9200: { name: "http", protocol: "http" },
  9300: { name: "transport", protocol: "tcp" },
  8080: { name: "http", protocol: "http" },
  8443: { name: "https", protocol: "https" },
  4317: { name: "otlp-grpc", protocol: "grpc" },
  4318: { name: "otlp-http", protocol: "http" },
  9090: { name: "http", protocol: "http" },
  9092: { name: "kafka", protocol: "tcp" },
  2181: { name: "zookeeper", protocol: "tcp" },
  8005: { name: "http", protocol: "http" },
  8181: { name: "http", protocol: "http" },
}

/** Map service name prefix → resource type. */
const NAME_TO_RESOURCE_TYPE: [string, string][] = [
  ["postgres", "database"],
  ["postgresql", "database"],
  ["pg", "database"],
  ["mysql", "database"],
  ["mariadb", "database"],
  ["mongo", "database"],
  ["mongodb", "database"],
  ["db", "database"],
  ["database", "database"],
  ["pgbouncer", "database"],
  ["pgpool", "database"],
  ["redis", "cache"],
  ["cache", "cache"],
  ["memcached", "cache"],
  ["valkey", "cache"],
  ["rabbitmq", "queue"],
  ["nats", "queue"],
  ["kafka", "queue"],
  ["zookeeper", "queue"],
  ["minio", "storage"],
  ["s3", "storage"],
  ["storage", "storage"],
  ["elasticsearch", "search"],
  ["opensearch", "search"],
  ["meilisearch", "search"],
  ["solr", "search"],
  ["traefik", "gateway"],
  ["nginx", "gateway"],
  ["envoy", "gateway"],
  ["haproxy", "gateway"],
  ["gateway", "gateway"],
  ["proxy", "gateway"],
  ["apisix", "gateway"],
  ["kong", "gateway"],
  ["mailhog", "other"],
  ["adminer", "other"],
]

function inferResourceTypeFromName(name: string): string | null {
  const lower = name.toLowerCase()
  for (const [prefix, type] of NAME_TO_RESOURCE_TYPE) {
    if (lower === prefix || lower.startsWith(`${prefix}-`)) return type
  }
  return null
}

/** Infra service names that imply a resource. */
const INFRA_NAME_PATTERNS = [
  "db",
  "database",
  "postgres",
  "postgresql",
  "pg",
  "mysql",
  "mariadb",
  "mongo",
  "mongodb",
  "redis",
  "cache",
  "memcached",
  "valkey",
  "rabbitmq",
  "nats",
  "kafka",
  "zookeeper",
  "minio",
  "s3",
  "storage",
  "elasticsearch",
  "opensearch",
  "meilisearch",
  "solr",
  "traefik",
  "nginx",
  "envoy",
  "haproxy",
  "gateway",
  "proxy",
  "pgbouncer",
  "pgpool",
  "mailhog",
  "adminer",
  "apisix",
  "kong",
]

// ─── Init container detection ───────────────────────────────

const INIT_NAME_SUFFIXES = [
  "-init",
  "-migrate",
  "-migration",
  "-setup",
  "-bootstrap",
]

/**
 * Detect whether a service is a one-shot init/migration container.
 *
 * Signals (all require restart:"no"):
 *   - Name matches an init suffix pattern
 *   - No ports AND has depends_on (portless standalone containers are not init containers)
 *   - Other services depend on this via service_completed_successfully
 * Label `dx.type: init` is an explicit opt-in override (no restart check needed).
 */
function isInitContainer(
  name: string,
  svc: ComposeService,
  completedSuccessfullyDependents: Set<string>
): boolean {
  // Explicit label override
  const labels = svc.labels ?? {}
  if (labels["dx.type"] === "init") return true

  // Must have restart: "no" (or unset which defaults to "no" in compose,
  // but we only match explicit "no" to avoid false positives)
  if (svc.restart !== "no") return false

  // Name matches init pattern
  const lowerName = name.toLowerCase()
  if (INIT_NAME_SUFFIXES.some((s) => lowerName.endsWith(s))) return true

  // No exposed ports AND has depends_on — portless standalone containers are
  // not init containers, but a portless service that depends on something else
  // almost certainly runs against that dependency and exits
  const hasDeps =
    svc.depends_on != null &&
    (Array.isArray(svc.depends_on)
      ? svc.depends_on.length > 0
      : Object.keys(svc.depends_on).length > 0)
  if (!svc.ports?.length && hasDeps) return true

  // Other services depend on this via service_completed_successfully
  if (completedSuccessfullyDependents.has(name)) return true

  return false
}

/**
 * Resolve which service an init container initializes.
 * Returns the parent service name or undefined if unresolvable.
 */
function resolveInitParent(
  name: string,
  svc: ComposeService,
  allServices: Record<string, ComposeService>,
  initNames: Set<string>
): string | undefined {
  // 1. Explicit label
  const labels = svc.labels ?? {}
  if (labels["dx.initFor"]) return labels["dx.initFor"]

  // 2. Same image match — find a non-init service with the same image
  if (svc.image) {
    const baseImage = svc.image.split(":")[0]
    for (const [otherName, otherSvc] of Object.entries(allServices)) {
      if (otherName === name || initNames.has(otherName)) continue
      if (otherSvc.image && otherSvc.image.split(":")[0] === baseImage) {
        return otherName
      }
    }
  }

  // 3. Name prefix match — strip the init suffix and check if remainder is a service
  const lowerName = name.toLowerCase()
  for (const suffix of INIT_NAME_SUFFIXES) {
    if (lowerName.endsWith(suffix)) {
      const prefix = name.slice(0, -suffix.length)
      if (prefix && allServices[prefix] && !initNames.has(prefix)) {
        return prefix
      }
    }
  }

  // 4. Dependent analysis — which non-init service depends on us via service_completed_successfully?
  const parents: string[] = []
  for (const [otherName, otherSvc] of Object.entries(allServices)) {
    if (otherName === name || initNames.has(otherName)) continue
    const depOn = otherSvc.depends_on
    if (depOn && !Array.isArray(depOn)) {
      const cond = depOn[name]
      if (cond?.condition === "service_completed_successfully") {
        parents.push(otherName)
      }
    }
  }
  if (parents.length === 1) return parents[0]

  return undefined
}

/**
 * Build a set of service names that have at least one dependent
 * using `condition: service_completed_successfully`.
 */
function buildCompletedSuccessfullySet(
  services: Record<string, ComposeService>
): Set<string> {
  const result = new Set<string>()
  for (const svc of Object.values(services)) {
    const depOn = svc.depends_on
    if (depOn && !Array.isArray(depOn)) {
      for (const [depName, cond] of Object.entries(depOn)) {
        if (cond?.condition === "service_completed_successfully") {
          result.add(depName)
        }
      }
    }
  }
  return result
}

function classifyService(
  name: string,
  svc: ComposeService
): "component" | "resource" {
  // Labels can override classification
  const labels = svc.labels ?? {}
  if (labels["dx.kind"]) {
    return labels["dx.kind"].toLowerCase() === "resource"
      ? "resource"
      : "component"
  }

  // Name-based infra detection (overrides build: heuristic — a custom postgres
  // Dockerfile is still a database resource, not a component you build)
  const lowerName = name.toLowerCase()
  if (
    INFRA_NAME_PATTERNS.some(
      (n) => lowerName === n || lowerName.startsWith(`${n}-`)
    )
  ) {
    return "resource"
  }

  if (svc.build) return "component"

  if (svc.image) {
    const resourceType = inferResourceTypeFromImage(svc.image)
    if (resourceType) return "resource"
  }

  return "component"
}

// ─── Label conventions ───────────────────────────────────────
//
// All labels use the `dx.` prefix:
//
//   dx.kind: Component|Resource          — override classification
//   dx.type: service|worker|database|... — override inferred type
//   dx.owner: team-slug                  — set owner
//   dx.description: "..."                — description
//   dx.tags: "tag1,tag2"                 — comma-separated tags
//   dx.lifecycle: production|development  — lifecycle stage
//
//   dx.port.<container-port>.name: http   — name for a port
//   dx.port.<container-port>.protocol: grpc — protocol for a port
//
//   dx.api.provides: "my-api"            — APIs this component provides
//   dx.api.consumes: "other-api,auth-api" — APIs consumed
//   dx.api.type: openapi|grpc|graphql    — API type
//
//   dx.docs.url: "https://..."           — documentation link
//   dx.docs.api: "/api/docs"             — API docs path
//   dx.docs.runbook: "https://..."       — runbook link

interface ParsedLabels {
  catalogKind?: string
  catalogType?: string
  owner?: string
  description?: string
  tags?: string[]
  lifecycle?: string
  portOverrides: Record<
    number,
    { name?: string; protocol?: string; exposure?: string }
  >
  providesApis?: string[]
  consumesApis?: string[]
  apiType?: string
  links: Array<{ url: string; title: string; type?: string }>
  extraLabels: Record<string, string>
  // dx.* labels for dev workflow
  devCommand?: string
  devSync?: string[]
  testCommand?: string
  lintCommand?: string
  runtime?: string
  // dx.connection.* labels
  connections: Record<
    string,
    {
      module?: string
      component?: string
      envVar?: string
      localDefault?: string
    }
  >
  // dx.dep.<dep>.env.<var> labels — connection env var templates per dependency
  depEnv: Record<string, Record<string, string>>
  // dx.source.* labels — source linking metadata
  sourceRepo?: string
  sourcePath?: string
  sourceRequired?: boolean
}

/**
 * Parse `x-dx.dependencies[]` from docker-compose into CatalogSystemDependency[].
 * Accepts the shorthand string form (`"shared-auth"` → `{system: "shared-auth"}`)
 * or the full object form. Zod validates; invalid entries are dropped with a
 * warning rather than aborting the whole parse (one malformed dep shouldn't
 * take down catalog ingestion).
 */
function parseSystemDependencies(
  raw: unknown
): CatalogSystemDependency[] | undefined {
  if (!raw) return undefined
  if (!Array.isArray(raw)) return undefined
  const out: CatalogSystemDependency[] = []
  for (const entry of raw) {
    const candidate = typeof entry === "string" ? { system: entry } : entry
    const parsed = catalogSystemDependencySchema.safeParse(candidate)
    if (parsed.success) {
      out.push(parsed.data)
    } else {
      // Invalid dep entry — log but don't abort. x-dx.dependencies is
      // best-effort metadata; a typo shouldn't kill the catalog.
      console.warn(
        `x-dx.dependencies entry skipped: ${parsed.error.issues
          .map((i) => i.message)
          .join(", ")} (entry: ${JSON.stringify(candidate)})`
      )
    }
  }
  return out.length > 0 ? out : undefined
}

function parseLabels(labels: Record<string, string>): ParsedLabels {
  const result: ParsedLabels = {
    portOverrides: {},
    links: [],
    extraLabels: {},
    connections: {},
    depEnv: {},
  }

  for (const [key, value] of Object.entries(labels)) {
    if (key === "dx.kind") {
      result.catalogKind = value
    } else if (key === "dx.type") {
      result.catalogType = value
    } else if (key === "dx.owner") {
      result.owner = value
    } else if (key === "dx.description") {
      result.description = value
    } else if (key === "dx.tags") {
      result.tags = value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    } else if (key === "dx.lifecycle") {
      result.lifecycle = value
    } else if (key.startsWith("dx.port.")) {
      // dx.port.8080.name = "http"
      const rest = key.slice("dx.port.".length)
      const dotIdx = rest.indexOf(".")
      if (dotIdx > 0) {
        const port = parseInt(rest.slice(0, dotIdx), 10)
        const field = rest.slice(dotIdx + 1)
        if (!isNaN(port)) {
          result.portOverrides[port] ??= {}
          if (field === "name") result.portOverrides[port].name = value
          if (field === "protocol") result.portOverrides[port].protocol = value
          if (field === "exposure") result.portOverrides[port].exposure = value
        }
      }
    } else if (key === "dx.api.provides") {
      result.providesApis = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    } else if (key === "dx.api.consumes") {
      result.consumesApis = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    } else if (key === "dx.api.type") {
      result.apiType = value
    } else if (key === "dx.docs.url") {
      result.links.push({ url: value, title: "Documentation", type: "doc" })
    } else if (key === "dx.docs.api") {
      result.links.push({
        url: value,
        title: "API Documentation",
        type: "api-doc",
      })
    } else if (key === "dx.docs.runbook") {
      result.links.push({ url: value, title: "Runbook", type: "runbook" })
    } else if (key.startsWith("dx.connection.")) {
      // dx.connection.<name>.module = "auth"
      const rest = key.slice("dx.connection.".length)
      const dotIdx = rest.indexOf(".")
      if (dotIdx > 0) {
        const connName = rest.slice(0, dotIdx)
        const field = rest.slice(dotIdx + 1)
        result.connections[connName] ??= {}
        if (field === "module") result.connections[connName].module = value
        else if (field === "component")
          result.connections[connName].component = value
        else if (field === "env_var")
          result.connections[connName].envVar = value
        else if (field === "local_default")
          result.connections[connName].localDefault = value
      }
    } else if (key === "dx.source.repo") {
      result.sourceRepo = value
    } else if (key === "dx.source.path") {
      result.sourcePath = value
    } else if (key === "dx.source.required") {
      result.sourceRequired = value === "true"
    } else if (key === "dx.dev.command") {
      result.devCommand = value
    } else if (key === "dx.dev.sync") {
      result.devSync = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    } else if (key === "dx.test") {
      result.testCommand = value
    } else if (key === "dx.lint") {
      result.lintCommand = value
    } else if (key === "dx.runtime") {
      result.runtime = value
    } else if (key.startsWith("dx.dep.")) {
      // dx.dep.<depName>.env.<varName> = "{template}"
      const rest = key.slice("dx.dep.".length)
      const parts = rest.split(".")
      // Expected: ["infra-postgres", "env", "MB_DB_HOST"]
      if (parts.length >= 3 && parts[1] === "env") {
        const depName = parts[0]!
        const varName = parts.slice(2).join(".") // handle dots in var names
        result.depEnv[depName] ??= {}
        result.depEnv[depName][varName] = value
      }
    } else {
      // Preserve non-dx labels
      result.extraLabels[key] = value
    }
  }

  return result
}

// ─── Connection inference ────────────────────────────────────

/** Well-known env var patterns that reference other services. */
const CONNECTION_ENV_PATTERNS: Array<{
  pattern: RegExp
  protocol: string
  resourceType: string
}> = [
  {
    pattern: /(?:^|_)(?:DATABASE_URL|DB_URL|POSTGRES_URL|PG_URL)$/i,
    protocol: "postgresql",
    resourceType: "database",
  },
  {
    pattern: /(?:^|_)(?:REDIS_URL|REDIS_URI|CACHE_URL)$/i,
    protocol: "redis",
    resourceType: "cache",
  },
  {
    pattern: /(?:^|_)(?:RABBITMQ_URL|AMQP_URL|RABBIT_URL)$/i,
    protocol: "amqp",
    resourceType: "queue",
  },
  {
    pattern: /(?:^|_)(?:MONGO_URL|MONGO_URI|MONGODB_URI)$/i,
    protocol: "mongodb",
    resourceType: "database",
  },
  {
    pattern: /(?:^|_)(?:KAFKA_BROKERS?|KAFKA_URL)$/i,
    protocol: "kafka",
    resourceType: "queue",
  },
  {
    pattern: /(?:^|_)(?:ELASTICSEARCH_URL|ES_URL|OPENSEARCH_URL)$/i,
    protocol: "http",
    resourceType: "search",
  },
]

interface InferredConnection {
  name: string
  fromService: string
  toService: string
  envVar: string
  envValue: string
}

/**
 * Extract the service name referenced in a connection string.
 * E.g. "postgres://user:pass@my-db:5432/dbname" → "my-db"
 */
function extractHostFromUrl(url: string): string | null {
  try {
    // Handle protocol-less URLs
    const normalized = url.includes("://") ? url : `proto://${url}`
    const parsed = new URL(normalized)
    return parsed.hostname || null
  } catch {
    return null
  }
}

function inferConnections(
  services: Record<string, ComposeService>,
  resolvedEnvs: Record<string, Record<string, string>>
): InferredConnection[] {
  const serviceNames = new Set(Object.keys(services))
  const connections: InferredConnection[] = []

  for (const [svcName, env] of Object.entries(resolvedEnvs)) {
    for (const [envKey, envValue] of Object.entries(env)) {
      // Check if env var matches known patterns
      for (const { pattern } of CONNECTION_ENV_PATTERNS) {
        if (!pattern.test(envKey)) continue
        const host = extractHostFromUrl(envValue)
        if (host && serviceNames.has(host)) {
          connections.push({
            name: envKey
              .toLowerCase()
              .replace(/_url$/i, "")
              .replace(/_uri$/i, ""),
            fromService: svcName,
            toService: host,
            envVar: envKey,
            envValue,
          })
        }
        break
      }

      // Also check for simple http(s) URLs pointing at other services
      if (envValue.startsWith("http://") || envValue.startsWith("https://")) {
        const host = extractHostFromUrl(envValue)
        if (host && serviceNames.has(host) && host !== svcName) {
          // Avoid duplicates from known patterns
          if (
            !connections.some(
              (c) => c.fromService === svcName && c.envVar === envKey
            )
          ) {
            connections.push({
              name: envKey.toLowerCase().replace(/_url$/i, ""),
              fromService: svcName,
              toService: host,
              envVar: envKey,
              envValue,
            })
          }
        }
      }
    }
  }

  return connections
}

// ─── Dep env auto-detection (convention) ─────────────────────

/**
 * Auto-detect env vars that reference a dependency's Docker hostname
 * in a URL pattern. Returns raw (unresolved) template strings.
 *
 * Convention: if a service's env var value contains a depends_on service
 * hostname in a URL-like pattern (postgres://, redis://, http://),
 * it's a connection env var for that dependency.
 */
function autoDetectDepEnv(
  rawEnv: Record<string, string>,
  dependsOn: string[],
  explicitDepEnv: Record<string, Record<string, string>>
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {}
  if (dependsOn.length === 0) return result

  const depSet = new Set(dependsOn)

  for (const [envKey, envValue] of Object.entries(rawEnv)) {
    for (const dep of depSet) {
      // Skip if explicit labels already define this dep's env mapping
      if (explicitDepEnv[dep]) continue

      // Check if the value references this dep's hostname
      if (envValue.includes(dep)) {
        result[dep] ??= {}
        result[dep][envKey] = envValue
      }
    }
  }

  return result
}

// ─── Port parsing ────────────────────────────────────────────

function parsePort(
  portStr: string
): { host: number; container: number } | null {
  // First resolve any env var interpolation to get the default
  const resolved = resolveComposeEnvVar(portStr)
  // Strip protocol suffix (e.g. "/tcp", "/udp")
  const clean = resolved.replace(/\/.*$/, "")
  const parts = clean.split(":")

  if (parts.length === 1) {
    const p = parseInt(parts[0]!, 10)
    return isNaN(p) ? null : { host: p, container: p }
  }
  if (parts.length === 2) {
    const host = parseInt(parts[0]!, 10)
    const container = parseInt(parts[1]!, 10)
    return isNaN(host) || isNaN(container) ? null : { host, container }
  }
  if (parts.length === 3) {
    // ip:host:container
    const host = parseInt(parts[1]!, 10)
    const container = parseInt(parts[2]!, 10)
    return isNaN(host) || isNaN(container) ? null : { host, container }
  }
  return null
}

function parsePorts(
  portStrings: string[],
  labelOverrides: Record<
    number,
    { name?: string; protocol?: string; exposure?: string }
  >
): CatalogPort[] {
  const ports: CatalogPort[] = []
  const usedNames = new Set<string>()

  for (const ps of portStrings) {
    const parsed = parsePort(typeof ps === "string" ? ps : String(ps))
    if (!parsed) continue

    // Determine name and protocol from: labels > known ports > generic
    const override = labelOverrides[parsed.container]
    const known = KNOWN_PORTS[parsed.container]

    let name = override?.name ?? known?.name ?? `port-${parsed.container}`
    const protocol = (override?.protocol ??
      known?.protocol ??
      "tcp") as CatalogPort["protocol"]
    const exposure = override?.exposure as CatalogPort["exposure"]

    // Ensure unique names
    if (usedNames.has(name)) {
      name = `${name}-${parsed.container}`
    }
    usedNames.add(name)

    const port: CatalogPort = { name, port: parsed.host, protocol }
    if (exposure) port.exposure = exposure
    ports.push(port)
  }

  return ports
}

// ─── Service converters ──────────────────────────────────────

function serviceToComponent(
  name: string,
  svc: ComposeService,
  labels: ParsedLabels
): CatalogComponent {
  const ports = parsePorts(svc.ports ?? [], labels.portOverrides)

  // Dev workflow: only use explicit dx.dev.command label.
  // Do NOT fall back to Docker's command: field — that's a container
  // entrypoint override, not a dev command.
  const devCommand = labels.devCommand
  const dev =
    devCommand || labels.devSync
      ? { command: devCommand, sync: labels.devSync }
      : undefined

  const annotations: Record<string, string> = {}
  if (labels.sourceRepo) annotations["dx.dev/source-repo"] = labels.sourceRepo
  if (labels.sourcePath) annotations["dx.dev/source-path"] = labels.sourcePath

  return {
    kind: "Component",
    metadata: {
      name,
      namespace: "default",
      description: labels.description,
      labels: Object.keys(labels.extraLabels).length
        ? labels.extraLabels
        : undefined,
      annotations: Object.keys(annotations).length ? annotations : undefined,
      tags: labels.tags,
      links: labels.links.length ? labels.links : undefined,
    },
    spec: {
      type: labels.catalogType ?? "service",
      lifecycle: (labels.lifecycle ?? "production") as CatalogLifecycle,
      owner: labels.owner,
      image: svc.image,
      build: svc.build
        ? {
            context: svc.build.context,
            dockerfile: svc.build.dockerfile,
            args: svc.build.args,
          }
        : undefined,
      ports,
      environment: svc.environment ?? {},
      providesApis: labels.providesApis,
      consumesApis: labels.consumesApis,
      dependsOn: extractDependsOn(svc),
      dev,
      test: labels.testCommand,
      lint: labels.lintCommand,
      runtime: labels.runtime as "node" | "python" | "java" | undefined,
      profiles: svc.profiles,
      depEnv: buildDepEnv(svc, labels),
    },
  }
}

function serviceToResource(
  name: string,
  svc: ComposeService,
  labels: ParsedLabels
): CatalogResource {
  const ports = parsePorts(svc.ports ?? [], labels.portOverrides)
  const firstPort = ports[0]
  const firstRawPort = svc.ports?.[0]
  const firstParsed = firstRawPort
    ? parsePort(
        typeof firstRawPort === "string" ? firstRawPort : String(firstRawPort)
      )
    : null

  const VALID_RESOURCE_TYPES = new Set([
    "database",
    "cache",
    "queue",
    "gateway",
    "storage",
    "search",
    "auth-provider",
    "other",
  ])
  const inferredType =
    (svc.image ? inferResourceTypeFromImage(svc.image) : null) ??
    inferResourceTypeFromName(name) ??
    "database"
  // Only use label type if it's a valid resource type — ignore component types like "service"
  const resourceType =
    labels.catalogType && VALID_RESOURCE_TYPES.has(labels.catalogType)
      ? labels.catalogType
      : inferredType

  const annotations: Record<string, string> = {}
  if (labels.sourceRepo) annotations["dx.dev/source-repo"] = labels.sourceRepo
  if (labels.sourcePath) annotations["dx.dev/source-path"] = labels.sourcePath

  return {
    kind: "Resource",
    metadata: {
      name,
      namespace: "default",
      description: labels.description,
      labels: Object.keys(labels.extraLabels).length
        ? labels.extraLabels
        : undefined,
      annotations: Object.keys(annotations).length ? annotations : undefined,
      tags: labels.tags,
      links: labels.links.length ? labels.links : undefined,
    },
    spec: {
      type: resourceType,
      lifecycle: (labels.lifecycle ?? "production") as CatalogLifecycle,
      owner: labels.owner,
      image: svc.image ?? "",
      ports,
      containerPort:
        firstParsed && firstParsed.container !== firstParsed.host
          ? firstParsed.container
          : undefined,
      environment: svc.environment ?? {},
      volumes: svc.volumes,
      healthcheck:
        typeof svc.healthcheck?.test === "string"
          ? svc.healthcheck.test
          : Array.isArray(svc.healthcheck?.test)
            ? svc.healthcheck!.test.slice(1).join(" ")
            : undefined,
      profiles: svc.profiles,
      depEnv: buildDepEnv(svc, labels),
    },
  }
}

/** Merge explicit dx.dep labels with convention auto-detected env vars. */
function buildDepEnv(
  svc: ComposeService,
  labels: ParsedLabels
): Record<string, Record<string, string>> | undefined {
  const dependsOn = extractDependsOn(svc) ?? []
  const explicit = labels.depEnv
  // Use raw (unresolved) env for auto-detection so ${VAR:-default} patterns
  // are preserved as templates for later resolution with profile vars.
  const detected = autoDetectDepEnv(
    svc.rawEnvironment ?? svc.environment ?? {},
    dependsOn,
    explicit
  )
  const merged = { ...detected, ...explicit } // explicit wins
  return Object.keys(merged).length > 0 ? merged : undefined
}

/**
 * Extract depends_on service names as entity references.
 */
function extractDependsOn(svc: ComposeService): string[] | undefined {
  if (!svc.depends_on) return undefined
  if (Array.isArray(svc.depends_on)) {
    return svc.depends_on.length ? svc.depends_on : undefined
  }
  // Object form: { service: { condition: ... } }
  const keys = Object.keys(svc.depends_on)
  return keys.length ? keys : undefined
}

// ─── Normalize compose YAML ──────────────────────────────────

/**
 * Normalize raw YAML-parsed compose data into typed ComposeService records.
 * Handles both array and object forms for environment, depends_on, and labels.
 */
function normalizeServices(
  raw: Record<string, Record<string, unknown>>,
  processEnv: Record<string, string | undefined>
): Record<string, ComposeService> {
  const result: Record<string, ComposeService> = {}

  for (const [name, rawSvc] of Object.entries(raw)) {
    const env = normalizeEnvironment(rawSvc.environment)
    const resolvedEnv = resolveEnvRecord(env, processEnv)

    // Normalize labels (can be array or object)
    let labels: Record<string, string> | undefined
    if (Array.isArray(rawSvc.labels)) {
      labels = {}
      for (const item of rawSvc.labels) {
        const s = String(item)
        const eqIdx = s.indexOf("=")
        if (eqIdx > 0) labels[s.slice(0, eqIdx)] = s.slice(eqIdx + 1)
      }
    } else if (rawSvc.labels && typeof rawSvc.labels === "object") {
      labels = {}
      for (const [k, v] of Object.entries(
        rawSvc.labels as Record<string, unknown>
      )) {
        labels[k] = v == null ? "" : String(v)
      }
    }

    // Normalize ports — resolve env vars in port strings
    const rawPorts = (rawSvc.ports ?? []) as Array<
      string | number | Record<string, unknown>
    >
    const ports = rawPorts.map((p) => {
      if (typeof p === "number") return String(p)
      if (typeof p === "string") return resolveComposeEnvVar(p, processEnv)
      // Long-form port syntax
      if (typeof p === "object" && p !== null) {
        const target = (p as Record<string, unknown>).target
        const published = (p as Record<string, unknown>).published
        if (target != null) {
          return published != null ? `${published}:${target}` : String(target)
        }
      }
      return String(p)
    })

    // Normalize image — resolve env vars
    const image = rawSvc.image
      ? resolveComposeEnvVar(String(rawSvc.image), processEnv)
      : undefined

    // Normalize build
    let build: ComposeService["build"]
    if (typeof rawSvc.build === "string") {
      build = { context: rawSvc.build }
    } else if (rawSvc.build && typeof rawSvc.build === "object") {
      const b = rawSvc.build as Record<string, unknown>
      build = {
        context: String(b.context ?? "."),
        dockerfile: b.dockerfile ? String(b.dockerfile) : undefined,
        args: b.args ? normalizeEnvironment(b.args) : undefined,
      }
    }

    // Normalize depends_on
    let dependsOn: ComposeService["depends_on"]
    if (Array.isArray(rawSvc.depends_on)) {
      dependsOn = rawSvc.depends_on.map(String)
    } else if (rawSvc.depends_on && typeof rawSvc.depends_on === "object") {
      dependsOn = rawSvc.depends_on as Record<string, { condition?: string }>
    }

    // Normalize command
    let command: ComposeService["command"]
    if (rawSvc.command != null) {
      command = Array.isArray(rawSvc.command)
        ? rawSvc.command.map(String)
        : String(rawSvc.command)
    }

    // Normalize healthcheck
    let healthcheck: ComposeService["healthcheck"]
    if (rawSvc.healthcheck && typeof rawSvc.healthcheck === "object") {
      const hc = rawSvc.healthcheck as Record<string, unknown>
      healthcheck = {
        test: hc.test as string[] | string,
        interval: hc.interval ? String(hc.interval) : undefined,
        timeout: hc.timeout ? String(hc.timeout) : undefined,
        retries: typeof hc.retries === "number" ? hc.retries : undefined,
      }
    }

    // Normalize volumes
    const volumes = rawSvc.volumes
      ? (rawSvc.volumes as unknown[]).map((v) => {
          if (typeof v === "string") return v
          // Long-form volume
          if (typeof v === "object" && v !== null) {
            const vol = v as Record<string, unknown>
            const src = vol.source ? String(vol.source) : ""
            const tgt = vol.target ? String(vol.target) : ""
            const ro = vol.read_only ? ":ro" : ""
            return src ? `${src}:${tgt}${ro}` : tgt
          }
          return String(v)
        })
      : undefined

    // Normalize profiles
    const profiles = Array.isArray(rawSvc.profiles)
      ? rawSvc.profiles.map(String)
      : undefined

    result[name] = {
      image,
      build,
      ports,
      environment: resolvedEnv,
      rawEnvironment: env,
      depends_on: dependsOn,
      volumes,
      command,
      healthcheck,
      labels,
      platform: rawSvc.platform ? String(rawSvc.platform) : undefined,
      restart: rawSvc.restart ? String(rawSvc.restart) : undefined,
      profiles,
    }
  }

  return result
}

// ─── Deep merge for compose services ─────────────────────────

/**
 * Keys in a compose service whose values are arrays and should be
 * concatenated (with deduplication) rather than replaced.
 */
const COMPOSE_ARRAY_KEYS = new Set([
  "ports",
  "volumes",
  "expose",
  "dns",
  "dns_search",
  "extra_hosts",
  "external_links",
  "security_opt",
  "cap_add",
  "cap_drop",
  "devices",
  "tmpfs",
  "sysctls",
  "configs",
  "secrets",
  "networks",
])

/**
 * Keys in a compose service whose values are objects and should be
 * recursively merged (key-by-key, last wins per key).
 */
const COMPOSE_OBJECT_KEYS = new Set([
  "environment",
  "labels",
  "build",
  "healthcheck",
  "logging",
  "deploy",
  "ulimits",
])

/**
 * Deep-merge two compose service definitions following Docker Compose semantics:
 * - Scalars: override wins
 * - Objects (environment, labels, build, etc.): merge keys recursively
 * - Arrays (ports, volumes, etc.): concatenate and deduplicate
 * - depends_on: merge (supports both array and object forms)
 */
function deepMergeComposeService(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }

  for (const [key, overrideVal] of Object.entries(override)) {
    const baseVal = result[key]

    // No base value — just take override
    if (baseVal === undefined || baseVal === null) {
      result[key] = overrideVal
      continue
    }

    // Known array keys — always concatenate+deduplicate, even if one side isn't an array yet
    if (COMPOSE_ARRAY_KEYS.has(key)) {
      const baseArr = Array.isArray(baseVal) ? baseVal : [baseVal]
      const overArr = Array.isArray(overrideVal) ? overrideVal : [overrideVal]
      const seen = new Set(baseArr.map((v: unknown) => JSON.stringify(v)))
      const merged = [...baseArr]
      for (const item of overArr) {
        const k = JSON.stringify(item)
        if (!seen.has(k)) {
          seen.add(k)
          merged.push(item)
        }
      }
      result[key] = merged
      continue
    }

    // Known object keys — always deep-merge, even if runtime types are mismatched
    if (
      COMPOSE_OBJECT_KEYS.has(key) &&
      isPlainObject(baseVal) &&
      isPlainObject(overrideVal)
    ) {
      result[key] = deepMergeComposeService(
        baseVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>
      )
      continue
    }

    // Both are arrays (non-compose keys) — concatenate and deduplicate
    if (Array.isArray(baseVal) && Array.isArray(overrideVal)) {
      const seen = new Set(baseVal.map((v: unknown) => JSON.stringify(v)))
      const merged = [...baseVal]
      for (const item of overrideVal) {
        const k = JSON.stringify(item)
        if (!seen.has(k)) {
          seen.add(k)
          merged.push(item)
        }
      }
      result[key] = merged
      continue
    }

    // Both are plain objects (non-compose keys) — recursive merge
    if (isPlainObject(baseVal) && isPlainObject(overrideVal)) {
      result[key] = deepMergeComposeService(
        baseVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>
      )
      continue
    }

    // All other cases — override wins (scalar replacement)
    result[key] = overrideVal
  }

  return result
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val)
}

/**
 * Merge multiple compose service maps with deep-merge semantics.
 * For each service that appears in multiple files, fields are deep-merged
 * following Docker Compose override rules.
 */
function mergeComposeServiceMaps(
  ...maps: Record<string, Record<string, unknown>>[]
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {}
  for (const map of maps) {
    for (const [name, service] of Object.entries(map)) {
      if (result[name]) {
        result[name] = deepMergeComposeService(result[name], service) as Record<
          string,
          unknown
        >
      } else {
        result[name] = { ...service }
      }
    }
  }
  return result
}

// ─── Compose file discovery ──────────────────────────────────

const COMPOSE_FILE_NAMES = [
  "docker-compose.yaml",
  "docker-compose.yml",
  "compose.yaml",
  "compose.yml",
]

/** Matches docker-compose*.yaml, docker-compose*.yml, compose*.yaml, compose*.yml */
const COMPOSE_GLOB_RE = /^(docker-)?compose([.-].*)?\.ya?ml$/

export interface ComposeDiscoveryOptions {
  /** Explicit file list from package.json#dx.compose — overrides all auto-discovery */
  explicitFiles?: string[]
  /** Current environment name (defaults to "local"). Filters x-dx.environment annotations. */
  environment?: string
}

/**
 * Check whether a compose file should be included based on its x-dx annotation.
 * Files with `x-dx.overlay: true` or a non-matching `x-dx.environment` are excluded.
 */
function shouldIncludeComposeFile(
  filePath: string,
  environment: string
): boolean {
  try {
    const raw = readFileSync(filePath, "utf-8")
    const data = parseYaml(raw) as Record<string, unknown>
    if (!data || typeof data !== "object") return true

    const xDx = data["x-dx"] as Record<string, unknown> | undefined
    if (!xDx || typeof xDx !== "object") return true

    if (xDx.overlay === true) return false
    if (typeof xDx.environment === "string" && xDx.environment !== environment)
      return false

    return true
  } catch {
    // If we can't parse, include it — let the main parse() report the error
    return true
  }
}

/**
 * Discover compose files in a directory.
 *
 * Precedence:
 * 1. options.explicitFiles (from package.json#dx.compose) — use exactly those
 * 2. compose/ folder (globbed, sorted alphabetically)
 * 3. Auto-glob at root: all docker-compose*.yaml / compose*.yaml files,
 *    filtered by x-dx annotations (overlay, environment)
 */
export function discoverComposeFiles(
  rootDir: string,
  options?: ComposeDiscoveryOptions
): string[] {
  const environment = options?.environment ?? "local"

  // 1. Explicit file list from dx config — overrides all auto-discovery
  if (options?.explicitFiles && options.explicitFiles.length > 0) {
    const resolved: string[] = []
    for (const f of options.explicitFiles) {
      const candidate = join(rootDir, f)
      if (existsSync(candidate)) {
        resolved.push(candidate)
      } else {
        console.warn(
          `[dx] compose file not found: ${f} (listed in package.json#dx.compose)`
        )
      }
    }
    return resolved
  }

  // 2. Check for compose/ directory
  const composeDir = join(rootDir, "compose")
  if (existsSync(composeDir)) {
    try {
      const entries = readdirSync(composeDir)
        .filter((f) => /\.ya?ml$/.test(f))
        .sort()
      if (entries.length > 0) {
        return entries.map((f) => join(composeDir, f))
      }
    } catch {
      // Fall through to auto-glob
    }
  }

  // 3. Auto-glob: discover all compose files at root
  try {
    const entries = readdirSync(rootDir)
      .filter((f) => COMPOSE_GLOB_RE.test(f))
      .sort()
    const files = entries
      .map((f) => join(rootDir, f))
      .filter((f) => shouldIncludeComposeFile(f, environment))

    // 4. Append source override file if it exists (optional source links)
    const sourceOverride = join(
      rootDir,
      ".dx",
      "generated",
      "compose-source-overrides.yml"
    )
    if (existsSync(sourceOverride)) {
      files.push(sourceOverride)
    }

    return files
  } catch {
    return []
  }
}

/**
 * Lightweight check: does a directory contain any compose files?
 * Unlike discoverComposeFiles, this does NOT parse YAML to check x-dx annotations.
 * Used by findComposeRoot to avoid reading files at every directory level.
 */
function hasComposeFiles(rootDir: string): boolean {
  // Check compose/ directory
  const composeDir = join(rootDir, "compose")
  if (existsSync(composeDir)) {
    try {
      if (readdirSync(composeDir).some((f) => /\.ya?ml$/.test(f))) return true
    } catch {
      /* fall through */
    }
  }
  // Check root for any matching compose filenames
  try {
    return readdirSync(rootDir).some((f) => COMPOSE_GLOB_RE.test(f))
  } catch {
    return false
  }
}

/**
 * Walk up from startDir to find a directory containing compose files.
 * Returns the root directory or null.
 *
 * Uses a fast existence check while walking, then validates with full
 * discovery (including x-dx annotation filtering) only at the candidate.
 */
export function findComposeRoot(
  startDir: string,
  options?: ComposeDiscoveryOptions
): string | null {
  // When explicit files are provided, walk up and check those specific files
  if (options?.explicitFiles && options.explicitFiles.length > 0) {
    let dir = startDir
    for (;;) {
      if (options.explicitFiles.some((f) => existsSync(join(dir, f))))
        return dir
      const parent = dirname(dir)
      if (parent === dir) return null
      dir = parent
    }
  }

  // Walk up using lightweight check, then validate with full discovery
  let dir = startDir
  for (;;) {
    if (hasComposeFiles(dir)) {
      // Validate: after annotation filtering, are there actually files?
      if (discoverComposeFiles(dir, options).length > 0) return dir
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

// ─── Adapter ─────────────────────────────────────────────────

export class DockerComposeFormatAdapter implements CatalogFormatAdapter {
  readonly format = "docker-compose" as const

  detect(rootDir: string, options?: ComposeDiscoveryOptions): boolean {
    return discoverComposeFiles(rootDir, options).length > 0
  }

  parse(
    rootDir: string,
    options?: {
      env?: Record<string, string | undefined>
      compose?: ComposeDiscoveryOptions
    }
  ): CatalogParseResult {
    const composeFiles = discoverComposeFiles(rootDir, options?.compose)
    if (composeFiles.length === 0) {
      throw new Error(`No docker-compose file found in ${rootDir}`)
    }

    const processEnv =
      options?.env ?? (process.env as Record<string, string | undefined>)
    const warnings: string[] = []

    // Merge services and extensions from all compose files (deep merge)
    let mergedRawServices: Record<string, Record<string, unknown>> = {}
    let xDxSystem: Record<string, unknown> | undefined
    let xConnections: Record<string, Record<string, unknown>> | undefined

    for (const filePath of composeFiles) {
      const raw = readFileSync(filePath, "utf-8")
      const data = parseYaml(raw) as Record<string, unknown>
      if (!data) continue

      const rawServices = (data.services ?? {}) as Record<
        string,
        Record<string, unknown>
      >
      mergedRawServices = mergeComposeServiceMaps(
        mergedRawServices,
        rawServices
      )

      // x-dx system metadata: first file that has name/owner/description wins
      if (!xDxSystem) {
        const xDx = data["x-dx"] as Record<string, unknown> | undefined
        if (xDx && typeof xDx === "object" && xDx.name) {
          xDxSystem = xDx
        }
      }
      // x-connections: merge across files
      if (data["x-connections"] && typeof data["x-connections"] === "object") {
        xConnections = {
          ...xConnections,
          ...(data["x-connections"] as Record<string, Record<string, unknown>>),
        }
      }
    }

    const services = normalizeServices(mergedRawServices, processEnv)

    // Detect init containers before classification
    const completedSuccessfullySet = buildCompletedSuccessfullySet(services)
    const initNames = new Set<string>()
    for (const [name, svc] of Object.entries(services)) {
      if (isInitContainer(name, svc, completedSuccessfullySet)) {
        initNames.add(name)
      }
    }
    // Resolve init parents (needs full initNames set)
    const initParents = new Map<string, string>()
    for (const name of initNames) {
      const parent = resolveInitParent(
        name,
        services[name]!,
        services,
        initNames
      )
      if (parent) initParents.set(name, parent)
    }

    const components: Record<string, CatalogComponent> = {}
    const resources: Record<string, CatalogResource> = {}

    // Classify and convert services
    for (const [name, svc] of Object.entries(services)) {
      const labels = parseLabels(svc.labels ?? {})

      // Init containers are always components with type "init"
      if (initNames.has(name)) {
        const comp = serviceToComponent(name, svc, labels)
        comp.spec.type = "init"
        const parent = initParents.get(name)
        if (parent) comp.spec.initFor = parent
        components[name] = comp
        continue
      }

      const kind = classifyService(name, svc)
      if (kind === "resource") {
        resources[name] = serviceToResource(name, svc, labels)
      } else {
        components[name] = serviceToComponent(name, svc, labels)
      }
    }

    // Parse gateway config files for routing targets
    for (const [name, resource] of Object.entries(resources)) {
      if (resource.spec.type !== "gateway") continue
      const svc = services[name]
      if (!svc?.volumes?.length) continue
      const targets = parseGatewayConfigs(svc.image ?? "", svc.volumes, rootDir)
      if (targets.length > 0) {
        resource.spec.gatewayTargets = targets
      }
    }

    // Build connections from multiple sources

    // 1. Infer connections from env vars referencing other services
    const resolvedEnvs: Record<string, Record<string, string>> = {}
    for (const [name, svc] of Object.entries(services)) {
      resolvedEnvs[name] = svc.environment ?? {}
    }
    const inferredConnections = inferConnections(services, resolvedEnvs)

    // 2. Connections from x-connections top-level extension
    const explicitConnections: CatalogConnection[] = []
    if (xConnections) {
      for (const [connName, conn] of Object.entries(xConnections)) {
        if (!conn || typeof conn !== "object") continue
        explicitConnections.push({
          name: connName,
          targetModule: conn.module ? String(conn.module) : basename(rootDir),
          targetComponent: conn.component ? String(conn.component) : connName,
          envVar: conn.env_var
            ? String(conn.env_var)
            : `${connName.toUpperCase()}_URL`,
          localDefault: conn.local_default
            ? String(conn.local_default)
            : undefined,
          optional: conn.optional === true ? true : undefined,
        })
      }
    }

    // 3. Connections from dx.connection.* labels on services
    for (const [, svc] of Object.entries(services)) {
      const labels = parseLabels(svc.labels ?? {})
      for (const [connName, conn] of Object.entries(labels.connections)) {
        if (!conn.envVar) continue // need at least env_var
        explicitConnections.push({
          name: connName,
          targetModule: conn.module ?? basename(rootDir),
          targetComponent: conn.component ?? connName,
          envVar: conn.envVar,
          localDefault: conn.localDefault,
        })
      }
    }

    // Merge: explicit connections override inferred ones by envVar
    const systemName = xDxSystem?.name
      ? String(xDxSystem.name)
      : basename(rootDir)
    const explicitEnvVars = new Set(explicitConnections.map((c) => c.envVar))
    const connections: CatalogConnection[] = [
      ...explicitConnections,
      ...inferredConnections
        .filter((c) => !explicitEnvVars.has(c.envVar))
        .map((c) => ({
          name: c.name,
          targetModule: systemName,
          targetComponent: c.toService,
          envVar: c.envVar,
          localDefault: c.envValue,
        })),
    ]

    // Aggregate APIs from dx.api.provides labels across services.
    // Each unique API name becomes a CatalogAPI entity owned by the providing
    // component. If multiple services provide the same API name, the first
    // provider wins (later ones are silently merged).
    const apis: Record<string, CatalogAPI> = {}
    for (const [name, svc] of Object.entries(services)) {
      const labels = parseLabels(svc.labels ?? {})
      if (!labels.providesApis?.length) continue
      const apiType = (labels.apiType ??
        "openapi") as CatalogAPI["spec"]["type"]
      for (const apiName of labels.providesApis) {
        if (apis[apiName]) continue
        apis[apiName] = {
          kind: "API",
          metadata: {
            name: apiName,
            namespace: "default",
            description: `API provided by ${name}`,
          },
          spec: {
            type: apiType,
            lifecycle: (labels.lifecycle ?? "production") as CatalogLifecycle,
            owner: labels.owner,
            definition: "",
          },
        }
      }
    }

    // System-level metadata from x-dx, falling back to labels
    let systemOwner = xDxSystem?.owner ? String(xDxSystem.owner) : undefined
    if (!systemOwner) {
      for (const svc of Object.values(services)) {
        const ownerLabel = svc.labels?.["dx.owner"]
        if (ownerLabel) {
          systemOwner = ownerLabel
          break
        }
      }
    }

    // Build system-level annotations from x-dx
    const systemAnnotations: Record<string, string> = {}
    if (xDxSystem?.repo) {
      systemAnnotations["backstage.io/source-location"] =
        `url:${String(xDxSystem.repo)}`
    }

    const system: CatalogSystem = {
      kind: "System",
      metadata: {
        name: systemName,
        namespace: "default",
        description: xDxSystem?.description
          ? String(xDxSystem.description)
          : undefined,
        annotations:
          Object.keys(systemAnnotations).length > 0
            ? systemAnnotations
            : undefined,
        tags: xDxSystem?.tags
          ? String(xDxSystem.tags)
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : undefined,
      },
      spec: {
        owner: systemOwner ?? "unknown",
        domain: xDxSystem?.domain ? String(xDxSystem.domain) : undefined,
        lifecycle: xDxSystem?.lifecycle
          ? (String(xDxSystem.lifecycle) as CatalogLifecycle)
          : undefined,
        dependencies: parseSystemDependencies(xDxSystem?.dependencies),
      },
      components,
      resources,
      apis: Object.keys(apis).length > 0 ? apis : undefined,
      connections,
      formatExtensions: {
        "docker-compose": {
          sourceFiles: composeFiles,
          // Keep legacy field for backward compat
          sourceFile: composeFiles[0],
        },
      },
    }

    return { system, warnings }
  }

  generate(system: CatalogSystem): CatalogGenerateResult {
    const warnings: string[] = []
    const compose = generateComposeFromCatalog(system)
    const content = composeToYaml(compose)

    return {
      files: { "docker-compose.yaml": content },
      warnings,
    }
  }
}
