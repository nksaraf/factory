/** HTTP routes under `/api/v1/factory/ops/*` backed by the `ops` Postgres schema. */
import {
  AssignReleaseBody,
  CloneSnapshotBody,
  DatabaseOperationBody,
  DeliverPreviewImageBody,
  ExtendPreviewBody,
  ExtendWorkbenchBody,
  ResizeWorkbenchBody,
  RestartComponentDeploymentBody,
  RestoreSnapshotBody,
  ScaleComponentDeploymentBody,
  SiteCheckinBody,
  SnapshotWorkbenchBody,
  UpdatePreviewStatusBody,
  UpdateRolloutStatusBody,
  WorkbenchPingBody,
} from "@smp/factory-shared/schemas/actions"
import {
  CreateAnonymizationProfileSchema,
  CreateComponentDeploymentSchema,
  CreateConnectionAuditEventSchema,
  CreateDatabaseOperationSchema,
  CreateDatabaseSchema,
  CreateDeploymentSetSchema,
  CreateForwardedPortSchema,
  CreateInstallManifestSchema,
  CreateInterventionSchema,
  CreatePreviewSchema,
  CreateRolloutSchema,
  CreateSiteManifestSchema,
  CreateSiteSchema,
  CreateSystemDeploymentSchema,
  CreateTenantSchema,
  CreateWorkbenchSchema,
  UpdateAnonymizationProfileSchema,
  UpdateComponentDeploymentSchema,
  UpdateConnectionAuditEventSchema,
  UpdateDatabaseSchema,
  UpdateDeploymentSetSchema,
  UpdateInstallManifestSchema,
  UpdatePreviewSchema,
  UpdateRolloutSchema,
  UpdateSiteManifestSchema,
  UpdateSiteSchema,
  UpdateSystemDeploymentSchema,
  UpdateTenantSchema,
  UpdateWorkbenchSchema,
} from "@smp/factory-shared/schemas/ops"
import type {
  ComponentDeploymentSpec,
  DatabaseOperationSpec,
  InstallManifestSpec,
  InterventionSpec,
  PreviewSpec,
  RolloutSpec,
  SiteSpec,
  SystemDeploymentSpec,
  WorkbenchSpec,
} from "@smp/factory-shared/schemas/ops"
import { eq } from "drizzle-orm"
import { desc } from "drizzle-orm"
import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import { realm } from "../../db/schema/infra-v2"
import {
  anonymizationProfile,
  componentDeployment,
  connectionAuditEvent,
  databaseOperation,
  deploymentSet,
  forwardedPort,
  installManifest,
  intervention,
  opsDatabase,
  preview,
  rollout,
  site,
  siteManifest,
  systemDeployment,
  tenant,
  workbench,
  workbenchSnapshot,
} from "../../db/schema/ops"
import { principal } from "../../db/schema/org-v2"
import { ontologyRoutes } from "../../lib/crud"
import { newId } from "../../lib/id"
import {
  countRows,
  paginationMeta,
  parsePagination,
} from "../../lib/pagination"
import { list, ok } from "../../lib/responses"
import {
  cloneFromSnapshot,
  getSnapshot,
  restoreFromSnapshot,
} from "./snapshot.service"
import {
  resizeWorkbench,
  resolveDefaultRealm,
  updateWorkbenchHealth,
} from "./workbench.service"

export function opsControllerV2(db: Database) {
  return (
    new Elysia({ prefix: "/ops" })

      // ── Sites ──────────────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "ops",
          entity: "sites",
          singular: "site",
          table: site,
          slugColumn: site.slug,
          idColumn: site.id,
          createSchema: CreateSiteSchema,
          updateSchema: UpdateSiteSchema,
          deletable: "bitemporal",
          bitemporal: { validTo: site.validTo, systemTo: site.systemTo },
          relations: {
            tenants: {
              path: "tenants",
              table: tenant,
              fk: tenant.siteId,
              bitemporal: {
                validTo: tenant.validTo,
                systemTo: tenant.systemTo,
              },
            },
          },
          actions: {
            checkin: {
              bodySchema: SiteCheckinBody,
              handler: async ({ db, entity, body }) => {
                const b = body as SiteCheckinBody
                // Upsert install manifest for this site
                const siteId = entity.id as string
                const specData: InstallManifestSpec = {
                  installState: b.installState ?? {},
                  lastCheckinAt: new Date(),
                  currentVersion: b.currentVersion,
                }
                const [manifest] = await db
                  .insert(installManifest)
                  .values({
                    id: newId("imfst"),
                    siteId,
                    spec: specData,
                  })
                  .onConflictDoUpdate({
                    target: installManifest.siteId,
                    set: { spec: specData, updatedAt: new Date() },
                  })
                  .returning()
                return manifest
              },
            },
            "assign-release": {
              bodySchema: AssignReleaseBody,
              handler: async ({ db, entity, body }) => {
                const b = body as AssignReleaseBody
                const spec = entity.spec as SiteSpec
                const [row] = await db
                  .update(site)
                  .set({
                    spec: {
                      ...spec,
                      assignedRelease: b.releaseVersion,
                    } as SiteSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(site.id, entity.id as string))
                  .returning()
                return row
              },
            },
          },
        })
      )

      // ── Tenants ────────────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "ops",
          entity: "tenants",
          singular: "tenant",
          table: tenant,
          slugColumn: tenant.slug,
          idColumn: tenant.id,
          createSchema: CreateTenantSchema,
          updateSchema: UpdateTenantSchema,
          deletable: "bitemporal",
          bitemporal: { validTo: tenant.validTo, systemTo: tenant.systemTo },
          relations: {
            "system-deployments": {
              path: "system-deployments",
              table: systemDeployment,
              fk: systemDeployment.tenantId,
              bitemporal: {
                validTo: systemDeployment.validTo,
                systemTo: systemDeployment.systemTo,
              },
            },
          },
        })
      )

      // ── System Deployments ─────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "ops",
          entity: "system-deployments",
          singular: "system deployment",
          table: systemDeployment,
          slugColumn: systemDeployment.slug,
          idColumn: systemDeployment.id,
          createSchema: CreateSystemDeploymentSchema,
          updateSchema: UpdateSystemDeploymentSchema,
          deletable: "bitemporal",
          bitemporal: {
            validTo: systemDeployment.validTo,
            systemTo: systemDeployment.systemTo,
          },
          relations: {
            "deployment-sets": {
              path: "deployment-sets",
              table: deploymentSet,
              fk: deploymentSet.systemDeploymentId,
            },
            "component-deployments": {
              path: "component-deployments",
              table: componentDeployment,
              fk: componentDeployment.systemDeploymentId,
            },
            rollouts: {
              path: "rollouts",
              table: rollout,
              fk: rollout.systemDeploymentId,
            },
            interventions: {
              path: "interventions",
              table: intervention,
              fk: intervention.systemDeploymentId,
            },
          },
        })
      )

      // ── Deployment Sets ────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "ops",
          entity: "deployment-sets",
          singular: "deployment set",
          table: deploymentSet,
          slugColumn: deploymentSet.slug,
          idColumn: deploymentSet.id,
          createSchema: CreateDeploymentSetSchema,
          updateSchema: UpdateDeploymentSetSchema,
          deletable: true,
          relations: {
            "component-deployments": {
              path: "component-deployments",
              table: componentDeployment,
              fk: componentDeployment.deploymentSetId,
            },
          },
        })
      )

      // ── Rollouts ───────────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "ops",
          entity: "rollouts",
          singular: "rollout",
          table: rollout,
          slugColumn: rollout.id, // rollouts don't have slugs — use id for both
          idColumn: rollout.id,
          createSchema: CreateRolloutSchema,
          updateSchema: UpdateRolloutSchema,
          actions: {
            "update-status": {
              bodySchema: UpdateRolloutStatusBody,
              handler: async ({ db, entity, body }) => {
                const b = body as UpdateRolloutStatusBody
                const spec = entity.spec as RolloutSpec
                const now = new Date()
                const updates: RolloutSpec = { ...spec, status: b.status }
                if (b.status === "in_progress" && !spec.startedAt)
                  updates.startedAt = now
                if (["succeeded", "failed", "rolled_back"].includes(b.status))
                  updates.completedAt = now
                const [row] = await db
                  .update(rollout)
                  .set({ spec: updates, updatedAt: now })
                  .where(eq(rollout.id, entity.id as string))
                  .returning()
                return row
              },
            },
          },
        })
      )

      // ── Workbenches (cloud) ────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "ops",
          entity: "workbenches",
          singular: "workbench",
          table: workbench,
          slugColumn: workbench.slug,
          idColumn: workbench.id,
          createSchema: CreateWorkbenchSchema,
          updateSchema: UpdateWorkbenchSchema,
          deletable: "bitemporal",
          bitemporal: {
            validTo: workbench.validTo,
            systemTo: workbench.systemTo,
          },
          hooks: {
            beforeCreate: async ({ db, parsed }) => {
              // Auto-assign default realm if none provided
              if (!parsed.realmId) {
                const realmId = await resolveDefaultRealm(db)
                if (realmId) {
                  parsed.realmId = realmId
                } else {
                  throw new Error(
                    "No cluster registered. Run `dx setup --role factory` to bootstrap a cluster."
                  )
                }
              }
              // Auto-create principal if it doesn't exist (local dev convenience)
              if (parsed.ownerId) {
                const [existingPrincipal] = await db
                  .select({ id: principal.id })
                  .from(principal)
                  .where(eq(principal.id, parsed.ownerId as string))
                  .limit(1)
                if (!existingPrincipal) {
                  await db
                    .insert(principal)
                    .values({
                      id: parsed.ownerId,
                      slug: parsed.ownerId,
                      name: parsed.ownerId,
                      type: "human",
                      spec: { status: "active" },
                    } as any)
                    .onConflictDoNothing()
                }
              }
              // Ensure spec has provisioning defaults
              const spec = (parsed.spec ?? {}) as Record<string, unknown>
              if (!spec.lifecycle) spec.lifecycle = "provisioning"
              if (!spec.realmType) spec.realmType = "container"
              parsed.spec = spec
              return parsed
            },
          },
          relations: {
            snapshots: {
              path: "snapshots",
              table: workbenchSnapshot,
              fk: workbenchSnapshot.workbenchId,
            },
            "forwarded-ports": {
              path: "forwarded-ports",
              table: forwardedPort,
              fk: forwardedPort.workbenchId,
            },
          },
          actions: {
            start: {
              handler: async ({ db, entity }) => {
                const spec = entity.spec as WorkbenchSpec
                const [row] = await db
                  .update(workbench)
                  .set({
                    spec: { ...spec, lifecycle: "active" },
                    updatedAt: new Date(),
                  })
                  .where(eq(workbench.id, entity.id as string))
                  .returning()
                return row
              },
            },
            stop: {
              handler: async ({ db, entity }) => {
                const spec = entity.spec as WorkbenchSpec
                const [row] = await db
                  .update(workbench)
                  .set({
                    spec: { ...spec, lifecycle: "suspended" },
                    updatedAt: new Date(),
                  })
                  .where(eq(workbench.id, entity.id as string))
                  .returning()
                return row
              },
            },
            destroy: {
              handler: async ({ db, entity }) => {
                const spec = entity.spec as WorkbenchSpec
                const [row] = await db
                  .update(workbench)
                  .set({
                    spec: { ...spec, lifecycle: "destroying" },
                    updatedAt: new Date(),
                  })
                  .where(eq(workbench.id, entity.id as string))
                  .returning()
                return row
              },
            },
            extend: {
              bodySchema: ExtendWorkbenchBody,
              handler: async ({ db, entity, body }) => {
                const b = body as ExtendWorkbenchBody
                const spec = entity.spec as WorkbenchSpec
                const currentExpiry = spec.expiresAt
                  ? new Date(spec.expiresAt as unknown as string)
                  : new Date()
                const newExpiry = new Date(
                  currentExpiry.getTime() + b.minutes * 60_000
                )
                const [row] = await db
                  .update(workbench)
                  .set({
                    spec: { ...spec, expiresAt: newExpiry },
                    updatedAt: new Date(),
                  })
                  .where(eq(workbench.id, entity.id as string))
                  .returning()
                return row
              },
            },
            snapshot: {
              bodySchema: SnapshotWorkbenchBody,
              handler: async ({ db, entity, body }) => {
                const b = body as SnapshotWorkbenchBody
                const [snap] = await db
                  .insert(workbenchSnapshot)
                  .values({
                    id: newId("wbsnap"),
                    workbenchId: entity.id as string,
                    spec: { status: "creating", volumeSnapshotName: b.name },
                  })
                  .returning()
                return snap
              },
            },
            resize: {
              bodySchema: ResizeWorkbenchBody,
              handler: async ({ db, entity, body }) => {
                const b = body as ResizeWorkbenchBody
                return resizeWorkbench(db, entity.id as string, b)
              },
            },
            "health-check": {
              handler: async ({ db, entity }) => {
                const spec = (entity.spec ?? {}) as WorkbenchSpec
                return {
                  status: spec.healthStatus ?? "unknown",
                  checkedAt: null,
                }
              },
            },
            ping: {
              bodySchema: WorkbenchPingBody,
              handler: async ({ db, entity, body }) => {
                const b = body as WorkbenchPingBody
                const spec = entity.spec as WorkbenchSpec
                const [row] = await db
                  .update(workbench)
                  .set({
                    spec: {
                      ...spec,
                      lastSeenAt: new Date(),
                      ...(b.hostname && { hostname: b.hostname }),
                      ...(b.os && { os: b.os }),
                      ...(b.arch && { arch: b.arch }),
                      ...(b.nodes && { nodes: b.nodes }),
                      ...(b.connectedResources && {
                        connectedResources: b.connectedResources,
                      }),
                    } as WorkbenchSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(workbench.id, entity.id as string))
                  .returning()
                return row
              },
            },
          },
        })
      )

      // ── Workbench Snapshots ─────────────────────────────────
      .get(
        "/workbench-snapshots",
        async ({ query }) => {
          const { limit, offset } = parsePagination({
            limit: Number(query.limit) || undefined,
            offset: Number(query.offset) || undefined,
          })
          const total = await countRows(db, workbenchSnapshot)
          const rows = await db
            .select()
            .from(workbenchSnapshot)
            .orderBy(desc(workbenchSnapshot.createdAt))
            .limit(limit)
            .offset(offset)
          return list(rows, paginationMeta(total, { limit, offset }))
        },
        {
          detail: {
            tags: ["ops/workbench-snapshots"],
            summary: "List workbench snapshots",
          },
        }
      )
      .get(
        "/workbench-snapshots/:id",
        async ({ params, set }) => {
          const snap = await getSnapshot(db, params.id)
          if (!snap) {
            set.status = 404
            return { success: false, error: "Snapshot not found" }
          }
          return ok(snap)
        },
        {
          detail: {
            tags: ["ops/workbench-snapshots"],
            summary: "Get workbench snapshot",
          },
        }
      )
      .post(
        "/workbench-snapshots/:id/restore",
        async ({ params, body, set }) => {
          const b = RestoreSnapshotBody.parse(body)
          const snap = await getSnapshot(db, params.id)
          if (!snap) {
            set.status = 404
            return { success: false, error: "Snapshot not found" }
          }
          const result = await restoreFromSnapshot(db, b.workbenchId, params.id)
          return { success: true, data: result }
        }
      )
      .post("/workbench-snapshots/:id/clone", async ({ params, body, set }) => {
        const b = CloneSnapshotBody.parse(body)
        try {
          const result = await cloneFromSnapshot(db, params.id, {
            name: b.name,
            ownerId: b.ownerId,
            ownerType: b.ownerType ?? "user",
          })
          return { success: true, data: result }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.includes("not found")) {
            set.status = 404
          } else {
            set.status = 400
          }
          return { success: false, error: msg }
        }
      })

      // ── Component Deployments ─────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "ops",
          entity: "component-deployments",
          singular: "component deployment",
          table: componentDeployment,
          slugColumn: componentDeployment.id, // no slug — use id
          idColumn: componentDeployment.id,
          createSchema: CreateComponentDeploymentSchema,
          updateSchema: UpdateComponentDeploymentSchema,
          actions: {
            scale: {
              bodySchema: ScaleComponentDeploymentBody,
              handler: async ({ db, entity, body }) => {
                const b = body as ScaleComponentDeploymentBody
                const spec = (entity.spec ?? {}) as ComponentDeploymentSpec
                const [row] = await db
                  .update(componentDeployment)
                  .set({
                    spec: { ...spec, replicas: b.replicas },
                    updatedAt: new Date(),
                  })
                  .where(eq(componentDeployment.id, entity.id as string))
                  .returning()
                return row
              },
            },
            restart: {
              bodySchema: RestartComponentDeploymentBody,
              handler: async ({ db, entity, body }) => {
                const b = body as RestartComponentDeploymentBody
                // Create an intervention record for this restart
                const interventionSpec: InterventionSpec = {
                  reason: b.reason ?? "Manual restart via API",
                  result: "pending",
                  details: {},
                }
                const [row] = await db
                  .insert(intervention)
                  .values({
                    id: newId("intv"),
                    type: "restart",
                    systemDeploymentId: entity.systemDeploymentId as string,
                    componentDeploymentId: entity.id as string,
                    spec: interventionSpec,
                  })
                  .returning()
                return row
              },
            },
          },
        })
      )

      // ── Previews ─────────────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "ops",
          entity: "previews",
          singular: "preview",
          table: preview,
          slugColumn: preview.id, // no slug — use id
          idColumn: preview.id,
          createSchema: CreatePreviewSchema,
          updateSchema: UpdatePreviewSchema,
          deletable: true,
          actions: {
            "status-update": {
              bodySchema: UpdatePreviewStatusBody,
              handler: async ({ db, entity, body }) => {
                const b = body as UpdatePreviewStatusBody
                const spec = entity.spec as PreviewSpec
                const updatedSpec: PreviewSpec =
                  b.statusMessage !== undefined
                    ? { ...spec, statusMessage: b.statusMessage }
                    : spec
                const [row] = await db
                  .update(preview)
                  .set({
                    phase: b.phase,
                    spec: updatedSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(preview.id, entity.id as string))
                  .returning()
                return row
              },
            },
            expire: {
              handler: async ({ db, entity }) => {
                const spec = entity.spec as PreviewSpec
                const [row] = await db
                  .update(preview)
                  .set({
                    phase: "expired",
                    spec: { ...spec, statusMessage: "Manually expired" },
                    updatedAt: new Date(),
                  })
                  .where(eq(preview.id, entity.id as string))
                  .returning()
                return row
              },
            },
            image: {
              bodySchema: DeliverPreviewImageBody,
              handler: async ({ db, entity, body }) => {
                const b = body as DeliverPreviewImageBody
                const spec = entity.spec as PreviewSpec
                const [row] = await db
                  .update(preview)
                  .set({
                    phase: "deploying",
                    spec: {
                      ...spec,
                      imageRef: b.imageRef,
                      ...(b.commitSha && { commitSha: b.commitSha }),
                    },
                    updatedAt: new Date(),
                  })
                  .where(eq(preview.id, entity.id as string))
                  .returning()
                return row
              },
            },
            extend: {
              bodySchema: ExtendPreviewBody,
              handler: async ({ db, entity, body }) => {
                const b = body as ExtendPreviewBody
                const spec = entity.spec as PreviewSpec
                const currentExpiry = spec.expiresAt
                  ? new Date(spec.expiresAt as unknown as string)
                  : new Date()
                const newExpiry = new Date(
                  currentExpiry.getTime() + b.minutes * 60_000
                )
                const [row] = await db
                  .update(preview)
                  .set({
                    spec: { ...spec, expiresAt: newExpiry },
                    updatedAt: new Date(),
                  })
                  .where(eq(preview.id, entity.id as string))
                  .returning()
                return row
              },
            },
          },
        })
      )

      // ── Interventions ────────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "ops",
          entity: "interventions",
          singular: "intervention",
          table: intervention,
          slugColumn: intervention.id, // no slug
          idColumn: intervention.id,
          createSchema: CreateInterventionSchema,
        })
      )

      // ── Connection Audit Events ──────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "ops",
          entity: "connection-audit",
          singular: "connection audit event",
          table: connectionAuditEvent,
          slugColumn: connectionAuditEvent.id, // no slug
          idColumn: connectionAuditEvent.id,
          createSchema: CreateConnectionAuditEventSchema,
          updateSchema: UpdateConnectionAuditEventSchema,
        })
      )

      // ── Install Manifests ────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "ops",
          entity: "install-manifests",
          singular: "install manifest",
          table: installManifest,
          slugColumn: installManifest.id, // no slug
          idColumn: installManifest.id,
          createSchema: CreateInstallManifestSchema,
          updateSchema: UpdateInstallManifestSchema,
        })
      )

      // ── Site Manifests ───────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "ops",
          entity: "site-manifests",
          singular: "site manifest",
          table: siteManifest,
          slugColumn: siteManifest.id, // no slug
          idColumn: siteManifest.id,
          createSchema: CreateSiteManifestSchema,
          updateSchema: UpdateSiteManifestSchema,
        })
      )

      // ── Databases ────────────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "ops",
          entity: "databases",
          singular: "database",
          table: opsDatabase,
          slugColumn: opsDatabase.slug,
          idColumn: opsDatabase.id,
          createSchema: CreateDatabaseSchema,
          updateSchema: UpdateDatabaseSchema,
          deletable: true,
          relations: {
            operations: {
              path: "operations",
              table: databaseOperation,
              fk: databaseOperation.databaseId,
            },
          },
          actions: {
            backup: {
              bodySchema: DatabaseOperationBody,
              handler: async ({ db, entity, body }) => {
                const b = body as DatabaseOperationBody
                const spec: DatabaseOperationSpec = {
                  status: "pending",
                  targetRef: b.spec.targetRef as string | undefined,
                }
                const [op] = await db
                  .insert(databaseOperation)
                  .values({
                    id: newId("dbop"),
                    type: "backup",
                    databaseId: entity.id as string,
                    spec,
                  })
                  .returning()
                return op
              },
            },
            restore: {
              bodySchema: DatabaseOperationBody,
              handler: async ({ db, entity, body }) => {
                const b = body as DatabaseOperationBody
                const spec: DatabaseOperationSpec = {
                  status: "pending",
                  targetRef: b.spec.targetRef as string | undefined,
                }
                const [op] = await db
                  .insert(databaseOperation)
                  .values({
                    id: newId("dbop"),
                    type: "restore",
                    databaseId: entity.id as string,
                    spec,
                  })
                  .returning()
                return op
              },
            },
            seed: {
              bodySchema: DatabaseOperationBody,
              handler: async ({ db, entity, body }) => {
                const b = body as DatabaseOperationBody
                const spec: DatabaseOperationSpec = {
                  status: "pending",
                  targetRef: b.spec.targetRef as string | undefined,
                }
                const [op] = await db
                  .insert(databaseOperation)
                  .values({
                    id: newId("dbop"),
                    type: "seed",
                    databaseId: entity.id as string,
                    spec,
                  })
                  .returning()
                return op
              },
            },
            anonymize: {
              bodySchema: DatabaseOperationBody,
              handler: async ({ db, entity, body }) => {
                const b = body as DatabaseOperationBody
                const spec: DatabaseOperationSpec = {
                  status: "pending",
                  targetRef: b.spec.targetRef as string | undefined,
                }
                const [op] = await db
                  .insert(databaseOperation)
                  .values({
                    id: newId("dbop"),
                    type: "anonymize",
                    databaseId: entity.id as string,
                    spec,
                  })
                  .returning()
                return op
              },
            },
          },
        })
      )

      // ── Anonymization Profiles ───────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "ops",
          entity: "anonymization-profiles",
          singular: "anonymization profile",
          table: anonymizationProfile,
          slugColumn: anonymizationProfile.slug,
          idColumn: anonymizationProfile.id,
          createSchema: CreateAnonymizationProfileSchema,
          updateSchema: UpdateAnonymizationProfileSchema,
          deletable: true,
        })
      )

      // ── Forwarded Ports ──────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "ops",
          entity: "forwarded-ports",
          singular: "forwarded port",
          table: forwardedPort,
          slugColumn: forwardedPort.id, // no slug
          idColumn: forwardedPort.id,
          createSchema: CreateForwardedPortSchema,
          deletable: true,
        })
      )

      // ── Site Controller Manifest Assembly ──────────────────────
      .get("/site-controller-manifest/:name", async ({ params, set }) => {
        const [siteRow] = await db
          .select()
          .from(site)
          .where(eq(site.slug, params.name))
          .limit(1)

        if (!siteRow) {
          set.status = 404
          return { error: `Site '${params.name}' not found` }
        }

        const sds = await db
          .select()
          .from(systemDeployment)
          .where(eq(systemDeployment.siteId, siteRow.id))

        if (sds.length === 0) {
          set.status = 404
          return {
            error: `No system deployment found for site '${params.name}'`,
          }
        }

        const sd = sds[0]
        const sdSpec = (sd.spec ?? {}) as SystemDeploymentSpec

        const cds = await db
          .select()
          .from(componentDeployment)
          .where(eq(componentDeployment.systemDeploymentId, sd.id))

        const manifestCDs = cds.map((cd) => {
          const spec = (cd.spec ?? {}) as ComponentDeploymentSpec
          return {
            id: cd.id,
            componentName: cd.componentId,
            desiredImage: spec.desiredImage ?? "",
            trackedImageRef: spec.trackedImageRef,
            replicas: spec.replicas ?? 1,
            envOverrides: spec.envOverrides ?? {},
            resourceOverrides: spec.resourceOverrides ?? {},
            status: spec.status ?? "provisioning",
          }
        })

        const latestManifests = await db
          .select()
          .from(siteManifest)
          .where(eq(siteManifest.siteId, siteRow.id))
          .orderBy(desc(siteManifest.createdAt))
          .limit(1)
        const manifestVersion =
          latestManifests.length > 0
            ? ((latestManifests[0].spec as any)?.version ?? 0) + 1
            : 1

        return ok({
          version: manifestVersion,
          systemDeployment: {
            id: sd.id,
            name: sd.name,
            site: siteRow.slug,
            realmType: sdSpec.runtime ?? "compose",
            namespace: sdSpec.namespace,
            labels: sdSpec.labels,
          },
          componentDeployments: manifestCDs,
          catalog: null,
          gateway: null,
        })
      })
  )
}
