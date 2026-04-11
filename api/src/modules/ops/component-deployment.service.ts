import { eq } from "drizzle-orm"

import type { Database } from "../../db/connection"
import { componentDeployment } from "../../db/schema/ops"

// ---------------------------------------------------------------------------
// Component Deployment CRUD
// ---------------------------------------------------------------------------

export async function listComponentDeployments(
  db: Database,
  systemDeploymentId: string
) {
  const rows = await db
    .select()
    .from(componentDeployment)
    .where(eq(componentDeployment.systemDeploymentId, systemDeploymentId))

  return { data: rows, total: rows.length }
}

/** @deprecated Use listComponentDeployments */
export const listWorkloads = listComponentDeployments

export async function createComponentDeployment(
  db: Database,
  input: {
    systemDeploymentId: string
    componentId: string
    artifactId?: string
    desiredImage?: string
    replicas?: number
    envOverrides?: Record<string, unknown>
    resourceOverrides?: Record<string, unknown>
    desiredArtifactUri?: string
  }
) {
  const [row] = await db
    .insert(componentDeployment)
    .values({
      systemDeploymentId: input.systemDeploymentId,
      componentId: input.componentId,
      artifactId: input.artifactId ?? null,
      spec: {
        desiredImage: input.desiredImage,
        replicas: input.replicas ?? 1,
        envOverrides: input.envOverrides ?? {},
        resourceOverrides: input.resourceOverrides ?? {},
        desiredArtifactUri: input.desiredArtifactUri ?? null,
        status: "pending",
      } as any,
    })
    .returning()

  return row
}

/** @deprecated Use createComponentDeployment */
export const createWorkload = createComponentDeployment

export async function getComponentDeployment(db: Database, id: string) {
  const [row] = await db
    .select()
    .from(componentDeployment)
    .where(eq(componentDeployment.id, id))
    .limit(1)

  return row ?? null
}

/** @deprecated Use getComponentDeployment */
export const getWorkload = getComponentDeployment

export async function updateComponentDeployment(
  db: Database,
  id: string,
  updates: Partial<{
    replicas: number
    desiredImage: string
    envOverrides: Record<string, unknown>
    resourceOverrides: Record<string, unknown>
    status: string
    actualImage: string
    driftDetected: boolean
    lastReconciledAt: Date
  }>
) {
  const [existing] = await db
    .select()
    .from(componentDeployment)
    .where(eq(componentDeployment.id, id))
    .limit(1)

  if (!existing) throw new Error(`Component deployment not found: ${id}`)

  const newSpec = {
    ...(existing.spec as any),
    ...(updates.replicas !== undefined ? { replicas: updates.replicas } : {}),
    ...(updates.desiredImage !== undefined
      ? { desiredImage: updates.desiredImage }
      : {}),
    ...(updates.envOverrides !== undefined
      ? { envOverrides: updates.envOverrides }
      : {}),
    ...(updates.resourceOverrides !== undefined
      ? { resourceOverrides: updates.resourceOverrides }
      : {}),
    ...(updates.status !== undefined ? { status: updates.status } : {}),
    ...(updates.actualImage !== undefined
      ? { actualImage: updates.actualImage }
      : {}),
    ...(updates.driftDetected !== undefined
      ? { driftDetected: updates.driftDetected }
      : {}),
    ...(updates.lastReconciledAt !== undefined
      ? { lastReconciledAt: updates.lastReconciledAt.toISOString() }
      : {}),
  }

  const [updated] = await db
    .update(componentDeployment)
    .set({ spec: newSpec as any, updatedAt: new Date() })
    .where(eq(componentDeployment.id, id))
    .returning()

  return updated
}

/** @deprecated Use updateComponentDeployment */
export const updateWorkload = updateComponentDeployment

export async function deleteComponentDeployment(db: Database, id: string) {
  const [deleted] = await db
    .delete(componentDeployment)
    .where(eq(componentDeployment.id, id))
    .returning()

  return deleted ?? null
}

/** @deprecated Use deleteComponentDeployment */
export const deleteWorkload = deleteComponentDeployment

// ---------------------------------------------------------------------------
// Workload Overrides — v2: stored in componentDeployment.spec.overrides
// ---------------------------------------------------------------------------

export async function createWorkloadOverride(
  db: Database,
  input: {
    workloadId: string
    field: string
    previousValue: unknown
    newValue: unknown
    reason: string
    createdBy: string
  }
) {
  const [row] = await db
    .select()
    .from(componentDeployment)
    .where(eq(componentDeployment.id, input.workloadId))
    .limit(1)

  if (!row)
    throw new Error(`Component deployment not found: ${input.workloadId}`)

  const overrides = (row.spec as any)?.overrides ?? []
  const override = {
    id: `ovr_${Date.now()}`,
    field: input.field,
    previousValue: input.previousValue,
    newValue: input.newValue,
    reason: input.reason,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
  }
  overrides.push(override)

  await db
    .update(componentDeployment)
    .set({ spec: { ...(row.spec as any), overrides } as any })
    .where(eq(componentDeployment.id, input.workloadId))

  return override
}

export async function revertWorkloadOverride(
  db: Database,
  componentDeploymentId: string,
  overrideId: string,
  revertedBy: string
) {
  const [row] = await db
    .select()
    .from(componentDeployment)
    .where(eq(componentDeployment.id, componentDeploymentId))
    .limit(1)

  if (!row)
    throw new Error(`Component deployment not found: ${componentDeploymentId}`)

  const overrides = ((row.spec as any)?.overrides ?? []).map((o: any) =>
    o.id === overrideId
      ? { ...o, revertedAt: new Date().toISOString(), revertedBy }
      : o
  )

  const [updated] = await db
    .update(componentDeployment)
    .set({ spec: { ...(row.spec as any), overrides } as any })
    .where(eq(componentDeployment.id, componentDeploymentId))
    .returning()

  return updated
}

export async function listWorkloadOverrides(
  db: Database,
  componentDeploymentId: string
) {
  const [row] = await db
    .select()
    .from(componentDeployment)
    .where(eq(componentDeployment.id, componentDeploymentId))
    .limit(1)

  const overrides = (row?.spec as any)?.overrides ?? []
  return { data: overrides, total: overrides.length }
}
