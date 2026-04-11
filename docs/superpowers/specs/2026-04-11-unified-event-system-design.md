# Unified Real-Time Event System

## Context

Factory is a digital twin platform modeling ~55 entity types across 6 schemas (infra, software, ops, org, build, commerce). Today, real-time updates are fragmented across 6 independent systems: PowerSync (UI state sync), WebSocket presence, Redis pub/sub, workflow event subscriptions, webhook audit logs, and observability streaming. No unified event stream ties them together.

The goal is a single event backbone that powers:

- Activity feeds (web UI, CLI TUI)
- Smart notifications (Slack, email, SMS, IDE — per-user, per-channel routing)
- Real-time 3D visualization (game engine rendered)
- Monitoring dashboards and charts
- Agent/workflow orchestration (replacing the current workflow event subscription system long-term)

The system must be durable (no lost events), lightweight to operate, and future-ready for replacing PowerSync as the real-time sync layer.

---

## 1. Core Event Model

### Event Envelope

Every event in the system follows this shape:

```typescript
interface FactoryEvent {
  id: string // prefixed CUID via newId("evt") — consistent with codebase
  topic: string // canonical: "ops.component_deployment.drifted"
  source: string // producer: "reconciler", "claude-code", "github", "cli"
  severity: "critical" | "warning" | "info" | "debug"

  // correlation & causation
  correlationId?: string // groups causally related events (one deploy -> many changes)
  parentEventId?: string // direct causal parent

  // actor & entity
  principalId?: string // who/what caused it (FK to org.principal)
  entityKind?: string // "component_deployment", "host", "workspace"
  entityId?: string // slug of the affected entity

  // access control
  scopeKind: string // "org" | "team" | "project" | "site" | "principal" | "system"
  scopeId: string // which scope this belongs to (defaults to org-level)

  // canonicalization — raw preserved alongside canonical
  rawEventType?: string // original name from source: "session.start", "session.begin"
  rawPayload?: Record<string, unknown> // original shape, untouched

  // canonical payload
  data: Record<string, unknown> // normalized payload in our vocabulary
  schemaVersion: number // payload version for evolution (starts at 1)

  // deduplication
  idempotencyKey?: string // producer-defined: "(source, providerId, deliveryId)" equivalent

  // timestamps
  occurredAt: string // business time (when it actually happened)
  recordedAt: string // system time (when we persisted it)
}
```

### Key Design Decisions

- **Prefixed CUID for ID** (`evt_ck...`) — consistent with existing `newId()` pattern in `api/src/lib/id.ts`. Not ULID; ordering uses `occurredAt`/`recordedAt` columns.
- **`topic` is explicit** — set by the producer, not derived. Matches the NATS subject exactly.
- **`idempotencyKey`** — partial unique index. For webhooks: `(source, providerId, deliveryId)`. For reconciler: `reconciler:{entityId}:{generation}`. For CLI: `cli:{principalId}:{commandHash}:{timestamp-bucket}`. Prevents duplicate events on retry.
- **`scopeKind` + `scopeId` are required** — aligned with existing `org.scope` and `org.config_var` patterns. Scope is resolved automatically at ingestion from entity context (see Section 5). Default: org-level.
- **`schemaVersion`** — additive changes (new fields) don't bump. Breaking changes (removed/renamed/retyped fields) bump. Consumers must tolerate unknown fields.
- **Raw + canonical in one row** — `rawEventType`/`rawPayload` preserve the original; `topic`/`data` are canonical. One table, both layers.

### Topic Hierarchy

Pattern: `{domain}.{entity_kind}.{verb}`

```
# Infrastructure
infra.host.discovered
infra.host.status_changed
infra.host.removed
infra.realm.created
infra.realm.status_changed
infra.realm.deleted
infra.route.created
infra.route.resolved
infra.route.failed
infra.service.created
infra.service.status_changed

# Operations
ops.component_deployment.created
ops.component_deployment.drifted
ops.component_deployment.reconciled
ops.component_deployment.failed
ops.system_deployment.created
ops.system_deployment.status_changed
ops.workspace.created
ops.workspace.health_changed
ops.workspace.expired
ops.preview.created
ops.preview.ready
ops.preview.expired
ops.rollout.started
ops.rollout.progressed
ops.rollout.completed
ops.rollout.failed
ops.intervention.requested
ops.intervention.executed

# Software
software.component.created
software.component.updated
software.release.published
software.artifact.published
software.api.updated

# Build
build.pipeline.started
build.pipeline.completed
build.pipeline.failed
build.artifact.published

# Organization / Agents
org.agent.session_started
org.agent.session_completed
org.agent.tool_called
org.thread.created
org.thread.turn_added
org.thread.completed
org.principal.created

# External (webhooks from third-party systems)
ext.github.push
ext.github.pull_request
ext.github.check_run
ext.slack.message
ext.slack.reaction
ext.jira.issue_updated

# CLI
cli.command.executed
cli.deploy.started
cli.deploy.completed
```

**Naming rules:**

- Domain prefixes map to DB schemas: `factory_infra` -> `infra`, `factory_build` -> `build`, `org` -> `org`, `factory_fleet` -> `ops`, `factory_product` -> `software`, `factory_commerce` -> `commerce`
- External webhook events use `ext.{source}.{event_type}` — not `webhook.*`, to avoid confusion with the domain hierarchy
- Verbs are past tense (`created`, `drifted`, `failed`) — events describe things that happened
- Topic segments validated at ingestion time via Zod union types

### Schema Registry

Each `(topic, schemaVersion)` pair has a registered Zod schema for validation at ingestion:

```typescript
// api/src/lib/event-schemas.ts
const eventSchemas = {
  "ops.component_deployment.drifted": {
    1: z.object({
      componentDeploymentSlug: z.string(),
      desiredImage: z.string(),
      actualImage: z.string(),
      siteSlug: z.string(),
    }),
  },
  "org.agent.session_started": {
    1: z.object({
      threadId: z.string(),
      agentSlug: z.string(),
      source: z.string(),
      channelId: z.string().optional(),
    }),
  },
}
```

Ingestion validates against the registered schema. Unknown topics are allowed (logged as warnings) to support forward evolution. Unknown fields within known schemas are preserved (Zod `.passthrough()`).

---

## 2. Canonicalization Layer

Events from different sources are normalized into canonical topics and payloads at ingestion time.

### Per-Source Normalizers

```typescript
// api/src/lib/event-canonicalizers.ts
interface RawIngest {
  source: string
  eventType: string
  payload: Record<string, unknown>
  principalId?: string
}

interface CanonicalFields {
  topic: string
  entityKind: string
  entityId?: string
  data: Record<string, unknown>
  severity: "critical" | "warning" | "info" | "debug"
}

const canonicalizers: Record<string, (raw: RawIngest) => CanonicalFields | null> = {
  "claude-code": (raw) => {
    if (raw.eventType === "session.start") return {
      topic: "org.agent.session_started",
      entityKind: "thread",
      severity: "info",
      data: { source: "claude-code", ...raw.payload },
    }
    // ...
  },
  "cursor": (raw) => {
    if (raw.eventType === "session.begin") return {
      topic: "org.agent.session_started",
      entityKind: "thread",
      severity: "info",
      data: { source: "cursor", ...raw.payload },
    }
    // ...
  },
  "github": (raw) => {
    if (raw.eventType === "push") return {
      topic: "ext.github.push",
      entityKind: "repository",
      severity: "info",
      data: { ref: raw.payload.ref, commits: raw.payload.commits, ... },
    }
    // ...
  },
}
```

For internal producers (reconciler, workflow engine), canonicalization is inline — they construct the canonical event directly.

For external sources, the normalizer handles the mapping. Unknown event types from external sources are passed through as `ext.{source}.unknown` with `severity: "debug"`.

---

## 3. Infrastructure & Persistence

### 3.1 Postgres Event Table

```sql
-- org.event — the universal event log (replaces webhook_event)
CREATE TABLE org.event (
  id              text PRIMARY KEY,          -- newId("evt")
  topic           text NOT NULL,
  source          text NOT NULL,
  severity        text NOT NULL DEFAULT 'info',

  correlation_id  text,
  parent_event_id text REFERENCES org.event(id),

  principal_id    text,                      -- FK to org.principal
  entity_kind     text,
  entity_id       text,

  scope_kind      text NOT NULL DEFAULT 'org',
  scope_id        text NOT NULL,

  raw_event_type  text,
  idempotency_key text,

  spec            jsonb NOT NULL,            -- { data, rawPayload }

  occurred_at     timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
) PARTITION BY RANGE (occurred_at);

-- Partitioned monthly
CREATE TABLE org.event_y2026m04 PARTITION OF org.event
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
-- (auto-create future partitions via cron or pg_partman)

-- Indexes (on each partition)
CREATE INDEX idx_event_topic ON org.event (topic);
CREATE INDEX idx_event_source ON org.event (source);
CREATE INDEX idx_event_entity ON org.event (entity_kind, entity_id);
CREATE INDEX idx_event_principal ON org.event (principal_id);
CREATE INDEX idx_event_occurred ON org.event (occurred_at);
CREATE INDEX idx_event_correlation ON org.event (correlation_id);
CREATE INDEX idx_event_parent ON org.event (parent_event_id);
CREATE INDEX idx_event_severity ON org.event (severity) WHERE severity IN ('critical', 'warning');
CREATE UNIQUE INDEX idx_event_idempotency ON org.event (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- GIN index only on recent partitions (last 30 days) — too expensive on historical data
-- Applied per-partition, not globally
CREATE INDEX idx_event_spec_gin ON org.event_y2026m04 USING gin (spec);
```

**Retention policy** (enforced by a daily cron):

- `debug`: 7 days
- `info`: 30 days
- `warning`: 90 days
- `critical`: 1 year
- Retention = `DROP PARTITION` for old months + selective `DELETE` within active partitions for severity-based cleanup

### 3.2 Transactional Outbox (Dual-Write Safety)

The write path does NOT write to Postgres and NATS independently. Instead, it uses a transactional outbox pattern:

```
Producer calls emitEvent()
    │
    ▼
Within the same DB transaction as the business state change:
    INSERT INTO org.event (...)
    INSERT INTO org.event_outbox (event_id, status='pending')
    │
    ▼
NOTIFY 'event_outbox_ready'   ← low-latency hint to the relay
```

A separate **outbox relay** process:

1. Polls `org.event_outbox` for `status='pending'` (with `LISTEN` on `event_outbox_ready` for low-latency notification)
2. Publishes each event to NATS JetStream
3. On NATS ack: updates `org.event_outbox` to `status='published'`
4. On failure: retries with exponential backoff, up to `max_retries`
5. After `max_retries`: marks `status='failed'`, emits a system alert

```sql
CREATE TABLE org.event_outbox (
  event_id    text PRIMARY KEY REFERENCES org.event(id),
  status      text NOT NULL DEFAULT 'pending',  -- pending | published | failed
  attempts    int NOT NULL DEFAULT 0,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX idx_outbox_pending ON org.event_outbox (created_at) WHERE status = 'pending';
```

**Guarantees:**

- Events are never lost — Postgres is the source of truth
- NATS receives at-least-once delivery (idempotencyKey handles consumer-side dedup)
- If NATS is down, events queue in the outbox and drain when NATS recovers
- Business state changes and event recording are atomic (same transaction)

### 3.3 NATS JetStream

- **Deployment:** Single NATS server binary (~20MB), runs alongside the API process or as a sidecar container
- **Stream:** One JetStream stream called `FACTORY` capturing all subjects (`>`)
- **Retention:** Time-based, 7 days — Postgres is the long-term store
- **Storage:** File-based (survives NATS restart)
- **Replicas:** 1 for single-node; 3 for production HA (NATS clustering is built-in)

**Dead Letter Queue:**

- Subject: `$FACTORY.dlq`
- Events that exceed `MaxDeliver` (default: 5) are republished to the DLQ
- A monitoring consumer on `$FACTORY.dlq` writes to `org.event_alert` with `severity: "critical"` and source `"system:dlq"`
- Operators can inspect and replay DLQ events

**Consumer configuration:**

```
AckPolicy: explicit
AckWait: 30s
MaxDeliver: 5
DeliverPolicy: new (for real-time) or by_start_sequence (for catch-up)
FilterSubject: per-consumer topic filter
```

### 3.4 WebSocket Gateway

Extends the existing Elysia WebSocket pattern (see `api/src/modules/presence/index.ts`).

**Multiplexed connection:** A single WebSocket endpoint serves both presence and events. Messages are discriminated by `type`:

```typescript
// Client -> Server
{ type: "presence.join", room: "workspace:ws-123", ... }      // existing presence
{ type: "events.subscribe", topics: ["ops.>", "infra.host.*"] }  // new: event subscription
{ type: "events.unsubscribe", topics: ["infra.host.*"] }

// Server -> Client
{ type: "presence", room: "...", users: [...] }                // existing presence
{ type: "event", event: FactoryEvent }                         // new: event delivery
{ type: "events.catchup", missed: 42, since: "2026-04-11T..." }  // backpressure indicator
```

**Implementation:**

- The gateway is a NATS JetStream consumer subscribed to `>`
- For each incoming event, checks connected clients' subscription filters
- Checks access control (event's `scopeKind`/`scopeId` vs. client's principal memberships)
- Delivers to matching, authorized clients
- Slow client detection: if send buffer exceeds threshold, drop events and send `events.catchup` message with count of missed events and timestamp; client can query REST API for the gap

**Auth:** Same JWT auth as existing WebSocket presence. Principal resolved from token, scope memberships cached per connection (refreshed on reconnect).

---

## 4. Event Producers

### 4.1 The `emitEvent()` Function

Single entry point for all event emission:

```typescript
// api/src/lib/events.ts
async function emitEvent(
  tx: DrizzleTransaction, // must be within an existing transaction
  input: {
    topic: string
    source: string
    severity?: "critical" | "warning" | "info" | "debug"
    principalId?: string
    entityKind?: string
    entityId?: string
    correlationId?: string
    parentEventId?: string
    rawEventType?: string
    rawPayload?: Record<string, unknown>
    data: Record<string, unknown>
    idempotencyKey?: string
    occurredAt?: Date // defaults to now()
  }
): Promise<string> // returns event ID
```

Internally:

1. Resolves `scopeKind`/`scopeId` from entity context (see Section 5)
2. Validates `data` against schema registry (if topic is registered)
3. Generates `id` via `newId("evt")`
4. Inserts into `org.event`
5. Inserts into `org.event_outbox` with `status='pending'`
6. Calls `pg_notify('event_outbox_ready', event_id)` (hint for the relay)
7. Also calls the legacy `matchAndWakeSubscriptions()` for backward compatibility with workflow `waitForEvent()` (see Section 7)

### 4.2 Canonical `emitEvent()` for External Sources

For webhook handlers, wraps canonicalization:

```typescript
async function emitExternalEvent(
  tx: DrizzleTransaction,
  input: {
    source: string // "github", "slack", "jira"
    eventType: string // raw event type from the source
    payload: Record<string, unknown>
    providerId: string // for idempotency
    deliveryId: string // for idempotency
    actorExternalId?: string // resolved to principalId via identity_link
  }
): Promise<string>
```

Internally:

1. Resolves `principalId` from `actorExternalId` via `identity_link`
2. Runs through per-source canonicalizer to get `topic`, `entityKind`, `data`, `severity`
3. Sets `idempotencyKey` = `${source}:${providerId}:${deliveryId}`
4. Calls `emitEvent()` with both raw and canonical fields

### 4.3 Producer List

| Producer          | Events                                              | How                                                        |
| ----------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| Reconciler        | `ops.*.drifted`, `ops.*.reconciled`, `ops.*.failed` | Direct `emitEvent()` in reconciler loop                    |
| Webhook handlers  | `ext.github.*`, `ext.slack.*`, `ext.jira.*`         | `emitExternalEvent()` in webhook routes                    |
| Chat/agent system | `org.agent.*`, `org.thread.*`                       | `emitEvent()` in chat handlers (replaces `emitAgentEvent`) |
| Workflow engine   | `org.workflow.*`                                    | `emitEvent()` on workflow start/step/complete/fail         |
| CLI               | `cli.*`                                             | `emitEvent()` via API endpoint called by CLI               |
| Infra sync        | `infra.host.*`, `infra.realm.*`                     | `emitEvent()` in Proxmox sync loop                         |
| API mutations     | `software.*`, `ops.*`                               | `emitEvent()` in REST handlers for create/update/delete    |

---

## 5. Access Control & Scope Resolution

### Scope Types

Aligned with existing `org.scope` and `org.config_var` patterns:

```typescript
type ScopeKind = "org" | "team" | "project" | "site" | "principal" | "system"
```

### Automatic Scope Resolution

At `emitEvent()` time, scope is resolved from entity context:

```typescript
async function resolveScope(
  entityKind: string,
  entityId: string
): Promise<{ scopeKind: string; scopeId: string }> {
  // Resolution chains:
  // component_deployment -> system_deployment -> site -> org
  // workspace -> principal (owner) or team
  // host -> estate -> org (infra events are typically org-scoped)
  // thread -> principal (creator)
  // agent -> org
  // repository -> team (via ownership)
  // ...
}
```

**Rules:**

- If scope cannot be resolved, default to `org`-level (visible to all authenticated org members)
- `system`-scoped events (infra reconciler internal events) are restricted to admin principals
- Events with `scopeKind: "principal"` are only visible to that principal (e.g., personal agent session events)
- Scope resolution is cached per entity (invalidated on entity update)

### Enforcement

Every event delivery path checks scope:

- WebSocket gateway: principal's scope memberships cached per connection
- Notification router: subscription's `scope_kind`/`scope_id` must be subset of event's scope
- REST API (event history queries): `WHERE scope_id IN (principal's accessible scopes)`

---

## 6. Consumer & Notification Routing

### 6.1 Subscription Model

```sql
-- What a person/system cares about
CREATE TABLE org.event_subscription (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  kind            text NOT NULL,             -- "system" | "user" | "team"
  principal_id    text,                      -- FK to org.principal (null for system)
  scope_kind      text,                      -- filter: only events in this scope
  scope_id        text,
  topic_filter    text NOT NULL,             -- NATS-style: "ops.deployment.>"
  match_fields    jsonb,                     -- optional JSONB containment filter
  min_severity    text NOT NULL DEFAULT 'info',
  spec            jsonb NOT NULL DEFAULT '{}',  -- { muted, mutedUntil, quietHoursStart, quietHoursEnd, timezone }
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- How they want to be reached (many per subscription)
CREATE TABLE org.event_subscription_channel (
  id              text PRIMARY KEY,
  subscription_id text NOT NULL REFERENCES org.event_subscription(id),
  channel_id      text NOT NULL,             -- FK to org.channel (slack DM, email, web, etc.)
  delivery        text NOT NULL,             -- "realtime" | "batch" | "digest"
  min_severity    text,                      -- per-channel override
  spec            jsonb NOT NULL DEFAULT '{}',  -- { rateLimit: { maxPerHour }, batchWindow: "5m", schedule: "0 9 * * *", template }
  last_delivered_at timestamptz,             -- for batch/digest scheduling
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

**Examples:**

- Alice subscribes to `ops.component_deployment.drifted` scoped to site `production`, delivered via:
  - Slack DM (realtime, warning+)
  - Email (daily digest, info+)
  - SMS (realtime, critical only)
- System subscriber for Slack notifier: `ops.*.failed` with `min_severity: "warning"`, routed to #ops-alerts channel
- War room: `ops.>` with `min_severity: "critical"`, all channels realtime

### 6.2 Notification Router

A server-side NATS JetStream consumer on `>`:

```
Event arrives from NATS
    │
    ▼
1. Storm check (Section 6.4)
    │ storm detected? → buffer into aggregate, skip individual delivery
    │
    ▼
2. Query matching subscriptions
    │ - topic matches topic_filter (NATS wildcard semantics)
    │ - severity >= subscription.min_severity
    │ - scope matches (if subscription has scope filter)
    │ - match_fields <@ event.data (JSONB containment, if set)
    │
    ▼
3. For each matching subscription:
    │ - Check: muted? → skip
    │ - Check: quiet hours? → buffer for later delivery
    │
    ├── For each subscription_channel:
    │     │
    │     ├── Check: per-channel min_severity
    │     ├── Check: rate limit (sliding window counter in Redis)
    │     │     exceeded? → skip, log
    │     │
    │     ├── delivery = "realtime"
    │     │     → render (Section 6.5)
    │     │     → dispatch to channel
    │     │     → record in org.event_delivery
    │     │
    │     ├── delivery = "batch"
    │     │     → buffer in org.event_delivery (status: "buffered")
    │     │
    │     └── delivery = "digest"
    │           → buffer in org.event_delivery (status: "buffered")
    │
    └── severity >= "warning" AND subscription has escalation policy?
          → create org.event_alert (Section 6.6)
```

### 6.3 Delivery Tracking

```sql
CREATE TABLE org.event_delivery (
  id              text PRIMARY KEY,
  event_id        text NOT NULL,             -- FK to org.event
  subscription_channel_id text NOT NULL,     -- FK to org.event_subscription_channel
  status          text NOT NULL,             -- "pending" | "buffered" | "delivered" | "failed" | "skipped"
  delivered_at    timestamptz,
  spec            jsonb,                     -- { error, retryCount, renderOutput }
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_delivery_status ON org.event_delivery (status) WHERE status IN ('pending', 'buffered');
CREATE INDEX idx_delivery_event ON org.event_delivery (event_id);
CREATE INDEX idx_delivery_channel ON org.event_delivery (subscription_channel_id);
```

### 6.4 Storm Protection

**Detection:** Sliding-window counter in Redis (or in-memory with Redis fallback):

```
Key: storm:{topic_prefix}:{scope_id}:{5min_bucket}
Value: event count
TTL: 10 minutes
```

**Thresholds (configurable per subscription):**

- Default: 10 events/minute for the same `(topic_prefix, scopeId)` = storm detected
- On storm detection:
  1. Switch to aggregate mode for that `(topic_prefix, scopeId)` pair
  2. Stop individual notifications
  3. Buffer events into `org.event_aggregate`
  4. After rate drops below threshold or window closes, emit one summary notification linking to the full list
  5. Resume individual notifications

```sql
CREATE TABLE org.event_aggregate (
  id              text PRIMARY KEY,
  correlation_id  text,
  topic_prefix    text NOT NULL,             -- "ops.component_deployment"
  scope_id        text,
  window_start    timestamptz NOT NULL,
  window_end      timestamptz,
  event_count     int NOT NULL DEFAULT 0,
  sample_event_id text,                      -- representative event for rendering
  max_severity    text NOT NULL DEFAULT 'info',
  status          text NOT NULL DEFAULT 'open',  -- "open" | "closed" | "delivered"
  spec            jsonb,                     -- { summary, eventIds[] (first N) }
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

### 6.5 Rendering

Per-channel-type renderers, registered by topic pattern:

```typescript
interface EventRenderers {
  slack: (event: FactoryEvent) => SlackBlock[]
  web: (event: FactoryEvent) => ActivityFeedItem
  email: (event: FactoryEvent) => { subject: string; html: string }
  gameEngine: (event: FactoryEvent) => SceneEvent // entity ID, position, color, animation
  cli: (event: FactoryEvent) => string // terminal-formatted with ANSI
}

// Registry: topic pattern -> version -> renderers
const rendererRegistry: Record<
  string,
  Record<number, Partial<EventRenderers>>
> = {
  "ops.component_deployment.drifted": {
    1: {
      slack: (event) => [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Drift detected* on \`${event.data.componentDeploymentSlug}\`\nExpected: \`${event.data.desiredImage}\`\nActual: \`${event.data.actualImage}\``,
          },
        },
      ],
      cli: (event) =>
        `DRIFT ${event.data.componentDeploymentSlug}: ${event.data.desiredImage} -> ${event.data.actualImage}`,
    },
  },
}
```

**Fallback chain:**

1. Exact topic + exact schema version match
2. Exact topic + latest available version
3. Topic prefix match (e.g., `ops.component_deployment.*` catches all verbs)
4. Generic renderer (shows topic, severity, source, entity, timestamp)

**Aggregate rendering:** When delivering storm aggregates, the renderer gets the aggregate (with sample event) instead of individual events.

### 6.6 Acknowledgment & Escalation

Only for `warning`+ severity events on subscriptions with escalation policies:

```sql
CREATE TABLE org.event_alert (
  id                text PRIMARY KEY,
  event_id          text,                    -- FK to org.event (or null if aggregate)
  aggregate_id      text,                    -- FK to org.event_aggregate
  subscription_id   text NOT NULL,           -- FK to org.event_subscription
  severity          text NOT NULL,
  status            text NOT NULL DEFAULT 'firing',  -- "firing" | "acknowledged" | "resolved" | "escalated"
  acknowledged_by   text,                    -- principal_id
  acknowledged_at   timestamptz,
  resolved_at       timestamptz,
  escalation_step   int NOT NULL DEFAULT 0,
  next_escalation   timestamptz,
  spec              jsonb,                   -- { escalationPolicy, notificationHistory: [{channel, deliveredAt, ...}] }
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_alert_status ON org.event_alert (status) WHERE status IN ('firing', 'escalated');
CREATE INDEX idx_alert_escalation ON org.event_alert (next_escalation) WHERE status IN ('firing', 'escalated');
```

**Escalation flow:**

1. Alert created with `status: "firing"`, `next_escalation` set based on policy (e.g., +10 minutes)
2. Escalation worker (1-minute cron) queries alerts where `next_escalation < now()` and `status IN ('firing', 'escalated')`
3. Increments `escalation_step`, delivers to next escalation target (e.g., step 0 = owner, step 1 = team lead, step 2 = on-call)
4. Resets `next_escalation` for the next step
5. `acknowledged` stops escalation; `resolved` closes the alert

### 6.7 Batch & Digest Delivery

A periodic worker (every 1 minute):

1. Queries `org.event_subscription_channel` for channels with `delivery IN ('batch', 'digest')` whose delivery window has elapsed since `last_delivered_at`
2. For each, aggregates undelivered events from `org.event_delivery` where `status = 'buffered'`
3. Groups and renders:
   - **Batch:** chronological list of events, rendered per-channel-type
   - **Digest:** summary with counts by topic, severity; highlights critical/warning events
4. Delivers the batch/digest
5. Updates `org.event_delivery` to `status: 'delivered'` and `org.event_subscription_channel.last_delivered_at`

---

## 7. Migration & Backward Compatibility

### 7.1 Workflow Event Bridge

The existing workflow event system (`api/src/lib/workflow-events.ts`) uses `emitEvent(db, eventName, data)` to match against `org.event_subscription` and wake workflows via DBOS `send()`.

During the transition:

- The new `emitEvent()` function also calls the legacy `matchAndWakeSubscriptions()` after inserting the event
- Topic-to-legacy mapping: strip the domain prefix. `ops.workspace.ready` -> `workspace.ready`
- The legacy `event_subscription` table continues to work unchanged
- Long-term: workflows migrate to subscribing via NATS consumers or the new subscription model. The legacy bridge is removed once all workflows are migrated.

### 7.2 Webhook Event Migration

1. Create `org.event` and `org.event_outbox` tables via Drizzle schema changes + `pnpm db:generate`
2. Migrate existing `org.webhook_event` data into `org.event`:
   - `source` = `webhook_event.source`
   - `topic` = canonicalize from `(source, eventType)`
   - `rawEventType` = `spec.eventType`
   - `rawPayload` = `spec.payload`
   - `idempotencyKey` = `${source}:${providerId}:${deliveryId}`
   - `scopeKind` = `org`, `scopeId` = org slug (default)
3. Update webhook handlers to call `emitExternalEvent()` instead of `recordWebhookEvent()`
4. Update agent event emission (`api/src/modules/chat/events.ts`) to call `emitEvent()` instead of `emitAgentEvent()`
5. Deprecate and eventually drop `org.webhook_event`

### 7.3 PowerSync Boundary

- `org.event` is NOT added to PowerSync sync rules
- Entity state tables remain on PowerSync (no change)
- The web UI uses:
  - PowerSync for entity state (existing)
  - WebSocket gateway for real-time events (new)
  - REST API for historical event queries (new)

---

## 8. Observability

### 8.1 Metrics

Instrumented at every boundary (compatible with existing pino logging; Prometheus-style metrics when a metrics backend is added):

| Metric                          | Type      | Labels                      |
| ------------------------------- | --------- | --------------------------- |
| `event.emitted`                 | counter   | topic, source, severity     |
| `event.postgres_write_ms`       | histogram | topic                       |
| `event.outbox_lag_ms`           | histogram | —                           |
| `event.outbox_pending`          | gauge     | —                           |
| `event.nats_publish_ms`         | histogram | topic                       |
| `event.nats_consumer_lag`       | gauge     | consumer_name               |
| `event.ws_clients_connected`    | gauge     | —                           |
| `event.ws_events_delivered`     | counter   | topic                       |
| `event.ws_events_dropped`       | counter   | — (slow clients)            |
| `event.notification_delivered`  | counter   | channel_type, delivery_mode |
| `event.notification_failed`     | counter   | channel_type, error_type    |
| `event.notification_latency_ms` | histogram | channel_type                |
| `event.dlq_depth`               | gauge     | —                           |
| `event.storm_active`            | gauge     | topic_prefix, scope_id      |
| `event.alert_firing`            | gauge     | severity                    |

### 8.2 Structured Logging

Every emit, publish, and deliver logs a structured entry via pino:

```typescript
logger.info(
  { eventId, topic, source, severity, entityKind, entityId, latencyMs },
  "event.emitted"
)
logger.info({ eventId, topic, consumerName, latencyMs }, "event.nats.published")
logger.warn({ eventId, topic, consumerId, error }, "event.delivery.failed")
logger.error({ eventId, topic, dlqSubject }, "event.dlq.received")
```

### 8.3 Health Checks

- Outbox relay: alert if `outbox_pending > 100` for more than 1 minute
- NATS consumer lag: alert if any consumer is >1000 messages behind
- DLQ depth: alert if >0 (any DLQ event is worth investigating)
- WebSocket gateway: alert if `ws_events_dropped > 10/min`

---

## 9. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PRODUCERS                                     │
│  Reconciler  │  Webhooks  │  Agent/Chat  │  CLI  │  API Mutations  │ Sync  │
└──────┬───────┴─────┬──────┴──────┬───────┴───┬───┴───────┬─────────┴───┬───┘
       │             │            │           │           │             │
       └──────┬──────┴────────────┴───────────┴───────────┴─────────────┘
              │
              ▼
    ┌─────────────────┐
    │  emitEvent()    │  ← canonicalization + scope resolution + schema validation
    │  (in DB tx)     │
    └────────┬────────┘
             │
             ▼
    ┌─────────────────────────────┐
    │  Postgres (atomic write)    │
    │  ┌───────────┐ ┌─────────┐ │
    │  │ org.event  │ │ outbox  │ │  + pg_notify('event_outbox_ready')
    │  └───────────┘ └─────────┘ │  + legacy workflow bridge
    └─────────────────────────────┘
                        │
                        ▼
              ┌───────────────────┐
              │  Outbox Relay     │  ← polls outbox, publishes to NATS
              │  (background)     │
              └────────┬──────────┘
                       │
                       ▼
              ┌───────────────────┐
              │  NATS JetStream   │  ← FACTORY stream, 7-day retention
              │  ┌─────────────┐  │
              │  │ $FACTORY.dlq│  │  ← dead letter queue
              │  └─────────────┘  │
              └────────┬──────────┘
                       │
          ┌────────────┼────────────────────┐
          │            │                    │
          ▼            ▼                    ▼
 ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
 │  WebSocket   │  │ Notification │  │  System          │
 │  Gateway     │  │ Router       │  │  Consumers       │
 │              │  │              │  │                  │
 │ - auth/scope │  │ - match subs │  │ - DLQ monitor    │
 │ - fan-out    │  │ - storm prot │  │ - escalation     │
 │ - backpress  │  │ - rate limit │  │ - batch/digest   │
 └──────┬───────┘  │ - render     │  │ - workflow wake  │
        │          │ - deliver    │  └──────────────────┘
        │          └──────┬───────┘
        │                 │
   ┌────┴────┐    ┌───────┴────────────────────┐
   │ Clients │    │ Channels                    │
   │         │    │                             │
   │ Web UI  │    │ Slack (via Chat SDK)        │
   │ CLI TUI │    │ Email                       │
   │ Game    │    │ SMS                         │
   │ Engine  │    │ IDE (via thread surfaces)   │
   │ Dashbds │    │ Webhook (outbound)          │
   └─────────┘    └─────────────────────────────┘
```

---

## 10. New Tables Summary

| Table                            | Purpose                                                         |
| -------------------------------- | --------------------------------------------------------------- |
| `org.event`                      | Universal event log (partitioned, replaces `webhook_event`)     |
| `org.event_outbox`               | Transactional outbox for reliable NATS publishing               |
| `org.event_subscription`         | What people/systems care about (topic filters, severity, scope) |
| `org.event_subscription_channel` | How they want to be reached (per-channel delivery config)       |
| `org.event_delivery`             | Delivery tracking per event per channel                         |
| `org.event_aggregate`            | Storm protection — buffered event groups                        |
| `org.event_alert`                | Acknowledgment & escalation tracking for warning+ alerts        |

---

## 11. Verification

### Manual Testing

1. Add `org.event` + `org.event_outbox` to schema, run `pnpm db:generate` and apply migration
2. Call `emitEvent()` from a test script, verify row appears in `org.event` and `org.event_outbox`
3. Start outbox relay, verify event appears in NATS (use `nats sub ">"`)
4. Connect WebSocket client, subscribe to `ops.>`, verify events arrive
5. Create a subscription + channel, trigger an event, verify notification delivered to Slack

### Automated Tests

- Unit: `emitEvent()` canonicalization, scope resolution, schema validation
- Unit: topic filter matching (NATS wildcard semantics)
- Unit: storm detection (sliding window counter)
- Integration: outbox relay publishes to NATS
- Integration: WebSocket gateway delivers to subscribed clients
- Integration: notification router matches subscriptions and delivers
- Integration: escalation worker progresses alerts
- Integration: batch/digest worker delivers on schedule

### Load Testing

- Emit 1000 events/sec, verify outbox drains within acceptable latency
- Connect 100 WebSocket clients with different filters, verify fan-out
- Trigger a storm (100 events in 10 seconds for same topic), verify aggregation kicks in
