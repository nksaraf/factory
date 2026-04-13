/**
 * Canonical site state model — used in both `.dx/site.json` (local)
 * and synced to the Factory API (remote). Same shape everywhere:
 * IDs in DB, slugs in local file.
 *
 * Entity hierarchy: site → workbench → systemDeployment[] → componentDeployment[]
 */
import { z } from "zod"

import { tunnelSpecSchema } from "./connection-context-schemas"

// ── Resolved env entry (Zod version of the interface in connection-context-schemas) ──

export const resolvedEnvEntrySchema = z.object({
  value: z.string(),
  source: z.enum(["default", "tier", "connection", "cli"]),
  sourceDetail: z.string().optional(),
})
export type ResolvedEnvEntryLocal = z.infer<typeof resolvedEnvEntrySchema>

// ── Conditions (Kubernetes-style status conditions) ─────────

export const conditionStatusSchema = z.enum(["True", "False", "Unknown"])
export type ConditionStatus = z.infer<typeof conditionStatusSchema>

export const conditionSchema = z.object({
  type: z.string(),
  status: conditionStatusSchema,
  reason: z.string().optional(),
  message: z.string().optional(),
  lastTransitionTime: z.string().optional(),
})
export type Condition = z.infer<typeof conditionSchema>

// ── Probes ──────────────────────────────────────────────────

export const probeConfigSchema = z.object({
  type: z.enum(["http", "tcp", "exec"]).default("tcp"),
  port: z.number().optional(),
  path: z.string().optional(),
  command: z.array(z.string()).optional(),
  intervalSeconds: z.number().default(10),
  timeoutSeconds: z.number().default(5),
  failureThreshold: z.number().default(3),
})
export type ProbeConfig = z.infer<typeof probeConfigSchema>

// ── Component deployment ────────────────────────────────────

export const componentDeploymentModeSchema = z.enum([
  "native", // process on a workbench (dev servers)
  "container", // managed by system deployment's runtime executor
  "service", // external managed service (AWS RDS, Auth0, Stripe)
  "linked", // another site's component deployment
])
export type ComponentDeploymentMode = z.infer<
  typeof componentDeploymentModeSchema
>

export const linkedRefSchema = z.object({
  site: z.string(),
  systemDeployment: z.string(),
  component: z.string(),
})
export type LinkedRef = z.infer<typeof linkedRefSchema>

export const componentDeploymentStatusSchema = z.object({
  observedGeneration: z.number().optional(),
  phase: z.enum(["pending", "running", "stopped", "failed"]).optional(),
  conditions: z.array(conditionSchema).default([]),
  pid: z.number().optional(),
  port: z.number().optional(),
  containerId: z.string().optional(),
  actualImage: z.string().optional(),
})
export type ComponentDeploymentStatus = z.infer<
  typeof componentDeploymentStatusSchema
>

export const componentDeploymentSpecSchema = z.object({
  generation: z.number().default(1),
  desiredImage: z.string().optional(),
  replicas: z.number().optional(),
  envOverrides: z.record(z.string()).optional(),
  readinessProbe: probeConfigSchema.optional(),
  livenessProbe: probeConfigSchema.optional(),
})
export type ComponentDeploymentLocalSpec = z.infer<
  typeof componentDeploymentSpecSchema
>

export const localComponentDeploymentSchema = z.object({
  componentSlug: z.string(),
  mode: componentDeploymentModeSchema,
  // native: which workbench runs this process
  workbenchSlug: z.string().optional(),
  // service: external managed service
  serviceSlug: z.string().optional(),
  // linked: another site's component deployment
  linkedRef: linkedRefSchema.optional(),
  spec: componentDeploymentSpecSchema.default({}),
  status: componentDeploymentStatusSchema.default({}),
})
export type LocalComponentDeployment = z.infer<
  typeof localComponentDeploymentSchema
>

// ── System deployment ───────────────────────────────────────

export const localSystemDeploymentSchema = z.object({
  slug: z.string(),
  systemSlug: z.string(),
  runtime: z.string().default("docker-compose"),
  composeFiles: z.array(z.string()).default([]),
  connectionTarget: z.string().optional(),
  profileName: z.string().optional(),
  componentDeployments: z.array(localComponentDeploymentSchema).default([]),
  resolvedEnv: z.record(resolvedEnvEntrySchema).default({}),
  tunnels: z.array(tunnelSpecSchema).default([]),
})
export type LocalSystemDeployment = z.infer<typeof localSystemDeploymentSchema>

// ── Site state (root) ───────────────────────────────────────

export const siteInfoSchema = z.object({
  slug: z.string(),
  type: z.string(),
})
export type SiteInfo = z.infer<typeof siteInfoSchema>

export const workbenchInfoSchema = z.object({
  slug: z.string(),
  type: z.string(),
  realmType: z.string().optional(),
  ownerType: z.enum(["user", "agent"]).default("user"),
})
export type WorkbenchInfo = z.infer<typeof workbenchInfoSchema>

export const siteStateSchema = z.object({
  site: siteInfoSchema,
  workbench: workbenchInfoSchema,
  systemDeployments: z.array(localSystemDeploymentSchema).default([]),
  updatedAt: z.string(),
})
export type SiteState = z.infer<typeof siteStateSchema>
