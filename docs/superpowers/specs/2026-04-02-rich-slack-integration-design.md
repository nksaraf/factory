# Rich Slack Integration Design

**Date:** 2026-04-02
**Status:** Draft

## Context

Factory's current Slack integration is agent-centric only — it receives messages via webhook, dispatches to an agent, and posts results back to threads. The existing infrastructure includes a Slack adapter (`@slack/web-api`), messaging provider management, channel-to-entity mapping, identity linking, and message threading.

This design extends Slack into a **first-class interaction surface** for Factory — not just for agents, but for approvals, status broadcasting, data visibility, workflow triggers, and configurable notifications.

## Goals

- **Structured notifications** — automatically post to Slack when deployments, builds, releases, and incidents change state, with configurable rules
- **Approval workflows** — post approval request cards with interactive buttons, route responses back to Factory
- **Slash commands** — quick actions and queries directly from Slack (`/factory status`, `/factory deploy`, `/factory subscribe`)
- **Data visibility** — rich Block Kit cards showing entity status, recent deployments, changelogs
- **Workflow triggers** — kick off deployments, rollbacks, and other operations from Slack
- **Conversational agent** — existing agent system enhanced with tools for querying data and triggering workflows

## Architecture

Five layers, building on the existing messaging module:

```
┌─────────────────────────────────────────────────────┐
│  Slack Workspace                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────────┐ │
│  │ Events   │ │ Slash    │ │ Interactive Payloads │ │
│  │ API      │ │ Commands │ │ (buttons, menus)     │ │
│  └────┬─────┘ └────┬─────┘ └──────────┬───────────┘ │
└───────┼─────────────┼──────────────────┼─────────────┘
        ▼             ▼                  ▼
┌─────────────────────────────────────────────────────┐
│  Layer 1: Ingress                                    │
│  - messaging-webhook.controller (existing, extended) │
│  - slash-command.controller (new)                    │
│  - interaction.controller (new)                      │
└─────────────────────┬───────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│  Layer 2: Routing                                    │
│  - Events → agent dispatch (existing) OR event bus   │
│  - Slash commands → command router                   │
│  - Interactive → action router (callback_id-based)   │
└─────────────────────┬───────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│  Layer 3: Event Bus                                  │
│  - In-process EventEmitter singleton                 │
│  - Modules emit typed events on state changes        │
│  - Notification engine subscribes                    │
└─────────────────────┬───────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│  Layer 4: Notification Engine                        │
│  - Evaluates notification rules against events       │
│  - Renders Block Kit messages from templates         │
│  - Routes to correct channels via channel mappings   │
└─────────────────────┬───────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│  Layer 5: Slack Adapter (existing, extended)          │
│  - sendMessage, updateMessage (existing)             │
│  - respondToInteraction, openModal, postEphemeral    │
└─────────────────────────────────────────────────────┘
```

---

## 1. Event Bus

**Location:** `api/src/lib/event-bus.ts`

In-process `EventEmitter` singleton. Each module emits typed events when state changes occur. Start simple — upgrade to Redis pub/sub later if multi-instance fan-out is needed (Redis infra already exists for presence).

### Event Structure

```typescript
interface FactoryEvent {
  type: string // e.g. "deployment.completed"
  entityKind: string // e.g. "component-deployment"
  entityId: string
  orgId: string
  actor?: { principalId: string; name: string }
  timestamp: Date
  data: Record<string, unknown> // event-specific payload
}
```

### Initial Event Types

| Domain   | Event                          | Emitted When                    |
| -------- | ------------------------------ | ------------------------------- |
| Ops      | `deployment.started`           | ComponentDeployment created     |
| Ops      | `deployment.completed`         | Deployment succeeds             |
| Ops      | `deployment.failed`            | Deployment fails                |
| Ops      | `rollout.started`              | Rollout kicks off               |
| Ops      | `rollout.completed`            | Rollout finishes                |
| Build    | `build.started`                | PipelineRun created             |
| Build    | `build.completed`              | PipelineRun succeeds            |
| Build    | `build.failed`                 | PipelineRun fails               |
| Software | `release.published`            | Release status → published      |
| Ops      | `incident.opened`              | Intervention created            |
| Ops      | `incident.resolved`            | Intervention resolved           |
| Agent    | `job.started`                  | Agent job begins                |
| Agent    | `job.completed`                | Agent job finishes              |
| Ops      | `workspace.created`            | Preview workspace provisioned   |
| Ops      | `database.operation.completed` | DB backup/restore/seed finishes |
| Approval | `approval.requested`           | Approval request created        |
| Approval | `approval.approved`            | Approval granted                |
| Approval | `approval.rejected`            | Approval denied                 |

New events are trivially added — just `eventBus.emit(...)` in the relevant service method.

---

## 2. Notification Rules

**Schema:** New `notificationRule` table in `factory_org`.

```typescript
// notification_rule table
{
  id: string               // "nrule_xxx"
  orgId: string
  name: string             // "Deploy failures to #ops-alerts"
  slug: string

  // What to match
  eventPattern: string     // glob: "deployment.*", "build.failed", "*"
  filters: {               // JSONB
    entityKind?: string[]  // only these entity kinds
    entityId?: string[]    // only these specific entities
    severity?: string[]    // info, warning, error, critical
    tags?: string[]        // match entities with these tags
  }

  // Where to send
  channelMappingId?: string   // specific mapped channel
  channelOverride?: string    // or direct Slack channel ID

  // How to format
  templateSlug?: string       // optional custom template

  // Control
  enabled: boolean
  createdByPrincipalId: string
  spec: JSONB
}
```

### Notification Engine

**Location:** `api/src/modules/notifications/notification-engine.ts`

1. Event arrives on the bus
2. Engine queries active rules matching `eventPattern` (rules cached in memory, refreshed on change)
3. For each matching rule, evaluate `filters` against event data
4. Resolve target channel (rule → channel mapping → entity's default channel)
5. Render Block Kit message using template (or default template per event type)
6. Send via Slack adapter

### Default Templates

Each event type gets a sensible default Block Kit layout:

- **Deployments:** status emoji + component name + environment + version + link to Factory UI
- **Builds:** pass/fail + repo + branch + duration + commit link
- **Releases:** version + changelog summary + artifact count
- **Incidents:** severity badge + title + assigned team + link
- **Approvals:** title + description + Approve/Reject buttons

---

## 3. Interactive Components & Approvals

### Interaction Controller

**Location:** `api/src/modules/messaging/interaction.controller.ts`
**Endpoint:** `POST /webhooks/slack/interactions`

Handles Slack `block_actions` and `view_submission` payloads. Slack sends these as `application/x-www-form-urlencoded` with a `payload` JSON field.

### Action Router

Each interactive component uses a structured `action_id`: `{domain}:{action}:{entityId}`

Examples:

- `approval:approve:aprv_abc123`
- `approval:reject:aprv_abc123`
- `deploy:trigger:cdp_xyz789`
- `rollback:trigger:cdp_xyz789`

The router parses the action_id and dispatches to the registered handler function.

### Approval Model

**Schema:** New `approvalRequest` table in `factory_org`.

```typescript
{
  id: string               // "aprv_xxx"
  orgId: string
  entityKind: string       // what needs approval
  entityId: string
  title: string
  description?: string
  requestorPrincipalId: string
  status: "pending" | "approved" | "rejected" | "expired"
  decidedByPrincipalId?: string
  decidedAt?: Date
  externalMessageTs?: string   // Slack message timestamp (for updating the card)
  externalChannelId?: string
  providerId?: string
  callbackAction?: string      // what to trigger on approval (e.g. "deploy:execute")
  callbackData?: JSONB         // params for the callback
  spec: JSONB
}
```

### Approval Flow

1. Something requests approval → `approvalService.requestApproval({...})`
2. Service creates `approvalRequest` record
3. Renders Block Kit card with Approve/Reject buttons → posts to Slack
4. User clicks Approve/Reject → interaction webhook fires
5. Action router dispatches to approval handler
6. Handler verifies user has permission (via identity link + principal lookup)
7. Updates `approvalRequest` status
8. Updates the Slack message (replaces buttons with outcome)
9. Emits `approval.approved` / `approval.rejected` event
10. Triggers the callback action (e.g., starts the deployment)

---

## 4. Slash Commands

### Slash Command Controller

**Location:** `api/src/modules/messaging/slash-command.controller.ts`
**Endpoint:** `POST /webhooks/slack/slash`

Slack sends slash commands as `application/x-www-form-urlencoded` with fields: `command`, `text`, `user_id`, `channel_id`, `trigger_id`, `response_url`.

### Command Router

Parses `text` field into command + args. Returns Block Kit responses — **ephemeral** for queries, **in-channel** for actions.

### Initial Commands

| Command                                   | Description                                  | Response                                 |
| ----------------------------------------- | -------------------------------------------- | ---------------------------------------- |
| `/factory status <entity>`                | Show entity status card                      | Ephemeral Block Kit card                 |
| `/factory deploy <component> <site>`      | Trigger deployment (may require approval)    | In-channel confirmation or approval card |
| `/factory rollback <component> <site>`    | Trigger rollback                             | In-channel confirmation                  |
| `/factory subscribe <pattern> [#channel]` | Create notification rule for current channel | Ephemeral confirmation                   |
| `/factory unsubscribe <pattern>`          | Remove notification rule                     | Ephemeral confirmation                   |
| `/factory subscriptions`                  | List active rules for current channel        | Ephemeral list                           |
| `/factory releases <system>`              | Show recent releases                         | Ephemeral Block Kit cards                |
| `/factory deployments [--site=X]`         | List recent deployments                      | Ephemeral Block Kit cards                |
| `/factory help`                           | Show available commands                      | Ephemeral help text                      |

**Entity resolution:** Slash commands use slug-based lookups (consistent with the rest of Factory). `/factory status api` resolves via `resolveBySlugOrId()`.

---

## 5. Slack Adapter Extensions

**File:** `api/src/adapters/messaging-adapter-slack.ts`

### New Methods

```typescript
// Respond to an interaction payload via response_url
respondToInteraction(responseUrl: string, payload: InteractionResponse): Promise<void>

// Open a modal dialog
openModal(triggerId: string, view: SlackModalView): Promise<void>

// Post ephemeral message (visible only to one user)
postEphemeral(channel: string, userId: string, payload: MessagePayload): Promise<void>
```

### Block Kit Helpers

**Location:** `api/src/adapters/block-kit.ts`

Small utility module for building Block Kit payloads with type safety:

```typescript
section(text: string): SectionBlock
actions(...elements: InteractiveElement[]): ActionsBlock
button(text: string, actionId: string, style?: "primary" | "danger"): ButtonElement
context(...elements: TextObject[]): ContextBlock
divider(): DividerBlock
header(text: string): HeaderBlock
fields(pairs: [string, string][]): SectionBlock  // key-value pairs as fields
```

### Messaging Adapter Interface Updates

Extend `MessagingAdapter` interface with optional methods for interactivity:

```typescript
respondToInteraction?(responseUrl: string, payload: unknown): Promise<void>
openModal?(triggerId: string, view: unknown): Promise<void>
postEphemeral?(channel: string, userId: string, payload: MessagePayload): Promise<void>
```

Optional so that Teams/Google Chat adapters don't need to implement them immediately.

---

## 6. Agent Tools Enhancement

The existing agent dispatch system continues to handle conversational Slack interactions. Enhance the agent's tool set with:

- **`query_entity`** — look up any Factory entity by slug, return structured data
- **`list_deployments`** — filter by site, component, status, time range
- **`list_releases`** — filter by system, status
- **`trigger_deploy`** — initiate a deployment (may go through approval)
- **`trigger_rollback`** — initiate a rollback
- **`get_site_status`** — health/status overview for a site

These tools are invoked by the agent when users ask natural language questions in Slack threads.

---

## 7. Channel Mapping Extension

The existing `channelMapping` table supports `entityKind` of `module`, `team`, `domain`. Extend to also support:

- `site` — for environment-specific notifications
- `system` — for system-level events
- `org` — for org-wide broadcasts

This allows notification rules to resolve target channels from entity context (e.g., a deployment event on site "prod" finds the channel mapped to that site).

---

## Files to Create/Modify

### New Files

- `api/src/lib/event-bus.ts` — EventEmitter singleton + typed event helpers
- `api/src/modules/notifications/notification-engine.ts` — Rule evaluation + dispatch
- `api/src/modules/notifications/notification-templates.ts` — Default Block Kit templates per event type
- `api/src/modules/notifications/notification.controller.ts` — CRUD API for notification rules
- `api/src/modules/notifications/notification.model.ts` — DB operations for rules
- `api/src/modules/messaging/interaction.controller.ts` — Slack interactive payload handler
- `api/src/modules/messaging/slash-command.controller.ts` — Slash command handler
- `api/src/modules/messaging/action-router.ts` — Routes action_ids to handlers
- `api/src/modules/approval/approval.service.ts` — Approval request lifecycle
- `api/src/modules/approval/approval.model.ts` — DB operations for approvals
- `api/src/adapters/block-kit.ts` — Block Kit builder helpers

### Modified Files

- `api/src/db/schema/org.ts` (or `org-v2.ts`) — Add `notificationRule` + `approvalRequest` tables
- `api/src/adapters/messaging-adapter-slack.ts` — Add `respondToInteraction`, `openModal`, `postEphemeral`
- `api/src/adapters/messaging-adapter.ts` — Extend interface with optional interactivity methods
- `api/src/factory.api.ts` — Register new controllers
- `api/src/modules/messaging/messaging.service.ts` — Extend channel mapping entity kinds
- `shared/src/schemas/org.ts` — Add Zod schemas for notification rules + approval requests
- `api/src/lib/id.ts` — Add prefixes: `nrule` (notification rule), `aprv` (approval request)
- Various service files — Add `eventBus.emit(...)` calls at state change points

---

## Verification

1. **Event bus:** Write unit tests that emit events and verify subscribers receive them with correct payloads
2. **Notification engine:** Test rule matching with various event patterns and filters; verify correct channel resolution and Block Kit rendering
3. **Interaction controller:** Test with mock Slack interactive payloads (block_actions, view_submission); verify signature validation and action routing
4. **Approval flow:** End-to-end test: create approval → verify Slack message posted → simulate button click → verify status update and callback execution
5. **Slash commands:** Test each command with mock Slack payloads; verify entity resolution, response format, and ephemeral/in-channel routing
6. **Integration test:** Configure a notification rule, emit an event, verify the correct Block Kit message is sent to the correct Slack channel via the adapter

---

## Decomposition (Build Order)

This is a large surface area. Recommended build order:

1. **Event bus + types** — foundation everything else depends on
2. **Block Kit helpers** — needed by notifications, approvals, and slash commands
3. **Adapter extensions** — `respondToInteraction`, `postEphemeral`, `openModal`
4. **Notification rules (schema + CRUD)** — the data model
5. **Notification engine** — connects event bus to Slack output
6. **Emit events from existing modules** — wire up deploy, build, release modules
7. **Interaction controller + action router** — handle button clicks
8. **Approval system** — model + service + Block Kit cards
9. **Slash command controller** — `/factory` commands
10. **Agent tool enhancements** — query/trigger tools for conversational use
