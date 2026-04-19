/**
 * Scan reconciler — maps raw host scan results into the Factory ontology.
 *
 * Creates/updates Systems, Realms, and Components from discovered services.
 * Decommissions entities that disappear between scans.
 * All scan-created entities are annotated with `metadata.annotations.discoveredBy = "scan"`.
 */
import type { EntityMetadata } from "@smp/factory-shared/schemas/common"
import type {
  HostScanResult,
  HostSpec,
  NetworkLinkSpec,
  RealmSpec,
  RouteSpec,
  RouteStatus,
} from "@smp/factory-shared/schemas/infra"
import type {
  ComponentDeploymentObservedStatus,
  ComponentDeploymentSpec,
  SiteObservedStatus,
  SystemDeploymentSpec,
} from "@smp/factory-shared/schemas/ops"
import { and, eq, isNull, sql } from "drizzle-orm"

import type { Database } from "../../db/connection"
import {
  host,
  networkLink,
  realm,
  realmHost,
  route,
} from "../../db/schema/infra"
import {
  componentDeployment,
  site,
  systemDeployment,
} from "../../db/schema/ops"
import { component, system } from "../../db/schema/software"
import { newId } from "../../lib/id"
import { extractHost, extractPort } from "../../lib/url-utils"
import { assignIp, ensureIp } from "./ipam.service"

function isRfc1918Ip(ip: string): boolean {
  const parts = ip.split(".").map(Number)
  if (parts[0] === 10) return true
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
  if (parts[0] === 192 && parts[1] === 168) return true
  return false
}

// ── Types ────────────────────────────────────────────────────

export interface ReconciliationSummary {
  systems: { created: number; updated: number }
  realms: { created: number; updated: number }
  components: { created: number; updated: number; decommissioned: number }
  site: { created: boolean; siteId: string }
  systemDeployments: { created: number; updated: number }
  componentDeployments: { created: number; updated: number }
  routes: { created: number; updated: number; stale: number }
  networkLinks: { created: number; updated: number; stale: number }
  discoveredHosts: {
    created: number
    existing: number
    hosts: { slug: string; ip: string; reachable: boolean; created: boolean }[]
  }
}

interface HostEntity {
  id: string
  slug: string
  name: string
  spec: Record<string, unknown>
  status: Record<string, unknown>
}

// ── Helpers ──────────────────────────────────────────────────

function slugify(s: string, maxLen = 100): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLen)
}

const PROXY_IMAGE_PATTERNS = [
  "traefik:",
  "traefik/",
  "nginx:",
  "nginx/",
  "caddy:",
  "caddy/",
  "haproxy:",
  "haproxy/",
]

function detectProxyEngine(image?: string, name?: string): string | null {
  if (image) {
    for (const pattern of PROXY_IMAGE_PATTERNS) {
      if (image.startsWith(pattern)) return pattern.replace(/[:/]$/, "")
    }
  }
  if (name === "traefik" || name === "reverse-proxy") return "traefik"
  if (name === "nginx") return "nginx"
  if (name === "caddy") return "caddy"
  return null
}

function scanMetadata(extra?: Record<string, string>): EntityMetadata {
  return {
    annotations: { discoveredBy: "scan", ...extra },
  }
}

function isDiscoveredByScan(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false
  const m = metadata as Record<string, unknown>
  const annotations = m.annotations as Record<string, unknown> | undefined
  return annotations?.discoveredBy === "scan"
}

function isDiscoveredByScanOnHost(
  metadata: unknown,
  hostSlug: string
): boolean {
  if (!metadata || typeof metadata !== "object") return false
  const m = metadata as Record<string, unknown>
  const annotations = m.annotations as Record<string, unknown> | undefined
  return (
    annotations?.discoveredBy === "scan" && annotations?.hostSlug === hostSlug
  )
}

// ── Main reconciler ─────────────────────────────────────────

export async function reconcileHostScan(
  db: Database,
  hostEntity: HostEntity,
  scanResult: HostScanResult
): Promise<ReconciliationSummary> {
  const hostSlug = hostEntity.slug
  const hostName = hostEntity.name
  const summary: ReconciliationSummary = {
    systems: { created: 0, updated: 0 },
    realms: { created: 0, updated: 0 },
    components: { created: 0, updated: 0, decommissioned: 0 },
    site: { created: false, siteId: "" },
    systemDeployments: { created: 0, updated: 0 },
    componentDeployments: { created: 0, updated: 0 },
    routes: { created: 0, updated: 0, stale: 0 },
    networkLinks: { created: 0, updated: 0, stale: 0 },
    discoveredHosts: { created: 0, existing: 0, hosts: [] },
  }

  await db.transaction(async (tx) => {
    // ── 1. Determine which Systems we need ──────────────────

    const systemsNeeded = new Map<string, { slug: string; name: string }>()

    // Compose projects → one system each
    for (const proj of scanResult.composeProjects) {
      const slug = slugify(proj.name)
      systemsNeeded.set(slug, { slug, name: proj.name })
    }

    // IIS sites → one system for the host's IIS
    const hasIis = scanResult.services.some((s) => s.realmType === "iis")
    if (hasIis) {
      const slug = `${hostSlug}-iis`
      systemsNeeded.set(slug, { slug, name: `${hostName} IIS` })
    }

    // Catch-all for ungrouped services
    const hasUngrouped = scanResult.services.some(
      (s) => !s.composeProject && s.realmType !== "iis"
    )
    if (hasUngrouped) {
      const slug = `${hostSlug}-services`
      systemsNeeded.set(slug, { slug, name: `${hostName} Services` })
    }

    // ── 2. Upsert Systems ───────────────────────────────────

    const systemIdMap = new Map<string, string>() // slug → id

    for (const [slug, info] of systemsNeeded) {
      const [existing] = await tx
        .select({ id: system.id, metadata: system.metadata })
        .from(system)
        .where(
          and(
            eq(system.slug, slug),
            isNull(system.validTo),
            isNull(system.systemTo)
          )
        )
        .limit(1)

      if (existing) {
        systemIdMap.set(slug, existing.id)
        // Update metadata if not already marked as scan-discovered
        if (!isDiscoveredByScan(existing.metadata)) {
          await tx
            .update(system)
            .set({
              metadata: scanMetadata({ hostSlug }),
              updatedAt: new Date(),
            })
            .where(eq(system.id, existing.id))
        }
        summary.systems.updated++
      } else {
        const id = newId("sys")
        await tx.insert(system).values({
          id,
          slug: info.slug,
          name: info.name,
          spec: {
            namespace: "default",
            lifecycle: "production" as const,
            tags: [],
          },
          metadata: scanMetadata({ hostSlug }),
        })
        systemIdMap.set(slug, id)
        summary.systems.created++
      }
    }

    // ── 3. Upsert Realms ──────────────────────────────────

    for (const rt of scanResult.realms) {
      const slug = `${hostSlug}-${rt.type}`
      const [existing] = await tx
        .select({ id: realm.id })
        .from(realm)
        .where(eq(realm.slug, slug))
        .limit(1)

      const rtSpec: RealmSpec = {
        version: rt.version,
        status: (rt.status === "running"
          ? "ready"
          : "provisioning") as RealmSpec["status"],
      }

      if (existing) {
        await tx
          .update(realm)
          .set({
            spec: rtSpec,
            metadata: scanMetadata({ hostSlug }),
            updatedAt: new Date(),
          })
          .where(eq(realm.id, existing.id))
        summary.realms.updated++
      } else {
        const realmId = newId("rlm")
        await tx.insert(realm).values({
          id: realmId,
          slug,
          name: `${hostName} ${rt.type}`,
          type: rt.type,
          spec: rtSpec,
          metadata: scanMetadata({ hostSlug }),
        })
        await tx.insert(realmHost).values({
          realmId,
          hostId: hostEntity.id,
          role: "single",
        })
        summary.realms.created++
      }
    }

    // ── 4. Upsert Components ────────────────────────────────

    const discoveredComponentSlugs: string[] = []
    // Track componentId → systemSlug for deployment creation
    const componentIdMap = new Map<
      string,
      { id: string; systemSlug: string; svc: (typeof scanResult.services)[0] }
    >()

    for (const svc of scanResult.services) {
      // Determine which system this service belongs to
      let systemSlug: string
      if (svc.composeProject) {
        systemSlug = slugify(svc.composeProject)
      } else if (svc.realmType === "iis") {
        systemSlug = `${hostSlug}-iis`
      } else {
        systemSlug = `${hostSlug}-services`
      }

      const systemId = systemIdMap.get(systemSlug)
      if (!systemId) continue // shouldn't happen

      // Build component slug
      const componentSlug = svc.composeProject
        ? `${slugify(svc.composeProject)}-${slugify(svc.name)}`
        : `${hostSlug}-${slugify(svc.realmType)}-${slugify(svc.name)}`

      discoveredComponentSlugs.push(componentSlug)

      // Build spec with ports
      const ports = svc.ports.map((p) => ({
        name: `port-${p}`,
        port: p,
        protocol: "tcp" as const,
      }))

      const spec = {
        ports,
        ...(svc.image ? { image: svc.image } : {}),
        ...(svc.command ? { command: svc.command } : {}),
      }

      const [existing] = await tx
        .select({ id: component.id, lifecycle: component.lifecycle })
        .from(component)
        .where(
          and(
            eq(component.slug, componentSlug),
            isNull(component.validTo),
            isNull(component.systemTo)
          )
        )
        .limit(1)

      if (existing) {
        const updates: Record<string, unknown> = {
          spec,
          status: svc.status === "running" ? "active" : "inactive",
          metadata: scanMetadata({
            hostSlug,
            scanRealmType: svc.realmType,
            ...(svc.composeProject
              ? { composeProject: svc.composeProject }
              : {}),
          }),
          updatedAt: new Date(),
        }
        // Re-activate if it was decommissioned and has reappeared
        if (existing.lifecycle === "decommissioned") {
          updates.lifecycle = "production"
        }
        await tx
          .update(component)
          .set(updates)
          .where(eq(component.id, existing.id))
        componentIdMap.set(componentSlug, { id: existing.id, systemSlug, svc })
        summary.components.updated++
      } else {
        const componentId = newId("cmp")
        await tx.insert(component).values({
          id: componentId,
          slug: componentSlug,
          name: svc.displayName ?? svc.name,
          type: "service",
          systemId,
          status: svc.status === "running" ? "active" : "inactive",
          lifecycle: "production",
          spec,
          metadata: scanMetadata({
            hostSlug,
            scanRealmType: svc.realmType,
            ...(svc.composeProject
              ? { composeProject: svc.composeProject }
              : {}),
          }),
        })
        componentIdMap.set(componentSlug, { id: componentId, systemSlug, svc })
        summary.components.created++
      }
    }

    // ── 5. Decommission missing components ──────────────────

    // For each system managed by this scan, find components that were
    // previously discovered by scan but are no longer in the scan results.
    for (const [, systemId] of systemIdMap) {
      const existingComponents = await tx
        .select({
          id: component.id,
          slug: component.slug,
          metadata: component.metadata,
          lifecycle: component.lifecycle,
        })
        .from(component)
        .where(
          and(
            eq(component.systemId, systemId),
            isNull(component.validTo),
            isNull(component.systemTo)
          )
        )

      for (const cmp of existingComponents) {
        if (
          isDiscoveredByScanOnHost(cmp.metadata, hostSlug) &&
          cmp.lifecycle !== "decommissioned" &&
          !discoveredComponentSlugs.includes(cmp.slug)
        ) {
          await tx
            .update(component)
            .set({ lifecycle: "decommissioned", updatedAt: new Date() })
            .where(eq(component.id, cmp.id))
          summary.components.decommissioned++
        }
      }
    }

    // ── 6. Upsert Site ─────────────────────────────────────

    const siteSlug = hostSlug
    const [existingSite] = await tx
      .select({ id: site.id })
      .from(site)
      .where(eq(site.slug, siteSlug))
      .limit(1)

    let siteId: string
    if (existingSite) {
      siteId = existingSite.id
      summary.site = { created: false, siteId }
    } else {
      siteId = newId("site")
      await tx.insert(site).values({
        id: siteId,
        slug: siteSlug,
        name: hostName,
        type: "production",
        spec: {},
        status: { phase: "active" } satisfies SiteObservedStatus,
        metadata: scanMetadata({ hostSlug }),
      } as typeof site.$inferInsert)
      summary.site = { created: true, siteId }
    }

    // ── 7. Upsert SystemDeployments ──────────────────────────
    // One SystemDeployment per System on this Site

    const systemDeploymentIdMap = new Map<string, string>() // systemSlug → sdpId

    // Find the primary realm for this host (prefer docker-engine)
    const dockerRealmSlug = `${hostSlug}-docker-engine`
    const [dockerRealm] = await tx
      .select({ id: realm.id })
      .from(realm)
      .where(eq(realm.slug, dockerRealmSlug))
      .limit(1)
    const primaryRealmId = dockerRealm?.id ?? null

    for (const [systemSlug, systemId] of systemIdMap) {
      const sdpSlug = `${systemSlug}-on-${siteSlug}`

      const [existingSdp] = await tx
        .select({ id: systemDeployment.id })
        .from(systemDeployment)
        .where(
          and(
            eq(systemDeployment.siteId, siteId),
            eq(systemDeployment.systemId, systemId),
            isNull(systemDeployment.validTo),
            isNull(systemDeployment.systemTo)
          )
        )
        .limit(1)

      const sdpSpec: SystemDeploymentSpec = {
        runtime: "docker-compose",
        trigger: "manual",
        deploymentStrategy: "rolling",
        labels: {},
      }

      if (existingSdp) {
        systemDeploymentIdMap.set(systemSlug, existingSdp.id)
        await tx
          .update(systemDeployment)
          .set({
            ...(primaryRealmId ? { realmId: primaryRealmId } : {}),
            spec: sdpSpec,
            updatedAt: new Date(),
          })
          .where(eq(systemDeployment.id, existingSdp.id))
        summary.systemDeployments.updated++
      } else {
        const sdpId = newId("sdp")
        await tx.insert(systemDeployment).values({
          id: sdpId,
          slug: sdpSlug,
          name: `${systemsNeeded.get(systemSlug)?.name ?? systemSlug} on ${hostName}`,
          type: "dev",
          systemId,
          siteId,
          ...(primaryRealmId ? { realmId: primaryRealmId } : {}),
          spec: sdpSpec,
          metadata: scanMetadata({ hostSlug }),
        })
        systemDeploymentIdMap.set(systemSlug, sdpId)
        summary.systemDeployments.created++
      }
    }

    // ── 8. Upsert ComponentDeployments ───────────────────────
    // One ComponentDeployment per Component in its SystemDeployment

    for (const [, { id: componentId, systemSlug, svc }] of componentIdMap) {
      const sdpId = systemDeploymentIdMap.get(systemSlug)
      if (!sdpId) continue

      const [existingCdp] = await tx
        .select({ id: componentDeployment.id })
        .from(componentDeployment)
        .where(
          and(
            eq(componentDeployment.systemDeploymentId, sdpId),
            eq(componentDeployment.componentId, componentId)
          )
        )
        .limit(1)

      const cdpSpec: ComponentDeploymentSpec = {
        mode: "deployed",
        replicas: 1,
        envOverrides: {},
        resourceOverrides: {},
        ...(svc.image ? { desiredImage: svc.image } : {}),
      }
      const cdpStatus: ComponentDeploymentObservedStatus = {
        phase: svc.status === "running" ? "running" : "stopped",
        ...(svc.image ? { actualImage: svc.image } : {}),
        driftDetected: false,
      }

      if (existingCdp) {
        await tx
          .update(componentDeployment)
          .set({ spec: cdpSpec, status: cdpStatus, updatedAt: new Date() })
          .where(eq(componentDeployment.id, existingCdp.id))
        summary.componentDeployments.updated++
      } else {
        await tx.insert(componentDeployment).values({
          id: newId("cdp"),
          systemDeploymentId: sdpId,
          componentId,
          spec: cdpSpec,
          status: cdpStatus,
        } as typeof componentDeployment.$inferInsert)
        summary.componentDeployments.created++
      }
    }

    // ── 8b. Upsert reverse-proxy Realms ───────────────────
    // For each discovered reverse proxy, ensure a realm entity exists.

    const proxyRealmIdMap = new Map<string, string>() // proxy.name → realmId

    for (const proxy of scanResult.reverseProxies ?? []) {
      const proxySlug = slugify(`${hostSlug}-${proxy.engine}`)
      const proxyName = `${hostName} ${proxy.engine}`

      const [existingProxy] = await tx
        .select({ id: realm.id })
        .from(realm)
        .where(eq(realm.slug, proxySlug))
        .limit(1)

      const proxySpec = {
        status: "ready" as const,
        endpoint: proxy.apiUrl,
        version: proxy.version,
        engine: proxy.engine,
        entrypoints: proxy.entrypoints.map((ep) => ({
          name: ep.name,
          port: ep.port,
          protocol: ep.protocol as "http" | "https" | "tcp" | "udp",
        })),
      }

      if (existingProxy) {
        await tx
          .update(realm)
          .set({
            spec: proxySpec,
            metadata: scanMetadata({ hostSlug }),
            updatedAt: new Date(),
          })
          .where(eq(realm.id, existingProxy.id))
        proxyRealmIdMap.set(proxy.name, existingProxy.id)
        summary.realms.updated++
      } else {
        const proxyRealmId = newId("rlm")
        await tx.insert(realm).values({
          id: proxyRealmId,
          slug: proxySlug,
          name: proxyName,
          type: "reverse-proxy",
          spec: proxySpec,
          metadata: scanMetadata({ hostSlug }),
        })
        await tx.insert(realmHost).values({
          realmId: proxyRealmId,
          hostId: hostEntity.id,
          role: "single",
        })
        proxyRealmIdMap.set(proxy.name, proxyRealmId)
        summary.realms.created++
      }
    }

    // ── 8c. Upsert Route entities from proxy routers ─────────
    // Each router with domains becomes an ingress Route entity.

    const currentRouterSlugs = new Set<string>()

    // Collect reverse proxies from both the main scan host and crawled hosts.
    // Crawled hosts have their own reverseProxies populated by crawlTraefikViaSsh
    // with backend.container already resolved via containerIpMap.
    const allReverseProxies = [...(scanResult.reverseProxies ?? [])]
    for (const entry of scanResult.networkCrawl?.hostEntries ?? []) {
      const crawledScan = entry.scanResult as HostScanResult | undefined
      if (crawledScan?.reverseProxies) {
        allReverseProxies.push(...crawledScan.reverseProxies)
      }
    }

    for (const proxy of allReverseProxies) {
      const proxyRealmId = proxyRealmIdMap.get(proxy.name)
      if (!proxyRealmId) continue

      const proxySlug = slugify(`${hostSlug}-${proxy.engine}`)
      for (const router of proxy.routers) {
        // Catch-all routers (no Host rule) get domain "*" with lower priority
        const domain = router.domains[0] ?? "*"
        // Scope route slug by proxy so the same domain can exist on multiple
        // Traefik instances (e.g. edge proxy forwarding to a nested proxy).
        const routeSlug =
          domain === "*"
            ? slugify(`${proxySlug}-catchall-${router.name}`)
            : slugify(`${proxySlug}-${domain}`)
        currentRouterSlugs.add(routeSlug)

        // Determine resolution status from crawl data
        let phase: RouteStatus["phase"] = "stale"
        const resolvedTargets: RouteStatus["resolvedTargets"] = []

        // Check if backend was resolved on proxy host (container match).
        // componentSlug must match how the reconciler names components:
        //   `${composeProject}-${composeService}` (see line ~301).
        for (const backend of router.backends) {
          if (backend.container) {
            phase = "resolved"
            const project = slugify(backend.container.composeProject)
            const service = slugify(backend.container.composeService)
            resolvedTargets.push({
              systemDeploymentSlug: backend.container.composeProject,
              componentSlug: `${project}-${service}`,
              address: backend.url,
              port: extractPort(backend.url) ?? 80,
              weight: 100,
              realmType: "docker-compose",
            })
          }
        }

        // Check network crawl data for remote resolution
        if (phase === "stale" && scanResult.networkCrawl) {
          for (const hostEntry of scanResult.networkCrawl.hostEntries) {
            if (!hostEntry.reachable) continue
            for (const rs of hostEntry.resolvedServices) {
              if (rs.routerName === router.name && rs.service) {
                phase = "resolved"
                resolvedTargets.push({
                  systemDeploymentSlug:
                    rs.service.composeProject ?? rs.service.name,
                  componentSlug: rs.service.name,
                  address: `${hostEntry.ip}:${rs.port}`,
                  port: rs.port,
                  weight: 100,
                  realmType: rs.service.realmType,
                })
              }
            }
          }
        }

        const routeSpec: RouteSpec = {
          targetService: router.service,
          targetPort: extractPort(router.backends[0]?.url),
          pathPrefix: router.pathPrefixes[0],
          protocol: router.tls ? "https" : "http",
          status: phase === "resolved" ? "active" : "pending",
          createdBy: "reconciler",
          tlsMode: router.tls?.certResolver,
          priority: domain === "*" ? -1 : (router.priority ?? 0),
          middlewares: router.middlewares.map((m) => ({ name: m })),
        }

        const routeStatus: RouteStatus = {
          phase,
          resolvedTargets,
          resolvedAt: new Date(),
        }

        const [existingRoute] = await tx
          .select({ id: route.id })
          .from(route)
          .where(eq(route.slug, routeSlug))
          .limit(1)

        if (existingRoute) {
          await tx
            .update(route)
            .set({
              spec: routeSpec,
              status: routeStatus as unknown as Record<string, unknown>,
              realmId: proxyRealmId,
              metadata: scanMetadata({ hostSlug }),
              updatedAt: new Date(),
            })
            .where(eq(route.id, existingRoute.id))
          summary.routes.updated++
        } else {
          await tx.insert(route).values({
            id: newId("rte"),
            slug: routeSlug,
            name: domain,
            type: "ingress",
            domain,
            realmId: proxyRealmId,
            spec: routeSpec,
            status: routeStatus as unknown as Record<string, unknown>,
            metadata: scanMetadata({ hostSlug }),
          })
          summary.routes.created++
        }
      }
    }

    // Mark stale routes (previously scan-discovered, no longer present)
    const staleRouteCondition = and(
      sql`${route.metadata}->'annotations'->>'discoveredBy' = 'scan'`,
      sql`${route.metadata}->'annotations'->>'hostSlug' = ${hostSlug}`,
      currentRouterSlugs.size > 0
        ? sql`${route.slug} NOT IN (${sql.join(
            [...currentRouterSlugs].map((s) => sql`${s}`),
            sql`, `
          )})`
        : sql`true`
    )

    const staleRouteRows = await tx
      .update(route)
      .set({
        spec: sql`${route.spec} || '{"status": "expired"}'::jsonb`,
        status: sql`${route.status} || '{"phase": "stale"}'::jsonb`,
        updatedAt: new Date(),
      })
      .where(staleRouteCondition)
      .returning({ id: route.id })

    summary.routes.stale = staleRouteRows.length

    // ── 8c½. Register discovered hosts from network crawl ────
    // Match crawled backend IPs to existing hosts; auto-create unknown ones
    // so that the network link step (8d) can resolve all targets.

    const hostIpAddress = (hostEntity.spec as HostSpec).ipAddress

    for (const entry of scanResult.networkCrawl?.hostEntries ?? []) {
      const ip = entry.ip
      if (ip === hostIpAddress) continue // skip self

      const [existing] = await tx
        .select({ id: host.id, slug: host.slug })
        .from(host)
        .where(sql`${host.spec}->>'ipAddress' = ${ip}`)
        .limit(1)

      if (existing) {
        const ensured = await ensureIp(tx, {
          address: ip,
          spec: {
            scope: isRfc1918Ip(ip) ? "private" : "public",
          },
        })
        await assignIp(tx, ensured.ipAddressId, {
          assignedToKind: "host",
          assignedToId: existing.id,
        })
        summary.discoveredHosts.hosts.push({
          slug: existing.slug,
          ip,
          reachable: entry.reachable,
          created: false,
        })
        summary.discoveredHosts.existing++
        continue
      }

      // Auto-create genuinely unknown host
      const discoveredName = entry.hostname || `host-${ip.replace(/\./g, "-")}`
      const discoveredSlug = slugify(discoveredName)
      const scanningSpec = hostEntity.spec as HostSpec
      const discoveredHostId = newId("host")

      await tx.insert(host).values({
        id: discoveredHostId,
        slug: discoveredSlug,
        name: discoveredName,
        type: "vm",
        spec: {
          hostname: entry.hostname || ip,
          ipAddress: ip,
          os: "linux",
          arch: "amd64",
          accessMethod: "ssh",
          accessUser: scanningSpec.accessUser ?? "root",
          sshPort: 22,
          lifecycle: entry.reachable ? "active" : "offline",
        } satisfies HostSpec,
        metadata: {
          annotations: {
            discoveredBy: "network-crawl",
            discoveredFrom: hostSlug,
            discoveredAt: new Date().toISOString(),
          },
        },
      })

      const ensured = await ensureIp(tx, {
        address: ip,
        spec: {
          scope: isRfc1918Ip(ip) ? "private" : "public",
          role: "primary",
        },
      })
      await assignIp(tx, ensured.ipAddressId, {
        assignedToKind: "host",
        assignedToId: discoveredHostId,
      })

      summary.discoveredHosts.hosts.push({
        slug: discoveredSlug,
        ip,
        reachable: entry.reachable,
        created: true,
      })
      summary.discoveredHosts.created++
    }

    // ── 8c¾. Promote proxy-like services on discovered hosts to realms ──
    // When a discovered host runs a reverse proxy (detected by image/name),
    // create a reverse-proxy realm so the tracer can recurse through it.

    for (const entry of scanResult.networkCrawl?.hostEntries ?? []) {
      if (!entry.reachable) continue
      const ip = entry.ip
      if (ip === hostIpAddress) continue

      // Find the host entity for this crawled IP
      const [targetHost] = await tx
        .select({ id: host.id, slug: host.slug })
        .from(host)
        .where(sql`${host.spec}->>'ipAddress' = ${ip}`)
        .limit(1)
      if (!targetHost) continue

      // Check resolved services for proxy-like images
      // Collect all ports this proxy is listening on from crawl data
      const proxyPorts = new Map<string, Set<number>>() // engine → ports
      for (const rs of entry.resolvedServices) {
        const engine = detectProxyEngine(rs.service?.image, rs.service?.name)
        if (!engine) continue
        const ports = proxyPorts.get(engine) ?? new Set()
        ports.add(rs.port)
        proxyPorts.set(engine, ports)
      }

      for (const [engine, ports] of proxyPorts) {
        const proxySlug = slugify(`${targetHost.slug}-${engine}`)
        if (proxyRealmIdMap.has(proxySlug)) continue

        const [existingProxy] = await tx
          .select({ id: realm.id })
          .from(realm)
          .where(eq(realm.slug, proxySlug))
          .limit(1)

        const entrypoints = [...ports].map((p) => ({
          name: `port-${p}`,
          port: p,
          protocol: "http" as const,
        }))

        const proxySpec = {
          status: "ready" as const,
          engine,
          entrypoints,
        }

        if (existingProxy) {
          await tx
            .update(realm)
            .set({
              spec: proxySpec,
              metadata: scanMetadata({
                hostSlug: targetHost.slug,
                promotedFrom: "network-crawl",
              }),
              updatedAt: new Date(),
            })
            .where(eq(realm.id, existingProxy.id))
          proxyRealmIdMap.set(proxySlug, existingProxy.id)
          summary.realms.updated++
        } else {
          const proxyRealmId = newId("rlm")
          await tx.insert(realm).values({
            id: proxyRealmId,
            slug: proxySlug,
            name: `${targetHost.slug} ${engine}`,
            type: "reverse-proxy",
            spec: proxySpec,
            metadata: scanMetadata({
              hostSlug: targetHost.slug,
              promotedFrom: "network-crawl",
            }),
          })
          await tx.insert(realmHost).values({
            realmId: proxyRealmId,
            hostId: targetHost.id,
            role: "single",
          })
          proxyRealmIdMap.set(proxySlug, proxyRealmId)
          summary.realms.created++
        }
      }
    }

    // ── 8d. Upsert NetworkLink entities for proxy edges ──────
    // Create directed links from reverse-proxy realm to backend hosts.

    const currentLinkSlugs = new Set<string>()

    for (const proxy of scanResult.reverseProxies ?? []) {
      const proxyRealmId = proxyRealmIdMap.get(proxy.name)
      if (!proxyRealmId) continue

      // Group routers by backend host IP
      const hostIpToDomains = new Map<string, string[]>()
      const hostIpToPort = new Map<string, number>()

      for (const router of proxy.routers) {
        for (const backend of router.backends) {
          const hostIp = backend.hostIp ?? extractHost(backend.url)
          if (!hostIp) continue

          const domains = hostIpToDomains.get(hostIp) ?? []
          domains.push(...router.domains)
          hostIpToDomains.set(hostIp, domains)

          const port = extractPort(backend.url)
          if (port) hostIpToPort.set(hostIp, port)
        }
      }

      const proxySlug = slugify(`${hostSlug}-${proxy.engine}`)

      // Create a proxy link for each unique backend host IP
      for (const [backendIp, domains] of hostIpToDomains) {
        const isLocalBackend = hostIpAddress && backendIp === hostIpAddress

        // For same-host backends, create a host-local link to docker-engine realm
        if (isLocalBackend && primaryRealmId) {
          const linkSlug = slugify(`${proxySlug}-to-${hostSlug}-docker`)
          currentLinkSlugs.add(linkSlug)

          const linkSpec: NetworkLinkSpec = {
            egressPort: hostIpToPort.get(backendIp),
            egressProtocol: "http",
            match: {
              hosts: [...new Set(domains)],
              pathPrefixes: [],
              headers: {},
              sni: [],
            },
            bidirectional: false,
            enabled: true,
            priority: 0,
            middlewares: [],
          }

          const [existingLink] = await tx
            .select({ id: networkLink.id })
            .from(networkLink)
            .where(eq(networkLink.slug, linkSlug))
            .limit(1)

          if (existingLink) {
            await tx
              .update(networkLink)
              .set({
                spec: linkSpec,
                metadata: scanMetadata({ hostSlug }),
                updatedAt: new Date(),
              })
              .where(eq(networkLink.id, existingLink.id))
            summary.networkLinks.updated++
          } else {
            await tx.insert(networkLink).values({
              id: newId("nlnk"),
              slug: linkSlug,
              name: `${proxySlug} → ${hostSlug}-docker`,
              type: "host-local",
              sourceKind: "realm",
              sourceId: proxyRealmId,
              targetKind: "realm",
              targetId: primaryRealmId,
              spec: linkSpec,
              metadata: scanMetadata({ hostSlug }),
            })
            summary.networkLinks.created++
          }
          continue
        }

        // For remote backends, resolve the target host entity by IP
        // TODO: Add GIN index on host.spec->>'ipAddress' when host count grows large
        const [targetHost] = await tx
          .select({ id: host.id, slug: host.slug })
          .from(host)
          .where(sql`${host.spec}->>'ipAddress' = ${backendIp}`)
          .limit(1)

        // Skip links where target host can't be resolved — we can't create a meaningful edge
        if (!targetHost) continue

        const linkSlug = slugify(`${proxySlug}-to-${targetHost.slug}`)
        currentLinkSlugs.add(linkSlug)

        const linkSpec: NetworkLinkSpec = {
          egressPort: hostIpToPort.get(backendIp),
          egressProtocol: "http",
          match: {
            hosts: [...new Set(domains)],
            pathPrefixes: [],
            headers: {},
            sni: [],
          },
          bidirectional: false,
          enabled: true,
          priority: 0,
          middlewares: [],
        }

        const [existingLink] = await tx
          .select({ id: networkLink.id })
          .from(networkLink)
          .where(eq(networkLink.slug, linkSlug))
          .limit(1)

        if (existingLink) {
          await tx
            .update(networkLink)
            .set({
              spec: linkSpec,
              metadata: scanMetadata({ hostSlug }),
              updatedAt: new Date(),
            })
            .where(eq(networkLink.id, existingLink.id))
          summary.networkLinks.updated++
        } else {
          await tx.insert(networkLink).values({
            id: newId("nlnk"),
            slug: linkSlug,
            name: `${proxySlug} → ${targetHost.slug}`,
            type: "proxy",
            sourceKind: "realm",
            sourceId: proxyRealmId,
            targetKind: "host",
            targetId: targetHost.id,
            spec: linkSpec,
            metadata: scanMetadata({ hostSlug }),
          })
          summary.networkLinks.created++
        }
      }
    }

    // ── 9. Update host status with scan metadata ────────────

    const currentStatus = (hostEntity.status ?? {}) as Record<string, unknown>
    const scanHistory = Array.isArray(currentStatus.scanHistory)
      ? [...currentStatus.scanHistory]
      : []

    scanHistory.unshift({
      scannedAt: scanResult.scannedAt,
      portCount: scanResult.ports.length,
      serviceCount: scanResult.services.length,
      realmCount: scanResult.realms.length,
      composeProjectCount: scanResult.composeProjects.length,
    })
    if (scanHistory.length > 50) scanHistory.length = 50

    if (scanResult.ipAddress) {
      const ensured = await ensureIp(tx, {
        address: scanResult.ipAddress,
        spec: {
          scope: isRfc1918Ip(scanResult.ipAddress) ? "private" : "public",
          role: "primary",
        },
      })
      await assignIp(tx, ensured.ipAddressId, {
        assignedToKind: "host",
        assignedToId: hostEntity.id,
      })
    }

    // Merge ipAddress/hostname into host spec if provided and changed
    const currentSpec = hostEntity.spec as HostSpec
    let updatedSpec: HostSpec | undefined
    if (
      (scanResult.ipAddress &&
        currentSpec.ipAddress !== scanResult.ipAddress) ||
      (scanResult.hostname && currentSpec.hostname !== scanResult.hostname)
    ) {
      updatedSpec = {
        ...currentSpec,
        ...(scanResult.ipAddress ? { ipAddress: scanResult.ipAddress } : {}),
        ...(scanResult.hostname ? { hostname: scanResult.hostname } : {}),
      }
    }

    await tx
      .update(host)
      .set({
        ...(updatedSpec ? { spec: updatedSpec } : {}),
        status: {
          ...currentStatus,
          lastScan: {
            at: scanResult.scannedAt,
            durationMs: scanResult.scanDurationMs,
            portCount: scanResult.ports.length,
            serviceCount: scanResult.services.length,
            realmCount: scanResult.realms.length,
            composeProjects: scanResult.composeProjects.map((p) => p.name),
            ports: scanResult.ports,
            collectors: scanResult.collectors,
          },
          scanHistory,
        },
        updatedAt: new Date(),
      })
      .where(eq(host.id, hostEntity.id))
  })

  return summary
}
