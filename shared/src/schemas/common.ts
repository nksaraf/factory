/**
 * Common Zod schemas shared across all domains.
 */

import { z } from "zod";

// ── Entity Metadata (Backstage-style extensibility) ─────────

export const EntityLinkSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  icon: z.string().optional(),
});
export type EntityLink = z.infer<typeof EntityLinkSchema>;

export const EntityMetadataSchema = z.object({
  labels: z.record(z.string()).optional(),
  annotations: z.record(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  links: z.array(EntityLinkSchema).optional(),
});
export type EntityMetadata = z.infer<typeof EntityMetadataSchema>;

// ── Common Component Specs ──────────────────────────────────

export const PortSchema = z.object({
  name: z.string(),
  port: z.number().int().min(1).max(65535),
  protocol: z.enum(["http", "https", "tcp", "udp", "grpc"]).default("http"),
  targetPort: z.number().int().optional(),
});
export type Port = z.infer<typeof PortSchema>;

export const HealthcheckSchema = z.object({
  path: z.string().default("/healthz"),
  port: z.number().int().optional(),
  intervalSeconds: z.number().int().default(30),
  timeoutSeconds: z.number().int().default(5),
  failureThreshold: z.number().int().default(3),
});
export type Healthcheck = z.infer<typeof HealthcheckSchema>;

// ── Bitemporal Fields ───────────────────────────────────────
// Shared schema for entities tracked with bitemporal columns.

export const BitemporalSchema = z.object({
  validFrom: z.coerce.date(),
  validTo: z.coerce.date().nullable(),
  systemFrom: z.coerce.date(),
  systemTo: z.coerce.date().nullable(),
  changedBy: z.string().default("system"),
  changeReason: z.string().nullable(),
});
export type Bitemporal = z.infer<typeof BitemporalSchema>;

// ── Reconciliation Fields ───────────────────────────────────
// Shared schema for entities with spec/status convergence tracking.

export const ReconciliationSchema = z.object({
  status: z.record(z.unknown()).default({}),
  generation: z.number().int().default(0),
  observedGeneration: z.number().int().default(0),
});
export type Reconciliation = z.infer<typeof ReconciliationSchema>;

// ── Reusable Enums ──────────────────────────────────────────

export const LifecycleSchema = z.enum([
  "experimental",
  "beta",
  "production",
  "deprecated",
  "retired",
]);
export type Lifecycle = z.infer<typeof LifecycleSchema>;

export const StatusSchema = z.enum([
  "provisioning",
  "active",
  "suspended",
  "destroying",
  "destroyed",
]);
export type Status = z.infer<typeof StatusSchema>;
