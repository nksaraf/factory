const VALID_MODES = new Set(["native", "container", "service", "linked"])

function mapMode(raw: string): string {
  if (VALID_MODES.has(raw)) return raw
  if (raw === "deployed") return "container"
  return "container"
}

import { eq } from "drizzle-orm"

import type { Database } from "../../db/connection"
import {
  componentDeployment,
  site,
  systemDeployment,
} from "../../db/schema/ops"
import { component } from "../../db/schema/software"

export async function getSiteState(db: Database, slugOrId: string) {
  const [siteRow] = await db
    .select()
    .from(site)
    .where(eq(site.slug, slugOrId))
    .limit(1)

  if (!siteRow) return null

  const siteSpec = (siteRow.spec ?? {}) as Record<string, unknown>
  const siteStatus = (siteRow.status ?? {}) as Record<string, unknown>

  const sds = await db
    .select()
    .from(systemDeployment)
    .where(eq(systemDeployment.siteId, siteRow.id))

  const sdStates = await Promise.all(
    sds.map(async (sd) => {
      const sdSpec = (sd.spec ?? {}) as Record<string, unknown>

      const cds = await db
        .select({
          cd: componentDeployment,
          componentSlug: component.slug,
        })
        .from(componentDeployment)
        .innerJoin(component, eq(componentDeployment.componentId, component.id))
        .where(eq(componentDeployment.systemDeploymentId, sd.id))

      return {
        slug: sd.slug,
        systemSlug: sd.name,
        runtime: (sdSpec.runtime as string) ?? "docker-compose",
        composeFiles: (sdSpec.composeFiles as string[]) ?? [],
        componentDeployments: cds.map(({ cd, componentSlug }) => {
          const spec = (cd.spec ?? {}) as Record<string, unknown>
          const status = (cd.status ?? {}) as Record<string, unknown>
          return {
            componentSlug,
            mode: mapMode((spec.mode as string) ?? "container"),
            spec: {
              generation: cd.generation ?? 1,
              desiredImage: spec.desiredImage as string | undefined,
              replicas: (spec.replicas as number) ?? 1,
            },
            status: {
              observedGeneration: cd.observedGeneration,
              phase: (status.phase as string) ?? "pending",
              conditions: (status.conditions as unknown[]) ?? [],
            },
          }
        }),
        resolvedEnv: {},
        tunnels: [],
      }
    })
  )

  return {
    spec: {
      site: { slug: siteRow.slug, type: siteRow.type },
      workbench: { slug: siteRow.slug, type: "vm", ownerType: "user" },
      mode: (siteSpec.mode as string) ?? "up",
      systemDeployments: sdStates,
    },
    status: {
      phase: (siteStatus.phase as string) ?? "pending",
      conditions: (siteStatus.conditions as unknown[]) ?? [],
      updatedAt: siteRow.updatedAt?.toISOString() ?? new Date().toISOString(),
    },
  }
}
