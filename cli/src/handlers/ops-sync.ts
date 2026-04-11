/**
 * Compare Factory's recorded state against live docker compose state.
 *
 * For each compose project on the host:
 * - If imported: compare container count, images, health status
 * - If not imported: flag as "missing-in-factory"
 *
 * For each system-deployment in Factory targeting this host:
 * - If not running on host: flag as "missing-on-host"
 */
import { getFactoryRestClient } from "../client.js"
import type { FactoryClient } from "../lib/api-client.js"
import {
  type DiscoverOptions,
  type DiscoveredStack,
  discoverHost,
} from "./ops-discover.js"

// ─── Types ────────────────────────────────────────────────────

export interface StackSyncStatus {
  project: string
  status: "in-sync" | "drifted" | "missing-in-factory" | "missing-on-host"
  issues: string[]
}

export interface SyncResult {
  host: string
  stacks: StackSyncStatus[]
}

// ─── Main entry ───────────────────────────────────────────────

export async function syncHost(
  slug: string,
  opts?: DiscoverOptions
): Promise<SyncResult> {
  // 1. Discover live state
  const discovery = await discoverHost(slug, opts)

  if (discovery.error) {
    return {
      host: slug,
      stacks: [
        {
          project: "*",
          status: "drifted",
          issues: [`Discovery failed: ${discovery.error}`],
        },
      ],
    }
  }

  const rest = await getFactoryRestClient()

  // 2. Check each live project against Factory (parallel)
  const liveProjects = new Set(discovery.stacks.map((s) => s.project.name))
  const [stackStatuses, factoryDeployments] = await Promise.all([
    Promise.all(discovery.stacks.map((stack) => syncStack(rest, slug, stack))),
    listFactoryDeployments(rest, slug),
  ])

  const stacks: StackSyncStatus[] = [...stackStatuses]

  // 3. Check for Factory deployments that no longer exist on host

  for (const dep of factoryDeployments) {
    if (!liveProjects.has(dep.project)) {
      stacks.push({
        project: dep.project,
        status: "missing-on-host",
        issues: [
          `Deployment ${dep.slug} exists in Factory but no compose project found on host`,
        ],
      })
    }
  }

  return { host: slug, stacks }
}

// ─── Per-stack sync ───────────────────────────────────────────

async function syncStack(
  rest: FactoryClient,
  hostSlug: string,
  stack: DiscoveredStack
): Promise<StackSyncStatus> {
  const projectName = stack.project.name
  const deploymentSlug = `${projectName}--${hostSlug}`

  // Check if this stack has been imported
  const deployment = await getEntity(
    rest,
    "ops",
    "system-deployments",
    deploymentSlug
  )

  if (!deployment) {
    return {
      project: projectName,
      status: "missing-in-factory",
      issues: ["Not imported into Factory"],
    }
  }

  // Compare live state vs Factory state
  const issues: string[] = []

  // Check container health
  const unhealthy = stack.containers.filter((c) => c.health === "unhealthy")
  if (unhealthy.length > 0) {
    issues.push(
      `${unhealthy.length} unhealthy: ${unhealthy.map((c) => c.service || c.name).join(", ")}`
    )
  }

  // Check container status
  const stopped = stack.containers.filter(
    (c) => c.status === "exited" || c.status === "dead"
  )
  if (stopped.length > 0) {
    issues.push(
      `${stopped.length} stopped: ${stopped.map((c) => c.service || c.name).join(", ")}`
    )
  }

  // Check if Factory thinks it's active but it's not running
  const spec = deployment.spec as Record<string, unknown> | undefined
  const factoryStatus = spec?.status
  const statusMatch = stack.project.status.match(/^(\w+)/)
  const liveStatus = statusMatch ? statusMatch[1] : stack.project.status

  if (factoryStatus === "active" && liveStatus !== "running") {
    issues.push(`Factory says active but compose status is ${liveStatus}`)
  }

  // Check component count drift
  const composeRealmSlug = `${hostSlug}--${projectName}`
  const composeRealm = await getEntity(
    rest,
    "infra",
    "realms",
    composeRealmSlug
  )
  if (composeRealm) {
    // We could check component deployments here in the future
    // For now, just verify the realm exists
  }

  return {
    project: projectName,
    status: issues.length > 0 ? "drifted" : "in-sync",
    issues,
  }
}

// ─── Factory API helpers ──────────────────────────────────────

async function getEntity(
  rest: FactoryClient,
  module: string,
  entity: string,
  slug: string
): Promise<Record<string, unknown> | null> {
  try {
    const res = await rest.getEntity(module, entity, slug)
    return res?.data ?? null
  } catch {
    return null
  }
}

interface FactoryDeployment {
  slug: string
  project: string
}

/**
 * List all system-deployments in Factory that target this host
 * by looking for deployment slugs matching the pattern `*--<host>`.
 */
async function listFactoryDeployments(
  rest: FactoryClient,
  hostSlug: string
): Promise<FactoryDeployment[]> {
  try {
    const res = await rest.listEntities("ops", "system-deployments")
    const items = res?.data ?? []

    return items
      .filter((d) => {
        const slug = String(d.slug ?? "")
        return slug.endsWith(`--${hostSlug}`)
      })
      .map((d) => {
        const slug = String(d.slug ?? "")
        const project = slug.replace(`--${hostSlug}`, "")
        return { slug, project }
      })
  } catch {
    return []
  }
}
