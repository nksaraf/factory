import { z } from "zod";

export const tierOverlaySchema = z.object({
  env: z.record(z.string()).default({}),
});

export type TierOverlay = z.infer<typeof tierOverlaySchema>;

export const tunnelBackendKindSchema = z.enum([
  "direct",
  "ssh",
  "kubectl",
  "gateway",
]);

export type TunnelBackendKind = z.infer<typeof tunnelBackendKindSchema>;

export const connectionProfileEntrySchema = z.union([
  z.string(),
  z.object({
    target: z.string(),
    readonly: z.boolean().optional(),
    backend: tunnelBackendKindSchema.optional(),
  }),
]);

export type ConnectionProfileEntry = z.infer<
  typeof connectionProfileEntrySchema
>;

export const connectionProfileSchema = z.object({
  description: z.string().optional(),
  connect: z.record(connectionProfileEntrySchema),
});

export type ConnectionProfile = z.infer<typeof connectionProfileSchema>;

export const tunnelSpecSchema = z.object({
  name: z.string(),
  localPort: z.number(),
  remoteHost: z.string(),
  remotePort: z.number(),
  namespace: z.string().optional(),
  backend: tunnelBackendKindSchema.default("direct"),
  connectionString: z.string().optional(),
});

export type TunnelSpec = z.infer<typeof tunnelSpecSchema>;

export interface ResolvedEnvEntry {
  value: string;
  source: "default" | "tier" | "connection" | "cli";
  sourceDetail?: string;
}

export interface ResolvedConnectionContext {
  envVars: Record<string, ResolvedEnvEntry>;
  tunnels: TunnelSpec[];
  remoteDeps: string[];
  localDeps: string[];
}

export interface NormalizedProfileEntry {
  target: string;
  readonly: boolean;
  backend: TunnelBackendKind;
}

export function normalizeProfileEntry(
  entry: ConnectionProfileEntry
): NormalizedProfileEntry {
  if (typeof entry === "string") {
    return { target: entry, readonly: false, backend: "direct" };
  }
  return {
    target: entry.target,
    readonly: entry.readonly ?? false,
    backend: entry.backend ?? "direct",
  };
}
