import { Effect, Layer } from "effect"
import { SiteConfigTag, type SiteConfig } from "../services/site-config.js"
import { WorkspaceDiscoveryTag } from "../services/workspace-discovery.js"
import type { SpawnAgentOpts } from "../../site/agent-lifecycle.js"

export function SiteConfigFromDaemonOpts(opts: SpawnAgentOpts) {
  return Layer.effect(
    SiteConfigTag,
    Effect.gen(function* () {
      const discovery = yield* WorkspaceDiscoveryTag
      const workspace = yield* discovery.discover

      return SiteConfigTag.of({
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

export function SiteConfigFromValues(config: SiteConfig) {
  return Layer.succeed(SiteConfigTag, SiteConfigTag.of(config))
}
