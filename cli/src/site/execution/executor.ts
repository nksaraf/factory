/**
 * Executor interface — how the site controller makes changes happen.
 *
 * Separated from the controller core so the execution method can grow from
 * "run Docker Compose locally" to "reach out to other nodes" without
 * rewriting the orchestration logic.
 */
import type { CatalogSystem } from "@smp/factory-shared/catalog"

export interface ComponentState {
  name: string
  image: string
  status: "running" | "stopped" | "restarting" | "exited" | "unknown"
  health: "healthy" | "unhealthy" | "starting" | "none"
  ports: Array<{ host: number; container: number; protocol: string }>
  startedAt?: string
  exitCode?: number
}

export interface DesiredComponentState {
  image: string
  replicas: number
  envOverrides: Record<string, string>
  resourceOverrides: Record<string, string>
}

export interface DeployResult {
  actualImage: string
  status: ComponentState["status"]
}

export interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

export type HealthStatus = "healthy" | "unhealthy" | "starting" | "none"

export interface LogOpts {
  tail?: number
  since?: string
  follow?: boolean
}

export interface Executor {
  readonly type: string

  parseCatalog(): Promise<CatalogSystem>
  inspect(): Promise<ComponentState[]>
  inspectOne(component: string): Promise<ComponentState>
  deploy(
    component: string,
    desired: DesiredComponentState
  ): Promise<DeployResult>
  stop(component: string): Promise<void>
  scale(component: string, replicas: number): Promise<void>
  restart(component: string): Promise<void>
  runInit(initName: string): Promise<{ exitCode: number; output: string }>
  logs(component: string, opts?: LogOpts): Promise<string>
  run(component: string, cmd: string[]): Promise<RunResult>
  healthCheck(component: string): Promise<HealthStatus>
  healthCheckAll(): Promise<Record<string, HealthStatus>>
}
