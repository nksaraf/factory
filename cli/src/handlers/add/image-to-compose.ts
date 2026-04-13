import type { GeneratedFile } from "../../templates/types.js"
import type { ImageMetadata } from "../../lib/docker-inspect.js"

// ─── Catalog type inference from ports ───────────────────────

const PORT_TO_CATALOG_TYPE: Record<number, string> = {
  3306: "database", // MySQL
  5432: "database", // PostgreSQL
  27017: "database", // MongoDB
  6379: "cache", // Redis
  11211: "cache", // Memcached
  9092: "queue", // Kafka
  5672: "queue", // RabbitMQ
  4222: "queue", // NATS
  7233: "queue", // Temporal
  9000: "storage", // MinIO
  9200: "search", // Elasticsearch
  7700: "search", // Meilisearch
}

function inferCatalogType(ports: number[]): string {
  for (const port of ports) {
    const type = PORT_TO_CATALOG_TYPE[port]
    if (type) return type
  }
  return "service"
}

// ─── YAML helpers ───────────────────────────────────────────

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces)
  return text
    .split("\n")
    .map((line) => (line.trim() ? pad + line : line))
    .join("\n")
}

// ─── Main ───────────────────────────────────────────────────

/**
 * Generate compose file(s) from Docker image metadata.
 */
export function generateComposeFromImage(
  name: string,
  metadata: ImageMetadata,
  owner: string
): GeneratedFile[] {
  const envVarPrefix = name.toUpperCase().replace(/-/g, "_")
  const catalogType = inferCatalogType(metadata.exposedPorts)

  const lines: string[] = []
  lines.push("services:")
  lines.push(`  ${name}:`)
  lines.push(`    image: ${metadata.image}`)

  // ── Ports ───────────────────────────────────────────────
  if (metadata.exposedPorts.length > 0) {
    lines.push("    ports:")
    for (const port of metadata.exposedPorts) {
      const varName =
        metadata.exposedPorts.length === 1
          ? `${envVarPrefix}_PORT`
          : `${envVarPrefix}_PORT_${port}`
      lines.push(`      - "\${${varName}:-${port}}:${port}"`)
    }
  }

  // ── Environment ─────────────────────────────────────────
  const envEntries = Object.entries(metadata.env)
  if (envEntries.length > 0) {
    lines.push("    environment:")
    for (const [key, value] of envEntries) {
      lines.push(`      ${key}: \${${key}:-${value}}`)
    }
  }

  // ── Volumes ─────────────────────────────────────────────
  if (metadata.volumes.length > 0) {
    lines.push("    volumes:")
    for (let i = 0; i < metadata.volumes.length; i++) {
      const volumePath = metadata.volumes[i]!
      const volumeName = i === 0 ? `${name}-data` : `${name}-data-${i}`
      lines.push(`      - ${volumeName}:${volumePath}`)
    }
  }

  // ── Healthcheck ─────────────────────────────────────────
  if (metadata.healthcheck) {
    const hc = metadata.healthcheck
    const testStr = JSON.stringify(hc.test)
    lines.push("    healthcheck:")
    lines.push(`      test: ${testStr}`)
    if (hc.interval) lines.push(`      interval: ${hc.interval}`)
    if (hc.timeout) lines.push(`      timeout: ${hc.timeout}`)
    if (hc.retries) lines.push(`      retries: ${hc.retries}`)
  }

  // ── Labels ──────────────────────────────────────────────
  lines.push("    labels:")
  lines.push(`      dx.type: ${catalogType}`)
  lines.push(`      dx.owner: ${owner}`)
  lines.push(`      dx.description: "${name}"`)
  for (const port of metadata.exposedPorts) {
    // Use first port's protocol as http for common web ports, tcp otherwise
    const protocol = [80, 443, 3000, 8080, 8443, 9080].includes(port)
      ? "http"
      : "tcp"
    const portName = protocol === "http" ? "http" : `port-${port}`
    lines.push(`      dx.port.${port}.name: ${portName}`)
    lines.push(`      dx.port.${port}.protocol: ${protocol}`)
  }

  // ── Top-level volumes ───────────────────────────────────
  if (metadata.volumes.length > 0) {
    lines.push("")
    lines.push("volumes:")
    for (let i = 0; i < metadata.volumes.length; i++) {
      const volumeName = i === 0 ? `${name}-data` : `${name}-data-${i}`
      lines.push(`  ${volumeName}:`)
    }
  }

  lines.push("")

  return [
    {
      path: `compose/${name}.yml`,
      content: lines.join("\n"),
    },
  ]
}
