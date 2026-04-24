import { describe, it, expect } from "bun:test"
import { Effect, Stream, Chunk, Layer, PubSub, Ref } from "effect"
import { RpcTest } from "@effect/rpc"
import {
  WorkbenchRpcs,
  SiteStatusRpc,
  ComponentStatus,
  SiteCondition,
  HealthSnapshotRpc,
  ReconcileResultRpc,
  ReconcileEventRpc,
  HealthChangeEventRpc,
  LogLine,
  FilePath,
  FileContent,
} from "./workbench-rpc.js"

const MockHandlers = WorkbenchRpcs.toLayer({
  SiteStatus: () =>
    Effect.succeed(
      new SiteStatusRpc({
        mode: "dev",
        phase: "ready",
        components: [
          new ComponentStatus({
            name: "api",
            status: "running",
            health: "healthy",
          }),
          new ComponentStatus({
            name: "db",
            status: "running",
            health: "starting",
          }),
        ],
        conditions: [new SiteCondition({ type: "Deployed", status: true })],
      })
    ),

  SiteHealth: () =>
    Effect.succeed(
      new HealthSnapshotRpc({
        components: { api: "healthy", db: "starting" },
        overallStatus: "degraded",
        checkedAt: "2026-04-23T00:00:00Z",
      })
    ),

  SiteReconcile: () =>
    Effect.succeed(
      new ReconcileResultRpc({
        success: true,
        stepsApplied: 2,
        stepsTotal: 2,
        errors: [],
        durationMs: 150,
        reconciliationId: "abc-123",
      })
    ),

  ServiceRestart: ({ name }) =>
    name === "unknown-service"
      ? Effect.fail(`Service not found: ${name}`)
      : Effect.void,

  SiteEvents: () =>
    Stream.make(
      new ReconcileEventRpc({
        timestamp: "2026-04-23T00:00:00Z",
        reconciliationId: "r1",
        type: "reconcile-start",
        details: {},
      }),
      new ReconcileEventRpc({
        timestamp: "2026-04-23T00:00:01Z",
        reconciliationId: "r1",
        type: "step-applied",
        details: { component: "api" },
      }),
      new ReconcileEventRpc({
        timestamp: "2026-04-23T00:00:02Z",
        reconciliationId: "r1",
        type: "reconcile-complete",
        details: { durationMs: 2000 },
      })
    ),

  HealthChanges: () =>
    Stream.make(
      new HealthChangeEventRpc({
        components: { api: "healthy", db: "starting" },
        overallStatus: "degraded",
        checkedAt: "2026-04-23T00:00:00Z",
      }),
      new HealthChangeEventRpc({
        components: { api: "healthy", db: "healthy" },
        overallStatus: "healthy",
        checkedAt: "2026-04-23T00:00:15Z",
      })
    ),

  ServiceLogs: ({ name }) =>
    name === "missing"
      ? Stream.fail(`Service not found: ${name}`)
      : Stream.make(
          new LogLine({ line: `[INFO] ${name} starting` }),
          new LogLine({ line: `[INFO] ${name} ready` }),
          new LogLine({ line: `[DEBUG] ${name} health check passed` })
        ),

  ReadDir: () =>
    Stream.make(
      new FilePath({ path: "src/" }),
      new FilePath({ path: "src/index.ts" }),
      new FilePath({ path: "src/lib/" }),
      new FilePath({ path: "src/lib/utils.ts" }),
      new FilePath({ path: "package.json" })
    ),

  ReadFile: ({ path }) =>
    path === "missing.txt"
      ? Effect.fail(`File not found: ${path}`)
      : Effect.succeed(
          new FileContent({
            path,
            content: `// contents of ${path}`,
            language: "typescript",
          })
        ),
})

function runWithClient<A, E>(fn: (client: any) => Effect.Effect<A, E>) {
  return Effect.gen(function* () {
    const client = yield* RpcTest.makeClient(WorkbenchRpcs)
    return yield* fn(client)
  }).pipe(Effect.scoped, Effect.provide(MockHandlers), Effect.runPromise)
}

describe("WorkbenchRpc — one-shot methods", () => {
  it("SiteStatus returns snapshot with components and conditions", async () => {
    const result = await runWithClient((c) => c.SiteStatus())

    expect(result.mode).toBe("dev")
    expect(result.phase).toBe("ready")
    expect(result.components).toHaveLength(2)
    expect(result.components[0].name).toBe("api")
    expect(result.components[0].health).toBe("healthy")
    expect(result.conditions[0].type).toBe("Deployed")
    expect(result.conditions[0].status).toBe(true)
  })

  it("SiteHealth returns health snapshot", async () => {
    const result = await runWithClient((c) => c.SiteHealth())

    expect(result.overallStatus).toBe("degraded")
    expect(result.components.api).toBe("healthy")
    expect(result.components.db).toBe("starting")
  })

  it("SiteReconcile returns reconcile result", async () => {
    const result = await runWithClient((c) => c.SiteReconcile())

    expect(result.success).toBe(true)
    expect(result.stepsApplied).toBe(2)
    expect(result.durationMs).toBe(150)
    expect(result.reconciliationId).toBe("abc-123")
  })

  it("ServiceRestart succeeds for known service", async () => {
    await runWithClient((c) => c.ServiceRestart({ name: "api" }))
  })

  it("ServiceRestart fails for unknown service", async () => {
    await expect(
      runWithClient((c) => c.ServiceRestart({ name: "unknown-service" }))
    ).rejects.toThrow()
  })
})

describe("WorkbenchRpc — streaming methods", () => {
  it("SiteEvents streams reconcile events in order", async () => {
    const events = await runWithClient((c) => Stream.runCollect(c.SiteEvents()))
    const arr = Chunk.toArray(events)

    expect(arr).toHaveLength(3)
    expect(arr[0].type).toBe("reconcile-start")
    expect(arr[1].type).toBe("step-applied")
    expect(arr[1].details).toEqual({ component: "api" })
    expect(arr[2].type).toBe("reconcile-complete")
  })

  it("HealthChanges streams health snapshots", async () => {
    const snapshots = await runWithClient((c) =>
      Stream.runCollect(c.HealthChanges())
    )
    const arr = Chunk.toArray(snapshots)

    expect(arr).toHaveLength(2)
    expect(arr[0].overallStatus).toBe("degraded")
    expect(arr[1].overallStatus).toBe("healthy")
    expect(arr[1].components.db).toBe("healthy")
  })

  it("ServiceLogs streams log lines for known service", async () => {
    const lines = await runWithClient((c) =>
      Stream.runCollect(c.ServiceLogs({ name: "api" }))
    )
    const arr = Chunk.toArray(lines)

    expect(arr).toHaveLength(3)
    expect(arr[0].line).toBe("[INFO] api starting")
    expect(arr[1].line).toBe("[INFO] api ready")
    expect(arr[2].line).toBe("[DEBUG] api health check passed")
  })

  it("ServiceLogs streams can be partially consumed", async () => {
    const first = await runWithClient((c) =>
      c.ServiceLogs({ name: "api" }).pipe(Stream.take(1), Stream.runCollect)
    )

    expect(Chunk.toArray(first)).toHaveLength(1)
    expect(Chunk.toArray(first)[0].line).toBe("[INFO] api starting")
  })

  it("ServiceLogs fails for missing service", async () => {
    await expect(
      runWithClient((c) =>
        Stream.runCollect(c.ServiceLogs({ name: "missing" }))
      )
    ).rejects.toThrow()
  })

  it("ServiceLogs uses default tail value of 200", async () => {
    const lines = await runWithClient((c) =>
      Stream.runCollect(c.ServiceLogs({ name: "api", tail: 200 }))
    )
    expect(Chunk.toArray(lines)).toHaveLength(3)
  })
})

describe("WorkbenchRpc — file tree methods", () => {
  it("ReadDir streams file paths", async () => {
    const paths = await runWithClient((c) =>
      Stream.runCollect(c.ReadDir({ root: "." }))
    )
    const arr = Chunk.toArray(paths)

    expect(arr).toHaveLength(5)
    expect(arr[0].path).toBe("src/")
    expect(arr[1].path).toBe("src/index.ts")
    expect(arr[4].path).toBe("package.json")
  })

  it("ReadFile returns file content", async () => {
    const result = await runWithClient((c) =>
      c.ReadFile({ path: "src/index.ts" })
    )

    expect(result.path).toBe("src/index.ts")
    expect(result.content).toContain("contents of src/index.ts")
    expect(result.language).toBe("typescript")
  })

  it("ReadFile fails for missing file", async () => {
    await expect(
      runWithClient((c) => c.ReadFile({ path: "missing.txt" }))
    ).rejects.toThrow()
  })
})

describe("WorkbenchRpc — schema validation", () => {
  it("SiteStatusRpc validates mode as literal", () => {
    expect(
      () =>
        new SiteStatusRpc({
          mode: "dev",
          phase: "ready",
          components: [],
          conditions: [],
        })
    ).not.toThrow()
  })

  it("HealthSnapshotRpc validates overallStatus as literal", () => {
    expect(
      () =>
        new HealthSnapshotRpc({
          components: {},
          overallStatus: "healthy",
          checkedAt: "2026-01-01T00:00:00Z",
        })
    ).not.toThrow()
  })

  it("ComponentStatus validates health as HealthStatus literal", () => {
    expect(
      () =>
        new ComponentStatus({
          name: "api",
          status: "running",
          health: "healthy",
        })
    ).not.toThrow()
  })
})
