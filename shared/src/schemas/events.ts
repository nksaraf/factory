import { z } from "zod"

// ── Severity ──────────────────────────────────────────────────

export const EventSeveritySchema = z.enum([
  "critical",
  "warning",
  "info",
  "debug",
])
export type EventSeverity = z.infer<typeof EventSeveritySchema>

// ── Scope ─────────────────────────────────────────────────────

export const EventScopeKindSchema = z.enum([
  "org",
  "team",
  "project",
  "site",
  "principal",
  "system",
])
export type EventScopeKind = z.infer<typeof EventScopeKindSchema>

// ── Topic domains ─────────────────────────────────────────────

export const EventDomainSchema = z.enum([
  "infra",
  "ops",
  "software",
  "build",
  "org",
  "commerce",
  "ext",
  "cli",
])
export type EventDomain = z.infer<typeof EventDomainSchema>

// ── Event Spec (stored in JSONB `spec` column) ────────────────

export const EventSpecSchema = z.object({
  data: z.record(z.unknown()),
  rawPayload: z.record(z.unknown()).optional(),
})
export type EventSpec = z.infer<typeof EventSpecSchema>

// ── Full Event Envelope ───────────────────────────────────────

export const FactoryEventSchema = z.object({
  id: z.string(),
  topic: z.string(),
  source: z.string(),
  severity: EventSeveritySchema,

  correlationId: z.string().nullable().optional(),
  parentEventId: z.string().nullable().optional(),

  principalId: z.string().nullable().optional(),
  entityKind: z.string().nullable().optional(),
  entityId: z.string().nullable().optional(),

  scopeKind: EventScopeKindSchema,
  scopeId: z.string(),

  rawEventType: z.string().nullable().optional(),
  idempotencyKey: z.string().nullable().optional(),

  spec: EventSpecSchema,
  schemaVersion: z.number().default(1),

  occurredAt: z.coerce.date(),
  createdAt: z.coerce.date(),
})
export type FactoryEvent = z.infer<typeof FactoryEventSchema>

// ── emitEvent input ───────────────────────────────────────────

export const EmitEventInputSchema = z.object({
  topic: z.string(),
  source: z.string(),
  severity: EventSeveritySchema.default("info"),
  principalId: z.string().optional(),
  entityKind: z.string().optional(),
  entityId: z.string().optional(),
  correlationId: z.string().optional(),
  parentEventId: z.string().optional(),
  rawEventType: z.string().optional(),
  rawPayload: z.record(z.unknown()).optional(),
  data: z.record(z.unknown()),
  idempotencyKey: z.string().optional(),
  occurredAt: z.coerce.date().optional(),
  scopeKind: EventScopeKindSchema.optional(),
  scopeId: z.string().optional(),
  schemaVersion: z.number().optional().default(1),
})
export type EmitEventInput = z.infer<typeof EmitEventInputSchema>

// ── emitExternalEvent input ───────────────────────────────────

export const EmitExternalEventInputSchema = z.object({
  source: z.string(),
  eventType: z.string(),
  payload: z.record(z.unknown()),
  providerId: z.string(),
  deliveryId: z.string(),
  actorExternalId: z.string().optional(),
  entityKind: z.string().optional(),
  entityId: z.string().optional(),
})
export type EmitExternalEventInput = z.infer<
  typeof EmitExternalEventInputSchema
>
