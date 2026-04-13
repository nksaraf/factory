/**
 * Composite executor — routes operations to the correct executor based on
 * the component's deployment mode in site.json.
 *
 * - native → NativeExecutor (dev server processes)
 * - container → ComposeExecutor (Docker containers)
 * - linked / service → no-op (externally managed)
 */
import type { CatalogSystem } from "@smp/factory-shared/catalog"
import type { ComponentDeploymentMode } from "@smp/factory-shared"

import type { SiteManager } from "../../lib/site-manager.js"
import type {
  ComponentState,
  DeployResult,
  DesiredComponentState,
  Executor,
  HealthStatus,
  LogOpts,
  RunResult,
} from "./executor.js"

export class CompositeExecutor implements Executor {
  readonly type = "composite"

  constructor(
    private readonly compose: Executor,
    private readonly native: Executor,
    private readonly site: SiteManager,
    private readonly sdSlug: string
  ) {}

  private getMode(component: string): ComponentDeploymentMode | null {
    const sd = this.site.getSystemDeployment(this.sdSlug)
    if (!sd) return null
    const cd = sd.componentDeployments.find(
      (c) => c.componentSlug === component
    )
    return cd?.mode ?? null
  }

  private executorFor(component: string): Executor | null {
    const mode = this.getMode(component)
    switch (mode) {
      case "native":
        return this.native
      case "container":
        return this.compose
      case "linked":
      case "service":
        return null // externally managed
      default:
        return this.compose // default to compose for unknown components
    }
  }

  async parseCatalog(): Promise<CatalogSystem> {
    return this.compose.parseCatalog()
  }

  async inspect(): Promise<ComponentState[]> {
    const [composeStates, nativeStates] = await Promise.all([
      this.compose.inspect(),
      this.native.inspect(),
    ])

    // Native and linked/service take priority over compose
    const nativeNames = new Set(nativeStates.map((s) => s.name))
    const externalModes = new Set<string>()
    const sd = this.site.getSystemDeployment(this.sdSlug)
    if (sd) {
      for (const cd of sd.componentDeployments) {
        if (cd.mode === "linked" || cd.mode === "service") {
          externalModes.add(cd.componentSlug)
        }
      }
    }
    const filtered = composeStates.filter(
      (s) => !nativeNames.has(s.name) && !externalModes.has(s.name)
    )

    // Add linked/service components from site state
    const externalStates: ComponentState[] = []
    if (sd) {
      const composeNames = new Set(composeStates.map((s) => s.name))
      for (const cd of sd.componentDeployments) {
        if (cd.mode !== "linked" && cd.mode !== "service") continue
        if (nativeNames.has(cd.componentSlug)) continue
        if (composeNames.has(cd.componentSlug)) continue
        externalStates.push({
          name: cd.componentSlug,
          image: "",
          status: cd.mode === "linked" ? "running" : "unknown",
          health: "none",
          ports: cd.status.port
            ? [
                {
                  host: cd.status.port,
                  container: cd.status.port,
                  protocol: "tcp",
                },
              ]
            : [],
        })
      }
    }

    return [...nativeStates, ...filtered, ...externalStates]
  }

  async inspectOne(component: string): Promise<ComponentState> {
    const executor = this.executorFor(component)
    if (!executor) {
      // Linked/service — return status from site state
      const sd = this.site.getSystemDeployment(this.sdSlug)
      const cd = sd?.componentDeployments.find(
        (c) => c.componentSlug === component
      )
      return {
        name: component,
        image: "",
        status: cd ? "running" : "unknown",
        health: "none",
        ports: cd?.status.port
          ? [
              {
                host: cd.status.port,
                container: cd.status.port,
                protocol: "tcp",
              },
            ]
          : [],
      }
    }
    return executor.inspectOne(component)
  }

  async deploy(
    component: string,
    desired: DesiredComponentState
  ): Promise<DeployResult> {
    const executor = this.executorFor(component)
    if (!executor) {
      return { actualImage: "", status: "running" }
    }
    return executor.deploy(component, desired)
  }

  async stop(component: string): Promise<void> {
    const executor = this.executorFor(component)
    if (!executor) return
    return executor.stop(component)
  }

  async scale(component: string, replicas: number): Promise<void> {
    const executor = this.executorFor(component)
    if (!executor) return
    return executor.scale(component, replicas)
  }

  async restart(component: string): Promise<void> {
    const executor = this.executorFor(component)
    if (!executor) return
    return executor.restart(component)
  }

  async runInit(
    initName: string
  ): Promise<{ exitCode: number; output: string }> {
    // Init containers always run via compose
    return this.compose.runInit(initName)
  }

  async logs(component: string, opts?: LogOpts): Promise<string> {
    const executor = this.executorFor(component)
    if (!executor) {
      return `Component ${component} is externally managed (${this.getMode(component)})`
    }
    return executor.logs(component, opts)
  }

  async run(component: string, cmd: string[]): Promise<RunResult> {
    const executor = this.executorFor(component)
    if (!executor) {
      throw new Error(
        `Cannot run commands on externally managed component: ${component}`
      )
    }
    return executor.run(component, cmd)
  }

  async healthCheck(component: string): Promise<HealthStatus> {
    const executor = this.executorFor(component)
    if (!executor) return "none"
    return executor.healthCheck(component)
  }

  async healthCheckAll(): Promise<Record<string, HealthStatus>> {
    const [composeHealth, nativeHealth] = await Promise.all([
      this.compose.healthCheckAll(),
      this.native.healthCheckAll(),
    ])
    return { ...composeHealth, ...nativeHealth }
  }
}
