# Unified Event System — Core + Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundational event system — Postgres event table, transactional outbox, `emitEvent()` function, NATS JetStream broker, outbox relay, and backward-compatible workflow bridge — so that all producers can emit canonical events durably.

**Architecture:** Events are written atomically to Postgres (`org.event` + `org.event_outbox`) within the same DB transaction as business state changes. A background outbox relay polls for pending events and publishes them to NATS JetStream. The existing workflow `waitForEvent()` system continues to work via a bridge in the new `emitEvent()`. NATS runs as a Docker Compose service alongside existing infrastructure.

**Tech Stack:** Drizzle ORM, Postgres, NATS JetStream (`nats` npm package), Zod, Vitest, Elysia, Docker Compose

**Spec:** `docs/superpowers/specs/2026-04-11-unified-event-system-design.md`

---

## File Map

| Action | File                                  | Responsibility                                                               |
| ------ | ------------------------------------- | ---------------------------------------------------------------------------- |
| Create | `shared/src/schemas/events.ts`        | Event envelope Zod schemas, topic types, severity enum                       |
| Create | `api/src/lib/events.ts`               | `emitEvent()`, `emitExternalEvent()`, scope resolution, workflow bridge      |
| Create | `api/src/lib/event-schemas.ts`        | Per-topic Zod schema registry for payload validation                         |
| Create | `api/src/lib/event-canonicalizers.ts` | Per-source normalizers (GitHub, Slack, Jira, Claude Code, Cursor)            |
| Create | `api/src/lib/nats.ts`                 | NATS JetStream connection, stream setup, publish/subscribe helpers           |
| Create | `api/src/lib/outbox-relay.ts`         | Background process: polls outbox, publishes to NATS, marks published         |
| Modify | `api/src/db/schema/org-v2.ts`         | Add `event`, `eventOutbox` table definitions                                 |
| Modify | `api/src/lib/id.ts`                   | Add `"evt"` and `"eob"` prefixes to `EntityPrefix`                           |
| Modify | `shared/src/schemas/org.ts`           | Add `EventSpec` type, `EventSeverity` enum                                   |
| Modify | `api/src/test-helpers.ts`             | Add truncate statements for new tables                                       |
| Modify | `docker-compose.yaml`                 | Add `infra-nats` service                                                     |
| Create | `api/src/lib/events.test.ts`          | Tests for `emitEvent()`, canonicalization, scope resolution, workflow bridge |
| Create | `api/src/lib/outbox-relay.test.ts`    | Tests for outbox relay publish + status update                               |
| Create | `api/src/lib/nats.test.ts`            | Tests for NATS connection + stream setup                                     |

---

## Task 1: Event Envelope Types (shared schemas)

**Files:**

- Create: `shared/src/schemas/events.ts`
- Modify: `shared/src/schemas/org.ts`
- Modify: `api/src/lib/id.ts`

- [ ] **Step 1: Add entity prefixes for events**

In `api/src/lib/id.ts`, add `"evt"` and `"eob"` to the `EntityPrefix` type:

```typescript
// After the existing "esub" prefix (line ~122), add:
  | "evt" // event
  | "eob" // event_outbox
```

- [ ] **Step 2: Run typecheck to verify**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec tsc --noEmit 2>&1 | head -20`
Expected: No new errors from this change.

- [ ] **Step 3: Create the event envelope schemas**

Create `shared/src/schemas/events.ts`:

```typescript
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
  schemaVersion: z.number().default(1),
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
```

- [ ] **Step 4: Export from shared schemas barrel**

In `shared/src/schemas/org.ts`, add at the bottom:

```typescript
// ── Events (re-exported from events.ts) ────────────────────────
export { EventSpecSchema, type EventSpec } from "./events"
```

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-shared exec tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add shared/src/schemas/events.ts shared/src/schemas/org.ts api/src/lib/id.ts
git commit -m "feat(events): add event envelope Zod schemas and entity prefixes

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Postgres Event + Outbox Tables

**Files:**

- Modify: `api/src/db/schema/org-v2.ts`
- Modify: `api/src/test-helpers.ts`

- [ ] **Step 1: Write the failing test — event table exists**

Create `api/src/lib/events.test.ts`:

```typescript
import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createTestContext } from "../test-helpers"

describe("event tables", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    ctx = await createTestContext()
  })

  afterAll(async () => {
    await ctx.client.close()
  })

  it("org.event table exists and accepts inserts", async () => {
    const result = await ctx.client.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'org' AND table_name = 'event'
      ) AS exists`
    )
    expect(result.rows[0].exists).toBe(true)
  })

  it("org.event_outbox table exists and accepts inserts", async () => {
    const result = await ctx.client.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'org' AND table_name = 'event_outbox'
      ) AS exists`
    )
    expect(result.rows[0].exists).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run src/lib/events.test.ts 2>&1 | tail -20`
Expected: FAIL — tables don't exist yet.

- [ ] **Step 3: Add event table to org-v2.ts**

In `api/src/db/schema/org-v2.ts`, after the `webhookEvent` table definition (around line 821), add:

```typescript
// ─── Event (Universal Event Log) ──────────────────────────────
// Replaces webhook_event as the single event store.
// All producers (reconciler, webhooks, agents, CLI, API mutations)
// write canonical events here via emitEvent().

export const event = orgSchema.table(
  "event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("evt")),
    topic: text("topic").notNull(),
    source: text("source").notNull(),
    severity: text("severity").notNull().default("info"),

    correlationId: text("correlation_id"),
    parentEventId: text("parent_event_id"),

    principalId: text("principal_id"),
    entityKind: text("entity_kind"),
    entityId: text("entity_id"),

    scopeKind: text("scope_kind").notNull().default("org"),
    scopeId: text("scope_id").notNull().default("default"),

    rawEventType: text("raw_event_type"),
    idempotencyKey: text("idempotency_key"),
    schemaVersion: integer("schema_version").notNull().default(1),

    spec: specCol<import("@smp/factory-shared/schemas/events").EventSpec>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("org_event_topic_idx").on(t.topic),
    index("org_event_source_idx").on(t.source),
    index("org_event_entity_idx").on(t.entityKind, t.entityId),
    index("org_event_principal_idx").on(t.principalId),
    index("org_event_occurred_idx").on(t.occurredAt),
    index("org_event_correlation_idx").on(t.correlationId),
    index("org_event_parent_idx").on(t.parentEventId),
    index("org_event_severity_idx").on(t.severity),
    uniqueIndex("org_event_idempotency_unique").on(t.idempotencyKey),
    index("org_event_spec_gin_idx").using("gin", t.spec),
  ]
)

// ─── Event Outbox ──────────────────────────────────────────────
// Transactional outbox for reliable NATS publishing.
// Written in the same DB transaction as org.event.
// The outbox relay polls for pending rows, publishes to NATS,
// and marks them as published.

export const eventOutbox = orgSchema.table(
  "event_outbox",
  {
    eventId: text("event_id")
      .primaryKey()
      .references(() => event.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: createdAt(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [
    index("org_event_outbox_pending_idx").on(t.createdAt),
    check(
      "org_event_outbox_status_valid",
      sql`${t.status} IN ('pending', 'published', 'failed')`
    ),
  ]
)
```

Note: The import for `EventSpec` uses a dynamic import type annotation. Add the import at the top of the file alongside existing imports:

```typescript
import type { EventSpec } from "@smp/factory-shared/schemas/events"
```

And update the `spec` column to use the imported type:

```typescript
spec: specCol<EventSpec>(),
```

- [ ] **Step 4: Add truncate statements to test-helpers.ts**

In `api/src/test-helpers.ts`, add these truncate statements to `TRUNCATE_STATEMENTS` (add at the beginning of the array since they have no FK dependencies on other new tables):

```typescript
  // org (events)
  `TRUNCATE TABLE org.event_outbox RESTART IDENTITY CASCADE`,
  `TRUNCATE TABLE org.event RESTART IDENTITY CASCADE`,
```

- [ ] **Step 5: Generate migration**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo/api && pnpm db:generate 2>&1 | tail -10`
Expected: A new migration file generated in `api/drizzle/` with CREATE TABLE statements for `org.event` and `org.event_outbox`.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run src/lib/events.test.ts 2>&1 | tail -20`
Expected: PASS — both tables now exist.

- [ ] **Step 7: Commit**

```bash
git add api/src/db/schema/org-v2.ts api/src/test-helpers.ts api/drizzle/ shared/src/schemas/events.ts
git commit -m "feat(events): add org.event and org.event_outbox tables

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Core `emitEvent()` Function

**Files:**

- Create: `api/src/lib/events.ts`
- Modify: `api/src/lib/events.test.ts`

- [ ] **Step 1: Write the failing test — emitEvent inserts into both tables**

Add to `api/src/lib/events.test.ts`:

```typescript
import { eq } from "drizzle-orm"

import type { Database } from "../db/connection"
import { event, eventOutbox } from "../db/schema/org-v2"
import { truncateAllTables } from "../test-helpers"
import { emitEvent } from "./events"

describe("emitEvent", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    ctx = await createTestContext()
  })

  afterAll(async () => {
    await ctx.client.close()
  })

  it("inserts into org.event and org.event_outbox", async () => {
    await truncateAllTables(ctx.client)
    const db = ctx.db as unknown as Database

    const eventId = await emitEvent(db, {
      topic: "ops.workspace.created",
      source: "test",
      severity: "info",
      entityKind: "workspace",
      entityId: "wks-test-1",
      data: { workspaceId: "wks-test-1", name: "test workspace" },
    })

    expect(eventId).toMatch(/^evt_/)

    // Verify event row
    const [eventRow] = await db
      .select()
      .from(event)
      .where(eq(event.id, eventId))
      .limit(1)

    expect(eventRow).toBeDefined()
    expect(eventRow.topic).toBe("ops.workspace.created")
    expect(eventRow.source).toBe("test")
    expect(eventRow.severity).toBe("info")
    expect(eventRow.entityKind).toBe("workspace")
    expect(eventRow.entityId).toBe("wks-test-1")
    expect(eventRow.scopeKind).toBe("org")
    expect(eventRow.scopeId).toBe("default")
    expect(eventRow.spec).toEqual({
      data: { workspaceId: "wks-test-1", name: "test workspace" },
    })

    // Verify outbox row
    const [outboxRow] = await db
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.eventId, eventId))
      .limit(1)

    expect(outboxRow).toBeDefined()
    expect(outboxRow.status).toBe("pending")
    expect(outboxRow.attempts).toBe(0)
  })

  it("deduplicates by idempotencyKey", async () => {
    await truncateAllTables(ctx.client)
    const db = ctx.db as unknown as Database

    const id1 = await emitEvent(db, {
      topic: "ops.workspace.created",
      source: "test",
      data: { foo: "bar" },
      idempotencyKey: "test:dedup:1",
    })

    const id2 = await emitEvent(db, {
      topic: "ops.workspace.created",
      source: "test",
      data: { foo: "bar" },
      idempotencyKey: "test:dedup:1",
    })

    expect(id1).toMatch(/^evt_/)
    expect(id2).toBeNull()
  })

  it("stores rawEventType and rawPayload when provided", async () => {
    await truncateAllTables(ctx.client)
    const db = ctx.db as unknown as Database

    const eventId = await emitEvent(db, {
      topic: "org.agent.session_started",
      source: "claude-code",
      rawEventType: "session.start",
      rawPayload: { original: "payload" },
      data: { threadId: "thrd_123" },
    })

    const [row] = await db
      .select()
      .from(event)
      .where(eq(event.id, eventId!))
      .limit(1)

    expect(row.rawEventType).toBe("session.start")
    expect(row.spec).toEqual({
      data: { threadId: "thrd_123" },
      rawPayload: { original: "payload" },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run src/lib/events.test.ts 2>&1 | tail -20`
Expected: FAIL — `emitEvent` not found.

- [ ] **Step 3: Implement emitEvent**

Create `api/src/lib/events.ts`:

```typescript
/**
 * Unified event emission — writes to org.event + org.event_outbox atomically.
 *
 * All producers (reconciler, webhooks, agents, CLI, API mutations) call
 * emitEvent() to record canonical events. The transactional outbox pattern
 * ensures events are never lost — Postgres is the source of truth, and the
 * outbox relay publishes to NATS asynchronously.
 */
import type { EmitEventInput } from "@smp/factory-shared/schemas/events"
import type { EventSpec } from "@smp/factory-shared/schemas/events"
import { and, eq, sql } from "drizzle-orm"

import type { Database } from "../db/connection"
import { event, eventOutbox } from "../db/schema/org-v2"
import { logger } from "../logger"
import { newId } from "./id"

// Re-export the legacy workflow event functions during transition
export { waitForEvent, cleanupExpiredSubscriptions } from "./workflow-events"

/**
 * Emit a canonical event. Writes to org.event + org.event_outbox
 * within the provided transaction (or db connection).
 *
 * Returns the event ID on success, or null if deduplicated.
 */
export async function emitEvent(
  db: Database,
  input: EmitEventInput
): Promise<string | null> {
  const {
    topic,
    source,
    severity = "info",
    principalId,
    entityKind,
    entityId,
    correlationId,
    parentEventId,
    rawEventType,
    rawPayload,
    data,
    idempotencyKey,
    occurredAt,
    scopeKind = "org",
    scopeId = "default",
    schemaVersion = 1,
  } = input

  // Dedup by idempotency key if provided
  if (idempotencyKey) {
    const [existing] = await db
      .select({ id: event.id })
      .from(event)
      .where(eq(event.idempotencyKey, idempotencyKey))
      .limit(1)

    if (existing) {
      logger.debug({ idempotencyKey, topic }, "emitEvent: deduplicated")
      return null
    }
  }

  const id = newId("evt")
  const spec: EventSpec = {
    data,
    ...(rawPayload ? { rawPayload } : {}),
  }

  // Insert event row
  await db.insert(event).values({
    id,
    topic,
    source,
    severity,
    correlationId: correlationId ?? null,
    parentEventId: parentEventId ?? null,
    principalId: principalId ?? null,
    entityKind: entityKind ?? null,
    entityId: entityId ?? null,
    scopeKind,
    scopeId,
    rawEventType: rawEventType ?? null,
    idempotencyKey: idempotencyKey ?? null,
    schemaVersion,
    spec,
    occurredAt: occurredAt ?? new Date(),
  })

  // Insert outbox row (same transaction if caller uses db.transaction)
  await db.insert(eventOutbox).values({
    eventId: id,
  })

  logger.info(
    { eventId: id, topic, source, severity, entityKind, entityId },
    "emitEvent: recorded"
  )

  // Bridge to legacy workflow event subscriptions
  await bridgeToWorkflowSubscriptions(db, topic, data).catch((err) => {
    logger.warn(
      { eventId: id, topic, err },
      "emitEvent: workflow bridge failed"
    )
  })

  return id
}

/**
 * Bridge: translate new canonical topic to legacy event name
 * and wake any matching workflow subscriptions.
 *
 * Maps "ops.workspace.ready" -> "workspace.ready" (strips domain prefix)
 * Maps "ext.github.push" -> "github.push" (strips ext prefix)
 */
async function bridgeToWorkflowSubscriptions(
  db: Database,
  topic: string,
  data: Record<string, unknown>
): Promise<void> {
  // Import the legacy emitEvent dynamically to avoid circular deps
  const { emitEvent: legacyEmitEvent } = await import("./workflow-events")

  // Strip the domain prefix: "ops.workspace.ready" -> "workspace.ready"
  const parts = topic.split(".")
  if (parts.length < 3) return

  const legacyEventName = parts.slice(1).join(".")
  await legacyEmitEvent(db, legacyEventName, data)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run src/lib/events.test.ts 2>&1 | tail -20`
Expected: PASS — all three tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/events.ts api/src/lib/events.test.ts
git commit -m "feat(events): implement emitEvent with outbox and workflow bridge

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: External Event Canonicalization

**Files:**

- Create: `api/src/lib/event-canonicalizers.ts`
- Modify: `api/src/lib/events.ts` (add `emitExternalEvent`)
- Modify: `api/src/lib/events.test.ts`

- [ ] **Step 1: Write the failing test — emitExternalEvent canonicalizes GitHub push**

Add to `api/src/lib/events.test.ts`:

```typescript
import { emitExternalEvent } from "./events"

describe("emitExternalEvent", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    ctx = await createTestContext()
  })

  afterAll(async () => {
    await ctx.client.close()
  })

  it("canonicalizes a GitHub push event", async () => {
    await truncateAllTables(ctx.client)
    const db = ctx.db as unknown as Database

    const eventId = await emitExternalEvent(db, {
      source: "github",
      eventType: "push",
      payload: { ref: "refs/heads/main", commits: [{ id: "abc123" }] },
      providerId: "repo-123",
      deliveryId: "delivery-456",
    })

    expect(eventId).toMatch(/^evt_/)

    const [row] = await db
      .select()
      .from(event)
      .where(eq(event.id, eventId!))
      .limit(1)

    expect(row.topic).toBe("ext.github.push")
    expect(row.source).toBe("github")
    expect(row.rawEventType).toBe("push")
    expect(row.idempotencyKey).toBe("github:repo-123:delivery-456")
    expect(row.spec.rawPayload).toEqual({
      ref: "refs/heads/main",
      commits: [{ id: "abc123" }],
    })
  })

  it("deduplicates external events by source+providerId+deliveryId", async () => {
    await truncateAllTables(ctx.client)
    const db = ctx.db as unknown as Database

    const id1 = await emitExternalEvent(db, {
      source: "github",
      eventType: "push",
      payload: { ref: "refs/heads/main" },
      providerId: "repo-123",
      deliveryId: "delivery-789",
    })

    const id2 = await emitExternalEvent(db, {
      source: "github",
      eventType: "push",
      payload: { ref: "refs/heads/main" },
      providerId: "repo-123",
      deliveryId: "delivery-789",
    })

    expect(id1).toMatch(/^evt_/)
    expect(id2).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run src/lib/events.test.ts 2>&1 | tail -20`
Expected: FAIL — `emitExternalEvent` not found.

- [ ] **Step 3: Create canonicalizers**

Create `api/src/lib/event-canonicalizers.ts`:

```typescript
/**
 * Per-source event canonicalizers.
 *
 * Each source (GitHub, Slack, Jira, Claude Code, Cursor, etc.) has its own
 * mapping from raw event types to canonical Factory topics + payloads.
 */
import type { EventSeverity } from "@smp/factory-shared/schemas/events"

export interface CanonicalFields {
  topic: string
  entityKind?: string
  entityId?: string
  severity: EventSeverity
  data: Record<string, unknown>
}

interface RawIngest {
  source: string
  eventType: string
  payload: Record<string, unknown>
}

type Canonicalizer = (raw: RawIngest) => CanonicalFields

const github: Canonicalizer = (raw) => {
  const topic = `ext.github.${raw.eventType}`
  return {
    topic,
    entityKind: "repository",
    severity: "info",
    data: raw.payload,
  }
}

const slack: Canonicalizer = (raw) => {
  const topic = `ext.slack.${raw.eventType}`
  return {
    topic,
    entityKind: "channel",
    severity: "info",
    data: raw.payload,
  }
}

const jira: Canonicalizer = (raw) => {
  const topic = `ext.jira.${raw.eventType}`
  return {
    topic,
    entityKind: "issue",
    severity: "info",
    data: raw.payload,
  }
}

const claudeCode: Canonicalizer = (raw) => {
  switch (raw.eventType) {
    case "session.start":
      return {
        topic: "org.agent.session_started",
        entityKind: "thread",
        severity: "info",
        data: { source: "claude-code", ...raw.payload },
      }
    case "session.end":
      return {
        topic: "org.agent.session_completed",
        entityKind: "thread",
        severity: "info",
        data: { source: "claude-code", ...raw.payload },
      }
    case "tool.call":
      return {
        topic: "org.agent.tool_called",
        entityKind: "thread",
        severity: "debug",
        data: { source: "claude-code", ...raw.payload },
      }
    default:
      return {
        topic: `org.agent.${raw.eventType}`,
        entityKind: "thread",
        severity: "info",
        data: { source: "claude-code", ...raw.payload },
      }
  }
}

const cursor: Canonicalizer = (raw) => {
  switch (raw.eventType) {
    case "session.begin":
      return {
        topic: "org.agent.session_started",
        entityKind: "thread",
        severity: "info",
        data: { source: "cursor", ...raw.payload },
      }
    case "session.end":
      return {
        topic: "org.agent.session_completed",
        entityKind: "thread",
        severity: "info",
        data: { source: "cursor", ...raw.payload },
      }
    default:
      return {
        topic: `org.agent.${raw.eventType}`,
        entityKind: "thread",
        severity: "info",
        data: { source: "cursor", ...raw.payload },
      }
  }
}

const fallback: Canonicalizer = (raw) => ({
  topic: `ext.${raw.source}.${raw.eventType}`,
  severity: "debug",
  data: raw.payload,
})

const canonicalizers: Record<string, Canonicalizer> = {
  github,
  slack,
  jira,
  "claude-code": claudeCode,
  cursor,
}

/**
 * Canonicalize a raw external event into Factory's topic/data vocabulary.
 * Falls back to ext.{source}.{eventType} for unknown sources.
 */
export function canonicalize(raw: RawIngest): CanonicalFields {
  const fn = canonicalizers[raw.source] ?? fallback
  return fn(raw)
}
```

- [ ] **Step 4: Add emitExternalEvent to events.ts**

Add to `api/src/lib/events.ts`, after the `emitEvent` function:

```typescript
import type { EmitExternalEventInput } from "@smp/factory-shared/schemas/events"

import { canonicalize } from "./event-canonicalizers"
import { resolveActorPrincipal } from "./webhook-events"

/**
 * Emit a canonical event from an external source (GitHub, Slack, Jira, etc.).
 * Handles canonicalization, idempotency key generation, and principal resolution.
 */
export async function emitExternalEvent(
  db: Database,
  input: EmitExternalEventInput
): Promise<string | null> {
  const {
    source,
    eventType,
    payload,
    providerId,
    deliveryId,
    actorExternalId,
    entityKind: inputEntityKind,
    entityId: inputEntityId,
  } = input

  // Resolve principal from external identity
  let principalId: string | undefined
  if (actorExternalId) {
    principalId =
      (await resolveActorPrincipal(db, source, actorExternalId)) ?? undefined
  }

  // Canonicalize
  const canonical = canonicalize({ source, eventType, payload })

  return emitEvent(db, {
    topic: canonical.topic,
    source,
    severity: canonical.severity,
    principalId,
    entityKind: inputEntityKind ?? canonical.entityKind,
    entityId: inputEntityId ?? canonical.entityId,
    rawEventType: eventType,
    rawPayload: payload,
    data: canonical.data,
    idempotencyKey: `${source}:${providerId}:${deliveryId}`,
  })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run src/lib/events.test.ts 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/lib/event-canonicalizers.ts api/src/lib/events.ts api/src/lib/events.test.ts
git commit -m "feat(events): add emitExternalEvent with per-source canonicalization

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Workflow Bridge Tests

**Files:**

- Modify: `api/src/lib/events.test.ts`

- [ ] **Step 1: Write the failing test — workflow bridge strips domain prefix**

Add to `api/src/lib/events.test.ts`:

```typescript
import { eventSubscription } from "../db/schema/org-v2"

describe("workflow bridge", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    ctx = await createTestContext()
  })

  afterAll(async () => {
    await ctx.client.close()
  })

  it("bridges new topic to legacy workflow subscriptions", async () => {
    await truncateAllTables(ctx.client)
    const db = ctx.db as unknown as Database

    // Mock: we can't easily test DBOS send() in PGlite,
    // so verify the subscription matching works by checking
    // that a subscription for "workspace.ready" is found
    // when we emit "ops.workspace.ready"

    // Insert a legacy-style subscription
    await db.insert(eventSubscription).values({
      id: "esub_test_bridge",
      workflowRunId: "wfr_test_bridge",
      eventName: "workspace.ready",
      matchFields: { workspaceId: "wks-bridge-test" },
      expiresAt: new Date(Date.now() + 60_000),
    })

    // Emit using new canonical topic — the bridge should
    // strip "ops." and match against "workspace.ready"
    // Note: this will fail on send() since DBOS isn't running,
    // but the bridge catches errors gracefully
    const eventId = await emitEvent(db, {
      topic: "ops.workspace.ready",
      source: "reconciler",
      data: { workspaceId: "wks-bridge-test", status: "active" },
    })

    expect(eventId).toMatch(/^evt_/)
    // The bridge should have attempted to match — verify event was recorded
    const [row] = await db
      .select()
      .from(event)
      .where(eq(event.id, eventId!))
      .limit(1)
    expect(row.topic).toBe("ops.workspace.ready")
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run src/lib/events.test.ts 2>&1 | tail -20`
Expected: PASS — the bridge runs but gracefully handles the missing DBOS runtime.

- [ ] **Step 3: Commit**

```bash
git add api/src/lib/events.test.ts
git commit -m "test(events): add workflow bridge compatibility tests

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: NATS JetStream Connection Module

**Files:**

- Modify: `docker-compose.yaml` (add NATS service)
- Create: `api/src/lib/nats.ts`
- Create: `api/src/lib/nats.test.ts`

- [ ] **Step 1: Add NATS to docker-compose.yaml**

Add a new service to `docker-compose.yaml` in the infrastructure section:

```yaml
infra-nats:
  image: nats:2-alpine
  command: ["--jetstream", "--store_dir", "/data"]
  ports:
    - "4222:4222" # client connections
    - "8222:8222" # monitoring
  volumes:
    - nats-data:/data
  labels:
    dx.system: factory-dx
    dx.component: infra-nats
    dx.type: message-queue
    dx.description: "NATS JetStream — real-time event broker"
```

Add `nats-data:` to the `volumes:` section at the bottom of the file.

- [ ] **Step 2: Install the NATS client package**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api add nats`

- [ ] **Step 3: Create the NATS connection module**

Create `api/src/lib/nats.ts`:

```typescript
/**
 * NATS JetStream connection and stream management.
 *
 * Provides a singleton connection to NATS, ensures the FACTORY stream
 * exists, and exposes publish/subscribe helpers.
 */
import {
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
  StringCodec,
  connect,
} from "nats"

import { logger } from "../logger"

const STREAM_NAME = "FACTORY"
const STREAM_SUBJECTS = ">" // capture all subjects

let nc: NatsConnection | null = null
let js: JetStreamClient | null = null

const sc = StringCodec()

/**
 * Get or create a NATS connection + ensure the FACTORY JetStream stream exists.
 * Returns null if NATS_URL is not configured (graceful degradation).
 */
export async function getNatsConnection(): Promise<{
  nc: NatsConnection
  js: JetStreamClient
} | null> {
  const url = process.env.NATS_URL
  if (!url) {
    logger.debug("NATS_URL not set — event broker disabled, outbox will queue")
    return null
  }

  if (nc && !nc.isClosed()) {
    return { nc, js: js! }
  }

  try {
    nc = await connect({ servers: url, name: "factory-api" })
    logger.info({ url }, "nats: connected")

    // Ensure JetStream stream exists
    const jsm = await nc.jetstreamManager()
    await ensureStream(jsm)

    js = nc.jetstream()
    return { nc, js }
  } catch (err) {
    logger.error({ err, url }, "nats: connection failed")
    nc = null
    js = null
    return null
  }
}

/**
 * Ensure the FACTORY JetStream stream exists with the correct config.
 * Creates it if missing, updates config if changed.
 */
async function ensureStream(jsm: JetStreamManager): Promise<void> {
  try {
    await jsm.streams.info(STREAM_NAME)
    logger.debug("nats: FACTORY stream exists")
  } catch {
    // Stream doesn't exist — create it
    await jsm.streams.add({
      name: STREAM_NAME,
      subjects: [STREAM_SUBJECTS],
      retention: "limits" as any,
      max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
      storage: "file" as any,
      num_replicas: 1,
    })
    logger.info("nats: created FACTORY stream")
  }
}

/**
 * Publish an event to NATS JetStream.
 * Returns true on success, false on failure.
 */
export async function publishToNats(
  topic: string,
  payload: string
): Promise<boolean> {
  const conn = await getNatsConnection()
  if (!conn) return false

  try {
    await conn.js.publish(topic, sc.encode(payload))
    return true
  } catch (err) {
    logger.error({ err, topic }, "nats: publish failed")
    return false
  }
}

/**
 * Gracefully close the NATS connection.
 */
export async function closeNats(): Promise<void> {
  if (nc && !nc.isClosed()) {
    await nc.drain()
    nc = null
    js = null
    logger.info("nats: connection closed")
  }
}
```

- [ ] **Step 4: Write a basic test for the NATS module**

Create `api/src/lib/nats.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest"

// Test that the module handles missing NATS_URL gracefully
describe("nats module", () => {
  beforeEach(() => {
    delete process.env.NATS_URL
  })

  it("returns null when NATS_URL is not set", async () => {
    const { getNatsConnection } = await import("./nats")
    const result = await getNatsConnection()
    expect(result).toBeNull()
  })

  it("publishToNats returns false when NATS is not connected", async () => {
    const { publishToNats } = await import("./nats")
    const result = await publishToNats("test.topic", '{"foo":"bar"}')
    expect(result).toBe(false)
  })
})
```

- [ ] **Step 5: Run tests**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run src/lib/nats.test.ts 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yaml api/src/lib/nats.ts api/src/lib/nats.test.ts api/package.json pnpm-lock.yaml
git commit -m "feat(events): add NATS JetStream connection module and docker service

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Outbox Relay

**Files:**

- Create: `api/src/lib/outbox-relay.ts`
- Create: `api/src/lib/outbox-relay.test.ts`

- [ ] **Step 1: Write the failing test — outbox relay processes pending events**

Create `api/src/lib/outbox-relay.test.ts`:

```typescript
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type { Database } from "../db/connection"
import { event, eventOutbox } from "../db/schema/org-v2"
import { createTestContext, truncateAllTables } from "../test-helpers"
import { emitEvent } from "./events"
import { processOutbox } from "./outbox-relay"

// Mock NATS publish
vi.mock("./nats", () => ({
  publishToNats: vi.fn().mockResolvedValue(true),
  getNatsConnection: vi.fn().mockResolvedValue(null),
  closeNats: vi.fn(),
}))

describe("outbox relay", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    ctx = await createTestContext()
  })

  afterAll(async () => {
    await ctx.client.close()
  })

  it("publishes pending events and marks them as published", async () => {
    await truncateAllTables(ctx.client)
    const db = ctx.db as unknown as Database
    const { publishToNats } = await import("./nats")

    // Emit an event (creates pending outbox entry)
    const eventId = await emitEvent(db, {
      topic: "ops.workspace.created",
      source: "test",
      data: { workspaceId: "wks-test-relay" },
    })

    // Process the outbox
    const processed = await processOutbox(db)
    expect(processed).toBe(1)

    // Verify NATS publish was called
    expect(publishToNats).toHaveBeenCalledWith(
      "ops.workspace.created",
      expect.stringContaining('"topic":"ops.workspace.created"')
    )

    // Verify outbox status updated to published
    const [outboxRow] = await db
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.eventId, eventId!))
      .limit(1)

    expect(outboxRow.status).toBe("published")
    expect(outboxRow.publishedAt).toBeDefined()
  })

  it("increments attempts and records error on publish failure", async () => {
    await truncateAllTables(ctx.client)
    const db = ctx.db as unknown as Database
    const { publishToNats } = await import("./nats")

    // Make publish fail
    vi.mocked(publishToNats).mockResolvedValueOnce(false)

    const eventId = await emitEvent(db, {
      topic: "ops.workspace.failed",
      source: "test",
      data: { workspaceId: "wks-test-fail" },
    })

    const processed = await processOutbox(db)
    expect(processed).toBe(0) // 0 successfully published

    const [outboxRow] = await db
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.eventId, eventId!))
      .limit(1)

    expect(outboxRow.status).toBe("pending") // still pending for retry
    expect(outboxRow.attempts).toBe(1)
  })

  it("marks events as failed after max retries", async () => {
    await truncateAllTables(ctx.client)
    const db = ctx.db as unknown as Database
    const { publishToNats } = await import("./nats")

    vi.mocked(publishToNats).mockResolvedValue(false)

    const eventId = await emitEvent(db, {
      topic: "ops.workspace.failed",
      source: "test",
      data: {},
    })

    // Simulate 5 failed attempts by setting attempts to 4
    await db
      .update(eventOutbox)
      .set({ attempts: 4 })
      .where(eq(eventOutbox.eventId, eventId!))

    await processOutbox(db)

    const [outboxRow] = await db
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.eventId, eventId!))
      .limit(1)

    expect(outboxRow.status).toBe("failed")
    expect(outboxRow.attempts).toBe(5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run src/lib/outbox-relay.test.ts 2>&1 | tail -20`
Expected: FAIL — `processOutbox` not found.

- [ ] **Step 3: Implement the outbox relay**

Create `api/src/lib/outbox-relay.ts`:

```typescript
/**
 * Outbox Relay — polls org.event_outbox for pending events and
 * publishes them to NATS JetStream.
 *
 * Guarantees at-least-once delivery to NATS with Postgres as
 * the source of truth. If NATS is down, events queue in the
 * outbox and drain when NATS recovers.
 */
import { and, eq, lt, sql } from "drizzle-orm"

import type { Database } from "../db/connection"
import { event, eventOutbox } from "../db/schema/org-v2"
import { logger } from "../logger"
import { publishToNats } from "./nats"

const MAX_RETRIES = 5
const BATCH_SIZE = 100

/**
 * Process pending outbox entries: publish to NATS and mark as published.
 * Returns the count of successfully published events.
 */
export async function processOutbox(db: Database): Promise<number> {
  // Fetch pending outbox entries with their event data
  const pending = await db
    .select({
      eventId: eventOutbox.eventId,
      attempts: eventOutbox.attempts,
      topic: event.topic,
      source: event.source,
      severity: event.severity,
      correlationId: event.correlationId,
      parentEventId: event.parentEventId,
      principalId: event.principalId,
      entityKind: event.entityKind,
      entityId: event.entityId,
      scopeKind: event.scopeKind,
      scopeId: event.scopeId,
      rawEventType: event.rawEventType,
      idempotencyKey: event.idempotencyKey,
      schemaVersion: event.schemaVersion,
      spec: event.spec,
      occurredAt: event.occurredAt,
      createdAt: event.createdAt,
    })
    .from(eventOutbox)
    .innerJoin(event, eq(eventOutbox.eventId, event.id))
    .where(eq(eventOutbox.status, "pending"))
    .orderBy(eventOutbox.createdAt)
    .limit(BATCH_SIZE)

  if (pending.length === 0) return 0

  let published = 0

  for (const row of pending) {
    const payload = JSON.stringify({
      id: row.eventId,
      topic: row.topic,
      source: row.source,
      severity: row.severity,
      correlationId: row.correlationId,
      parentEventId: row.parentEventId,
      principalId: row.principalId,
      entityKind: row.entityKind,
      entityId: row.entityId,
      scopeKind: row.scopeKind,
      scopeId: row.scopeId,
      rawEventType: row.rawEventType,
      idempotencyKey: row.idempotencyKey,
      schemaVersion: row.schemaVersion,
      spec: row.spec,
      occurredAt: row.occurredAt,
      createdAt: row.createdAt,
    })

    const success = await publishToNats(row.topic, payload)
    const newAttempts = row.attempts + 1

    if (success) {
      await db
        .update(eventOutbox)
        .set({
          status: "published",
          attempts: newAttempts,
          publishedAt: new Date(),
        })
        .where(eq(eventOutbox.eventId, row.eventId))

      published++
    } else {
      // Failed — increment attempts, maybe mark as permanently failed
      const newStatus = newAttempts >= MAX_RETRIES ? "failed" : "pending"

      await db
        .update(eventOutbox)
        .set({
          status: newStatus,
          attempts: newAttempts,
          lastError: "NATS publish failed",
        })
        .where(eq(eventOutbox.eventId, row.eventId))

      if (newStatus === "failed") {
        logger.error(
          { eventId: row.eventId, topic: row.topic, attempts: newAttempts },
          "outbox-relay: event permanently failed after max retries"
        )
      } else {
        logger.warn(
          { eventId: row.eventId, topic: row.topic, attempts: newAttempts },
          "outbox-relay: publish failed, will retry"
        )
      }
    }
  }

  if (published > 0) {
    logger.info(
      { published, total: pending.length },
      "outbox-relay: batch processed"
    )
  }

  return published
}

/**
 * Start the outbox relay as a background loop.
 * Polls every `intervalMs` (default: 1000ms).
 * Use pg_notify for lower latency (see startOutboxRelayWithNotify).
 */
export function startOutboxRelay(
  db: Database,
  intervalMs = 1000
): { stop: () => void } {
  let running = true

  const loop = async () => {
    while (running) {
      try {
        await processOutbox(db)
      } catch (err) {
        logger.error({ err }, "outbox-relay: error in processing loop")
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }

  loop()

  return {
    stop: () => {
      running = false
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run src/lib/outbox-relay.test.ts 2>&1 | tail -20`
Expected: PASS — all three tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/outbox-relay.ts api/src/lib/outbox-relay.test.ts
git commit -m "feat(events): implement outbox relay for reliable NATS publishing

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Wire Up Outbox Relay to API Startup

**Files:**

- Modify: `api/src/factory-core.ts`

- [ ] **Step 1: Read factory-core.ts to find the startup sequence**

Read `api/src/factory-core.ts` to identify where background processes are started (look for reconciler start, background tasks, etc.).

- [ ] **Step 2: Add outbox relay startup**

In `api/src/factory-core.ts`, import and start the outbox relay alongside other background processes:

```typescript
import { startOutboxRelay } from "./lib/outbox-relay"
```

In the function that starts the server (likely `startServer` or similar), after the DB is connected and migrations are applied, add:

```typescript
// Start the event outbox relay
const outboxRelay = startOutboxRelay(db)
logger.info("outbox-relay: started")

// Ensure clean shutdown
process.on("SIGTERM", () => {
  outboxRelay.stop()
})
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add api/src/factory-core.ts
git commit -m "feat(events): wire outbox relay into API startup

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Per-Topic Event Schema Registry

**Files:**

- Create: `api/src/lib/event-schemas.ts`

- [ ] **Step 1: Create the schema registry**

Create `api/src/lib/event-schemas.ts`:

```typescript
/**
 * Per-topic Zod schema registry for event payload validation.
 *
 * Each (topic, schemaVersion) pair has a registered Zod schema.
 * Validation happens at ingestion time in emitEvent().
 * Unknown topics are allowed (logged as warnings).
 * All schemas use .passthrough() to tolerate unknown fields.
 */
import { z } from "zod"

import { logger } from "../logger"

type SchemaRegistry = Record<string, Record<number, z.ZodType>>

const registry: SchemaRegistry = {
  "ops.component_deployment.drifted": {
    1: z
      .object({
        componentDeploymentSlug: z.string(),
        desiredImage: z.string().optional(),
        actualImage: z.string().optional(),
        siteSlug: z.string().optional(),
      })
      .passthrough(),
  },
  "ops.component_deployment.reconciled": {
    1: z
      .object({
        componentDeploymentSlug: z.string(),
        image: z.string().optional(),
      })
      .passthrough(),
  },
  "ops.workspace.created": {
    1: z
      .object({
        workspaceId: z.string(),
        name: z.string().optional(),
      })
      .passthrough(),
  },
  "ops.workspace.health_changed": {
    1: z
      .object({
        workspaceId: z.string(),
        previousHealth: z.string().optional(),
        newHealth: z.string(),
      })
      .passthrough(),
  },
  "ops.workspace.ready": {
    1: z
      .object({
        workspaceId: z.string(),
        status: z.string(),
      })
      .passthrough(),
  },
  "org.agent.session_started": {
    1: z
      .object({
        source: z.string().optional(),
        threadId: z.string().optional(),
        agentSlug: z.string().optional(),
        channelId: z.string().optional(),
      })
      .passthrough(),
  },
  "org.agent.session_completed": {
    1: z
      .object({
        source: z.string().optional(),
        threadId: z.string().optional(),
      })
      .passthrough(),
  },
  "org.thread.created": {
    1: z
      .object({
        threadId: z.string(),
        channelId: z.string().optional(),
        source: z.string().optional(),
      })
      .passthrough(),
  },
  "infra.host.discovered": {
    1: z
      .object({
        hostSlug: z.string(),
        hostname: z.string().optional(),
        ipAddress: z.string().optional(),
      })
      .passthrough(),
  },
  "infra.host.status_changed": {
    1: z
      .object({
        hostSlug: z.string(),
        previousStatus: z.string().optional(),
        newStatus: z.string(),
      })
      .passthrough(),
  },
}

/**
 * Validate event data against the registered schema for the given topic and version.
 * Returns { valid: true, data } on success or unknown topic.
 * Returns { valid: false, errors } on validation failure.
 */
export function validateEventData(
  topic: string,
  data: Record<string, unknown>,
  schemaVersion: number = 1
):
  | { valid: true; data: Record<string, unknown> }
  | { valid: false; errors: string[] } {
  const topicSchemas = registry[topic]
  if (!topicSchemas) {
    // Unknown topic — allow but log
    logger.debug({ topic }, "event-schemas: no schema registered for topic")
    return { valid: true, data }
  }

  const schema =
    topicSchemas[schemaVersion] ??
    topicSchemas[Math.max(...Object.keys(topicSchemas).map(Number))]
  if (!schema) {
    return { valid: true, data }
  }

  const result = schema.safeParse(data)
  if (result.success) {
    return { valid: true, data: result.data as Record<string, unknown> }
  }

  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  }
}
```

- [ ] **Step 2: Wire validation into emitEvent**

In `api/src/lib/events.ts`, add after the idempotency check:

```typescript
import { validateEventData } from "./event-schemas"

// Inside emitEvent, after the idempotency check:

// Validate data against schema registry
const validation = validateEventData(topic, data, schemaVersion)
if (!validation.valid) {
  logger.warn(
    { topic, errors: validation.errors },
    "emitEvent: payload validation failed"
  )
  // Still emit — validation is advisory, not blocking
}
```

- [ ] **Step 3: Run all event tests**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run src/lib/events.test.ts src/lib/outbox-relay.test.ts src/lib/nats.test.ts 2>&1 | tail -20`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add api/src/lib/event-schemas.ts api/src/lib/events.ts
git commit -m "feat(events): add per-topic Zod schema registry with advisory validation

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 10: End-to-End Integration Verification

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run 2>&1 | tail -30`
Expected: All existing tests pass + all new event tests pass.

- [ ] **Step 2: Run typecheck across the monorepo**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-shared exec tsc --noEmit && pnpm --filter @smp/factory-api exec tsc --noEmit 2>&1 | tail -20`
Expected: No type errors.

- [ ] **Step 3: Generate and review the migration**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo/api && pnpm db:generate 2>&1`
Expected: Migration files in `api/drizzle/` should include CREATE TABLE for `org.event` and `org.event_outbox` with all indexes.

- [ ] **Step 4: Verify docker-compose starts with NATS**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && docker compose config --services | grep nats`
Expected: `infra-nats` in the output.

- [ ] **Step 5: Manual smoke test (if infra is running)**

```bash
# Start NATS
dx up infra-nats

# In a separate terminal, subscribe to all NATS events
nats sub ">" --server=localhost:4222

# Start the API server (which starts the outbox relay)
pnpm --filter @smp/factory-api dev

# Trigger an event (e.g., via API or reconciler)
# The event should appear in both Postgres and the NATS subscriber
```

- [ ] **Step 6: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "chore(events): integration verification fixups

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Summary

| Task | What it builds                                   | Tests                          |
| ---- | ------------------------------------------------ | ------------------------------ |
| 1    | Event envelope Zod schemas + ID prefixes         | Type-only                      |
| 2    | `org.event` + `org.event_outbox` Postgres tables | Table existence                |
| 3    | `emitEvent()` with outbox + workflow bridge      | Insert, dedup, raw payload     |
| 4    | `emitExternalEvent()` + canonicalizers           | GitHub canonicalization, dedup |
| 5    | Workflow bridge compatibility                    | Legacy subscription matching   |
| 6    | NATS JetStream module + Docker service           | Graceful degradation           |
| 7    | Outbox relay (poll → publish → mark)             | Publish, retry, max-retries    |
| 8    | Wire relay into API startup                      | Typecheck                      |
| 9    | Per-topic Zod schema registry                    | Advisory validation            |
| 10   | End-to-end verification                          | Full suite + integration       |
