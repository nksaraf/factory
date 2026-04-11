/**
 * Reconcile logic — diffs desired manifest state against actual running state.
 *
 * Produces an ordered change plan that respects catalog topology:
 * init containers run before their parents, dependencies are ordered.
 */
import type { CatalogSystem } from "@smp/factory-shared/catalog"

import type { ComponentState } from "./execution/executor.js"
import type { ManifestComponentDeployment, SiteManifest } from "./manifest.js"

export type StepAction = "run-init" | "deploy" | "scale" | "stop" | "restart"

export interface ReconcileStep {
  action: StepAction
  component: string
  reason: string
  desired?: ManifestComponentDeployment
  replicas?: number
}

export interface ReconcilePlan {
  steps: ReconcileStep[]
  upToDate: string[]
}

export function planChanges(
  manifest: SiteManifest,
  actual: ComponentState[]
): ReconcilePlan {
  const actualMap = new Map<string, ComponentState>()
  for (const s of actual) {
    actualMap.set(s.name, s)
  }

  const steps: ReconcileStep[] = []
  const upToDate: string[] = []

  const desiredByName = new Map<string, ManifestComponentDeployment>()
  for (const cd of manifest.componentDeployments) {
    desiredByName.set(cd.componentName, cd)
  }

  const orderedComponents = topologicalOrder(
    manifest.catalog,
    manifest.componentDeployments
  )

  for (const componentName of orderedComponents) {
    const desired = desiredByName.get(componentName)
    if (!desired) continue

    if (desired.status === "stopped") {
      const running = actualMap.get(componentName)
      if (running && running.status === "running") {
        steps.push({
          action: "stop",
          component: componentName,
          reason: "desired state is stopped",
        })
      }
      continue
    }

    const current = actualMap.get(componentName)

    if (
      !current ||
      current.status === "exited" ||
      current.status === "unknown"
    ) {
      steps.push({
        action: "deploy",
        component: componentName,
        reason: current
          ? `component is ${current.status}`
          : "component not running",
        desired,
      })
      continue
    }

    if (desired.desiredImage && current.image !== desired.desiredImage) {
      steps.push({
        action: "deploy",
        component: componentName,
        reason: `image drift: ${current.image} → ${desired.desiredImage}`,
        desired,
      })
      continue
    }

    upToDate.push(componentName)
  }

  for (const [name, current] of actualMap) {
    if (!desiredByName.has(name) && current.status === "running") {
      const isInit = isInitContainer(manifest.catalog, name)
      if (!isInit) {
        steps.push({
          action: "stop",
          component: name,
          reason: "not in manifest (orphaned)",
        })
      }
    }
  }

  return { steps, upToDate }
}

function isInitContainer(catalog: CatalogSystem, name: string): boolean {
  const comp = catalog.components[name]
  return comp?.spec.type === "init"
}

/**
 * Produce a dependency-respecting order for component deployments.
 * Init containers come before the services they initialize.
 * Services with dependsOn come after their dependencies.
 */
function topologicalOrder(
  catalog: CatalogSystem,
  componentDeployments: ManifestComponentDeployment[]
): string[] {
  const names = new Set(componentDeployments.map((cd) => cd.componentName))

  const graph = new Map<string, string[]>()
  for (const name of names) {
    graph.set(name, [])
  }

  for (const [initName, comp] of Object.entries(catalog.components)) {
    if (
      comp.spec.type === "init" &&
      comp.spec.initFor &&
      names.has(comp.spec.initFor)
    ) {
      const deps = graph.get(comp.spec.initFor)
      if (deps && names.has(initName)) {
        deps.push(initName)
      }
    }
  }

  for (const name of names) {
    const comp = catalog.components[name]
    if (comp?.spec.dependsOn) {
      for (const dep of comp.spec.dependsOn) {
        const depName = dep.replace(/^.*:/, "")
        if (names.has(depName)) {
          const deps = graph.get(name)
          if (deps) deps.push(depName)
        }
      }
    }
  }

  const visited = new Set<string>()
  const inProgress = new Set<string>()
  const order: string[] = []

  function visit(node: string) {
    if (visited.has(node)) return
    if (inProgress.has(node)) {
      throw new Error(`Circular dependency detected involving: ${node}`)
    }
    inProgress.add(node)
    for (const dep of graph.get(node) ?? []) {
      visit(dep)
    }
    inProgress.delete(node)
    visited.add(node)
    order.push(node)
  }

  for (const name of names) {
    visit(name)
  }

  return order
}
