/**
 * Site agent — the unified daemon process for a site.
 *
 * Wraps both SiteOrchestrator (dev/up modes) and SiteController
 * (controller mode) behind a uniform interface. One process per site.
 */
import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import type { SiteOrchestrator } from "../lib/site-orchestrator.js"
import type {
  SiteController,
  ControllerStatus,
  ReconcileResult,
} from "./controller.js"
import type {
  Executor,
  ComponentState,
  DeployResult,
} from "./execution/executor.js"
import type { HealthMonitor, HealthSnapshot } from "./health.js"
import type { SiteManifest } from "./manifest.js"

export type AgentMode = "dev" | "up" | "controller"

export interface AgentStatus {
  mode: AgentMode
  pid: number
  port: number
  startedAt: string
  uptime: string

  // From orchestrator (dev/up modes)
  project?: string
  sdSlug?: string
  site?: { slug: string; type: string }
  workbench?: { slug: string; type: string; tunnelSubdomain?: string }
  tunnel?: {
    status: "disconnected" | "connecting" | "connected" | "error"
    info?: { url: string; subdomain: string }
  }

  // From controller (controller mode)
  siteName?: string
  controllerMode?: string
  executorType: string
  manifestVersion?: number
  lastReconcileAt?: string | null
  lastReconcileResult?: ReconcileResult | null
  healthSnapshot?: HealthSnapshot | null
}

export interface SiteAgentConfig {
  mode: AgentMode
  port: number
  workingDir: string
}

export class SiteAgent {
  readonly mode: AgentMode
  readonly config: SiteAgentConfig
  readonly executor: Executor
  readonly orchestrator: SiteOrchestrator | null
  readonly controller: SiteController | null
  readonly healthMonitor: HealthMonitor | null
  readonly factoryUrl: string | null

  private startedAt: Date
  private serverHandle: { stop: () => void } | null = null
  private shutdownCallbacks: Array<() => void> = []

  constructor(opts: {
    config: SiteAgentConfig
    executor: Executor
    orchestrator?: SiteOrchestrator | null
    controller?: SiteController | null
    healthMonitor?: HealthMonitor | null
    factoryUrl?: string | null
  }) {
    this.mode = opts.config.mode
    this.config = opts.config
    this.executor = opts.executor
    this.orchestrator = opts.orchestrator ?? null
    this.controller = opts.controller ?? null
    this.healthMonitor = opts.healthMonitor ?? null
    this.factoryUrl = opts.factoryUrl ?? null
    this.startedAt = new Date()
  }

  getStatus(): AgentStatus {
    const now = new Date()
    const uptimeMs = now.getTime() - this.startedAt.getTime()
    const uptimeSecs = Math.floor(uptimeMs / 1000)
    const hours = Math.floor(uptimeSecs / 3600)
    const mins = Math.floor((uptimeSecs % 3600) / 60)
    const secs = uptimeSecs % 60

    const base: AgentStatus = {
      mode: this.mode,
      pid: process.pid,
      port: this.config.port,
      startedAt: this.startedAt.toISOString(),
      uptime: `${hours}h ${mins}m ${secs}s`,
      executorType: this.executor.type,
    }

    if (this.orchestrator) {
      const state = this.orchestrator.site.getState()
      base.project = this.orchestrator.project.name
      base.sdSlug = this.orchestrator.sdSlug
      base.site = state.spec.site
      base.workbench = state.spec.workbench
      base.tunnel = this.orchestrator.getTunnelState()
    }

    if (this.controller) {
      const cs = this.controller.getStatus()
      base.siteName = cs.siteName
      base.controllerMode = cs.mode
      base.manifestVersion = cs.manifestVersion
      base.lastReconcileAt = cs.lastReconcileAt
      base.lastReconcileResult = cs.lastReconcileResult
      base.healthSnapshot = cs.healthSnapshot
    } else if (this.healthMonitor) {
      base.healthSnapshot = this.healthMonitor.getLastSnapshot()
    }

    return base
  }

  /** Unified service list — works in both dev and controller modes. */
  async getServices(): Promise<Array<Record<string, unknown>>> {
    const actual = await this.executor.inspect()

    if (this.orchestrator) {
      // Dev/up mode: enriched with mode, ports, tunnel URLs, catalog metadata
      const sd = this.orchestrator.site.getSystemDeployment(
        this.orchestrator.sdSlug
      )
      const byName = new Map(
        (sd?.componentDeployments ?? []).map((c) => [c.componentSlug, c])
      )
      const tunnel = this.orchestrator.getTunnelState().info
      const portUrls = new Map(
        (tunnel?.portUrls ?? []).map((p) => [p.port, p.url])
      )
      const catalog = this.orchestrator.project.catalog
      const allocations = this.orchestrator.getPortAllocations()
      const allocByService = new Map<string, { name: string; port: number }[]>()
      for (const a of allocations) {
        const [svc, portName] = a.name.split("/")
        if (!svc || !portName) continue
        if (!allocByService.has(svc)) allocByService.set(svc, [])
        allocByService.get(svc)!.push({ name: portName, port: a.port })
      }

      return actual.map((s) => {
        const cd = byName.get(s.name)
        const entry = catalog.components[s.name] ?? catalog.resources[s.name]
        const catalogPorts = entry?.spec?.ports ?? []

        const ports = s.ports.map((p, idx) => {
          const cp =
            catalogPorts[idx] ??
            catalogPorts.find((x: any) => x.port === p.container)
          return {
            name: cp?.name ?? String(p.container ?? p.host),
            host: p.host,
            container: p.container,
            protocol: cp?.protocol ?? "tcp",
            url: `http://localhost:${p.host}`,
            tunnelUrl: portUrls.get(p.host),
          }
        })

        if (ports.length === 0) {
          const allocs = allocByService.get(s.name) ?? []
          for (const alloc of allocs) {
            const cp = catalogPorts.find((x: any) => x.name === alloc.name)
            ports.push({
              name: alloc.name,
              host: alloc.port,
              container: cp?.port ?? alloc.port,
              protocol: cp?.protocol ?? "tcp",
              url: `http://localhost:${alloc.port}`,
              tunnelUrl: portUrls.get(alloc.port),
            })
          }
        }

        if (cd?.status.port && !ports.some((p) => p.host === cd.status.port)) {
          ports.unshift({
            name: "dev",
            host: cd.status.port,
            container: cd.status.port,
            protocol: "http",
            url: `http://localhost:${cd.status.port}`,
            tunnelUrl: portUrls.get(cd.status.port),
          })
        }

        const deps = this.orchestrator!.graph.directDeps(s.name)

        return {
          name: s.name,
          mode: cd?.mode ?? "unknown",
          status: s.status,
          health: s.health,
          image: s.image,
          ports,
          pid: cd?.status.pid,
          phase: cd?.status.phase,
          conditions: cd?.status.conditions ?? [],
          kind: entry?.kind ?? null,
          type: entry?.spec?.type ?? null,
          description: entry?.metadata?.description ?? null,
          tags: entry?.metadata?.tags ?? [],
          owner: entry?.spec?.owner ?? null,
          deps,
        }
      })
    }

    // Controller mode: simpler view with drift detection
    const manifest = this.controller?.getManifest()
    const desired = manifest?.componentDeployments ?? []
    const desiredMap = new Map(desired.map((cd) => [cd.componentName, cd]))

    return actual.map((s) => ({
      name: s.name,
      mode: "container",
      status: s.status,
      health: s.health,
      image: s.image,
      ports: s.ports,
      desired: desiredMap.get(s.name) ?? null,
      drift: desiredMap.get(s.name)?.desiredImage
        ? s.image !== desiredMap.get(s.name)!.desiredImage
        : false,
    }))
  }

  /** Detailed view of a single service. */
  async getServiceDetail(name: string): Promise<Record<string, unknown>> {
    if (this.orchestrator) {
      const sd = this.orchestrator.site.getSystemDeployment(
        this.orchestrator.sdSlug
      )
      const cd = sd?.componentDeployments.find((c) => c.componentSlug === name)
      const catalog = this.orchestrator.project.catalog
      const entry = catalog.components[name] ?? catalog.resources[name]
      if (!entry) {
        throw new Error(`Component ${name} not found in catalog`)
      }

      let actualState
      try {
        actualState = await this.executor.inspectOne(name)
      } catch {
        actualState = null
      }

      const deps = this.orchestrator.graph.transitiveDeps(name)

      return {
        name,
        catalog: entry,
        deployment: cd ?? null,
        actual: actualState,
        dependencies: deps,
      }
    }

    // Controller mode
    const actualState = await this.executor.inspectOne(name)
    return { name, actual: actualState }
  }

  /** Deploy a single service (controller mode: from manifest). */
  async deployService(name: string): Promise<DeployResult> {
    if (this.controller) {
      const manifest = this.controller.getManifest()
      const cd = manifest?.componentDeployments.find(
        (c) => c.componentName === name
      )
      if (!cd) {
        throw new Error(`Component ${name} not in manifest`)
      }
      return this.executor.deploy(name, {
        image: cd.desiredImage,
        replicas: cd.replicas,
        envOverrides: cd.envOverrides,
        resourceOverrides: cd.resourceOverrides,
      })
    }

    // Dev/up mode: delegate to orchestrator
    if (this.orchestrator) {
      const result = await this.orchestrator.startComponent(name)
      return {
        actualImage: "",
        status: "running",
      }
    }

    throw new Error("No controller or orchestrator available")
  }

  /** Stream service logs as SSE. */
  streamServiceLogs(
    name: string,
    set: any,
    activeStreams: Set<() => void>
  ): Response {
    const logPath = join(this.config.workingDir, ".dx", "dev", `${name}.log`)
    set.headers["content-type"] = "text/event-stream"
    set.headers["cache-control"] = "no-cache"
    set.headers["connection"] = "keep-alive"

    const encoder = new TextEncoder()
    let closed = false
    let close: () => void = () => {}

    // Determine whether to use file-based or Docker-based streaming
    const useFile =
      this.mode === "dev" &&
      this.orchestrator &&
      (() => {
        const sd = this.orchestrator!.site.getSystemDeployment(
          this.orchestrator!.sdSlug
        )
        const cd = sd?.componentDeployments.find(
          (c) => c.componentSlug === name
        )
        return cd?.mode === "native" || existsSync(logPath)
      })()

    const stream = new ReadableStream({
      start(controller) {
        const send = (line: string) => {
          if (closed || !line) return
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(line)}\n\n`)
            )
          } catch {
            // closed
          }
        }

        if (useFile) {
          let offset = existsSync(logPath) ? statSync(logPath).size : 0
          let timer: ReturnType<typeof setTimeout> | null = null
          close = () => {
            if (closed) return
            closed = true
            if (timer) clearTimeout(timer)
            activeStreams.delete(close)
            try {
              controller.close()
            } catch {
              // already closed
            }
          }
          activeStreams.add(close)
          const tick = () => {
            if (closed) return
            try {
              if (existsSync(logPath)) {
                const size = statSync(logPath).size
                if (size < offset) offset = 0
                if (size > offset) {
                  const buf = readFileSync(logPath).subarray(offset, size)
                  offset = size
                  for (const line of buf.toString("utf8").split("\n")) {
                    send(line)
                  }
                }
              }
            } catch {
              // ignore
            }
            if (!closed) timer = setTimeout(tick, 500)
          }
          tick()
        } else {
          // Docker compose log streaming
          const composeFiles =
            (this as any).orchestrator?.project.composeFiles ?? []
          const projectName = (this as any).orchestrator?.project.name ?? ""
          const rootDir =
            (this as any).orchestrator?.project.rootDir ??
            (this as any).config.workingDir
          const args = ["compose"]
          for (const f of composeFiles) {
            args.push("-f", f)
          }
          if (projectName) {
            args.push("-p", projectName)
          }
          args.push("logs", "-f", "--tail", "200", "--no-log-prefix", name)
          const proc = Bun.spawn(["docker", ...args], {
            cwd: rootDir,
            stdout: "pipe",
            stderr: "pipe",
          })
          close = () => {
            if (closed) return
            closed = true
            activeStreams.delete(close)
            try {
              proc.kill()
            } catch {}
            try {
              controller.close()
            } catch {}
          }
          activeStreams.add(close)

          const pump = async (s: ReadableStream<Uint8Array> | null) => {
            if (!s) return
            const reader = s.getReader()
            const dec = new TextDecoder()
            let buf = ""
            while (!closed) {
              const { value, done } = await reader.read()
              if (done) break
              buf += dec.decode(value, { stream: true })
              const parts = buf.split("\n")
              buf = parts.pop() ?? ""
              for (const line of parts) send(line)
            }
            if (buf) send(buf)
          }

          void pump(proc.stdout).catch(() => {})
          void pump(proc.stderr).catch(() => {})
          void proc.exited.then(() => close())
        }
      },
      cancel() {
        close()
      },
    })

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
    })
  }

  /** Stream agent log file as SSE (for CLI attach mode). */
  streamAgentLogs(set: any, activeStreams: Set<() => void>): Response {
    const logPath = join(this.config.workingDir, ".dx", "agent.log")
    set.headers["content-type"] = "text/event-stream"
    set.headers["cache-control"] = "no-cache"

    const encoder = new TextEncoder()
    let closed = false
    let close: () => void

    const stream = new ReadableStream({
      start(controller) {
        let offset = existsSync(logPath) ? statSync(logPath).size : 0
        // Start from the last 4KB to show recent context on attach
        if (offset > 4096) {
          const tail = readFileSync(logPath)
            .subarray(offset - 4096, offset)
            .toString("utf8")
          const lines = tail.split("\n")
          // Skip first partial line
          for (let i = 1; i < lines.length; i++) {
            if (lines[i]) {
              try {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(lines[i])}\n\n`)
                )
              } catch {}
            }
          }
        }

        let timer: ReturnType<typeof setTimeout> | null = null
        close = () => {
          if (closed) return
          closed = true
          if (timer) clearTimeout(timer)
          activeStreams.delete(close)
          try {
            controller.close()
          } catch {}
        }
        activeStreams.add(close)

        const tick = () => {
          if (closed) return
          try {
            if (existsSync(logPath)) {
              const size = statSync(logPath).size
              if (size < offset) offset = 0
              if (size > offset) {
                const buf = readFileSync(logPath).subarray(offset, size)
                offset = size
                for (const line of buf.toString("utf8").split("\n")) {
                  if (line) {
                    try {
                      controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify(line)}\n\n`)
                      )
                    } catch {}
                  }
                }
              }
            }
          } catch {}
          if (!closed) timer = setTimeout(tick, 500)
        }
        tick()
      },
      cancel() {
        close!()
      },
    })

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
    })
  }

  /** Register the server handle so shutdown can stop it. */
  setServerHandle(handle: { stop: () => void }): void {
    this.serverHandle = handle
  }

  /** Register a callback to run on shutdown. */
  onShutdown(cb: () => void): void {
    this.shutdownCallbacks.push(cb)
  }

  /** Graceful shutdown — stops everything. */
  shutdown(): void {
    // Stop controller loop if running
    if (this.controller?.isRunning()) {
      this.controller.stopLoop()
    }

    // Stop health monitor
    if (this.healthMonitor?.isRunning()) {
      this.healthMonitor.stop()
    }

    // Stop orchestrator (native processes, tunnel, etc.)
    if (this.orchestrator) {
      this.orchestrator.stop()
    }

    // Stop HTTP server
    if (this.serverHandle) {
      this.serverHandle.stop()
    }

    // Run registered callbacks
    for (const cb of this.shutdownCallbacks) {
      try {
        cb()
      } catch {}
    }

    process.exit(0)
  }
}
