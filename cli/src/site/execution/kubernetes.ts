/**
 * Kubernetes executor — stub for future multi-node support.
 *
 * Will wrap the existing KubeClientImpl from the API layer when
 * Kubernetes site deployments are needed.
 */
import type { CatalogSystem } from "@smp/factory-shared/catalog"

import type {
  ComponentState,
  DeployResult,
  DesiredComponentState,
  Executor,
  HealthStatus,
  LogOpts,
  RunResult,
} from "./executor.js"

export class KubernetesExecutor implements Executor {
  readonly type = "kubernetes"

  async parseCatalog(): Promise<CatalogSystem> {
    throw new Error("Kubernetes executor not yet implemented")
  }

  async inspect(): Promise<ComponentState[]> {
    throw new Error("Kubernetes executor not yet implemented")
  }

  async inspectOne(_component: string): Promise<ComponentState> {
    throw new Error("Kubernetes executor not yet implemented")
  }

  async deploy(
    _component: string,
    _desired: DesiredComponentState
  ): Promise<DeployResult> {
    throw new Error("Kubernetes executor not yet implemented")
  }

  async stop(_component: string): Promise<void> {
    throw new Error("Kubernetes executor not yet implemented")
  }

  async scale(_component: string, _replicas: number): Promise<void> {
    throw new Error("Kubernetes executor not yet implemented")
  }

  async restart(_component: string): Promise<void> {
    throw new Error("Kubernetes executor not yet implemented")
  }

  async runInit(
    _initName: string
  ): Promise<{ exitCode: number; output: string }> {
    throw new Error("Kubernetes executor not yet implemented")
  }

  async logs(_component: string, _opts?: LogOpts): Promise<string> {
    throw new Error("Kubernetes executor not yet implemented")
  }

  async run(_component: string, _cmd: string[]): Promise<RunResult> {
    throw new Error("Kubernetes executor not yet implemented")
  }

  async healthCheck(_component: string): Promise<HealthStatus> {
    throw new Error("Kubernetes executor not yet implemented")
  }

  async healthCheckAll(): Promise<Record<string, HealthStatus>> {
    throw new Error("Kubernetes executor not yet implemented")
  }
}
