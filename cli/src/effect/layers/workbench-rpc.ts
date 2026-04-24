import { Effect, Layer, Stream } from "effect"
import { HttpRouter, HttpServer } from "@effect/platform"
import { BunHttpServer } from "@effect/platform-bun"
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
import { join, relative, extname } from "node:path"
import { SiteState } from "../services/site-state.js"
import { SiteConfig } from "../services/site-config.js"
import { HealthMonitor } from "../services/health-monitor.js"
import { SiteReconciler } from "../services/site-reconciler.js"
import { Executor } from "../services/executor.js"

const WorkbenchHandlers = WorkbenchRpcs.toLayer(
  Effect.gen(function* () {
    const siteState = yield* SiteState
    const siteConfig = yield* SiteConfig
    const healthMonitor = yield* HealthMonitor
    const reconciler = yield* SiteReconciler
    const executor = yield* Executor

    return {
      SiteStatus: () =>
        Effect.gen(function* () {
          const status = yield* siteState.getStatus
          const components = yield* executor.inspect.pipe(
            Effect.map((states) =>
              states.map(
                (s) =>
                  new ComponentStatus({
                    name: s.name,
                    status: s.status,
                    health: s.health,
                  })
              )
            ),
            Effect.orElseSucceed(() => [] as ComponentStatus[])
          )

          return new SiteStatusRpc({
            mode: siteConfig.mode,
            phase: status.phase,
            components,
            conditions: status.conditions.map(
              (c) =>
                new SiteCondition({
                  type: c.type,
                  status: c.status === "True",
                })
            ),
          })
        }),

      SiteHealth: () =>
        Effect.gen(function* () {
          const snapshot = yield* healthMonitor.latest
          if (!snapshot) {
            return new HealthSnapshotRpc({
              components: {},
              overallStatus: "healthy",
              checkedAt: new Date().toISOString(),
            })
          }
          return new HealthSnapshotRpc({
            components: snapshot.components,
            overallStatus: snapshot.overallStatus,
            checkedAt: snapshot.checkedAt,
          })
        }),

      SiteReconcile: () =>
        reconciler.reconcile.pipe(
          Effect.map(
            (r) =>
              new ReconcileResultRpc({
                success: r.success,
                stepsApplied: r.stepsApplied,
                stepsTotal: r.stepsTotal,
                errors: r.errors.map(
                  (e) =>
                    new ReconcileStepError({
                      step: JSON.stringify(e.step),
                      error: e.error,
                    })
                ),
                durationMs: r.durationMs,
                reconciliationId: r.reconciliationId,
              })
          ),
          Effect.mapError((e) => `Reconcile failed: ${e._tag}`)
        ),

      ServiceRestart: ({ name }) =>
        executor
          .restart(name)
          .pipe(Effect.mapError((e) => `Restart failed: ${e.message}`)),

      SiteEvents: () =>
        Stream.fromPubSub(reconciler.events.subscribe).pipe(
          Stream.map(
            (e) =>
              new ReconcileEventRpc({
                timestamp: e.timestamp,
                reconciliationId: e.reconciliationId,
                type: e.type,
                details: e.details,
              })
          )
        ),

      HealthChanges: () =>
        Stream.fromPubSub(healthMonitor.changes).pipe(
          Stream.map(
            (s) =>
              new HealthChangeEventRpc({
                components: s.components,
                overallStatus: s.overallStatus,
                checkedAt: s.checkedAt,
              })
          )
        ),

      ServiceLogs: ({ name, tail }) =>
        executor.logStream(name, { tail }).pipe(
          Stream.map((line) => new LogLine({ line })),
          Stream.mapError((e) => `Log stream failed: ${e.message}`)
        ),

      ReadDir: ({ root }) => {
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
        ])
        const MAX_FILES = 5000
        const baseDir =
          root === "."
            ? siteConfig.workingDir
            : join(siteConfig.workingDir, root)

        function* walkDir(dir: string): Generator<string> {
          let names: string[]
          try {
            names = readdirSync(dir) as unknown as string[]
          } catch {
            return
          }
          for (const name of names) {
            if (IGNORE.has(name) || name.startsWith(".")) continue
            const fullPath = join(dir, name)
            let isDir = false
            try {
              isDir = statSync(fullPath).isDirectory()
            } catch {
              continue
            }
            const relPath = relative(baseDir, fullPath)
            if (isDir) {
              yield relPath + "/"
              yield* walkDir(fullPath)
            } else {
              yield relPath
            }
          }
        }

        return Stream.fromIterable(
          (function () {
            const paths: string[] = []
            for (const p of walkDir(baseDir)) {
              paths.push(p)
              if (paths.length >= MAX_FILES) break
            }
            return paths
          })()
        ).pipe(
          Stream.map((p) => new FilePath({ path: p })),
          Stream.mapError((e) => `ReadDir failed: ${String(e)}`)
        )
      },

      ReadFile: ({ path: filePath }) =>
        Effect.gen(function* () {
          const fullPath = join(siteConfig.workingDir, filePath)
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
          const langMap: Record<string, string> = {
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
          return new FileContent({
            path: filePath,
            content,
            language: langMap[ext] ?? "text",
          })
        }).pipe(
          Effect.mapError((e) =>
            typeof e === "string" ? e : `ReadFile failed: ${String(e)}`
          )
        ),
    }
  })
)

export const WorkbenchRpcLayer = RpcServer.layer(WorkbenchRpcs).pipe(
  Layer.provide(WorkbenchHandlers)
)

export const WorkbenchRpcProtocol = RpcServer.layerProtocolHttp({
  path: "/rpc",
}).pipe(Layer.provide(RpcSerialization.layerNdjson))

export function WorkbenchRpcServerLive(rpcPort: number) {
  return HttpRouter.Default.serve().pipe(
    Layer.provide(WorkbenchRpcLayer),
    Layer.provide(WorkbenchRpcProtocol),
    HttpServer.withLogAddress,
    Layer.provide(BunHttpServer.layer({ port: rpcPort }))
  )
}
