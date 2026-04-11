import { z } from "zod"

// ── Subscription Kind ─────────────────────────────────────

export const SubscriptionKindSchema = z.enum(["trigger", "stream"])
export type SubscriptionKind = z.infer<typeof SubscriptionKindSchema>

export const EventSubscriptionStatusSchema = z.enum([
  "active",
  "fired",
  "expired",
  "paused",
])
export type EventSubscriptionStatus = z.infer<
  typeof EventSubscriptionStatusSchema
>

export const OwnerKindSchema = z.enum([
  "workflow",
  "principal",
  "team",
  "system",
])
export type OwnerKind = z.infer<typeof OwnerKindSchema>

export const DeliveryModeSchema = z.enum(["realtime", "batch", "digest"])
export type DeliveryMode = z.infer<typeof DeliveryModeSchema>

// ── Escalation Policy ─────────────────────────────────────

export const EscalationStepSchema = z.object({
  delayMinutes: z.number().min(1),
  targetPrincipalId: z.string(),
})

export const EscalationPolicySchema = z.object({
  steps: z.array(EscalationStepSchema).min(1),
})

// ── Subscription Spec ─────────────────────────────────────

export const EventSubscriptionSpecSchema = z.object({
  muted: z.boolean().optional(),
  mutedUntil: z.string().datetime().optional(),
  quietHoursStart: z.string().optional(),
  quietHoursEnd: z.string().optional(),
  timezone: z.string().optional(),
  escalationPolicy: EscalationPolicySchema.optional(),
})
export type EventSubscriptionSpec = z.infer<typeof EventSubscriptionSpecSchema>

// ── Channel Spec ──────────────────────────────────────────

export const EventSubscriptionChannelSpecSchema = z.object({
  rateLimit: z.object({ maxPerHour: z.number().min(1) }).optional(),
  batchWindow: z.string().optional(),
  schedule: z.string().optional(),
  template: z.string().optional(),
})
export type EventSubscriptionChannelSpec = z.infer<
  typeof EventSubscriptionChannelSpecSchema
>

// ── Create Inputs ─────────────────────────────────────────

export const CreateTriggerInputSchema = z.object({
  topicFilter: z.string().min(1),
  matchFields: z.record(z.unknown()).optional(),
  ownerKind: z.literal("workflow"),
  ownerId: z.string(),
  expiresAt: z.string().datetime(),
})
export type CreateTriggerInput = z.infer<typeof CreateTriggerInputSchema>

export const CreateStreamInputSchema = z.object({
  name: z.string().min(1),
  topicFilter: z.string().min(1),
  matchFields: z.record(z.unknown()).optional(),
  minSeverity: z.enum(["debug", "info", "warning", "critical"]).optional(),
  scopeKind: z.string().optional(),
  scopeId: z.string().optional(),
  ownerKind: z.enum(["principal", "team", "system"]),
  ownerId: z.string(),
  spec: EventSubscriptionSpecSchema.optional(),
  channels: z
    .array(
      z.object({
        channelId: z.string(),
        delivery: DeliveryModeSchema,
        minSeverity: z
          .enum(["debug", "info", "warning", "critical"])
          .optional(),
        spec: EventSubscriptionChannelSpecSchema.optional(),
      })
    )
    .optional(),
})
export type CreateStreamInput = z.infer<typeof CreateStreamInputSchema>

// ── Alert ─────────────────────────────────────────────────

export const AlertStatusSchema = z.enum([
  "firing",
  "acknowledged",
  "resolved",
  "escalated",
])
export type AlertStatus = z.infer<typeof AlertStatusSchema>
