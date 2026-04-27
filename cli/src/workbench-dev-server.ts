#!/usr/bin/env bun
import { Effect, Layer, Stream, PubSub, Ref, Schedule, Duration } from "effect"
import { HttpMiddleware, HttpRouter, HttpServer } from "@effect/platform"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { RpcServer, RpcSerialization } from "@effect/rpc"
import {
  WorkbenchRpcs,
  SiteStatusRpc,
  ComponentStatus,
  SiteCondition,
  HealthSnapshotRpc,
  ReconcileResultRpc,
  ReconcileStepError,
  ReconcileEventRpc,
  HealthChangeEventRpc,
  LogLine,
  FilePath,
  FileContent,
} from "@smp/factory-shared/effect/workbench-rpc"
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs"
import { join, relative, extname, resolve } from "node:path"

const PORT = Number(process.env.WORKBENCH_PORT ?? 4401)
const ROOT = resolve(process.env.WORKBENCH_ROOT ?? process.cwd())

console.log(`Workbench dev server`)
console.log(`  Root: ${ROOT}`)
console.log(`  Port: ${PORT}`)

const IGNORE = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  ".output",
  ".cache",
  ".pnpm",
  ".DS_Store",
  "__pycache__",
  ".venv",
  ".bun",
])

function walkDir(dir: string, baseDir: string, max = 5000): string[] {
  const paths: string[] = []
  function walk(current: string) {
    if (paths.length >= max) return
    let names: string[]
    try {
      names = readdirSync(current) as unknown as string[]
    } catch {
      return
    }
    for (const name of names) {
      if (paths.length >= max) return
      if (IGNORE.has(name)) continue
      const fullPath = join(current, name)
      let isDir = false
      try {
        isDir = statSync(fullPath).isDirectory()
      } catch {
        continue
      }
      const relPath = relative(baseDir, fullPath)
      if (isDir) {
        paths.push(relPath + "/")
        walk(fullPath)
      } else {
        paths.push(relPath)
      }
    }
  }
  walk(dir)
  return paths
}

const LANG_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  md: "markdown",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  css: "css",
  html: "html",
  sql: "sql",
  py: "python",
  rs: "rust",
  go: "go",
  sh: "bash",
}

const DevHandlers = WorkbenchRpcs.toLayer(
  Effect.gen(function* () {
    const eventPubSub = yield* PubSub.unbounded<ReconcileEventRpc>()
    const healthPubSub = yield* PubSub.unbounded<HealthChangeEventRpc>()
    const startTime = new Date().toISOString()

    yield* Effect.gen(function* () {
      yield* PubSub.publish(
        healthPubSub,
        new HealthChangeEventRpc({
          components: { "dev-server": "healthy" },
          overallStatus: "healthy",
          checkedAt: new Date().toISOString(),
        })
      )
    }).pipe(Effect.repeat(Schedule.spaced(Duration.seconds(15))), Effect.fork)

    return {
      SiteStatus: () =>
        Effect.succeed(
          new SiteStatusRpc({
            mode: "dev",
            phase: "ready",
            components: [
              new ComponentStatus({
                name: "workbench-rpc",
                status: "running",
                health: "healthy",
              }),
            ],
            conditions: [
              new SiteCondition({ type: "RpcServer", status: true }),
            ],
          })
        ),

      SiteHealth: () =>
        Effect.succeed(
          new HealthSnapshotRpc({
            components: { "workbench-rpc": "healthy" },
            overallStatus: "healthy",
            checkedAt: new Date().toISOString(),
          })
        ),

      SiteReconcile: () =>
        Effect.gen(function* () {
          const event = new ReconcileEventRpc({
            timestamp: new Date().toISOString(),
            reconciliationId: crypto.randomUUID().slice(0, 8),
            type: "reconcile-complete",
            details: { source: "dev-server", durationMs: 0 },
          })
          yield* PubSub.publish(eventPubSub, event)
          return new ReconcileResultRpc({
            success: true,
            stepsApplied: 0,
            stepsTotal: 0,
            errors: [],
            durationMs: 0,
            reconciliationId: event.reconciliationId,
          })
        }),

      ServiceRestart: ({ name }) =>
        Effect.fail(`Dev server cannot restart services (requested: ${name})`),

      SiteEvents: () =>
        Stream.fromPubSub(eventPubSub).pipe(Stream.map((e) => e)),

      HealthChanges: () =>
        Stream.fromPubSub(healthPubSub).pipe(Stream.map((s) => s)),

      ServiceLogs: ({ name }) =>
        Stream.make(
          new LogLine({
            line: `[workbench-dev] Log stream for "${name}" (dev mode — no real logs)`,
          }),
          new LogLine({ line: `[workbench-dev] Agent started at ${startTime}` })
        ).pipe(
          Stream.concat(
            Stream.fromSchedule(Schedule.spaced(Duration.seconds(5))).pipe(
              Stream.map(
                () =>
                  new LogLine({
                    line: `[workbench-dev] ${name} heartbeat ${new Date().toISOString()}`,
                  })
              )
            )
          ),
          Stream.mapError(() => "stream error")
        ),

      ReadDir: ({ root }) => {
        const baseDir = root === "." ? ROOT : join(ROOT, root)
        const paths = walkDir(baseDir, baseDir)
        return Stream.fromIterable(paths).pipe(
          Stream.map((p) => new FilePath({ path: p })),
          Stream.mapError((e) => `ReadDir failed: ${String(e)}`)
        )
      },

      ReadFile: ({ path: filePath }) =>
        Effect.gen(function* () {
          const fullPath = join(ROOT, filePath)
          if (!existsSync(fullPath)) {
            return yield* Effect.fail(`File not found: ${filePath}`)
          }
          const stat = statSync(fullPath)
          if (stat.size > 1024 * 1024) {
            return yield* Effect.fail(
              `File too large: ${filePath} (${stat.size} bytes)`
            )
          }
          const content = readFileSync(fullPath, "utf-8")
          const ext = extname(filePath).slice(1)
          return new FileContent({
            path: filePath,
            content,
            language: LANG_MAP[ext] ?? "text",
          })
        }).pipe(
          Effect.mapError((e) =>
            typeof e === "string" ? e : `ReadFile failed: ${String(e)}`
          )
        ),
    }
  })
)

const RpcLayer = RpcServer.layer(WorkbenchRpcs).pipe(Layer.provide(DevHandlers))

const HttpProtocol = RpcServer.layerProtocolHttp({ path: "/rpc" }).pipe(
  Layer.provide(RpcSerialization.layerNdjson)
)

const ServerLive = HttpRouter.Default.serve(
  HttpMiddleware.cors({ allowedOrigins: ["*"] })
).pipe(
  Layer.provide(RpcLayer),
  Layer.provide(HttpProtocol),
  HttpServer.withLogAddress,
  Layer.provide(BunHttpServer.layer({ port: PORT }))
)

BunRuntime.runMain(Layer.launch(ServerLive))
