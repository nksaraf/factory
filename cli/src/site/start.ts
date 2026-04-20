/**
 * Site controller startup — wires together executor, factory link,
 * health monitor, state store, and HTTP server into a running controller.
 */
import { join } from "node:path"

import { readConfig, resolveFactoryUrl } from "../config.js"
import { SiteManager } from "../lib/site-manager.js"
import { type ControllerMode, SiteController } from "./controller.js"
import { detectExecutor, formatExecutorTypeLabel } from "./execution/detect.js"
import { FactoryLink } from "./factory-link.js"
import { HealthMonitor } from "./health.js"
import { StateStore } from "./state.js"

export interface StartOptions {
  siteName?: string
  standalone?: boolean
  airGapped?: boolean
  port: number
  reconcileIntervalMs: number
  workingDir: string
}

interface SiteIdentity {
  slug: string
  type?: string
}

function loadSiteIdentity(workingDir: string, cliName?: string): SiteIdentity {
  const site = SiteManager.load(workingDir)
  if (site) {
    const state = site.getState()
    return { slug: state.spec.site.slug, type: state.spec.site.type }
  }

  if (cliName) {
    return { slug: cliName }
  }

  throw new Error(
    "No site identity found. Run `dx setup --role site` first, or pass --name."
  )
}

/**
 * @deprecated Use agent-daemon.ts instead. This function is kept
 * for backward compatibility.
 */
export async function startSiteController(opts: StartOptions): Promise<void> {
  console.warn(
    "startSiteController is deprecated. Use `dx site start` (agent daemon) instead."
  )
  // Fall through to legacy behavior for backward compat
  const identity = loadSiteIdentity(opts.workingDir, opts.siteName)
  const siteName = identity.slug

  console.log(`Starting site controller: ${siteName}`)
  console.log(`  Working directory: ${opts.workingDir}`)

  const { type: executorType, executor } = await detectExecutor(opts.workingDir)
  console.log(`  Executor: ${formatExecutorTypeLabel(executorType)}`)

  let mode: ControllerMode = "connected"
  let factoryLink: FactoryLink | null = null

  if (opts.standalone) {
    mode = "standalone"
  } else if (opts.airGapped) {
    mode = "air-gapped"
  } else {
    const config = await readConfig()
    const factoryUrl = resolveFactoryUrl(config)
    if (factoryUrl) {
      factoryLink = new FactoryLink({ factoryUrl, siteName })
    } else {
      mode = "standalone"
    }
  }

  const stateDir = join(opts.workingDir, ".dx")
  const state = new StateStore(stateDir)
  const healthMonitor = new HealthMonitor(
    executor,
    { intervalMs: 15_000 },
    (s) => {
      if (s.overallStatus !== "healthy")
        console.warn(`Health: ${s.overallStatus}`)
    }
  )

  const controller = new SiteController(
    {
      siteName,
      mode,
      reconcileIntervalMs: opts.reconcileIntervalMs,
      workingDir: opts.workingDir,
    },
    executor,
    factoryLink,
    healthMonitor,
    state
  )

  // Use the unified agent server instead of the old controller server
  const { SiteAgent } = await import("./agent.js")
  const { createAgentServer } = await import("./agent-server.js")
  const { writeAgentState, clearAgentState } =
    await import("./agent-lifecycle.js")

  const agent = new SiteAgent({
    config: {
      mode: "controller",
      port: opts.port,
      workingDir: opts.workingDir,
    },
    executor,
    controller,
    healthMonitor,
  })

  const agentServer = createAgentServer(agent, { port: opts.port })
  const serverInfo = await agentServer.start()
  agent.setServerHandle(agentServer)

  writeAgentState(opts.workingDir, {
    pid: process.pid,
    port: serverInfo.port,
    mode: "controller",
    startedAt: new Date().toISOString(),
    workingDir: opts.workingDir,
  })

  const stopLoop = controller.startLoop()

  console.log(
    `Site agent running (PID ${process.pid}, port ${serverInfo.port})`
  )

  const shutdown = () => {
    stopLoop()
    agentServer.stop()
    clearAgentState(opts.workingDir)
    process.exit(0)
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  await new Promise(() => {})
}
