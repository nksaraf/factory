# Event Notification Routing — Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a notification routing system that matches events to user/team/system subscriptions, renders per-channel output, delivers via multiple channels (Slack, email, web, CLI), tracks delivery, and protects against notification storms via sliding-window aggregation.

**Architecture:** A NATS JetStream consumer reads all events, matches them against `org.event_subscription` rows with `kind = "stream"` (topic filter + scope + severity + JSONB match), then fans out to per-channel delivery via `org.event_subscription_channel`. Delivery is tracked in `org.event_delivery`. Storm protection uses an in-memory sliding-window counter that switches to aggregate mode when thresholds are exceeded. Alerts with escalation policies create `org.event_alert` rows processed by a periodic escalation worker. Batch/digest delivery is handled by a separate periodic worker.

**Tech Stack:** Drizzle ORM, NATS JetStream (`nats` npm), Zod, Vitest

**Spec:** `docs/superpowers/specs/2026-04-11-unified-event-system-design.md` (Sections 6.1–6.7)

**Depends on:**
- `docs/superpowers/plans/2026-04-11-unified-event-system-core.md` (event tables, emitEvent, NATS)
- `docs/superpowers/plans/2026-04-11-unified-event-subscription.md` (unified event_subscription + event_subscription_channel tables, topic matcher)

**Key change from v1:** Uses the unified `event_subscription` table (with `kind = "stream"`) and `event_subscription_channel` instead of the previously planned `notification_sub` / `notification_sub_channel` tables.

---

## File Map

| Action | File                                                      | Responsibility                                                         |
| ------ | --------------------------------------------------------- | ---------------------------------------------------------------------- |
| Modify | `api/src/db/schema/org.ts`                                | Add event_delivery, event_aggregate, event_alert tables                |
| Modify | `api/src/lib/id.ts`                                       | Add `"edlv"`, `"eagg"`, `"ealt"` prefixes                             |
| Create | `api/src/modules/events/storm-detector.ts`                | Sliding-window counter, aggregate mode switching                       |
| Create | `api/src/modules/events/storm-detector.test.ts`           | Tests for storm detection thresholds                                   |
| Create | `api/src/modules/events/event-renderers.ts`               | Per-channel-type renderers (Slack blocks, CLI ANSI, web, email)        |
| Create | `api/src/modules/events/event-renderers.test.ts`          | Tests for rendering output                                             |
| Create | `api/src/modules/events/notification-router.ts`           | NATS consumer → match stream subscriptions → dispatch to channels      |
| Create | `api/src/modules/events/notification-router.test.ts`      | Tests for subscription matching, storm detection, delivery             |
| Create | `api/src/modules/events/escalation-worker.ts`             | Periodic worker: escalate unacknowledged alerts                        |
| Create | `api/src/modules/events/batch-delivery-worker.ts`         | Periodic worker: deliver batch/digest notifications                    |
| Create | `api/src/modules/events/scope-resolver.ts`                | Resolve event scope, check principal access                            |
| Create | `api/src/modules/events/scope-resolver.test.ts`           | Tests for scope resolution                                             |
| Modify | `api/src/modules/events/index.ts`                         | Wire notification router + workers into the event module               |
| Modify | `api/src/test-helpers.ts`                                 | Add truncate for new tables                                            |

---

## Task 1: Delivery, Aggregate, and Alert Tables

**Files:**

- Modify: `api/src/db/schema/org.ts`
- Modify: `api/src/lib/id.ts`
- Modify: `api/src/test-helpers.ts`

**Context:** The unified `event_subscription` and `event_subscription_channel` tables already exist from the subscription migration plan. This task adds the remaining tables needed for notification routing: delivery tracking, storm aggregates, and alerts.

- [ ] **Step 1: Add event delivery tracking table**

In `api/src/db/schema/org.ts`, after the `eventSubscriptionChannel` table, add:

```typescript
// ─── Event Delivery ─────────────────────────────────────────────
// Tracks delivery status for each event × subscription channel combination.

export const eventDelivery = orgSchema.table(
  "event_delivery",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("edlv")),
    eventId: text("event_id").notNull(),
    subscriptionChannelId: text("subscription_channel_id").notNull(),
    status: text("status").notNull().default("pending"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    spec: jsonb("spec").$type<{
      error?: string
      retryCount?: number
      renderOutput?: unknown
    }>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("org_edlv_status_idx")
      .on(t.status)
      .where(sql`${t.status} IN ('pending', 'buffered')`),
    index("org_edlv_event_idx").on(t.eventId),
    index("org_edlv_channel_idx").on(t.subscriptionChannelId),
  ]
)
```

- [ ] **Step 2: Add event aggregate table (storm protection)**

```typescript
// ─── Event Aggregate ────────────────────────────────────────────
// Collects events during storm conditions into summary records.

export const eventAggregate = orgSchema.table(
  "event_aggregate",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("eagg")),
    correlationId: text("correlation_id"),
    topicPrefix: text("topic_prefix").notNull(),
    scopeId: text("scope_id"),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }),
    eventCount: bigint("event_count", { mode: "number" }).notNull().default(0),
    sampleEventId: text("sample_event_id"),
    maxSeverity: text("max_severity").notNull().default("info"),
    status: text("status").notNull().default("open"),
    spec: jsonb("spec").$type<{
      summary?: string
      eventIds?: string[]
    }>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("org_eagg_status_idx")
      .on(t.status)
      .where(sql`${t.status} = 'open'`),
    index("org_eagg_topic_scope_idx").on(t.topicPrefix, t.scopeId),
  ]
)
```

- [ ] **Step 3: Add event alert table (escalation)**

```typescript
// ─── Event Alert ────────────────────────────────────────────────
// Tracks acknowledgment and escalation for warning+ severity events.

export const eventAlert = orgSchema.table(
  "event_alert",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("ealt")),
    eventId: text("event_id"),
    aggregateId: text("aggregate_id"),
    subscriptionId: text("subscription_id").notNull(),
    severity: text("severity").notNull(),
    status: text("status").notNull().default("firing"),
    acknowledgedBy: text("acknowledged_by"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    escalationStep: bigint("escalation_step", { mode: "number" }).notNull().default(0),
    nextEscalation: timestamp("next_escalation", { withTimezone: true }),
    spec: jsonb("spec").$type<{
      escalationPolicy?: unknown
      notificationHistory?: Array<{ channel: string; deliveredAt: string }>
    }>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("org_ealt_status_idx")
      .on(t.status)
      .where(sql`${t.status} IN ('firing', 'escalated')`),
    index("org_ealt_escalation_idx")
      .on(t.nextEscalation)
      .where(sql`${t.status} IN ('firing', 'escalated')`),
  ]
)
```

- [ ] **Step 4: Add ID prefixes**

In `api/src/lib/id.ts`, add `"edlv"`, `"eagg"`, `"ealt"` to the `EntityPrefix` type union.

- [ ] **Step 5: Update test-helpers.ts**

Add truncate statements (children before parents):

```typescript
await db.execute(sql`TRUNCATE org.event_alert CASCADE`)
await db.execute(sql`TRUNCATE org.event_delivery CASCADE`)
await db.execute(sql`TRUNCATE org.event_aggregate CASCADE`)
```

- [ ] **Step 6: Export tables from schema barrel**

Ensure `eventDelivery`, `eventAggregate`, `eventAlert` are exported from `api/src/db/schema/index.ts`.

- [ ] **Step 7: Commit**

```bash
git add api/src/db/schema/org.ts api/src/lib/id.ts api/src/test-helpers.ts api/src/db/schema/index.ts
git commit -m "feat(events): add event_delivery, event_aggregate, event_alert tables

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Storm Detector

**Files:**

- Create: `api/src/modules/events/storm-detector.ts`
- Create: `api/src/modules/events/storm-detector.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `api/src/modules/events/storm-detector.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { StormDetector } from "./storm-detector"

describe("StormDetector", () => {
  let detector: StormDetector

  beforeEach(() => {
    detector = new StormDetector({ thresholdPerMinute: 5, windowMs: 60_000 })
  })

  afterEach(() => {
    detector.destroy()
  })

  it("does not detect storm below threshold", () => {
    for (let i = 0; i < 4; i++) {
      expect(detector.record("ops.workspace", "default")).toBe(false)
    }
  })

  it("detects storm when threshold exceeded", () => {
    for (let i = 0; i < 5; i++) {
      detector.record("ops.workspace", "default")
    }
    expect(detector.record("ops.workspace", "default")).toBe(true)
  })

  it("isolates storms by key", () => {
    for (let i = 0; i < 5; i++) {
      detector.record("ops.workspace", "default")
    }
    expect(detector.record("ops.workspace", "other-scope")).toBe(false)
    expect(detector.record("infra.host", "default")).toBe(false)
  })

  it("reports active storms", () => {
    for (let i = 0; i < 6; i++) {
      detector.record("ops.workspace", "default")
    }
    const storms = detector.activeStorms()
    expect(storms).toHaveLength(1)
    expect(storms[0]).toMatchObject({
      topicPrefix: "ops.workspace",
      scopeId: "default",
    })
  })

  it("clears storm state after window expires", () => {
    vi.useFakeTimers()
    for (let i = 0; i < 6; i++) {
      detector.record("ops.workspace", "default")
    }
    expect(detector.isStorming("ops.workspace", "default")).toBe(true)
    vi.advanceTimersByTime(61_000)
    detector.tick()
    expect(detector.isStorming("ops.workspace", "default")).toBe(false)
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Implement the storm detector**

Create `api/src/modules/events/storm-detector.ts`:

```typescript
import { logger } from "../../logger"

interface StormConfig {
  thresholdPerMinute: number
  windowMs: number
}

interface BucketEntry {
  count: number
  firstSeen: number
  lastSeen: number
}

export class StormDetector {
  private config: StormConfig
  private buckets = new Map<string, BucketEntry>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: StormConfig) {
    this.config = config
    this.cleanupTimer = setInterval(() => this.tick(), config.windowMs)
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  record(topicPrefix: string, scopeId: string): boolean {
    const k = `${topicPrefix}:${scopeId}`
    const now = Date.now()

    let bucket = this.buckets.get(k)
    if (!bucket || now - bucket.firstSeen > this.config.windowMs) {
      bucket = { count: 0, firstSeen: now, lastSeen: now }
      this.buckets.set(k, bucket)
    }

    bucket.count++
    bucket.lastSeen = now

    const isStorm = bucket.count > this.config.thresholdPerMinute
    if (isStorm && bucket.count === this.config.thresholdPerMinute + 1) {
      logger.warn(
        { topicPrefix, scopeId, count: bucket.count },
        "storm-detector: storm threshold exceeded"
      )
    }
    return isStorm
  }

  isStorming(topicPrefix: string, scopeId: string): boolean {
    const bucket = this.buckets.get(`${topicPrefix}:${scopeId}`)
    if (!bucket) return false
    if (Date.now() - bucket.firstSeen > this.config.windowMs) return false
    return bucket.count > this.config.thresholdPerMinute
  }

  activeStorms(): Array<{ topicPrefix: string; scopeId: string; count: number; since: number }> {
    const now = Date.now()
    const storms: Array<{ topicPrefix: string; scopeId: string; count: number; since: number }> = []
    for (const [k, bucket] of this.buckets) {
      if (now - bucket.firstSeen <= this.config.windowMs && bucket.count > this.config.thresholdPerMinute) {
        const [topicPrefix, scopeId] = k.split(":")
        storms.push({ topicPrefix, scopeId, count: bucket.count, since: bucket.firstSeen })
      }
    }
    return storms
  }

  tick(): void {
    const now = Date.now()
    for (const [k, bucket] of this.buckets) {
      if (now - bucket.firstSeen > this.config.windowMs) {
        this.buckets.delete(k)
      }
    }
  }
}
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run src/modules/events/storm-detector.test.ts 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/events/storm-detector.ts api/src/modules/events/storm-detector.test.ts
git commit -m "feat(events): add sliding-window storm detector for notification throttling

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Scope Resolver

**Files:**

- Create: `api/src/modules/events/scope-resolver.ts`
- Create: `api/src/modules/events/scope-resolver.test.ts`

- [ ] **Step 1: Write tests**

Create `api/src/modules/events/scope-resolver.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { canPrincipalSeeEvent, severityGte } from "./scope-resolver"

describe("canPrincipalSeeEvent", () => {
  it("allows org-scoped events for org members", () => {
    expect(canPrincipalSeeEvent(
      { scopeKind: "org", scopeId: "default" },
      { principalId: "prin_alice", scopes: [{ kind: "org", id: "default" }] }
    )).toBe(true)
  })

  it("allows principal-scoped events for the owning principal", () => {
    expect(canPrincipalSeeEvent(
      { scopeKind: "principal", scopeId: "prin_alice" },
      { principalId: "prin_alice", scopes: [{ kind: "org", id: "default" }] }
    )).toBe(true)
  })

  it("denies principal-scoped events for other principals", () => {
    expect(canPrincipalSeeEvent(
      { scopeKind: "principal", scopeId: "prin_alice" },
      { principalId: "prin_bob", scopes: [{ kind: "org", id: "default" }] }
    )).toBe(false)
  })

  it("allows team-scoped events for team members", () => {
    expect(canPrincipalSeeEvent(
      { scopeKind: "team", scopeId: "team_platform" },
      { principalId: "prin_alice", scopes: [{ kind: "team", id: "team_platform" }] }
    )).toBe(true)
  })

  it("denies system-scoped events for non-admins", () => {
    expect(canPrincipalSeeEvent(
      { scopeKind: "system", scopeId: "internal" },
      { principalId: "prin_alice", scopes: [{ kind: "org", id: "default" }], isAdmin: false }
    )).toBe(false)
  })

  it("allows system-scoped events for admins", () => {
    expect(canPrincipalSeeEvent(
      { scopeKind: "system", scopeId: "internal" },
      { principalId: "prin_alice", scopes: [{ kind: "org", id: "default" }], isAdmin: true }
    )).toBe(true)
  })
})

describe("severityGte", () => {
  it("compares severity levels", () => {
    expect(severityGte("critical", "info")).toBe(true)
    expect(severityGte("info", "warning")).toBe(false)
    expect(severityGte("info", "info")).toBe(true)
  })
})
```

- [ ] **Step 2: Implement**

Create `api/src/modules/events/scope-resolver.ts`:

```typescript
export interface EventScope {
  scopeKind: string
  scopeId: string
}

export interface PrincipalContext {
  principalId: string
  scopes: Array<{ kind: string; id: string }>
  isAdmin?: boolean
}

const SEVERITY_ORDER: Record<string, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  critical: 3,
}

export function severityGte(severity: string, minSeverity: string): boolean {
  return (SEVERITY_ORDER[severity] ?? 0) >= (SEVERITY_ORDER[minSeverity] ?? 0)
}

export function canPrincipalSeeEvent(
  eventScope: EventScope,
  principal: PrincipalContext
): boolean {
  const { scopeKind, scopeId } = eventScope

  switch (scopeKind) {
    case "org":
      return principal.scopes.some((s) => s.kind === "org" && s.id === scopeId)
    case "principal":
      return principal.principalId === scopeId
    case "system":
      return principal.isAdmin === true
    case "team":
    case "project":
    case "site":
      return principal.scopes.some((s) => s.kind === scopeKind && s.id === scopeId)
    default:
      return principal.scopes.some((s) => s.kind === "org")
  }
}
```

- [ ] **Step 3: Run tests, commit**

```bash
git add api/src/modules/events/scope-resolver.ts api/src/modules/events/scope-resolver.test.ts
git commit -m "feat(events): add scope resolver for event access control

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Event Renderers

**Files:**

- Create: `api/src/modules/events/event-renderers.ts`
- Create: `api/src/modules/events/event-renderers.test.ts`

- [ ] **Step 1: Write tests**

Create `api/src/modules/events/event-renderers.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { renderEvent, renderAggregate } from "./event-renderers"

const sampleEvent = {
  id: "evt_test",
  topic: "ops.component_deployment.drifted",
  source: "reconciler",
  severity: "warning" as const,
  scopeKind: "org",
  scopeId: "default",
  spec: {
    data: {
      componentDeploymentSlug: "api-prod",
      desiredImage: "registry/api:v2.1",
      actualImage: "registry/api:v2.0",
      siteSlug: "production",
    },
  },
  schemaVersion: 1,
  occurredAt: "2026-04-11T12:00:00Z",
  createdAt: "2026-04-11T12:00:00Z",
}

describe("renderEvent", () => {
  it("renders to CLI format", () => {
    const output = renderEvent(sampleEvent, "cli")
    expect(typeof output).toBe("string")
    expect(output).toContain("api-prod")
  })

  it("renders to web format", () => {
    const output = renderEvent(sampleEvent, "web") as any
    expect(output).toHaveProperty("title")
    expect(output).toHaveProperty("severity", "warning")
  })

  it("renders to slack format", () => {
    const output = renderEvent(sampleEvent, "slack")
    expect(Array.isArray(output)).toBe(true)
  })

  it("uses generic renderer for unknown topics", () => {
    const unknownEvent = { ...sampleEvent, topic: "custom.unknown.event" }
    const output = renderEvent(unknownEvent, "cli")
    expect(typeof output).toBe("string")
    expect(output as string).toContain("custom.unknown.event")
  })
})

describe("renderAggregate", () => {
  it("renders storm aggregate to CLI", () => {
    const output = renderAggregate(
      { topicPrefix: "ops.component_deployment", eventCount: 42, maxSeverity: "warning", windowStart: "2026-04-11T12:00:00Z", windowEnd: "2026-04-11T12:05:00Z" },
      "cli"
    )
    expect(typeof output).toBe("string")
    expect(output as string).toContain("42")
  })
})
```

- [ ] **Step 2: Implement event renderers**

Create `api/src/modules/events/event-renderers.ts` with:
- Generic renderers for each channel type (cli, web, slack, email)
- Per-topic overrides (e.g., `ops.component_deployment.drifted` has custom Slack/CLI rendering)
- Fallback chain: exact topic → topic prefix → generic
- `renderAggregate()` for storm summaries

See the full implementation in the design spec Section 6.5.

- [ ] **Step 3: Run tests, commit**

```bash
git add api/src/modules/events/event-renderers.ts api/src/modules/events/event-renderers.test.ts
git commit -m "feat(events): add per-channel event renderers with topic-specific overrides

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Notification Router

**Files:**

- Create: `api/src/modules/events/notification-router.ts`
- Create: `api/src/modules/events/notification-router.test.ts`

The notification router is the central engine: consumes events from NATS, matches them against `event_subscription` rows with `kind = "stream"`, checks storm status, and dispatches to channel renderers/deliverers.

- [ ] **Step 1: Write tests for pure matching functions**

Create `api/src/modules/events/notification-router.test.ts` with tests for:
- `matchSubscription()` — topic filter, severity filter, scope filter, JSONB containment
- `isMuted()` — muted flag, mutedUntil in future/past
- `isQuietHours()` — overnight ranges, same-day ranges

- [ ] **Step 2: Implement the notification router**

Create `api/src/modules/events/notification-router.ts`:

Key components:
- `matchSubscription(sub, event)` — pure function, checks topic filter (using `matchTopic`), severity (`severityGte`), scope, and JSONB containment
- `isMuted(spec)` — checks muted flag and mutedUntil timestamp
- `isQuietHours(start, end, currentHour)` — handles overnight ranges
- `NotificationRouter` class:
  - Constructor takes `Database` and optional storm config
  - `processEvent(event)` — main pipeline:
    1. Storm check via `StormDetector`
    2. Query `eventSubscription` where `kind = "stream"` and `status = "active"`
    3. Filter by `matchSubscription()`
    4. For each match: mute check, quiet hours check
    5. Get channels from `eventSubscriptionChannel`
    6. Per-channel: severity filter, delivery mode routing
    7. Realtime → deliver immediately, batch/digest → buffer in `eventDelivery`
    8. Create `eventAlert` if escalation policy exists

- [ ] **Step 3: Run tests, commit**

```bash
git add api/src/modules/events/notification-router.ts api/src/modules/events/notification-router.test.ts
git commit -m "feat(events): add notification router with subscription matching and storm protection

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Escalation Worker

**Files:**

- Create: `api/src/modules/events/escalation-worker.ts`

- [ ] **Step 1: Implement the escalation worker**

60-second interval worker that:
1. Queries `eventAlert` where `status IN ('firing', 'escalated')` and `nextEscalation < now()`
2. For each: increment `escalationStep`, notify next target from escalation policy
3. Update `nextEscalation` for the next step
4. If all steps exhausted: mark as `"escalated"` (terminal)

- [ ] **Step 2: Commit**

```bash
git add api/src/modules/events/escalation-worker.ts
git commit -m "feat(events): add escalation worker for unacknowledged alert escalation

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Batch/Digest Delivery Worker

**Files:**

- Create: `api/src/modules/events/batch-delivery-worker.ts`

- [ ] **Step 1: Implement the batch delivery worker**

60-second interval worker that:
1. Finds `eventSubscriptionChannel` with `delivery IN ('batch', 'digest')` that have buffered deliveries
2. Checks if batch window has elapsed since `lastDeliveredAt`
3. Aggregates buffered `eventDelivery` rows
4. Renders batch/digest, delivers, marks as delivered
5. Updates `lastDeliveredAt`

- [ ] **Step 2: Commit**

```bash
git add api/src/modules/events/batch-delivery-worker.ts
git commit -m "feat(events): add batch/digest delivery worker for scheduled notifications

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Wire into Event Module + REST Endpoints

**Files:**

- Modify: `api/src/modules/events/index.ts`
- Modify: `api/src/factory-core.ts` (if not already wired)

- [ ] **Step 1: Create or update the event module**

If `api/src/modules/events/index.ts` doesn't exist yet, create it. If it already exists (from WebSocket gateway work), extend it.

Wire:
1. Start `NotificationRouter` with NATS consumer
2. Start `startEscalationWorker(db)`
3. Start `startBatchDeliveryWorker(db)`
4. Add REST endpoints:
   - `POST /events/subscriptions` — create stream subscription
   - `GET /events/subscriptions` — list subscriptions for principal
   - `DELETE /events/subscriptions/:id` — delete subscription
   - `POST /events/subscriptions/:id/channels` — add channel
   - `DELETE /events/subscriptions/:id/channels/:channelId` — remove channel
   - `POST /events/alerts/:id/acknowledge` — acknowledge alert
   - `POST /events/alerts/:id/resolve` — resolve alert
   - `GET /events/alerts` — list active alerts

- [ ] **Step 2: Register in factory-core.ts** (if needed)

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/events/index.ts api/src/factory-core.ts
git commit -m "feat(events): wire notification router, escalation, and batch workers into event module

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Summary

| Task | What it builds                               | Tests                                               |
| ---- | -------------------------------------------- | ---------------------------------------------------- |
| 1    | Drizzle tables: event_delivery, event_aggregate, event_alert | DB migration |
| 2    | Storm detector (sliding-window counter)      | Threshold, isolation, expiry                         |
| 3    | Scope resolver (access control)              | Org, team, principal, system scopes; severity        |
| 4    | Per-channel event renderers                  | CLI, web, Slack output; aggregate rendering          |
| 5    | Notification router (core matching engine)   | Topic filter, severity, scope, JSONB match, mute, quiet hours |
| 6    | Escalation worker                            | —                                                    |
| 7    | Batch/digest delivery worker                 | —                                                    |
| 8    | Wire everything + REST endpoints             | —                                                    |
