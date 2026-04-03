/**
 * Software Catalog types — Backstage-aligned vocabulary.
 *
 * These types are used by format adapters (docker-compose, backstage, helm)
 * and the dx dev pipeline. Lyon vocabulary (Module, Team, Principal) lives at the
 * API service boundary; shared/src always speaks Backstage.
 *
 * The spec fields are a superset of what any single output format needs:
 *   - docker-compose uses: image, ports, environment, volumes, healthchecks, build, command
 *   - helm uses: image, ports, healthchecks, compute, routes, secrets, persistent, replicas, command
 *
 * Terminology is intentionally general (not k8s-specific):
 *   - healthchecks (not probes)   — live, ready, start
 *   - compute (not resources)     — min, max
 *   - routes (not ingress)        — host, path, pathMatch
 *   - persistent (not pvc)        — size, class, mode
 *   - exposure (not serviceType)  — internal, node, public
 */

import { z } from "zod";
import type { PortProtocol } from "./types";

// ─── Lifecycle ───────────────────────────────────────────────

export const catalogLifecycleSchema = z.enum([
  "experimental",
  "development",
  "production",
  "deprecated",
]);
export type CatalogLifecycle = z.infer<typeof catalogLifecycleSchema>;

// ─── Entity Kinds ────────────────────────────────────────────

export type CatalogEntityKind =
  | "System"
  | "Domain"
  | "Component"
  | "Resource"
  | "API"
  | "Group"
  | "User";

// ─── Metadata ────────────────────────────────────────────────

export const catalogMetadataSchema = z.object({
  name: z.string(),
  namespace: z.string().default("default"),
  title: z.string().optional(),
  description: z.string().optional(),
  labels: z.record(z.string()).optional(),
  annotations: z.record(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  links: z
    .array(
      z.object({
        url: z.string(),
        title: z.string().optional(),
        icon: z.string().optional(),
        type: z.string().optional(),
      })
    )
    .optional(),
});
export type CatalogMetadata = z.infer<typeof catalogMetadataSchema>;

// ─── Port ────────────────────────────────────────────────────

export const catalogPortSchema = z.object({
  name: z.string(),
  /** Published / service port (host side in compose, service port in k8s). */
  port: z.number(),
  /** Container port when it differs from `port`. */
  containerPort: z.number().optional(),
  protocol: z.enum(["http", "https", "grpc", "tcp", "udp"]) satisfies z.ZodType<PortProtocol>,
  /** How this port is exposed: internal (default), node-level, or public. */
  exposure: z.enum(["internal", "node", "public"]).optional(),
});
export type CatalogPort = z.infer<typeof catalogPortSchema>;

// ─── Healthcheck ────────────────────────────────────────────
//
// Unified health check — replaces both the old simple "healthcheck"
// (path + portName) and the k8s-style "probe" (httpGet/exec/tcpSocket).
// Timing fields use docker-compose-aligned names.

export const catalogHealthcheckSchema = z.object({
  /** HTTP check — path + port. */
  http: z.object({
    path: z.string(),
    port: z.union([z.number(), z.string()]),
  }).optional(),
  /** Shell command check. */
  command: z.array(z.string()).optional(),
  /** TCP socket check — just a port. */
  tcp: z.object({
    port: z.union([z.number(), z.string()]),
  }).optional(),
  /** Seconds to wait before first check. */
  delay: z.number().optional(),
  /** Seconds between checks. */
  interval: z.number().optional(),
  /** Seconds before a check is considered failed. */
  timeout: z.number().optional(),
  /** Number of consecutive failures before marking unhealthy. */
  retries: z.number().optional(),
});
export type CatalogHealthcheck = z.infer<typeof catalogHealthcheckSchema>;

// ─── Volume ─────────────────────────────────────────────────

export const catalogVolumeSchema = z.object({
  name: z.string().optional(),
  hostPath: z.string().optional(),
  containerPath: z.string(),
  readOnly: z.boolean().optional(),
  /** Persistent storage — requests a managed volume (PVC in k8s, named volume in compose). */
  persistent: z.object({
    size: z.string(),
    class: z.string().optional(),
    mode: z.enum(["read-write-once", "read-only-many", "read-write-many"]).optional(),
  }).optional(),
});
export type CatalogVolume = z.infer<typeof catalogVolumeSchema>;

// ─── Compute (CPU / memory bounds) ──────────────────────────

export const catalogComputeSchema = z.object({
  /** Minimum guaranteed resources. */
  min: z.object({
    cpu: z.string().optional(),
    memory: z.string().optional(),
  }).optional(),
  /** Maximum allowed resources. */
  max: z.object({
    cpu: z.string().optional(),
    memory: z.string().optional(),
  }).optional(),
});
export type CatalogCompute = z.infer<typeof catalogComputeSchema>;

// ─── Route (HTTP routing / ingress) ─────────────────────────

export const catalogRouteSchema = z.object({
  host: z.string().optional(),
  path: z.string().default("/"),
  pathMatch: z.enum(["prefix", "exact"]).optional(),
  portName: z.string(),
  tls: z.object({
    enabled: z.boolean().default(true),
    secretName: z.string().optional(),
  }).optional(),
  labels: z.record(z.string()).optional(),
  provider: z.string().optional(),
});
export type CatalogRoute = z.infer<typeof catalogRouteSchema>;

// ─── Secret reference ───────────────────────────────────────

export const catalogSecretRefSchema = z.object({
  /** Env var name to inject. */
  envVar: z.string(),
  /** External secret store key (e.g. GCP Secret Manager path, Vault path). */
  ref: z.string(),
  /** If set, the value for local dev / docker-compose. */
  localDefault: z.string().optional(),
});
export type CatalogSecretRef = z.infer<typeof catalogSecretRefSchema>;

// ─── Component (services you build) ──────────────────────────

export const componentTypeSchema = z.enum([
  "service",
  "worker",
  "task",
  "cronjob",
  "website",
  "library",
]);
export type ComponentType = z.infer<typeof componentTypeSchema>;

export const catalogComponentSchema = z.object({
  kind: z.literal("Component"),
  metadata: catalogMetadataSchema,
  spec: z.object({
    type: z.string(), // ComponentType or custom
    lifecycle: catalogLifecycleSchema.optional(),
    owner: z.string().optional(),
    system: z.string().optional(),
    subcomponentOf: z.string().optional(),
    providesApis: z.array(z.string()).optional(),
    consumesApis: z.array(z.string()).optional(),
    dependsOn: z.array(z.string()).optional(),

    // ── Container runtime ──
    image: z.string().optional(),
    build: z
      .object({
        context: z.string(),
        dockerfile: z.string().optional(),
        args: z.record(z.string()).optional(),
      })
      .optional(),
    command: z.union([z.string(), z.array(z.string())]).optional(),
    args: z.array(z.string()).optional(),
    ports: z.array(catalogPortSchema).default([]),
    environment: z.record(z.string()).optional(),
    secrets: z.array(catalogSecretRefSchema).optional(),

    // ── Volumes / storage ──
    volumes: z.array(catalogVolumeSchema).optional(),
    stateful: z.boolean().optional(),

    // ── Healthchecks ──
    healthchecks: z.object({
      live: catalogHealthcheckSchema.optional(),
      ready: catalogHealthcheckSchema.optional(),
      start: catalogHealthcheckSchema.optional(),
    }).optional(),

    // ── Scaling / compute ──
    replicas: z.number().optional(),
    compute: catalogComputeSchema.optional(),

    // ── Networking ──
    routes: z.array(catalogRouteSchema).optional(),
    isPublic: z.boolean().optional(),

    // ── Dev workflow ──
    dev: z
      .object({
        command: z.string().optional(),
        sync: z.array(z.string()).optional(),
      })
      .optional(),
    test: z.string().optional(),
    lint: z.string().optional(),
    runtime: z.enum(["node", "python", "java"]).optional(),

    // ── Docker compose profiles ──
    profiles: z.array(z.string()).optional(),
  }),
});
export type CatalogComponent = z.infer<typeof catalogComponentSchema>;

// ─── Resource (infra dependencies) ───────────────────────────

export const resourceTypeSchema = z.enum([
  "database",
  "cache",
  "queue",
  "gateway",
  "storage",
  "search",
]);
export type ResourceType = z.infer<typeof resourceTypeSchema>;

export const catalogResourceSchema = z.object({
  kind: z.literal("Resource"),
  metadata: catalogMetadataSchema,
  spec: z.object({
    type: z.string(), // ResourceType or custom
    lifecycle: catalogLifecycleSchema.optional(),
    owner: z.string().optional(),
    system: z.string().optional(),
    dependsOn: z.array(z.string()).optional(),
    dependencyOf: z.array(z.string()).optional(),

    // ── Container runtime ──
    image: z.string(),
    command: z.union([z.string(), z.array(z.string())]).optional(),
    args: z.array(z.string()).optional(),
    ports: z.array(catalogPortSchema).default([]),
    /** @deprecated Use containerPort on each port entry instead. */
    containerPort: z.number().optional(),
    environment: z.record(z.string()).optional(),
    secrets: z.array(catalogSecretRefSchema).optional(),

    // ── Volumes / storage ──
    volumes: z.array(
      z.union([z.string(), catalogVolumeSchema])
    ).optional(),
    stateful: z.boolean().optional(),

    // ── Healthchecks ──
    /** Simple healthcheck command string (docker-compose shorthand). */
    healthcheck: z.string().optional(),
    healthchecks: z.object({
      live: catalogHealthcheckSchema.optional(),
      ready: catalogHealthcheckSchema.optional(),
      start: catalogHealthcheckSchema.optional(),
    }).optional(),

    // ── Scaling / compute ──
    replicas: z.number().optional(),
    compute: catalogComputeSchema.optional(),

    // ── Networking ──
    routes: z.array(catalogRouteSchema).optional(),

    // ── Docker compose profiles ──
    profiles: z.array(z.string()).optional(),
  }),
});
export type CatalogResource = z.infer<typeof catalogResourceSchema>;

// ─── API ─────────────────────────────────────────────────────

export const catalogApiSchema = z.object({
  kind: z.literal("API"),
  metadata: catalogMetadataSchema,
  spec: z.object({
    type: z.enum(["openapi", "asyncapi", "graphql", "grpc"]),
    lifecycle: catalogLifecycleSchema,
    owner: z.string().optional(),
    system: z.string().optional(),
    definition: z.string(),
  }),
});
export type CatalogAPI = z.infer<typeof catalogApiSchema>;

// ─── Connection (dx-specific inter-module wiring) ────────────

export const catalogConnectionSchema = z.object({
  name: z.string(),
  targetModule: z.string(),
  targetComponent: z.string(),
  envVar: z.string(),
  localDefault: z.string().optional(),
  optional: z.boolean().optional(),
});
export type CatalogConnection = z.infer<typeof catalogConnectionSchema>;

// ─── System (top-level, populated by format parsers) ─────────

export const catalogSystemSchema = z.object({
  kind: z.literal("System"),
  metadata: catalogMetadataSchema,
  spec: z.object({
    owner: z.string(),
    domain: z.string().optional(),
    lifecycle: catalogLifecycleSchema.optional(),
  }),
  components: z.record(catalogComponentSchema),
  resources: z.record(catalogResourceSchema),
  apis: z.record(catalogApiSchema).optional(),
  connections: z.array(catalogConnectionSchema).default([]),
  formatExtensions: z.record(z.record(z.unknown())).optional(),
});
export type CatalogSystem = z.infer<typeof catalogSystemSchema>;
