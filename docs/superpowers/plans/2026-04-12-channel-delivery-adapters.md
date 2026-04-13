# Channel Delivery Adapters + sendNotification API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make notification delivery real — resolve principal identities to provider-specific targets, deliver rendered events through Chat SDK (Slack/Teams/etc), email, and web channels, and provide a `sendNotification()` API for direct/imperative notifications alongside the existing event-driven subscription path.

**Architecture:** Two paths into the notification system:

1. **Event-driven (existing):** `emitEvent()` → subscription matching → delivery adapters → channels. The _subscriber_ decides what they care about.
2. **Direct/imperative (new):** `sendNotification()` → recipient resolution → delivery adapters → channels. The _sender_ decides the recipient and content. Direct notifications emit their own event (topic `notification.*`) for audit trail and are delivered to the recipient's preferred channels.

A `DeliveryAdapter` interface with one method (`deliver`) is implemented per channel type. The Chat SDK adapter uses the existing `bot.openDM()` + `thread.post()` pattern from `slack-surface.ts`, which already handles Slack and supports any Chat SDK adapter (Teams, Google Chat). Identity resolution maps `principalId` → provider external ID via the existing `identity_link` table. Recipients can be principals, teams (expanded via `membership`), or on-call roles. Each principal stores notification preferences in `principal.spec.notificationPreferences`.

**Tech Stack:** Chat SDK (`chat`, `@chat-adapter/slack`), Drizzle ORM, Vitest

**Depends on:**

- `docs/superpowers/plans/2026-04-11-event-notification-routing.md` (notification router, event renderers, storm detector)
- Existing Chat SDK setup in `api/src/modules/chat/bot.ts`
- Existing identity link table + membership table in `api/src/db/schema/org.ts`

---

## File Map

| Action | File                                                 | Responsibility                                            |
| ------ | ---------------------------------------------------- | --------------------------------------------------------- |
| Create | `api/src/modules/events/delivery-adapter.ts`         | DeliveryAdapter interface + registry                      |
| Create | `api/src/modules/events/delivery-adapter-chat.ts`    | Chat SDK delivery (Slack, Teams, etc via bot.openDM)      |
| Create | `api/src/modules/events/delivery-adapter-email.ts`   | Email delivery (stub — logs for now)                      |
| Create | `api/src/modules/events/delivery-adapter-web.ts`     | Web delivery (stub — stores for polling)                  |
| Create | `api/src/modules/events/identity-resolver.ts`        | Principal → provider external ID resolution               |
| Create | `api/src/modules/events/identity-resolver.test.ts`   | Tests for identity resolution                             |
| Create | `api/src/modules/events/delivery-adapter.test.ts`    | Tests for adapter registry                                |
| Create | `api/src/modules/events/recipient-resolver.ts`       | Expand recipients: principal, team, on-call               |
| Create | `api/src/modules/events/recipient-resolver.test.ts`  | Tests for recipient expansion                             |
| Create | `api/src/modules/events/send-notification.ts`        | sendNotification() — direct/imperative notification API   |
| Create | `api/src/modules/events/send-notification.test.ts`   | Tests for sendNotification                                |
| Modify | `shared/src/schemas/events.ts`                       | SendNotificationInput schema                              |
| Modify | `api/src/modules/events/notification-router.ts`      | Call delivery adapters instead of just writing DB rows    |
| Modify | `api/src/modules/events/notification-router.test.ts` | Update tests for delivery adapter integration             |
| Modify | `api/src/modules/events/index.ts`                    | Wire adapters, export sendNotification, add REST endpoint |
| Modify | `api/src/adapters/slack-client.ts`                   | Add conversations.open for DM channel creation            |
| Modify | `api/src/modules/events/batch-delivery-worker.ts`    | Fix channel type parsing                                  |

---

## Task 1: Identity Resolver

**Files:**

- Create: `api/src/modules/events/identity-resolver.ts`
- Create: `api/src/modules/events/identity-resolver.test.ts`

**Context:** The existing `resolveMessagingUser()` in `messaging.service.ts` does externalId → principalId (inbound). We need the reverse: principalId → externalId (outbound). The `identity_link` table has a unique index on `(principalId, type)`, so this is a direct lookup. We also need email resolution from `principal.spec.email`.

- [ ] **Step 1: Write the failing tests**

Create `api/src/modules/events/identity-resolver.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest"
import { parseChannelAddress, resolveDeliveryTarget } from "./identity-resolver"

describe("parseChannelAddress", () => {
  it("parses provider:target format", () => {
    const result = parseChannelAddress("slack:C12345")
    expect(result).toEqual({ provider: "slack", target: "C12345" })
  })

  it("parses provider:@owner special target", () => {
    const result = parseChannelAddress("slack:@owner")
    expect(result).toEqual({ provider: "slack", target: "@owner" })
  })

  it("parses email:@owner", () => {
    const result = parseChannelAddress("email:@owner")
    expect(result).toEqual({ provider: "email", target: "@owner" })
  })

  it("parses web:@owner", () => {
    const result = parseChannelAddress("web:@owner")
    expect(result).toEqual({ provider: "web", target: "@owner" })
  })

  it("handles target with colons", () => {
    const result = parseChannelAddress("slack:DM:U12345")
    expect(result).toEqual({ provider: "slack", target: "DM:U12345" })
  })

  it("returns null for invalid format", () => {
    expect(parseChannelAddress("nocolon")).toBeNull()
  })
})

describe("resolveDeliveryTarget", () => {
  const mockDb = { select: vi.fn() } as any

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("returns target directly for explicit channel IDs", async () => {
    const result = await resolveDeliveryTarget(
      mockDb,
      { provider: "slack", target: "C12345" },
      "prin_alice"
    )
    expect(result).toEqual({ provider: "slack", target: "C12345" })
    expect(mockDb.select).not.toHaveBeenCalled()
  })

  it("resolves @owner to provider identity via identity_link", async () => {
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ externalId: "U_SLACK_123" }]),
    }
    mockDb.select.mockReturnValue(mockChain)

    const result = await resolveDeliveryTarget(
      mockDb,
      { provider: "slack", target: "@owner" },
      "prin_alice"
    )
    expect(result).toEqual({ provider: "slack", target: "U_SLACK_123" })
  })

  it("resolves @owner for email via principal.spec.email", async () => {
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValue([{ spec: { email: "alice@example.com" } }]),
    }
    mockDb.select.mockReturnValue(mockChain)

    const result = await resolveDeliveryTarget(
      mockDb,
      { provider: "email", target: "@owner" },
      "prin_alice"
    )
    expect(result).toEqual({ provider: "email", target: "alice@example.com" })
  })

  it("resolves @owner for web to principalId", async () => {
    const result = await resolveDeliveryTarget(
      mockDb,
      { provider: "web", target: "@owner" },
      "prin_alice"
    )
    expect(result).toEqual({ provider: "web", target: "prin_alice" })
  })

  it("returns null when identity not found", async () => {
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    }
    mockDb.select.mockReturnValue(mockChain)

    const result = await resolveDeliveryTarget(
      mockDb,
      { provider: "slack", target: "@owner" },
      "prin_alice"
    )
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Implement the identity resolver**

Create `api/src/modules/events/identity-resolver.ts`:

```typescript
import { and, eq } from "drizzle-orm"

import type { Database } from "../../db/connection"
import { identityLink, principal } from "../../db/schema/org"
import { logger } from "../../logger"

export interface ChannelAddress {
  provider: string
  target: string
}

export function parseChannelAddress(channelId: string): ChannelAddress | null {
  const colonIdx = channelId.indexOf(":")
  if (colonIdx === -1) return null
  return {
    provider: channelId.slice(0, colonIdx),
    target: channelId.slice(colonIdx + 1),
  }
}

export async function resolveDeliveryTarget(
  db: Database,
  address: ChannelAddress,
  ownerId: string
): Promise<ChannelAddress | null> {
  if (!address.target.startsWith("@")) {
    return address
  }

  if (address.provider === "email") {
    return resolveEmailTarget(db, ownerId)
  }

  if (address.provider === "web") {
    return { provider: "web", target: ownerId }
  }

  return resolveIdentityLinkTarget(db, address.provider, ownerId)
}

async function resolveIdentityLinkTarget(
  db: Database,
  provider: string,
  principalId: string
): Promise<ChannelAddress | null> {
  const rows = await db
    .select({ externalId: identityLink.externalId })
    .from(identityLink)
    .where(
      and(
        eq(identityLink.principalId, principalId),
        eq(identityLink.type, provider)
      )
    )
    .limit(1)

  if (rows.length === 0) {
    logger.debug(
      { provider, principalId },
      "identity-resolver: no identity link found"
    )
    return null
  }

  return { provider, target: rows[0].externalId }
}

async function resolveEmailTarget(
  db: Database,
  principalId: string
): Promise<ChannelAddress | null> {
  const rows = await db
    .select({ spec: principal.spec })
    .from(principal)
    .where(eq(principal.id, principalId))
    .limit(1)

  const spec = rows[0]?.spec as { email?: string } | null
  if (!spec?.email) {
    logger.debug({ principalId }, "identity-resolver: no email found")
    return null
  }

  return { provider: "email", target: spec.email }
}
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec bunx vitest run src/modules/events/identity-resolver.test.ts 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/events/identity-resolver.ts api/src/modules/events/identity-resolver.test.ts
git commit -m "feat(events): add identity resolver for principal → provider target resolution

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Delivery Adapter Interface + Registry

**Files:**

- Create: `api/src/modules/events/delivery-adapter.ts`
- Create: `api/src/modules/events/delivery-adapter.test.ts`

- [ ] **Step 1: Create the delivery adapter interface and registry**

Create `api/src/modules/events/delivery-adapter.ts`:

```typescript
export interface DeliveryContext {
  eventId: string
  topic: string
  severity: string
  source: string
  occurredAt: string
}

export interface DeliveryAdapter {
  readonly provider: string

  deliver(
    target: string,
    rendered: unknown,
    ctx: DeliveryContext
  ): Promise<{ ok: boolean; error?: string }>
}

const adapters = new Map<string, DeliveryAdapter>()

export function registerDeliveryAdapter(adapter: DeliveryAdapter): void {
  adapters.set(adapter.provider, adapter)
}

export function getDeliveryAdapter(provider: string): DeliveryAdapter | null {
  return adapters.get(provider) ?? null
}

export function listDeliveryAdapters(): string[] {
  return Array.from(adapters.keys())
}

export function providerToRenderFormat(
  provider: string
): "cli" | "web" | "slack" | "email" {
  switch (provider) {
    case "slack":
    case "teams":
    case "google-chat":
      return "slack"
    case "email":
      return "email"
    case "web":
      return "web"
    default:
      return "web"
  }
}
```

- [ ] **Step 2: Write tests**

Create `api/src/modules/events/delivery-adapter.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import {
  getDeliveryAdapter,
  listDeliveryAdapters,
  providerToRenderFormat,
  registerDeliveryAdapter,
} from "./delivery-adapter"
import type { DeliveryAdapter } from "./delivery-adapter"

describe("delivery adapter registry", () => {
  it("registers and retrieves adapters", () => {
    const mock: DeliveryAdapter = {
      provider: "test",
      deliver: async () => ({ ok: true }),
    }
    registerDeliveryAdapter(mock)
    expect(getDeliveryAdapter("test")).toBe(mock)
  })

  it("returns null for unregistered provider", () => {
    expect(getDeliveryAdapter("nonexistent")).toBeNull()
  })

  it("lists registered providers", () => {
    const providers = listDeliveryAdapters()
    expect(providers).toContain("test")
  })
})

describe("providerToRenderFormat", () => {
  it("maps chat providers to slack format", () => {
    expect(providerToRenderFormat("slack")).toBe("slack")
    expect(providerToRenderFormat("teams")).toBe("slack")
    expect(providerToRenderFormat("google-chat")).toBe("slack")
  })

  it("maps email to email format", () => {
    expect(providerToRenderFormat("email")).toBe("email")
  })

  it("maps web and unknown to web format", () => {
    expect(providerToRenderFormat("web")).toBe("web")
    expect(providerToRenderFormat("unknown")).toBe("web")
  })
})
```

- [ ] **Step 3: Run tests, commit**

```bash
git add api/src/modules/events/delivery-adapter.ts api/src/modules/events/delivery-adapter.test.ts
git commit -m "feat(events): add delivery adapter interface, registry, and render format mapping

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Chat SDK Delivery Adapter

**Files:**

- Create: `api/src/modules/events/delivery-adapter-chat.ts`

**Context:** Uses the Chat SDK `bot.openDM(userId)` + `thread.post(text)` pattern already proven in `api/src/modules/thread-surfaces/slack-surface.ts` (line 163). The Chat SDK abstracts over Slack, Teams, Google Chat. For Slack, `rendered` is an array of Slack blocks (from `renderEvent(event, "slack")`). For other providers, we fall back to plain text.

The Chat SDK `bot` singleton is in `api/src/modules/chat/bot.ts`. The `bot.openDM(userId)` returns a thread handle, and `thread.post(text, { blocks })` sends the message.

- [ ] **Step 1: Implement the Chat SDK delivery adapter**

Create `api/src/modules/events/delivery-adapter-chat.ts`:

```typescript
import { logger } from "../../logger"
import type { DeliveryAdapter, DeliveryContext } from "./delivery-adapter"

const log = logger.child({ module: "delivery-chat" })

export class ChatDeliveryAdapter implements DeliveryAdapter {
  readonly provider: string

  constructor(provider: string) {
    this.provider = provider
  }

  async deliver(
    target: string,
    rendered: unknown,
    ctx: DeliveryContext
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const { bot, adapters } = await import("../../modules/chat/bot")

      if (!adapters[this.provider]) {
        return {
          ok: false,
          error: `Chat SDK adapter not configured for ${this.provider}`,
        }
      }

      await bot.initialize()

      const dmThread = await bot.openDM(target)

      let text: string
      let blocks: unknown[] | undefined

      if (Array.isArray(rendered)) {
        blocks = rendered
        const firstBlock = rendered[0] as { text?: { text?: string } }
        text = firstBlock?.text?.text ?? `[${ctx.severity}] ${ctx.topic}`
      } else if (typeof rendered === "string") {
        text = rendered
      } else {
        const output = rendered as { title?: string; body?: string }
        text = output.title
          ? `*${output.title}*\n${output.body ?? ""}`
          : `[${ctx.severity}] ${ctx.topic}`
      }

      await dmThread.post(text, blocks ? { blocks } : undefined)

      log.info(
        { provider: this.provider, target, topic: ctx.topic },
        "delivered notification via Chat SDK"
      )

      return { ok: true }
    } catch (err) {
      const error =
        err instanceof Error ? err.message : "unknown delivery error"
      log.error(
        { provider: this.provider, target, topic: ctx.topic, err },
        "failed to deliver notification via Chat SDK"
      )
      return { ok: false, error }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add api/src/modules/events/delivery-adapter-chat.ts
git commit -m "feat(events): add Chat SDK delivery adapter for Slack/Teams/Google Chat

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Email + Web Delivery Adapter Stubs

**Files:**

- Create: `api/src/modules/events/delivery-adapter-email.ts`
- Create: `api/src/modules/events/delivery-adapter-web.ts`

- [ ] **Step 1: Create email adapter stub**

Create `api/src/modules/events/delivery-adapter-email.ts`:

```typescript
import { logger } from "../../logger"
import type { DeliveryAdapter, DeliveryContext } from "./delivery-adapter"

const log = logger.child({ module: "delivery-email" })

export class EmailDeliveryAdapter implements DeliveryAdapter {
  readonly provider = "email"

  async deliver(
    target: string,
    rendered: unknown,
    ctx: DeliveryContext
  ): Promise<{ ok: boolean; error?: string }> {
    const output = rendered as { subject?: string; html?: string }

    log.info(
      {
        to: target,
        subject: output.subject ?? `[${ctx.severity}] ${ctx.topic}`,
        topic: ctx.topic,
        eventId: ctx.eventId,
      },
      "email delivery (stub): would send email"
    )

    return { ok: true }
  }
}
```

- [ ] **Step 2: Create web adapter stub**

Create `api/src/modules/events/delivery-adapter-web.ts`:

```typescript
import { logger } from "../../logger"
import type { DeliveryAdapter, DeliveryContext } from "./delivery-adapter"

const log = logger.child({ module: "delivery-web" })

export class WebDeliveryAdapter implements DeliveryAdapter {
  readonly provider = "web"

  async deliver(
    target: string,
    rendered: unknown,
    ctx: DeliveryContext
  ): Promise<{ ok: boolean; error?: string }> {
    log.info(
      {
        principalId: target,
        topic: ctx.topic,
        eventId: ctx.eventId,
      },
      "web delivery: notification stored for client polling"
    )

    return { ok: true }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/events/delivery-adapter-email.ts api/src/modules/events/delivery-adapter-web.ts
git commit -m "feat(events): add email and web delivery adapter stubs

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Wire Delivery Adapters into Notification Router

**Files:**

- Modify: `api/src/modules/events/notification-router.ts`

**Context:** The notification router currently just writes `event_delivery` rows with `status: "delivered"` but never actually sends anything. This task wires in the delivery adapters so realtime delivery actually delivers.

- [ ] **Step 1: Update notification-router.ts to use delivery adapters**

Add these imports at the top of `notification-router.ts`:

```typescript
import { getDeliveryAdapter, providerToRenderFormat } from "./delivery-adapter"
import { parseChannelAddress, resolveDeliveryTarget } from "./identity-resolver"
```

Replace the realtime delivery block (inside `for (const ch of channels)` in `processEvent`) — the current code that does:

```typescript
if (ch.delivery === "realtime") {
  const channelType = ch.channelId.split(":")[0] as ...
  const renderOutput = renderEvent(...)
  await this.db.insert(eventDelivery).values({
    status: "delivered",
    ...
  })
  delivered++
}
```

Replace with:

```typescript
if (ch.delivery === "realtime") {
  const address = parseChannelAddress(ch.channelId)
  if (!address) {
    logger.warn(
      { channelId: ch.channelId },
      "notification-router: invalid channel address"
    )
    continue
  }

  const resolved = await resolveDeliveryTarget(this.db, address, sub.ownerId)
  if (!resolved) {
    logger.debug(
      { channelId: ch.channelId, ownerId: sub.ownerId },
      "notification-router: could not resolve delivery target"
    )
    continue
  }

  const renderFormat = providerToRenderFormat(resolved.provider)
  const renderOutput = renderEvent(
    {
      ...eventRow,
      occurredAt:
        typeof eventRow.occurredAt === "string"
          ? eventRow.occurredAt
          : eventRow.occurredAt.toISOString(),
      createdAt:
        typeof eventRow.createdAt === "string"
          ? eventRow.createdAt
          : eventRow.createdAt.toISOString(),
    },
    renderFormat
  )

  const adapter = getDeliveryAdapter(resolved.provider)
  let deliveryStatus = "delivered"
  let deliveryError: string | undefined

  if (adapter) {
    const result = await adapter.deliver(resolved.target, renderOutput, {
      eventId: eventRow.id,
      topic: eventRow.topic,
      severity: eventRow.severity,
      source: eventRow.source,
      occurredAt:
        typeof eventRow.occurredAt === "string"
          ? eventRow.occurredAt
          : eventRow.occurredAt.toISOString(),
    })
    if (!result.ok) {
      deliveryStatus = "failed"
      deliveryError = result.error
    }
  }

  await this.db.insert(eventDelivery).values({
    eventId: eventRow.id,
    subscriptionChannelId: ch.id,
    status: deliveryStatus,
    deliveredAt: deliveryStatus === "delivered" ? new Date() : null,
    spec: {
      renderOutput,
      ...(deliveryError ? { error: deliveryError } : {}),
    },
  })
  delivered++
}
```

Remove the old `renderEvent` import's `"cli"` type if no longer used.

- [ ] **Step 2: Run existing router tests to verify no regressions**

Run: `cd /Users/nikhilsaraf/conductor/workspaces/factory/colombo && pnpm --filter @smp/factory-api exec bunx vitest run src/modules/events/notification-router.test.ts 2>&1 | tail -20`

Pure-function tests (matchStreamSubscription, isMuted, isQuietHours) should all still pass.

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/events/notification-router.ts
git commit -m "feat(events): wire delivery adapters into notification router for real delivery

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Recipient Resolver

**Files:**

- Create: `api/src/modules/events/recipient-resolver.ts`
- Create: `api/src/modules/events/recipient-resolver.test.ts`

**Context:** For `sendNotification()`, the `to` field can be a principalId, team slug, or on-call role. This module expands any recipient address to a list of principalIds, each with their notification channel preferences.

The `membership` table (line 111 of `org.ts`) joins principals to teams: `{ principalId, teamId }`.

Notification preferences are stored in `principal.spec.notificationPreferences`:

```typescript
{
  notificationPreferences?: {
    defaultChannels?: string[]  // e.g., ["slack", "web"]
    quietHours?: { start: string; end: string }
    muted?: boolean
  }
}
```

- [ ] **Step 1: Write the failing tests**

Create `api/src/modules/events/recipient-resolver.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  parseRecipient,
  resolveRecipients,
  getNotificationChannels,
} from "./recipient-resolver"

describe("parseRecipient", () => {
  it("parses principal ID", () => {
    expect(parseRecipient("prin_alice")).toEqual({
      kind: "principal",
      id: "prin_alice",
    })
  })

  it("parses team slug", () => {
    expect(parseRecipient("team:platform")).toEqual({
      kind: "team",
      id: "platform",
    })
  })

  it("parses on-call role", () => {
    expect(parseRecipient("on-call:platform")).toEqual({
      kind: "on-call",
      id: "platform",
    })
  })

  it("defaults to principal for plain IDs", () => {
    expect(parseRecipient("some_id")).toEqual({
      kind: "principal",
      id: "some_id",
    })
  })
})

describe("getNotificationChannels", () => {
  it("returns preferences from principal spec", () => {
    const spec = {
      notificationPreferences: {
        defaultChannels: ["slack", "email"],
      },
    }
    expect(getNotificationChannels(spec)).toEqual(["slack", "email"])
  })

  it("returns defaults when no preferences", () => {
    expect(getNotificationChannels({})).toEqual(["slack", "web"])
    expect(getNotificationChannels(null)).toEqual(["slack", "web"])
  })

  it("respects muted flag", () => {
    const spec = {
      notificationPreferences: {
        defaultChannels: ["slack"],
        muted: true,
      },
    }
    expect(getNotificationChannels(spec)).toEqual([])
  })
})

describe("resolveRecipients", () => {
  const mockDb = {
    select: vi.fn(),
  } as any

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("resolves principal recipient directly", async () => {
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: "prin_alice",
          spec: { notificationPreferences: { defaultChannels: ["slack"] } },
        },
      ]),
    }
    mockDb.select.mockReturnValue(mockChain)

    const result = await resolveRecipients(mockDb, "prin_alice")
    expect(result).toHaveLength(1)
    expect(result[0].principalId).toBe("prin_alice")
    expect(result[0].channels).toEqual(["slack"])
  })

  it("resolves team to member principals", async () => {
    // First call: team lookup
    const teamChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: "team_123" }]),
    }
    // Second call: membership lookup
    const memberChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      then: vi.fn(),
    }

    mockDb.select
      .mockReturnValueOnce(teamChain) // team lookup
      .mockReturnValueOnce(memberChain) // membership + principal join

    // For the membership query, resolve with principals
    memberChain.then = undefined
    memberChain.where = vi.fn().mockResolvedValue([
      {
        principal: {
          id: "prin_alice",
          spec: { notificationPreferences: { defaultChannels: ["slack"] } },
        },
      },
      {
        principal: {
          id: "prin_bob",
          spec: {},
        },
      },
    ])

    const result = await resolveRecipients(mockDb, "team:platform")
    expect(result.length).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Implement the recipient resolver**

Create `api/src/modules/events/recipient-resolver.ts`:

```typescript
import { eq } from "drizzle-orm"

import type { Database } from "../../db/connection"
import { membership, principal, team } from "../../db/schema/org"
import { logger } from "../../logger"

interface RecipientAddress {
  kind: "principal" | "team" | "on-call"
  id: string
}

export interface ResolvedRecipient {
  principalId: string
  channels: string[]
}

const DEFAULT_CHANNELS = ["slack", "web"]

export function parseRecipient(to: string): RecipientAddress {
  if (to.startsWith("team:")) {
    return { kind: "team", id: to.slice(5) }
  }
  if (to.startsWith("on-call:")) {
    return { kind: "on-call", id: to.slice(8) }
  }
  return { kind: "principal", id: to }
}

export function getNotificationChannels(
  spec: Record<string, unknown> | null | undefined
): string[] {
  if (!spec) return DEFAULT_CHANNELS
  const prefs = spec.notificationPreferences as
    | {
        defaultChannels?: string[]
        muted?: boolean
      }
    | undefined
  if (!prefs) return DEFAULT_CHANNELS
  if (prefs.muted) return []
  return prefs.defaultChannels ?? DEFAULT_CHANNELS
}

export async function resolveRecipients(
  db: Database,
  to: string,
  channelOverrides?: string[]
): Promise<ResolvedRecipient[]> {
  const addr = parseRecipient(to)

  switch (addr.kind) {
    case "principal":
      return resolvePrincipal(db, addr.id, channelOverrides)
    case "team":
      return resolveTeam(db, addr.id, channelOverrides)
    case "on-call":
      return resolveOnCall(db, addr.id, channelOverrides)
    default:
      return []
  }
}

async function resolvePrincipal(
  db: Database,
  principalId: string,
  channelOverrides?: string[]
): Promise<ResolvedRecipient[]> {
  const rows = await db
    .select({ id: principal.id, spec: principal.spec })
    .from(principal)
    .where(eq(principal.id, principalId))
    .limit(1)

  if (rows.length === 0) {
    logger.warn({ principalId }, "recipient-resolver: principal not found")
    return []
  }

  const spec = rows[0].spec as Record<string, unknown> | null
  const channels = channelOverrides ?? getNotificationChannels(spec)
  return [{ principalId: rows[0].id, channels }]
}

async function resolveTeam(
  db: Database,
  teamSlug: string,
  channelOverrides?: string[]
): Promise<ResolvedRecipient[]> {
  // Find team by slug
  const teams = await db
    .select({ id: team.id })
    .from(team)
    .where(eq(team.slug, teamSlug))
    .limit(1)

  if (teams.length === 0) {
    logger.warn({ teamSlug }, "recipient-resolver: team not found")
    return []
  }

  // Get all members with their principal data
  const members = await db
    .select({
      principalId: membership.principalId,
      principalSpec: principal.spec,
    })
    .from(membership)
    .innerJoin(principal, eq(membership.principalId, principal.id))
    .where(eq(membership.teamId, teams[0].id))

  return members.map((m) => ({
    principalId: m.principalId,
    channels:
      channelOverrides ??
      getNotificationChannels(m.principalSpec as Record<string, unknown>),
  }))
}

async function resolveOnCall(
  db: Database,
  teamSlug: string,
  channelOverrides?: string[]
): Promise<ResolvedRecipient[]> {
  // For now, on-call resolves to the team lead or first member.
  // In the future, integrate with PagerDuty/Opsgenie schedule.
  logger.debug(
    { teamSlug },
    "recipient-resolver: on-call resolving to team members (schedule integration pending)"
  )
  return resolveTeam(db, teamSlug, channelOverrides)
}
```

- [ ] **Step 3: Run tests, commit**

```bash
git add api/src/modules/events/recipient-resolver.ts api/src/modules/events/recipient-resolver.test.ts
git commit -m "feat(events): add recipient resolver for principal, team, and on-call expansion

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: sendNotification API

**Files:**

- Create: `api/src/modules/events/send-notification.ts`
- Create: `api/src/modules/events/send-notification.test.ts`
- Modify: `shared/src/schemas/events.ts`

**Context:** This is the imperative notification entry point. A workflow or code path calls `sendNotification()` to send a specific notification to a specific recipient. Unlike event-driven notifications (which go through subscription matching), this resolves recipients directly, emits a notification event to the `event` table for audit trail, and delivers through the recipient's preferred channels.

- [ ] **Step 1: Add the SendNotificationInput schema**

In `shared/src/schemas/events.ts`, after the `EmitExternalEventInputSchema`, add:

```typescript
// ── sendNotification input ──────────────────────────────────

export const SendNotificationInputSchema = z.object({
  to: z.string(),
  topic: z.string().optional(),
  severity: EventSeveritySchema.default("info"),
  title: z.string(),
  body: z.string().optional(),
  data: z.record(z.unknown()).optional(),
  source: z.string().default("api"),
  channels: z.array(z.string()).optional(),
  correlationId: z.string().optional(),
})
export type SendNotificationInput = z.infer<typeof SendNotificationInputSchema>
```

- [ ] **Step 2: Write tests for sendNotification**

Create `api/src/modules/events/send-notification.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest"
import { buildNotificationEvent } from "./send-notification"

describe("buildNotificationEvent", () => {
  it("builds a notification event with topic prefix", () => {
    const result = buildNotificationEvent({
      to: "prin_alice",
      title: "Approval needed",
      body: "api-prod v2.3 needs approval",
      severity: "warning",
      source: "workflow",
      data: { deploymentId: "cdp_123" },
    })

    expect(result.topic).toBe("notification.alert")
    expect(result.source).toBe("workflow")
    expect(result.severity).toBe("warning")
    expect(result.data).toMatchObject({
      title: "Approval needed",
      body: "api-prod v2.3 needs approval",
      recipient: "prin_alice",
      deploymentId: "cdp_123",
    })
  })

  it("uses custom topic when provided", () => {
    const result = buildNotificationEvent({
      to: "prin_alice",
      title: "Test",
      topic: "ops.approval.needed",
      source: "api",
    })

    expect(result.topic).toBe("notification.ops.approval.needed")
  })

  it("defaults severity to info", () => {
    const result = buildNotificationEvent({
      to: "prin_alice",
      title: "FYI",
      source: "api",
    })

    expect(result.severity).toBe("info")
  })
})
```

- [ ] **Step 3: Implement sendNotification**

Create `api/src/modules/events/send-notification.ts`:

```typescript
import type { SendNotificationInput } from "@smp/factory-shared/schemas/events"

import type { Database } from "../../db/connection"
import { eventDelivery } from "../../db/schema/org"
import { emitEvent } from "../../lib/events"
import { logger } from "../../logger"
import { getDeliveryAdapter, providerToRenderFormat } from "./delivery-adapter"
import { renderEvent } from "./event-renderers"
import { resolveDeliveryTarget } from "./identity-resolver"
import { resolveRecipients } from "./recipient-resolver"

const log = logger.child({ module: "send-notification" })

export interface NotificationResult {
  eventId: string | null
  delivered: number
  failed: number
  recipients: Array<{
    principalId: string
    channels: Array<{ provider: string; status: string; error?: string }>
  }>
}

export function buildNotificationEvent(input: {
  to: string
  title: string
  body?: string
  topic?: string
  severity?: string
  source?: string
  data?: Record<string, unknown>
  correlationId?: string
}) {
  const topicSuffix = input.topic ?? "alert"
  return {
    topic: `notification.${topicSuffix}`,
    source: input.source ?? "api",
    severity: input.severity ?? "info",
    data: {
      title: input.title,
      ...(input.body ? { body: input.body } : {}),
      recipient: input.to,
      ...(input.data ?? {}),
    },
    correlationId: input.correlationId,
  }
}

export async function sendNotification(
  db: Database,
  input: SendNotificationInput
): Promise<NotificationResult> {
  // 1. Emit notification event for audit trail
  const notifEvent = buildNotificationEvent(input)
  const eventId = await emitEvent(db, {
    ...notifEvent,
    scopeKind: "org",
    scopeId: "default",
    schemaVersion: 1,
  })

  // 2. Resolve recipients
  const recipients = await resolveRecipients(db, input.to, input.channels)

  if (recipients.length === 0) {
    log.warn({ to: input.to }, "sendNotification: no recipients resolved")
    return { eventId, delivered: 0, failed: 0, recipients: [] }
  }

  // 3. Deliver to each recipient's channels
  let totalDelivered = 0
  let totalFailed = 0
  const recipientResults: NotificationResult["recipients"] = []

  for (const recipient of recipients) {
    const channelResults: Array<{
      provider: string
      status: string
      error?: string
    }> = []

    for (const provider of recipient.channels) {
      // Resolve identity for this provider
      const resolved = await resolveDeliveryTarget(
        db,
        { provider, target: "@owner" },
        recipient.principalId
      )

      if (!resolved) {
        channelResults.push({
          provider,
          status: "skipped",
          error: "no identity link",
        })
        continue
      }

      // Render for this channel type
      const renderFormat = providerToRenderFormat(provider)
      const rendered = renderEvent(
        {
          id: eventId ?? "evt_unknown",
          topic: notifEvent.topic,
          source: notifEvent.source,
          severity: notifEvent.severity,
          scopeKind: "org",
          scopeId: "default",
          spec: { data: notifEvent.data },
          schemaVersion: 1,
          occurredAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
        renderFormat
      )

      // Deliver
      const adapter = getDeliveryAdapter(provider)
      if (!adapter) {
        channelResults.push({
          provider,
          status: "skipped",
          error: "no adapter registered",
        })
        continue
      }

      const result = await adapter.deliver(resolved.target, rendered, {
        eventId: eventId ?? "evt_unknown",
        topic: notifEvent.topic,
        severity: notifEvent.severity,
        source: notifEvent.source,
        occurredAt: new Date().toISOString(),
      })

      if (result.ok) {
        totalDelivered++
        channelResults.push({ provider, status: "delivered" })
      } else {
        totalFailed++
        channelResults.push({
          provider,
          status: "failed",
          error: result.error,
        })
      }

      // Record delivery in event_delivery table
      if (eventId) {
        await db.insert(eventDelivery).values({
          eventId,
          subscriptionChannelId: `direct:${provider}:${recipient.principalId}`,
          status: result.ok ? "delivered" : "failed",
          deliveredAt: result.ok ? new Date() : null,
          spec: {
            renderOutput: rendered,
            directNotification: true,
            recipientPrincipalId: recipient.principalId,
            ...(result.error ? { error: result.error } : {}),
          },
        })
      }
    }

    recipientResults.push({
      principalId: recipient.principalId,
      channels: channelResults,
    })
  }

  log.info(
    {
      to: input.to,
      eventId,
      recipientCount: recipients.length,
      delivered: totalDelivered,
      failed: totalFailed,
    },
    "sendNotification: complete"
  )

  return {
    eventId,
    delivered: totalDelivered,
    failed: totalFailed,
    recipients: recipientResults,
  }
}
```

- [ ] **Step 4: Run tests, commit**

```bash
git add shared/src/schemas/events.ts api/src/modules/events/send-notification.ts api/src/modules/events/send-notification.test.ts
git commit -m "feat(events): add sendNotification API for direct/imperative notifications

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Register Adapters + sendNotification REST Endpoint

**Files:**

- Modify: `api/src/modules/events/index.ts`

**Context:** Wire everything together: register delivery adapters on startup, export `sendNotification`, and add a REST endpoint `POST /events/notify` for sending notifications via the API.

- [ ] **Step 1: Update the event module**

In `api/src/modules/events/index.ts`:

Add these imports:

```typescript
import { registerDeliveryAdapter } from "./delivery-adapter"
import { ChatDeliveryAdapter } from "./delivery-adapter-chat"
import { EmailDeliveryAdapter } from "./delivery-adapter-email"
import { WebDeliveryAdapter } from "./delivery-adapter-web"
import { sendNotification } from "./send-notification"
```

At the top of `startEventWorkers()`, before starting the workers, add:

```typescript
// Register delivery adapters
registerDeliveryAdapter(new ChatDeliveryAdapter("slack"))
registerDeliveryAdapter(new ChatDeliveryAdapter("teams"))
registerDeliveryAdapter(new ChatDeliveryAdapter("google-chat"))
registerDeliveryAdapter(new EmailDeliveryAdapter())
registerDeliveryAdapter(new WebDeliveryAdapter())

logger.info(
  { adapters: ["slack", "teams", "google-chat", "email", "web"] },
  "event-workers: delivery adapters registered"
)
```

Add the `POST /events/notify` endpoint to `eventController()`:

```typescript
    .post(
      "/notify",
      async ({ body }) => {
        const input = body as {
          to: string
          title: string
          body?: string
          topic?: string
          severity?: string
          source?: string
          data?: Record<string, unknown>
          channels?: string[]
          correlationId?: string
        }
        const result = await sendNotification(db, {
          to: input.to,
          title: input.title,
          body: input.body,
          topic: input.topic,
          severity: (input.severity as any) ?? "info",
          source: input.source ?? "api",
          data: input.data,
          channels: input.channels,
          correlationId: input.correlationId,
        })
        return { data: result }
      },
      {
        detail: {
          tags: ["Events"],
          summary: "Send a direct notification to a principal or team",
        },
      }
    )
```

- [ ] **Step 2: Commit**

```bash
git add api/src/modules/events/index.ts
git commit -m "feat(events): register delivery adapters, add POST /events/notify endpoint

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Add conversations.open to Slack Client

**Files:**

- Modify: `api/src/adapters/slack-client.ts`

- [ ] **Step 1: Add conversations.open to the slack client**

In `api/src/adapters/slack-client.ts`, add this method to the `slack` object (after `chatUpdate` at line 187):

```typescript
  /** conversations.open — open or resume a DM with a user */
  async conversationsOpen(
    token: string,
    userId: string
  ): Promise<{ channelId: string }> {
    const result = await slackApiPostJson("conversations.open", token, {
      users: userId,
    })
    if (!result.ok)
      throw new Error(`conversations.open failed: ${result.error}`)
    const ch = result.channel as { id: string }
    return { channelId: ch.id }
  },
```

- [ ] **Step 2: Commit**

```bash
git add api/src/adapters/slack-client.ts
git commit -m "feat(slack): add conversations.open for DM channel creation

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 10: Fix batch-delivery-worker Channel Type Parsing

**Files:**

- Modify: `api/src/modules/events/batch-delivery-worker.ts`

- [ ] **Step 1: Update the batch delivery worker**

In `api/src/modules/events/batch-delivery-worker.ts`, add these imports:

```typescript
import { providerToRenderFormat } from "./delivery-adapter"
import { parseChannelAddress } from "./identity-resolver"
```

Replace:

```typescript
const channelType = ch.channelId.split(":")[0] as
  | "cli"
  | "web"
  | "slack"
  | "email"
```

With:

```typescript
const address = parseChannelAddress(ch.channelId)
const channelType = address
  ? providerToRenderFormat(address.provider)
  : ("web" as const)
```

- [ ] **Step 2: Commit**

```bash
git add api/src/modules/events/batch-delivery-worker.ts
git commit -m "fix(events): use parseChannelAddress in batch delivery worker

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Summary

| Task | What it builds                                          | Tests                                                      |
| ---- | ------------------------------------------------------- | ---------------------------------------------------------- |
| 1    | Identity resolver (principal → provider target)         | parseChannelAddress, resolveDeliveryTarget                 |
| 2    | DeliveryAdapter interface + registry                    | Registry, providerToRenderFormat                           |
| 3    | Chat SDK delivery adapter (Slack/Teams/Google Chat)     | —                                                          |
| 4    | Email + web delivery adapter stubs                      | —                                                          |
| 5    | Wire adapters into notification router                  | Existing pure-function tests pass                          |
| 6    | Recipient resolver (principal, team, on-call expansion) | parseRecipient, getNotificationChannels, resolveRecipients |
| 7    | sendNotification() API + notification event emission    | buildNotificationEvent                                     |
| 8    | Register adapters + POST /events/notify endpoint        | —                                                          |
| 9    | conversations.open on Slack client                      | —                                                          |
| 10   | Fix batch-delivery-worker channel type parsing          | —                                                          |

**Two entry points after this plan:**

```typescript
// Path 1: Event-driven — subscriber decides
emitEvent(db, { topic: "ops.workbench.ready", ... })
// → matched against stream subscriptions → delivery adapters → channels

// Path 2: Direct/imperative — sender decides
sendNotification(db, {
  to: "prin_alice",           // or "team:platform", "on-call:platform"
  title: "Approval needed",
  body: "api-prod v2.3 is waiting",
  severity: "warning",
  channels: ["slack", "email"], // optional override
})
// → recipient resolution → notification event → delivery adapters → channels
```

**Testing flow (Slack):**

1. Ensure Slack messaging provider is configured + Chat SDK bot initialized
2. Ensure test principal has `identity_link` row for Slack (type: "slack", externalId: Slack user ID)
3. **Event-driven:** Create stream subscription (`topicFilter: "ops.>"`, channel `slack:@owner`, delivery `realtime`) → emit event → check Slack DM
4. **Direct:** `POST /events/notify` with `{ to: "prin_alice", title: "Test notification" }` → check Slack DM
