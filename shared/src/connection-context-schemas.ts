import { z } from "zod"

export const tunnelBackendKindSchema = z.enum([
  "direct",
  "ssh",
  "kubectl",
  "gateway",
])

export type TunnelBackendKind = z.infer<typeof tunnelBackendKindSchema>

export const connectionProfileEntrySchema = z.union([
  z.string(),
  z.object({
    target: z.string(),
    readonly: z.boolean().optional(),
    backend: tunnelBackendKindSchema.optional(),
    /** Remote endpoint host (for connection propagation). */
    host: z.string().optional(),
    /** Remote endpoint port (for connection propagation). */
    port: z.number().optional(),
    /** Compose interpolation overrides (e.g., POSTGRES_USER, POSTGRES_PASSWORD). */
    vars: z.record(z.string()).optional(),
  }),
])

export type ConnectionProfileEntry = z.infer<
  typeof connectionProfileEntrySchema
>

/**
 * System-level connection entry in a profile. When set, ALL components of
 * the referenced system are assumed to come from the target SD on that site.
 * Component-level `connect:` entries still override on a per-component basis
 * (the "link the system but run auth-api locally against Jane's laptop" case).
 *
 * `discover: true` tells dx to query the Factory API for current endpoints of
 * that SD rather than relying on hardcoded host/port — useful when endpoints
 * can shift (preview envs, auto-scaled services).
 */
export const systemConnectionProfileEntrySchema = z.object({
  site: z.string(),
  /** Optional: specific SD slug within the site. Defaults to the first SD matching the system. */
  systemDeployment: z.string().optional(),
  /** Auto-discover component endpoints via Factory API. */
  discover: z.boolean().default(true),
})
export type SystemConnectionProfileEntry = z.infer<
  typeof systemConnectionProfileEntrySchema
>

export const connectionProfileSchema = z.object({
  description: z.string().optional(),
  /** Per-component connection targets. Flat keyed by component slug. */
  connect: z.record(connectionProfileEntrySchema).default({}),
  /**
   * System-level connection targets. Keyed by system slug. When set, the
   * whole system is linked to the referenced SD; per-component `connect:`
   * entries still override for specific components.
   */
  systems: z.record(systemConnectionProfileEntrySchema).default({}),
  env: z.record(z.string()).default({}),
})

export type ConnectionProfile = z.infer<typeof connectionProfileSchema>

export const tunnelSpecSchema = z.object({
  name: z.string(),
  localPort: z.number(),
  remoteHost: z.string(),
  remotePort: z.number(),
  namespace: z.string().optional(),
  backend: tunnelBackendKindSchema.default("direct"),
  connectionString: z.string().optional(),
})

export type TunnelSpec = z.infer<typeof tunnelSpecSchema>

export interface ResolvedEnvEntry {
  value: string
  source: "default" | "tier" | "connection" | "cli"
  sourceDetail?: string
}

export interface ResolvedConnectionContext {
  envVars: Record<string, ResolvedEnvEntry>
  tunnels: TunnelSpec[]
  remoteDeps: string[]
  localDeps: string[]
}

export interface NormalizedProfileEntry {
  target: string
  readonly: boolean
  backend: TunnelBackendKind
  host?: string
  port?: number
  vars?: Record<string, string>
}

export function normalizeProfileEntry(
  entry: ConnectionProfileEntry
): NormalizedProfileEntry {
  if (typeof entry === "string") {
    return { target: entry, readonly: false, backend: "direct" }
  }
  return {
    target: entry.target,
    readonly: entry.readonly ?? false,
    backend: entry.backend ?? "direct",
    host: entry.host,
    port: entry.port,
    vars: entry.vars,
  }
}
