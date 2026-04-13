/**
 * DevOrchestrator — interactive site lifecycle management.
 *
 * Writes desired state to site.json, then reconciles (one-shot).
 * Same entity model and reconcile logic as SiteController, but
 * human-driven instead of Factory-driven.
 *
 * Dev is a site. The only difference is the control loop.
 */
import {
  type DerivedOverride,
  buildConnectionEndpoints,
  deriveServiceEnvOverrides,
  expandRemoteDeps,
} from "@smp/factory-shared/compose-env-propagation"
import type {
  NormalizedProfileEntry,
  ResolvedConnectionContext,
} from "@smp/factory-shared/connection-context-schemas"
import { normalizeProfileEntry } from "@smp/factory-shared/connection-context-schemas"
import { loadConnectionProfile } from "@smp/factory-shared/connection-profile-loader"
import { isDevComponent } from "@smp/factory-shared"
import type { ResolvedEnvEntryLocal } from "@smp/factory-shared"
import { DependencyGraph } from "@smp/factory-shared/dependency-graph"
import { resolveEnvVars } from "@smp/factory-shared/env-resolution"
import { existsSync, unlinkSync, writeFileSync } from "node:fs"
import { createConnection } from "node:net"
import { hostname } from "node:os"
import { basename, join } from "node:path"

import {
  styleBold,
  styleMuted,
  styleInfo,
  styleSuccess,
  styleWarn,
} from "../cli-style.js"
import {
  type BuildCheckResult,
  checkBuildStatus,
  recordBuild,
} from "./build-cache.js"
import type { UnifiedServiceStatus } from "../handlers/context-status.js"
import {
  COMPOSE_OVERRIDE_FILE,
  cleanupConnectionContext,
} from "./connection-context-file.js"
import { Compose, isDockerRunning } from "./docker.js"
import { type ProjectContextData, resolveDxContext } from "./dx-context.js"
import {
  mergeConnectionSources,
  parseConnectFlags,
  parseConnectToFlag,
  parseEnvFlags,
} from "./parse-connect-flags.js"
import {
  PortManager,
  catalogToPortRequests,
  portEnvVars,
} from "./port-manager.js"
import { SiteManager } from "./site-manager.js"
import { ComposeExecutor } from "../site/execution/compose.js"
import { CompositeExecutor } from "../site/execution/composite.js"
import { NativeExecutor } from "../site/execution/native.js"
import { killProcessTree } from "../site/execution/native.js"
import { openTunnel, type TunnelInfo } from "./tunnel-client.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DevSessionOpts {
  components?: string[]
  connectTo?: string
  connect?: string | string[]
  profile?: string
  env?: string | string[]
  dryRun?: boolean
  restart?: boolean
  noBuild?: boolean
  tunnel?: boolean
  quiet?: boolean
}

export interface ConnectionResult {
  ctx: ResolvedConnectionContext
  env: Record<string, string>
  profileName: string
  remoteDeps: string[]
  derivedOverrides: DerivedOverride[]
}

export interface StartResult {
  name: string
  pid: number
  port: number
  alreadyRunning: boolean
  stoppedDocker: boolean
}

// ---------------------------------------------------------------------------
// DevOrchestrator
// ---------------------------------------------------------------------------

export class DevOrchestrator {
  private readonly portManager: PortManager
  private readonly compose: Compose | null
  private readonly graph: DependencyGraph
  private readonly executor: CompositeExecutor
  private tunnelHandle?: { close: () => void }

  private constructor(
    readonly project: ProjectContextData,
    readonly site: SiteManager,
    readonly sdSlug: string,
    private readonly opts: { quiet?: boolean } = {}
  ) {
    this.portManager = new PortManager(join(project.rootDir, ".dx"))
    this.compose =
      project.composeFiles.length > 0
        ? new Compose(project.composeFiles, basename(project.rootDir))
        : null
    this.graph = DependencyGraph.fromCatalog(project.catalog)

    // Build composite executor
    const composeExec = new ComposeExecutor({
      composeFiles: project.composeFiles,
      projectName: basename(project.rootDir),
      cwd: project.rootDir,
    })
    const nativeExec = new NativeExecutor({
      rootDir: project.rootDir,
      catalog: project.catalog,
      site,
      sdSlug,
    })
    this.executor = new CompositeExecutor(composeExec, nativeExec, site, sdSlug)
  }

  // ------------------------------------------------------------------
  // Factory
  // ------------------------------------------------------------------

  static async create(opts?: { quiet?: boolean }): Promise<DevOrchestrator> {
    const ctx = await resolveDxContext({ need: "project" })
    const project = ctx.project
    const workbenchSlug =
      ctx.workbench?.name ?? hostname().replace(/\.local$/, "")
    const workbenchType = ctx.workbench?.kind ?? "worktree"

    const sdSlug = `${project.name}-dev`

    const existing = SiteManager.load(project.rootDir)
    let site: SiteManager
    if (existing) {
      site = existing
      site.ensureSystemDeployment(
        sdSlug,
        project.name,
        "docker-compose",
        project.composeFiles
      )
    } else {
      site = SiteManager.init(
        project.rootDir,
        { slug: `${workbenchSlug}-dev`, type: "development" },
        {
          slug: workbenchSlug,
          type: workbenchType,
          ownerType: "user" as const,
        }
      )
      site.ensureSystemDeployment(
        sdSlug,
        project.name,
        "docker-compose",
        project.composeFiles
      )
    }

    return new DevOrchestrator(project, site, sdSlug, opts)
  }

  // ------------------------------------------------------------------
  // Port resolution (shared with dx up)
  // ------------------------------------------------------------------

  async resolvePorts(): Promise<{
    envPath: string
    allEnvVars: Record<string, string>
  }> {
    const portRequests = catalogToPortRequests(this.project.catalog)
    const resolved = await this.portManager.resolveMulti(portRequests)

    const allEnvVars: Record<string, string> = {}
    for (const [service, ports] of Object.entries(resolved)) {
      Object.assign(allEnvVars, portEnvVars(service, ports))
    }
    const envPath = join(this.project.rootDir, ".dx", "ports.env")
    this.portManager.writeEnvFile(allEnvVars, envPath)

    return { envPath, allEnvVars }
  }

  // ------------------------------------------------------------------
  // Connection resolution
  // ------------------------------------------------------------------

  resolveConnections(flags: {
    connectTo?: string
    connect?: string | string[]
    profile?: string
    env?: string | string[]
  }): ConnectionResult | null {
    const hasConnectionFlags = flags.connectTo || flags.connect || flags.profile

    if (!hasConnectionFlags) return null

    const profileName = flags.connectTo ?? flags.profile ?? "remote"

    const profile =
      profileName !== "remote"
        ? loadConnectionProfile(this.project.rootDir, profileName)
        : null

    const profileEnv = profile?.env ?? {}

    let profileOverrides: Record<string, NormalizedProfileEntry> | undefined
    if (profile && Object.keys(profile.connect).length > 0) {
      profileOverrides = {}
      for (const [key, entry] of Object.entries(profile.connect)) {
        profileOverrides[key] = normalizeProfileEntry(entry)
      }
    }

    const connectToOverrides = flags.connectTo
      ? parseConnectToFlag(flags.connectTo, this.project.catalog)
      : undefined

    const connectFlags = flags.connect
      ? parseConnectFlags(
          Array.isArray(flags.connect) ? flags.connect : [flags.connect]
        )
      : undefined

    const overrides = mergeConnectionSources(
      profileOverrides,
      connectToOverrides,
      connectFlags
    )

    const envFlags = flags.env
      ? parseEnvFlags(Array.isArray(flags.env) ? flags.env : [flags.env])
      : undefined

    const tierOverlay =
      Object.keys(profileEnv).length > 0 ? profileEnv : undefined

    const ctx = resolveEnvVars({
      catalog: this.project.catalog,
      tierOverlay,
      connectionOverrides: overrides,
      cliEnvFlags: envFlags,
    })

    const env = Object.fromEntries(
      Object.entries(ctx.envVars).map(([k, v]) => [k, v.value])
    )

    const endpoints = buildConnectionEndpoints(
      overrides ?? {},
      this.project.catalog
    )
    const explicitDeps = Object.keys(overrides ?? {}).filter((name) =>
      endpoints.has(name)
    )

    const remoteDeps = expandRemoteDeps(
      explicitDeps,
      this.graph,
      endpoints,
      profileName
    )

    const derivedOverrides = deriveServiceEnvOverrides(
      this.project.catalog,
      this.graph,
      remoteDeps,
      endpoints
    )

    return { ctx, env, profileName, remoteDeps, derivedOverrides }
  }

  // ------------------------------------------------------------------
  // Apply connections (stop remote, write override, update site state)
  // ------------------------------------------------------------------

  applyConnections(
    conn: ConnectionResult,
    envPath: string,
    dryRun: boolean
  ): string[] {
    const reconfiguredServices: string[] = []

    // Stop remote dep containers
    if (conn.remoteDeps.length > 0 && this.compose) {
      if (dryRun) {
        console.log(
          `  [dry-run] Would stop remote dep containers: ${conn.remoteDeps.join(", ")}`
        )
      } else {
        if (!this.opts.quiet) {
          console.log(
            `  Stopping remote dep containers: ${conn.remoteDeps.join(", ")}`
          )
        }
        this.compose.stop(conn.remoteDeps)
      }
    }

    // Write compose override and restart reconfigured services
    const overridesWithEnv = conn.derivedOverrides.filter(
      (d) => Object.keys(d.overrides).length > 0
    )
    reconfiguredServices.push(...overridesWithEnv.map((d) => d.service))

    if (overridesWithEnv.length > 0) {
      if (dryRun) {
        console.log(
          `  [dry-run] Would restart reconfigured Docker services: ${reconfiguredServices.join(", ")}`
        )
      } else {
        this.writeComposeOverride(overridesWithEnv)
        const overridePath = join(
          this.project.rootDir,
          ".dx",
          COMPOSE_OVERRIDE_FILE
        )
        const overrideCompose = new Compose(
          [...this.project.composeFiles, overridePath],
          basename(this.project.rootDir),
          envPath
        )
        overrideCompose.up({
          detach: true,
          noBuild: true,
          noDeps: conn.remoteDeps.length > 0,
          services: reconfiguredServices,
        })
      }
    }

    for (const d of conn.derivedOverrides) {
      for (const w of d.warnings) {
        console.log(`  \u26A0 ${w}`)
      }
    }

    if (!dryRun) {
      // Track remote deps as linked
      for (const dep of conn.remoteDeps) {
        this.site.setComponentMode(this.sdSlug, dep, "linked", {
          linkedRef: {
            site: conn.profileName,
            systemDeployment: conn.profileName,
            component: dep,
          },
        })
      }

      // Save resolved env + tunnels
      const siteEnv: Record<string, ResolvedEnvEntryLocal> = {}
      for (const [k, v] of Object.entries(conn.ctx.envVars)) {
        siteEnv[k] = {
          value: v.value,
          source: v.source,
          sourceDetail: v.sourceDetail,
        }
      }
      this.site.setResolvedEnv(this.sdSlug, siteEnv, conn.ctx.tunnels)
      this.site.save()
    }

    return reconfiguredServices
  }

  // ------------------------------------------------------------------
  // Restore local state (clean up stale connections)
  // ------------------------------------------------------------------

  restoreLocalState(envPath: string): void {
    const sd = this.site.getSystemDeployment(this.sdSlug)
    if (!sd) return

    const linkedDeps = sd.componentDeployments
      .filter((cd) => cd.mode === "linked")
      .map((cd) => cd.componentSlug)

    if (linkedDeps.length === 0) {
      cleanupConnectionContext(this.project.rootDir)
      return
    }

    if (!this.opts.quiet) {
      console.log("  Restoring local state from previous connection session...")
    }

    const overridePath = join(
      this.project.rootDir,
      ".dx",
      COMPOSE_OVERRIDE_FILE
    )
    if (existsSync(overridePath)) {
      unlinkSync(overridePath)
    }

    if (linkedDeps.length > 0) {
      const compose = new Compose(
        this.project.composeFiles,
        basename(this.project.rootDir),
        envPath
      )
      compose.up({
        detach: true,
        noBuild: true,
        services: linkedDeps,
      })

      for (const dep of linkedDeps) {
        this.site.setComponentMode(this.sdSlug, dep, "container")
      }

      if (!this.opts.quiet) {
        console.log(
          `  Restored ${linkedDeps.length} service(s) to local config: ${linkedDeps.join(", ")}`
        )
      }
    }

    this.site.setResolvedEnv(this.sdSlug, {}, [])
    this.site.save()
    cleanupConnectionContext(this.project.rootDir)
  }

  // ------------------------------------------------------------------
  // Start dev session (main orchestration)
  // ------------------------------------------------------------------

  async startDevSession(
    opts: DevSessionOpts
  ): Promise<ConnectionResult | null> {
    const dryRun = !!opts.dryRun

    // ── --restart shortcut ────────────────────────────────────
    if (opts.restart) {
      await this.restartDevServers(opts.components)
      return null
    }

    // ── Port resolution ───────────────────────────────────────
    const { envPath, allEnvVars } = dryRun
      ? { envPath: "", allEnvVars: {} }
      : await this.resolvePorts()

    // ── Restore stale connection state ────────────────────────
    const hasConnectionFlags = opts.connectTo || opts.connect || opts.profile
    if (!hasConnectionFlags && !dryRun) {
      this.restoreLocalState(envPath)
    }

    // ── Connection resolution ─────────────────────────────────
    let connectionEnv: Record<string, string> = {}
    let allRemoteDeps: string[] = []
    let conn: ConnectionResult | null = null

    if (hasConnectionFlags) {
      conn = this.resolveConnections({
        connectTo: opts.connectTo,
        connect: opts.connect,
        profile: opts.profile,
        env: opts.env,
      })

      if (conn) {
        connectionEnv = conn.env
        allRemoteDeps = conn.remoteDeps
        this.applyConnections(conn, envPath, dryRun)
      }
    }

    // ── Determine dev targets ─────────────────────────────────
    const devableComponents = Object.entries(this.project.catalog.components)
      .filter(([_, comp]) => isDevComponent(comp))
      .map(([name]) => name)

    const targets = opts.components?.length
      ? opts.components
      : devableComponents

    if (targets.length === 0) {
      console.log(
        "No dev-able components found. Add dx.dev.command labels to your docker-compose services."
      )
      return null
    }

    // ── Determine local Docker deps ───────────────────────────
    const devTargetSet = new Set(targets)
    const remoteDepSet = new Set(allRemoteDeps)

    const allNeeded = new Set<string>()
    for (const target of targets) {
      for (const dep of this.graph.transitiveDeps(target)) {
        allNeeded.add(dep)
      }
    }

    const localDockerDeps = [...allNeeded].filter(
      (name) => !devTargetSet.has(name) && !remoteDepSet.has(name)
    )

    // ── Build check ────────────────────────────────────────────
    const buildCheck = checkBuildStatus(
      this.project.rootDir,
      this.project.catalog,
      localDockerDeps
    )
    const skipBuild = opts.noBuild || buildCheck.needsBuild.length === 0

    // ── Dry run ───────────────────────────────────────────────
    if (dryRun) {
      this.printPlan(
        targets,
        localDockerDeps,
        allRemoteDeps,
        buildCheck,
        !!opts.noBuild,
        !!opts.tunnel
      )
      return null
    }

    // ── Set desired state in site.json ────────────────────────
    const workbenchSlug = hostname().replace(/\.local$/, "")
    for (const target of targets) {
      this.site.setComponentMode(this.sdSlug, target, "native", {
        workbenchSlug,
      })
      this.site.bumpGeneration(this.sdSlug, target)
    }
    for (const dep of localDockerDeps) {
      this.site.setComponentMode(this.sdSlug, dep, "container")
    }

    // ── Start local Docker deps ───────────────────────────────
    if (localDockerDeps.length > 0 && this.compose) {
      if (!isDockerRunning()) {
        throw new Error(
          "Docker is not running. Start Docker for infrastructure dependencies."
        )
      }
      if (!this.opts.quiet) {
        if (skipBuild) {
          const reason = opts.noBuild ? "(--no-build)" : "(no source changes)"
          console.log(
            `  Starting Docker deps ${styleMuted(reason)}: ${localDockerDeps.join(", ")}`
          )
        } else {
          console.log(
            `  Building + starting Docker deps: ${buildCheck.needsBuild.join(", ")}`
          )
        }
      }
      this.compose.up({
        detach: true,
        services: localDockerDeps,
        noBuild: skipBuild,
        noDeps: remoteDepSet.size > 0,
      })
      // Record build hashes for services that were built
      if (!skipBuild) {
        recordBuild(
          this.project.rootDir,
          this.project.catalog,
          buildCheck.needsBuild
        )
      }
    }

    // ── Start native dev servers via executor ─────────────────
    for (const component of targets) {
      try {
        const sd = this.site.getSystemDeployment(this.sdSlug)
        const cd = sd?.componentDeployments.find(
          (c) => c.componentSlug === component
        )
        const envOverrides = {
          ...cd?.spec.envOverrides,
          ...(Object.keys(connectionEnv).length > 0 ? connectionEnv : {}),
        }

        await this.executor.deploy(component, {
          image: "",
          replicas: 1,
          envOverrides,
          resourceOverrides: {},
        })

        const state = await this.executor.inspectOne(component)
        const cdAfter = sd?.componentDeployments.find(
          (c) => c.componentSlug === component
        )
        const port = cdAfter?.status.port
        const pid = cdAfter?.status.pid

        if (state.status === "running") {
          console.log(
            `Started ${component} on :${port ?? "?"} (PID ${pid ?? "?"})`
          )
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`Error starting ${component}: ${msg}`)
      }
    }

    // ── Open tunnel if requested ──────────────────────────────
    if (opts.tunnel) {
      await this.openTunnel(workbenchSlug)
    }

    this.site.save()
    return conn
  }

  // ------------------------------------------------------------------
  // Tunnel
  // ------------------------------------------------------------------

  private async openTunnel(workbenchSlug: string): Promise<void> {
    const sd = this.site.getSystemDeployment(this.sdSlug)
    const catalog = this.project.catalog
    const exposedPorts: number[] = []
    for (const cd of sd?.componentDeployments ?? []) {
      const port = cd.status.port
      if (!port) continue
      const entity =
        catalog.components[cd.componentSlug] ??
        catalog.resources[cd.componentSlug]
      const hasPublicPort = entity?.spec.ports?.some(
        (p) => p.port === port && p.exposure === "public"
      )
      if (hasPublicPort) exposedPorts.push(port)
    }

    if (exposedPorts.length === 0) {
      console.log(
        "  No public ports to tunnel. Mark ports with dx.port.<port>.exposure: public"
      )
      return
    }

    try {
      this.tunnelHandle = await openTunnel(
        {
          port: exposedPorts[0]!,
          subdomain: workbenchSlug,
          routeFamily: "dev",
          publishPorts: exposedPorts,
        },
        {
          onRegistered: (info: TunnelInfo) => {
            console.log("")
            console.log(`  ${styleSuccess("Tunnel active")}`)
            if (info.portUrls?.length) {
              for (const pu of info.portUrls) {
                console.log(
                  `    :${pu.port} ${styleMuted("→")} ${styleInfo(pu.url)}`
                )
              }
            } else {
              console.log(`    ${styleInfo(info.url)}`)
            }
            console.log("")
          },
          onReconnecting: (attempt, delayMs) => {
            if (!this.opts.quiet) {
              console.log(
                `  Tunnel reconnecting (attempt ${attempt}, ${Math.round(delayMs / 1000)}s)...`
              )
            }
          },
          onReconnected: (info: TunnelInfo) => {
            if (!this.opts.quiet) {
              console.log(`  Tunnel reconnected: ${info.url}`)
            }
          },
          onError: (err: Error) => {
            console.error(`  Tunnel error: ${err.message}`)
          },
          onClose: () => {},
        }
      )
      const cleanup = () => {
        this.tunnelHandle?.close()
        this.tunnelHandle = undefined
      }
      process.on("SIGINT", cleanup)
      process.on("SIGTERM", cleanup)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  Failed to open tunnel: ${msg}`)
    }
  }

  // ------------------------------------------------------------------
  // Restart dev servers (--restart flag)
  // ------------------------------------------------------------------

  async restartDevServers(components?: string[]): Promise<void> {
    const devableComponents = Object.entries(this.project.catalog.components)
      .filter(([_, comp]) => isDevComponent(comp))
      .map(([name]) => name)

    const targets = components?.length ? components : devableComponents

    if (targets.length === 0) {
      console.log("No dev-able components found.")
      return
    }

    // Read env from site state
    const sd = this.site.getSystemDeployment(this.sdSlug)
    const resolvedEnv = sd?.resolvedEnv ?? {}
    const env =
      Object.keys(resolvedEnv).length > 0
        ? Object.fromEntries(
            Object.entries(resolvedEnv).map(([k, v]) => [k, v.value])
          )
        : {}

    for (const component of targets) {
      try {
        await this.executor.stop(component)
        await this.executor.deploy(component, {
          image: "",
          replicas: 1,
          envOverrides: env,
          resourceOverrides: {},
        })

        const cdAfter = sd?.componentDeployments.find(
          (c) => c.componentSlug === component
        )
        console.log(
          `Restarted ${component} on :${cdAfter?.status.port ?? "?"} (PID ${cdAfter?.status.pid ?? "?"})`
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`Error restarting ${component}: ${msg}`)
      }
    }
  }

  // ------------------------------------------------------------------
  // Stop
  // ------------------------------------------------------------------

  stop(component?: string): { name: string; pid: number }[] {
    this.tunnelHandle?.close()
    this.tunnelHandle = undefined

    const stopped: { name: string; pid: number }[] = []
    const sd = this.site.getSystemDeployment(this.sdSlug)
    if (!sd) return stopped

    const targets = component
      ? sd.componentDeployments.filter(
          (cd) => cd.componentSlug === component && cd.mode === "native"
        )
      : sd.componentDeployments.filter((cd) => cd.mode === "native")

    for (const cd of targets) {
      const pid = cd.status.pid
      if (pid != null) {
        killProcessTree(pid)
        stopped.push({ name: cd.componentSlug, pid })
      }
      this.site.updateComponentStatus(this.sdSlug, cd.componentSlug, {
        pid: undefined,
        phase: "stopped",
      })
    }
    this.site.save()
    return stopped
  }

  // ------------------------------------------------------------------
  // Start single component
  // ------------------------------------------------------------------

  async startComponent(
    component: string,
    opts?: { port?: number; env?: Record<string, string> }
  ): Promise<StartResult> {
    // Check if already running
    const sd = this.site.getSystemDeployment(this.sdSlug)
    const cdBefore = sd?.componentDeployments.find(
      (c) => c.componentSlug === component
    )
    const existingPid = cdBefore?.status.pid
    if (existingPid != null) {
      try {
        process.kill(existingPid, 0)
        return {
          name: component,
          pid: existingPid,
          port: cdBefore?.status.port ?? 0,
          alreadyRunning: true,
          stoppedDocker: false,
        }
      } catch {
        // not running, continue
      }
    }

    // Stop Docker container if running
    let stoppedDocker = false
    if (this.compose?.isRunning(component)) {
      this.compose.stop([component])
      stoppedDocker = true
    }

    // Set mode and deploy
    this.site.setComponentMode(this.sdSlug, component, "native", {
      workbenchSlug: hostname().replace(/\.local$/, ""),
    })

    await this.executor.deploy(component, {
      image: "",
      replicas: 1,
      envOverrides: opts?.env ?? {},
      resourceOverrides: {},
    })

    const cdAfter = sd?.componentDeployments.find(
      (c) => c.componentSlug === component
    )

    return {
      name: component,
      pid: cdAfter?.status.pid ?? 0,
      port: cdAfter?.status.port ?? 0,
      alreadyRunning: false,
      stoppedDocker,
    }
  }

  // ------------------------------------------------------------------
  // PS (unified service listing)
  // ------------------------------------------------------------------

  async getUnifiedServices(): Promise<UnifiedServiceStatus[]> {
    const states = await this.executor.inspect()
    return states.map((s) => {
      const mode = this.site.getComponentMode(this.sdSlug, s.name)
      return {
        name: s.name,
        runtime: mode === "native" ? ("dev" as const) : ("docker" as const),
        status: s.status,
        ports: s.ports.map((p) => `:${p.host}`).join(", "),
        pid:
          mode === "native"
            ? (this.site
                .getSystemDeployment(this.sdSlug)
                ?.componentDeployments.find((c) => c.componentSlug === s.name)
                ?.status.pid ?? undefined)
            : undefined,
      }
    })
  }

  // ------------------------------------------------------------------
  // Logs
  // ------------------------------------------------------------------

  async logs(component: string): Promise<string> {
    return this.executor.logs(component)
  }

  // ------------------------------------------------------------------
  // Restart single component
  // ------------------------------------------------------------------

  async restartComponent(component: string): Promise<StartResult> {
    this.stop(component)
    return this.startComponent(component)
  }

  // ------------------------------------------------------------------
  // Health check
  // ------------------------------------------------------------------

  async checkRemoteHealth(
    ctx: ResolvedConnectionContext,
    quiet: boolean
  ): Promise<void> {
    const targets: { label: string; host: string; port: number }[] = []

    for (const [key, entry] of Object.entries(ctx.envVars)) {
      if (entry.source !== "connection" && entry.source !== "tier") continue

      const pgMatch = entry.value.match(/@([^:/]+):(\d+)/)
      const httpMatch = entry.value.match(/\/\/([^:/]+):(\d+)/)
      const match = pgMatch ?? httpMatch
      if (!match) continue

      const host = match[1]!
      const port = parseInt(match[2]!, 10)
      const already = targets.some((t) => t.host === host && t.port === port)
      if (!already) {
        targets.push({ label: key, host, port })
      }
    }

    if (targets.length === 0) return
    if (!quiet) console.log("  Checking remote connectivity...")

    for (const { label, host, port } of targets) {
      const ok = await tcpCheck(host, port, 3000)
      if (!quiet) {
        const status = ok ? "\u2713" : "\u2717 unreachable"
        console.log(`    ${host}:${port} (${label}) ${status}`)
      }
      if (!ok) {
        throw new Error(
          `Cannot reach ${host}:${port} (${label}). ` +
            `Check that the remote service is running and your network can reach it.`
        )
      }
    }
    if (!quiet) console.log("")
  }

  // ------------------------------------------------------------------
  // Plan display
  // ------------------------------------------------------------------

  private printPlan(
    targets: string[],
    dockerDeps: string[],
    remoteDeps: string[],
    buildCheck?: BuildCheckResult,
    noBuild?: boolean,
    tunnel?: boolean
  ): void {
    const catalog = this.project.catalog
    const PAD = 24

    console.log("")
    console.log(styleBold("  Dev Plan"))
    console.log("")

    // Dev servers
    if (targets.length > 0) {
      console.log(`  \u{1F4BB} ${styleBold("Dev Servers")}`)
      console.log("")
      for (const name of targets) {
        const comp = catalog.components[name]
        const cmd = comp?.spec.dev?.command ?? "(no dev command)"
        const port = comp?.spec.ports?.[0]?.port
        const portStr = port ? styleMuted(`:${port}`) : ""
        console.log(`     ${styleInfo(name.padEnd(PAD))} ${cmd} ${portStr}`)
      }
      console.log("")
    }

    // Docker dependencies (resources + init containers)
    if (dockerDeps.length > 0) {
      console.log(`  \u{1F433} ${styleBold("Docker Dependencies")}`)
      console.log("")
      for (const name of dockerDeps) {
        const res = catalog.resources[name]
        const comp = catalog.components[name]
        const entity = res ?? comp
        const image = res?.spec.image ?? comp?.spec.build?.context ?? ""
        // Show the meaningful tail of long image refs (e.g. "my-image:latest" from a GCP AR URL)
        const shortImage =
          image.length > 35
            ? "..." + image.slice(image.lastIndexOf("/") + 1).slice(0, 32)
            : image
        const isInit = comp?.spec.type === "init"
        const port = entity?.spec.ports?.[0]?.port

        // Build status tag
        let buildTag = ""
        if (buildCheck?.details[name]) {
          const detail = buildCheck.details[name]
          if (noBuild) {
            buildTag = styleMuted(" (skip)")
          } else if (detail.reason === "cached") {
            buildTag = styleSuccess(" \u26A1 cached")
          } else if (detail.reason === "dirty") {
            buildTag = styleWarn(" \u{1F528} build (uncommitted changes)")
          } else if (detail.reason === "changed") {
            buildTag = styleWarn(" \u{1F528} build (source changed)")
          } else if (detail.reason === "new") {
            buildTag = styleWarn(" \u{1F528} build (first time)")
          }
        }

        const portTag = isInit
          ? styleMuted("(init)")
          : port
            ? styleMuted(`:${port}`)
            : ""
        console.log(
          `     ${name.padEnd(PAD)} ${styleMuted(shortImage.padEnd(36))} ${portTag}${buildTag}`
        )
      }
      console.log("")
    } else {
      console.log(
        `  \u{1F433} ${styleBold("Docker Dependencies")}  ${styleMuted("none")}`
      )
      console.log("")
    }

    // Remote deps
    if (remoteDeps.length > 0) {
      console.log(`  \u{1F517} ${styleBold("Remote")}`)
      console.log("")
      for (const name of remoteDeps) {
        console.log(`     ${name.padEnd(PAD)} ${styleMuted("\u2192 remote")}`)
      }
      console.log("")
    }

    if (tunnel) {
      const workbenchSlug = hostname().replace(/\.local$/, "")
      const gatewayDomain = process.env.DX_GATEWAY_DOMAIN ?? "lepton.software"
      const allPorts: { name: string; port: number }[] = []
      for (const name of targets) {
        const comp = catalog.components[name]
        const port = comp?.spec.ports?.[0]?.port
        if (!port) continue
        const isPublic = comp?.spec.ports?.some(
          (p) => p.port === port && p.exposure === "public"
        )
        if (isPublic) allPorts.push({ name, port })
      }
      console.log(`  \u{1F310} ${styleBold("Tunnel")}`)
      console.log("")
      if (allPorts.length === 0) {
        console.log(
          `     ${styleMuted("No public ports. Use dx.port.<port>.exposure: public")}`
        )
      } else {
        for (const { name, port } of allPorts) {
          const url = `https://${workbenchSlug}-${port}.dev.${gatewayDomain}`
          console.log(
            `     ${name.padEnd(PAD)} :${String(port).padEnd(6)} ${styleMuted("\u2192")} ${styleInfo(url)}`
          )
        }
      }
      console.log("")
    }
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private writeComposeOverride(derivedOverrides: DerivedOverride[]): void {
    const overridePath = join(
      this.project.rootDir,
      ".dx",
      COMPOSE_OVERRIDE_FILE
    )
    const lines: string[] = ["services:"]
    for (const d of derivedOverrides) {
      if (Object.keys(d.overrides).length === 0) continue
      lines.push(`  ${d.service}:`)
      lines.push(`    environment:`)
      for (const [key, val] of Object.entries(d.overrides)) {
        const escaped = val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
        lines.push(`      ${key}: "${escaped}"`)
      }
    }
    writeFileSync(overridePath, lines.join("\n") + "\n")
  }
}

// ---------------------------------------------------------------------------
// TCP health check helper
// ---------------------------------------------------------------------------

function tcpCheck(
  host: string,
  port: number,
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: timeoutMs })
    socket.on("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.on("error", () => {
      socket.destroy()
      resolve(false)
    })
    socket.on("timeout", () => {
      socket.destroy()
      resolve(false)
    })
  })
}
