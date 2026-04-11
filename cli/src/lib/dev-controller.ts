/**
 * Dev server management controller.
 *
 * Manages native dev servers (Node/Python/Java) as background daemons.
 * Port sharing: native dev and Docker compose use the SAME port reservation
 * (keyed by the service name). Starting native dev stops the Docker container
 * for that service, and vice-versa.
 */
import type { CatalogSystem } from "@smp/factory-shared/catalog"
import { spawn } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { basename, join, resolve } from "node:path"

import { type ServiceType, detectServiceType } from "./detect-service-type.js"
import { Compose } from "./docker.js"
import {
  PortManager,
  catalogToPortRequests,
  isPortFree,
  portEnvVars,
} from "./port-manager.js"
import { type TunnelClientOptions, openTunnel } from "./tunnel-client.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolvedComponent {
  name: string
  absPath: string
  type: ServiceType
  preferredPort?: number
  devCommand?: string
}

export interface StartResult {
  name: string
  pid: number
  port: number
  alreadyRunning: boolean
  stoppedDocker: boolean
}

export interface StopResult {
  name: string
  pid: number
}

export interface DevServerInfo {
  name: string
  port: number | null
  pid: number | null
  running: boolean
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
// Process helpers
// ---------------------------------------------------------------------------

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readPid(pidFile: string): number | null {
  if (!existsSync(pidFile)) return null
  try {
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10)
    if (isNaN(pid)) return null
    if (!isProcessRunning(pid)) {
      unlinkSync(pidFile)
      return null
    }
    return pid
  } catch {
    return null
  }
}

function killProcessTree(pid: number): void {
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
// Controller
// ---------------------------------------------------------------------------

export class DevController {
  private readonly stateDir: string
  private readonly portManager: PortManager
  private readonly projectName: string
  private readonly compose: Compose
  private readonly workspaceId: string | undefined
  private readonly workspaceSlug: string | undefined
  private readonly activeTunnels = new Map<string, { close: () => void }>()

  constructor(
    private readonly rootDir: string,
    private readonly catalog: CatalogSystem,
    private readonly composeFiles: string[]
  ) {
    this.stateDir = join(rootDir, ".dx", "dev")
    this.portManager = new PortManager(join(rootDir, ".dx"))
    this.projectName = basename(rootDir)
    this.compose = new Compose(composeFiles, this.projectName)
    this.workspaceId = process.env.DX_WORKSPACE_ID
    this.workspaceSlug = process.env.DX_WORKSPACE_SLUG
  }

  /** Whether we're running inside a workspace environment */
  get inSandbox(): boolean {
    return !!this.workspaceId
  }

  // ------------------------------------------------------------------
  // Resolve
  // ------------------------------------------------------------------

  resolveComponent(name: string): ResolvedComponent {
    const comp = this.catalog.components[name]
    if (!comp) {
      const available = Object.keys(this.catalog.components).join(", ")
      throw new Error(`Component "${name}" not found. Available: ${available}`)
    }

    const buildContext = comp.spec.build?.context ?? "."
    const absPath = resolve(this.rootDir, buildContext)

    const type: ServiceType | null =
      (comp.spec.runtime as ServiceType | undefined) ??
      detectServiceType(absPath)

    if (!type) {
      throw new Error(
        `Cannot determine service type for "${name}" at ${absPath}. ` +
          `Add a "dx.runtime" label (node/python/java) to your docker-compose service.`
      )
    }

    const preferredPort = comp.spec.ports?.[0]?.port

    return {
      name,
      absPath,
      type,
      preferredPort,
      devCommand: comp.spec.dev?.command,
    }
  }

  // ------------------------------------------------------------------
  // Port environment for sibling discovery
  // ------------------------------------------------------------------

  async allPortsEnv(): Promise<Record<string, string>> {
    const requests = catalogToPortRequests(this.catalog)
    const resolved = await this.portManager.resolveMulti(requests)

    const env: Record<string, string> = {}
    for (const [service, ports] of Object.entries(resolved)) {
      Object.assign(env, portEnvVars(service, ports))
    }
    return env
  }

  // ------------------------------------------------------------------
  // Docker coordination
  // ------------------------------------------------------------------

  private stopDockerContainer(componentName: string): boolean {
    if (this.composeFiles.length === 0) return false
    if (!this.compose.isRunning(componentName)) {
      return false
    }
    this.compose.stop([componentName])
    return true
  }

  // ------------------------------------------------------------------
  // start
  // ------------------------------------------------------------------

  async start(
    component: string,
    opts?: { port?: number; env?: Record<string, string> }
  ): Promise<StartResult> {
    const resolved = this.resolveComponent(component)

    mkdirSync(this.stateDir, { recursive: true })

    const pidFile = join(this.stateDir, `${resolved.name}.pid`)
    const portFile = join(this.stateDir, `${resolved.name}.port`)
    const logFile = join(this.stateDir, `${resolved.name}.log`)

    const existingPid = readPid(pidFile)
    if (existingPid !== null) {
      const existingPort = existsSync(portFile)
        ? parseInt(readFileSync(portFile, "utf-8").trim(), 10)
        : 0
      return {
        name: resolved.name,
        pid: existingPid,
        port: existingPort,
        alreadyRunning: true,
        stoppedDocker: false,
      }
    }

    const stoppedDocker = this.stopDockerContainer(resolved.name)

    let actualPort: number
    if (opts?.port !== undefined) {
      if (!(await isPortFree(opts.port))) {
        throw new Error(`Port ${opts.port} is already in use`)
      }
      actualPort = opts.port
    } else {
      const assigned = await this.portManager.resolve([
        { name: resolved.name, preferred: resolved.preferredPort },
      ])
      actualPort = assigned[resolved.name]
    }

    let cmd: string[]
    if (resolved.devCommand) {
      cmd = ["sh", "-c", `${resolved.devCommand} --port ${actualPort}`]
    } else {
      cmd = buildDevCmd(resolved.type, actualPort, resolved.absPath)
    }

    const portEnv = await this.allPortsEnv()
    const procEnv = {
      ...process.env,
      ...portEnv,
      ...opts?.env,
      PORT: String(actualPort),
    }

    const cwd = resolved.devCommand ? this.rootDir : resolved.absPath
    const logFd = openSync(logFile, "w")
    const proc = spawn(cmd[0], cmd.slice(1), {
      cwd,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: procEnv,
    })
    proc.unref()

    const pid = proc.pid!
    writeFileSync(pidFile, String(pid))
    writeFileSync(portFile, String(actualPort))

    // Create tunnel(s) when running inside a workspace
    if (this.workspaceSlug) {
      await this.createSandboxTunnels(resolved.name, actualPort)
    }

    return {
      name: resolved.name,
      pid,
      port: actualPort,
      alreadyRunning: false,
      stoppedDocker,
    }
  }

  // ------------------------------------------------------------------
  // Sandbox tunnel management
  // ------------------------------------------------------------------

  private async createSandboxTunnels(
    componentName: string,
    port: number
  ): Promise<void> {
    if (!this.workspaceSlug) return

    const slug = this.workspaceSlug

    // Port-based tunnel: {slug}-p{port}.workspace.dx.dev
    const portSubdomain = `${slug}-p${port}`
    const portTunnel = await openTunnel(
      {
        port,
        subdomain: portSubdomain,
        principalId: process.env.DX_PRINCIPAL_ID,
      },
      {
        onRegistered: (info) => {
          // Port tunnel registered at info.url
        },
        onError: () => {},
        onClose: () => {
          this.activeTunnels.delete(`${componentName}:port`)
        },
      }
    )
    this.activeTunnels.set(`${componentName}:port`, portTunnel)

    // Check if this component has a named endpoint configured
    const comp = this.catalog.components[componentName]
    const dxConfig = comp?.spec as Record<string, unknown> | undefined
    const endpointName = (dxConfig?.endpointName as string) ?? undefined
    if (endpointName) {
      const namedSubdomain = `${slug}--${endpointName}`
      const namedTunnel = await openTunnel(
        {
          port,
          subdomain: namedSubdomain,
          principalId: process.env.DX_PRINCIPAL_ID,
        },
        {
          onRegistered: () => {},
          onError: () => {},
          onClose: () => {
            this.activeTunnels.delete(`${componentName}:named`)
          },
        }
      )
      this.activeTunnels.set(`${componentName}:named`, namedTunnel)
    }

    // If this is the primary port (port 80, 443, or configured as primary), tunnel bare domain too
    const isPrimary =
      port === 80 || port === 443 || dxConfig?.isPrimary === true
    if (isPrimary) {
      const bareTunnel = await openTunnel(
        { port, subdomain: slug, principalId: process.env.DX_PRINCIPAL_ID },
        {
          onRegistered: () => {},
          onError: () => {},
          onClose: () => {
            this.activeTunnels.delete(`${componentName}:bare`)
          },
        }
      )
      this.activeTunnels.set(`${componentName}:bare`, bareTunnel)
    }
  }

  private closeSandboxTunnels(componentName?: string): void {
    if (componentName) {
      for (const suffix of ["port", "named", "bare"]) {
        const key = `${componentName}:${suffix}`
        this.activeTunnels.get(key)?.close()
        this.activeTunnels.delete(key)
      }
    } else {
      for (const [, tunnel] of this.activeTunnels) {
        tunnel.close()
      }
      this.activeTunnels.clear()
    }
  }

  // ------------------------------------------------------------------
  // stop
  // ------------------------------------------------------------------

  stop(component?: string): StopResult[] {
    const stopped: StopResult[] = []

    if (!existsSync(this.stateDir)) return stopped

    if (component === undefined) {
      this.closeSandboxTunnels()
      for (const entry of readdirSync(this.stateDir)) {
        if (!entry.endsWith(".pid")) continue
        const name = entry.replace(/\.pid$/, "")
        const pidFile = join(this.stateDir, entry)
        const portFile = join(this.stateDir, `${name}.port`)
        const pid = readPid(pidFile)
        if (pid !== null) {
          killProcessTree(pid)
          stopped.push({ name, pid })
        }
        try {
          unlinkSync(pidFile)
        } catch {}
        try {
          unlinkSync(portFile)
        } catch {}
      }
      return stopped
    }

    const resolved = this.resolveComponent(component)
    this.closeSandboxTunnels(resolved.name)
    const pidFile = join(this.stateDir, `${resolved.name}.pid`)
    const portFile = join(this.stateDir, `${resolved.name}.port`)

    const pid = readPid(pidFile)
    if (pid !== null) {
      killProcessTree(pid)
      stopped.push({ name: resolved.name, pid })
    }
    try {
      unlinkSync(pidFile)
    } catch {}
    try {
      unlinkSync(portFile)
    } catch {}
    return stopped
  }

  // ------------------------------------------------------------------
  // restart
  // ------------------------------------------------------------------

  async restart(component: string): Promise<StartResult> {
    this.stop(component)
    return this.start(component)
  }

  // ------------------------------------------------------------------
  // ps
  // ------------------------------------------------------------------

  ps(): DevServerInfo[] {
    const result: DevServerInfo[] = []
    if (!existsSync(this.stateDir)) return result

    for (const entry of readdirSync(this.stateDir).sort()) {
      if (!entry.endsWith(".pid")) continue
      const name = entry.replace(/\.pid$/, "")
      const pidFile = join(this.stateDir, entry)
      const portFile = join(this.stateDir, `${name}.port`)

      const pid = readPid(pidFile)
      let port: number | null = null
      if (existsSync(portFile)) {
        const parsed = parseInt(readFileSync(portFile, "utf-8").trim(), 10)
        if (!isNaN(parsed)) port = parsed
      }

      result.push({
        name,
        port,
        pid,
        running: pid !== null,
      })
    }

    return result
  }

  // ------------------------------------------------------------------
  // logs
  // ------------------------------------------------------------------

  logs(component: string): string {
    const resolved = this.resolveComponent(component)
    const logFile = join(this.stateDir, `${resolved.name}.log`)
    if (!existsSync(logFile)) {
      throw new Error(
        `No log file found for ${resolved.name}. Is the dev server running?`
      )
    }
    return logFile
  }
}
