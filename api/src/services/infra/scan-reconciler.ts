/**
 * Scan reconciler — maps raw host scan results into the Factory ontology.
 *
 * Creates/updates Systems, Runtimes, and Components from discovered services.
 * Decommissions entities that disappear between scans.
 * All scan-created entities are annotated with `metadata.annotations.discoveredBy = "scan"`.
 */
import type { EntityMetadata } from "@smp/factory-shared/schemas/common"
import type {
  HostScanResult,
  HostSpec,
  RuntimeSpec,
} from "@smp/factory-shared/schemas/infra"
import type {
  ComponentDeploymentSpec,
  SystemDeploymentSpec,
} from "@smp/factory-shared/schemas/ops"
import { and, eq, isNull } from "drizzle-orm"

import type { Database } from "../../db/connection"
import { host, runtime } from "../../db/schema/infra-v2"
import {
  componentDeployment,
  site,
  systemDeployment,
} from "../../db/schema/ops"
import { component, system } from "../../db/schema/software-v2"
import { newId } from "../../lib/id"

// ── Types ────────────────────────────────────────────────────

export interface ReconciliationSummary {
  systems: { created: number; updated: number }
  runtimes: { created: number; updated: number }
  components: { created: number; updated: number; decommissioned: number }
  site: { created: boolean; siteId: string }
  systemDeployments: { created: number; updated: number }
  componentDeployments: { created: number; updated: number }
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
    runtimes: { created: 0, updated: 0 },
    components: { created: 0, updated: 0, decommissioned: 0 },
    site: { created: false, siteId: "" },
    systemDeployments: { created: 0, updated: 0 },
    componentDeployments: { created: 0, updated: 0 },
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
    const hasIis = scanResult.services.some((s) => s.runtime === "iis")
    if (hasIis) {
      const slug = `${hostSlug}-iis`
      systemsNeeded.set(slug, { slug, name: `${hostName} IIS` })
    }

    // Catch-all for ungrouped services
    const hasUngrouped = scanResult.services.some(
      (s) => !s.composeProject && s.runtime !== "iis"
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

    // ── 3. Upsert Runtimes ──────────────────────────────────

    for (const rt of scanResult.runtimes) {
      const slug = `${hostSlug}-${rt.type}`
      const [existing] = await tx
        .select({ id: runtime.id })
        .from(runtime)
        .where(eq(runtime.slug, slug))
        .limit(1)

      const rtSpec: RuntimeSpec = {
        version: rt.version,
        status: (rt.status === "running"
          ? "ready"
          : "provisioning") as RuntimeSpec["status"],
      }

      if (existing) {
        await tx
          .update(runtime)
          .set({
            spec: rtSpec,
            metadata: scanMetadata({ hostSlug }),
            updatedAt: new Date(),
          })
          .where(eq(runtime.id, existing.id))
        summary.runtimes.updated++
      } else {
        await tx.insert(runtime).values({
          slug,
          name: `${hostName} ${rt.type}`,
          type: rt.type,
          hostId: hostEntity.id,
          spec: rtSpec,
          metadata: scanMetadata({ hostSlug }),
        })
        summary.runtimes.created++
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
      } else if (svc.runtime === "iis") {
        systemSlug = `${hostSlug}-iis`
      } else {
        systemSlug = `${hostSlug}-services`
      }

      const systemId = systemIdMap.get(systemSlug)
      if (!systemId) continue // shouldn't happen

      // Build component slug
      const componentSlug = svc.composeProject
        ? `${slugify(svc.composeProject)}-${slugify(svc.name)}`
        : `${hostSlug}-${slugify(svc.runtime)}-${slugify(svc.name)}`

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
            scanRuntime: svc.runtime,
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
            scanRuntime: svc.runtime,
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

    // ── 6. Upsert Site (host → deployment target) ──────────

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
        spec: {
          type: "on-prem" as const,
          status: "active" as const,
        },
        metadata: scanMetadata({ hostSlug }),
      })
      summary.site = { created: true, siteId }
    }

    // ── 7. Upsert SystemDeployments ──────────────────────────
    // One SystemDeployment per System on this Site

    const systemDeploymentIdMap = new Map<string, string>() // systemSlug → sdpId

    // Find the primary runtime for this host (prefer docker-engine)
    const dockerRuntimeSlug = `${hostSlug}-docker-engine`
    const [dockerRuntime] = await tx
      .select({ id: runtime.id })
      .from(runtime)
      .where(eq(runtime.slug, dockerRuntimeSlug))
      .limit(1)
    const primaryRuntimeId = dockerRuntime?.id ?? null

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
        status: "active",
        runtime: "compose",
        trigger: "manual",
        deploymentStrategy: "rolling",
        labels: {},
      }

      if (existingSdp) {
        systemDeploymentIdMap.set(systemSlug, existingSdp.id)
        await tx
          .update(systemDeployment)
          .set({
            ...(primaryRuntimeId ? { runtimeId: primaryRuntimeId } : {}),
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
          ...(primaryRuntimeId ? { runtimeId: primaryRuntimeId } : {}),
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
        status: svc.status === "running" ? "running" : "stopped",
        replicas: 1,
        envOverrides: {},
        resourceOverrides: {},
        driftDetected: false,
        ...(svc.image
          ? { desiredImage: svc.image, actualImage: svc.image }
          : {}),
      }

      if (existingCdp) {
        await tx
          .update(componentDeployment)
          .set({ spec: cdpSpec, updatedAt: new Date() })
          .where(eq(componentDeployment.id, existingCdp.id))
        summary.componentDeployments.updated++
      } else {
        await tx.insert(componentDeployment).values({
          id: newId("cdp"),
          systemDeploymentId: sdpId,
          componentId,
          spec: cdpSpec,
        })
        summary.componentDeployments.created++
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
      runtimeCount: scanResult.runtimes.length,
      composeProjectCount: scanResult.composeProjects.length,
    })
    if (scanHistory.length > 50) scanHistory.length = 50

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
            runtimeCount: scanResult.runtimes.length,
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
