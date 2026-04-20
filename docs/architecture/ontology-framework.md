# Ontology Framework

The `@lepton/ontology` framework is how you define entities, actions, connectors, reconcilers, and worlds. It is deliberately prescriptive. There is one way to do each thing. The framework makes the wrong thing hard to express and the right thing automatic.

## Philosophy

**Convention over configuration.** You define an entity once. The framework generates the database table, Zod schemas, API routes, CLI metadata, inventory kind, OpenAPI spec, and agent tool contract. You do not write these by hand.

**Declare, don't wire.** You never call `ontologyRoutes()` directly, never register entities in a map, never add inventory arms manually. You write a definition. The framework discovers and wires it.

**The framework owns the lifecycle.** Transactions, event emission, decision traces, policy evaluation, error handling, retries, observability — these are not your responsibility. The framework provides them. You write business logic only.

**One file, one concern.** Each entity is one file. Each action is one file or co-located with its entity. Each connector is one file. Each reconciler is one file. Each world is one directory with one index.

**Wrong code should not compile.** TypeScript types enforce that entity kinds are literal strings, specs are Zod objects, actions reference valid entity kinds, and connectors declare their capabilities. If it compiles, it is structurally correct.

**Wrong behavior should fail at startup.** The framework validates all world definitions at boot: unique kinds, unique prefixes, valid relationship targets, valid connector references, no circular dependencies. You find mistakes immediately, not at 3am.

---

## Closed Decisions

These are not configurable. They are the framework.

| Decision               | Answer                                                                                                                 | Rationale                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Entity identity        | `id` (prefixed, generated) + `slug` (human, unique)                                                                    | Every entity has both. Always.                                                                            |
| Entity storage         | JSONB `spec` + JSONB `metadata` + scalar FK/type columns                                                               | Configuration goes in spec. Lookup/filter columns are scalar.                                             |
| Type columns           | Plain `text` in Postgres, validated by Zod enum                                                                        | No migrations for new types.                                                                              |
| Reconciliation         | `status` (JSONB with conditions) + `generation` + `observedGeneration`                                                 | Every reconciled entity uses this pattern.                                                                |
| Concurrency            | Optimistic concurrency via `resourceVersion`                                                                           | Every write bumps it. Updates must send current version or get 409.                                       |
| Spec/status boundary   | Users and actions write `spec`. Reconcilers and the framework write `status`.                                          | Enforced by the API. PATCH to main resource ignores status. `/status` subresource ignores spec.           |
| Status shape           | Conditions array, not a single enum                                                                                    | Multi-dimensional health. Each condition has `type`, `status`, `reason`, `message`, `observedGeneration`. |
| Deletion               | Finalizer-gated soft delete, then hard delete when finalizers clear                                                    | Entities with external resources cannot be deleted until cleanup is confirmed.                            |
| Owner references       | Parent-child via `ownerRef` with cascading garbage collection                                                          | Delete a parent, children are cleaned up.                                                                 |
| Temporal               | Optional bitemporal columns (`validFrom`/`validTo`/`systemFrom`/`systemTo`)                                            | Opt-in per entity via trait.                                                                              |
| API shape              | `GET /`, `GET /:slugOrId`, `POST /`, `POST /:slugOrId/update`, `POST /:slugOrId/delete`, `/status`, relations, actions | Generated. Not customizable. Same for static and dynamic entities.                                        |
| Entity lifecycle       | Optional local state machine with `phase` column, valid states, valid transitions                                      | Intrinsic to the entity kind. Actions declare `allowedStates`/`transitionsTo`. Framework enforces.        |
| Change notification    | Watch subscriptions (future) + event subscriptions (NATS, now)                                                         | Events are the primary reactive mechanism. Watch is Phase 5+.                                             |
| Event emission         | Transactional outbox to NATS                                                                                           | All events go through `EventStore`. No direct NATS publishing.                                            |
| Action lifecycle       | `validate` &rarr; `plan` &rarr; `execute`                                                                              | Every action supports all three modes. The framework provides `plan` automatically.                       |
| Decision traces        | Automatic for actions with `material: true`                                                                            | You do not manually emit traces. The framework captures them.                                             |
| Connector side effects | Blocked in `plan` mode                                                                                                 | Hard invariant. Connectors cannot mutate external systems during dry-run.                                 |
| Error representation   | Typed Effect errors per domain                                                                                         | No thrown exceptions. No string error codes.                                                              |
| Testing                | Kernel-provided test harness with fake services                                                                        | You test against the framework, not around it.                                                            |

---

## Resource Model

Every entity in every world has exactly the same envelope. This is the framework's equivalent of the Kubernetes resource model. You define `spec` and `status` shapes. The framework provides everything else.

### The Universal Entity Envelope

```typescript
{
  // Identity — framework-managed, immutable after creation
  id: "intx_a1b2c3d4",                   // prefixed, globally unique
  slug: "mg-road-junction",              // human-readable, unique within kind+namespace
  name: "MG Road Junction",              // display name
  kind: "intersection",                  // entity kind
  worldId: "trafficure",                 // owning world
  namespace: "network",                  // schema/domain grouping

  // Versioning — framework-managed
  resourceVersion: 847291,               // increments on EVERY write (spec, status, metadata)
  generation: 3,                         // increments only when spec changes
  createdAt: "2026-04-15T10:00:00Z",
  updatedAt: "2026-04-16T14:30:00Z",

  // Ownership and lifecycle — framework-managed
  ownerRef: {                            // optional parent reference
    kind: "zone",
    id: "zone_x9y8z7",
    slug: "pune-central",
    controller: true,                    // this owner manages this entity's lifecycle
    cascadeDelete: true,                 // delete entity when owner is deleted
  },
  finalizers: [                          // prevent deletion until cleanup completes
    "trafficure.io/signal-controller-cleanup",
  ],
  deletionRequestedAt: null,             // set when DELETE is called; entity is "terminating"

  // Flexible metadata — user-writable
  metadata: {
    labels: {                            // indexed key-value pairs for filtering/selection
      "region": "pune",
      "tier": "arterial",
      "managed-by": "dx-inventory",
    },
    annotations: {                       // non-indexed key-value pairs for tooling
      "deploy-tool/last-sync": "2026-04-16T14:00:00Z",
    },
    tags: ["critical", "peak-hour-priority"],
  },

  // Domain columns — defined by entity, stored as scalar columns for FK/filtering
  zoneId: "zone_x9y8z7",

  // Desired state — written by users and actions, never by reconcilers
  spec: {
    latitude: 18.5204,
    longitude: 73.8567,
    signalType: "adaptive",
    phaseCount: 4,
    currentTimingPlanId: "plan-peak-hours",
    lifecycle: "active",
  },

  // Observed state — written by reconcilers and the framework, never by users
  status: {
    observedGeneration: 3,               // which generation the reconciler last processed
    conditions: [
      {
        type: "Healthy",
        status: "True",                  // "True", "False", or "Unknown"
        reason: "AllSignalsOperational",
        message: "All 4 signal heads responding normally",
        lastTransitionTime: "2026-04-16T14:25:00Z",
        observedGeneration: 3,
      },
      {
        type: "TimingPlanSynced",
        status: "True",
        reason: "PlanApplied",
        message: "Timing plan plan-peak-hours active on controller",
        lastTransitionTime: "2026-04-16T14:30:00Z",
        observedGeneration: 3,
      },
      {
        type: "DetectorOnline",
        status: "False",
        reason: "LoopDetectorFault",
        message: "Detector D3 on south approach not responding",
        lastTransitionTime: "2026-04-16T13:00:00Z",
        observedGeneration: 2,
      },
    ],
    // Entity-specific status fields (from the status schema in defineEntity)
    activeAlerts: 1,
    currentPhase: "green-ns",
    lastObservedAt: "2026-04-16T14:30:00Z",
  },
}
```

### Dormant Fields

The envelope is universal, but most fields are dormant until needed. A simple entity like `plan` carries the reconciliation columns (status, generation, observedGeneration), but they're null/zero until a reconciler is attached. The cost of carrying dormant fields is negligible (null JSONB, zero-value integers). The cost of NOT having them when a connector appears and you need reconciliation is high (schema migration, API surface changes, code changes).

Any entity can transition from "just a record" to "reconciled" at any time. A `customer` is a record until you connect Stripe — then Stripe becomes the source of truth and reconciliation is needed. A `repo` is a catalog entry until you connect GitHub. The envelope supports this without migration.

### Why This Envelope

Each field solves a specific problem:

| Field                 | Problem Solved                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `resourceVersion`     | **Optimistic concurrency.** Every update must include the current `resourceVersion`. If another writer changed the entity since you read it, you get a 409 Conflict. No lost updates without locks.                                                                                                                                        |
| `generation`          | **Convergence detection.** Incremented only on spec changes. When `status.observedGeneration == generation`, the reconciler has caught up. When they differ, reconciliation is needed.                                                                                                                                                     |
| `ownerRef`            | **Cascading cleanup.** When a zone is deleted, all its intersections are automatically cleaned up. No orphaned children. No manual cascade logic.                                                                                                                                                                                          |
| `finalizers`          | **Cooperative deletion.** An entity with external resources (deployed containers, hardware configs, DNS records) cannot be hard-deleted until each interested controller confirms cleanup. DELETE sets `deletionRequestedAt`; controllers do cleanup and remove their finalizer; entity is actually deleted when finalizers list is empty. |
| `deletionRequestedAt` | **Two-phase delete.** The entity is visible as "terminating" until finalizers clear. Controllers watching the entity see this and perform cleanup.                                                                                                                                                                                         |
| `conditions`          | **Multi-dimensional health.** An intersection can simultaneously be `Healthy=True`, `TimingPlanSynced=True`, but `DetectorOnline=False`. A single status enum cannot express this. Conditions are independently settable by different reconcilers or observers.                                                                            |
| `labels`              | **Indexed selection.** Queries like "all intersections in region pune with tier arterial" compile to indexed SQL. Labels are the primary filtering mechanism for object sets.                                                                                                                                                              |
| `annotations`         | **Non-indexed metadata.** Tooling data that should not affect query performance: last sync timestamps, deploy tool references, debugging notes.                                                                                                                                                                                            |

### Spec/Status Write Enforcement

The framework enforces who can write what:

```
POST   /:entity                         → writes spec + metadata (user/action)
POST   /:entity/:slugOrId/update        → writes spec + metadata (user/action)
POST   /:entity/:slugOrId/status        → writes status only (reconciler/framework)
POST   /:entity/:slugOrId/delete        → initiates deletion (user/action)
POST   /:entity/:slugOrId/:action       → writes spec via apply() (action handler)
```

**Users and actions write spec. Reconcilers write status. The API enforces this boundary.**

If an action handler calls `apply({ status: ... })`, the framework rejects it at compile time (TypeScript) or runtime. Actions change desired state (spec). Reconcilers report observed state (status).

This prevents the common bug where a controller accidentally writes to spec and triggers itself in an infinite reconciliation loop.

### Conditions Pattern

Conditions replace single-field status enums with a structured array. Each condition:

```typescript
type Condition = {
  type: string // dimension: "Healthy", "Synced", "Available", "Progressing"
  status: "True" | "False" | "Unknown"
  reason: string // machine-readable CamelCase: "MinimumReplicasAvailable"
  message: string // human-readable explanation
  lastTransitionTime: string // when status last changed (not last checked)
  observedGeneration: number // which generation this condition reflects
}
```

**Convention:** Name conditions so `status: "True"` is the healthy/desired state. Tools and dashboards can generically display any entity's health by checking all conditions for `True`.

**Multiple reconcilers can write different conditions.** A timing-plan reconciler writes `TimingPlanSynced`. A detector observer writes `DetectorOnline`. A health aggregator writes `Healthy`. They are independent.

**`observedGeneration` per condition** lets you know if a condition is stale. If a condition's `observedGeneration` is 2 but the entity's `generation` is 5, that condition hasn't been re-evaluated against the latest spec.

### Finalizer Protocol

Deletion of entities with external resources follows this protocol:

```
1. User sends DELETE request.
2. Framework does NOT delete the entity.
3. Framework sets deletionRequestedAt = now.
4. Entity is now "terminating" — visible in LIST/GET, cannot have spec changes.
5. Reconcilers/reactions watching this entity see deletionRequestedAt is set.
6. Each performs cleanup (delete external resources, revoke creds, remove configs).
7. Each removes its finalizer string from the entity's finalizers list.
8. When finalizers list is empty, framework hard-deletes the entity.
```

**Entities without finalizers are deleted immediately.** Finalizers are opt-in.

```typescript
// In a reconciler:
converge: ({ entity, apply, connector }) =>
  Effect.gen(function* () {
    // Check if entity is being deleted
    if (entity.deletionRequestedAt) {
      // Clean up external resource
      yield* connector.act("remove-config", {
        controllerId: entity.spec.externalId,
      })
      // Remove our finalizer — framework deletes entity when all finalizers clear
      yield* apply({
        removeFinalizer: "trafficure.io/signal-controller-cleanup",
      })
      return
    }

    // Normal reconciliation...
  })
```

### Owner References and Garbage Collection

Owner references create parent-child relationships with automatic lifecycle management:

```typescript
// When creating a child entity:
await world.entity("signal-controller").create({
  slug: "sig-mg-road-1",
  name: "MG Road Controller 1",
  spec: { ... },
  ownerRef: {
    kind: "intersection",
    id: parentIntersection.id,
    controller: true,
    cascadeDelete: true,
  },
})
```

When the parent intersection is deleted:

- **`cascadeDelete: true`**: Child signal-controllers are deleted (respecting their own finalizers).
- **`cascadeDelete: false`**: Child signal-controllers are orphaned (ownerRef is removed, entity survives).

**At most one ownerRef can have `controller: true`.** This is the "managing owner" — the entity whose reconciler is responsible for the child's lifecycle.

The framework provides a garbage collector that watches for deleted owners and processes dependent entities automatically. You do not implement cascading deletion.

### Optimistic Concurrency

Every entity write must include `resourceVersion`:

```typescript
// Read
const entity = await world.entity("intersection").get("mg-road")
// entity.resourceVersion = 847291

// Update — must include resourceVersion
await world.entity("intersection").update("mg-road", {
  resourceVersion: 847291, // must match current
  spec: { phaseCount: 5 },
})
// New resourceVersion = 847292

// Concurrent update with stale version → 409 Conflict
await world.entity("intersection").update("mg-road", {
  resourceVersion: 847291, // stale!
  spec: { lifecycle: "maintenance" },
})
// → ConcurrencyConflict error: entity was modified since you read it
```

**The client must re-read and retry.** This prevents lost updates without database-level row locks.

`generation` vs `resourceVersion`:

- `resourceVersion` changes on **every** write: spec, status, metadata, finalizers. Used for concurrency control.
- `generation` changes only on **spec** writes. Used for reconciliation convergence detection.

### Watch Subscriptions (Future)

Watch subscriptions allow clients to subscribe to entity changes instead of polling via `GET /:entity?watch=true&resourceVersion=N`. The server streams change events over a held connection.

**Use cases:** real-time UI dashboards, agent observation loops, cross-world event bridges, CLI live monitoring.

**Implementation note:** Watch requires significant infrastructure — a change log or WAL-based event source, server-side connection management, heartbeats, reconnection protocol, event buffering, and filtered watches. The `watchable` trait opts an entity kind into this. The design is inspired by the Kubernetes watch/informer pattern. This is Phase 5+ work — the concept is correct but the implementation is non-trivial. Until watch is built, use the event subscription system (NATS) for reactive notifications.

---

## The Seven Primitives

Everything in the framework is one of seven things:

1. **Entity** &mdash; a thing that exists (with optional local lifecycle state machine)
2. **Action** &mdash; a thing that can happen to an entity
3. **Function** &mdash; a computed value derived from entity properties
4. **Connector** &mdash; a bridge to an external system
5. **Reconciler** &mdash; a loop that closes drift
6. **World** &mdash; a bounded collection of the above
7. **Process** &mdash; a cross-entity workflow DAG that composes actions (separate layer)

---

### 1. Entity

An entity definition is the single source of truth for a business object. You write one `defineEntity()` call. Everything else is generated.

```typescript
// worlds/trafficure/entities/intersection.ts

import { defineEntity, ref } from "@lepton/ontology"
import { z } from "zod"

export const intersection = defineEntity({
  kind: "intersection",
  namespace: "network",
  prefix: "intx",

  spec: z.object({
    latitude: z.number(),
    longitude: z.number(),
    geometry: z.unknown().optional(),
    signalType: z
      .enum(["fixed-time", "actuated", "adaptive"])
      .default("fixed-time"),
    phaseCount: z.number().int().optional(),
    pedestrianPhases: z.boolean().default(false),
    currentTimingPlanId: z.string().optional(),
    lifecycle: z
      .enum(["planned", "construction", "active", "decommissioned"])
      .default("planned"),
  }),

  // Status shape — only the entity-specific fields.
  // The framework automatically adds: observedGeneration, conditions[].
  status: z.object({
    lastObservedAt: z.string().optional(),
    activeAlerts: z.number().int().default(0),
    currentPhase: z.string().optional(),
  }),

  // Scalar columns promoted from spec for filtering/FK use.
  // Everything else stays in spec JSONB.
  columns: {
    zoneId: ref("zone").optional(),
  },

  // Traits compose behavior. Each adds columns, lifecycle rules, and API capabilities.
  traits: [
    "locatable", // validates lat/lng in spec, adds geo index
    "owned", // adds ownerTeamId, scopes queries
    "reconciled", // enforces spec/status split, adds conditions, enables reconciler
    "finalizable", // two-phase deletion, cleanup before removal
    "watchable", // enables ?watch=true change stream
  ],

  // Optional local lifecycle state machine — intrinsic to what this entity IS.
  // This is NOT a workflow. It constrains which actions are valid in which states.
  lifecycle: {
    field: "phase", // stored as a top-level column
    initial: "planned",
    states: {
      planned: { transitions: ["construction"] },
      construction: { transitions: ["active", "planned"] },
      active: { transitions: ["maintenance", "decommissioned"] },
      maintenance: { transitions: ["active", "decommissioned"] },
      decommissioned: { terminal: true },
    },
  },

  relationships: [
    {
      name: "signals",
      target: "signal-controller",
      foreignKey: "intersectionId",
    },
    { name: "detectors", target: "detector", foreignKey: "intersectionId" },
    { name: "incidents", target: "incident", foreignKey: "intersectionId" },
  ],
})
```

**What you wrote:** ~55 lines.

**What the framework generates:**

| Artifact                   | Details                                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drizzle table              | `trafficure_network.intersection` with `id`, `slug`, `name`, `zoneId`, `spec`, `metadata`, `status`, `generation`, `observedGeneration`, `createdAt`, `updatedAt`, indexes |
| `IntersectionSchema`       | Full Zod schema for wire format (id + slug + name + spec + status + timestamps + reconciliation)                                                                           |
| `CreateIntersectionSchema` | Zod schema for POST body (slug + name + spec with defaults + optional columns)                                                                                             |
| `UpdateIntersectionSchema` | Partial of Create schema                                                                                                                                                   |
| `OntologyRouteConfig`      | Config object for `ontologyRoutes()` with slug/id columns, relations, lifecycle hooks                                                                                      |
| Registry entry             | Kind `"intersection"` in `ONTOLOGY_REGISTRY` with prefix, table ref, slug-ref config                                                                                       |
| Inventory arm              | `z.literal("intersection")` discriminant in `InventoryEntitySchema` union                                                                                                  |
| CLI metadata               | Entity def for CLI entity explorer (module, label, prefix, kind)                                                                                                           |
| OpenAPI schema             | Request/response schemas under `/trafficure/network/intersections`                                                                                                         |
| Agent tool                 | Typed tool contract: `trafficure.intersection.list`, `.get`, `.create`, `.update`, `.delete`                                                                               |

#### Entity Rules

1. **`kind` must be a kebab-case literal string.** Not camelCase, not PascalCase, not a variable.
2. **`namespace` groups entities into Postgres schemas and URL path segments.** An entity in namespace `"network"` in world `"trafficure"` gets Postgres schema `trafficure_network` and URL prefix `/trafficure/network/`.
3. **`prefix` must be globally unique across all worlds.** It is the entity ID prefix (e.g., `intx_a1b2c3`). The framework validates this at startup.
4. **`spec` must be a `z.object()`.** Not `z.record()`, not `z.unknown()`, not `z.any()`. The framework needs to know the shape.
5. **`status` is required if the entity has the `reconciled` trait.** The framework automatically wraps your status schema to include `observedGeneration` and `conditions[]`. You define only entity-specific status fields.
6. **`columns` declares scalar FK/filter columns only.** Use `ref("other-entity")` for foreign keys. Use `col.text()`, `col.integer()`, `col.enum(["a","b"])` for promoted scalars. Everything else stays in `spec`.
7. **`relationships` are read-only.** They generate `GET /:slugOrId/signals` endpoints. Mutations go through the related entity's own routes.
8. **Deletion is controlled by traits.** `finalizable` entities get two-phase deletion with cleanup. `bitemporal` entities get soft-delete. Entities with neither get hard-delete. You do not set `deletable` directly.
9. **No lifecycle hooks in the entity definition.** Use reactions for before/after logic. The entity definition is pure data.
10. **`resourceVersion` is framework-managed.** You never set it. It increments on every write. Updates must include the current value for optimistic concurrency. The framework rejects stale writes with 409 Conflict.
11. **`generation` is framework-managed.** It increments only on spec changes, not status or metadata changes. Reconcilers use it to detect convergence.
12. **`lifecycle` is optional.** If present, it adds a `phase` column (or whatever `field` specifies) and the framework enforces valid transitions. Actions declare which states they're valid in via `allowedStates`. The framework rejects actions called from an invalid state with 409. Lifecycle is local to one entity — use `defineProcess()` for cross-entity orchestration.
13. **Lifecycle is not a workflow.** A host's lifecycle (`active → maintenance → decommissioned`) is intrinsic to what a host IS. A "release pipeline" that orchestrates PRs, builds, deployments, and monitoring is a process that spans entities. Don't confuse the two.

#### What About Hooks?

The current codebase uses lifecycle hooks (`afterCreate`, `beforeUpdate`, etc.) inside `OntologyRouteConfig`. The framework replaces these with **entity reactions**: actions that are automatically triggered by entity lifecycle events.

```typescript
// worlds/factory/reactions/host-ip-assignment.ts

import { defineReaction } from "@lepton/ontology"

export const hostIpAssignment = defineReaction({
  name: "host-ip-assignment",
  trigger: { entity: "host", event: "created" },

  handler: ({ entity, db }) =>
    Effect.gen(function* () {
      const ips = entity.spec.ips ?? []
      for (const address of ips) {
        yield* EntityStore.upsert("ip-address", { address })
        yield* EntityStore.link(
          "ip-address",
          { address },
          {
            assignedToKind: "host",
            assignedToId: entity.id,
          }
        )
      }
    }),
})
```

Reactions are explicit, testable, and discoverable. They replace implicit hooks.

---

### 2. Action

An action is a named operation on an entity. You write a `defineAction()` call with input/output schemas and a handler. The framework wraps it in a transaction, validates input, checks permissions, blocks connector side effects in plan mode, emits events, captures decision traces, and handles errors.

```typescript
// worlds/trafficure/actions/update-timing-plan.ts

import { defineAction } from "@lepton/ontology"
import { z } from "zod"

const PhaseSchema = z.object({
  id: z.string(),
  green: z.number().int(),
  amber: z.number().int(),
  red: z.number().int(),
  pedestrian: z.boolean().default(false),
})

export const updateTimingPlan = defineAction({
  name: "update-timing-plan",
  target: "signal-controller",

  input: z.object({
    planId: z.string(),
    phases: z.array(PhaseSchema).min(1),
    cycleLength: z.number().int().min(10).max(300),
    offset: z.number().int().default(0),
  }),

  output: z.object({
    previousPlanId: z.string().nullable(),
    applied: z.boolean(),
  }),

  permissions: ["traffic:signals:write"],
  material: true, // emits decision trace
  connector: "signal-controller-api", // declares external side effect

  handler: ({ entity, input, apply, connector }) =>
    Effect.gen(function* () {
      const previousPlanId = entity.spec.currentTimingPlanId ?? null

      // Update entity spec. apply() stages the edit within the transaction.
      yield* apply({ spec: { currentTimingPlanId: input.planId } })

      // Push to real hardware.
      // In plan mode: this call is intercepted and returns a simulated success.
      // In execute mode: this calls the real connector.
      yield* connector.act("push-plan", {
        controllerId: entity.spec.externalId,
        phases: input.phases,
        cycleLength: input.cycleLength,
        offset: input.offset,
      })

      return { previousPlanId, applied: true }
    }),
})
```

#### What the framework does automatically

When this action is called via `POST /trafficure/signals/signal-controllers/:id/update-timing-plan`:

**In `validate` mode:**

1. Parse and validate `input` against the Zod schema.
2. Resolve entity by slug or ID.
3. Evaluate `permissions` against the current principal.
4. Return `{ valid: true }` or `{ valid: false, errors: [...] }`.

**In `plan` mode:**

1. Everything in `validate`.
2. Open a database transaction.
3. Run the `handler`.
4. Intercept all `apply()` calls &mdash; record proposed edits but do not commit.
5. Intercept all `connector.*` calls &mdash; return simulated responses, do not call real systems.
6. Record all events that would be emitted.
7. **Roll back** the transaction.
8. Return `{ edits, events, connectorCalls, policyEvaluations }`.

**In `execute` mode:**

1. Everything in `validate`.
2. Open a database transaction.
3. Run the `handler`.
4. `apply()` writes real edits.
5. `connector.*` calls real external systems.
6. Emit events to event store + outbox.
7. Capture decision trace (because `material: true`).
8. **Commit** the transaction.
9. Return the handler's output.

**You do not choose which of these steps to implement.** They all happen. You write the handler.

#### Action Rules

1. **`name` is kebab-case.** It becomes the URL segment: `POST /:slugOrId/update-timing-plan`.
2. **`target` references an entity kind.** The framework validates this at startup.
3. **`input` and `output` must be `z.object()`.** Not optional, not `z.any()`.
4. **`permissions` is a non-empty array of permission strings.** No anonymous actions.
5. **`material: true` means a decision trace is captured.** Use this for actions that change real state or have external side effects. CRUD operations are not material by default; actions that deploy, provision, restart, approve, or escalate are.
6. **`connector` declares which connector this action may call.** If absent, the action has no external side effects. The framework enforces this: you cannot call a connector that is not declared.
7. **`handler` receives a context, not raw `db`/`req`.** You interact through `apply()`, `connector`, `emit()`, `entity`. No raw Drizzle queries.
8. **No try/catch.** Return Effect errors. The framework handles error responses.
9. **`allowedStates` constrains when the action is valid.** If the target entity has a `lifecycle`, the framework checks the current state before executing. Returns 409 if the entity is in an invalid state. Optional — omit for actions valid in any state.
10. **`transitionsTo` sets the entity's lifecycle state after success.** The framework validates at startup that this transition is legal per the entity's lifecycle definition. The state change happens atomically with the action's edits.

#### Simple Actions (No Connector)

Most actions are simpler:

```typescript
// worlds/factory/actions/start-host.ts

export const startHost = defineAction({
  name: "start",
  target: "host",

  input: z.object({
    reason: z.string().optional(),
  }),

  output: z.object({
    previousState: z.string(),
  }),

  permissions: ["infra:hosts:power"],
  material: true,

  handler: ({ entity, input, apply }) =>
    Effect.gen(function* () {
      const previous = entity.spec.powerState ?? "unknown"
      yield* apply({ spec: { powerState: "on" } })
      return { previousState: previous }
    }),
})
```

---

### 3. Connector

A connector bridges the twin to an external system. It declares what it can do (observe, act, receive webhooks) and provides typed handlers for each capability.

```typescript
// worlds/trafficure/connectors/signal-controller-api.ts

import { defineConnector } from "@lepton/ontology"
import { z } from "zod"

export const signalControllerApi = defineConnector({
  kind: "signal-controller-api",

  config: z.object({
    endpoint: z.string().url(),
    apiKey: z.string(),
    protocol: z.enum(["ntcip", "utmc", "proprietary"]).default("ntcip"),
    timeoutMs: z.number().int().default(5000),
  }),

  observe: {
    "read-state": {
      output: z.object({
        activePlan: z.string().nullable(),
        currentPhase: z.string(),
        mode: z.enum(["normal", "flash", "dark", "emergency"]),
        faults: z.array(z.string()),
        uptimeSeconds: z.number(),
      }),
      handler: ({ config }) =>
        Effect.gen(function* () {
          const response = yield* HttpClient.get(`${config.endpoint}/state`, {
            headers: { Authorization: `Bearer ${config.apiKey}` },
            timeout: config.timeoutMs,
          })
          return yield* response.json
        }),
    },
  },

  act: {
    "push-plan": {
      input: z.object({
        controllerId: z.string(),
        phases: z.array(z.unknown()),
        cycleLength: z.number().int(),
        offset: z.number().int(),
      }),
      output: z.object({
        accepted: z.boolean(),
        controllerId: z.string(),
      }),
      handler: ({ config, input }) =>
        Effect.gen(function* () {
          const response = yield* HttpClient.post(`${config.endpoint}/plans`, {
            body: input,
            headers: { Authorization: `Bearer ${config.apiKey}` },
            timeout: config.timeoutMs,
          })
          return yield* response.json
        }),
    },
  },
})
```

#### Connector Rules

1. **`kind` is globally unique across all worlds.** It is how actions reference the connector.
2. **`config` defines connection parameters.** Credentials, endpoints, timeouts. Stored encrypted in the secret backend per connection instance.
3. **`observe` capabilities are read-only.** They query external state. They may be called in any mode.
4. **`act` capabilities have side effects.** They mutate external systems. **They are blocked in `plan` mode.** The framework intercepts these calls and returns a simulated response when running a dry-run.
5. **`webhook` capabilities (not shown) define inbound event schemas.** The framework generates webhook receiver endpoints.
6. **Each capability has typed `input` and `output`.** No `any`, no untyped payloads.
7. **Handlers receive the resolved config, not raw secrets.** The framework loads and decrypts the connection config.
8. **No retry logic in handlers.** The framework provides configurable retry policies per connector kind.
9. **No health check logic in handlers.** The framework calls `observe` capabilities periodically and derives health.

#### Simulated Responses

When a connector `act` capability is called in `plan` mode, the framework needs to return something. You provide this via `planResponse`:

```typescript
act: {
  "push-plan": {
    input: pushPlanInputSchema,
    output: pushPlanOutputSchema,
    planResponse: (input) => ({ accepted: true, controllerId: input.controllerId }),
    handler: ({ config, input }) => Effect.gen(function* () {
      // real implementation
    }),
  },
},
```

If `planResponse` is absent, the framework returns the Zod output schema's default values. If the schema has no defaults, plan mode returns `null` for that connector call and logs a warning.

---

### 4. Reconciler

A reconciler closes the gap between desired state (entity spec) and observed state (external system). It runs on a loop, observes reality, compares to intent, and converges.

```typescript
// worlds/trafficure/reconcilers/timing-plan.ts

import { defineReconciler } from "@lepton/ontology"

export const timingPlanReconciler = defineReconciler({
  name: "timing-plan-reconciler",
  target: "signal-controller",
  connector: "signal-controller-api",
  interval: "30s",

  // Which entities to reconcile. Default: all entities of this kind.
  scope: ({ entity }) => entity.spec.lifecycle === "active",

  // Read reality.
  observe: ({ connector }) =>
    Effect.gen(function* () {
      const state = yield* connector.observe("read-state")
      return { activePlan: state.activePlan, mode: state.mode }
    }),

  // Read intent.
  desired: ({ entity }) =>
    Effect.gen(function* () {
      return {
        activePlan: entity.spec.currentTimingPlanId,
        mode: entity.spec.operatingMode ?? "normal",
      }
    }),

  // Compare. Return null if converged, drift description if not.
  diff: (desired, observed) => {
    const drifts: string[] = []
    if (desired.activePlan !== observed.activePlan) drifts.push("timingPlan")
    if (desired.mode !== observed.mode) drifts.push("mode")
    if (drifts.length === 0) return null
    return { fields: drifts, desired, observed }
  },

  // Fix drift.
  converge: ({ connector, entity, setCondition, setStatus }, drift) =>
    Effect.gen(function* () {
      // Check for terminating entity — clean up and remove finalizer
      if (entity.deletionRequestedAt) {
        yield* connector.act("remove-config", {
          controllerId: entity.spec.externalId,
        })
        yield* removeFinalizer("trafficure.io/timing-plan-reconciler")
        return
      }

      // Normal convergence
      if (drift.fields.includes("timingPlan")) {
        yield* connector.act("push-plan", {
          controllerId: entity.spec.externalId,
          phases: entity.spec.timingPlanPhases,
          cycleLength: entity.spec.cycleLength,
          offset: entity.spec.offset ?? 0,
        })
      }

      // Set condition — framework stamps observedGeneration and lastTransitionTime
      yield* setCondition({
        type: "TimingPlanSynced",
        status: "True",
        reason: "PlanApplied",
        message: `Timing plan ${entity.spec.currentTimingPlanId} active on controller`,
      })

      // Set entity-specific status fields
      yield* setStatus({
        lastObservedAt: new Date().toISOString(),
      })
    }),

  // What to do when observe fails (connector down, timeout, etc.)
  onObserveFailure: ({ entity, error, setCondition }) =>
    Effect.gen(function* () {
      yield* setCondition({
        type: "TimingPlanSynced",
        status: "Unknown",
        reason: "ConnectorUnreachable",
        message: `Cannot reach signal controller: ${String(error)}`,
      })
    }),
})
```

#### Reconciler Rules

1. **One reconciler per entity kind per connector.** If `signal-controller` is reconciled via two different connectors, that is two reconcilers.
2. **`interval` is a duration string.** `"30s"`, `"5m"`, `"1h"`. The framework schedules it.
3. **`scope` filters which entities are reconciled.** Not all entities of a kind need reconciliation (e.g., only `lifecycle: "active"` ones).
4. **`observe` must use the declared connector.** No ad-hoc HTTP calls.
5. **`diff` is a pure function.** No side effects. It compares desired to observed and returns drift or null.
6. **`converge` fixes drift.** It may call the connector and update entity status conditions. It runs inside a transaction.
7. **`onObserveFailure` is required.** You must handle the case where the external system is unreachable. Use `setCondition` to report the failure.
8. **Reconcilers are level-triggered, not edge-triggered.** The reconciler does not ask "what changed?" — it asks "what is the current desired state and how does reality differ?" This makes reconcilers naturally idempotent and crash-resilient. If a reconciler restarts, it re-lists all entities in scope and converges each one.
9. **The framework tracks generations.** `entity.generation` increments on spec changes. `status.observedGeneration` is set by the reconciler after successful convergence via `setCondition()`. If `generation > observedGeneration`, the entity needs reconciliation.
10. **Reconcilers write conditions, not raw status.** Use `setCondition({ type, status, reason, message })`. The framework stamps `observedGeneration` and `lastTransitionTime` automatically.
11. **The framework provides overlap guards, DB-tracked runs, work-queue deduplication, requeue-with-backoff, manual trigger, and run history.** You do not implement these.
12. **Reconcilers must check `deletionRequestedAt`.** If the entity is terminating, the reconciler should clean up external resources and remove its finalizer instead of doing normal convergence.

---

### 5. World

A world is a bounded domain model. It is a directory that collects entities, actions, connectors, reconcilers, and reactions.

```typescript
// worlds/trafficure/index.ts

import { defineWorld } from "@lepton/ontology"

// Entities
import { intersection } from "./entities/intersection"
import { corridor } from "./entities/corridor"
import { signalController } from "./entities/signal-controller"
import { detector } from "./entities/detector"
import { incident } from "./entities/incident"
import { timingPlan } from "./entities/timing-plan"
import { zone } from "./entities/zone"

// Actions
import { updateTimingPlan } from "./actions/update-timing-plan"
import { activateEmergencyMode } from "./actions/activate-emergency-mode"
import { acknowledgeIncident } from "./actions/acknowledge-incident"
import { resolveIncident } from "./actions/resolve-incident"

// Connectors
import { signalControllerApi } from "./connectors/signal-controller-api"
import { detectorFeed } from "./connectors/detector-feed"
import { cameraFeed } from "./connectors/camera-feed"

// Reconcilers
import { timingPlanReconciler } from "./reconcilers/timing-plan"

// Reactions
import { incidentAutoEscalation } from "./reactions/incident-auto-escalation"

export const trafficure = defineWorld({
  id: "trafficure",
  name: "Trafficure Traffic Management",

  namespaces: ["network", "signals", "incidents", "analytics"],

  entities: [
    intersection,
    corridor,
    signalController,
    detector,
    incident,
    timingPlan,
    zone,
  ],

  actions: [
    updateTimingPlan,
    activateEmergencyMode,
    acknowledgeIncident,
    resolveIncident,
  ],

  connectors: [signalControllerApi, detectorFeed, cameraFeed],

  reconcilers: [timingPlanReconciler],

  reactions: [incidentAutoEscalation],
})
```

#### World Rules

1. **One world per directory.** The directory name matches the world ID.
2. **`id` is kebab-case.** It becomes the Postgres schema prefix and URL path segment.
3. **`namespaces` are the sub-schemas.** World `trafficure` with namespace `network` produces Postgres schema `trafficure_network` and URL prefix `/api/v1/trafficure/network/`.
4. **Every entity must belong to a declared namespace.** The framework validates this at startup.
5. **Every action must reference a `target` entity that exists in this world.** Cross-world actions are not allowed (use events).
6. **Every reconciler must reference a connector declared in this world.** No implicit dependencies.
7. **Worlds are isolated.** An entity in one world cannot have a foreign key to an entity in another world. Cross-world relationships use events, not FKs.
8. **The `index.ts` is the only export.** The framework imports worlds by their index. Internal files are not imported by anything outside the world directory.

#### The Factory World

The software factory is just another world:

```typescript
// worlds/factory/index.ts

import { defineWorld } from "@lepton/ontology"
import { host } from "./entities/host"
import { estate } from "./entities/estate"
import { site } from "./entities/site"
import { system } from "./entities/system"
import { component } from "./entities/component"
// ... all factory entities

export const factory = defineWorld({
  id: "factory",
  name: "Software Factory",
  namespaces: ["software", "infra", "ops", "build", "commerce", "org"],
  entities: [host, estate, site, system, component /* ... */],
  actions: [
    /* ... */
  ],
  connectors: [github, kubernetes, proxmox, jira, slack /* ... */],
  reconcilers: [
    deploymentReconciler,
    routeReconciler,
    workbenchReconciler /* ... */,
  ],
})
```

---

## Dynamic Entities

Not all entity kinds are defined in code. Products like SmartMarket let customers define their own entity kinds at runtime — mapping them to ingested datasets or creating them freeform for experimentation.

### Four Data Source Modes

Every entity kind has one of four data sources. The API surface is identical regardless of mode.

| Mode         | Schema Defined           | Instances Created     | Storage                          | Example                             |
| ------------ | ------------------------ | --------------------- | -------------------------------- | ----------------------------------- |
| **Static**   | In code (`defineEntity`) | CRUD via API          | Typed Postgres table             | Factory `host`                      |
| **Synced**   | In code (`defineEntity`) | Connector observation | Typed Postgres table, reconciled | Factory `repo` from GitHub          |
| **Mapped**   | At runtime (customer/AI) | Ingested dataset rows | Lakehouse (Parquet/Iceberg)      | SmartMarket `Store` from sales data |
| **Freeform** | At runtime (customer)    | CRUD via API          | Generic entity table             | Experiments, crowd-sourced models   |

### Runtime Entity Registration

Dynamic entity kinds are registered via API:

```typescript
await ontology.registerEntityKind({
  kind: "store",
  namespace: "retail",
  worldId: "acme-corp",

  // Mapped mode: backed by a dataset
  dataSource: {
    type: "mapped",
    primaryDataset: "sales_data_v3",
    primaryKeyColumn: "store_id",
  },

  properties: [
    {
      name: "name",
      type: "string",
      source: { dataset: "sales_data_v3", column: "store_name" },
    },
    {
      name: "revenue",
      type: "number",
      source: { dataset: "sales_data_v3", column: "monthly_revenue" },
    },
    {
      name: "area",
      type: "number",
      source: { dataset: "store_master", column: "area_sqft" },
    },
  ],

  relationships: [
    {
      name: "territory",
      targetKind: "territory",
      cardinality: "many-to-one",
      join: { type: "fk", sourceColumn: "territory_id", targetColumn: "id" },
    },
    {
      name: "demographics",
      targetKind: "demographic-zone",
      cardinality: "many-to-one",
      join: { type: "spatial", method: "h3-hex", resolution: 7 },
    },
  ],

  // Business vocabulary — synonyms for this entity kind
  vocabulary: [
    { term: "outlet", synonym: true },
    { term: "dealer", synonym: true },
  ],

  // Lifecycle — same pattern as static entities
  lifecycle: {
    field: "status",
    initial: "active",
    states: {
      active: { transitions: ["under-review", "suspended", "closed"] },
      "under-review": { transitions: ["active", "suspended"] },
      suspended: { transitions: ["active", "closed"] },
      closed: { terminal: true },
    },
  },
})
```

Freeform entities omit the dataset mapping:

```typescript
await ontology.registerEntityKind({
  kind: "patrol-route",
  namespace: "operations",
  worldId: "acme-corp",
  dataSource: { type: "freeform" }, // instances created via API, stored in generic table

  properties: [
    { name: "waypoints", type: "array", items: "string" },
    { name: "schedule", type: "string" },
    { name: "assignedUnit", type: "string" },
    { name: "estimatedDuration", type: "number" },
  ],
})

// Then create instances directly — no dataset needed
await ontology.entity("patrol-route").create({
  slug: "route-mg-road-morning",
  name: "MG Road Morning Patrol",
  spec: {
    waypoints: ["intx-mg-road", "intx-fc-road", "intx-jm-road"],
    schedule: "06:00-09:00",
    assignedUnit: "TPU-7",
    estimatedDuration: 45,
  },
})
```

### Generic Entity Storage

Freeform dynamic entities share one generic table:

```sql
CREATE TABLE twin.entity_instance (
  id              text PRIMARY KEY,
  kind            text NOT NULL,
  world_id        text NOT NULL,
  tenant_id       text NOT NULL,
  namespace       text NOT NULL,
  slug            text,
  name            text,
  phase           text,                          -- lifecycle state
  spec            jsonb DEFAULT '{}',
  status          jsonb DEFAULT '{}',
  metadata        jsonb DEFAULT '{}',
  resource_version bigint DEFAULT 0,
  generation      bigint DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),

  UNIQUE (world_id, tenant_id, kind, slug)
);
```

Same envelope as static entities. Same API surface. Same action/lifecycle/event/trace behavior. The only difference is storage location.

### Entity Kind Graduation

A freeform entity can graduate over time:

1. **Freeform** — customer experiments with "Patrol Route," creates 50 instances manually
2. **Mapped** — customer connects a GPS dataset, entity kind becomes dataset-backed
3. **Static** — product team promotes it to a `defineEntity()` with its own Drizzle table

The entity kind migrates between modes without changing its identity, relationships, actions, or history.

### Unified Query Surface

Agents and UIs query entities the same way regardless of data source:

```typescript
// Static entity (Postgres) — same API
const hosts = await world
  .objectSet("host")
  .filter({ "spec.lifecycle": "active" })
  .execute()

// Dynamic mapped entity (Lakehouse) — same API
const stores = await world
  .objectSet("store")
  .filter({ territory: "north-india" })
  .filter({ revenuePerSqFt: { gt: 500 } })
  .include("territory")
  .execute()

// Dynamic freeform entity (generic table) — same API
const routes = await world
  .objectSet("patrol-route")
  .filter({ assignedUnit: "TPU-7" })
  .execute()
```

The ObjectSet engine routes each query to the right backend: Drizzle/Postgres for static and freeform entities, Trino/SQL for mapped entities. The caller does not know or care which backend serves the entity.

---

### 3. Function

A function is a computed value derived from entity properties. For static entities, functions are TypeScript/Effect handlers. For dynamic entities, functions are expressions compiled to SQL.

```typescript
// worlds/trafficure/functions/intersection-load.ts

import { defineFunction } from "@lepton/ontology"

export const intersectionLoad = defineFunction({
  name: "current-load",
  target: "intersection",

  returnType: "number",
  description: "Current traffic load as percentage of rated capacity",
  dependencies: ["spec.ratedCapacity", "status.currentVolume"],

  handler: ({ entity }) =>
    Effect.gen(function* () {
      const capacity = entity.spec.ratedCapacity ?? 1
      const volume = entity.status?.currentVolume ?? 0
      return Math.min(100, Math.round((volume / capacity) * 100))
    }),
})
```

For dynamic entities, functions are expressions:

```typescript
await ontology.registerFunction({
  kind: "store",
  worldId: "acme-corp",
  function: {
    name: "revenue-per-sqft",
    returnType: "number",
    expression: "revenue / area",
    dependencies: ["revenue", "area"],
  },
})
```

Functions can be used in ObjectSet filters and aggregations:

```typescript
const overloaded = await world
  .objectSet("intersection")
  .filter({ "fn:current-load": { gt: 85 } })
  .execute()
```

#### Function Rules

1. **Functions are read-only.** They compute values, they do not mutate entities.
2. **Functions declare their dependencies.** The framework can cache results and invalidate when dependencies change.
3. **Static functions are Effect handlers.** They run in the API process.
4. **Dynamic functions are SQL expressions.** They compile to `SELECT expression FROM ...` and run in the query engine.
5. **Functions can compose.** A function can reference other functions in its dependencies.
6. **Functions are part of the entity's introspection.** Agents can discover available functions and their semantics.

---

## Processes

Processes are cross-entity workflows that compose ontology actions into a DAG. They are a **separate layer above the ontology**, not a kernel primitive. The ontology provides entities, actions, events, and traces. The process engine orchestrates them.

### Lifecycle vs Process

| Concern     | Lifecycle                         | Process                                         |
| ----------- | --------------------------------- | ----------------------------------------------- |
| Scope       | One entity                        | Multiple entities                               |
| Defined in  | `defineEntity({ lifecycle })`     | `defineProcess({ steps })`                      |
| State       | `phase` column on entity          | Process instance entity tracking current step   |
| Transitions | Action-driven, framework-enforced | DAG step execution, branch conditions           |
| Duration    | Instant (action completes)        | Long-running (hours, days, weeks)               |
| Example     | Host: `active → maintenance`      | Release pipeline: PR → build → deploy → monitor |

**Do not use lifecycle for multi-entity orchestration. Do not use processes for simple state management.**

### Process Definition

A process is a DAG of steps that transform entities:

```typescript
const releaseProcess = defineProcess({
  name: "release-pipeline",
  description: "Ship a release from PR merge to production",

  // Entity types this process touches
  subjects: {
    pr: "pull-request",
    artifact: "artifact",
    staging: "component-deployment",
    production: "component-deployment",
  },

  steps: {
    merge: {
      action: { target: "pr", name: "merge" },
      next: "build",
    },
    build: {
      action: { target: "artifact", name: "build" },
      waitFor: { entity: "artifact", phase: "built" },
      next: "deploy-staging",
    },
    "deploy-staging": {
      action: { target: "staging", name: "deploy" },
      waitFor: { entity: "staging", phase: "active" },
      next: "smoke-test",
    },
    "smoke-test": {
      function: "run-smoke-tests",
      branch: [
        { condition: "result.passed == true", next: "approval-gate" },
        { condition: "result.passed == false", next: "rollback" },
      ],
    },
    "approval-gate": {
      waitFor: "human",
      branch: [
        { condition: "decision == 'approve'", next: "deploy-production" },
        { condition: "decision == 'reject'", next: "rollback" },
      ],
    },
    "deploy-production": {
      action: { target: "production", name: "deploy" },
      waitFor: { entity: "production", phase: "active" },
      next: "monitor",
    },
    monitor: {
      waitFor: { duration: "15m" },
      function: "check-error-rate",
      branch: [
        { condition: "errorRate < 0.01", next: "complete" },
        { condition: "errorRate >= 0.01", next: "rollback" },
      ],
    },
    rollback: {
      action: { target: "staging", name: "rollback" },
      terminal: true,
      outcome: "failure",
    },
    complete: { terminal: true, outcome: "success" },
  },
})
```

### How Processes Interact With The Ontology

```
Process step invokes an Action
  → Action checks entity lifecycle (allowedStates)
  → Action mutates entity (apply)
  → Framework transitions entity phase (transitionsTo)
  → Framework emits lifecycle event
  → Reconciler observes new desired state, converges reality
  → Reconciler sets conditions on status
  → Process engine observes entity phase change
  → Process proceeds to next step
```

Each layer does one thing. Entity lifecycle is local state. Actions are atomic mutations. Reconcilers converge reality. Processes orchestrate the sequence across entities.

### Process Execution

Processes are backed by a durable execution engine (Temporal, which SmartMarket already uses, or the Factory's existing workflow engine). The process engine:

- Persists execution state durably (survives crashes)
- Handles long-running waits (human approval, duration timers, entity state watches)
- Supports branching, conditionals, parallel fan-out/fan-in
- Records each step as a decision trace
- Exposes process instance status via the ontology (process instances are entities)

### Dynamic Processes

Customers can define processes at runtime, just like they define entity kinds:

```typescript
await ontology.registerProcess({
  name: "store-performance-review",
  worldId: "acme-corp",
  subjects: { store: "store", manager: "principal" },
  steps: {
    flag: {
      action: { target: "store", name: "flag-for-review" },
      next: "collect-data",
    },
    "collect-data": { function: "gather-metrics", next: "assess" },
    assess: {
      function: "calculate-score",
      branch: [
        { condition: "score >= 80", next: "close-ok" },
        { condition: "score < 80", next: "manager-review" },
      ],
    },
    "manager-review": {
      waitFor: "human",
      branch: [
        { condition: "decision == 'approve'", next: "close-ok" },
        { condition: "decision == 'escalate'", next: "escalation" },
      ],
    },
    escalation: {
      action: { target: "store", name: "escalate" },
      next: "manager-review",
    },
    "close-ok": { terminal: true, outcome: "success" },
  },
})
```

### Process Observability

A monitoring layer overlays actual execution data onto process definitions:

- Which steps do most instances pass through?
- Where do processes get stuck or loop?
- What is the average duration per step?
- Which branches are taken most frequently?
- How does actual behavior deviate from the defined process?
- Process mining: infer the process from historical events, even without a formal definition

This layer reads from the event store and decision traces. It does not execute anything.

---

## Ontology Layers

The framework has three layers of ontology, each built on the one below.

### Layer 1: Kernel

The framework itself — `defineEntity`, `defineAction`, `defineFunction`, `defineConnector`, `defineReconciler`, `defineWorld`, `defineProcess`. This is the meta-model. It knows about entities, specs, statuses, conditions, actions, events, connectors, reconcilers, processes. It does NOT know about intersections, hosts, customers, or stores. Domain-agnostic.

### Layer 2: Platform

Shared infrastructure entities that exist across all worlds:

- **Identity**: principals, teams, scopes, memberships, identity-links
- **Commerce**: customers, plans, subscriptions, entitlements
- **Collaboration**: channels, threads, documents
- **System**: events, event-subscriptions, decision-traces, workflows, operations
- **Agents**: agents, jobs, memories, tool-credentials

These are defined with `defineEntity()` in a special `platform` world with `shared: true`. All domain worlds can reference platform entities via `platformRef()` — the only allowed cross-world FK mechanism.

```typescript
export const platform = defineWorld({
  id: "platform",
  name: "Platform Infrastructure",
  shared: true,
  namespaces: ["identity", "commerce", "collaboration", "system", "agents"],
  entities: [principal, team, scope, customer, plan, subscription, channel, thread, ...],
})

// In a domain entity:
columns: {
  ownerTeamId: platformRef("team"),      // cross-world FK to platform
  customerId: platformRef("customer"),   // cross-world FK to platform
  zoneId: ref("zone"),                   // same-world FK
},
```

### Layer 3: Domain Worlds

Domain-specific models for each product:

- **Factory World** — systems, components, hosts, sites, deployments, repos (static entities)
- **Trafficure World** — intersections, corridors, signal-controllers, detectors (static entities)
- **SmartMarket World** — workspaces, datasets, connectors, pipelines (static platform entities) + customer-defined stores, territories, products (dynamic entities)

Domain worlds reference platform entities but never each other. Cross-domain awareness happens through events.

---

## Traits

Traits are reusable behaviors that entities opt into. A trait adds columns, status fields, capabilities, or lifecycle behavior.

### Built-In Traits

| Trait                  | Adds                                                                                                                                                                                    | Purpose                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `owned`                | `ownerTeamId` FK column. Scopes LIST queries by team when principal has limited scope.                                                                                                  | Multi-tenant ownership.                                          |
| `reconciled`           | Requires `status` schema on entity. Adds `generation`, `observedGeneration` columns. Adds `conditions` array to status. Enables reconciler targeting and spec/status write enforcement. | Spec/status convergence with multi-dimensional health.           |
| `finalizable`          | Adds `finalizers` array and `deletionRequestedAt` column. DELETE becomes two-phase: mark then clean then remove.                                                                        | Cooperative deletion for entities with external resources.       |
| `child-of(parentKind)` | Adds `ownerRef` column pointing to parent kind. Enables cascading delete and orphan handling.                                                                                           | Parent-child lifecycle management.                               |
| `bitemporal`           | `validFrom`, `validTo`, `systemFrom`, `systemTo`, `changedBy`, `changeReason` columns. Switches delete to soft-delete. Adds `currentRow()` filter to LIST.                              | Temporal versioning, audit trail.                                |
| `locatable`            | Validates that `spec` includes `latitude` and `longitude` fields. Adds GiST index for geo queries. Enables `near(lat, lng, radiusKm)` filter in object sets.                            | Geospatial entities.                                             |
| `metered`              | Adds metric collection hooks. Reconciler reports utilization to observability.                                                                                                          | Capacity planning, dashboards.                                   |
| `observable`           | Requires at least one connector with `observe` capability. Framework periodically calls observe and updates status conditions.                                                          | External health monitoring.                                      |
| `watchable`            | Enables `?watch=true` change stream on LIST endpoint. Adds change log tracking for the watch window.                                                                                    | Real-time subscriptions for UI, agents, and cross-world bridges. |
| `sluggable`            | Always on. Every entity has a `slug` column with a unique index.                                                                                                                        | Human-readable identity. This is not optional.                   |

Traits compose. A signal controller is typically `["reconciled", "finalizable", "observable", "watchable", "child-of(intersection)"]`. Each trait adds its columns and behaviors independently.

### Custom Traits

Worlds can define domain-specific traits:

```typescript
// worlds/trafficure/traits/signalized.ts

import { defineTrait } from "@lepton/ontology"

export const signalized = defineTrait({
  name: "signalized",

  // Require these fields in spec
  specRequirements: z.object({
    signalType: z.enum(["fixed-time", "actuated", "adaptive"]),
    phaseCount: z.number().int(),
  }),

  // Add these columns
  columns: {
    signalControllerId: ref("signal-controller").optional(),
  },

  // Add these relationships
  relationships: [
    {
      name: "controller",
      target: "signal-controller",
      foreignKey: "signalControllerId",
    },
  ],
})
```

---

## Directory Structure

This is prescribed. Do not invent your own.

```
packages/
  ontology/                          # @lepton/ontology — types, defineX functions, IR
    src/
      define/                        # defineEntity, defineAction, defineConnector, ...
      ir/                           # JSON Schema + ontology extensions generation
      traits/                       # Built-in trait definitions
      types/                        # Core type definitions
      index.ts                      # Public API

  ontology-runtime/                  # @lepton/ontology-runtime — Effect services
    src/
      services/
        EntityStore.ts
        ActionExecutor.ts
        EventStore.ts
        DecisionTrace.ts
        PolicyEngine.ts
        ObjectSet.ts
        ConnectorRegistry.ts
        ReconcilerEngine.ts
        WorkerManager.ts
        Transaction.ts
      layers/
        RuntimeLayer.ts             # Composes all services
        TestLayer.ts                # Fakes for testing

  ontology-postgres/                 # @lepton/ontology-postgres — Drizzle adapter
    src/
      table-generator.ts            # EntityDefinition → Drizzle table
      schema-generator.ts           # EntityDefinition → Zod schemas
      migration-planner.ts          # Diff definitions vs actual DB
      query-compiler.ts             # ObjectSet → SQL

  ontology-http/                     # @lepton/ontology-http — Elysia route generation
    src/
      route-generator.ts            # World → Elysia routes
      openapi-generator.ts          # World → OpenAPI spec
      action-endpoint.ts            # Action → POST handler with mode

  ontology-cli/                      # @lepton/ontology-cli — CLI metadata generation
    src/
      entity-registry-generator.ts  # World → CLI entity explorer metadata
      command-generator.ts          # World → CLI commands

worlds/                              # World definitions
  factory/                           # Software Factory world
    index.ts                         # defineWorld() — the only export
    entities/                        # One file per entity
      host.ts
      estate.ts
      site.ts
      system.ts
      component.ts
      ...
    actions/                         # One file per action (or co-located in entity)
      deploy-system.ts
      provision-workbench.ts
      ...
    connectors/                      # One file per connector kind
      github.ts
      kubernetes.ts
      proxmox.ts
      jira.ts
      slack.ts
      ...
    reconcilers/                     # One file per reconciler
      deployment.ts
      route.ts
      workbench.ts
      ...
    reactions/                       # One file per entity lifecycle reaction
      host-ip-assignment.ts
      ...

  trafficure/                        # Trafficure world (same structure)
    index.ts
    entities/
    actions/
    connectors/
    reconcilers/
    reactions/

  smartmarket/                       # SmartMarket world (same structure)
    index.ts
    entities/
    actions/
    connectors/
    reconcilers/
    reactions/
```

### Naming Conventions

| Thing      | File Name                  | Export Name            | Kind/Name String           |
| ---------- | -------------------------- | ---------------------- | -------------------------- |
| Entity     | `signal-controller.ts`     | `signalController`     | `"signal-controller"`      |
| Action     | `update-timing-plan.ts`    | `updateTimingPlan`     | `"update-timing-plan"`     |
| Connector  | `signal-controller-api.ts` | `signalControllerApi`  | `"signal-controller-api"`  |
| Reconciler | `timing-plan.ts`           | `timingPlanReconciler` | `"timing-plan-reconciler"` |
| World      | `trafficure/index.ts`      | `trafficure`           | `"trafficure"`             |

- File names: kebab-case, match the kind/name string.
- Export names: camelCase.
- Kind/name strings: kebab-case, used in URLs, Postgres, CLI, and API responses.

---

## What Gets Generated

You write world definitions. The framework generates everything below.

### Per Entity

```
defineEntity("intersection", { ... })

  generates:

    Postgres table:     trafficure_network.intersection
    Drizzle export:     intersectionTable
    Zod full schema:    IntersectionSchema
    Zod create schema:  CreateIntersectionSchema
    Zod update schema:  UpdateIntersectionSchema
    Route config:       OntologyRouteConfig for ontologyRoutes()
    Registry entry:     ONTOLOGY_REGISTRY.get("intersection")
    Inventory arm:      z.literal("intersection") in InventoryEntitySchema
    CLI metadata:       { module: "network", entity: "intersections", label: "Intersections", prefix: "intx" }
    OpenAPI schemas:    #/components/schemas/Intersection, CreateIntersection, UpdateIntersection
    API routes:
      GET    /api/v1/trafficure/network/intersections                          (list, filterable, paginated)
      GET    /api/v1/trafficure/network/intersections?watch=true&rv=N          (watch stream)
      GET    /api/v1/trafficure/network/intersections/:slugOrId                (get with resourceVersion)
      POST   /api/v1/trafficure/network/intersections                          (create, returns resourceVersion)
      POST   /api/v1/trafficure/network/intersections/:slugOrId/update         (update, requires resourceVersion)
      POST   /api/v1/trafficure/network/intersections/:slugOrId/status         (status subresource, reconciler-only)
      POST   /api/v1/trafficure/network/intersections/:slugOrId/delete         (finalizer-gated or hard delete)
      GET    /api/v1/trafficure/network/intersections/:slugOrId/signals        (relation)
      GET    /api/v1/trafficure/network/intersections/:slugOrId/detectors      (relation)
      GET    /api/v1/trafficure/network/intersections/:slugOrId/incidents      (relation)
    Agent tools:
      trafficure.intersection.list(filters)
      trafficure.intersection.get(slugOrId)
      trafficure.intersection.create(input)
      trafficure.intersection.update(slugOrId, input)
      trafficure.intersection.delete(slugOrId)
```

### Per Action

```
defineAction("update-timing-plan", { target: "signal-controller", ... })

  generates:

    API route:          POST /api/v1/trafficure/signals/signal-controllers/:slugOrId/update-timing-plan
    Request body:       { mode: "validate" | "plan" | "execute", input: { ... } }
    Response:
      validate mode:    { valid: boolean, errors?: [...] }
      plan mode:        { edits: [...], events: [...], connectorCalls: [...] }
      execute mode:     { result: { ... }, trace?: DecisionTraceRef }
    OpenAPI operation:  POST with request/response schemas
    Agent tool:         trafficure.signal-controller.update-timing-plan(slugOrId, input, mode)
```

### Per Connector

```
defineConnector("signal-controller-api", { ... })

  generates:

    Connection entity:  Stored in secret backend with encrypted config
    Health endpoint:    GET /api/v1/trafficure/connectors/signal-controller-api/health
    Status:             Derived from observe capability success/failure
    Retry policy:       Configurable, applied by framework
    Circuit breaker:    Automatic, based on failure rate
```

### Per World

```
defineWorld("trafficure", { ... })

  generates:

    Postgres schemas:   trafficure_network, trafficure_signals, trafficure_incidents, trafficure_analytics
    Elysia sub-app:     Mounted at /api/v1/trafficure/
    OpenAPI spec:       /api/v1/trafficure/openapi.json
    Introspection API:  GET /api/v1/trafficure/introspection (entity kinds, actions, relationships, connectors)
    CLI entity group:   dx explore trafficure
    Inventory scope:    dx inventory apply --world trafficure
    Event namespace:    trafficure.* event topics
```

---

## The Runtime Contract

When the application starts, the framework:

1. **Loads all registered worlds** from the worlds registry.
2. **Validates every definition:**
   - Entity kinds are unique across all worlds.
   - Entity prefixes are unique across all worlds.
   - Every relationship target references an existing entity in the same world.
   - Every action target references an existing entity in the same world.
   - Every action connector reference exists in the same world.
   - Every reconciler target and connector exist in the same world.
   - Every entity with trait `reconciled` has a `status` schema.
   - Every entity with trait `locatable` has `latitude` and `longitude` in spec.
   - Namespaces are valid identifiers.
   - No circular dependencies in entity relationships.
3. **Generates Drizzle tables** (or validates existing ones match).
4. **Generates Zod schemas** for create/update/full per entity.
5. **Mounts Elysia routes** per world, per namespace, per entity.
6. **Starts reconcilers** as supervised workers.
7. **Registers entity kinds** in the central registry.
8. **Exposes introspection** per world.

If any validation fails, the application **does not start**. Fail loud, fail fast.

### Request Pipeline

Every API request follows this pipeline:

```
Request received
  │
  ├─ Parse auth token → resolve principal → resolve tenant
  ├─ Route to world → namespace → entity → operation
  │
  ├─ LIST:     compile filters + label selectors → tenant-scoped query → paginate → return
  ├─ LIST+watch: same filters → stream changes from resourceVersion → hold connection
  ├─ GET:      resolve by slug or ID → return with resourceVersion or 404
  │
  ├─ CREATE:   validate body → check trait requirements
  │              → assign id/slug/resourceVersion/generation → set initial lifecycle phase
  │              → insert → run reactions → emit event → return
  │
  ├─ UPDATE:   validate body → check resourceVersion (409 if stale)
  │              → bump resourceVersion, bump generation (if spec changed)
  │              → merge spec → update → run reactions → emit event → return
  │
  ├─ STATUS:   validate body → check resourceVersion → write status + conditions
  │              → bump resourceVersion (generation unchanged)
  │              → return (reconcilers use this, never users)
  │
  ├─ DELETE:   if finalizers exist:
  │              → set deletionRequestedAt, bump resourceVersion
  │              → return entity as "terminating" (reconcilers will clean up)
  │            if no finalizers:
  │              → hard delete (or bitemporal soft delete) → emit event → return
  │
  ├─ RELATION: resolve entity → join query → paginate → return
  │
  └─ ACTION:
       │
       ├─ validate mode:  parse input → check permissions → check lifecycle allowedStates → return validity
       ├─ plan mode:      begin tx → run handler (connectors intercepted) → rollback → return plan
       └─ execute mode:   begin tx → run handler → apply lifecycle transitionsTo
       │                    → commit → emit events + lifecycle event → record trace → return result
```

You do not implement this pipeline. You provide the entity definition and action handler. The framework does the rest.

### Pre-Save Validation

Before any entity mutation is persisted:

1. **Zod schema validation** checks the spec/input shape.
2. **Trait requirements** are enforced (e.g., `locatable` requires `latitude`/`longitude` in spec).
3. **Lifecycle constraints** are checked (if the entity has a lifecycle and the action declares `allowedStates`).
4. **Action preconditions** are evaluated (custom boolean checks in the action definition).

Cross-cutting policy enforcement (e.g., "all network entities must have a region label") is handled via trait requirements and Zod schema refinements, not a separate admission primitive. If cross-cutting policies become a concrete need that cannot be handled by existing mechanisms, a formal admission chain can be added later.

### Event Contract

Every entity mutation emits an event:

```
Topic:   {worldId}.{entityKind}.{operation}
Source:  "api" | "reconciler" | "reaction" | "inventory"

Examples:
  trafficure.intersection.created
  trafficure.signal-controller.updated
  trafficure.signal-controller.action.update-timing-plan
  factory.host.deleted
  factory.component-deployment.action.deploy
```

Events are written to the event store + outbox atomically with the entity mutation. NATS delivery is async and retried by the outbox relay.

### Decision Trace Contract

Every action with `material: true` produces a decision trace:

```typescript
{
  id: "dtrc_a1b2c3",
  worldId: "trafficure",
  entityKind: "signal-controller",
  entityId: "sig_x9y8z7",
  actionName: "update-timing-plan",

  actor: { kind: "principal", id: "prin_abc123" },
  mode: "execute",

  input: { planId: "plan-peak-hours", phases: [...], cycleLength: 90 },
  output: { previousPlanId: "plan-default", applied: true },

  edits: [
    { path: "spec.currentTimingPlanId", from: "plan-default", to: "plan-peak-hours" }
  ],

  events: [
    { topic: "trafficure.signal-controller.action.update-timing-plan" }
  ],

  connectorCalls: [
    { connector: "signal-controller-api", capability: "push-plan", input: {...}, output: {...} }
  ],

  policyEvaluations: [
    { policy: "traffic:signals:write", result: "allowed", principal: "prin_abc123" }
  ],

  createdAt: "2026-04-16T14:30:00Z",
}
```

You do not construct this. The framework captures it from the action execution context.

---

## Error Handling

Actions return typed Effect errors. The framework maps them to HTTP responses.

### Built-In Errors

| Error                  | HTTP | When                                               |
| ---------------------- | ---- | -------------------------------------------------- |
| `EntityNotFound`       | 404  | Slug or ID does not resolve.                       |
| `EntityAlreadyExists`  | 409  | Create with duplicate slug.                        |
| `ValidationError`      | 422  | Input fails Zod parsing.                           |
| `PermissionDenied`     | 403  | Principal lacks required permission.               |
| `PolicyViolation`      | 403  | Policy evaluation rejected the action.             |
| `ConnectorError`       | 502  | External system returned an error.                 |
| `ConnectorTimeout`     | 504  | External system did not respond in time.           |
| `ConnectorUnavailable` | 503  | Circuit breaker is open.                           |
| `ConcurrencyConflict`  | 409  | Entity generation changed during action execution. |
| `ActionError`          | 400  | Action handler returned a domain-specific error.   |

### Domain Errors

Actions define their own typed errors:

```typescript
export const updateTimingPlan = defineAction({
  // ...
  errors: {
    InvalidPhaseConfig: z.object({
      message: z.string(),
      phase: z.string(),
      reason: z.enum(["overlap", "too-short", "missing-pedestrian"]),
    }),
    ControllerInEmergencyMode: z.object({
      message: z.string(),
      currentMode: z.string(),
    }),
  },

  handler: ({ entity, input, apply, connector, fail }) =>
    Effect.gen(function* () {
      if (entity.status?.mode === "emergency") {
        return yield* fail("ControllerInEmergencyMode", {
          message:
            "Cannot update timing plan while controller is in emergency mode",
          currentMode: "emergency",
        })
      }
      // ...
    }),
})
```

The framework maps `fail("ControllerInEmergencyMode", {...})` to an HTTP 400 with a structured error body:

```json
{
  "error": "ControllerInEmergencyMode",
  "message": "Cannot update timing plan while controller is in emergency mode",
  "details": { "currentMode": "emergency" }
}
```

**No thrown exceptions. No string error messages. No HTTP status code selection in handlers.**

---

## Testing

The framework provides a test harness. You test your definitions against the kernel with fake services.

### Entity Tests

```typescript
// worlds/trafficure/entities/__tests__/intersection.test.ts

import { testWorld } from "@lepton/ontology-runtime/test"
import { trafficure } from "../../index"

const world = testWorld(trafficure)

test("create intersection", async () => {
  const result = await world.entity("intersection").create({
    slug: "mg-road-junction",
    name: "MG Road Junction",
    spec: {
      latitude: 18.5204,
      longitude: 73.8567,
      signalType: "adaptive",
      phaseCount: 4,
    },
  })

  expect(result.id).toMatch(/^intx_/)
  expect(result.slug).toBe("mg-road-junction")
  expect(result.spec.signalType).toBe("adaptive")
})

test("list intersections by zone", async () => {
  const zone = await world.entity("zone").create({
    slug: "pune-central",
    name: "Pune Central",
    spec: {},
  })

  await world.entity("intersection").create({
    slug: "fc-road",
    name: "FC Road Intersection",
    spec: { latitude: 18.52, longitude: 73.85 },
    zoneId: zone.id,
  })

  const results = await world.entity("intersection").list({
    filter: { zoneId: zone.id },
  })

  expect(results.data).toHaveLength(1)
})
```

### Action Tests

```typescript
// worlds/trafficure/actions/__tests__/update-timing-plan.test.ts

import { testWorld } from "@lepton/ontology-runtime/test"
import { trafficure } from "../../index"

const world = testWorld(trafficure)

test("plan mode returns edits without committing", async () => {
  const controller = await world.entity("signal-controller").create({
    slug: "sig-mg-road",
    name: "MG Road Controller",
    spec: { externalId: "ctrl-001", currentTimingPlanId: "plan-default" },
  })

  const plan = await world.action("update-timing-plan").plan(controller.slug, {
    planId: "plan-peak",
    phases: [{ id: "p1", green: 30, amber: 3, red: 27, pedestrian: true }],
    cycleLength: 60,
  })

  // Plan shows what would change
  expect(plan.edits).toContainEqual(
    expect.objectContaining({
      path: "spec.currentTimingPlanId",
      from: "plan-default",
      to: "plan-peak",
    })
  )

  // But entity is unchanged
  const unchanged = await world.entity("signal-controller").get(controller.slug)
  expect(unchanged.spec.currentTimingPlanId).toBe("plan-default")
})

test("execute mode commits and calls connector", async () => {
  const controller = await world.entity("signal-controller").create({
    slug: "sig-fc-road",
    name: "FC Road Controller",
    spec: { externalId: "ctrl-002", currentTimingPlanId: "plan-default" },
  })

  const result = await world
    .action("update-timing-plan")
    .execute(controller.slug, {
      planId: "plan-peak",
      phases: [{ id: "p1", green: 30, amber: 3, red: 27, pedestrian: true }],
      cycleLength: 60,
    })

  expect(result.applied).toBe(true)
  expect(result.previousPlanId).toBe("plan-default")

  // Entity is updated
  const updated = await world.entity("signal-controller").get(controller.slug)
  expect(updated.spec.currentTimingPlanId).toBe("plan-peak")

  // Connector was called
  expect(
    world.connector("signal-controller-api").calls("push-plan")
  ).toHaveLength(1)

  // Event was emitted
  expect(world.events()).toContainEqual(
    expect.objectContaining({
      topic: "trafficure.signal-controller.action.update-timing-plan",
    })
  )
})
```

### Reconciler Tests

```typescript
// worlds/trafficure/reconcilers/__tests__/timing-plan.test.ts

import { testWorld } from "@lepton/ontology-runtime/test"
import { trafficure } from "../../index"

const world = testWorld(trafficure)

test("reconciler detects drift and converges", async () => {
  const controller = await world.entity("signal-controller").create({
    slug: "sig-test",
    name: "Test Controller",
    spec: { externalId: "ctrl-test", currentTimingPlanId: "plan-b" },
  })

  // Simulate external state: controller is running plan-a, not plan-b
  world.connector("signal-controller-api").stub("read-state", () => ({
    activePlan: "plan-a",
    currentPhase: "green-ns",
    mode: "normal",
    faults: [],
    uptimeSeconds: 3600,
  }))

  // Run one reconciliation cycle
  await world.reconciler("timing-plan-reconciler").runOnce()

  // Connector should have been called to push the correct plan
  const pushCalls = world.connector("signal-controller-api").calls("push-plan")
  expect(pushCalls).toHaveLength(1)
  expect(pushCalls[0].input.controllerId).toBe("ctrl-test")
})
```

### Test Harness Rules

1. **`testWorld()` creates an isolated in-memory or test-database world.** No shared state between tests.
2. **Connectors are automatically stubbed.** `observe` capabilities return empty/default responses. `act` capabilities record calls without side effects. Override with `.stub()`.
3. **Events are captured.** Use `world.events()` to assert event emission.
4. **Decision traces are captured.** Use `world.traces()` to assert trace content.
5. **No mocking framework needed.** The test harness provides fakes for every kernel service.

---

## Cross-World Communication

Worlds are isolated. They do not share database schemas, entity kinds, or foreign keys. Cross-world communication happens through:

### Events

A reaction in one world can listen to events from another world:

```typescript
// worlds/factory/reactions/trafficure-deploy-on-release.ts

import { defineReaction } from "@lepton/ontology"

export const trafficureDeployOnRelease = defineReaction({
  name: "trafficure-deploy-on-release",
  trigger: { world: "factory", entity: "release", event: "created" },
  filter: (event) => event.data.systemSlug === "trafficure",

  handler: ({ event }) =>
    Effect.gen(function* () {
      // Trigger deployment action in factory world
      yield* ActionExecutor.execute(
        "factory",
        "deploy-system",
        event.data.systemDeploymentSlug,
        {
          releaseSlug: event.data.slug,
        }
      )
    }),
})
```

### Shared Org Layer

Identity (principals, teams, scopes) and commerce (customers, subscriptions) are shared infrastructure, not world-specific. They live in a `platform` world or are provided by the kernel directly.

---

## Tenant Isolation

Each world supports multiple tenant instances. A tenant is a customer's isolated view of a world.

### Isolation Modes

| Mode        | Storage                             | Routing                 | Use Case             |
| ----------- | ----------------------------------- | ----------------------- | -------------------- |
| `shared`    | Same tables, tenant ID column, RLS  | Same API, auth-scoped   | SaaS multi-tenant    |
| `dedicated` | Separate Postgres schema per tenant | Same API, schema-routed | Enterprise customers |
| `siloed`    | Separate database per tenant        | Separate API deployment | Regulated / on-prem  |

For `shared` mode (the default), the framework:

1. Adds a `tenantId` column to every entity table in the world.
2. Injects `WHERE tenantId = :currentTenantId` into every query.
3. Sets `tenantId` automatically on every insert.
4. The current tenant is resolved from the principal's scope.

You do not implement tenant filtering. The framework does it.

---

## Migration From Current Code

The existing Factory API codebase migrates to this framework incrementally:

### Phase 1: Extract Definitions

For each existing entity (host, estate, site, etc.), create a `defineEntity()` file in `worlds/factory/entities/`. The framework validates that the generated table shape matches the existing Drizzle table. No database migration needed.

### Phase 2: Replace Route Configs

Replace manual `ontologyRoutes()` calls in controllers with framework-generated routes from world definitions. The generated routes are identical in behavior.

### Phase 3: Replace Registry

Delete `ontology-registry.ts` and the hardcoded CLI entity registry. Replace with framework-generated registries from world definitions.

### Phase 4: Extract Actions

Move action handlers from inline `actions:` configs in `OntologyRouteConfig` to `defineAction()` files. Add `validate`/`plan`/`execute` lifecycle.

### Phase 5: Extract Connectors

Move adapter implementations to `defineConnector()` files. Replace `adapter-registry.ts` with framework-managed connector registry.

### Phase 6: Extract Reconcilers

Move reconciler logic to `defineReconciler()` files. Replace `createOperationRunner()` calls with framework-managed reconcilers.

At no point does the system stop working. Each phase is backward-compatible. Old and new patterns coexist during migration.

---

## What You Do Not Get To Choose

This list is explicit so there is no ambiguity.

- **You do not choose how entities are stored.** Static entities get typed tables. Freeform entities get the generic table. Mapped entities query the lakehouse. The framework decides.
- **You do not choose the API shape.** The framework generates the routes — same shape for static and dynamic entities.
- **You do not choose how events are emitted.** The framework handles the outbox.
- **You do not choose how actions are transacted.** The framework wraps them.
- **You do not choose how lifecycle transitions are enforced.** The framework checks `allowedStates` and applies `transitionsTo`.
- **You do not choose how decision traces are captured.** The framework records them.
- **You do not choose how permissions are checked.** The framework evaluates them.
- **You do not choose how connectors behave in plan mode.** The framework intercepts them.
- **You do not choose how reconcilers are scheduled.** The framework runs them.
- **You do not choose how errors become HTTP responses.** The framework maps them.
- **You do not choose the file structure.** The convention is prescribed.
- **You do not choose entity identity format.** Prefixed IDs + slugs. Always.
- **You do not choose the query API shape.** ObjectSet works the same on static, mapped, and freeform entities.

What you choose:

- **What entities exist** — their spec/status shapes, lifecycle states, and relationships.
- **What actions are possible** — what business logic they contain and which lifecycle states they apply to.
- **What functions compute** — derived values over entity properties.
- **What external systems** are connected and how to talk to them.
- **What drift looks like** and how to converge it.
- **What events trigger** what reactions.
- **What processes orchestrate** — cross-entity workflows, their steps, branches, and conditions.
- **Whether entity kinds are static or dynamic** — code-defined or runtime-registered.

That is the boundary. Define the domain. The framework does the plumbing.
