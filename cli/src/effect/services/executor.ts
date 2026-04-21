import { Context, Effect, Stream } from "effect"
import type { CatalogSystem } from "@smp/factory-shared/catalog"
import type { ProbeConfig } from "@smp/factory-shared"
import type {
  ExecutorError,
  ComponentNotFoundError,
  FinalizerTimeoutError,
  ProbeFailedError,
} from "../errors/site.js"

export type {
  ComponentState,
  DesiredComponentState,
  DeployResult,
  RunResult,
  HealthStatus,
  LogOpts,
} from "../../site/execution/executor.js"

import type {
  ComponentState,
  DesiredComponentState,
  DeployResult,
  RunResult,
  HealthStatus,
  LogOpts,
} from "../../site/execution/executor.js"

export interface ProbeResult {
  readonly success: boolean
  readonly message?: string
  readonly latencyMs: number
}

export interface ExecutorService {
  readonly type: string
  readonly parseCatalog: Effect.Effect<CatalogSystem, ExecutorError>
  readonly inspect: Effect.Effect<ComponentState[], ExecutorError>
  readonly inspectOne: (
    component: string
  ) => Effect.Effect<ComponentState, ExecutorError | ComponentNotFoundError>
  readonly deploy: (
    component: string,
    desired: DesiredComponentState
  ) => Effect.Effect<DeployResult, ExecutorError>
  readonly stop: (
    component: string,
    opts?: { finalizers?: boolean }
  ) => Effect.Effect<void, ExecutorError | FinalizerTimeoutError>
  readonly scale: (
    component: string,
    replicas: number
  ) => Effect.Effect<void, ExecutorError>
  readonly restart: (component: string) => Effect.Effect<void, ExecutorError>
  readonly runInit: (
    initName: string
  ) => Effect.Effect<{ exitCode: number; output: string }, ExecutorError>
  readonly logs: (
    component: string,
    opts?: LogOpts
  ) => Effect.Effect<string, ExecutorError>
  readonly logStream: (
    component: string,
    opts?: LogOpts
  ) => Stream.Stream<string, ExecutorError>
  readonly run: (
    component: string,
    cmd: string[]
  ) => Effect.Effect<RunResult, ExecutorError>
  readonly healthCheck: (
    component: string
  ) => Effect.Effect<HealthStatus, ExecutorError>
  readonly healthCheckAll: Effect.Effect<
    Record<string, HealthStatus>,
    ExecutorError
  >
  readonly runProbe: (
    component: string,
    probe: ProbeConfig
  ) => Effect.Effect<ProbeResult, ProbeFailedError>
}

export class ExecutorTag extends Context.Tag("Executor")<
  ExecutorTag,
  ExecutorService
>() {}
