import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import type { InstallManifest } from "@smp/factory-shared/install-types"
import { FleetModel } from "./model"
import { FleetPlaneService } from "./plane.service"
import { WorkbenchService } from "./workbench.service"

export function fleetController(db: Database) {
  const plane = new FleetPlaneService(db)
  const workbenchSvc = new WorkbenchService(db)

  return new Elysia({ prefix: "/fleet" })
    // ---- Releases ----
    .get("/releases", () => plane.listReleases(), {
      detail: { tags: ["Fleet"], summary: "List releases" },
    })
    .post(
      "/releases",
      ({ body }) => plane.createRelease(body),
      {
        body: FleetModel.createReleaseBodyV2,
        detail: { tags: ["Fleet"], summary: "Create release" },
      }
    )
    .get(
      "/releases/:version",
      ({ params }) => plane.getRelease(params.version),
      {
        params: FleetModel.releaseVersionParams,
        detail: { tags: ["Fleet"], summary: "Get release" },
      }
    )
    .post(
      "/releases/:version/promote",
      ({ params, body }) => plane.promoteRelease(params.version, body),
      {
        params: FleetModel.releaseVersionParams,
        body: FleetModel.promoteReleaseBody,
        detail: { tags: ["Fleet"], summary: "Promote release" },
      }
    )

    // ---- Sites ----
    .get("/sites", () => plane.listSites(), {
      detail: { tags: ["Fleet"], summary: "List sites" },
    })
    .post(
      "/sites",
      ({ body }) => plane.createSite(body),
      {
        body: FleetModel.createSiteBody,
        detail: { tags: ["Fleet"], summary: "Create site" },
      }
    )
    .delete(
      "/sites",
      ({ query }) => plane.deleteSite(query.name),
      {
        query: FleetModel.siteNameQuery,
        detail: { tags: ["Fleet"], summary: "Delete site" },
      }
    )
    .get(
      "/sites/:name",
      ({ params }) => plane.getSite(params.name),
      {
        params: FleetModel.siteNameParams,
        detail: { tags: ["Fleet"], summary: "Get site" },
      }
    )
    .post(
      "/sites/:name/tenants",
      ({ params, body }) => plane.assignTenant(params.name, body),
      {
        params: FleetModel.siteNameParams,
        body: FleetModel.assignTenantBody,
        detail: { tags: ["Fleet"], summary: "Assign tenant to site" },
      }
    )

    // ---- Site Manifest & Check-in ----
    .post(
      "/sites/:name/checkin",
      ({ params, body }) => plane.siteCheckin(params.name, body),
      {
        params: FleetModel.siteNameParams,
        body: FleetModel.checkinBody,
        detail: { tags: ["Fleet"], summary: "Site check-in" },
      }
    )
    .get(
      "/sites/:name/manifest",
      ({ params }) => plane.getSiteManifest(params.name),
      {
        params: FleetModel.siteNameParams,
        detail: { tags: ["Fleet"], summary: "Get site manifest" },
      }
    )
    .post(
      "/sites/:name/assign-release",
      ({ params, body }) => plane.assignReleaseToSite(params.name, body.releaseVersion),
      {
        params: FleetModel.siteNameParams,
        body: FleetModel.assignReleaseBody,
        detail: { tags: ["Fleet"], summary: "Assign release to site" },
      }
    )

    // ---- Deployment Targets ----
    .get(
      "/deployment-targets",
      ({ query }) => plane.listDeploymentTargets(query),
      {
        query: FleetModel.deploymentTargetQuery,
        detail: { tags: ["Fleet"], summary: "List deployment targets" },
      }
    )
    .post(
      "/deployment-targets",
      ({ body }) => plane.createDeploymentTarget({ ...body, createdBy: "system" }),
      {
        body: FleetModel.createDeploymentTargetBody,
        detail: { tags: ["Fleet"], summary: "Create deployment target" },
      }
    )
    .get(
      "/deployment-targets/:id",
      ({ params }) => plane.getDeploymentTarget(params.id),
      {
        params: FleetModel.deploymentTargetIdParams,
        detail: { tags: ["Fleet"], summary: "Get deployment target" },
      }
    )
    .delete(
      "/deployment-targets/:id",
      ({ params }) => plane.destroyDeploymentTarget(params.id),
      {
        params: FleetModel.deploymentTargetIdParams,
        detail: { tags: ["Fleet"], summary: "Destroy deployment target" },
      }
    )

    // ---- Workloads (nested under deployment targets) ----
    .get(
      "/deployment-targets/:id/workloads",
      ({ params }) => plane.listWorkloads(params.id),
      {
        params: FleetModel.deploymentTargetIdParams,
        detail: { tags: ["Fleet"], summary: "List workloads for deployment target" },
      }
    )
    .post(
      "/deployment-targets/:id/workloads",
      ({ params, body }) => plane.createWorkload({ deploymentTargetId: params.id, ...body }),
      {
        params: FleetModel.deploymentTargetIdParams,
        body: FleetModel.createWorkloadBody,
        detail: { tags: ["Fleet"], summary: "Create workload" },
      }
    )
    .patch(
      "/workloads/:id",
      ({ params, body }) => plane.updateWorkload(params.id, body),
      {
        params: FleetModel.workloadIdParams,
        body: FleetModel.updateWorkloadBody,
        detail: { tags: ["Fleet"], summary: "Update workload" },
      }
    )
    .delete(
      "/workloads/:id",
      ({ params }) => plane.deleteWorkload(params.id),
      {
        params: FleetModel.workloadIdParams,
        detail: { tags: ["Fleet"], summary: "Delete workload" },
      }
    )

    // ---- Workload Ops ----
    .post(
      "/workloads/:id/scale",
      ({ params, body }) => plane.updateWorkload(params.id, { replicas: body.replicas }),
      {
        params: FleetModel.workloadIdParams,
        body: FleetModel.scaleWorkloadBody,
        detail: { tags: ["Fleet"], summary: "Scale workload" },
      }
    )
    .post(
      "/workloads/:id/restart",
      ({ params }) => plane.createIntervention({
        action: "restart",
        reason: "Manual restart via API",
        workloadId: params.id,
        deploymentTargetId: params.id,
        principalId: "system",
      }),
      {
        params: FleetModel.workloadIdParams,
        detail: { tags: ["Fleet"], summary: "Restart workload" },
      }
    )

    // ---- Rollouts ----
    .get("/rollouts", () => plane.listRollouts(), {
      detail: { tags: ["Fleet"], summary: "List rollouts" },
    })
    .post(
      "/rollouts",
      ({ body }) => plane.createRollout(body),
      {
        body: FleetModel.createRolloutBody,
        detail: { tags: ["Fleet"], summary: "Create rollout" },
      }
    )
    .get(
      "/rollouts/:id",
      ({ params }) => plane.getRollout(params.id),
      {
        params: FleetModel.rolloutIdParams,
        detail: { tags: ["Fleet"], summary: "Get rollout" },
      }
    )
    .patch(
      "/rollouts/:id",
      ({ params, body }) => plane.updateRolloutStatus(params.id, body.status),
      {
        params: FleetModel.rolloutIdParams,
        body: FleetModel.updateRolloutBody,
        detail: { tags: ["Fleet"], summary: "Update rollout status" },
      }
    )

    // ---- Interventions ----
    .get(
      "/deployment-targets/:id/interventions",
      ({ params }) => plane.listInterventions(params.id),
      {
        params: FleetModel.deploymentTargetIdParams,
        detail: { tags: ["Fleet"], summary: "List interventions" },
      }
    )
    .post(
      "/deployment-targets/:id/interventions",
      ({ params, body }) => plane.createIntervention({
        deploymentTargetId: params.id,
        principalId: "system",
        ...body,
      }),
      {
        params: FleetModel.deploymentTargetIdParams,
        body: FleetModel.createInterventionBody,
        detail: { tags: ["Fleet"], summary: "Create intervention" },
      }
    )

    // ---- Sandboxes ----
    .get(
      "/sandboxes",
      ({ query }) => plane.listSandboxes({ all: query.all === "true" }),
      {
        query: FleetModel.sandboxListQuery,
        detail: { tags: ["Fleet"], summary: "List sandboxes" },
      }
    )
    .post(
      "/sandboxes",
      ({ body }) => plane.createSandbox({ createdBy: "system", ...body }),
      {
        body: FleetModel.createSandboxBody,
        detail: { tags: ["Fleet"], summary: "Create sandbox" },
      }
    )
    .delete(
      "/sandboxes/:id",
      ({ params }) => plane.destroySandbox(params.id),
      {
        params: FleetModel.sandboxIdParams,
        detail: { tags: ["Fleet"], summary: "Destroy sandbox" },
      }
    )
    .post(
      "/sandboxes/:id/snapshot",
      ({ params, body }) => plane.createSnapshot({
        sandboxId: params.id,
        createdBy: "system",
        ...body,
      }),
      {
        params: FleetModel.sandboxIdParams,
        body: FleetModel.createSnapshotBody,
        detail: { tags: ["Fleet"], summary: "Create sandbox snapshot" },
      }
    )

    // ---- Snapshots ----
    .get("/snapshots", () => plane.listSnapshots(), {
      detail: { tags: ["Fleet"], summary: "List snapshots" },
    })
    .get(
      "/snapshots/:id",
      ({ params }) => plane.getSnapshot(params.id),
      {
        params: FleetModel.snapshotIdParams,
        detail: { tags: ["Fleet"], summary: "Get snapshot" },
      }
    )
    .delete(
      "/snapshots/:id",
      ({ params }) => plane.deleteSnapshot(params.id),
      {
        params: FleetModel.snapshotIdParams,
        detail: { tags: ["Fleet"], summary: "Delete snapshot" },
      }
    )

    // ---- Connection Audit ----
    .get(
      "/connection-audit",
      ({ query }) => plane.listConnectionAuditEvents(query),
      {
        query: FleetModel.connectionAuditQuery,
        detail: { tags: ["Fleet"], summary: "List connection audit events" },
      }
    )
    .post(
      "/connection-audit",
      ({ body }) => plane.createConnectionAuditEvent(body),
      {
        body: FleetModel.createConnectionAuditBody,
        detail: { tags: ["Fleet"], summary: "Create connection audit event" },
      }
    )
    .patch(
      "/connection-audit/:id",
      ({ params }) => plane.endConnectionAuditEvent(params.id),
      {
        params: FleetModel.connectionAuditIdParams,
        detail: { tags: ["Fleet"], summary: "End connection audit event" },
      }
    )

    // ---- Install Manifests ----
    .get(
      "/install-manifests",
      ({ query }) => plane.listInstallManifests(query),
      {
        query: FleetModel.installManifestQuery,
        detail: { tags: ["Fleet"], summary: "List install manifests" },
      }
    )
    .get(
      "/sites/:name/install-manifest",
      async ({ params }) => {
        const site = await plane.getSite(params.name)
        if (!site) return { error: "Site not found" }
        return plane.getInstallManifestBySite(site.siteId)
      },
      {
        params: FleetModel.siteNameParams,
        detail: { tags: ["Fleet"], summary: "Get install manifest for site" },
      }
    )
    .post(
      "/sites/:name/install-manifest",
      async ({ params, body }) => {
        const site = await plane.getSite(params.name)
        if (!site) return { error: "Site not found" }
        return plane.upsertInstallManifest(site.siteId, body as InstallManifest)
      },
      {
        params: FleetModel.siteNameParams,
        body: FleetModel.installManifestBody,
        detail: { tags: ["Fleet"], summary: "Report install manifest for site" },
      }
    )

    // ---- Release Bundles ----
    .get(
      "/bundles",
      ({ query }) => plane.listReleaseBundles(query),
      {
        query: FleetModel.releaseBundleQuery,
        detail: { tags: ["Fleet"], summary: "List release bundles" },
      }
    )
    .post(
      "/bundles",
      ({ body }) => plane.createReleaseBundle({ ...body, role: body.role ?? "site", createdBy: "system" }),
      {
        body: FleetModel.createReleaseBundleBody,
        detail: { tags: ["Fleet"], summary: "Create release bundle record" },
      }
    )
    .get(
      "/bundles/:id",
      ({ params }) => plane.getReleaseBundleById(params.id),
      {
        params: FleetModel.releaseBundleIdParams,
        detail: { tags: ["Fleet"], summary: "Get release bundle" },
      }
    )
    .patch(
      "/bundles/:id",
      ({ params, body }) => plane.updateReleaseBundleStatus(params.id, body),
      {
        params: FleetModel.releaseBundleIdParams,
        body: FleetModel.updateReleaseBundleBody,
        detail: { tags: ["Fleet"], summary: "Update release bundle status" },
      }
    )

    // ---- Workbenches ----
    .get(
      "/workbenches",
      ({ query }) => workbenchSvc.list(query),
      {
        query: FleetModel.workbenchListQuery,
        detail: { tags: ["Fleet"], summary: "List workbenches" },
      }
    )
    .post(
      "/workbenches",
      ({ body }) => workbenchSvc.register(body),
      {
        body: FleetModel.registerWorkbenchBody,
        detail: { tags: ["Fleet"], summary: "Register workbench" },
      }
    )
    .get(
      "/workbenches/:workbenchId",
      ({ params }) => workbenchSvc.get(params.workbenchId),
      {
        params: FleetModel.workbenchIdParams,
        detail: { tags: ["Fleet"], summary: "Get workbench" },
      }
    )
    .post(
      "/workbenches/:workbenchId/ping",
      ({ params, body }) => workbenchSvc.ping(params.workbenchId, body),
      {
        params: FleetModel.workbenchIdParams,
        body: FleetModel.workbenchPingBody,
        detail: { tags: ["Fleet"], summary: "Ping workbench" },
      }
    )
}
