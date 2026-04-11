/**
 * Docker Compose executor — same DockerComposeFormatAdapter as `dx up`.
 *
 * All shell commands use the centralized subprocess module (shellCapture)
 * to avoid injection and get consistent env handling.
 */
import type {
  CatalogComponent,
  CatalogSystem,
} from "@smp/factory-shared/catalog"
import { DockerComposeFormatAdapter } from "@smp/factory-shared/formats/docker-compose.adapter"

import { type ShellResult, shellCapture } from "../../lib/shell.js"
import type {
  ComponentState,
  DeployResult,
  DesiredComponentState,
  Executor,
  HealthStatus,
  LogOpts,
  RunResult,
} from "./executor.js"

export interface ComposeExecutorConfig {
  composeFiles: string[]
  projectName?: string
  cwd: string
}

export class ComposeExecutor implements Executor {
  readonly type = "docker-compose"
  private config: ComposeExecutorConfig

  constructor(config: ComposeExecutorConfig) {
    this.config = config
  }

  private fileArgs(): string[] {
    const args: string[] = []
    for (const f of this.config.composeFiles) {
      args.push("-f", f)
    }
    if (this.config.projectName) {
      args.push("-p", this.config.projectName)
    }
    return args
  }

  private async compose(subcommand: string[]): Promise<ShellResult> {
    return shellCapture(
      ["docker", "compose", ...this.fileArgs(), ...subcommand],
      { cwd: this.config.cwd, noSecrets: true }
    )
  }

  async parseCatalog(): Promise<CatalogSystem> {
    const adapter = new DockerComposeFormatAdapter()
    const result = adapter.parse(this.config.cwd)
    return result.system
  }

  async inspect(): Promise<ComponentState[]> {
    const result = await this.compose(["ps", "--format", "json", "-a"])
    if (result.exitCode !== 0) return []

    const lines = result.stdout.trim().split("\n").filter(Boolean)
    const states: ComponentState[] = []

    for (const line of lines) {
      try {
        const container = JSON.parse(line)
        states.push(parseContainerState(container))
      } catch {
        // skip unparseable lines
      }
    }
    return states
  }

  async inspectOne(component: string): Promise<ComponentState> {
    const result = await this.compose(["ps", "--format", "json", component])
    if (result.exitCode !== 0) {
      return {
        name: component,
        image: "",
        status: "unknown",
        health: "none",
        ports: [],
      }
    }

    const lines = result.stdout.trim().split("\n").filter(Boolean)
    for (const line of lines) {
      try {
        return parseContainerState(JSON.parse(line))
      } catch {
        // continue
      }
    }

    return {
      name: component,
      image: "",
      status: "unknown",
      health: "none",
      ports: [],
    }
  }

  async deploy(
    component: string,
    desired: DesiredComponentState
  ): Promise<DeployResult> {
    const catalog = await this.parseCatalog()
    const inits = findInitsFor(catalog, component)

    for (const init of inits) {
      await this.runInit(init)
    }

    await this.compose(["pull", component])
    await this.compose(["up", "-d", "--no-deps", component])

    const state = await this.inspectOne(component)
    return { actualImage: state.image, status: state.status }
  }

  async stop(component: string): Promise<void> {
    await this.compose(["stop", component])
  }

  async scale(component: string, replicas: number): Promise<void> {
    await this.compose([
      "up",
      "-d",
      "--scale",
      `${component}=${replicas}`,
      "--no-deps",
      component,
    ])
  }

  async restart(component: string): Promise<void> {
    await this.compose(["restart", component])
  }

  async runInit(
    initName: string
  ): Promise<{ exitCode: number; output: string }> {
    const result = await this.compose(["run", "--rm", initName])
    return {
      exitCode: result.exitCode,
      output: result.stdout + result.stderr,
    }
  }

  async logs(component: string, opts?: LogOpts): Promise<string> {
    const args = ["logs"]
    if (opts?.tail) args.push("--tail", String(opts.tail))
    if (opts?.since) args.push("--since", opts.since)
    args.push(component)

    const result = await this.compose(args)
    return result.stdout + result.stderr
  }

  async run(component: string, cmd: string[]): Promise<RunResult> {
    const result = await this.compose(["run", "--rm", component, ...cmd])
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    }
  }

  async healthCheck(component: string): Promise<HealthStatus> {
    const state = await this.inspectOne(component)
    return state.health
  }

  async healthCheckAll(): Promise<Record<string, HealthStatus>> {
    const states = await this.inspect()
    const result: Record<string, HealthStatus> = {}
    for (const s of states) {
      result[s.name] = s.health
    }
    return result
  }
}

function parseContainerState(
  container: Record<string, unknown>
): ComponentState {
  const service = String(container.Service ?? container.Name ?? "")
  const image = String(container.Image ?? "")
  const stateStr = String(container.State ?? "").toLowerCase()
  const healthStr = String(container.Health ?? "").toLowerCase()

  let status: ComponentState["status"] = "unknown"
  if (stateStr === "running") status = "running"
  else if (stateStr === "exited" || stateStr === "dead") status = "exited"
  else if (stateStr === "restarting") status = "restarting"
  else if (stateStr === "created" || stateStr === "paused") status = "stopped"

  let health: ComponentState["health"] = "none"
  if (healthStr === "healthy") health = "healthy"
  else if (healthStr === "unhealthy") health = "unhealthy"
  else if (healthStr === "starting") health = "starting"

  return {
    name: service,
    image,
    status,
    health,
    ports: [],
  }
}

function findInitsFor(catalog: CatalogSystem, component: string): string[] {
  const inits: string[] = []
  for (const [name, comp] of Object.entries(catalog.components)) {
    if (comp.spec.type === "init" && comp.spec.initFor === component) {
      inits.push(name)
    }
  }
  return inits
}
