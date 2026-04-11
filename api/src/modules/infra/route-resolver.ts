/**
 * Route target resolver.
 *
 * Walks the entity graph to turn abstract route targets
 * (`{tenantSlug, systemDeploymentSlug, port}`) into concrete
 * `{address, port}` pairs. Realm-type-aware:
 *   k8s-namespace → deterministic service DNS
 *   systemd       → host IP
 *   others        → error (deferred)
 */
import type {
  RouteStatus,
  RouteTarget,
} from "@smp/factory-shared/schemas/infra"
import { and, eq, inArray } from "drizzle-orm"

import type { Database } from "../../db/connection"
import { host, realm, realmHost } from "../../db/schema/infra"
import {
  componentDeployment,
  systemDeployment,
  tenant,
} from "../../db/schema/ops"
import { component } from "../../db/schema/software"

// ── DbReader interface (testable abstraction) ──────────────

export interface SystemDeploymentRow {
  id: string
  slug: string
  tenantSlug: string
  realmId: string | null
  spec: Record<string, unknown>
}

export interface ComponentDeploymentRow {
  systemDeploymentId: string
  componentId: string
}

export interface ComponentRow {
  id: string
  slug: string
  spec: {
    ports?: Array<{ name: string; port: number; protocol?: string }>
  } & Record<string, unknown>
}

export interface RealmRow {
  id: string
  type: string
  hostId: string | null // first host from realmHost join table (null if none)
  slug: string
}

export interface HostRow {
  id: string
  spec: { ipAddress?: string } & Record<string, unknown>
}

export interface DbReader {
  findSystemDeployments(
    slugs: string[],
    tenantSlugs: string[]
  ): Promise<SystemDeploymentRow[]>
  findComponentDeployments(
    systemDeploymentIds: string[]
  ): Promise<ComponentDeploymentRow[]>
  findComponents(componentIds: string[]): Promise<ComponentRow[]>
  findRealms(realmIds: string[]): Promise<RealmRow[]>
  findHosts(hostIds: string[]): Promise<HostRow[]>
}

// ── Resolver ───────────────────────────────────────────────

export async function resolveRouteTargets(
  targets: RouteTarget[],
  reader: DbReader
): Promise<RouteStatus> {
  if (targets.length === 0) {
    return { resolvedTargets: [], phase: "resolved", resolvedAt: new Date() }
  }

  // 1. Collect unique slug pairs
  const sdSlugs = [...new Set(targets.map((t) => t.systemDeploymentSlug))]
  const tenantSlugs = [...new Set(targets.map((t) => t.tenantSlug))]

  // 2. Batch-load system deployments
  const sds = await reader.findSystemDeployments(sdSlugs, tenantSlugs)
  const sdByKey = new Map(sds.map((sd) => [`${sd.tenantSlug}:${sd.slug}`, sd]))

  // Check for missing system deployments
  const missing: string[] = []
  for (const t of targets) {
    if (!sdByKey.has(`${t.tenantSlug}:${t.systemDeploymentSlug}`)) {
      missing.push(`${t.tenantSlug}/${t.systemDeploymentSlug}`)
    }
  }
  if (missing.length > 0) {
    return {
      resolvedTargets: [],
      phase: "error",
      resolutionError: `System deployment(s) not found: ${missing.join(", ")}`,
      resolvedAt: new Date(),
    }
  }

  // 3. Batch-load component deployments
  const sdIds = [...new Set(sds.map((sd) => sd.id))]
  const cds = await reader.findComponentDeployments(sdIds)

  // 4. Batch-load components (for port matching + slug)
  const componentIds = [...new Set(cds.map((cd) => cd.componentId))]
  const components =
    componentIds.length > 0 ? await reader.findComponents(componentIds) : []
  const componentById = new Map(components.map((c) => [c.id, c]))

  // 5. Batch-load realms
  const realmIds = [
    ...new Set(sds.filter((sd) => sd.realmId).map((sd) => sd.realmId!)),
  ]
  const realms = realmIds.length > 0 ? await reader.findRealms(realmIds) : []
  const realmById = new Map(realms.map((r) => [r.id, r]))

  // 6. Batch-load hosts (only needed for systemd/bare-metal)
  const hostIds = [
    ...new Set(realms.filter((r) => r.hostId).map((r) => r.hostId!)),
  ]
  const hosts = hostIds.length > 0 ? await reader.findHosts(hostIds) : []
  const hostById = new Map(hosts.map((h) => [h.id, h]))

  // 7. Resolve each target
  const resolvedTargets: RouteStatus["resolvedTargets"] = []
  const errors: string[] = []

  for (const target of targets) {
    const sd = sdByKey.get(
      `${target.tenantSlug}:${target.systemDeploymentSlug}`
    )!

    if (!sd.realmId) {
      errors.push(`${target.systemDeploymentSlug}: no realm assigned`)
      continue
    }

    const rt = realmById.get(sd.realmId)
    if (!rt) {
      errors.push(
        `${target.systemDeploymentSlug}: realm ${sd.realmId} not found`
      )
      continue
    }

    // Find the component matching this port
    const sdCds = cds.filter((cd) => cd.systemDeploymentId === sd.id)
    let matchedComponent: ComponentRow | undefined

    for (const cd of sdCds) {
      const comp = componentById.get(cd.componentId)
      if (comp?.spec.ports?.some((p) => p.port === target.port)) {
        matchedComponent = comp
        break
      }
    }

    const componentSlug = matchedComponent?.slug ?? "unknown"

    // Runtime-type dispatch
    switch (rt.type) {
      case "k8s-namespace": {
        const namespace = (sd.spec as Record<string, unknown>).namespace as
          | string
          | undefined
        if (!namespace) {
          errors.push(
            `${target.systemDeploymentSlug}: k8s-namespace realm but no namespace in spec`
          )
          continue
        }
        resolvedTargets.push({
          systemDeploymentSlug: target.systemDeploymentSlug,
          componentSlug,
          address: `${componentSlug}.${namespace}.svc.cluster.local`,
          port: target.port,
          weight: target.weight,
          realmType: rt.type,
          geo: target.geo,
        })
        break
      }

      case "systemd":
      case "bare-metal": {
        if (!rt.hostId) {
          errors.push(
            `${target.systemDeploymentSlug}: ${rt.type} realm has no host`
          )
          continue
        }
        const h = hostById.get(rt.hostId)
        if (!h?.spec.ipAddress) {
          errors.push(
            `${target.systemDeploymentSlug}: host ${rt.hostId} has no IP address`
          )
          continue
        }
        resolvedTargets.push({
          systemDeploymentSlug: target.systemDeploymentSlug,
          componentSlug,
          address: h.spec.ipAddress,
          port: target.port,
          weight: target.weight,
          realmType: rt.type,
          geo: target.geo,
        })
        break
      }

      case "compose-project": {
        errors.push(
          `${target.systemDeploymentSlug}: compose-project port mapping not yet supported`
        )
        continue
      }

      case "reverse-proxy":
      case "k8s-cluster":
      case "docker-engine": {
        errors.push(
          `${target.systemDeploymentSlug}: realm type '${rt.type}' cannot host workloads directly`
        )
        continue
      }

      default: {
        errors.push(
          `${target.systemDeploymentSlug}: unknown realm type '${rt.type}'`
        )
        continue
      }
    }
  }

  if (errors.length > 0 && resolvedTargets.length === 0) {
    return {
      resolvedTargets: [],
      phase: "error",
      resolutionError: errors.join("; "),
      resolvedAt: new Date(),
    }
  }

  return {
    resolvedTargets,
    phase: errors.length > 0 ? "error" : "resolved",
    resolutionError: errors.length > 0 ? errors.join("; ") : undefined,
    resolvedAt: new Date(),
  }
}

// ── Drizzle DbReader ───────────────────────────────────────

export function drizzleDbReader(db: Database): DbReader {
  return {
    async findSystemDeployments(slugs, tenantSlugs) {
      if (slugs.length === 0) return []

      // Join system_deployment → tenant to get tenantSlug
      const rows = await db
        .select({
          id: systemDeployment.id,
          slug: systemDeployment.slug,
          tenantSlug: tenant.slug,
          realmId: systemDeployment.realmId,
          spec: systemDeployment.spec,
        })
        .from(systemDeployment)
        .innerJoin(tenant, eq(systemDeployment.tenantId, tenant.id))
        .where(
          and(
            inArray(systemDeployment.slug, slugs),
            inArray(tenant.slug, tenantSlugs)
          )
        )

      return rows as SystemDeploymentRow[]
    },

    async findComponentDeployments(systemDeploymentIds) {
      if (systemDeploymentIds.length === 0) return []

      const rows = await db
        .select({
          systemDeploymentId: componentDeployment.systemDeploymentId,
          componentId: componentDeployment.componentId,
        })
        .from(componentDeployment)
        .where(
          inArray(componentDeployment.systemDeploymentId, systemDeploymentIds)
        )

      return rows
    },

    async findComponents(componentIds) {
      if (componentIds.length === 0) return []

      const rows = await db
        .select({
          id: component.id,
          slug: component.slug,
          spec: component.spec,
        })
        .from(component)
        .where(inArray(component.id, componentIds))

      return rows as ComponentRow[]
    },

    async findRealms(realmIds) {
      if (realmIds.length === 0) return []

      const rows = await db
        .select({
          id: realm.id,
          type: realm.type,
          hostId: realmHost.hostId,
          slug: realm.slug,
        })
        .from(realm)
        .leftJoin(realmHost, eq(realmHost.realmId, realm.id))
        .where(inArray(realm.id, realmIds))

      // Deduplicate: a realm with multiple hosts keeps only the first hostId
      const seen = new Set<string>()
      const deduped: RealmRow[] = []
      for (const row of rows) {
        if (!seen.has(row.id)) {
          seen.add(row.id)
          deduped.push(row)
        }
      }
      return deduped
    },

    async findHosts(hostIds) {
      if (hostIds.length === 0) return []

      const rows = await db
        .select({
          id: host.id,
          spec: host.spec,
        })
        .from(host)
        .where(inArray(host.id, hostIds))

      return rows as HostRow[]
    },
  }
}
