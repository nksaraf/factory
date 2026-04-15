/**
 * Native process executor — manages dev server processes (Node/Python/Java).
 *
 * Implements the Executor interface so native dev servers participate in the
 * same reconciliation model as Docker containers. The key difference: deploy()
 * spawns a detached process, inspect() checks PID liveness, and logs come from
 * `.dx/dev/<name>.log` files rather than container logs.
 */
import type { CatalogSystem } from "@smp/factory-shared/catalog"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import {
  type ServiceType,
  detectServiceType,
} from "../../lib/detect-service-type.js"
import {
  PortManager,
  isPortFree,
  portEnvVars,
  catalogToPortRequests,
} from "../../lib/port-manager.js"
import type { SiteManager } from "../../lib/site-manager.js"
import type {
  ComponentState,
  DeployResult,
  DesiredComponentState,
  Executor,
  HealthStatus,
  LogOpts,
  RunResult,
} from "./executor.js"

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function killProcessTree(pid: number): void {
  try {
    process.kill(-pid, "SIGTERM")
  } catch {
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      return
    }
  }

  for (let i = 0; i < 40; i++) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
  }

  try {
    process.kill(-pid, "SIGKILL")
  } catch {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      /* noop */
    }
  }
}

// ---------------------------------------------------------------------------
// Dev command builders
// ---------------------------------------------------------------------------

function buildDevCmd(
  type: ServiceType,
  port: number,
  absPath: string
): string[] {
  switch (type) {
    case "node":
      return ["pnpm", "dev", "--port", String(port)]
    case "python":
      if (existsSync(join(absPath, "main.py"))) {
        return ["fastapi", "dev", "--port", String(port)]
      }
      return [
        "uvicorn",
        "main:app",
        "--reload",
        "--host",
        "0.0.0.0",
        "--port",
        String(port),
      ]
    case "java":
      return [
        "mvn",
        "spring-boot:run",
        `-Dspring-boot.run.arguments=--server.port=${port}`,
      ]
  }
}

// ---------------------------------------------------------------------------
// NativeExecutor
// ---------------------------------------------------------------------------

export interface NativeExecutorConfig {
  rootDir: string
  catalog: CatalogSystem
  site: SiteManager
  sdSlug: string
}

export class NativeExecutor implements Executor {
  readonly type = "native"
  private readonly logDir: string
  private readonly portManager: PortManager

  constructor(private readonly config: NativeExecutorConfig) {
    this.logDir = join(config.rootDir, ".dx", "dev")
    this.portManager = new PortManager(join(config.rootDir, ".dx"))
  }

  // ------------------------------------------------------------------
  // Component resolution
  // ------------------------------------------------------------------

  private resolveComponent(name: string): {
    name: string
    absPath: string
    type: ServiceType
    preferredPort?: number
    devCommand?: string
  } {
    const comp = this.config.catalog.components[name]
    if (!comp) {
      const available = Object.keys(this.config.catalog.components).join(", ")
      throw new Error(`Component "${name}" not found. Available: ${available}`)
    }

    const buildContext = comp.spec.build?.context ?? "."
    const absPath = resolve(this.config.rootDir, buildContext)

    const type: ServiceType | null =
      (comp.spec.runtime as ServiceType | undefined) ??
      detectServiceType(absPath)

    if (!type) {
      throw new Error(
        `Cannot determine service type for "${name}" at ${absPath}. ` +
          `Add a "dx.runtime" label (node/python/java) to your docker-compose service.`
      )
    }

    return {
      name,
      absPath,
      type,
      preferredPort: comp.spec.ports?.[0]?.port,
      devCommand: comp.spec.dev?.command,
    }
  }

  // ------------------------------------------------------------------
  // Site state helpers
  // ------------------------------------------------------------------

  private readLivePid(name: string): number | null {
    const sd = this.config.site.getSystemDeployment(this.config.sdSlug)
    if (!sd) return null
    const cd = sd.componentDeployments.find((c) => c.componentSlug === name)
    const pid = cd?.status.pid
    if (pid == null) return null
    if (!isProcessRunning(pid)) {
      this.config.site.updateComponentStatus(this.config.sdSlug, name, {
        pid: undefined,
        phase: "stopped",
      })
      return null
    }
    return pid
  }

  private readPort(name: string): number | null {
    const sd = this.config.site.getSystemDeployment(this.config.sdSlug)
    if (!sd) return null
    const cd = sd.componentDeployments.find((c) => c.componentSlug === name)
    return cd?.status.port ?? null
  }

  // ------------------------------------------------------------------
  // Executor interface
  // ------------------------------------------------------------------

  async parseCatalog(): Promise<CatalogSystem> {
    return this.config.catalog
  }

  async inspect(): Promise<ComponentState[]> {
    const sd = this.config.site.getSystemDeployment(this.config.sdSlug)
    if (!sd) return []

    const result: ComponentState[] = []
    for (const cd of sd.componentDeployments) {
      if (cd.mode !== "native") continue
      const pid = cd.status.pid ?? null
      const running = pid !== null && isProcessRunning(pid)
      const port = cd.status.port

      result.push({
        name: cd.componentSlug,
        image: "",
        status: running ? "running" : "stopped",
        health: running ? "healthy" : "none",
        ports: port ? [{ host: port, container: port, protocol: "tcp" }] : [],
      })
    }
    return result
  }

  async inspectOne(component: string): Promise<ComponentState> {
    const pid = this.readLivePid(component)
    const port = this.readPort(component)
    const running = pid !== null

    return {
      name: component,
      image: "",
      status: running ? "running" : "stopped",
      health: running ? "healthy" : "none",
      ports: port ? [{ host: port, container: port, protocol: "tcp" }] : [],
    }
  }

  async deploy(
    component: string,
    desired: DesiredComponentState
  ): Promise<DeployResult> {
    const resolved = this.resolveComponent(component)

    mkdirSync(this.logDir, { recursive: true })
    const logFile = join(this.logDir, `${resolved.name}.log`)

    // Already running — skip
    const existingPid = this.readLivePid(resolved.name)
    if (existingPid !== null) {
      return { actualImage: "", status: "running" }
    }

    // Resolve port
    let actualPort: number
    if (resolved.preferredPort && (await isPortFree(resolved.preferredPort))) {
      actualPort = resolved.preferredPort
    } else {
      const assigned = await this.portManager.resolve([
        { name: resolved.name, preferred: resolved.preferredPort },
      ])
      actualPort = assigned[resolved.name]
    }

    // Build command
    let cmd: string[]
    if (resolved.devCommand) {
      cmd = ["sh", "-c", resolved.devCommand]
    } else {
      cmd = buildDevCmd(resolved.type, actualPort, resolved.absPath)
    }

    // Build env
    const requests = catalogToPortRequests(this.config.catalog)
    const allPorts = await this.portManager.resolveMulti(requests)
    const portEnv: Record<string, string> = {}
    for (const [service, ports] of Object.entries(allPorts)) {
      Object.assign(portEnv, portEnvVars(service, ports))
    }

    const procEnv = {
      ...process.env,
      ...portEnv,
      ...desired.envOverrides,
      PORT: String(actualPort),
    }

    const cwd = resolved.devCommand ? this.config.rootDir : resolved.absPath
    const proc = Bun.spawn(cmd, {
      cwd,
      stdin: "ignore",
      stdout: Bun.file(logFile),
      stderr: Bun.file(logFile),
      env: procEnv,
    })
    proc.unref()

    const pid = proc.pid

    // Write status
    this.config.site.updateComponentStatus(this.config.sdSlug, resolved.name, {
      pid,
      port: actualPort,
      phase: "running",
    })
    this.config.site.save()

    return { actualImage: "", status: "running" }
  }

  async stop(component: string): Promise<void> {
    const pid = this.readLivePid(component)
    if (pid !== null) {
      killProcessTree(pid)
    }
    this.config.site.updateComponentStatus(this.config.sdSlug, component, {
      pid: undefined,
      phase: "stopped",
    })
    this.config.site.save()
  }

  async scale(_component: string, _replicas: number): Promise<void> {
    throw new Error("Native executor does not support scaling")
  }

  async restart(component: string): Promise<void> {
    await this.stop(component)
    // Re-read desired state to get envOverrides
    const sd = this.config.site.getSystemDeployment(this.config.sdSlug)
    const cd = sd?.componentDeployments.find(
      (c) => c.componentSlug === component
    )
    await this.deploy(component, {
      image: "",
      replicas: 1,
      envOverrides: cd?.spec.envOverrides ?? {},
      resourceOverrides: {},
    })
  }

  async runInit(
    _initName: string
  ): Promise<{ exitCode: number; output: string }> {
    throw new Error("Native executor does not support init containers")
  }

  async logs(component: string, opts?: LogOpts): Promise<string> {
    const logFile = join(this.logDir, `${component}.log`)
    if (!existsSync(logFile)) {
      throw new Error(
        `No log file found for ${component}. Is the dev server running?`
      )
    }

    const content = readFileSync(logFile, "utf8")
    if (opts?.tail) {
      const lines = content.split("\n")
      return lines.slice(-opts.tail).join("\n")
    }
    return content
  }

  async run(_component: string, _cmd: string[]): Promise<RunResult> {
    throw new Error("Native executor does not support run")
  }

  async healthCheck(component: string): Promise<HealthStatus> {
    const pid = this.readLivePid(component)
    return pid !== null ? "healthy" : "unhealthy"
  }

  async healthCheckAll(): Promise<Record<string, HealthStatus>> {
    const states = await this.inspect()
    const result: Record<string, HealthStatus> = {}
    for (const s of states) {
      result[s.name] = s.status === "running" ? "healthy" : "unhealthy"
    }
    return result
  }
}
