/**
 * Product controller.
 *
 * Route → table mapping:
 *   /product/systems      → software.system
 *   /product/components   → software.component
 *   /product/apis         → software.api
 *   /product/artifacts    → software.artifact
 *   /product/releases     → software.release
 *   /product/templates    → software.template
 *   /product/products     → software.product
 *   /product/capabilities → software.capability
 */
import { PromoteReleaseBody } from "@smp/factory-shared/schemas/actions"
import {
  CreateApiSchema,
  CreateArtifactSchema,
  CreateCapabilitySchema,
  CreateComponentSchema,
  CreateProductSchema,
  CreateReleaseSchema,
  CreateSystemSchema,
  CreateTemplateSchema,
  UpdateApiSchema,
  UpdateArtifactSchema,
  UpdateCapabilitySchema,
  UpdateComponentSchema,
  UpdateProductSchema,
  UpdateReleaseSchema,
  UpdateSystemSchema,
  UpdateTemplateSchema,
} from "@smp/factory-shared/schemas/software"
import { eq } from "drizzle-orm"
import { Elysia } from "elysia"
import { z } from "zod"

import type { Database } from "../../db/connection"
import {
  artifact,
  capability,
  component,
  product,
  release,
  softwareApi,
  system,
  template,
} from "../../db/schema/software-v2"
import { ontologyRoutes } from "../../lib/crud"

const GenerateReleaseContentBody = z.object({
  config: z.record(z.unknown()).optional(),
})
type GenerateReleaseContentBody = z.infer<typeof GenerateReleaseContentBody>

export function productControllerV2(db: Database) {
  return new Elysia({ prefix: "/product" })
    .use(
      ontologyRoutes(db, {
        schema: "software",
        entity: "systems",
        singular: "system",
        table: system,
        slugColumn: system.slug,
        idColumn: system.id,
        createSchema: CreateSystemSchema,
        updateSchema: UpdateSystemSchema,
        deletable: "bitemporal",
        bitemporal: { validTo: system.validTo, systemTo: system.systemTo },
        relations: {
          components: {
            path: "components",
            table: component,
            fk: component.systemId,
            bitemporal: {
              validTo: component.validTo,
              systemTo: component.systemTo,
            },
          },
          apis: {
            path: "apis",
            table: softwareApi,
            fk: softwareApi.systemId,
          },
          releases: {
            path: "releases",
            table: release,
            fk: release.systemId,
          },
        },
      })
    )
    .use(
      ontologyRoutes(db, {
        schema: "software",
        entity: "components",
        singular: "component",
        table: component,
        slugColumn: component.slug,
        idColumn: component.id,
        createSchema: CreateComponentSchema,
        updateSchema: UpdateComponentSchema,
        deletable: "bitemporal",
        bitemporal: {
          validTo: component.validTo,
          systemTo: component.systemTo,
        },
        relations: {
          artifacts: {
            path: "artifacts",
            table: artifact,
            fk: artifact.componentId,
          },
        },
      })
    )
    .use(
      ontologyRoutes(db, {
        schema: "software",
        entity: "apis",
        singular: "api",
        table: softwareApi,
        slugColumn: softwareApi.slug,
        idColumn: softwareApi.id,
        createSchema: CreateApiSchema,
        updateSchema: UpdateApiSchema,
        deletable: true,
      })
    )
    .use(
      ontologyRoutes(db, {
        schema: "software",
        entity: "artifacts",
        singular: "artifact",
        table: artifact,
        slugColumn: artifact.slug,
        idColumn: artifact.id,
        createSchema: CreateArtifactSchema,
        updateSchema: UpdateArtifactSchema,
        deletable: true,
      })
    )
    .use(
      ontologyRoutes(db, {
        schema: "software",
        entity: "releases",
        singular: "release",
        table: release,
        slugColumn: release.slug,
        idColumn: release.id,
        createSchema: CreateReleaseSchema,
        updateSchema: UpdateReleaseSchema,
        deletable: true,
        actions: {
          generate: {
            bodySchema: GenerateReleaseContentBody,
            handler: async ({ db, entity, body }) => {
              const b = body as GenerateReleaseContentBody
              const spec = entity.spec as Record<string, unknown>
              const [row] = await db
                .update(release)
                .set({
                  spec: {
                    ...spec,
                    contentGeneration: { status: "pending", config: b.config },
                  } as any,
                  updatedAt: new Date(),
                })
                .where(eq(release.id, entity.id as string))
                .returning()
              return row
            },
          },
          promote: {
            bodySchema: PromoteReleaseBody,
            handler: async ({ db, entity, body }) => {
              const b = body as PromoteReleaseBody
              const spec = entity.spec as Record<string, unknown>
              const [row] = await db
                .update(release)
                .set({
                  spec: {
                    ...spec,
                    promoted: true,
                    promotionStrategy: b.strategy,
                    targetSites: b.targetSites,
                  } as any,
                  updatedAt: new Date(),
                })
                .where(eq(release.id, entity.id as string))
                .returning()
              return row
            },
          },
        },
      })
    )
    .use(
      ontologyRoutes(db, {
        schema: "software",
        entity: "templates",
        singular: "template",
        table: template,
        slugColumn: template.slug,
        idColumn: template.id,
        createSchema: CreateTemplateSchema,
        updateSchema: UpdateTemplateSchema,
        deletable: true,
      })
    )
    .use(
      ontologyRoutes(db, {
        schema: "software",
        entity: "products",
        singular: "product",
        table: product,
        slugColumn: product.slug,
        idColumn: product.id,
        createSchema: CreateProductSchema,
        updateSchema: UpdateProductSchema,
        deletable: true,
        relations: {
          capabilities: {
            path: "capabilities",
            table: capability,
            fk: capability.productId,
          },
        },
      })
    )
    .use(
      ontologyRoutes(db, {
        schema: "software",
        entity: "capabilities",
        singular: "capability",
        table: capability,
        slugColumn: capability.slug,
        idColumn: capability.id,
        createSchema: CreateCapabilitySchema,
        updateSchema: UpdateCapabilitySchema,
        deletable: true,
      })
    )
}
