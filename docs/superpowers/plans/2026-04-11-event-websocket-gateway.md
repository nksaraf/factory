# Event WebSocket Gateway — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multiplexed WebSocket gateway that delivers real-time events to browsers, game engines, CLI TUI, and dashboards — sharing a single connection with the existing presence system.

**Architecture:** The gateway is a NATS JetStream consumer that fans out events to connected WebSocket clients based on their topic subscriptions. It extends the existing Elysia WebSocket pattern from the presence module, multiplexing presence and event messages on a single connection via `type` discrimination. Access control uses the event's `scopeKind`/`scopeId` checked against the principal's memberships.

**Tech Stack:** Elysia WebSocket, NATS JetStream (`nats` npm), Zod, Vitest

**Spec:** `docs/superpowers/specs/2026-04-11-unified-event-system-design.md` (Section 3.4)

**Depends on:** `docs/superpowers/plans/2026-04-11-unified-event-system-core.md` (must be implemented first)

---

## File Map

| Action | File                                            | Responsibility                                                          |
| ------ | ----------------------------------------------- | ----------------------------------------------------------------------- |
| Create | `api/src/modules/events/event-gateway.ts`       | WebSocket gateway: NATS consumer, topic matching, fan-out, backpressure |
| Create | `api/src/modules/events/topic-matcher.ts`       | NATS-style wildcard topic matching (`.>`, `.*`)                         |
| Create | `api/src/modules/events/scope-resolver.ts`      | Resolve event scope from entity context, check principal access         |
| Create | `api/src/modules/events/index.ts`               | Event module barrel: gateway + REST endpoints for event history         |
| Create | `api/src/modules/events/event-gateway.test.ts`  | Tests for topic matching, scope checking, fan-out                       |
| Create | `api/src/modules/events/topic-matcher.test.ts`  | Tests for NATS wildcard matching                                        |
| Create | `api/src/modules/events/scope-resolver.test.ts` | Tests for scope resolution                                              |
| Modify | `api/src/factory-core.ts`                       | Register event module in the Elysia app                                 |
| Create | `shared/src/schemas/event-gateway.ts`           | WebSocket message types (client→server, server→client)                  |

---

## Task 1: Topic Matcher (NATS Wildcard Semantics)

**Files:**

- Create: `api/src/modules/events/topic-matcher.ts`
- Create: `api/src/modules/events/topic-matcher.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `api/src/modules/events/topic-matcher.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { matchTopic } from "./topic-matcher"

describe("matchTopic", () => {
  it("matches exact topics", () => {
    expect(matchTopic("ops.workspace.created", "ops.workspace.created")).toBe(
      true
    )
    expect(matchTopic("ops.workspace.created", "ops.workspace.deleted")).toBe(
      false
    )
  })

  it("matches single-level wildcard (*)", () => {
    expect(matchTopic("ops.workspace.*", "ops.workspace.created")).toBe(true)
    expect(matchTopic("ops.workspace.*", "ops.workspace.deleted")).toBe(true)
    expect(matchTopic("ops.*.created", "ops.workspace.created")).toBe(true)
    expect(matchTopic("ops.workspace.*", "ops.workspace.health.changed")).toBe(
      false
    )
  })

  it("matches multi-level wildcard (>)", () => {
    expect(matchTopic("ops.>", "ops.workspace.created")).toBe(true)
    expect(matchTopic("ops.>", "ops.workspace.health.changed")).toBe(true)
    expect(matchTopic("ops.>", "infra.host.discovered")).toBe(false)
    expect(matchTopic(">", "anything.at.all")).toBe(true)
  })

  it("rejects partial matches without wildcards", () => {
    expect(matchTopic("ops.workspace", "ops.workspace.created")).toBe(false)
    expect(
      matchTopic("ops.workspace.created.extra", "ops.workspace.created")
    ).toBe(false)
  })

  it("handles edge cases", () => {
    expect(matchTopic("*", "ops")).toBe(true)
    expect(matchTopic("*", "ops.workspace")).toBe(false)
    expect(matchTopic("*.*", "ops.workspace")).toBe(true)
    expect(matchTopic("*.*.*", "ops.workspace.created")).toBe(true)
  })
})

describe("matchTopicAny", () => {
  it("matches against multiple filters", () => {
    const { matchTopicAny } = require("./topic-matcher")
    expect(
      matchTopicAny(["ops.>", "infra.host.*"], "ops.workspace.created")
    ).toBe(true)
    expect(
      matchTopicAny(["ops.>", "infra.host.*"], "infra.host.discovered")
    ).toBe(true)
    expect(
      matchTopicAny(["ops.>", "infra.host.*"], "build.pipeline.failed")
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run src/modules/events/topic-matcher.test.ts 2>&1 | tail -20`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the topic matcher**

Create `api/src/modules/events/topic-matcher.ts`:

```typescript
/**
 * NATS-style wildcard topic matching.
 *
 * Topics are dot-separated segments: "ops.workspace.created"
 *
 * Wildcards:
 *   * — matches exactly one segment
 *   > — matches one or more segments (must be last token)
 */

/**
 * Check if a topic matches a filter pattern.
 *
 * @param filter - Pattern with optional wildcards: "ops.>", "ops.*.created"
 * @param topic  - Concrete topic: "ops.workspace.created"
 */
export function matchTopic(filter: string, topic: string): boolean {
  const filterParts = filter.split(".")
  const topicParts = topic.split(".")

  for (let i = 0; i < filterParts.length; i++) {
    const f = filterParts[i]

    // Multi-level wildcard — matches everything remaining
    if (f === ">") {
      return i < topicParts.length // must match at least one segment
    }

    // No more topic segments but filter continues
    if (i >= topicParts.length) return false

    // Single-level wildcard — matches any one segment
    if (f === "*") continue

    // Literal match
    if (f !== topicParts[i]) return false
  }

  // All filter parts consumed — topic must also be fully consumed
  return filterParts.length === topicParts.length
}

/**
 * Check if a topic matches any of the given filter patterns.
 */
export function matchTopicAny(filters: string[], topic: string): boolean {
  return filters.some((f) => matchTopic(f, topic))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run src/modules/events/topic-matcher.test.ts 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/events/topic-matcher.ts api/src/modules/events/topic-matcher.test.ts
git commit -m "feat(events): add NATS-style wildcard topic matcher

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: WebSocket Message Types

**Files:**

- Create: `shared/src/schemas/event-gateway.ts`

- [ ] **Step 1: Create the message type schemas**

Create `shared/src/schemas/event-gateway.ts`:

```typescript
import { z } from "zod"
import { FactoryEventSchema } from "./events"

// ── Client -> Server messages ─────────────────────────────────

export const EventSubscribeMessageSchema = z.object({
  type: z.literal("events.subscribe"),
  topics: z.array(z.string()).min(1),
})

export const EventUnsubscribeMessageSchema = z.object({
  type: z.literal("events.unsubscribe"),
  topics: z.array(z.string()).min(1),
})

export const EventClientMessageSchema = z.discriminatedUnion("type", [
  EventSubscribeMessageSchema,
  EventUnsubscribeMessageSchema,
])
export type EventClientMessage = z.infer<typeof EventClientMessageSchema>

// ── Server -> Client messages ─────────────────────────────────

export const EventDeliveryMessageSchema = z.object({
  type: z.literal("event"),
  event: FactoryEventSchema,
})

export const EventCatchupMessageSchema = z.object({
  type: z.literal("events.catchup"),
  missed: z.number(),
  since: z.string(),
})

export const EventSubscribedMessageSchema = z.object({
  type: z.literal("events.subscribed"),
  topics: z.array(z.string()),
})

export const EventServerMessageSchema = z.discriminatedUnion("type", [
  EventDeliveryMessageSchema,
  EventCatchupMessageSchema,
  EventSubscribedMessageSchema,
])
export type EventServerMessage = z.infer<typeof EventServerMessageSchema>
```

- [ ] **Step 2: Export from shared barrel**

In `shared/src/schemas/index.ts`, add:

```typescript
export * from "./event-gateway"
```

- [ ] **Step 3: Verify typecheck**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-shared exec tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add shared/src/schemas/event-gateway.ts shared/src/schemas/index.ts
git commit -m "feat(events): add WebSocket gateway message type schemas

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Scope Resolver

**Files:**

- Create: `api/src/modules/events/scope-resolver.ts`
- Create: `api/src/modules/events/scope-resolver.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `api/src/modules/events/scope-resolver.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { canPrincipalSeeEvent, severityGte } from "./scope-resolver"

describe("canPrincipalSeeEvent", () => {
  it("allows org-scoped events for all org members", () => {
    const result = canPrincipalSeeEvent(
      { scopeKind: "org", scopeId: "default" },
      { principalId: "prin_alice", scopes: [{ kind: "org", id: "default" }] }
    )
    expect(result).toBe(true)
  })

  it("allows principal-scoped events for the owning principal", () => {
    const result = canPrincipalSeeEvent(
      { scopeKind: "principal", scopeId: "prin_alice" },
      { principalId: "prin_alice", scopes: [{ kind: "org", id: "default" }] }
    )
    expect(result).toBe(true)
  })

  it("denies principal-scoped events for other principals", () => {
    const result = canPrincipalSeeEvent(
      { scopeKind: "principal", scopeId: "prin_alice" },
      { principalId: "prin_bob", scopes: [{ kind: "org", id: "default" }] }
    )
    expect(result).toBe(false)
  })

  it("allows team-scoped events for team members", () => {
    const result = canPrincipalSeeEvent(
      { scopeKind: "team", scopeId: "team_platform" },
      {
        principalId: "prin_alice",
        scopes: [
          { kind: "org", id: "default" },
          { kind: "team", id: "team_platform" },
        ],
      }
    )
    expect(result).toBe(true)
  })

  it("denies team-scoped events for non-members", () => {
    const result = canPrincipalSeeEvent(
      { scopeKind: "team", scopeId: "team_platform" },
      {
        principalId: "prin_bob",
        scopes: [
          { kind: "org", id: "default" },
          { kind: "team", id: "team_other" },
        ],
      }
    )
    expect(result).toBe(false)
  })

  it("denies system-scoped events for non-admin principals", () => {
    const result = canPrincipalSeeEvent(
      { scopeKind: "system", scopeId: "internal" },
      {
        principalId: "prin_alice",
        scopes: [{ kind: "org", id: "default" }],
        isAdmin: false,
      }
    )
    expect(result).toBe(false)
  })

  it("allows system-scoped events for admin principals", () => {
    const result = canPrincipalSeeEvent(
      { scopeKind: "system", scopeId: "internal" },
      {
        principalId: "prin_alice",
        scopes: [{ kind: "org", id: "default" }],
        isAdmin: true,
      }
    )
    expect(result).toBe(true)
  })
})

describe("severityGte", () => {
  it("compares severity levels correctly", () => {
    expect(severityGte("critical", "info")).toBe(true)
    expect(severityGte("warning", "info")).toBe(true)
    expect(severityGte("info", "info")).toBe(true)
    expect(severityGte("debug", "info")).toBe(false)
    expect(severityGte("info", "warning")).toBe(false)
    expect(severityGte("critical", "critical")).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run src/modules/events/scope-resolver.test.ts 2>&1 | tail -20`
Expected: FAIL.

- [ ] **Step 3: Implement the scope resolver**

Create `api/src/modules/events/scope-resolver.ts`:

```typescript
/**
 * Event scope resolution and access control.
 *
 * Determines whether a principal can see an event based on
 * the event's scopeKind/scopeId and the principal's memberships.
 */

import type { EventSeverity } from "@smp/factory-shared/schemas/events"

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

/**
 * Check if a severity level is >= a minimum threshold.
 */
export function severityGte(severity: string, minSeverity: string): boolean {
  return (SEVERITY_ORDER[severity] ?? 0) >= (SEVERITY_ORDER[minSeverity] ?? 0)
}

/**
 * Check if a principal can see an event based on scope.
 *
 * Rules:
 * - org-scoped: visible to all authenticated org members
 * - team-scoped: visible to team members only
 * - project-scoped: visible to project members (team that owns the project)
 * - site-scoped: visible to site members (team that owns the site)
 * - principal-scoped: visible only to that specific principal
 * - system-scoped: visible only to admin principals
 */
export function canPrincipalSeeEvent(
  eventScope: EventScope,
  principal: PrincipalContext
): boolean {
  const { scopeKind, scopeId } = eventScope

  switch (scopeKind) {
    case "org":
      // All authenticated org members can see org-scoped events
      return principal.scopes.some((s) => s.kind === "org" && s.id === scopeId)

    case "principal":
      // Only the specific principal can see their own events
      return principal.principalId === scopeId

    case "system":
      // Only admins can see system-level events
      return principal.isAdmin === true

    case "team":
    case "project":
    case "site":
      // Must be a member of the specific team/project/site
      return principal.scopes.some(
        (s) => s.kind === scopeKind && s.id === scopeId
      )

    default:
      // Unknown scope kind — default to org-level check
      return principal.scopes.some((s) => s.kind === "org")
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run src/modules/events/scope-resolver.test.ts 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/events/scope-resolver.ts api/src/modules/events/scope-resolver.test.ts
git commit -m "feat(events): add scope resolver for event access control

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Event WebSocket Gateway

**Files:**

- Create: `api/src/modules/events/event-gateway.ts`
- Create: `api/src/modules/events/event-gateway.test.ts`

- [ ] **Step 1: Write the failing test — gateway tracks subscriptions**

Create `api/src/modules/events/event-gateway.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest"
import { EventGateway } from "./event-gateway"

// Mock NATS
vi.mock("../../lib/nats", () => ({
  getNatsConnection: vi.fn().mockResolvedValue(null),
}))

describe("EventGateway", () => {
  let gateway: EventGateway

  beforeEach(() => {
    gateway = new EventGateway()
  })

  it("tracks client subscriptions", () => {
    const mockWs = { send: vi.fn() }
    const principal = {
      principalId: "prin_alice",
      scopes: [{ kind: "org", id: "default" }],
    }

    gateway.addClient(mockWs as any, principal)
    gateway.subscribe(mockWs as any, ["ops.>", "infra.host.*"])

    const subs = gateway.getClientSubscriptions(mockWs as any)
    expect(subs).toEqual(["ops.>", "infra.host.*"])
  })

  it("removes subscriptions on unsubscribe", () => {
    const mockWs = { send: vi.fn() }
    const principal = {
      principalId: "prin_alice",
      scopes: [{ kind: "org", id: "default" }],
    }

    gateway.addClient(mockWs as any, principal)
    gateway.subscribe(mockWs as any, ["ops.>", "infra.host.*"])
    gateway.unsubscribe(mockWs as any, ["infra.host.*"])

    const subs = gateway.getClientSubscriptions(mockWs as any)
    expect(subs).toEqual(["ops.>"])
  })

  it("fans out events to matching clients", () => {
    const ws1 = { send: vi.fn() }
    const ws2 = { send: vi.fn() }
    const principal = {
      principalId: "prin_alice",
      scopes: [{ kind: "org", id: "default" }],
    }

    gateway.addClient(ws1 as any, principal)
    gateway.addClient(ws2 as any, principal)
    gateway.subscribe(ws1 as any, ["ops.>"])
    gateway.subscribe(ws2 as any, ["infra.>"])

    gateway.deliverEvent({
      id: "evt_test",
      topic: "ops.workspace.created",
      source: "test",
      severity: "info",
      scopeKind: "org",
      scopeId: "default",
      spec: { data: {} },
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    })

    // ws1 subscribed to ops.> — should receive
    expect(ws1.send).toHaveBeenCalledTimes(1)
    const sent1 = JSON.parse(ws1.send.mock.calls[0][0])
    expect(sent1.type).toBe("event")
    expect(sent1.event.topic).toBe("ops.workspace.created")

    // ws2 subscribed to infra.> — should NOT receive
    expect(ws2.send).toHaveBeenCalledTimes(0)
  })

  it("enforces scope access control on delivery", () => {
    const ws1 = { send: vi.fn() }
    const principal = {
      principalId: "prin_alice",
      scopes: [{ kind: "org", id: "default" }],
    }

    gateway.addClient(ws1 as any, principal)
    gateway.subscribe(ws1 as any, [">"])

    // Team-scoped event — Alice is not a member of this team
    gateway.deliverEvent({
      id: "evt_test",
      topic: "ops.workspace.created",
      source: "test",
      severity: "info",
      scopeKind: "team",
      scopeId: "team_secret",
      spec: { data: {} },
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    })

    expect(ws1.send).toHaveBeenCalledTimes(0)
  })

  it("cleans up on client disconnect", () => {
    const mockWs = { send: vi.fn() }
    const principal = {
      principalId: "prin_alice",
      scopes: [{ kind: "org", id: "default" }],
    }

    gateway.addClient(mockWs as any, principal)
    gateway.subscribe(mockWs as any, ["ops.>"])
    gateway.removeClient(mockWs as any)

    expect(gateway.getClientSubscriptions(mockWs as any)).toEqual([])
    expect(gateway.clientCount).toBe(0)
  })

  it("sends catchup message to slow clients", () => {
    const mockWs = { send: vi.fn() }
    const principal = {
      principalId: "prin_alice",
      scopes: [{ kind: "org", id: "default" }],
    }

    gateway.addClient(mockWs as any, principal)
    gateway.subscribe(mockWs as any, ["ops.>"])

    // Simulate slow client by making send throw
    mockWs.send.mockImplementationOnce(() => {
      throw new Error("slow")
    })

    gateway.deliverEvent({
      id: "evt_test",
      topic: "ops.workspace.created",
      source: "test",
      severity: "info",
      scopeKind: "org",
      scopeId: "default",
      spec: { data: {} },
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    })

    // Client marked as having missed events — next successful send should include catchup
    const state = gateway.getClientState(mockWs as any)
    expect(state?.missedCount).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run src/modules/events/event-gateway.test.ts 2>&1 | tail -20`
Expected: FAIL.

- [ ] **Step 3: Implement the gateway**

Create `api/src/modules/events/event-gateway.ts`:

```typescript
/**
 * Event WebSocket Gateway — fans out NATS events to connected WebSocket clients.
 *
 * Each client subscribes to topic filters (NATS wildcard syntax).
 * Events are delivered only if the client's subscriptions match AND
 * the client has access to the event's scope.
 */

import { logger } from "../../logger"
import { matchTopicAny } from "./topic-matcher"
import { canPrincipalSeeEvent, type PrincipalContext } from "./scope-resolver"

interface ClientState {
  ws: unknown
  principal: PrincipalContext
  topics: string[]
  missedCount: number
  missedSince: string | null
}

interface EventPayload {
  id: string
  topic: string
  source: string
  severity: string
  scopeKind: string
  scopeId: string
  spec: Record<string, unknown>
  schemaVersion: number
  occurredAt: string
  createdAt: string
  [key: string]: unknown
}

export class EventGateway {
  private clients = new Map<unknown, ClientState>()

  get clientCount(): number {
    return this.clients.size
  }

  addClient(ws: unknown, principal: PrincipalContext): void {
    this.clients.set(ws, {
      ws,
      principal,
      topics: [],
      missedCount: 0,
      missedSince: null,
    })
    logger.debug(
      { principalId: principal.principalId },
      "event-gateway: client connected"
    )
  }

  removeClient(ws: unknown): void {
    this.clients.delete(ws)
    logger.debug("event-gateway: client disconnected")
  }

  subscribe(ws: unknown, topics: string[]): void {
    const state = this.clients.get(ws)
    if (!state) return

    // Add new topics (deduplicate)
    const existing = new Set(state.topics)
    for (const t of topics) existing.add(t)
    state.topics = Array.from(existing)

    // Acknowledge
    this.sendToClient(ws, {
      type: "events.subscribed",
      topics: state.topics,
    })
  }

  unsubscribe(ws: unknown, topics: string[]): void {
    const state = this.clients.get(ws)
    if (!state) return

    const toRemove = new Set(topics)
    state.topics = state.topics.filter((t) => !toRemove.has(t))
  }

  getClientSubscriptions(ws: unknown): string[] {
    return this.clients.get(ws)?.topics ?? []
  }

  getClientState(ws: unknown): ClientState | undefined {
    return this.clients.get(ws)
  }

  /**
   * Deliver an event to all matching, authorized clients.
   */
  deliverEvent(event: EventPayload): void {
    for (const [ws, state] of this.clients) {
      // Check topic match
      if (state.topics.length === 0) continue
      if (!matchTopicAny(state.topics, event.topic)) continue

      // Check scope access
      if (
        !canPrincipalSeeEvent(
          { scopeKind: event.scopeKind, scopeId: event.scopeId },
          state.principal
        )
      )
        continue

      // Deliver
      const message = JSON.stringify({ type: "event", event })
      try {
        ;(ws as any).send(message)

        // If client had missed events, send catchup info
        if (state.missedCount > 0) {
          this.sendToClient(ws, {
            type: "events.catchup",
            missed: state.missedCount,
            since: state.missedSince ?? new Date().toISOString(),
          })
          state.missedCount = 0
          state.missedSince = null
        }
      } catch {
        // Slow or disconnected client — track missed events
        state.missedCount++
        if (!state.missedSince) {
          state.missedSince = event.occurredAt
        }
        logger.debug(
          {
            principalId: state.principal.principalId,
            missedCount: state.missedCount,
          },
          "event-gateway: client missed event (slow/disconnected)"
        )
      }
    }
  }

  private sendToClient(ws: unknown, message: Record<string, unknown>): void {
    try {
      ;(ws as any).send(JSON.stringify(message))
    } catch {
      // ignore send failures for control messages
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec vitest run src/modules/events/event-gateway.test.ts 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/events/event-gateway.ts api/src/modules/events/event-gateway.test.ts
git commit -m "feat(events): implement WebSocket event gateway with topic matching and scope ACL

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Elysia WebSocket Controller (Multiplexed)

**Files:**

- Create: `api/src/modules/events/index.ts`
- Modify: `api/src/factory-core.ts`

- [ ] **Step 1: Create the multiplexed WebSocket controller**

Create `api/src/modules/events/index.ts`:

```typescript
/**
 * Event module — WebSocket gateway + REST endpoints for event history.
 *
 * The WebSocket endpoint is multiplexed with the existing presence system
 * on a separate path (/events/ws). Both can share the same client connection
 * in the future via a reverse proxy or protocol upgrade.
 */

import { Elysia, t } from "elysia"
import { StringCodec } from "nats"

import type { Database } from "../../db/connection"
import { event } from "../../db/schema/org-v2"
import { getNatsConnection } from "../../lib/nats"
import { logger } from "../../logger"
import { EventGateway } from "./event-gateway"
import type { PrincipalContext } from "./scope-resolver"
import { desc, eq, and, gte, lte, sql } from "drizzle-orm"

const sc = StringCodec()

export function eventController(db: Database) {
  const gateway = new EventGateway()

  // Start NATS consumer for fan-out to WebSocket clients
  startNatsConsumer(gateway)

  return (
    new Elysia({ prefix: "/events" })
      // ── WebSocket endpoint ────────────────────────────────────
      .ws("/ws", {
        body: t.Object({
          type: t.Union([
            t.Literal("events.subscribe"),
            t.Literal("events.unsubscribe"),
          ]),
          topics: t.Optional(t.Array(t.String())),
          // Auth: principal info sent on first message
          principalId: t.Optional(t.String()),
          scopes: t.Optional(
            t.Array(t.Object({ kind: t.String(), id: t.String() }))
          ),
          isAdmin: t.Optional(t.Boolean()),
        }),

        open(ws) {
          logger.debug("event-gateway: WebSocket connected")
        },

        message(ws, data) {
          const { type } = data

          // If client sends principal info, register them
          if (data.principalId && !gateway.getClientState(ws as any)) {
            gateway.addClient(ws as any, {
              principalId: data.principalId,
              scopes: data.scopes ?? [{ kind: "org", id: "default" }],
              isAdmin: data.isAdmin,
            })
          }

          switch (type) {
            case "events.subscribe": {
              if (data.topics && data.topics.length > 0) {
                gateway.subscribe(ws as any, data.topics)
              }
              break
            }
            case "events.unsubscribe": {
              if (data.topics && data.topics.length > 0) {
                gateway.unsubscribe(ws as any, data.topics)
              }
              break
            }
          }
        },

        close(ws) {
          gateway.removeClient(ws as any)
          logger.debug("event-gateway: WebSocket disconnected")
        },
      })

      // ── REST: event history ───────────────────────────────────
      .get(
        "/",
        async ({ query }) => {
          const limit = Math.min(Number(query.limit ?? 50), 200)
          const offset = Number(query.offset ?? 0)

          const conditions = []
          if (query.topic) conditions.push(eq(event.topic, query.topic))
          if (query.source) conditions.push(eq(event.source, query.source))
          if (query.entityKind)
            conditions.push(eq(event.entityKind, query.entityKind))
          if (query.entityId)
            conditions.push(eq(event.entityId, query.entityId))
          if (query.severity)
            conditions.push(eq(event.severity, query.severity))

          const rows = await db
            .select()
            .from(event)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(event.occurredAt))
            .limit(limit)
            .offset(offset)

          return { events: rows, limit, offset }
        },
        {
          query: t.Object({
            topic: t.Optional(t.String()),
            source: t.Optional(t.String()),
            entityKind: t.Optional(t.String()),
            entityId: t.Optional(t.String()),
            severity: t.Optional(t.String()),
            limit: t.Optional(t.String()),
            offset: t.Optional(t.String()),
          }),
        }
      )
  )
}

/**
 * Start a NATS JetStream consumer that feeds events to the gateway.
 */
async function startNatsConsumer(gateway: EventGateway): Promise<void> {
  const conn = await getNatsConnection()
  if (!conn) {
    logger.info(
      "event-gateway: NATS not available, WebSocket gateway will not receive events from broker"
    )
    return
  }

  try {
    const sub = conn.nc.subscribe(">")
    logger.info("event-gateway: NATS consumer started")
    ;(async () => {
      for await (const msg of sub) {
        try {
          const data = JSON.parse(sc.decode(msg.data))
          gateway.deliverEvent(data)
        } catch (err) {
          logger.debug({ err }, "event-gateway: failed to parse NATS message")
        }
      }
    })()
  } catch (err) {
    logger.error({ err }, "event-gateway: failed to start NATS consumer")
  }
}
```

- [ ] **Step 2: Register in factory-core.ts**

Read `api/src/factory-core.ts` and add the event controller to the Elysia app:

```typescript
import { eventController } from "./modules/events/index"
```

Add `.use(eventController(database))` alongside the other controllers.

- [ ] **Step 3: Verify typecheck**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec tsc --noEmit 2>&1 | head -30`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/events/index.ts api/src/factory-core.ts
git commit -m "feat(events): add multiplexed WebSocket gateway with REST history endpoint

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Summary

| Task | What it builds                             | Tests                                                    |
| ---- | ------------------------------------------ | -------------------------------------------------------- |
| 1    | Topic matcher (NATS wildcard semantics)    | Exact, `*`, `>`, edge cases                              |
| 2    | WebSocket message type schemas             | Typecheck                                                |
| 3    | Scope resolver (access control)            | Org, team, principal, system scopes; severity comparison |
| 4    | EventGateway class (fan-out engine)        | Subscription tracking, delivery, scope ACL, backpressure |
| 5    | Elysia WebSocket controller + REST history | Registration, typecheck                                  |
