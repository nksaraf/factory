/**
 * Workflow SDK integration tests.
 *
 * Tests the workflow registry, REST endpoints, event matching,
 * and the echo workflow function. The "use workflow" / "use step"
 * directives are no-ops outside the SDK runtime, so the workflow
 * function can be called directly for testing.
 *
 * The Workflow SDK's start() requires a running World (Postgres or local),
 * so we mock it and test our own layers: registry, REST CRUD, DB state,
 * and event matching.
 */
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { Elysia } from "elysia"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test"

import type { Database } from "../db/connection"
import { eventSubscription, workflowRun } from "../db/schema/org"
import {
  getWorkflowDefinition,
  listWorkflowDefinitions,
} from "../lib/workflow-engine"
import { emitEvent, matchAndNotifySubscriptions } from "../lib/workflow-events"
import { setWorkflowDb } from "../lib/workflow-helpers"
import { createMigratedTestPglite, truncateAllTables } from "../test-helpers"

// Mock the workflow SDK's start() so REST /runs doesn't actually
// call into the SDK runtime.
const mockStart = mock(() => Promise.resolve())
mock.module("../lib/workflow-engine.js", () => ({
  ...require("../lib/workflow-engine"),
  start: mockStart,
}))

// Import the workflow controller after mocking
const { workflowController } = await import("../modules/workflow/triggers/rest")

// Force echo-workflow registration by importing it
await import("../modules/workflow/workflows/echo-workflow")

// ── Test setup ──────────────────────────────────────────

let client: PGlite
let db: Database
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any

const BASE = "http://localhost/api/v1/factory"

function post(path: string, body: unknown) {
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function get(path: string) {
  return new Request(`${BASE}${path}`)
}

beforeAll(async () => {
  const ctx = await createMigratedTestPglite()
  client = ctx.client
  db = ctx.db as unknown as Database
  setWorkflowDb(db)

  app = new Elysia({ prefix: "/api/v1/factory" })
    .decorate("db", db)
    .use(workflowController(db))
})

afterAll(async () => {
  await client.close()
})

beforeEach(async () => {
  await truncateAllTables(client)
  mockStart.mockReset()
  mockStart.mockResolvedValue(undefined)
})

// ── Registry ─────────────────────────────────────────────

describe("Workflow Registry", () => {
  it("echo-workflow is registered", () => {
    const def = getWorkflowDefinition("echo-workflow")
    expect(def).toBeDefined()
    expect(def!.name).toBe("echo-workflow")
    expect(def!.triggerTypes).toContain("cli")
  })

  it("listWorkflowDefinitions includes echo-workflow", () => {
    const defs = listWorkflowDefinitions()
    const names = defs.map((d) => d.name)
    expect(names).toContain("echo-workflow")
  })
})

// ── REST API — Definitions ───────────────────────────────

describe("Workflow REST API", () => {
  it("GET /definitions lists registered workflows", async () => {
    const res = await app.handle(get("/workflow/definitions"))
    expect(res.status).toBe(200)
    const body = await res.json()
    const names = body.data.map((d: any) => d.name)
    expect(names).toContain("echo-workflow")
  })

  it("POST /runs creates a workflow run and calls start()", async () => {
    const res = await app.handle(
      post("/workflow/runs", {
        workflowName: "echo-workflow",
        input: { message: "hello from test" },
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.workflowRunId).toMatch(/^wfr_/)

    // Verify DB row was created
    const [row] = await db
      .select()
      .from(workflowRun)
      .where(eq(workflowRun.workflowRunId, body.workflowRunId))
    expect(row).toBeDefined()
    expect(row.workflowName).toBe("echo-workflow")
    expect(row.trigger).toBe("cli")

    // Verify start() was called
    expect(mockStart).toHaveBeenCalledTimes(1)
  })

  it("POST /runs rejects unknown workflow", async () => {
    const res = await app.handle(
      post("/workflow/runs", {
        workflowName: "nonexistent",
        input: {},
      })
    )
    expect(res.status).toBe(404)
  })

  it("POST /runs rejects invalid input", async () => {
    const res = await app.handle(
      post("/workflow/runs", {
        workflowName: "echo-workflow",
        input: { notAMessage: true },
      })
    )
    expect(res.status).toBe(400)
  })

  it("GET /runs lists workflow runs", async () => {
    // Create a run first
    await app.handle(
      post("/workflow/runs", {
        workflowName: "echo-workflow",
        input: { message: "list-test" },
      })
    )

    const res = await app.handle(get("/workflow/runs"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.length).toBeGreaterThanOrEqual(1)
  })

  it("GET /runs/:id returns run details", async () => {
    const createRes = await app.handle(
      post("/workflow/runs", {
        workflowName: "echo-workflow",
        input: { message: "detail-test" },
      })
    )
    const { workflowRunId } = await createRes.json()

    const res = await app.handle(get(`/workflow/runs/${workflowRunId}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.workflowRunId).toBe(workflowRunId)
    expect(body.data.workflowName).toBe("echo-workflow")
  })

  it("POST /runs/:id/cancel cancels a running workflow", async () => {
    const createRes = await app.handle(
      post("/workflow/runs", {
        workflowName: "echo-workflow",
        input: { message: "cancel-test" },
      })
    )
    const { workflowRunId } = await createRes.json()

    const cancelRes = await app.handle(
      post(`/workflow/runs/${workflowRunId}/cancel`, {})
    )
    expect(cancelRes.status).toBe(200)

    // Verify status changed
    const [row] = await db
      .select()
      .from(workflowRun)
      .where(eq(workflowRun.workflowRunId, workflowRunId))
    expect(row.status).toBe("cancelled")
  })
})

// ── Event matching ───────────────────────────────────────

describe("Event Matching (matchAndNotifySubscriptions)", () => {
  const mockFetch = mock(() => Promise.resolve(new Response("ok")))

  beforeEach(() => {
    globalThis.fetch = mockFetch as unknown as typeof fetch
    mockFetch.mockReset()
    mockFetch.mockImplementation(() => Promise.resolve(new Response("ok")))
  })

  afterEach(() => {
    globalThis.fetch = globalThis.fetch // restore
  })

  async function insertSub(opts: {
    id: string
    ownerId: string
    topicFilter: string
    matchFields: Record<string, string>
    minSeverity?: string
    scopeKind?: string
    scopeId?: string
    expiresAt?: Date
  }) {
    await db.insert(eventSubscription).values({
      id: opts.id,
      name: opts.id,
      kind: "trigger",
      status: "active",
      topicFilter: opts.topicFilter,
      matchFields: opts.matchFields,
      ownerKind: "webhook",
      ownerId: opts.ownerId,
      minSeverity: opts.minSeverity,
      scopeKind: opts.scopeKind,
      scopeId: opts.scopeId,
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 600_000),
    })
  }

  it("matches with topic glob patterns", async () => {
    await insertSub({
      id: "esub_glob",
      ownerId: "https://test/webhook/glob",
      topicFilter: "ops.workbench.*",
      matchFields: {},
    })

    await matchAndNotifySubscriptions(db, {
      topic: "ops.workbench.ready",
      data: { workbenchId: "wb-1" },
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("filters by severity", async () => {
    await insertSub({
      id: "esub_sev",
      ownerId: "https://test/webhook/sev",
      topicFilter: "ops.alert",
      matchFields: {},
      minSeverity: "warning",
    })

    // info < warning — should NOT match
    await matchAndNotifySubscriptions(db, {
      topic: "ops.alert",
      data: {},
      severity: "info",
    })
    expect(mockFetch).not.toHaveBeenCalled()

    // critical >= warning — should match
    await matchAndNotifySubscriptions(db, {
      topic: "ops.alert",
      data: {},
      severity: "critical",
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("filters by scope", async () => {
    await insertSub({
      id: "esub_scope",
      ownerId: "https://test/webhook/scope",
      topicFilter: "ops.deploy",
      matchFields: {},
      scopeKind: "team",
      scopeId: "team-alpha",
    })

    // Wrong scope — should NOT match
    await matchAndNotifySubscriptions(db, {
      topic: "ops.deploy",
      data: {},
      scopeKind: "team",
      scopeId: "team-beta",
    })
    expect(mockFetch).not.toHaveBeenCalled()

    // Correct scope — should match
    await matchAndNotifySubscriptions(db, {
      topic: "ops.deploy",
      data: {},
      scopeKind: "team",
      scopeId: "team-alpha",
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("POST /events triggers matching subscriptions", async () => {
    await insertSub({
      id: "esub_rest",
      ownerId: "https://test/webhook/rest",
      topicFilter: "test.ping",
      matchFields: { id: "abc" },
    })

    const res = await app.handle(
      post("/workflow/events", {
        eventName: "test.ping",
        data: { id: "abc", payload: "pong" },
      })
    )
    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(1)

    // Verify subscription marked as fired
    const [sub] = await db
      .select()
      .from(eventSubscription)
      .where(eq(eventSubscription.id, "esub_rest"))
    expect(sub.status).toBe("fired")
  })
})

// ── Echo workflow function (direct call) ─────────────────

describe("Echo Workflow (direct function call)", () => {
  it("returns echo output without event wait", async () => {
    const { echoWorkflow } =
      await import("../modules/workflow/workflows/echo-workflow")

    const result = await echoWorkflow({ message: "hello" } as any)

    expect(result.echo).toBe("hello")
    expect(result.receivedEvent).toBeNull()
    expect(result.timestamp).toBeDefined()
  })

  it("tracks business state via _workflowRunId", async () => {
    // Create a workflow_run row first
    const runId = "wfr_test_echo"
    await db.insert(workflowRun).values({
      workflowRunId: runId,
      workflowName: "echo-workflow",
      trigger: "manual",
      input: { message: "tracked" },
      config: {},
    })

    const { echoWorkflow } =
      await import("../modules/workflow/workflows/echo-workflow")

    const result = await echoWorkflow({
      message: "tracked",
      _workflowRunId: runId,
    } as any)

    expect(result.echo).toBe("tracked")

    // Verify the run row was updated
    const [row] = await db
      .select()
      .from(workflowRun)
      .where(eq(workflowRun.workflowRunId, runId))

    expect(row.status).toBe("succeeded")
    expect(row.phase).toBe("completed")
    expect(row.output).toEqual(result)
  })
})
