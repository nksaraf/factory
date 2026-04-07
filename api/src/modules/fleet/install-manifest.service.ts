import { desc, eq } from "drizzle-orm";

import type { Database } from "../../db/connection";
import { installManifest } from "../../db/schema/ops";
import { releaseBundle } from "../../db/schema/fleet";
import type { InstallManifest } from "@smp/factory-shared/install-types";
import type { InstallManifestSpec } from "@smp/factory-shared/schemas/ops";

// ---------------------------------------------------------------------------
// Install Manifest CRUD — v2: ops schema, spec JSONB
// ---------------------------------------------------------------------------

export async function listInstallManifests(db: Database) {
  const rows = await db.select().from(installManifest).orderBy(desc(installManifest.updatedAt));
  return { data: rows, total: rows.length };
}

export async function getInstallManifestBySite(db: Database, siteId: string) {
  const [row] = await db
    .select()
    .from(installManifest)
    .where(eq(installManifest.siteId, siteId))
    .limit(1);
  return row ?? null;
}

export async function upsertInstallManifest(
  db: Database,
  siteId: string,
  manifest: InstallManifest,
) {
  const existing = await getInstallManifestBySite(db, siteId);
  const specData: InstallManifestSpec = {
    installState: manifest as unknown as Record<string, unknown>,
    lastCheckinAt: new Date(),
    currentVersion: manifest.version,
  };

  if (existing) {
    const [row] = await db
      .update(installManifest)
      .set({ spec: specData, updatedAt: new Date() })
      .where(eq(installManifest.siteId, siteId))
      .returning();
    return row;
  }

  const [row] = await db
    .insert(installManifest)
    .values({ siteId, spec: specData })
    .returning();
  return row;
}

// ---------------------------------------------------------------------------
// Release Bundle CRUD — v1 compat (still uses fleet.release_bundle table)
// Will be migrated to v2 when release bundle concept is folded into release spec.
// ---------------------------------------------------------------------------

export async function listReleaseBundles(
  db: Database,
  opts?: { releaseId?: string; status?: string; role?: string },
) {
  let query = db.select().from(releaseBundle).$dynamic();
  if (opts?.releaseId) query = query.where(eq(releaseBundle.releaseId, opts.releaseId));
  if (opts?.status) query = query.where(eq(releaseBundle.status, opts.status));
  if (opts?.role) query = query.where(eq(releaseBundle.role, opts.role));
  const rows = await query.orderBy(desc(releaseBundle.createdAt));
  return { data: rows, total: rows.length };
}

export async function getReleaseBundleById(db: Database, id: string) {
  const [row] = await db.select().from(releaseBundle).where(eq(releaseBundle.releaseBundleId, id)).limit(1);
  return row ?? null;
}

export async function createReleaseBundle(
  db: Database,
  input: {
    releaseId: string;
    role: string;
    arch?: string;
    dxVersion: string;
    k3sVersion: string;
    helmChartVersion: string;
    createdBy: string;
  },
) {
  const [row] = await db
    .insert(releaseBundle)
    .values({
      releaseId: input.releaseId,
      role: input.role,
      arch: input.arch ?? "amd64",
      dxVersion: input.dxVersion,
      k3sVersion: input.k3sVersion,
      helmChartVersion: input.helmChartVersion,
      createdBy: input.createdBy,
    })
    .returning();
  return row;
}

export async function updateReleaseBundleStatus(
  db: Database,
  id: string,
  updates: {
    status: string;
    imageCount?: number;
    sizeBytes?: number;
    checksumSha256?: string;
    storagePath?: string;
    completedAt?: Date;
  },
) {
  const setValues: Record<string, unknown> = { status: updates.status };
  if (updates.imageCount !== undefined) setValues.imageCount = updates.imageCount;
  if (updates.sizeBytes !== undefined) setValues.sizeBytes = String(updates.sizeBytes);
  if (updates.checksumSha256 !== undefined) setValues.checksumSha256 = updates.checksumSha256;
  if (updates.storagePath !== undefined) setValues.storagePath = updates.storagePath;
  if (updates.completedAt !== undefined) setValues.completedAt = updates.completedAt;

  const [row] = await db
    .update(releaseBundle)
    .set(setValues)
    .where(eq(releaseBundle.releaseBundleId, id))
    .returning();
  return row;
}
