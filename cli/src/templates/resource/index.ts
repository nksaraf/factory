import type { GeneratedFile } from "../types.js"
import { generate as generatePostgres } from "./postgres.js"
import { generate as generateRedis } from "./redis.js"
import { generate as generateTemporal } from "./temporal.js"
import { generate as generateKafka } from "./kafka.js"
import { generate as generateRabbitmq } from "./rabbitmq.js"
import { generate as generateMinio } from "./minio.js"
import { generate as generateMailpit } from "./mailpit.js"
import { generate as generateAuth } from "./auth.js"
import { generate as generateGateway } from "./gateway.js"

// ─── Resource types (aligned with resourceTypeSchema in catalog.ts) ─────────

/** Matches resourceTypeSchema in shared/src/catalog.ts */
export type ResourceCatalogType =
  | "database"
  | "cache"
  | "queue"
  | "gateway"
  | "storage"
  | "search"

export type ResourceName =
  | "postgres"
  | "redis"
  | "temporal"
  | "kafka"
  | "rabbitmq"
  | "minio"
  | "mailpit"
  | "auth"
  | "gateway"

export interface ResourceEntry {
  name: ResourceName
  label: string
  description: string
  /** Auto-resolved catalog resource type */
  catalogType: ResourceCatalogType
}

export const RESOURCE_CATALOG: ResourceEntry[] = [
  {
    name: "postgres",
    label: "PostgreSQL",
    description: "Relational database",
    catalogType: "database",
  },
  {
    name: "redis",
    label: "Redis",
    description: "In-memory cache",
    catalogType: "cache",
  },
  {
    name: "temporal",
    label: "Temporal",
    description: "Workflow orchestration",
    catalogType: "queue",
  },
  {
    name: "kafka",
    label: "Kafka",
    description: "Event streaming",
    catalogType: "queue",
  },
  {
    name: "rabbitmq",
    label: "RabbitMQ",
    description: "Message broker",
    catalogType: "queue",
  },
  {
    name: "minio",
    label: "MinIO",
    description: "S3-compatible storage",
    catalogType: "storage",
  },
  {
    name: "mailpit",
    label: "Mailpit",
    description: "Email testing",
    catalogType: "gateway",
  },
  {
    name: "auth",
    label: "Auth",
    description: "Authentication service (Better Auth)",
    catalogType: "gateway",
  },
  {
    name: "gateway",
    label: "Gateway",
    description: "API gateway (APISIX)",
    catalogType: "gateway",
  },
]

export interface ResourceOpts {
  owner: string
  projectName: string
}

const generators: Record<
  ResourceName,
  (opts: ResourceOpts) => GeneratedFile[]
> = {
  postgres: generatePostgres,
  redis: generateRedis,
  temporal: generateTemporal,
  kafka: generateKafka,
  rabbitmq: generateRabbitmq,
  minio: generateMinio,
  mailpit: generateMailpit,
  auth: generateAuth,
  gateway: generateGateway,
}

/** Returns true if the name matches a known resource. */
export function isResourceName(name: string): name is ResourceName {
  return name in generators
}

/** Generate compose + config files for a resource. */
export function generateResource(
  name: ResourceName,
  opts: ResourceOpts
): GeneratedFile[] {
  const gen = generators[name]
  if (!gen) throw new Error(`Unknown resource: ${name}`)
  return gen(opts)
}
