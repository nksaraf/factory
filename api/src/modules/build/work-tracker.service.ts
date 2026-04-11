import type {
  WorkItemSpec,
  WorkTrackerProjectSpec,
  WorkTrackerProviderSpec,
} from "@smp/factory-shared/schemas/build"
import { and, eq, inArray, notInArray } from "drizzle-orm"

import { getWorkTrackerAdapter } from "../../adapters/adapter-registry"
import type {
  ExternalProject,
  WorkTrackerAdapter,
  WorkTrackerSyncResult,
  WorkTrackerType,
} from "../../adapters/work-tracker-adapter"
import type { Database } from "../../db/connection"
import {
  workItem,
  workTrackerProject,
  workTrackerProjectMapping,
  workTrackerProvider,
} from "../../db/schema/build"
import { allocateSlug } from "../../lib/slug"

const STATUS_MAP: Record<string, string> = {
  "to do": "backlog",
  backlog: "backlog",
  open: "backlog",
  ready: "ready",
  "selected for development": "ready",
  "in progress": "in_progress",
  "in development": "in_progress",
  "in review": "in_review",
  review: "in_review",
  done: "done",
  closed: "done",
  resolved: "done",
}

const KIND_MAP: Record<string, string> = {
  epic: "epic",
  story: "story",
  task: "task",
  bug: "bug",
  "sub-task": "task",
  subtask: "task",
  feature: "story",
}

export interface WorkTrackerProjectSyncResult {
  created: number
  updated: number
  removed: number
  total: number
}

export interface WorkTrackerFullSyncResult {
  projects: WorkTrackerProjectSyncResult
  items: WorkTrackerSyncResult
}

function mapExternalStatus(raw: string): string {
  return STATUS_MAP[raw.toLowerCase()] ?? "backlog"
}

function mapExternalKind(raw: string): "epic" | "story" | "task" | "bug" {
  const mapped = KIND_MAP[raw.toLowerCase()] ?? "task"
  return mapped as "epic" | "story" | "task" | "bug"
}

function mapExternalPriority(
  raw?: string | null
): WorkItemSpec["priority"] | undefined {
  if (!raw) return undefined
  const normalized = raw.toLowerCase()
  if (normalized.includes("highest") || normalized.includes("critical")) {
    return "critical"
  }
  if (normalized.includes("high")) return "high"
  if (normalized.includes("low")) return "low"
  if (normalized.includes("none")) return "none"
  return "medium"
}

function providerSpec(provider: { spec: unknown }): WorkTrackerProviderSpec {
  return (provider.spec ?? {}) as WorkTrackerProviderSpec
}

/** Resolve the credentials string the adapter expects (e.g. base64 for Jira Basic auth). */
function resolveCredentials(
  type: string,
  spec: WorkTrackerProviderSpec
): string {
  const token = spec.credentialsRef ?? ""
  if (type === "jira" && spec.adminEmail) {
    return Buffer.from(`${spec.adminEmail}:${token}`).toString("base64")
  }
  return token
}

async function projectSlug(
  db: Database,
  providerSlug: string,
  project: ExternalProject
): Promise<string> {
  return allocateSlug({
    baseLabel: `${providerSlug}-${project.key || project.name}`,
    isTaken: async (slug) => {
      const [existing] = await db
        .select({ id: workTrackerProject.id })
        .from(workTrackerProject)
        .where(eq(workTrackerProject.slug, slug))
        .limit(1)
      return existing != null
    },
  })
}

function projectSpec(project: ExternalProject): WorkTrackerProjectSpec {
  return {
    key: project.key,
  }
}

function itemSpec(issue: {
  title: string
  description?: string | null
  priority?: string | null
  url: string
}): WorkItemSpec {
  const priority = mapExternalPriority(issue.priority) ?? "medium"
  return {
    title: issue.title,
    priority,
    ...(issue.description ? { description: issue.description } : {}),
    url: issue.url,
  }
}

export async function syncProjects(
  db: Database,
  providerId: string,
  opts?: { adapter?: WorkTrackerAdapter }
): Promise<WorkTrackerProjectSyncResult> {
  const [provider] = await db
    .select()
    .from(workTrackerProvider)
    .where(eq(workTrackerProvider.id, providerId))
    .limit(1)
  if (!provider)
    throw new Error(`Work tracker provider not found: ${providerId}`)

  const spec = providerSpec(provider)
  const adapter =
    opts?.adapter ?? getWorkTrackerAdapter(provider.type as WorkTrackerType)
  const creds = resolveCredentials(provider.type, spec)
  const remoteProjects = await adapter.listProjects(spec.apiUrl, creds)

  // Fetch all existing projects for this provider in one query
  const existing = await db
    .select()
    .from(workTrackerProject)
    .where(eq(workTrackerProject.workTrackerProviderId, providerId))
  const existingByExtId = new Map(existing.map((p) => [p.externalId, p]))

  let created = 0
  let updated = 0

  // Upsert each project (slug allocation requires per-row for new projects)
  for (const project of remoteProjects) {
    const ex = existingByExtId.get(project.id)
    if (!ex) {
      await db.insert(workTrackerProject).values({
        slug: await projectSlug(db, provider.slug, project),
        name: project.name,
        workTrackerProviderId: providerId,
        externalId: project.id,
        spec: projectSpec(project),
      })
      created++
    } else {
      await db
        .update(workTrackerProject)
        .set({
          name: project.name,
          spec: projectSpec(project),
          updatedAt: new Date(),
        })
        .where(eq(workTrackerProject.id, ex.id))
      updated++
    }
  }

  // Remove projects no longer in the remote
  const remoteExtIds = remoteProjects.map((p) => p.id)
  const staleIds = existing
    .filter((p) => !remoteExtIds.includes(p.externalId))
    .map((p) => p.id)
  let removed = 0
  if (staleIds.length > 0) {
    await db
      .delete(workTrackerProject)
      .where(inArray(workTrackerProject.id, staleIds))
    removed = staleIds.length
  }

  return { created, updated, removed, total: remoteProjects.length }
}

export async function syncWorkTracker(
  db: Database,
  providerId: string,
  opts?: { adapter?: WorkTrackerAdapter }
): Promise<WorkTrackerFullSyncResult> {
  const [provider] = await db
    .select()
    .from(workTrackerProvider)
    .where(eq(workTrackerProvider.id, providerId))
    .limit(1)
  if (!provider)
    throw new Error(`Work tracker provider not found: ${providerId}`)

  const spec = providerSpec(provider)
  const adapter =
    opts?.adapter ?? getWorkTrackerAdapter(provider.type as WorkTrackerType)

  await db
    .update(workTrackerProvider)
    .set({
      spec: {
        ...spec,
        syncStatus: "syncing",
      } satisfies WorkTrackerProviderSpec,
      updatedAt: new Date(),
    })
    .where(eq(workTrackerProvider.id, providerId))

  try {
    const projects = await syncProjects(db, providerId, { adapter })
    const mappings = await db
      .select()
      .from(workTrackerProjectMapping)
      .where(eq(workTrackerProjectMapping.workTrackerProviderId, providerId))

    // Fetch all existing work items for this provider in one query
    const existingItems = await db
      .select()
      .from(workItem)
      .where(eq(workItem.workTrackerProviderId, providerId))
    const existingByExtId = new Map(existingItems.map((i) => [i.externalId, i]))

    let created = 0
    let updated = 0
    let total = 0
    const creds = resolveCredentials(provider.type, spec)
    const seenExtIds = new Set<string>()

    for (const mapping of mappings) {
      const issues = await adapter.fetchIssues(
        spec.apiUrl,
        creds,
        mapping.externalProjectId
      )

      for (const issue of issues) {
        total++
        seenExtIds.add(issue.id)
        const ex = existingByExtId.get(issue.id)

        if (!ex) {
          await db.insert(workItem).values({
            type: mapExternalKind(issue.kind),
            systemId: mapping.systemId,
            workTrackerProviderId: providerId,
            status: mapExternalStatus(issue.status),
            externalId: issue.id,
            assignee: issue.assignee ?? null,
            spec: itemSpec(issue),
          })
          created++
        } else {
          await db
            .update(workItem)
            .set({
              type: mapExternalKind(issue.kind),
              systemId: mapping.systemId,
              status: mapExternalStatus(issue.status),
              assignee: issue.assignee ?? null,
              spec: itemSpec(issue),
              updatedAt: new Date(),
            })
            .where(eq(workItem.id, ex.id))
          updated++
        }
      }
    }

    // Remove items no longer present in the remote
    const staleIds = existingItems
      .filter((i) => !seenExtIds.has(i.externalId))
      .map((i) => i.id)
    let removed = 0
    if (staleIds.length > 0) {
      await db.delete(workItem).where(inArray(workItem.id, staleIds))
      removed = staleIds.length
    }

    await db
      .update(workTrackerProvider)
      .set({
        spec: {
          ...spec,
          syncStatus: "idle",
          lastSyncAt: new Date(),
        } satisfies WorkTrackerProviderSpec,
        updatedAt: new Date(),
      })
      .where(eq(workTrackerProvider.id, providerId))

    return {
      projects,
      items: { created, updated, removed, total },
    }
  } catch (error) {
    await db
      .update(workTrackerProvider)
      .set({
        spec: {
          ...spec,
          syncStatus: "error",
          lastSyncAt: new Date(),
        } satisfies WorkTrackerProviderSpec,
        updatedAt: new Date(),
      })
      .where(eq(workTrackerProvider.id, providerId))
    throw error
  }
}
