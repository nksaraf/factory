/**
 * `dx catalog doctor` — diagnose and fix catalog labels in docker-compose files.
 *
 * Scans each service in the compose file, reports which catalog labels
 * are present/missing, and optionally prompts interactively to fill
 * them in (or uses defaults with --yes).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { parseDocument, type Document } from "yaml"

import {
  styleBold,
  styleError,
  styleInfo,
  styleMuted,
  styleSuccess,
  styleWarn,
} from "../cli-style.js"
import type { DxFlags } from "../stub.js"

// ─── Types ───────────────────────────────────────────────────

interface ServiceDiagnosis {
  name: string
  kind: "component" | "resource"
  /** Labels already present. */
  present: Record<string, string>
  /** Labels that are missing, with inferred defaults (if any). */
  missing: Array<{
    key: string
    inferred: string | null
    description: string
    required: boolean
  }>
}

// ─── Well-known infra images (mirrors docker-compose.adapter.ts) ──

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
  [/^mailhog/i, "other"],
  [/^adminer/i, "other"],
  [/^phpmyadmin/i, "other"],
]

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
  "mailhog",
  "adminer",
  "apisix",
  "kong",
]

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
  8080: { name: "http", protocol: "http" },
  8443: { name: "https", protocol: "https" },
  9090: { name: "http", protocol: "http" },
  9092: { name: "kafka", protocol: "tcp" },
}

// ─── Compose file detection ─────────────────────────────────

const COMPOSE_FILE_NAMES = [
  "docker-compose.yaml",
  "docker-compose.yml",
  "compose.yaml",
  "compose.yml",
]

function findComposeFile(rootDir: string): string | null {
  for (const f of COMPOSE_FILE_NAMES) {
    const p = join(rootDir, f)
    if (existsSync(p)) return p
  }
  return null
}

// ─── Classification helpers ──────────────────────────────────

function inferResourceType(image: string): string | null {
  const parts = image.split("/")
  const last = parts[parts.length - 1] ?? image
  const imageName = last.split(":")[0] ?? last
  for (const [pattern, type] of INFRA_IMAGE_PATTERNS) {
    if (pattern.test(imageName)) return type
  }
  return null
}

function classifyService(
  name: string,
  svc: Record<string, unknown>
): "component" | "resource" {
  const labels = (svc.labels ?? {}) as Record<string, string>
  if (labels["catalog.kind"]) {
    return labels["catalog.kind"].toLowerCase() === "resource"
      ? "resource"
      : "component"
  }
  if (svc.build) return "component"
  const image = typeof svc.image === "string" ? svc.image : ""
  if (image && inferResourceType(image)) return "resource"
  const lower = name.toLowerCase()
  if (
    INFRA_NAME_PATTERNS.some((n) => lower === n || lower.startsWith(`${n}-`))
  ) {
    return "resource"
  }
  return "component"
}

// ─── Port parsing ────────────────────────────────────────────

function extractContainerPorts(svc: Record<string, unknown>): number[] {
  const rawPorts = svc.ports as
    | Array<string | number | Record<string, unknown>>
    | undefined
  if (!rawPorts) return []
  const result: number[] = []
  for (const p of rawPorts) {
    if (typeof p === "number") {
      result.push(p)
    } else if (typeof p === "string") {
      // strip env var defaults roughly
      const resolved = p
        .replace(/\$\{[^}]+:-([^}]+)\}/g, "$1")
        .replace(/\$\{[^}]+\}/g, "0")
      const clean = resolved.replace(/\/.*$/, "")
      const parts = clean.split(":")
      if (parts.length === 1) {
        const n = parseInt(parts[0]!, 10)
        if (!isNaN(n)) result.push(n)
      } else if (parts.length === 2) {
        const n = parseInt(parts[1]!, 10)
        if (!isNaN(n)) result.push(n)
      } else if (parts.length === 3) {
        const n = parseInt(parts[2]!, 10)
        if (!isNaN(n)) result.push(n)
      }
    } else if (typeof p === "object" && p !== null) {
      const target = (p as Record<string, unknown>).target
      if (target != null) result.push(Number(target))
    }
  }
  return result.filter((n) => !isNaN(n) && n > 0)
}

// ─── Diagnosis ───────────────────────────────────────────────

function diagnoseService(
  name: string,
  svc: Record<string, unknown>
): ServiceDiagnosis {
  const labels = (svc.labels ?? {}) as Record<string, string>
  const kind = classifyService(name, svc)
  const image = typeof svc.image === "string" ? svc.image : ""
  const containerPorts = extractContainerPorts(svc)

  const present: Record<string, string> = {}
  for (const [k, v] of Object.entries(labels)) {
    if (k.startsWith("catalog.")) present[k] = String(v)
  }

  const missing: ServiceDiagnosis["missing"] = []

  function check(
    key: string,
    inferred: string | null,
    description: string,
    required: boolean
  ) {
    if (present[key]) return
    missing.push({ key, inferred, description, required })
  }

  // Core labels
  check("catalog.description", null, "Short description of the service", true)
  check("catalog.owner", null, "Team or person who owns this service", true)
  check(
    "catalog.lifecycle",
    "production",
    "Lifecycle stage (production, development, experimental, deprecated)",
    false
  )

  if (kind === "resource") {
    const inferredType = image ? inferResourceType(image) : null
    check(
      "catalog.type",
      inferredType,
      "Resource type (database, cache, queue, gateway, storage, search, other)",
      false
    )
  } else {
    check(
      "catalog.type",
      "service",
      "Component type (service, worker, library)",
      false
    )
  }

  check("catalog.tags", null, "Comma-separated tags", false)

  // Port labels
  for (const port of containerPorts) {
    const known = KNOWN_PORTS[port]
    const portNameKey = `catalog.port.${port}.name`
    const portProtoKey = `catalog.port.${port}.protocol`
    if (!present[portNameKey]) {
      missing.push({
        key: portNameKey,
        inferred: known?.name ?? null,
        description: `Name for port ${port}`,
        required: false,
      })
    }
    if (!present[portProtoKey]) {
      missing.push({
        key: portProtoKey,
        inferred: known?.protocol ?? null,
        description: `Protocol for port ${port} (http, https, grpc, tcp, udp)`,
        required: false,
      })
    }
  }

  // API labels (only for components)
  if (kind === "component") {
    check(
      "catalog.api.provides",
      null,
      "APIs this service provides (comma-separated)",
      false
    )
    check(
      "catalog.api.consumes",
      null,
      "APIs this service consumes (comma-separated)",
      false
    )
  }

  // Kind override — only suggest if classification might be wrong
  if (kind === "resource" && svc.build) {
    check(
      "catalog.kind",
      "Component",
      "Classification override (Component or Resource)",
      false
    )
  }

  return { name, kind, present, missing }
}

// ─── Output ──────────────────────────────────────────────────

function renderDiagnosis(d: ServiceDiagnosis): void {
  const kindBadge =
    d.kind === "component" ? styleInfo("Component") : styleWarn("Resource")
  console.log(`\n${styleBold(d.name)} ${styleMuted(`(${kindBadge})`)}`)

  const presentCount = Object.keys(d.present).length
  const missingRequired = d.missing.filter((m) => m.required)
  const missingOptional = d.missing.filter((m) => !m.required)

  if (presentCount > 0) {
    for (const [k, v] of Object.entries(d.present)) {
      console.log(`  ${styleSuccess("✓")} ${styleMuted(k)}: ${v}`)
    }
  }

  if (missingRequired.length > 0) {
    for (const m of missingRequired) {
      const inf = m.inferred ? styleMuted(` (default: ${m.inferred})`) : ""
      console.log(
        `  ${styleError("✗")} ${styleBold(m.key)}${inf} — ${m.description}`
      )
    }
  }

  if (missingOptional.length > 0) {
    for (const m of missingOptional) {
      const inf = m.inferred ? styleMuted(` (default: ${m.inferred})`) : ""
      console.log(
        `  ${styleWarn("○")} ${styleMuted(m.key)}${inf} — ${m.description}`
      )
    }
  }

  if (missingRequired.length === 0 && missingOptional.length === 0) {
    console.log(`  ${styleSuccess("All catalog labels present")}`)
  }
}

// ─── YAML mutation ───────────────────────────────────────────

function setLabel(
  doc: Document,
  serviceName: string,
  key: string,
  value: string
): void {
  const services = doc.get("services")
  if (!services || typeof services !== "object" || !("get" in services)) return
  const svc = (services as { get(k: string): unknown }).get(serviceName)
  if (!svc || typeof svc !== "object" || !("get" in svc) || !("set" in svc))
    return
  const svcMap = svc as {
    get(k: string): unknown
    set(k: string, v: unknown): void
  }

  let labels = svcMap.get("labels")
  if (!labels) {
    svcMap.set("labels", doc.createNode({}))
    labels = svcMap.get("labels")
  }
  if (labels && typeof labels === "object" && "set" in labels) {
    ;(labels as { set(k: string, v: string): void }).set(key, value)
  }
}

// ─── Handler ─────────────────────────────────────────────────

export async function runCatalogDoctor(
  flags: Record<string, unknown>,
  f: DxFlags
): Promise<void> {
  const cwd = process.cwd()

  // Find compose file
  const composePath = flags.file ? String(flags.file) : findComposeFile(cwd)

  if (!composePath || !existsSync(composePath)) {
    console.error(
      styleError(
        `No docker-compose file found. Searched for: ${COMPOSE_FILE_NAMES.join(", ")}`
      )
    )
    process.exit(1)
  }

  const raw = readFileSync(composePath, "utf-8")
  const data = parseDocument(raw)
  const parsed = data.toJSON() as Record<string, unknown>
  const rawServices = (parsed.services ?? {}) as Record<
    string,
    Record<string, unknown>
  >

  if (Object.keys(rawServices).length === 0) {
    console.error(styleError("No services found in compose file."))
    process.exit(1)
  }

  // Filter to specific service if requested
  const serviceFilter = flags.service ? String(flags.service) : null
  const serviceNames = serviceFilter
    ? Object.keys(rawServices).filter((n) => n === serviceFilter)
    : Object.keys(rawServices)

  if (serviceFilter && serviceNames.length === 0) {
    const available = Object.keys(rawServices).join(", ")
    console.error(
      styleError(
        `Service "${serviceFilter}" not found. Available: ${available}`
      )
    )
    process.exit(1)
  }

  // Diagnose all services
  const diagnoses = serviceNames.map((name) =>
    diagnoseService(name, rawServices[name]!)
  )

  const totalMissing = diagnoses.reduce((sum, d) => sum + d.missing.length, 0)
  const totalRequired = diagnoses.reduce(
    (sum, d) => sum + d.missing.filter((m) => m.required).length,
    0
  )

  // JSON output
  if (f.json) {
    console.log(
      JSON.stringify(
        {
          success: true,
          file: composePath,
          services: diagnoses.map((d) => ({
            name: d.name,
            kind: d.kind,
            present: d.present,
            missing: d.missing,
          })),
          summary: {
            total: serviceNames.length,
            healthy: diagnoses.filter((d) => d.missing.length === 0).length,
            missingLabels: totalMissing,
            missingRequired: totalRequired,
          },
        },
        null,
        2
      )
    )
    return
  }

  // Display diagnosis
  console.log(styleBold("Catalog Doctor") + styleMuted(` — ${composePath}`))

  for (const d of diagnoses) {
    renderDiagnosis(d)
  }

  // Summary
  console.log("")
  if (totalMissing === 0) {
    console.log(styleSuccess("All services have complete catalog labels."))
    return
  }

  console.log(
    `${styleBold("Summary:")} ${totalMissing} missing label${totalMissing !== 1 ? "s" : ""} across ${serviceNames.length} service${serviceNames.length !== 1 ? "s" : ""}` +
      (totalRequired > 0 ? ` (${styleError(`${totalRequired} required`)})` : "")
  )

  // Fix mode
  if (!flags.fix) {
    console.log(
      styleMuted(
        "\nRun with --fix to interactively add missing labels, or --fix --yes to accept defaults."
      )
    )
    return
  }

  // Interactive or auto-fix
  const useDefaults = Boolean(flags.yes)
  let modified = false

  for (const d of diagnoses) {
    if (d.missing.length === 0) continue

    console.log(`\n${styleBold("Fixing:")} ${styleInfo(d.name)}`)

    for (const m of d.missing) {
      let value: string | null = null

      if (useDefaults) {
        if (m.inferred) {
          value = m.inferred
          console.log(
            `  ${styleSuccess("+")} ${m.key}: ${value} ${styleMuted("(default)")}`
          )
        } else if (m.required) {
          console.log(
            `  ${styleWarn("⚠")} ${m.key}: ${styleMuted("skipped (no default, needs manual input)")}`
          )
        } else {
          console.log(
            `  ${styleMuted("–")} ${m.key}: ${styleMuted("skipped (optional, no default)")}`
          )
        }
      } else {
        const { input, select } = await import("@crustjs/prompts")

        if (m.key === "catalog.lifecycle") {
          value = await select({
            message: `${d.name} → ${m.key}`,
            choices: [
              { value: "production", label: "production" },
              { value: "development", label: "development" },
              { value: "experimental", label: "experimental" },
              { value: "deprecated", label: "deprecated" },
            ],
            default: m.inferred ?? "production",
          })
        } else if (m.key === "catalog.type" && d.kind === "resource") {
          value = await select({
            message: `${d.name} → ${m.key}`,
            choices: [
              { value: "database", label: "database" },
              { value: "cache", label: "cache" },
              { value: "queue", label: "queue" },
              { value: "gateway", label: "gateway" },
              { value: "storage", label: "storage" },
              { value: "search", label: "search" },
              { value: "auth-provider", label: "auth-provider" },
              { value: "other", label: "other" },
            ],
            default: m.inferred ?? "database",
          })
        } else if (m.key === "catalog.type" && d.kind === "component") {
          value = await select({
            message: `${d.name} → ${m.key}`,
            choices: [
              { value: "service", label: "service" },
              { value: "worker", label: "worker" },
              { value: "library", label: "library" },
            ],
            default: m.inferred ?? "service",
          })
        } else if (m.key === "catalog.kind") {
          value = await select({
            message: `${d.name} → ${m.key}`,
            choices: [
              { value: "Component", label: "Component" },
              { value: "Resource", label: "Resource" },
            ],
            default: m.inferred ?? "Component",
          })
        } else if (m.key.endsWith(".protocol")) {
          value = await select({
            message: `${d.name} → ${m.key}`,
            choices: [
              { value: "http", label: "http" },
              { value: "https", label: "https" },
              { value: "grpc", label: "grpc" },
              { value: "tcp", label: "tcp" },
              { value: "udp", label: "udp" },
            ],
            default: m.inferred ?? "tcp",
          })
        } else {
          const result = await input({
            message: `${d.name} → ${m.key}${m.required ? " (required)" : ""}`,
            default: m.inferred ?? undefined,
          })
          value = result || null
        }

        if (value) {
          console.log(`  ${styleSuccess("+")} ${m.key}: ${value}`)
        } else {
          console.log(`  ${styleMuted("–")} ${m.key}: skipped`)
        }
      }

      if (value) {
        setLabel(data, d.name, m.key, value)
        modified = true
      }
    }
  }

  if (modified) {
    const output = data.toString()
    writeFileSync(composePath, output, "utf-8")
    console.log(`\n${styleSuccess("✓")} Updated ${composePath}`)
  } else {
    console.log(`\n${styleMuted("No changes made.")}`)
  }
}
