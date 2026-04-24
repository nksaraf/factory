import { Effect, Layer } from "effect"
import { SiteConfig, type ISiteConfig } from "../services/site-config.js"
import { WorkspaceDiscovery } from "../services/workspace-discovery.js"
import type { SpawnAgentOpts } from "../../site/agent-lifecycle.js"

export function SiteConfigFromDaemonOpts(opts: SpawnAgentOpts) {
  return Layer.effect(
    SiteConfig,
    Effect.gen(function* () {
      const discovery = yield* WorkspaceDiscovery
      const workspace = yield* discovery.discover

      return SiteConfig.of({
        mode: opts.mode,
        workingDir: opts.workingDir,
        port: opts.port,
        focusSystem: workspace.focusSystem,
        siteName: opts.siteName,
        controllerMode: opts.standalone
          ? "standalone"
          : opts.airGapped
            ? "air-gapped"
            : "connected",
        reconcileIntervalMs: opts.reconcileIntervalMs ?? 30_000,
        connectionFlags: {
          connectTo: opts.connectTo,
          connect: opts.connect,
          profile: opts.profile,
          env: opts.env,
        },
        sessionFlags: {
          components: opts.components,
          noBuild: opts.noBuild,
          tunnel: opts.tunnel,
          exposeConsole: opts.exposeConsole,
          dryRun: false,
          restart: false,
          targets: opts.targets,
          profiles: opts.profiles,
          detach: opts.detach,
          quiet: false,
        },
      })
    })
  )
}

export function SiteConfigFromValues(config: ISiteConfig) {
  return Layer.succeed(SiteConfig, SiteConfig.of(config))
}
