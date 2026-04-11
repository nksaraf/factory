import { desc, eq } from "drizzle-orm"

import type { Database } from "../../db/connection"
import { intervention } from "../../db/schema/ops"

// ---------------------------------------------------------------------------
// Interventions — type is column; action, principalId, reason → spec JSONB
// ---------------------------------------------------------------------------

export async function createIntervention(
  db: Database,
  input: {
    systemDeploymentId: string
    componentDeploymentId?: string
    workloadId?: string
    action: string
    principalId: string
    reason: string
    details?: Record<string, unknown>
  }
) {
  const typeMap: Record<string, string> = {
    restart: "restart",
    scale: "scale",
    rollback: "rollback",
  }
  const type = typeMap[input.action] ?? "manual"

  const [row] = await db
    .insert(intervention)
    .values({
      type,
      systemDeploymentId: input.systemDeploymentId,
      componentDeploymentId: input.componentDeploymentId ?? input.workloadId,
      spec: {
        action: input.action,
        principalId: input.principalId,
        reason: input.reason,
        details: input.details ?? {},
      } as any,
    })
    .returning()

  return row
}

export async function listInterventions(
  db: Database,
  systemDeploymentId: string
) {
  const rows = await db
    .select()
    .from(intervention)
    .where(eq(intervention.systemDeploymentId, systemDeploymentId))
    .orderBy(desc(intervention.createdAt))

  return { data: rows, total: rows.length }
}
