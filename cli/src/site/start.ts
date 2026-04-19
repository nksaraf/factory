/**
 * Site controller startup — wires together executor, factory link,
 * health monitor, state store, and HTTP server into a running controller.
 */
import { unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { readConfig, resolveFactoryUrl } from "../config.js"
import { SiteManager } from "../lib/site-manager.js"
import { createControllerServer } from "./controller-server.js"
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

export async function startSiteController(opts: StartOptions): Promise<void> {
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
    console.log("  Mode: standalone (no Factory connection)")
  } else if (opts.airGapped) {
    mode = "air-gapped"
    console.log("  Mode: air-gapped (manifest from file only)")
  } else {
    const config = await readConfig()
    const factoryUrl = resolveFactoryUrl(config)
    if (factoryUrl) {
      factoryLink = new FactoryLink({ factoryUrl, siteName })
      console.log(`  Mode: connected → ${factoryUrl}`)
    } else {
      mode = "standalone"
      console.log("  Mode: standalone (no Factory URL configured)")
    }
  }

  const stateDir = join(opts.workingDir, ".dx")
  const state = new StateStore(stateDir)

  const healthMonitor = new HealthMonitor(
    executor,
    { intervalMs: 15_000 },
    (snapshot) => {
      if (snapshot.overallStatus !== "healthy") {
        console.warn(`Health degradation: ${snapshot.overallStatus}`)
      }
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

  const { start } = createControllerServer(controller, { port: opts.port })

  const server = await start()
  console.log(`  API server: http://0.0.0.0:${opts.port}`)

  const pidFile = join(stateDir, "controller.pid")
  writeFileSync(pidFile, String(process.pid))

  const stopLoop = controller.startLoop()
  console.log(`  Reconcile loop: every ${opts.reconcileIntervalMs / 1000}s`)
  console.log(
    `\nSite controller running (PID ${process.pid}). Press Ctrl+C to stop.\n`
  )

  const shutdown = () => {
    console.log("\nShutting down site controller...")
    stopLoop()
    server.stop()
    try {
      unlinkSync(pidFile)
    } catch {
      /* already removed */
    }
    process.exit(0)
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  await new Promise(() => {
    // keep process alive
  })
}
