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

export const connectionProfileSchema = z.object({
  description: z.string().optional(),
  connect: z.record(connectionProfileEntrySchema).default({}),
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
