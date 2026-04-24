import { Effect, Layer } from "effect"
import type { SpawnAgentOpts } from "../site/agent-lifecycle.js"

import { WorkspaceDiscoveryLive } from "./layers/workspace-discovery.js"
import { SiteConfigFromDaemonOpts } from "./layers/site-config.js"
import { SiteStateLive } from "./layers/site-state.js"
import { ControllerStateStoreLive } from "./layers/controller-state-store.js"
import { AgentStateStoreLive } from "./layers/agent-state-store.js"
import { DockerComposeOpsLive } from "./layers/docker-compose-ops.js"
import {
  DockerComposeExecutorLive,
  DockerComposeExecutor,
} from "./layers/executor/docker-compose.js"
import { DevProcessExecutorLive } from "./layers/executor/dev-process.js"
import { RoutingExecutorLive } from "./layers/executor/routing.js"
import { Executor } from "./services/executor.js"
import { SiteReconcilerLive } from "./layers/site-reconciler.js"
import { HealthMonitorLive } from "./layers/health-monitor.js"
import {
  FactoryControlPlaneLinkLive,
  ControlPlaneLinkNoop,
} from "./layers/control-plane-link.js"
import { NoopGatewayReconcilerLive } from "./layers/gateway-reconciler.js"
import { DependencyConnectorLive } from "./layers/dependency-connector.js"
import { CrossSystemLinkerLive } from "./layers/cross-system-linker.js"
import { TunnelManagerLive } from "./layers/tunnel-manager.js"
import { BuildCacheLive } from "./layers/build-cache.js"
import { AgentServerLive } from "./layers/agent-server.js"
import { WorkbenchRpcServerLive } from "./layers/workbench-rpc.js"

/**
 * Single layer factory for all modes (dev, up, controller).
 *
 * The mode determines which services are wired:
 * - Dev: RoutingExecutor (native + container), connection services, tunnel
 * - Up: DockerComposeExecutor only (all containers)
 * - Controller: DockerComposeExecutor + control plane + reconciler state store
 *
 * All modes get: SiteConfig, SiteState, Reconciler, HealthMonitor, AgentServer.
 */
export function createSiteLayer(opts: SpawnAgentOpts) {
  const mode = opts.mode

  // Config — always
  const config = SiteConfigFromDaemonOpts(opts).pipe(
    Layer.provide(WorkspaceDiscoveryLive)
  )

  // State — always
  const state = SiteStateLive.pipe(Layer.provide(config))

  // Compose ops — always (might be noop if no compose files)
  const composeOps = DockerComposeOpsLive.pipe(Layer.provide(config))

  // Executor — mode determines which layers
  const composeExec = DockerComposeExecutorLive.pipe(Layer.provide(config))

  // In dev mode: RoutingExecutor (routes native vs container) provides Executor
  // In up/controller: DockerComposeExecutor aliased as Executor
  const executor =
    mode === "dev"
      ? (() => {
          const devExec = DevProcessExecutorLive.pipe(
            Layer.provide(Layer.merge(config, state))
          )
          return RoutingExecutorLive.pipe(
            Layer.provide(Layer.merge(Layer.merge(state, composeExec), devExec))
          )
        })()
      : Layer.effect(
          Executor,
          Effect.map(DockerComposeExecutor, (exec) => exec)
        ).pipe(Layer.provide(composeExec))

  // Controller state — needed by reconciler in all modes (stores manifest)
  const controllerState = ControllerStateStoreLive.pipe(Layer.provide(config))

  // Control plane — connected or noop
  const controlPlane =
    opts.standalone || opts.airGapped
      ? ControlPlaneLinkNoop
      : FactoryControlPlaneLinkLive.pipe(Layer.provide(config))

  // Reconciler — always (runs in all modes)
  const reconciler = SiteReconcilerLive.pipe(
    Layer.provide(Layer.mergeAll(config, executor, state, controllerState))
  )

  // Health — always
  const healthMonitor = HealthMonitorLive.pipe(Layer.provide(executor))

  // Connection services — available in all modes but only used by dev
  const connResolver = DependencyConnectorLive.pipe(
    Layer.provide(Layer.merge(Layer.merge(config, state), composeOps))
  )
  const crossLinker = CrossSystemLinkerLive.pipe(
    Layer.provide(Layer.merge(config, state))
  )

  // Other services
  const tunnelManager = TunnelManagerLive
  const buildCache = BuildCacheLive.pipe(Layer.provide(config))
  const agentServer = AgentServerLive.pipe(Layer.provide(config))
  const agentState = AgentStateStoreLive.pipe(Layer.provide(config))
  const gateway = NoopGatewayReconcilerLive

  const core = Layer.mergeAll(
    config,
    state,
    controllerState,
    agentState,
    executor,
    composeOps,
    controlPlane,
    gateway,
    reconciler
  )

  const rpcPort = opts.port ? opts.port + 1 : 4401
  const workbenchRpc = WorkbenchRpcServerLive(rpcPort).pipe(
    Layer.provide(
      Layer.mergeAll(config, state, executor, healthMonitor, reconciler)
    )
  )

  const services = Layer.mergeAll(
    healthMonitor,
    connResolver,
    crossLinker,
    tunnelManager,
    buildCache,
    agentServer,
    workbenchRpc
  )

  return Layer.merge(core, services)
}
