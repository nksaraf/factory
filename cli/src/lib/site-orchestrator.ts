/**
 * SiteOrchestrator — interactive site lifecycle management.
 *
 * Writes desired state (spec) to site.json, then reconciles (one-shot).
 * Handles both `dx up` (mode:up, all containers) and `dx dev` (mode:dev,
 * native dev servers). Same reconcile logic as SiteController, but
 * human-driven instead of Factory-driven.
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
import {
  type DxContextWithProject,
  type ProjectContextData,
  resolveDxContext,
} from "./dx-context.js"
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
import type { EndpointMap } from "./endpoint-resolver.js"
import { resolveLinkedSystemDeployments } from "./linked-sd-resolver.js"
import { SiteManager } from "./site-manager.js"
import { ComposeExecutor } from "../site/execution/compose.js"
import { CompositeExecutor } from "../site/execution/composite.js"
import { NativeExecutor } from "../site/execution/native.js"
import { killProcessTree } from "../site/execution/native.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionOpts {
  components?: string[]
  connectTo?: string
  connect?: string | string[]
  profile?: string
  env?: string | string[]
  dryRun?: boolean
  restart?: boolean
  noBuild?: boolean
  tunnel?: boolean
  exposeConsole?: boolean
  quiet?: boolean
}

export interface UpSessionOpts {
  targets?: string[]
  profiles?: string[]
  noBuild?: boolean
  detach?: boolean
  dryRun?: boolean
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
// SiteOrchestrator
// ---------------------------------------------------------------------------

export class SiteOrchestrator {
  private readonly portManager: PortManager
  private readonly compose: Compose | null
  readonly graph: DependencyGraph
  readonly executor: CompositeExecutor
  private tunnelHandle?: { close: () => void }
  private tunnelInfo?: {
    url: string
    subdomain: string
    portUrls?: { port: number; url: string }[]
  }
  private tunnelStatus: "disconnected" | "connecting" | "connected" | "error" =
    "disconnected"
  private consolePort?: number
  private consoleServer?: { stop: () => void }

  private constructor(
    readonly project: ProjectContextData,
    readonly site: SiteManager,
    readonly sdSlug: string,
    readonly ctx: DxContextWithProject,
    private readonly opts: { quiet?: boolean } = {}
  ) {
    this.portManager = new PortManager(
      join(project.rootDir, ".dx"),
      project.rootDir
    )
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

  static async create(opts?: {
    quiet?: boolean
    mode?: "up" | "dev"
  }): Promise<SiteOrchestrator> {
    const mode = opts?.mode ?? "dev"
    const ctx = await resolveDxContext({ need: "project" })
    const project = ctx.project
    const workbenchSlug =
      ctx.workbench?.name ?? hostname().replace(/\.local$/, "")
    const workbenchType = ctx.workbench?.kind ?? "worktree"

    const sdSlug = project.name

    const existing = SiteManager.load(project.rootDir)
    let site: SiteManager
    if (existing) {
      site = existing
      site.setMode(mode)
      site.ensureSystemDeployment(
        sdSlug,
        project.name,
        "docker-compose",
        project.composeFiles
      )
    } else {
      site = SiteManager.init(
        project.rootDir,
        {
          slug: `${workbenchSlug}-${project.name}`,
          type: "local",
        },
        {
          slug: workbenchSlug,
          type: workbenchType,
          ownerType: "user" as const,
        },
        mode
      )
      site.ensureSystemDeployment(
        sdSlug,
        project.name,
        "docker-compose",
        project.composeFiles
      )
    }

    return new SiteOrchestrator(project, site, sdSlug, ctx, opts)
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

  async startDevSession(opts: SessionOpts): Promise<ConnectionResult | null> {
    const dryRun = !!opts.dryRun

    // ── --restart shortcut ────────────────────────────────────
    if (opts.restart) {
      await this.restartDevServers(opts.components)
      return null
    }

    // ── Reset intent — site.json regenerates from scratch every call ──
    // Yesterday's --connect-to staging doesn't leak into today's bare dx dev.
    // Runtime status (PIDs, ports) preserved for components that survive.
    const savedStatuses = dryRun ? new Map() : this.site.resetIntent()

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

    // ── System-level linked SDs (multi-system composition) ────
    // For each connection entry whose left-slug matches a declared
    // `x-dx.dependencies[].system`, write a `LinkedSystemDeployment` entry
    // into `.dx/site.json`. Represents "this external system is consumed
    // from another site's SD" — no local componentDeployments, just a
    // `linkedRef`. Component-level connects are already handled by
    // `applyConnections` above.
    //
    // Dry-run: compute + log the plan, but don't mutate site.json.
    if (hasConnectionFlags) {
      const connectList = !opts.connect
        ? []
        : Array.isArray(opts.connect)
          ? opts.connect
          : [opts.connect]
      const endpointsBySystem = await this.fetchEndpointsForTarget(
        opts.connectTo
      )
      const linkedSds = resolveLinkedSystemDeployments({
        connects: connectList,
        connectTo: opts.connectTo,
        catalog: this.project.catalog,
        endpointsBySystem,
      })
      // Collect cross-system env from deps' envMapping. These are the BASE
      // layer — component-level connection env (from applyConnections above)
      // wins when both set the same key, because per-component is more
      // specific than per-system.
      const crossSystemEnv: Record<string, string> = {}
      for (const l of linkedSds) {
        Object.assign(crossSystemEnv, l.env)
      }
      if (Object.keys(crossSystemEnv).length > 0) {
        // System-level fills gaps only; component-level (already in connectionEnv) wins.
        for (const [k, v] of Object.entries(crossSystemEnv)) {
          if (!(k in connectionEnv)) {
            connectionEnv[k] = v
          }
        }
      }

      if (dryRun) {
        for (const l of linkedSds) {
          const envCount = Object.keys(l.env).length
          const envSuffix = envCount > 0 ? ` (${envCount} env vars)` : ""
          console.log(
            `  [dry-run] Would link system: ${l.systemSlug} → ${l.linkedRef.site}/${l.linkedRef.systemDeployment}${envSuffix}`
          )
        }
        if (Object.keys(crossSystemEnv).length > 0) {
          for (const [k, v] of Object.entries(crossSystemEnv)) {
            console.log(`  [dry-run] env: ${k}=${v}`)
          }
        }
      } else {
        for (const l of linkedSds) {
          this.site.ensureLinkedSystemDeployment(
            l.slug,
            l.systemSlug,
            l.linkedRef
          )
        }
        // Merge cross-system env into the focus SD's resolvedEnv. These are
        // the endpoint values the focus's dev servers need to talk to linked
        // external systems. Source tagged as "connection" + system dep detail.
        if (Object.keys(crossSystemEnv).length > 0) {
          const focusSdSlug = this.sdSlug
          if (focusSdSlug) {
            const focusSd = this.site.getSystemDeployment(focusSdSlug)
            if (focusSd) {
              for (const [key, value] of Object.entries(crossSystemEnv)) {
                focusSd.resolvedEnv[key] = {
                  value,
                  source: "connection",
                  sourceDetail: "x-dx.dependencies env",
                }
              }
            }
          }
        }
        if (linkedSds.length > 0) {
          this.site.save()
        }
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

    // ── Restore runtime status from prior run ──────────────────
    // MUST run BEFORE executor deploys — so readLivePid() finds the
    // restored PID, confirms the process is alive, and skips re-spawn.
    // Running this AFTER executor would overwrite fresh PIDs with stale ones.
    if (savedStatuses.size > 0) {
      for (const target of targets) {
        this.site.restoreStatus(this.sdSlug, target, savedStatuses)
      }
      for (const dep of localDockerDeps) {
        this.site.restoreStatus(this.sdSlug, dep, savedStatuses)
      }
    }

    // ── Kill orphaned native processes ─────────────────────────
    this.cleanupOrphanedProcesses(
      savedStatuses,
      new Set([...targets, ...localDockerDeps])
    )

    // ── Start local Docker deps ───────────────────────────────
    if (localDockerDeps.length > 0 && this.compose) {
      if (!isDockerRunning()) {
        throw new Error(
          "Docker is not running. Start Docker for infrastructure dependencies."
        )
      }
      // Build and run are separate steps so that `docker compose up`
      // only starts the listed services — `--build` would build (and
      // potentially start) every service with a build context.
      const depsNeedingBuild = skipBuild
        ? []
        : buildCheck.needsBuild.filter((s) => localDockerDeps.includes(s))

      if (depsNeedingBuild.length > 0) {
        if (!this.opts.quiet) {
          console.log(`  Building Docker deps: ${depsNeedingBuild.join(", ")}`)
        }
        this.compose.build(depsNeedingBuild)
        recordBuild(
          this.project.rootDir,
          this.project.catalog,
          depsNeedingBuild
        )
      }

      if (!this.opts.quiet) {
        const reason =
          depsNeedingBuild.length > 0
            ? "(freshly built)"
            : opts.noBuild
              ? "(--no-build)"
              : "(no source changes)"
        console.log(
          `  Starting Docker deps ${styleMuted(reason)}: ${localDockerDeps.join(", ")}`
        )
      }
      this.compose.up({
        detach: true,
        services: localDockerDeps,
        noBuild: true,
        noDeps: true,
      })
    }

    // ── Start native dev servers via executor ─────────────────
    for (const component of targets) {
      // Docker may auto-create this container when infra deps become
      // healthy (depends_on). Stop it so the native process can bind.
      if (this.compose && localDockerDeps.length > 0) {
        this.compose.stop([component])
      }
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
      const tunnelSubdomain = this.site.getTunnelSubdomain()
      await this.openTunnel(tunnelSubdomain, {
        exposeConsole: opts.exposeConsole,
      })
    }

    this.site.save()
    return conn
  }

  // ------------------------------------------------------------------
  // Start up session (dx up — all containers, prod-like)
  // ------------------------------------------------------------------

  async startUpSession(opts: UpSessionOpts): Promise<void> {
    const dryRun = !!opts.dryRun

    // ── Reset intent ─────────────────────────────────────────
    let savedStatuses = new Map<
      string,
      {
        status: import("@smp/factory-shared").ComponentDeploymentStatus
        mode: import("@smp/factory-shared").ComponentDeploymentMode
      }
    >()
    if (!dryRun) {
      savedStatuses = this.site.resetIntent()
      this.cleanupOrphanedProcesses(savedStatuses, new Set())
      this.site.ensureSystemDeployment(
        this.sdSlug,
        this.project.name,
        "docker-compose",
        this.project.composeFiles
      )
    }

    // ── Port resolution ──────────────────────────────────────
    const { envPath } = dryRun ? { envPath: "" } : await this.resolvePorts()

    // ── All components → container mode ──────────────────────
    const allComponents = [
      ...Object.keys(this.project.catalog.components),
      ...Object.keys(this.project.catalog.resources),
    ]

    if (dryRun) {
      console.log(
        `  [dry-run] Would bring up ${allComponents.length} component(s) as containers`
      )
      return
    }

    for (const name of allComponents) {
      this.site.setComponentMode(this.sdSlug, name, "container")
    }

    // ── Compose up ───────────────────────────────────────────
    if (!this.compose) {
      if (!opts.quiet) {
        console.log(
          "  Nothing to bring up — this project has no docker-compose services."
        )
      }
      this.site.save()
      return
    }

    if (!isDockerRunning()) {
      throw new Error(
        "Docker is not running. Start Docker to bring up the site."
      )
    }

    const upCompose = envPath
      ? new Compose(
          this.project.composeFiles,
          basename(this.project.rootDir),
          envPath
        )
      : this.compose

    upCompose.up({
      detach: opts.detach !== false,
      noBuild: !!opts.noBuild,
      profiles: opts.profiles?.length ? opts.profiles : undefined,
      services: opts.targets?.length ? opts.targets : undefined,
    })

    this.site.setPhase("running")
    this.site.save()
  }

  // ------------------------------------------------------------------
  // Tunnel
  // ------------------------------------------------------------------

  async startTunnel(opts: { exposeConsole?: boolean } = {}): Promise<void> {
    if (this.tunnelHandle) return
    const workbenchSlug = this.site.getTunnelSubdomain()
    await this.openTunnel(workbenchSlug, opts)
  }

  stopTunnel(): void {
    this.tunnelHandle?.close()
    this.tunnelHandle = undefined
    this.tunnelInfo = undefined
    this.tunnelStatus = "disconnected"
  }

  private async openTunnel(
    workbenchSlug: string,
    opts: { exposeConsole?: boolean } = {}
  ): Promise<void> {
    const sd = this.site.getSystemDeployment(this.sdSlug)
    const catalog = this.project.catalog
    const declaredPorts: number[] = []
    const portMap = new Map<number, number>()
    let defaultLocalPort: number | undefined

    for (const cd of sd?.componentDeployments ?? []) {
      const actualPort = cd.status.port
      if (!actualPort) continue
      const entity =
        catalog.components[cd.componentSlug] ??
        catalog.resources[cd.componentSlug]
      for (const p of entity?.spec.ports ?? []) {
        if (p.exposure !== "public") continue
        declaredPorts.push(p.port)
        if (p.port !== actualPort) {
          portMap.set(p.port, actualPort)
        }
        if (!defaultLocalPort) defaultLocalPort = actualPort
      }
    }

    if (this.consolePort && opts.exposeConsole) {
      declaredPorts.push(this.consolePort)
      if (!defaultLocalPort) defaultLocalPort = this.consolePort
    }

    if (declaredPorts.length === 0) {
      console.log(
        "  No public ports to tunnel. Mark ports with dx.port.<port>.exposure: public"
      )
      return
    }

    const { openTunnel } = await import("./tunnel-client.js")
    this.tunnelStatus = "connecting"
    const handle = await openTunnel(
      {
        port: defaultLocalPort!,
        subdomain: workbenchSlug,
        routeFamily: "dev",
        publishPorts: declaredPorts,
        portMap: portMap.size > 0 ? portMap : undefined,
      },
      {
        onRegistered: (info) => {
          this.tunnelInfo = {
            url: info.url,
            subdomain: info.subdomain,
            portUrls: info.portUrls,
          }
          this.tunnelStatus = "connected"
          console.log(`\n  Tunnel active!`)
          console.log(`  URL:       ${info.url}`)
          console.log(`  Subdomain: ${info.subdomain}`)
          if (info.portUrls?.length) {
            for (const pu of info.portUrls) {
              console.log(`  Port ${pu.port}:   ${pu.url}`)
            }
          }
        },
        onReconnecting: (attempt, delayMs) => {
          this.tunnelStatus = "connecting"
          console.log(
            `  Tunnel reconnecting (attempt ${attempt}, ${Math.round(delayMs / 1000)}s delay)...`
          )
        },
        onReconnected: (info) => {
          this.tunnelInfo = {
            url: info.url,
            subdomain: info.subdomain,
            portUrls: info.portUrls,
          }
          this.tunnelStatus = "connected"
          console.log(`  Tunnel reconnected! URL: ${info.url}`)
        },
        onError: (err) => {
          this.tunnelStatus = "error"
          console.error(`  Tunnel error: ${err.message}`)
        },
        onClose: () => {
          this.tunnelStatus = "disconnected"
          this.tunnelInfo = undefined
          console.log("  Tunnel closed.")
        },
      }
    )

    this.tunnelHandle = handle
  }

  getTunnelState(): {
    status: "disconnected" | "connecting" | "connected" | "error"
    info?: {
      url: string
      subdomain: string
      portUrls?: { port: number; url: string }[]
    }
  } {
    return { status: this.tunnelStatus, info: this.tunnelInfo }
  }

  getPortAllocations() {
    return this.portManager.status()
  }

  getConsolePort(): number | undefined {
    return this.consolePort
  }

  /**
   * @deprecated The dev console is now served by the unified agent server.
   * This method is kept for backward compatibility but is a no-op
   * when the agent daemon is managing the HTTP server.
   */
  async startConsole(): Promise<{ port: number; url: string }> {
    const allocated = await this.portManager.resolveMulti([
      {
        service: "__dev-console__",
        ports: [{ name: "main", preferred: 4299 }],
      },
    ])
    const port = allocated["__dev-console__"]?.main
    if (!port) {
      throw new Error("Failed to allocate port for dev console")
    }
    this.consolePort = port

    const { createDevConsoleServer } = await import("../dev-console/server.js")
    const server = createDevConsoleServer(this, { port })
    const info = await server.start()
    this.consoleServer = server
    return info
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
    if (this.consoleServer) {
      this.consoleServer.stop()
      this.consoleServer = undefined
    }

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
  // Orphaned process cleanup
  // ------------------------------------------------------------------

  private cleanupOrphanedProcesses(
    savedStatuses: Map<
      string,
      {
        status: import("@smp/factory-shared").ComponentDeploymentStatus
        mode: import("@smp/factory-shared").ComponentDeploymentMode
      }
    >,
    currentComponents: Set<string>
  ): void {
    for (const [key, { status, mode }] of savedStatuses) {
      const componentSlug = key.split("/")[1]
      if (
        mode === "native" &&
        status.pid != null &&
        !currentComponents.has(componentSlug)
      ) {
        killProcessTree(status.pid)
        if (!this.opts.quiet) {
          console.log(
            `  ${styleWarn("Killed orphaned process")} ${styleBold(componentSlug)} (pid ${status.pid})`
          )
        }
      }
    }
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
      const tunnelSubdomain = this.site.getTunnelSubdomain()
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
          const url = `https://${tunnelSubdomain}-${port}.dev.${gatewayDomain}`
          console.log(
            `     ${name.padEnd(PAD)} :${String(port).padEnd(6)} ${styleMuted("\u2192")} ${styleInfo(url)}`
          )
        }
      }
      console.log("")
    }
  }

  // ------------------------------------------------------------------
  // Endpoint discovery (Factory API)
  // ------------------------------------------------------------------

  private async fetchEndpointsForTarget(
    targetSite?: string
  ): Promise<Record<string, EndpointMap> | undefined> {
    if (!targetSite) return undefined
    try {
      const { getFactoryRestClient } = await import("../client.js")
      const client = await getFactoryRestClient()
      const raw = await client.request<{
        spec: {
          systemDeployments: Array<{
            systemSlug: string
            componentDeployments: Array<{
              componentSlug: string
              ports?: Array<{ name: string; port: number }>
            }>
          }>
        }
        host?: { ip: string; slug: string } | null
      }>("GET", `/api/v1/factory/ops/site-live/${targetSite}`)

      const hostIp = raw.host?.ip ?? targetSite
      const flatEndpoints: EndpointMap = {}

      for (const sd of raw.spec.systemDeployments) {
        for (const cd of sd.componentDeployments as any[]) {
          if (!cd.ports?.length) continue
          const firstHostPort = cd.ports.find((p: any) => p.hostPort)?.hostPort
          const defaultPort = firstHostPort ?? cd.ports[0].port
          const namedPorts: Record<string, number> = {}
          for (const p of cd.ports) {
            const portName = p.name?.replace(/^port-/, "") ?? String(p.port)
            namedPorts[portName] = p.hostPort ?? p.port
          }
          const ep = { host: hostIp, port: defaultPort, ports: namedPorts }
          const name = cd.name ?? cd.componentSlug
          flatEndpoints[name] = ep
          flatEndpoints[cd.componentSlug] = ep
          // Fallback: strip system prefix (factory-infra-postgres → infra-postgres)
          const dash = cd.componentSlug.indexOf("-")
          if (dash > 0) {
            flatEndpoints[cd.componentSlug.slice(dash + 1)] = ep
          }
        }
      }

      if (Object.keys(flatEndpoints).length === 0) return undefined
      // Key by every declared dep system so the resolver finds it
      const deps = this.project.catalog.spec.dependencies ?? []
      const result: Record<string, EndpointMap> = {}
      for (const dep of deps) {
        result[dep.system] = flatEndpoints
      }
      return result
    } catch {
      return undefined
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
