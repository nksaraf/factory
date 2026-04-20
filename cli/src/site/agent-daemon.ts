/**
 * Site agent daemon — entry point for the background process.
 *
 * Usage: bun agent-daemon.ts <config-path>
 *    or: dx __agent <config-path>
 *
 * Reads session config from the JSON file, creates a SiteAgent,
 * starts the unified HTTP server, runs the session, writes agent
 * state, and blocks forever.
 */
import { readFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"

import { SiteAgent, type AgentMode } from "./agent.js"
import { createAgentServer } from "./agent-server.js"
import {
  writeAgentState,
  clearAgentState,
  type SpawnAgentOpts,
} from "./agent-lifecycle.js"

async function main() {
  const configPath = process.argv[2]
  if (!configPath) {
    console.error("Usage: agent-daemon <config-path>")
    process.exit(1)
  }

  const opts: SpawnAgentOpts = JSON.parse(readFileSync(configPath, "utf-8"))
  const { mode, workingDir, port } = opts

  console.log(`[agent] Starting in ${mode} mode (PID ${process.pid})`)
  console.log(`[agent] Working directory: ${workingDir}`)

  let agent: SiteAgent

  if (mode === "dev" || mode === "up") {
    // ── Dev/Up mode: create SiteOrchestrator and run session ──────
    const { SiteOrchestrator } = await import("../lib/site-orchestrator.js")

    const orch = await SiteOrchestrator.create({
      quiet: false,
      mode: mode === "up" ? "up" : undefined,
    })

    agent = new SiteAgent({
      config: { mode, port, workingDir },
      executor: orch.executor,
      orchestrator: orch,
      factoryUrl: orch.ctx.host.factory.url,
    })

    // Start the unified HTTP server BEFORE the session so the
    // health endpoint is available for the parent to poll
    const server = createAgentServer(agent, { port })
    const serverInfo = await server.start()
    agent.setServerHandle(server)

    console.log(`[agent] API server: http://localhost:${serverInfo.port}`)
    console.log(`[agent] Web UI: http://localhost:${serverInfo.port}`)

    // Write agent state so the parent knows we're alive
    writeAgentState(workingDir, {
      pid: process.pid,
      port: serverInfo.port,
      mode,
      startedAt: new Date().toISOString(),
      workingDir,
    })

    // Now run the actual session (Docker containers, native processes, etc.)
    if (mode === "dev") {
      const conn = await orch.startDevSession({
        components: opts.components,
        connectTo: opts.connectTo,
        connect: opts.connect,
        profile: opts.profile,
        env: opts.env,
        dryRun: false,
        restart: false,
        noBuild: opts.noBuild ?? false,
        tunnel: opts.tunnel ?? false,
        exposeConsole: opts.exposeConsole ?? false,
        quiet: false,
      })
      if (conn && conn.ctx.remoteDeps.length > 0) {
        await orch.checkRemoteHealth(conn.ctx, false)
      }
    } else {
      await orch.startUpSession({
        targets: opts.targets,
        profiles: opts.profiles,
        noBuild: opts.noBuild ?? false,
        detach: true,
        quiet: false,
      })
    }

    console.log(`[agent] Session started successfully`)
  } else {
    // ── Controller mode: create SiteController ───────────────────
    const { readConfig, resolveFactoryUrl } = await import("../config.js")
    const { SiteManager } = await import("../lib/site-manager.js")
    const { detectExecutor } = await import("./execution/detect.js")
    const { SiteController } = await import("./controller.js")
    type ControllerMode = import("./controller.js").ControllerMode
    const { FactoryLink } = await import("./factory-link.js")
    const { HealthMonitor } = await import("./health.js")
    const { StateStore } = await import("./state.js")

    // Load site identity
    const site = SiteManager.load(workingDir)
    const siteName =
      opts.siteName ?? (site ? site.getState().spec.site.slug : undefined)
    if (!siteName) {
      throw new Error(
        "No site identity found. Run `dx setup --role site` first, or pass --name."
      )
    }

    const { executor } = await detectExecutor(workingDir)

    let controllerMode: ControllerMode = "connected"
    let factoryLink: InstanceType<typeof FactoryLink> | null = null
    let factoryUrl: string | null = null

    if (opts.standalone) {
      controllerMode = "standalone"
    } else if (opts.airGapped) {
      controllerMode = "air-gapped"
    } else {
      const config = await readConfig()
      factoryUrl = resolveFactoryUrl(config)
      if (factoryUrl) {
        factoryLink = new FactoryLink({ factoryUrl, siteName })
      } else {
        controllerMode = "standalone"
      }
    }

    const stateDir = join(workingDir, ".dx")
    const stateStore = new StateStore(stateDir)
    const healthMonitor = new HealthMonitor(
      executor,
      { intervalMs: 15_000 },
      (snapshot) => {
        if (snapshot.overallStatus !== "healthy") {
          console.warn(`[agent] Health degradation: ${snapshot.overallStatus}`)
        }
      }
    )

    const controller = new SiteController(
      {
        siteName,
        mode: controllerMode,
        reconcileIntervalMs: opts.reconcileIntervalMs ?? 30_000,
        workingDir,
      },
      executor,
      factoryLink,
      healthMonitor,
      stateStore
    )

    agent = new SiteAgent({
      config: { mode, port, workingDir },
      executor,
      controller,
      healthMonitor,
      factoryUrl,
    })

    const server = createAgentServer(agent, { port })
    const serverInfo = await server.start()
    agent.setServerHandle(server)

    console.log(`[agent] API server: http://localhost:${serverInfo.port}`)

    writeAgentState(workingDir, {
      pid: process.pid,
      port: serverInfo.port,
      mode,
      startedAt: new Date().toISOString(),
      workingDir,
    })

    // Start the reconcile loop
    const stopLoop = controller.startLoop()
    agent.onShutdown(stopLoop)

    console.log(`[agent] Controller running: ${siteName} (${controllerMode})`)
  }

  // ── Graceful shutdown ──────────────────────────────────────────────

  const shutdown = () => {
    console.log("[agent] Shutting down...")
    clearAgentState(workingDir)

    // Also clean up old controller.pid for backward compat
    try {
      unlinkSync(join(workingDir, ".dx", "controller.pid"))
    } catch {}

    agent.shutdown()
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  // Keep process alive
  await new Promise(() => {})
}

main().catch((err) => {
  console.error(`[agent] Fatal error: ${err}`)
  process.exit(1)
})
