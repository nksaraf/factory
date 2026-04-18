/**
 * Zod schemas for the `software` schema — "What's Built"
 * Single source of truth. TS types derived via z.infer<>.
 */
import { z } from "zod"

import {
  BitemporalSchema,
  EntityMetadataSchema,
  HealthcheckSchema,
  LifecycleSchema,
  PortSchema,
} from "./common"

// ── Component Types ─────────────────────────────────────────

export const ComponentTypeSchema = z.enum([
  "service",
  "worker",
  "task",
  "cronjob",
  "website",
  "library",
  "cli",
  "agent",
  "gateway",
  "ml-model",
  "database",
  "cache",
  "queue",
  "storage",
  "search",
])
export type ComponentType = z.infer<typeof ComponentTypeSchema>

// Application component types (have source code, get built)
export const APPLICATION_TYPES: ComponentType[] = [
  "service",
  "worker",
  "task",
  "cronjob",
  "website",
  "library",
  "cli",
  "agent",
  "gateway",
  "ml-model",
]

// Infrastructure component types (provisioned, not built from source)
export const INFRASTRUCTURE_TYPES: ComponentType[] = [
  "database",
  "cache",
  "queue",
  "storage",
  "search",
]

// ── System ──────────────────────────────────────────────────

/**
 * System-level dependency declared in one system's `x-dx.dependencies[]`.
 *
 * Drives three different behaviours depending on site type (see
 * `.claude/plans/vivid-prancing-lake.md` — Site.json is always generated):
 *
 * - **Dev site (laptop):** bare `dx dev` resolves the dep via `defaultTarget`
 *   unless overridden by `--connect-to` / `--connect` / `--profile`. Missing
 *   `defaultTarget` + `binding: required` + no CLI flag → error.
 * - **Preview site:** inherited from `parentSiteId` as a linked SD.
 * - **Prod/staging site:** treated as a consistency check + wiring-graph
 *   input for cross-SD internal DNS env synthesis. `linked` mode is not
 *   used in prod; all systems run as peer SDs.
 */
export const SystemDependencySchema = z.object({
  /** Slug of the system this system depends on. */
  system: z.string(),
  /**
   * Optional subset of components in the dep system that this system
   * actually consumes. Used by the dev generator to compute a minimal
   * endpoint-discovery query (and by `dx check` as a consistency audit).
   */
  components: z.array(z.string()).optional(),
  /**
   * - `required`: dev fails if the dep can't be resolved.
   * - `optional`: dev proceeds with disabled env (NOTIFICATION_URL="", etc.).
   * - `dev-only`: wired in dev/staging; excluded from prod deployments.
   */
  binding: z.enum(["required", "optional", "dev-only"]).default("required"),
  /**
   * Site slug the dep auto-connects to when `dx dev` is invoked with no
   * explicit --connect flag. Checked into git via compose x-dx; team-wide
   * default. Different consumer repos can set different defaults.
   */
  defaultTarget: z.string().optional(),
})
export type SystemDependency = z.infer<typeof SystemDependencySchema>

export const SystemSpecSchema = z.object({
  namespace: z.string().default("default"),
  lifecycle: LifecycleSchema.default("experimental"),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  dependencies: z.array(SystemDependencySchema).optional(),
})
export type SystemSpec = z.infer<typeof SystemSpecSchema>

export const SystemSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    ownerTeamId: z.string().nullable(),
    spec: SystemSpecSchema,
    metadata: EntityMetadataSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .merge(BitemporalSchema)
export type System = z.infer<typeof SystemSchema>

// ── Component Spec (discriminated by type) ──────────────────

/**
 * Component-level `consumes[]` entry.
 *
 * `system` qualifier is new: when present, the reference is to a component
 * in a different system (e.g. trafficure/api consumes auth-api from
 * shared-auth). Without `system`, the reference is local to the same
 * system. Resolution order: local first, then qualified cross-system.
 */
export const ComponentDependencySchema = z.object({
  component: z.string(),
  /** Qualifies `component` to a specific external system. Optional. */
  system: z.string().optional(),
  as: z.string().optional(),
  protocol: z.string().optional(),
  required: z.boolean().default(true),
})
export type ComponentDependency = z.infer<typeof ComponentDependencySchema>

const BaseComponentSpec = z.object({
  description: z.string().optional(),
  statefulness: z
    .enum(["stateless", "stateful-ephemeral", "stateful-persistent"])
    .optional(),
  sourceRepo: z.string().optional(),
  sourcePath: z.string().optional(),
  dockerfilePath: z.string().optional(),
  imageName: z.string().optional(),
  consumes: z.array(ComponentDependencySchema).optional(),
})

export const ServiceComponentSpecSchema = BaseComponentSpec.extend({
  ports: z.array(PortSchema).default([]),
  healthcheck: HealthcheckSchema.optional(),
  defaultCpu: z.string().default("250m"),
  defaultMemory: z.string().default("256Mi"),
  defaultReplicas: z.number().int().default(1),
  stateful: z.boolean().default(false),
})
export type ServiceComponentSpec = z.infer<typeof ServiceComponentSpecSchema>

export const WorkerComponentSpecSchema = BaseComponentSpec.extend({
  defaultCpu: z.string().default("250m"),
  defaultMemory: z.string().default("256Mi"),
  defaultReplicas: z.number().int().default(1),
  concurrency: z.number().int().optional(),
})
export type WorkerComponentSpec = z.infer<typeof WorkerComponentSpecSchema>

export const TaskComponentSpecSchema = BaseComponentSpec.extend({
  schedule: z.string().optional(), // cron expression for cronjob type
  defaultCpu: z.string().default("250m"),
  defaultMemory: z.string().default("256Mi"),
  timeoutSeconds: z.number().int().optional(),
  retries: z.number().int().default(0),
})
export type TaskComponentSpec = z.infer<typeof TaskComponentSpecSchema>

export const WebsiteComponentSpecSchema = BaseComponentSpec.extend({
  ports: z.array(PortSchema).default([]),
  framework: z.string().optional(),
  buildCommand: z.string().optional(),
  outputDir: z.string().optional(),
})
export type WebsiteComponentSpec = z.infer<typeof WebsiteComponentSpecSchema>

export const LibraryComponentSpecSchema = BaseComponentSpec.extend({
  packageManager: z.enum(["npm", "maven", "pip", "cargo"]).optional(),
  publishTarget: z.string().optional(),
})
export type LibraryComponentSpec = z.infer<typeof LibraryComponentSpecSchema>

export const DatabaseComponentSpecSchema = BaseComponentSpec.extend({
  engine: z.enum(["postgres", "mysql", "redis", "mongodb", "sqlite"]),
  version: z.string().optional(),
  provisionMode: z.enum(["sidecar", "managed", "external"]).default("sidecar"),
  port: z.number().int().optional(),
  defaultStorage: z.string().default("1Gi"),
})
export type DatabaseComponentSpec = z.infer<typeof DatabaseComponentSpecSchema>

export const CacheComponentSpecSchema = BaseComponentSpec.extend({
  engine: z.enum(["redis", "memcached", "valkey"]),
  version: z.string().optional(),
  provisionMode: z.enum(["sidecar", "managed", "external"]).default("sidecar"),
  maxMemory: z.string().optional(),
})
export type CacheComponentSpec = z.infer<typeof CacheComponentSpecSchema>

export const QueueComponentSpecSchema = BaseComponentSpec.extend({
  engine: z.enum(["rabbitmq", "kafka", "temporal", "nats", "sqs"]),
  version: z.string().optional(),
  provisionMode: z.enum(["sidecar", "managed", "external"]).default("sidecar"),
})
export type QueueComponentSpec = z.infer<typeof QueueComponentSpecSchema>

export const StorageComponentSpecSchema = BaseComponentSpec.extend({
  engine: z.enum(["minio", "s3", "gcs", "azure-blob"]),
  provisionMode: z.enum(["sidecar", "managed", "external"]).default("sidecar"),
  defaultCapacity: z.string().default("10Gi"),
})
export type StorageComponentSpec = z.infer<typeof StorageComponentSpecSchema>

export const SearchComponentSpecSchema = BaseComponentSpec.extend({
  engine: z.enum(["elasticsearch", "opensearch", "meilisearch", "typesense"]),
  version: z.string().optional(),
  provisionMode: z.enum(["sidecar", "managed", "external"]).default("sidecar"),
})
export type SearchComponentSpec = z.infer<typeof SearchComponentSpecSchema>

/** Fallback for types without specialized specs (cli, agent, gateway, ml-model) */
export const GenericComponentSpecSchema = BaseComponentSpec.extend({
  ports: z.array(PortSchema).default([]),
  healthcheck: HealthcheckSchema.optional(),
  defaultCpu: z.string().default("250m"),
  defaultMemory: z.string().default("256Mi"),
  defaultReplicas: z.number().int().default(1),
})
export type GenericComponentSpec = z.infer<typeof GenericComponentSpecSchema>

/** Union of all component spec types */
export const ComponentSpecSchema = z.union([
  ServiceComponentSpecSchema,
  WorkerComponentSpecSchema,
  TaskComponentSpecSchema,
  WebsiteComponentSpecSchema,
  LibraryComponentSpecSchema,
  DatabaseComponentSpecSchema,
  CacheComponentSpecSchema,
  QueueComponentSpecSchema,
  StorageComponentSpecSchema,
  SearchComponentSpecSchema,
  GenericComponentSpecSchema,
])
export type ComponentSpec = z.infer<typeof ComponentSpecSchema>

export const ComponentSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    type: ComponentTypeSchema,
    systemId: z.string(),
    ownerTeamId: z.string().nullable(),
    lifecycle: LifecycleSchema.default("experimental"),
    status: z.string().default("active"),
    spec: ComponentSpecSchema,
    metadata: EntityMetadataSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .merge(BitemporalSchema)
export type Component = z.infer<typeof ComponentSchema>

// ── API ─────────────────────────────────────────────────────

export const ApiTypeSchema = z.enum([
  "openapi",
  "grpc",
  "graphql",
  "asyncapi",
  "webhook",
])
export type ApiType = z.infer<typeof ApiTypeSchema>

export const ApiSpecSchema = z.object({
  definitionRef: z.string().optional(),
  description: z.string().optional(),
  version: z.string().optional(),
})
export type ApiSpec = z.infer<typeof ApiSpecSchema>

export const ApiSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  type: ApiTypeSchema,
  systemId: z.string(),
  providedByComponentId: z.string().nullable(),
  spec: ApiSpecSchema,
  metadata: EntityMetadataSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type Api = z.infer<typeof ApiSchema>

// ── Artifact ────────────────────────────────────────────────

export const ArtifactTypeSchema = z.enum([
  "container_image",
  "binary",
  "archive",
  "package",
  "bundle",
])
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>

export const ArtifactSpecSchema = z.object({
  imageRef: z.string().optional(),
  imageDigest: z.string().optional(),
  sizeBytes: z.number().int().optional(),
  builtAt: z.coerce.date().optional(),
  arch: z.enum(["amd64", "arm64", "multi"]).optional(),
  registry: z.string().optional(),
})
export type ArtifactSpec = z.infer<typeof ArtifactSpecSchema>

export const ArtifactSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  type: ArtifactTypeSchema,
  componentId: z.string(),
  spec: ArtifactSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type Artifact = z.infer<typeof ArtifactSchema>

// ── Release ─────────────────────────────────────────────────

export const ReleaseStatusSchema = z.enum([
  "draft",
  "staging",
  "production",
  "superseded",
  "failed",
])
export type ReleaseStatus = z.infer<typeof ReleaseStatusSchema>

export const ReleaseSpecSchema = z.object({
  version: z.string(),
  status: ReleaseStatusSchema.default("draft"),
  releaseNotes: z.string().optional(),
  changelog: z.string().optional(),
})
export type ReleaseSpec = z.infer<typeof ReleaseSpecSchema>

export const ReleaseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  systemId: z.string(),
  spec: ReleaseSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type Release = z.infer<typeof ReleaseSchema>

// ── Template ────────────────────────────────────────────────

export const TemplateTypeSchema = z.enum(["component", "system", "workbench"])
export type TemplateType = z.infer<typeof TemplateTypeSchema>

export const TemplateSpecSchema = z.object({
  kind: z.string(), // e.g., "node-api", "react-vinxi"
  runtime: z.string().optional(), // e.g., "node", "java", "python"
  framework: z.string().optional(), // e.g., "elysia", "spring-boot"
  generatorRef: z.string().optional(),
  description: z.string().optional(),
})
export type TemplateSpec = z.infer<typeof TemplateSpecSchema>

export const TemplateSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  type: TemplateTypeSchema,
  spec: TemplateSpecSchema,
  metadata: EntityMetadataSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type Template = z.infer<typeof TemplateSchema>

// ── Product ─────────────────────────────────────────────────

export const ProductSpecSchema = z.object({
  description: z.string().optional(),
  brand: z.string().optional(),
  website: z.string().url().optional(),
  icon: z.string().optional(),
})
export type ProductSpec = z.infer<typeof ProductSpecSchema>

export const ProductSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  spec: ProductSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type Product = z.infer<typeof ProductSchema>

// ── Capability ──────────────────────────────────────────────

export const CapabilityTypeSchema = z.enum([
  "feature",
  "integration",
  "compute",
  "data",
  "support",
])
export type CapabilityType = z.infer<typeof CapabilityTypeSchema>

export const CapabilitySpecSchema = z.object({
  activation: z
    .enum(["flag", "config", "deploy", "independent"])
    .default("flag"),
  visibility: z.enum(["listed", "unlisted", "internal"]).default("listed"),
  lifecycle: LifecycleSchema.default("experimental"),
  requiresComponents: z.array(z.string()).default([]),
  meteredDimensions: z.record(z.string()).default({}),
  dependsOn: z.array(z.string()).default([]),
  description: z.string().optional(),
})
export type CapabilitySpec = z.infer<typeof CapabilitySpecSchema>

export const CapabilitySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  type: CapabilityTypeSchema,
  productId: z.string(),
  ownerTeamId: z.string().nullable(),
  spec: CapabilitySpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type Capability = z.infer<typeof CapabilitySchema>

// ── Input Schemas (CREATE / UPDATE) ────────────────────────

export const CreateSystemSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  ownerTeamId: z.string().optional(),
  spec: SystemSpecSchema.default({}),
})
export const UpdateSystemSchema = CreateSystemSchema.partial()

export const CreateComponentSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: ComponentTypeSchema,
  systemId: z.string(),
  ownerTeamId: z.string().optional(),
  lifecycle: LifecycleSchema.optional(),
  spec: ComponentSpecSchema.optional(),
})
export const UpdateComponentSchema = CreateComponentSchema.partial()

export const CreateApiSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: ApiTypeSchema,
  systemId: z.string(),
  providedByComponentId: z.string().optional(),
  spec: ApiSpecSchema.default({}),
})
export const UpdateApiSchema = CreateApiSchema.partial()

export const CreateArtifactSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: ArtifactTypeSchema,
  componentId: z.string(),
  spec: ArtifactSpecSchema.default({}),
})
export const UpdateArtifactSchema = CreateArtifactSchema.partial()

export const CreateReleaseSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  systemId: z.string(),
  spec: ReleaseSpecSchema,
})
export const UpdateReleaseSchema = CreateReleaseSchema.partial()

export const CreateTemplateSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: TemplateTypeSchema,
  spec: TemplateSpecSchema,
})
export const UpdateTemplateSchema = CreateTemplateSchema.partial()

export const CreateProductSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  spec: ProductSpecSchema.default({}),
})
export const UpdateProductSchema = CreateProductSchema.partial()

export const CreateCapabilitySchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: CapabilityTypeSchema,
  productId: z.string(),
  ownerTeamId: z.string().optional(),
  spec: CapabilitySpecSchema.default({}),
})
export const UpdateCapabilitySchema = CreateCapabilitySchema.partial()

export {
  CreateEntityRelationshipSchema,
  EntityKindSchema,
  EntityRelationshipSchema,
  EntityRelationshipSpecSchema,
  EntityRelationshipTypeSchema,
  UpdateEntityRelationshipSchema,
} from "./org"
export type {
  EntityKind,
  EntityRelationship,
  EntityRelationshipSpec,
  EntityRelationshipType,
} from "./org"
