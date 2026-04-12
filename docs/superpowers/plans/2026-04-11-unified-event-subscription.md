# Unified Event Subscription — Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the workflow event subscription system (`org.event_subscription` with `workflowRunId` + `eventName`) and the planned notification subscription model (`notification_sub`) into a single polymorphic `org.event_subscription` table that handles both transient workflow triggers and persistent notification streams.

**Why:** Every mature event system (EventBridge, Azure Event Grid, NATS) treats "match events by criteria X, do action Y" as one concept. Splitting workflow subscriptions and notification subscriptions into separate tables creates redundant matching logic, naming confusion, and makes it harder to add future subscription kinds (e.g., webhook callbacks, queue forwarding). The matching criteria are identical — only the action differs.

**Architecture:** One `event_subscription` table with `kind` discriminating between `"trigger"` (fire-once, transient, for workflows) and `"stream"` (persistent, ongoing, for notifications). The owner is polymorphic via `owner_kind` + `owner_id`. Stream subscriptions have child rows in `event_subscription_channel` for multi-channel delivery. All subscriptions use NATS-style `topic_filter` with wildcard matching, replacing the old `eventName` exact-match field. The workflow bridge in `events.ts` is eliminated — the unified matching handles both workflows and notifications in one pass.

**Tech Stack:** Drizzle ORM, Vitest, NATS wildcard matching (from WebSocket gateway plan)

**Spec:** `docs/superpowers/specs/2026-04-11-unified-event-system-design.md` (Section 6)

**Depends on:**

- `docs/superpowers/plans/2026-04-11-unified-event-system-core.md` (event table, emitEvent, topic matcher)

**Supersedes:**

- The `notification_sub` / `notification_sub_channel` tables from Plan 4 (notification routing) — replaced by unified `event_subscription` / `event_subscription_channel`
- The workflow bridge in `api/src/lib/events.ts:175` — matching is unified

---

## Taxonomy Reference

**How other systems name this:**

| System           | Match Concept                   | Action Concept            | Model                            |
| ---------------- | ------------------------------- | ------------------------- | -------------------------------- |
| AWS EventBridge  | Rule (event pattern)            | Target (Lambda, SQS)      | 1 rule → N targets               |
| Azure Event Grid | Event Subscription              | Endpoint (webhook, queue) | subscription = filter + endpoint |
| NATS JetStream   | Consumer (filter subject)       | Deliver policy            | consumer = filter + delivery     |
| Inngest          | Event trigger (`event:`, `if:`) | Function handler          | trigger declared on function     |
| Temporal         | Signal name                     | Workflow handler          | signal name = subscription       |

**Our unified model** follows Azure Event Grid: subscription = filter + polymorphic action. But we add `kind` to distinguish transient triggers from persistent streams, avoiding the need for separate tables.

---

## Unified Schema

### `org.event_subscription`

```
┌──────────────────────────────────────────────────────────────────────┐
│ event_subscription                                                   │
├──────────────────┬───────────────────────────────────────────────────┤
│ id               │ esub_*  (keep existing prefix)                   │
│ name             │ human label (nullable — triggers often unnamed)   │
│ kind             │ "trigger" | "stream"                              │
│ status           │ "active" | "fired" | "expired" | "paused"        │
│ topic_filter     │ NATS wildcards: "ops.workbench.>", "pr.opened"   │
│ match_fields     │ JSONB containment filter (same <@ semantics)     │
│ min_severity     │ severity floor (nullable — null = match all)      │
│ scope_kind       │ scope filter (nullable — null = any scope)        │
│ scope_id         │ scope filter value                                │
│ owner_kind       │ "workflow" | "principal" | "team" | "system"     │
│ owner_id         │ workflowRunId / principalId / teamId / "system"  │
│ spec             │ JSONB: mute, quiet hours, escalation policy       │
│ expires_at       │ set for triggers, null for streams                │
│ created_at       │ timestamp                                         │
│ updated_at       │ timestamp                                         │
└──────────────────┴───────────────────────────────────────────────────┘
```

### `org.event_subscription_channel`

```
┌──────────────────────────────────────────────────────────────────────┐
│ event_subscription_channel                                           │
├──────────────────┬───────────────────────────────────────────────────┤
│ id               │ esch_*                                            │
│ subscription_id  │ FK → event_subscription (CASCADE delete)          │
│ channel_id       │ FK → org.channel                                  │
│ delivery         │ "realtime" | "batch" | "digest"                   │
│ min_severity     │ per-channel override (nullable)                   │
│ spec             │ JSONB: rate limit, batch window, template         │
│ last_delivered_at│ for batch/digest scheduling                       │
│ created_at       │ timestamp                                         │
└──────────────────┴───────────────────────────────────────────────────┘
```

### How it maps

| Use Case                     | kind      | owner_kind  | owner_id        | topic_filter                 | expires_at | channels                            |
| ---------------------------- | --------- | ----------- | --------------- | ---------------------------- | ---------- | ----------------------------------- |
| Workflow waits for workbench | `trigger` | `workflow`  | `wfrun_123`     | `workbench.ready`            | +10min     | none                                |
| Workflow waits for PR        | `trigger` | `workflow`  | `wfrun_123`     | `pr.opened`                  | +1hr       | none                                |
| Alice wants deploy alerts    | `stream`  | `principal` | `prin_alice`    | `ops.component_deployment.>` | null       | Slack DM (realtime), email (digest) |
| #ops-alerts channel          | `stream`  | `system`    | `system`        | `ops.*.failed`               | null       | Slack #ops-alerts (realtime)        |
| Team notification            | `stream`  | `team`      | `team_platform` | `infra.>`                    | null       | web (realtime)                      |

---

## File Map

| Action | File                                        | Responsibility                                                    |
| ------ | ------------------------------------------- | ----------------------------------------------------------------- |
| Modify | `api/src/db/schema/org.ts`                  | Replace `eventSubscription` table, add `eventSubscriptionChannel` |
| Modify | `api/src/lib/id.ts`                         | Add `"esch"` prefix                                               |
| Modify | `api/src/lib/workflow-events.ts`            | Update `waitForEvent` + `emitEvent` to use new schema             |
| Modify | `api/src/lib/events.ts`                     | Remove bridge, integrate unified matching                         |
| Modify | `api/src/lib/workflow-events.test.ts`       | Update tests for new column names                                 |
| Modify | `api/src/lib/events.test.ts`                | Update bridge tests → unified matching tests                      |
| Create | `shared/src/schemas/event-subscription.ts`  | Zod schemas for unified subscription model                        |
| Modify | `shared/src/schemas/index.ts`               | Export new schemas                                                |
| Modify | `api/src/modules/workflow/triggers/rest.ts` | Update REST endpoints for new shape                               |
| Modify | `api/src/test-helpers.ts`                   | Update truncate for renamed/new tables                            |

---

## Task 1: Unified Subscription Drizzle Schema

**Files:**

- Modify: `api/src/db/schema/org.ts`
- Modify: `api/src/lib/id.ts`
- Modify: `api/src/test-helpers.ts`

- [ ] **Step 1: Replace the `eventSubscription` table definition**

In `api/src/db/schema/org.ts`, replace the existing `eventSubscription` table (lines 964–995) with:

```typescript
// ─── Event Subscription ──────────────────────────────────
// Unified event subscription: covers both transient workflow triggers
// and persistent notification streams.
//
// kind = "trigger": fire-once, wakes a workflow, has expiresAt
// kind = "stream":  persistent, delivers to channels, ongoing

export const eventSubscription = orgSchema.table(
  "event_subscription",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("esub")),

    name: text("name"),

    /** Discriminator: "trigger" (transient, fire-once) | "stream" (persistent). */
    kind: text("kind").notNull(),

    /** Lifecycle: active → fired/expired (triggers) or active ↔ paused (streams). */
    status: text("status").notNull().default("active"),

    /**
     * NATS-style topic filter with wildcards.
     * Examples: "workbench.ready", "ops.>", "ops.*.failed"
     */
    topicFilter: text("topic_filter").notNull(),

    /**
     * JSONB fields that must be a subset of the emitted event data.
     * Uses Postgres <@ (contained-by) operator for matching.
     */
    matchFields: jsonb("match_fields"),

    /** Minimum event severity to match. Null = match all severities. */
    minSeverity: text("min_severity"),

    /** Scope filter — only match events in this scope. Null = any scope. */
    scopeKind: text("scope_kind"),
    scopeId: text("scope_id"),

    /**
     * Who owns this subscription.
     * workflow  → owner_id is workflowRunId
     * principal → owner_id is principalId
     * team      → owner_id is teamId
     * system    → owner_id is "system"
     */
    ownerKind: text("owner_kind").notNull(),
    ownerId: text("owner_id").notNull(),

    /** Kind-specific config: mute, quiet hours, escalation policy, etc. */
    spec: specCol<EventSubscriptionSpec>(),

    /** Auto-expire for triggers. Null for streams. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("org_esub_topic_filter_idx").on(t.topicFilter),
    index("org_esub_kind_idx").on(t.kind),
    index("org_esub_status_idx").on(t.status),
    index("org_esub_owner_idx").on(t.ownerKind, t.ownerId),
    // GIN index for JSONB containment queries on matchFields
    index("org_esub_match_fields_gin_idx").using(
      "gin",
      sql`COALESCE(${t.matchFields}, '{}'::jsonb)`
    ),
  ]
)
```

Where `EventSubscriptionSpec` is:

```typescript
interface EventSubscriptionSpec {
  muted?: boolean
  mutedUntil?: string
  quietHoursStart?: string
  quietHoursEnd?: string
  timezone?: string
  escalationPolicy?: {
    steps: Array<{
      delayMinutes: number
      targetPrincipalId: string
    }>
  }
}
```

- [ ] **Step 2: Add the `eventSubscriptionChannel` table**

Below the subscription table:

```typescript
// ─── Event Subscription Channel ─────────────────────────
// How a stream subscription delivers — many channels per subscription.
// Only used for kind = "stream". Triggers don't have channels.

export const eventSubscriptionChannel = orgSchema.table(
  "event_subscription_channel",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("esch")),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => eventSubscription.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull(),
    delivery: text("delivery").notNull(), // "realtime" | "batch" | "digest"
    minSeverity: text("min_severity"),
    spec: specCol<EventSubscriptionChannelSpec>(),
    lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("org_esch_sub_idx").on(t.subscriptionId),
    index("org_esch_channel_idx").on(t.channelId),
    index("org_esch_delivery_idx").on(t.delivery),
  ]
)
```

Where `EventSubscriptionChannelSpec` is:

```typescript
interface EventSubscriptionChannelSpec {
  rateLimit?: { maxPerHour: number }
  batchWindow?: string
  schedule?: string
  template?: string
}
```

- [ ] **Step 3: Add `"esch"` to ID prefixes**

In `api/src/lib/id.ts`, add `"esch"` to the `EntityPrefix` type union.

- [ ] **Step 4: Export the new table from schema barrel**

Ensure `eventSubscriptionChannel` is exported from `api/src/db/schema/index.ts` (the existing `eventSubscription` export stays, just the shape changes).

- [ ] **Step 5: Update test-helpers.ts**

Add truncate for `event_subscription_channel` before `event_subscription`:

```typescript
await db.execute(sql`TRUNCATE org.event_subscription_channel CASCADE`)
await db.execute(sql`TRUNCATE org.event_subscription CASCADE`)
```

- [ ] **Step 6: Generate migration**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo/api && pnpm db:generate`

This will detect the column changes (dropped `workflowRunId`, `eventName`; added `kind`, `status`, `topicFilter`, `ownerKind`, `ownerId`, `minSeverity`, `scopeKind`, `scopeId`, `spec`, `updatedAt`, and `name`; `matchFields` becomes nullable). Plus the new `event_subscription_channel` table.

Answer rename prompts:

- `event_name` → `topic_filter`: **Yes** (this is a rename)
- `workflow_run_id` → `owner_id`: **Yes** (this is a rename)
- Any other column renames: use judgment, say **Yes** if it's semantically the same data

- [ ] **Step 7: Write a custom data migration**

After drizzle generates the structural migration, create a custom migration file to backfill existing rows:

```sql
-- Backfill existing workflow subscriptions with new columns
UPDATE org.event_subscription SET
  kind = 'trigger',
  status = CASE
    WHEN expires_at IS NOT NULL AND expires_at < now() THEN 'expired'
    ELSE 'active'
  END,
  owner_kind = 'workflow'
  -- owner_id is already the old workflow_run_id (renamed)
  -- topic_filter is already the old event_name (renamed)
WHERE kind IS NULL;
```

- [ ] **Step 8: Commit**

```bash
git add api/src/db/schema/org.ts api/src/lib/id.ts api/src/test-helpers.ts api/src/db/schema/index.ts api/drizzle/
git commit -m "feat(events): unify event_subscription schema — trigger + stream kinds, polymorphic owner

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Unified Subscription Zod Schemas

**Files:**

- Create: `shared/src/schemas/event-subscription.ts`
- Modify: `shared/src/schemas/index.ts`

- [ ] **Step 1: Create the Zod schemas**

Create `shared/src/schemas/event-subscription.ts`:

```typescript
import { z } from "zod"

// ── Subscription Kind ─────────────────────────────────────

export const SubscriptionKindSchema = z.enum(["trigger", "stream"])
export type SubscriptionKind = z.infer<typeof SubscriptionKindSchema>

export const SubscriptionStatusSchema = z.enum([
  "active",
  "fired",
  "expired",
  "paused",
])
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>

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

/** Create a trigger subscription (for workflows). */
export const CreateTriggerInputSchema = z.object({
  topicFilter: z.string().min(1),
  matchFields: z.record(z.unknown()).optional(),
  ownerKind: z.literal("workflow"),
  ownerId: z.string(), // workflowRunId
  expiresAt: z.string().datetime(),
})
export type CreateTriggerInput = z.infer<typeof CreateTriggerInputSchema>

/** Create a stream subscription (for notifications). */
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
```

- [ ] **Step 2: Export from shared barrel**

In `shared/src/schemas/index.ts`, add:

```typescript
export * from "./event-subscription"
```

- [ ] **Step 3: Verify typecheck**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-shared exec tsgo --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add shared/src/schemas/event-subscription.ts shared/src/schemas/index.ts
git commit -m "feat(events): add unified event subscription Zod schemas (trigger + stream)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Update `waitForEvent()` — New Schema Shape

**Files:**

- Modify: `api/src/lib/workflow-events.ts`

The workflow side writes `kind: "trigger"`, `ownerKind: "workflow"`, `ownerId: workflowRunId`, `topicFilter` instead of `eventName`.

- [ ] **Step 1: Update `waitForEvent()`**

Replace the function in `api/src/lib/workflow-events.ts`:

```typescript
export async function waitForEvent<T>(
  eventName: string,
  match: Record<string, string>,
  timeoutSec: number
): Promise<T | null> {
  const db = getWorkflowDb()
  const wfId = getWorkflowId()

  logger.info(
    { eventName, match, workflowRunId: wfId, timeoutSec },
    `waitForEvent: subscribing to ${eventName}`
  )

  // Register subscription as a trigger
  await db.insert(eventSubscription).values({
    id: newId("esub"),
    kind: "trigger",
    status: "active",
    topicFilter: eventName,
    matchFields: match,
    ownerKind: "workflow",
    ownerId: wfId,
    expiresAt: new Date(Date.now() + timeoutSec * 1000),
  })

  // Durable suspend — zero CPU, survives crashes
  const result = await recv<T>(eventName, timeoutSec)

  // Clean up subscription (best-effort, may already be gone on timeout)
  await db
    .delete(eventSubscription)
    .where(
      and(
        eq(eventSubscription.ownerId, wfId),
        eq(eventSubscription.topicFilter, eventName),
        eq(eventSubscription.kind, "trigger")
      )
    )
    .catch(() => {})

  return result
}
```

**Note:** The function signature stays identical — callers don't change. Only the internal column names change (`eventName` → `topicFilter`, `workflowRunId` → `ownerId`).

- [ ] **Step 2: Update `emitEvent()` (workflow-events.ts)**

Replace the `emitEvent` function:

```typescript
export async function emitEvent(
  db: Database,
  eventName: string,
  data: Record<string, unknown>
) {
  // Find non-expired trigger subscriptions where matchFields ⊆ data
  const subs = await db
    .select()
    .from(eventSubscription)
    .where(
      and(
        eq(eventSubscription.topicFilter, eventName),
        eq(eventSubscription.kind, "trigger"),
        eq(eventSubscription.status, "active"),
        sql`COALESCE(${eventSubscription.matchFields}, '{}') <@ ${JSON.stringify(data)}::jsonb`,
        gt(eventSubscription.expiresAt, new Date())
      )
    )

  logger.info(
    { eventName, matchCount: subs.length },
    `emitEvent: ${eventName} (${subs.length} match${subs.length === 1 ? "" : "es"})`
  )

  // Wake each matching workflow
  for (const sub of subs) {
    logger.info(
      { eventName, workflowRunId: sub.ownerId },
      "emitEvent: waking workflow"
    )
    await send(sub.ownerId, data, eventName)

    // Mark trigger as fired
    await db
      .update(eventSubscription)
      .set({ status: "fired" })
      .where(eq(eventSubscription.id, sub.id))
  }
}
```

- [ ] **Step 3: Update `cleanupExpiredSubscriptions()`**

```typescript
export async function cleanupExpiredSubscriptions(db: Database) {
  await db
    .delete(eventSubscription)
    .where(
      and(
        eq(eventSubscription.kind, "trigger"),
        lt(eventSubscription.expiresAt, new Date())
      )
    )
}
```

- [ ] **Step 4: Commit**

```bash
git add api/src/lib/workflow-events.ts
git commit -m "feat(events): update waitForEvent/emitEvent to use unified subscription schema

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Update Workflow Events Tests

**Files:**

- Modify: `api/src/lib/workflow-events.test.ts`

- [ ] **Step 1: Update test setup to use new column names**

The tests insert directly into `eventSubscription` — update all `.values()` calls to use the new shape:

```typescript
// Before:
await db.insert(eventSubscription).values({
  id: newId("esub"),
  workflowRunId: "wf-test-1",
  eventName: "workbench.ready",
  matchFields: { workbenchId: "wb-123" },
  expiresAt: new Date(Date.now() + 600_000),
})

// After:
await db.insert(eventSubscription).values({
  id: newId("esub"),
  kind: "trigger",
  status: "active",
  topicFilter: "workbench.ready",
  matchFields: { workbenchId: "wb-123" },
  ownerKind: "workflow",
  ownerId: "wf-test-1",
  expiresAt: new Date(Date.now() + 600_000),
})
```

Update all assertions that reference `sub.workflowRunId` → `sub.ownerId` and `sub.eventName` → `sub.topicFilter`.

- [ ] **Step 2: Add test for trigger status lifecycle**

Add a test verifying that after `emitEvent` wakes a workflow, the subscription's status changes to `"fired"`:

```typescript
it("marks trigger subscription as fired after matching", async () => {
  const subId = newId("esub")
  await db.insert(eventSubscription).values({
    id: subId,
    kind: "trigger",
    status: "active",
    topicFilter: "workbench.ready",
    matchFields: { workbenchId: "wb-123" },
    ownerKind: "workflow",
    ownerId: "wf-test-fired",
    expiresAt: new Date(Date.now() + 600_000),
  })

  await emitEvent(db, "workbench.ready", {
    workbenchId: "wb-123",
    status: "active",
  })

  const [sub] = await db
    .select()
    .from(eventSubscription)
    .where(eq(eventSubscription.id, subId))

  expect(sub.status).toBe("fired")
})
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run src/lib/workflow-events.test.ts 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add api/src/lib/workflow-events.test.ts
git commit -m "test(events): update workflow event tests for unified subscription schema

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Remove Workflow Bridge from Canonical Events

**Files:**

- Modify: `api/src/lib/events.ts`
- Modify: `api/src/lib/events.test.ts`

The bridge in `events.ts:175` strips the domain prefix and calls legacy `emitEvent()` from `workflow-events.ts`. With the unified model, the canonical `emitEvent()` in `events.ts` should directly match ALL subscription kinds — both triggers and streams — in one pass.

- [ ] **Step 1: Replace the bridge with unified matching**

In `api/src/lib/events.ts`, replace `bridgeToWorkflowSubscriptions()` with `matchSubscriptions()`:

```typescript
import { eventSubscription } from "../db/schema/org"
import { matchTopic } from "../modules/events/topic-matcher"
import { severityGte } from "../modules/events/scope-resolver"
import { send } from "./workflow-engine"

/**
 * Match an event against all active subscriptions.
 *
 * For triggers (workflows): wakes the workflow via DBOS send(), marks as fired.
 * For streams (notifications): handled by the notification router via NATS
 *   (so we skip them here — the outbox relay → NATS → notification router
 *   path handles stream subscriptions).
 */
async function matchSubscriptions(
  db: Database,
  topic: string,
  severity: string,
  scopeKind: string,
  scopeId: string,
  data: Record<string, unknown>
): Promise<void> {
  // Only match triggers here — streams are handled by the NATS notification router
  const subs = await db
    .select()
    .from(eventSubscription)
    .where(
      and(
        eq(eventSubscription.kind, "trigger"),
        eq(eventSubscription.status, "active"),
        gt(eventSubscription.expiresAt, new Date())
      )
    )

  // Filter in application code using NATS wildcard matching
  // (Postgres can't do NATS wildcard matching in SQL)
  const matched = subs.filter((sub) => {
    // Topic filter
    if (!matchTopic(sub.topicFilter, topic)) return false

    // Severity filter
    if (sub.minSeverity && !severityGte(severity, sub.minSeverity)) return false

    // Scope filter
    if (sub.scopeKind && sub.scopeId) {
      if (scopeKind !== sub.scopeKind || scopeId !== sub.scopeId) return false
    }

    // JSONB containment (in-app check; DB also has GIN index for pre-filtering)
    if (sub.matchFields) {
      const fields = sub.matchFields as Record<string, unknown>
      for (const [key, value] of Object.entries(fields)) {
        if (data[key] !== value) return false
      }
    }

    return true
  })

  logger.info(
    { topic, triggerMatches: matched.length },
    "matchSubscriptions: matched triggers"
  )

  for (const sub of matched) {
    // Wake workflow
    await send(sub.ownerId, data, topic)

    // Mark as fired
    await db
      .update(eventSubscription)
      .set({ status: "fired" })
      .where(eq(eventSubscription.id, sub.id))

    logger.info(
      { topic, workflowRunId: sub.ownerId },
      "matchSubscriptions: woke workflow"
    )
  }
}
```

- [ ] **Step 2: Update `emitEvent()` to call `matchSubscriptions()` instead of bridge**

Replace lines 115–122 in `api/src/lib/events.ts`:

```typescript
// Before:
await bridgeToWorkflowSubscriptions(db, topic, data).catch(...)

// After:
await matchSubscriptions(db, topic, severity, scopeKind, scopeId, data).catch((err) => {
  logger.warn(
    { eventId: id, topic, err },
    "emitEvent: subscription matching failed"
  )
})
```

- [ ] **Step 3: Delete the `bridgeToWorkflowSubscriptions()` function**

Remove the entire function (lines 175–188) and its import of legacy `emitEvent`.

- [ ] **Step 4: Update `events.test.ts`**

Replace bridge-related tests with unified matching tests. The key behavioral change: workflows can now subscribe to full canonical topics (`ops.workbench.ready`) OR bare topics (`workbench.ready`) — the wildcard matcher handles both.

Add a test:

```typescript
it("wakes workflow triggers when canonical event matches topic filter", async () => {
  // Insert a trigger subscription for "workbench.ready"
  await db.insert(eventSubscription).values({
    id: newId("esub"),
    kind: "trigger",
    status: "active",
    topicFilter: "workbench.ready",
    matchFields: { workbenchId: "wb-test" },
    ownerKind: "workflow",
    ownerId: "wf-canonical-test",
    expiresAt: new Date(Date.now() + 600_000),
  })

  // Emit a canonical event — topic is "ops.workbench.ready"
  // The matcher should also try without domain prefix for backward compat
  const eventId = await emitEvent(db, {
    topic: "ops.workbench.ready",
    source: "test",
    data: { workbenchId: "wb-test", status: "active" },
  })

  expect(eventId).toBeTruthy()
  // Verify the trigger was fired (check status)
  // ... (depends on whether we match "workbench.ready" against "ops.workbench.ready")
})
```

**Important consideration:** Existing workflows use bare event names (`workbench.ready`), but canonical events use domain-prefixed topics (`ops.workbench.ready`). The `matchSubscriptions()` function should try both the full topic AND the domain-stripped version, to maintain backward compatibility during migration. Add to the matching logic:

```typescript
// Also try domain-stripped version for backward compat with legacy triggers
const parts = topic.split(".")
const strippedTopic = parts.length >= 3 ? parts.slice(1).join(".") : null

const matched = subs.filter((sub) => {
  if (matchTopic(sub.topicFilter, topic)) {
    /* proceed with other checks */
  } else if (strippedTopic && matchTopic(sub.topicFilter, strippedTopic)) {
    /* proceed */
  } else return false
  // ... rest of checks
})
```

This means workflows don't need to change their `waitForEvent("workbench.ready", ...)` calls immediately. They'll match when `ops.workbench.ready` is emitted.

- [ ] **Step 5: Run tests**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run src/lib/events.test.ts 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/lib/events.ts api/src/lib/events.test.ts
git commit -m "feat(events): replace workflow bridge with unified subscription matching

Canonical emitEvent() now directly matches trigger subscriptions using
NATS wildcard topic matching. Domain-stripped fallback preserves backward
compatibility with existing waitForEvent() callers.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Update REST Endpoints + God Workflow

**Files:**

- Modify: `api/src/modules/workflow/triggers/rest.ts`

- [ ] **Step 1: Update the subscriptions list endpoint**

The GET `/workflow/subscriptions` endpoint queries by `workflowRunId`. Update to use `ownerId` + `ownerKind`:

```typescript
// Before:
.where(eq(eventSubscription.workflowRunId, workflowRunId))

// After:
.where(
  and(
    eq(eventSubscription.ownerId, workflowRunId),
    eq(eventSubscription.ownerKind, "workflow")
  )
)
```

- [ ] **Step 2: Verify god-workflow and echo-workflow compile**

These files import `waitForEvent` — the function signature hasn't changed, so they should compile without modification. Verify:

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec tsgo --noEmit 2>&1 | head -30`

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/workflow/triggers/rest.ts
git commit -m "feat(events): update workflow REST endpoints for unified subscription schema

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Canonical Domain Topics for External Events

**Files:**

- Modify: `api/src/lib/event-canonicalizers.ts`
- Modify: `api/src/lib/event-canonicalizers.test.ts`

The current GitHub canonicalizer maps `push` → `ext.github.push`. That's the raw vendor topic. But our domain vocabulary should have canonical topics like `build.pr.opened` — vendor-agnostic, same as how Claude Code and Cursor both canonicalize to `org.agent.session_started`.

The principle: `ext.*` topics preserve "what the vendor said." Domain topics (`build.*`, `org.*`, `ops.*`) are "what happened in our vocabulary." Both exist — the canonical event has the domain topic in `topic`, the vendor topic is reconstructable from `source` + `rawEventType`.

- [ ] **Step 1: Update the GitHub canonicalizer**

In `api/src/lib/event-canonicalizers.ts`, replace the GitHub handler:

```typescript
const github: Canonicalizer = (raw) => {
  switch (raw.eventType) {
    case "push":
      return {
        topic: "build.push.received",
        entityKind: "repository",
        severity: "info",
        data: raw.payload,
      }
    case "pull_request.opened":
      return {
        topic: "build.pr.opened",
        entityKind: "pull_request",
        severity: "info",
        data: raw.payload,
      }
    case "pull_request.closed":
      return {
        topic: raw.payload.merged ? "build.pr.merged" : "build.pr.closed",
        entityKind: "pull_request",
        severity: "info",
        data: raw.payload,
      }
    case "pull_request_review_comment.created":
    case "issue_comment.created":
      return {
        topic: "build.pr.commented",
        entityKind: "pull_request",
        severity: "info",
        data: raw.payload,
      }
    case "check_run.completed":
      return {
        topic:
          raw.payload.conclusion === "success"
            ? "build.pipeline.completed"
            : "build.pipeline.failed",
        entityKind: "pipeline",
        severity: raw.payload.conclusion === "success" ? "info" : "warning",
        data: raw.payload,
      }
    default:
      // Unknown GitHub events fall through to ext.github.*
      return {
        topic: `ext.github.${raw.eventType}`,
        entityKind: "repository",
        severity: "info",
        data: raw.payload,
      }
  }
}
```

- [ ] **Step 2: Similarly update Slack and Jira canonicalizers**

```typescript
const slack: Canonicalizer = (raw) => {
  switch (raw.eventType) {
    case "message":
      return {
        topic: "org.thread.turn_added",
        entityKind: "channel",
        severity: "info",
        data: { source: "slack", ...raw.payload },
      }
    default:
      return {
        topic: `ext.slack.${raw.eventType}`,
        entityKind: "channel",
        severity: "info",
        data: raw.payload,
      }
  }
}

const jira: Canonicalizer = (raw) => {
  switch (raw.eventType) {
    case "issue_updated":
      return {
        topic: "ops.work_item.updated",
        entityKind: "work_item",
        severity: "info",
        data: raw.payload,
      }
    case "issue_created":
      return {
        topic: "ops.work_item.created",
        entityKind: "work_item",
        severity: "info",
        data: raw.payload,
      }
    default:
      return {
        topic: `ext.jira.${raw.eventType}`,
        entityKind: "issue",
        severity: "info",
        data: raw.payload,
      }
  }
}
```

- [ ] **Step 3: Update canonicalizer tests**

Update `api/src/lib/event-canonicalizers.test.ts` to verify domain topics:

```typescript
it("canonicalizes GitHub push to build.push.received", () => {
  const result = canonicalize({
    source: "github",
    eventType: "push",
    payload: { ref: "refs/heads/main" },
  })
  expect(result.topic).toBe("build.push.received")
})

it("canonicalizes GitHub PR opened to build.pr.opened", () => {
  const result = canonicalize({
    source: "github",
    eventType: "pull_request.opened",
    payload: { prNumber: 42, repoFullName: "org/repo" },
  })
  expect(result.topic).toBe("build.pr.opened")
  expect(result.entityKind).toBe("pull_request")
})

it("canonicalizes GitHub PR comment to build.pr.commented", () => {
  const result = canonicalize({
    source: "github",
    eventType: "issue_comment.created",
    payload: { comment: "LGTM" },
  })
  expect(result.topic).toBe("build.pr.commented")
})

it("falls back to ext.github.* for unknown GitHub events", () => {
  const result = canonicalize({
    source: "github",
    eventType: "deployment_status",
    payload: {},
  })
  expect(result.topic).toBe("ext.github.deployment_status")
})
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run src/lib/event-canonicalizers.test.ts 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/event-canonicalizers.ts api/src/lib/event-canonicalizers.test.ts
git commit -m "feat(events): canonicalize vendor events to domain topics (build.pr.opened, etc.)

GitHub, Slack, Jira events now map to our domain vocabulary, not just
ext.{vendor}.{raw}. Unknown vendor events still fall through to ext.*.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Migrate Producers to Canonical Events

**Files:**

- Modify: `api/src/reconciler/reconciler.ts`
- Modify: `api/src/reconciler/preview-reconciler.ts`
- Modify: `api/src/modules/build/webhook.service.ts`
- Modify: `api/src/modules/workflow/workflows/god-workflow.ts`

This switches all producers from legacy `emitEvent()` (workflow-events.ts) to canonical `emitEvent()` (events.ts), and updates god-workflow to use domain topic names.

- [ ] **Step 1: Update reconciler.ts**

```typescript
// Before (line 22):
import { emitEvent } from "../lib/workflow-events"

// After:
import { emitEvent } from "../lib/events"

// Before (line 615):
await emitEvent(this.db, "workbench.ready", {
  workbenchId,
  status: "active",
})

// After:
await emitEvent(this.db, {
  topic: "ops.workbench.ready",
  source: "reconciler",
  severity: "info",
  entityKind: "workbench",
  entityId: workbenchId,
  data: { workbenchId, status: "active" },
})
```

- [ ] **Step 2: Update preview-reconciler.ts**

```typescript
// Before:
import { emitEvent } from "../lib/workflow-events"
await emitEvent(this.db, "preview.ready", {
  branchName,
  previewUrl,
  previewSlug,
})

// After:
import { emitEvent } from "../lib/events"
await emitEvent(this.db, {
  topic: "ops.preview.ready",
  source: "reconciler",
  severity: "info",
  entityKind: "preview",
  data: { branchName, previewUrl, previewSlug },
})
```

- [ ] **Step 3: Update webhook.service.ts**

The webhook service currently calls legacy `emitEvent()` with bare names like `pr.opened`. Switch to canonical `emitExternalEvent()` which handles canonicalization automatically:

```typescript
// Before:
import { emitEvent } from "../../lib/workflow-events"
await emitEvent(db, "pr.opened", { repoFullName, branchName, prNumber, prUrl })

// After:
import { emitExternalEvent } from "../../lib/events"
await emitExternalEvent(db, {
  source: "github",
  eventType: "pull_request.opened",
  payload: { repoFullName, branchName, prNumber, prUrl },
  providerId: repoFullName,
  deliveryId: deliveryId,
})
// Canonicalizer maps this to topic: "build.pr.opened"
```

Similarly for PR comments:

```typescript
// Before:
await emitEvent(db, "pr.comment", { repoFullName, prNumber, comment, author })

// After:
await emitExternalEvent(db, {
  source: "github",
  eventType: "issue_comment.created",
  payload: { repoFullName, prNumber: String(prNumber), comment, author },
  providerId: repoFullName,
  deliveryId: deliveryId,
})
// Canonicalizer maps this to topic: "build.pr.commented"
```

- [ ] **Step 4: Update god-workflow to use domain topics**

```typescript
// Before:
const wsEvent = await waitForEvent<{ workbenchId: string; status: string }>(
  "workbench.ready",
  { workbenchId: workbench.id },
  600
)

// After:
const wsEvent = await waitForEvent<{ workbenchId: string; status: string }>(
  "ops.workbench.ready",
  { workbenchId: workbench.id },
  600
)

// Before:
const prEvent = await waitForEvent<{
  prNumber: number
  prUrl: string
  branchName: string
}>("pr.opened", { repoFullName: input.repoFullName, branchName }, 3600)

// After:
const prEvent = await waitForEvent<{
  prNumber: number
  prUrl: string
  branchName: string
}>("build.pr.opened", { repoFullName: input.repoFullName, branchName }, 3600)

// Before:
const pvEvent = await waitForEvent<{ previewUrl: string; previewSlug: string }>(
  "preview.ready",
  { branchName },
  600
)

// After:
const pvEvent = await waitForEvent<{ previewUrl: string; previewSlug: string }>(
  "ops.preview.ready",
  { branchName },
  600
)

// Before:
const comment = await waitForEvent<{
  comment: string
  author: string
  prNumber: number
}>("pr.comment", { repoFullName, prNumber: String(prNumber) }, 86400)

// After:
const comment = await waitForEvent<{
  comment: string
  author: string
  prNumber: number
}>("build.pr.commented", { repoFullName, prNumber: String(prNumber) }, 86400)
```

Now both producers and consumers speak the same domain vocabulary. No bridge, no domain-stripping, no dual-emit.

- [ ] **Step 5: Update echo-workflow if it uses waitForEvent**

Check and update similarly.

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run 2>&1 | tail -30`

- [ ] **Step 7: Commit**

```bash
git add api/src/reconciler/reconciler.ts api/src/reconciler/preview-reconciler.ts api/src/modules/build/webhook.service.ts api/src/modules/workflow/workflows/god-workflow.ts api/src/modules/workflow/workflows/echo-workflow.ts
git commit -m "feat(events): migrate all producers + god-workflow to canonical domain topics

Reconciler emits ops.workbench.ready, ops.preview.ready.
Webhook service uses emitExternalEvent → build.pr.opened, build.pr.commented.
God-workflow waits on domain topics directly. No bridge needed.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Remove Domain-Stripped Fallback

**Files:**

- Modify: `api/src/lib/events.ts`
- Modify: `api/src/lib/events.test.ts`

After Task 8, all producers and consumers use domain topics. The domain-stripped fallback in `matchSubscriptions()` (from Task 5) is no longer needed.

- [ ] **Step 1: Remove the fallback**

In `matchSubscriptions()`, remove the `strippedTopic` logic:

```typescript
// Remove:
const parts = topic.split(".")
const strippedTopic = parts.length >= 3 ? parts.slice(1).join(".") : null

// Simplify matching to just:
const matched = subs.filter((sub) => {
  if (!matchTopic(sub.topicFilter, topic)) return false
  // ... rest of checks
})
```

- [ ] **Step 2: Remove fallback tests, verify remaining pass**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run src/lib/events.test.ts 2>&1 | tail -20`

- [ ] **Step 3: Commit**

```bash
git add api/src/lib/events.ts api/src/lib/events.test.ts
git commit -m "feat(events): remove domain-stripped fallback — all callers use canonical topics

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Summary

| Task | What it does                                                                                   | Breaking changes                                                     |
| ---- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1    | Drizzle schema: replace narrow `eventSubscription`, add `eventSubscriptionChannel`             | Column renames: `eventName`→`topicFilter`, `workflowRunId`→`ownerId` |
| 2    | Zod schemas: trigger input, stream input, channel spec, alert status                           | None                                                                 |
| 3    | Update `waitForEvent()` + `emitEvent()` in workflow-events.ts                                  | Internal only — function signatures unchanged                        |
| 4    | Update workflow event tests                                                                    | None                                                                 |
| 5    | Remove bridge, add unified `matchSubscriptions()` in events.ts (with domain-stripped fallback) | Bridge eliminated — matching is direct                               |
| 6    | Update REST endpoints + verify workflow compilation                                            | Query column names                                                   |
| 7    | Canonical domain topics for external events (build.pr.opened, etc.)                            | Canonicalizer output changes                                         |
| 8    | Migrate all producers + god-workflow to domain topics                                          | Producers + consumers speak canonical vocabulary                     |
| 9    | Remove domain-stripped fallback (cleanup)                                                      | Fallback removed — no longer needed                                  |

## Topic Hierarchy (Final)

```
# Domain events (what subscriptions match against)
ops.workbench.ready              ← reconciler
ops.workbench.created            ← API mutations
ops.preview.ready                ← preview reconciler
ops.component_deployment.drifted ← reconciler
build.pr.opened                  ← GitHub/GitLab/Bitbucket webhook
build.pr.commented               ← GitHub/GitLab webhook
build.pr.merged                  ← GitHub/GitLab webhook
build.push.received              ← GitHub/GitLab webhook
build.pipeline.completed         ← GitHub Actions / CI webhook
build.pipeline.failed            ← GitHub Actions / CI webhook
org.agent.session_started        ← Claude Code / Cursor / any AI tool
org.agent.session_completed      ← Claude Code / Cursor
org.agent.tool_called            ← Claude Code / Cursor
org.thread.created               ← chat handlers
ops.work_item.created            ← Jira / Linear webhook
ops.work_item.updated            ← Jira / Linear webhook

# Raw vendor topics (preserved in rawEventType, NOT the canonical topic)
# These are NOT used as topic values — they're stored in rawEventType field
# github:push, github:pull_request.opened, jira:issue_updated, etc.

# Fallback for unknown vendor events (canonical topic IS ext.*)
ext.github.deployment_status     ← unmapped GitHub events
ext.slack.reaction               ← unmapped Slack events
ext.jira.sprint_updated          ← unmapped Jira events
```

## What This Enables for Plan 4

After this migration, Plan 4 (notification routing) should use `event_subscription` with `kind: "stream"` and `event_subscription_channel` — no separate `notification_sub` tables. The notification router's subscription matching queries the same `event_subscription` table, filtered by `kind = "stream"` and `status = "active"`. The storm detector, renderers, delivery tracking (`event_delivery`), aggregates (`event_aggregate`), and alerts (`event_alert`) from Plan 4 remain unchanged — they reference the unified `event_subscription` via FK.
