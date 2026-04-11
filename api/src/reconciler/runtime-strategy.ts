import type { Database } from "../db/connection"

export interface ReconcileContext {
  workload: {
    workloadId: string
    desiredImage: string
    desiredArtifactUri?: string | null
    replicas: number
    envOverrides: Record<string, unknown>
    resourceOverrides: Record<string, unknown>
    moduleVersionId: string
  }
  component: {
    name: string
    kind: string
    ports: Array<{ name: string; port: number; protocol: string }>
    healthcheck?: { path: string; portName: string; protocol: string } | null
    isPublic: boolean
    stateful: boolean
    defaultCpu: string
    defaultMemory: string
    defaultReplicas: number
  }
  target: {
    systemDeploymentId: string
    name: string
    kind: string
    runtime: string
    clusterId?: string | null
    hostId?: string | null
    vmId?: string | null
    namespace?: string | null
  }
  moduleName: string
}

export interface ReconcileResult {
  status: "running" | "completed" | "failed"
  actualImage?: string | null
  driftDetected: boolean
  details?: Record<string, unknown>
}

export interface ReconcilerStrategy {
  readonly runtime: string
  reconcile(ctx: ReconcileContext, db: Database): Promise<ReconcileResult>
}

export type RuntimeType =
  | "kubernetes"
  | "compose"
  | "systemd"
  | "windows_service"
  | "iis"
  | "process"

const strategies: Partial<Record<RuntimeType, () => ReconcilerStrategy>> = {}

export function registerReconcilerStrategy(
  runtime: RuntimeType,
  factory: () => ReconcilerStrategy
): void {
  strategies[runtime] = factory
}

export function getReconcilerStrategy(runtime: string): ReconcilerStrategy {
  const factory = strategies[runtime as RuntimeType]
  if (!factory) {
    throw new Error(
      `No strategy for runtime: ${runtime}. Supported: ${Object.keys(strategies).join(", ")}`
    )
  }
  return factory()
}

/** Clear all registered strategies — for test isolation only */
export function clearReconcilerStrategies(): void {
  for (const key of Object.keys(strategies)) {
    delete strategies[key as RuntimeType]
  }
}
