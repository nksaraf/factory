import type { Database } from "../db/connection";

export interface ReconcileContext {
  workload: {
    workloadId: string;
    desiredImage: string;
    desiredArtifactUri?: string | null;
    replicas: number;
    envOverrides: Record<string, unknown>;
    resourceOverrides: Record<string, unknown>;
    moduleVersionId: string;
  };
  component: {
    name: string;
    kind: string;
    ports: Array<{ name: string; port: number; protocol: string }>;
    healthcheck?: { path: string; portName: string; protocol: string } | null;
    isPublic: boolean;
    stateful: boolean;
    defaultCpu: string;
    defaultMemory: string;
    defaultReplicas: number;
  };
  target: {
    deploymentTargetId: string;
    name: string;
    kind: string;
    runtime: string;
    clusterId?: string | null;
    hostId?: string | null;
    vmId?: string | null;
    namespace?: string | null;
  };
  moduleName: string;
}

export interface ReconcileResult {
  status: "running" | "completed" | "failed";
  actualImage?: string | null;
  driftDetected: boolean;
  details?: Record<string, unknown>;
}

export interface RuntimeStrategy {
  readonly runtime: string;
  reconcile(ctx: ReconcileContext, db: Database): Promise<ReconcileResult>;
}

export type RuntimeType = "kubernetes" | "compose" | "systemd" | "windows_service" | "iis" | "process";

const strategies: Partial<Record<RuntimeType, () => RuntimeStrategy>> = {};

export function registerRuntimeStrategy(runtime: RuntimeType, factory: () => RuntimeStrategy): void {
  strategies[runtime] = factory;
}

export function getRuntimeStrategy(runtime: string): RuntimeStrategy {
  const factory = strategies[runtime as RuntimeType];
  if (!factory) {
    throw new Error(
      `No strategy for runtime: ${runtime}. Supported: ${Object.keys(strategies).join(", ")}`
    );
  }
  return factory();
}

/** Clear all registered strategies — for test isolation only */
export function clearRuntimeStrategies(): void {
  for (const key of Object.keys(strategies)) {
    delete strategies[key as RuntimeType];
  }
}
