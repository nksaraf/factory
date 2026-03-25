import { and, count, desc, eq, inArray, lt, max, sql } from "drizzle-orm";

import type { Database } from "../../db/connection";
import { moduleVersion } from "../../db/schema/build";
import {
  connectionAuditEvent,
  dependencyWorkload,
  deploymentTarget,
  fleetSite,
  intervention,
  release,
  releaseModulePin,
  rollout,
  sandboxSnapshot,
  siteManifest,
  workload,
  workloadOverride,
} from "../../db/schema/fleet";
import { productModule } from "../../db/schema/product";
import { allocateSlug } from "../../lib/slug";
import { computeManifest } from "../../lib/manifest";
import type { ManifestV1 } from "@smp/factory-shared/types";
import type { SandboxAdapter } from "../../adapters/sandbox-adapter";
import { listRoutes, listDomains, createSandboxRoutes, createPreviewRoutes, removeTargetRoutes } from "../gateway/service";

// ---------------------------------------------------------------------------
// Release CRUD
// ---------------------------------------------------------------------------

export async function listReleases(db: Database, opts?: { status?: string }) {
  const base = db.select().from(release);
  const rows = opts?.status
    ? await base
        .where(eq(release.status, opts.status))
        .orderBy(desc(release.createdAt))
    : await base.orderBy(desc(release.createdAt));
  return { data: rows, total: rows.length };
}

export async function createRelease(
  db: Database,
  input: {
    version: string;
    createdBy: string;
    modulePins?: Array<{ moduleVersionId: string }>;
  }
) {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(release)
      .values({
        version: input.version,
        createdBy: input.createdBy,
      })
      .returning();

    if (input.modulePins && input.modulePins.length > 0) {
      await tx.insert(releaseModulePin).values(
        input.modulePins.map((pin) => ({
          releaseId: row.releaseId,
          moduleVersionId: pin.moduleVersionId,
        }))
      );
    }

    return row;
  });
}

export async function getRelease(db: Database, version: string) {
  const [row] = await db
    .select()
    .from(release)
    .where(eq(release.version, version))
    .limit(1);

  if (!row) return null;

  const pins = await db
    .select({
      releaseModulePinId: releaseModulePin.releaseModulePinId,
      releaseId: releaseModulePin.releaseId,
      moduleVersionId: releaseModulePin.moduleVersionId,
      moduleVersion: {
        moduleVersionId: moduleVersion.moduleVersionId,
        moduleId: moduleVersion.moduleId,
        version: moduleVersion.version,
        compatibilityRange: moduleVersion.compatibilityRange,
        schemaVersion: moduleVersion.schemaVersion,
        createdAt: moduleVersion.createdAt,
      },
    })
    .from(releaseModulePin)
    .innerJoin(
      moduleVersion,
      eq(releaseModulePin.moduleVersionId, moduleVersion.moduleVersionId)
    )
    .where(eq(releaseModulePin.releaseId, row.releaseId));

  return { ...row, modulePins: pins };
}

const VALID_TRANSITIONS: Record<string, string> = {
  draft: "staging",
  staging: "production",
  production: "superseded",
};

export async function promoteRelease(
  db: Database,
  version: string,
  target: string
) {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(release)
      .where(eq(release.version, version))
      .limit(1);

    if (!row) {
      throw new Error(`Release not found: ${version}`);
    }

    const allowedTarget = VALID_TRANSITIONS[row.status];
    if (!allowedTarget || allowedTarget !== target) {
      throw new Error(
        `Invalid promotion: cannot transition from '${row.status}' to '${target}'`
      );
    }

    // When promoting to production, supersede the current production release
    if (target === "production") {
      await tx
        .update(release)
        .set({ status: "superseded" })
        .where(eq(release.status, "production"));
    }

    const [updated] = await tx
      .update(release)
      .set({ status: target })
      .where(eq(release.releaseId, row.releaseId))
      .returning();

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Release Module Pin Management
// ---------------------------------------------------------------------------

export async function addModulePin(
  db: Database,
  releaseId: string,
  moduleVersionId: string
) {
  const [row] = await db
    .insert(releaseModulePin)
    .values({ releaseId, moduleVersionId })
    .returning();
  return row;
}

export async function removeModulePin(
  db: Database,
  releaseId: string,
  moduleVersionId: string
) {
  const [row] = await db
    .delete(releaseModulePin)
    .where(
      and(
        eq(releaseModulePin.releaseId, releaseId),
        eq(releaseModulePin.moduleVersionId, moduleVersionId)
      )
    )
    .returning();
  return row ?? null;
}

export async function listReleasePins(db: Database, releaseId: string) {
  const pins = await db
    .select({
      releaseModulePinId: releaseModulePin.releaseModulePinId,
      releaseId: releaseModulePin.releaseId,
      moduleVersionId: releaseModulePin.moduleVersionId,
      moduleVersion: {
        moduleVersionId: moduleVersion.moduleVersionId,
        moduleId: moduleVersion.moduleId,
        version: moduleVersion.version,
        compatibilityRange: moduleVersion.compatibilityRange,
        schemaVersion: moduleVersion.schemaVersion,
        createdAt: moduleVersion.createdAt,
      },
    })
    .from(releaseModulePin)
    .innerJoin(
      moduleVersion,
      eq(releaseModulePin.moduleVersionId, moduleVersion.moduleVersionId)
    )
    .where(eq(releaseModulePin.releaseId, releaseId));

  return { data: pins };
}

// ---------------------------------------------------------------------------
// Site CRUD
// ---------------------------------------------------------------------------

const VALID_SITE_STATUSES = [
  "provisioning",
  "active",
  "suspended",
  "decommissioned",
] as const;

export async function listSites(
  db: Database,
  opts?: { product?: string; status?: string }
) {
  const conditions = [];
  if (opts?.product) conditions.push(eq(fleetSite.product, opts.product));
  if (opts?.status) conditions.push(eq(fleetSite.status, opts.status));

  const base = db.select().from(fleetSite);
  const rows =
    conditions.length > 0
      ? await base
          .where(and(...conditions))
          .orderBy(desc(fleetSite.createdAt))
      : await base.orderBy(desc(fleetSite.createdAt));

  return { data: rows, total: rows.length };
}

export async function createSite(
  db: Database,
  input: {
    name: string;
    product: string;
    clusterId: string;
    createdBy: string;
  }
) {
  const slug = await allocateSlug({
    baseLabel: input.name,
    isTaken: async (s) => {
      const [existing] = await db
        .select({ siteId: fleetSite.siteId })
        .from(fleetSite)
        .where(eq(fleetSite.slug, s))
        .limit(1);
      return !!existing;
    },
  });

  const [row] = await db
    .insert(fleetSite)
    .values({
      name: input.name,
      slug,
      product: input.product,
      clusterId: input.clusterId,
      status: "provisioning",
    })
    .returning();

  return row;
}

export async function getSite(db: Database, name: string) {
  const [row] = await db
    .select()
    .from(fleetSite)
    .where(eq(fleetSite.name, name))
    .limit(1);

  if (!row) return null;

  const [targetCount] = await db
    .select({ count: count() })
    .from(deploymentTarget)
    .where(eq(deploymentTarget.siteId, row.siteId));

  return {
    ...row,
    deploymentTargetCount: targetCount?.count ?? 0,
  };
}

export async function deleteSite(db: Database, name: string) {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(fleetSite)
      .where(eq(fleetSite.name, name))
      .limit(1);

    if (!row) {
      throw new Error(`Site not found: ${name}`);
    }

    // Mark all deployment targets for this site as 'destroying'
    await tx
      .update(deploymentTarget)
      .set({ status: "destroying" })
      .where(eq(deploymentTarget.siteId, row.siteId));

    const [updated] = await tx
      .update(fleetSite)
      .set({ status: "decommissioned" })
      .where(eq(fleetSite.siteId, row.siteId))
      .returning();

    return updated;
  });
}

export async function updateSiteStatus(
  db: Database,
  name: string,
  status: string
) {
  if (
    !VALID_SITE_STATUSES.includes(
      status as (typeof VALID_SITE_STATUSES)[number]
    )
  ) {
    throw new Error(
      `Invalid site status '${status}'. Must be one of: ${VALID_SITE_STATUSES.join(", ")}`
    );
  }

  const [updated] = await db
    .update(fleetSite)
    .set({ status })
    .where(eq(fleetSite.name, name))
    .returning();

  if (!updated) {
    throw new Error(`Site not found: ${name}`);
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Tenant Assignment
// ---------------------------------------------------------------------------

export async function assignTenant(
  _db: Database,
  siteName: string,
  tenantId: string
) {
  // Full tenant model is deferred to Commerce Plane.
  // The fleetSite table does not have a tenants/labels column,
  // so we acknowledge the assignment without persisting it here.
  return {
    ok: true,
    site: siteName,
    tenantId,
    note: "Tenant assignment acknowledged. Full tenant model deferred to Commerce Plane.",
  };
}

// ---------------------------------------------------------------------------
// TTL Duration Parser
// ---------------------------------------------------------------------------

function parseTtlToMs(ttl: string): number {
  const match = ttl.match(/^(\d+)(h|d|m)$/);
  if (!match) throw new Error(`Invalid TTL format: ${ttl}`);
  const [, value, unit] = match;
  const multipliers = { m: 60_000, h: 3_600_000, d: 86_400_000 };
  return parseInt(value!) * multipliers[unit as keyof typeof multipliers];
}

// ---------------------------------------------------------------------------
// Deployment Target CRUD
// ---------------------------------------------------------------------------

export async function listDeploymentTargets(
  db: Database,
  opts?: { kind?: string; status?: string; siteId?: string; runtime?: string }
) {
  const conditions = [];
  if (opts?.kind) conditions.push(eq(deploymentTarget.kind, opts.kind));
  if (opts?.status) conditions.push(eq(deploymentTarget.status, opts.status));
  if (opts?.siteId) conditions.push(eq(deploymentTarget.siteId, opts.siteId));
  if (opts?.runtime) conditions.push(eq(deploymentTarget.runtime, opts.runtime));

  const base = db.select().from(deploymentTarget);
  const rows =
    conditions.length > 0
      ? await base
          .where(and(...conditions))
          .orderBy(desc(deploymentTarget.createdAt))
      : await base.orderBy(desc(deploymentTarget.createdAt));

  return { data: rows, total: rows.length };
}

export async function createDeploymentTarget(
  db: Database,
  input: {
    name: string;
    kind: string;
    siteId?: string;
    clusterId?: string;
    namespace?: string;
    createdBy: string;
    trigger: string;
    ttl?: string;
    tierPolicies?: Record<string, unknown>;
    labels?: Record<string, unknown>;
    runtime?: string;
    hostId?: string;
    vmId?: string;
  }
) {
  const slug = await allocateSlug({
    baseLabel: input.name,
    isTaken: async (s) => {
      const [existing] = await db
        .select({ deploymentTargetId: deploymentTarget.deploymentTargetId })
        .from(deploymentTarget)
        .where(eq(deploymentTarget.slug, s))
        .limit(1);
      return !!existing;
    },
  });

  const expiresAt = input.ttl
    ? new Date(Date.now() + parseTtlToMs(input.ttl))
    : undefined;

  const [row] = await db
    .insert(deploymentTarget)
    .values({
      name: input.name,
      slug,
      kind: input.kind,
      siteId: input.siteId,
      clusterId: input.clusterId,
      namespace: input.namespace,
      createdBy: input.createdBy,
      trigger: input.trigger,
      ttl: input.ttl,
      expiresAt,
      tierPolicies: input.tierPolicies ?? {},
      labels: input.labels ?? {},
      runtime: input.runtime ?? "kubernetes",
      hostId: input.hostId ?? null,
      vmId: input.vmId ?? null,
    })
    .returning();

  return row;
}

export async function getDeploymentTarget(db: Database, id: string) {
  const [row] = await db
    .select()
    .from(deploymentTarget)
    .where(eq(deploymentTarget.deploymentTargetId, id))
    .limit(1);

  if (!row) return null;

  const workloads = await db
    .select()
    .from(workload)
    .where(eq(workload.deploymentTargetId, id));

  return { ...row, workloads };
}

export async function updateDeploymentTargetStatus(
  db: Database,
  id: string,
  status: string
) {
  const [updated] = await db
    .update(deploymentTarget)
    .set({ status })
    .where(eq(deploymentTarget.deploymentTargetId, id))
    .returning();

  if (!updated) {
    throw new Error(`Deployment target not found: ${id}`);
  }

  return updated;
}

export async function destroyDeploymentTarget(db: Database, id: string) {
  return await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(deploymentTarget)
      .set({ status: "destroying", destroyedAt: new Date() })
      .where(eq(deploymentTarget.deploymentTargetId, id))
      .returning();

    if (!updated) {
      throw new Error(`Deployment target not found: ${id}`);
    }

    await tx
      .update(workload)
      .set({ status: "stopped", updatedAt: new Date() })
      .where(eq(workload.deploymentTargetId, id));

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Workload CRUD
// ---------------------------------------------------------------------------

export async function listWorkloads(
  db: Database,
  deploymentTargetId: string
) {
  const rows = await db
    .select()
    .from(workload)
    .where(eq(workload.deploymentTargetId, deploymentTargetId));

  return { data: rows, total: rows.length };
}

export async function createWorkload(
  db: Database,
  input: {
    deploymentTargetId: string;
    moduleVersionId: string;
    componentId: string;
    artifactId: string;
    desiredImage: string;
    replicas?: number;
    envOverrides?: Record<string, unknown>;
    resourceOverrides?: Record<string, unknown>;
    desiredArtifactUri?: string;
  }
) {
  const [row] = await db
    .insert(workload)
    .values({
      deploymentTargetId: input.deploymentTargetId,
      moduleVersionId: input.moduleVersionId,
      componentId: input.componentId,
      artifactId: input.artifactId,
      desiredImage: input.desiredImage,
      replicas: input.replicas ?? 1,
      envOverrides: input.envOverrides ?? {},
      resourceOverrides: input.resourceOverrides ?? {},
      desiredArtifactUri: input.desiredArtifactUri ?? null,
    })
    .returning();

  return row;
}

export async function getWorkload(db: Database, id: string) {
  const [row] = await db
    .select()
    .from(workload)
    .where(eq(workload.workloadId, id))
    .limit(1);

  return row ?? null;
}

export async function updateWorkload(
  db: Database,
  id: string,
  updates: Partial<{
    replicas: number;
    desiredImage: string;
    envOverrides: Record<string, unknown>;
    resourceOverrides: Record<string, unknown>;
    status: string;
    actualImage: string;
    driftDetected: boolean;
    lastReconciledAt: Date;
  }>
) {
  const [updated] = await db
    .update(workload)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(workload.workloadId, id))
    .returning();

  if (!updated) {
    throw new Error(`Workload not found: ${id}`);
  }

  return updated;
}

export async function deleteWorkload(db: Database, id: string) {
  const [deleted] = await db
    .delete(workload)
    .where(eq(workload.workloadId, id))
    .returning();

  return deleted ?? null;
}

// ---------------------------------------------------------------------------
// Dependency Workload CRUD
// ---------------------------------------------------------------------------

export async function listDependencyWorkloads(
  db: Database,
  deploymentTargetId: string
) {
  const rows = await db
    .select()
    .from(dependencyWorkload)
    .where(eq(dependencyWorkload.deploymentTargetId, deploymentTargetId));

  return { data: rows, total: rows.length };
}

export async function createDependencyWorkload(
  db: Database,
  input: {
    deploymentTargetId: string;
    name: string;
    image: string;
    port: number;
    env?: Record<string, unknown>;
  }
) {
  const slug = await allocateSlug({
    baseLabel: input.name,
    isTaken: async (s) => {
      const [existing] = await db
        .select({
          dependencyWorkloadId: dependencyWorkload.dependencyWorkloadId,
        })
        .from(dependencyWorkload)
        .where(
          and(
            eq(dependencyWorkload.deploymentTargetId, input.deploymentTargetId),
            eq(dependencyWorkload.slug, s)
          )
        )
        .limit(1);
      return !!existing;
    },
  });

  const [row] = await db
    .insert(dependencyWorkload)
    .values({
      deploymentTargetId: input.deploymentTargetId,
      name: input.name,
      slug,
      image: input.image,
      port: input.port,
      env: input.env ?? {},
    })
    .returning();

  return row;
}

export async function updateDependencyWorkloadStatus(
  db: Database,
  id: string,
  status: string
) {
  const [updated] = await db
    .update(dependencyWorkload)
    .set({ status })
    .where(eq(dependencyWorkload.dependencyWorkloadId, id))
    .returning();

  if (!updated) {
    throw new Error(`Dependency workload not found: ${id}`);
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Rollout Management
// ---------------------------------------------------------------------------

export async function createRollout(
  db: Database,
  input: { releaseId: string; deploymentTargetId: string }
) {
  // Validate release exists and is in staging or production status
  const [rel] = await db
    .select()
    .from(release)
    .where(eq(release.releaseId, input.releaseId))
    .limit(1);

  if (!rel) {
    throw new Error(`Release not found: ${input.releaseId}`);
  }

  if (rel.status !== "staging" && rel.status !== "production") {
    throw new Error(
      `Release must be in 'staging' or 'production' status to create a rollout, got '${rel.status}'`
    );
  }

  const [row] = await db
    .insert(rollout)
    .values({
      releaseId: input.releaseId,
      deploymentTargetId: input.deploymentTargetId,
      status: "pending",
    })
    .returning();

  return row;
}

export async function getRollout(db: Database, id: string) {
  const [row] = await db
    .select({
      rolloutId: rollout.rolloutId,
      releaseId: rollout.releaseId,
      deploymentTargetId: rollout.deploymentTargetId,
      status: rollout.status,
      startedAt: rollout.startedAt,
      completedAt: rollout.completedAt,
      release: {
        releaseId: release.releaseId,
        version: release.version,
        status: release.status,
        createdAt: release.createdAt,
      },
    })
    .from(rollout)
    .innerJoin(release, eq(rollout.releaseId, release.releaseId))
    .where(eq(rollout.rolloutId, id))
    .limit(1);

  return row ?? null;
}

const VALID_ROLLOUT_TRANSITIONS: Record<string, string[]> = {
  pending: ["in_progress"],
  in_progress: ["succeeded", "failed", "rolled_back"],
};

export async function updateRolloutStatus(
  db: Database,
  id: string,
  status: string
) {
  const [existing] = await db
    .select()
    .from(rollout)
    .where(eq(rollout.rolloutId, id))
    .limit(1);

  if (!existing) {
    throw new Error(`Rollout not found: ${id}`);
  }

  const allowed = VALID_ROLLOUT_TRANSITIONS[existing.status];
  if (!allowed || !allowed.includes(status)) {
    throw new Error(
      `Invalid rollout transition: cannot go from '${existing.status}' to '${status}'`
    );
  }

  const completionStatuses = ["succeeded", "failed", "rolled_back"];
  const updates: Record<string, unknown> = { status };
  if (completionStatuses.includes(status)) {
    updates.completedAt = new Date();
  }

  const [updated] = await db
    .update(rollout)
    .set(updates)
    .where(eq(rollout.rolloutId, id))
    .returning();

  return updated;
}

export async function listRollouts(
  db: Database,
  opts?: { releaseId?: string; deploymentTargetId?: string }
) {
  const conditions = [];
  if (opts?.releaseId) conditions.push(eq(rollout.releaseId, opts.releaseId));
  if (opts?.deploymentTargetId)
    conditions.push(eq(rollout.deploymentTargetId, opts.deploymentTargetId));

  const base = db.select().from(rollout);
  const rows =
    conditions.length > 0
      ? await base
          .where(and(...conditions))
          .orderBy(desc(rollout.startedAt))
      : await base.orderBy(desc(rollout.startedAt));

  return { data: rows, total: rows.length };
}

// ---------------------------------------------------------------------------
// Workload Overrides (Audit Trail)
// ---------------------------------------------------------------------------

export async function createWorkloadOverride(
  db: Database,
  input: {
    workloadId: string;
    field: string;
    previousValue: unknown;
    newValue: unknown;
    reason: string;
    createdBy: string;
  }
) {
  const [row] = await db
    .insert(workloadOverride)
    .values({
      workloadId: input.workloadId,
      field: input.field,
      previousValue: input.previousValue,
      newValue: input.newValue,
      reason: input.reason,
      createdBy: input.createdBy,
    })
    .returning();

  return row;
}

export async function revertWorkloadOverride(
  db: Database,
  overrideId: string,
  revertedBy: string
) {
  const [updated] = await db
    .update(workloadOverride)
    .set({ revertedAt: new Date(), revertedBy })
    .where(eq(workloadOverride.overrideId, overrideId))
    .returning();

  if (!updated) {
    throw new Error(`Workload override not found: ${overrideId}`);
  }

  return updated;
}

export async function listWorkloadOverrides(
  db: Database,
  workloadId: string
) {
  const rows = await db
    .select()
    .from(workloadOverride)
    .where(eq(workloadOverride.workloadId, workloadId))
    .orderBy(desc(workloadOverride.createdAt));

  return { data: rows, total: rows.length };
}

// ---------------------------------------------------------------------------
// Interventions
// ---------------------------------------------------------------------------

export async function createIntervention(
  db: Database,
  input: {
    deploymentTargetId: string;
    workloadId?: string;
    action: string;
    principalId: string;
    reason: string;
    details?: Record<string, unknown>;
  }
) {
  const [row] = await db
    .insert(intervention)
    .values({
      deploymentTargetId: input.deploymentTargetId,
      workloadId: input.workloadId,
      action: input.action,
      principalId: input.principalId,
      reason: input.reason,
      details: input.details ?? {},
    })
    .returning();

  return row;
}

export async function listInterventions(
  db: Database,
  deploymentTargetId: string
) {
  const rows = await db
    .select()
    .from(intervention)
    .where(eq(intervention.deploymentTargetId, deploymentTargetId))
    .orderBy(desc(intervention.createdAt));

  return { data: rows, total: rows.length };
}

// ---------------------------------------------------------------------------
// Standard Dependency Templates
// ---------------------------------------------------------------------------

export const STANDARD_DEPENDENCIES: Record<
  string,
  { name: string; image: string; port: number; env: Record<string, string> }
> = {
  postgres: {
    name: "postgres",
    image: "postgres:16-alpine",
    port: 5432,
    env: {
      POSTGRES_DB: "app",
      POSTGRES_USER: "app",
      POSTGRES_PASSWORD: "dev",
    },
  },
  redis: {
    name: "redis",
    image: "redis:7-alpine",
    port: 6379,
    env: {},
  },
  minio: {
    name: "minio",
    image: "minio/minio:latest",
    port: 9000,
    env: {
      MINIO_ROOT_USER: "minioadmin",
      MINIO_ROOT_PASSWORD: "minioadmin",
    },
  },
};

// ---------------------------------------------------------------------------
// Sandbox CRUD
// ---------------------------------------------------------------------------

const DEFAULT_TTLS: Record<string, string> = {
  pr: "48h",
  agent: "2h",
  manual: "24h",
  ci: "4h",
};

function generateSandboxName(): string {
  const suffix = Math.random().toString(36).substring(2, 8);
  return `sandbox-${suffix}`;
}

export async function listSandboxes(
  db: Database,
  opts?: { createdBy?: string; trigger?: string; all?: boolean }
) {
  const conditions = [eq(deploymentTarget.kind, "sandbox")];

  if (opts?.createdBy)
    conditions.push(eq(deploymentTarget.createdBy, opts.createdBy));
  if (opts?.trigger)
    conditions.push(eq(deploymentTarget.trigger, opts.trigger));
  if (!opts?.all) {
    conditions.push(
      sql`${deploymentTarget.status} NOT IN ('destroyed', 'destroying')`
    );
  }

  const rows = await db
    .select()
    .from(deploymentTarget)
    .where(and(...conditions))
    .orderBy(desc(deploymentTarget.createdAt));

  return { data: rows, total: rows.length };
}

export async function createSandbox(
  db: Database,
  adapter: SandboxAdapter,
  input: {
    name?: string;
    createdBy: string;
    clusterId?: string;
    siteId?: string;
    ttl?: string;
    trigger?: string;
    labels?: Record<string, unknown>;
    dependencies?: Array<{
      name: string;
      image: string;
      port: number;
      env?: Record<string, unknown>;
    }>;
    publishPorts?: number[];
    snapshotId?: string;
  }
) {
  const name = input.name ?? generateSandboxName();
  const trigger = input.trigger ?? "manual";
  const ttl = input.ttl ?? DEFAULT_TTLS[trigger] ?? "24h";

  const dt = await createDeploymentTarget(db, {
    name,
    kind: "sandbox",
    clusterId: input.clusterId,
    createdBy: input.createdBy,
    trigger,
    ttl,
    labels: input.labels ?? {},
  });

  if (input.dependencies) {
    for (const dep of input.dependencies) {
      await createDependencyWorkload(db, {
        deploymentTargetId: dt.deploymentTargetId,
        name: dep.name,
        image: dep.image,
        port: dep.port,
        env: dep.env,
      });
    }
  }

  await adapter.provision(
    {
      deploymentTargetId: dt.deploymentTargetId,
      name: dt.name,
      namespace: dt.namespace ?? undefined,
    },
    {
      dependencies: input.dependencies,
      publishPorts: input.publishPorts,
    }
  );

  // Create sandbox routes (primary + per-port)
  const slug = dt.slug ?? dt.name;
  const routes = await createSandboxRoutes(db, {
    sandboxSlug: slug,
    deploymentTargetId: dt.deploymentTargetId,
    siteId: input.siteId,
    publishPorts: input.publishPorts,
    createdBy: input.createdBy,
  });

  return { ...dt, routes };
}

export async function destroySandbox(
  db: Database,
  adapter: SandboxAdapter,
  id: string
) {
  await adapter.destroy(id);
  await removeTargetRoutes(db, id);
  return await destroyDeploymentTarget(db, id);
}

export async function cleanupExpiredSandboxes(
  db: Database,
  adapter: SandboxAdapter
) {
  const now = new Date();

  const expired = await db
    .select()
    .from(deploymentTarget)
    .where(
      and(
        inArray(deploymentTarget.kind, ["sandbox", "dev"]),
        lt(deploymentTarget.expiresAt, now),
        eq(deploymentTarget.status, "active")
      )
    );

  let cleaned = 0;
  for (const dt of expired) {
    await destroySandbox(db, adapter, dt.deploymentTargetId);
    cleaned++;
  }

  return { cleaned };
}

// ---------------------------------------------------------------------------
// Snapshot CRUD
// ---------------------------------------------------------------------------

export async function createSnapshot(
  db: Database,
  adapter: SandboxAdapter,
  input: { sandboxId: string; createdBy: string; stop?: boolean }
) {
  const result = await adapter.snapshot(input.sandboxId);

  const [row] = await db
    .insert(sandboxSnapshot)
    .values({
      deploymentTargetId: input.sandboxId,
      workloadConfig: result.config,
      dependencyConfig: {},
      createdBy: input.createdBy,
    })
    .returning();

  if (input.stop) {
    await destroySandbox(db, adapter, input.sandboxId);
  }

  return row;
}

export async function listSnapshots(
  db: Database,
  opts?: { createdBy?: string }
) {
  const base = db.select().from(sandboxSnapshot);
  const rows = opts?.createdBy
    ? await base
        .where(eq(sandboxSnapshot.createdBy, opts.createdBy))
        .orderBy(desc(sandboxSnapshot.createdAt))
    : await base.orderBy(desc(sandboxSnapshot.createdAt));

  return { data: rows, total: rows.length };
}

export async function getSnapshot(db: Database, snapshotId: string) {
  const [row] = await db
    .select()
    .from(sandboxSnapshot)
    .where(eq(sandboxSnapshot.snapshotId, snapshotId))
    .limit(1);

  return row ?? null;
}

export async function deleteSnapshot(db: Database, snapshotId: string) {
  const [deleted] = await db
    .delete(sandboxSnapshot)
    .where(eq(sandboxSnapshot.snapshotId, snapshotId))
    .returning();

  return deleted ?? null;
}

// ---------------------------------------------------------------------------
// Manifest & Check-in
// ---------------------------------------------------------------------------

export async function siteCheckin(
  db: Database,
  siteName: string,
  input: {
    healthSnapshot: Record<string, unknown>
    lastAppliedManifestVersion: number
  }
): Promise<{
  manifestChanged: boolean
  latestVersion: number
  manifest?: ManifestV1
}> {
  // 1. Find site by name
  const [site] = await db
    .select()
    .from(fleetSite)
    .where(eq(fleetSite.name, siteName))
    .limit(1);

  if (!site) {
    throw new Error(`Site not found: ${siteName}`);
  }

  // 2. Update lastCheckinAt to now()
  await db
    .update(fleetSite)
    .set({ lastCheckinAt: new Date() })
    .where(eq(fleetSite.siteId, site.siteId));

  // 3. Get the latest manifest for this site
  const [latestManifest] = await db
    .select()
    .from(siteManifest)
    .where(eq(siteManifest.siteId, site.siteId))
    .orderBy(desc(siteManifest.manifestVersion))
    .limit(1);

  if (!latestManifest) {
    return { manifestChanged: false, latestVersion: 0 };
  }

  const latestVersion = latestManifest.manifestVersion;

  // 4. Compare input.lastAppliedManifestVersion with latest manifest version
  if (input.lastAppliedManifestVersion !== latestVersion) {
    return {
      manifestChanged: true,
      latestVersion,
      manifest: latestManifest.content as ManifestV1,
    };
  }

  return { manifestChanged: false, latestVersion };
}

export async function assignReleaseToSite(
  db: Database,
  siteName: string,
  releaseVersion: string
) {
  // 1. Find site by name
  const [site] = await db
    .select()
    .from(fleetSite)
    .where(eq(fleetSite.name, siteName))
    .limit(1);

  if (!site) {
    throw new Error(`Site not found: ${siteName}`);
  }

  // 2. Find release by version
  const [rel] = await db
    .select()
    .from(release)
    .where(eq(release.version, releaseVersion))
    .limit(1);

  if (!rel) {
    throw new Error(`Release not found: ${releaseVersion}`);
  }

  // 3. Get release pins with module name and version
  const pins = await db
    .select({
      moduleVersionId: releaseModulePin.moduleVersionId,
      moduleName: productModule.name,
      version: moduleVersion.version,
    })
    .from(releaseModulePin)
    .innerJoin(
      moduleVersion,
      eq(releaseModulePin.moduleVersionId, moduleVersion.moduleVersionId)
    )
    .innerJoin(
      productModule,
      eq(moduleVersion.moduleId, productModule.moduleId)
    )
    .where(eq(releaseModulePin.releaseId, rel.releaseId));

  // 4. Get current latest manifest version for this site
  const [currentMax] = await db
    .select({ maxVersion: max(siteManifest.manifestVersion) })
    .from(siteManifest)
    .where(eq(siteManifest.siteId, site.siteId));

  const previousVersion = currentMax?.maxVersion ?? 0;

  // 5. Fetch active routes and domains for this site
  const [siteRoutes, siteDomains] = await Promise.all([
    listRoutes(db, { siteId: site.siteId, status: "active" }),
    listDomains(db, { siteId: site.siteId, status: "active" }),
  ]);

  // 6. Compute new manifest (includes routes + domains)
  const manifest = computeManifest({
    site: { siteId: site.siteId, name: site.name, product: site.product },
    release: {
      releaseId: rel.releaseId,
      version: rel.version,
      pins,
    },
    routes: siteRoutes.data.map((r) => ({
      routeId: r.routeId,
      kind: r.kind,
      domain: r.domain,
      pathPrefix: r.pathPrefix,
      targetService: r.targetService,
      targetPort: r.targetPort,
      protocol: r.protocol,
      tlsMode: r.tlsMode,
      middlewares: r.middlewares as unknown[],
      priority: r.priority,
    })),
    domains: siteDomains.data.map((d) => ({
      domainId: d.domainId,
      fqdn: d.fqdn,
      kind: d.kind,
      tlsCertRef: d.tlsCertRef,
    })),
    previousVersion,
  });

  // 6. Insert into siteManifest table
  await db.insert(siteManifest).values({
    siteId: site.siteId,
    manifestVersion: manifest.manifestVersion,
    manifestHash: manifest.manifestHash,
    releaseId: rel.releaseId,
    content: manifest,
  });

  // 7. Update site currentManifestVersion
  await db
    .update(fleetSite)
    .set({ currentManifestVersion: manifest.manifestVersion })
    .where(eq(fleetSite.siteId, site.siteId));

  // 8. Return the new manifest
  return manifest;
}

export async function getSiteManifest(
  db: Database,
  siteName: string
): Promise<ManifestV1 | null> {
  const [site] = await db
    .select()
    .from(fleetSite)
    .where(eq(fleetSite.name, siteName))
    .limit(1);

  if (!site) return null;

  const [latestManifest] = await db
    .select()
    .from(siteManifest)
    .where(eq(siteManifest.siteId, site.siteId))
    .orderBy(desc(siteManifest.manifestVersion))
    .limit(1);

  if (!latestManifest) return null;

  return latestManifest.content as ManifestV1;
}

// ---------------------------------------------------------------------------
// Connection Audit Events
// ---------------------------------------------------------------------------

export async function createConnectionAuditEvent(
  db: Database,
  input: {
    principalId: string;
    deploymentTargetId: string;
    connectedResources: Record<string, unknown>;
    readonly: boolean;
    reason?: string;
  }
) {
  const [row] = await db
    .insert(connectionAuditEvent)
    .values({
      principalId: input.principalId,
      deploymentTargetId: input.deploymentTargetId,
      connectedResources: input.connectedResources,
      readonly: input.readonly,
      reason: input.reason,
    })
    .returning();

  return row;
}

export async function endConnectionAuditEvent(
  db: Database,
  eventId: string
) {
  const [updated] = await db
    .update(connectionAuditEvent)
    .set({ endedAt: new Date() })
    .where(eq(connectionAuditEvent.eventId, eventId))
    .returning();

  if (!updated) {
    throw new Error(`Connection audit event not found: ${eventId}`);
  }

  return updated;
}

export async function listConnectionAuditEvents(
  db: Database,
  opts?: { deploymentTargetId?: string; principalId?: string }
) {
  const conditions = [];
  if (opts?.deploymentTargetId)
    conditions.push(
      eq(connectionAuditEvent.deploymentTargetId, opts.deploymentTargetId)
    );
  if (opts?.principalId)
    conditions.push(eq(connectionAuditEvent.principalId, opts.principalId));

  const base = db.select().from(connectionAuditEvent);
  const rows =
    conditions.length > 0
      ? await base
          .where(and(...conditions))
          .orderBy(desc(connectionAuditEvent.startedAt))
      : await base.orderBy(desc(connectionAuditEvent.startedAt));

  return { data: rows, total: rows.length };
}
