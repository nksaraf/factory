import { eq, and } from "drizzle-orm";
import type { Database } from "../../db/connection";
import {
  workTrackerProvider,
  workTrackerProjectMapping,
  workItem,
} from "../../db/schema/product";
import { getWorkTrackerAdapter } from "../../adapters/adapter-registry";
import type {
  WorkTrackerSyncResult,
  PushResult,
  PushWorkItemSpec,
} from "../../adapters/work-tracker-adapter";
import { newId } from "../../lib/id";
import { allocateSlug } from "../../lib/slug";
import { logger } from "../../logger";

// ---------------------------------------------------------------------------
// Status & kind mapping helpers
// ---------------------------------------------------------------------------

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
};

function mapExternalStatus(raw: string): string {
  return STATUS_MAP[raw.toLowerCase()] ?? "backlog";
}

const KIND_MAP: Record<string, string> = {
  epic: "epic",
  story: "story",
  task: "task",
  bug: "bug",
  "sub-task": "task",
  subtask: "task",
  feature: "story",
};

function mapExternalKind(raw: string): string {
  return KIND_MAP[raw.toLowerCase()] ?? "task";
}

// ---------------------------------------------------------------------------
// Provider CRUD
// ---------------------------------------------------------------------------

export async function listWorkTrackerProviders(
  db: Database,
  filters?: { status?: string }
) {
  let query = db.select().from(workTrackerProvider);
  if (filters?.status) {
    query = query.where(eq(workTrackerProvider.status, filters.status)) as any;
  }
  const rows = await query;
  return { data: rows, total: rows.length };
}

export async function getWorkTrackerProvider(db: Database, id: string) {
  const rows = await db
    .select()
    .from(workTrackerProvider)
    .where(eq(workTrackerProvider.workTrackerProviderId, id));
  return rows[0] ?? null;
}

export async function createWorkTrackerProvider(
  db: Database,
  data: {
    name: string;
    kind: string;
    apiUrl: string;
    credentialsRef?: string;
    defaultProjectKey?: string;
  }
) {
  const slug = await allocateSlug({
    baseLabel: data.name,
    isTaken: async (s) => {
      const existing = await db
        .select()
        .from(workTrackerProvider)
        .where(eq(workTrackerProvider.slug, s));
      return existing.length > 0;
    },
  });
  const rows = await db
    .insert(workTrackerProvider)
    .values({ ...data, slug })
    .returning();
  return rows[0];
}

export async function updateWorkTrackerProvider(
  db: Database,
  id: string,
  patch: {
    name?: string;
    apiUrl?: string;
    credentialsRef?: string;
    defaultProjectKey?: string;
    status?: string;
    syncEnabled?: boolean;
    syncIntervalMinutes?: number;
  }
) {
  const rows = await db
    .update(workTrackerProvider)
    .set(patch)
    .where(eq(workTrackerProvider.workTrackerProviderId, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteWorkTrackerProvider(db: Database, id: string) {
  const rows = await db
    .delete(workTrackerProvider)
    .where(eq(workTrackerProvider.workTrackerProviderId, id))
    .returning();
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

export async function testWorkTrackerConnection(
  db: Database,
  id: string
): Promise<{ ok: boolean; error?: string }> {
  const prov = await getWorkTrackerProvider(db, id);
  if (!prov) return { ok: false, error: "provider not found" };
  const adapter = getWorkTrackerAdapter(prov.kind);
  return adapter.testConnection(prov.apiUrl, prov.credentialsRef ?? "");
}

// ---------------------------------------------------------------------------
// Project mapping CRUD
// ---------------------------------------------------------------------------

export async function listProjectMappings(db: Database, providerId: string) {
  const rows = await db
    .select()
    .from(workTrackerProjectMapping)
    .where(
      eq(workTrackerProjectMapping.workTrackerProviderId, providerId)
    );
  return { data: rows, total: rows.length };
}

export async function createProjectMapping(
  db: Database,
  data: {
    workTrackerProviderId: string;
    moduleId: string;
    externalProjectId: string;
    externalProjectName?: string;
    syncDirection?: string;
    filterQuery?: string;
  }
) {
  const rows = await db
    .insert(workTrackerProjectMapping)
    .values(data)
    .returning();
  return rows[0];
}

export async function deleteProjectMapping(db: Database, mappingId: string) {
  const rows = await db
    .delete(workTrackerProjectMapping)
    .where(eq(workTrackerProjectMapping.mappingId, mappingId))
    .returning();
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// External projects (via adapter)
// ---------------------------------------------------------------------------

export async function listExternalProjects(db: Database, providerId: string) {
  const prov = await getWorkTrackerProvider(db, providerId);
  if (!prov) throw new Error("provider not found");
  const adapter = getWorkTrackerAdapter(prov.kind);
  return adapter.listProjects(prov.apiUrl, prov.credentialsRef ?? "");
}

// ---------------------------------------------------------------------------
// Sync (pull from external)
// ---------------------------------------------------------------------------

export async function syncWorkTracker(
  db: Database,
  providerId: string
): Promise<WorkTrackerSyncResult> {
  const prov = await getWorkTrackerProvider(db, providerId);
  if (!prov) throw new Error("provider not found");

  // Mark syncing
  await db
    .update(workTrackerProvider)
    .set({ syncStatus: "syncing", syncError: null })
    .where(eq(workTrackerProvider.workTrackerProviderId, providerId));

  try {
    const mappings = await db
      .select()
      .from(workTrackerProjectMapping)
      .where(
        eq(workTrackerProjectMapping.workTrackerProviderId, providerId)
      );

    const adapter = getWorkTrackerAdapter(prov.kind);
    let created = 0;
    let updated = 0;
    let total = 0;

    for (const mapping of mappings) {
      const issues = await adapter.fetchIssues(
        prov.apiUrl,
        prov.credentialsRef ?? "",
        mapping.externalProjectId,
        mapping.filterQuery ?? undefined
      );

      for (const issue of issues) {
        total++;

        // Check if work item already exists for this external issue
        const existing = await db
          .select()
          .from(workItem)
          .where(
            and(
              eq(workItem.externalId, issue.id),
              eq(workItem.workTrackerProviderId, providerId)
            )
          );

        if (existing.length > 0) {
          // Update existing
          await db
            .update(workItem)
            .set({
              title: issue.title,
              description: issue.description,
              status: mapExternalStatus(issue.status),
              kind: mapExternalKind(issue.kind),
              priority: issue.priority,
              assignee: issue.assignee,
              labels: issue.labels,
              externalKey: issue.key,
              externalUrl: issue.url,
              updatedAt: new Date(),
            })
            .where(eq(workItem.workItemId, existing[0]!.workItemId));
          updated++;
        } else {
          // Create new
          await db.insert(workItem).values({
            moduleId: mapping.moduleId,
            title: issue.title,
            description: issue.description,
            status: mapExternalStatus(issue.status),
            kind: mapExternalKind(issue.kind),
            priority: issue.priority,
            assignee: issue.assignee,
            labels: issue.labels,
            externalId: issue.id,
            externalKey: issue.key,
            externalUrl: issue.url,
            workTrackerProviderId: providerId,
          });
          created++;
        }
      }
    }

    // Mark idle
    await db
      .update(workTrackerProvider)
      .set({ syncStatus: "idle", lastSyncAt: new Date() })
      .where(eq(workTrackerProvider.workTrackerProviderId, providerId));

    return { created, updated, total };
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : String(err);
    await db
      .update(workTrackerProvider)
      .set({ syncStatus: "error", syncError: errorMessage })
      .where(eq(workTrackerProvider.workTrackerProviderId, providerId));
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Push (single item to external)
// ---------------------------------------------------------------------------

export async function pushWorkItem(
  db: Database,
  workItemId: string,
  providerId: string
): Promise<PushResult> {
  const prov = await getWorkTrackerProvider(db, providerId);
  if (!prov) throw new Error("provider not found");

  const items = await db
    .select()
    .from(workItem)
    .where(eq(workItem.workItemId, workItemId));
  const item = items[0];
  if (!item) throw new Error("work item not found");

  // Find mapping for this work item's module
  const mappings = item.moduleId
    ? await db
        .select()
        .from(workTrackerProjectMapping)
        .where(
          and(
            eq(workTrackerProjectMapping.workTrackerProviderId, providerId),
            eq(workTrackerProjectMapping.moduleId, item.moduleId)
          )
        )
    : [];
  const mapping = mappings[0];
  const projectId =
    mapping?.externalProjectId ?? prov.defaultProjectKey ?? "";

  const adapter = getWorkTrackerAdapter(prov.kind);
  const spec: PushWorkItemSpec = {
    title: item.title,
    description: item.description ?? undefined,
    kind: item.kind,
    priority: item.priority ?? undefined,
    assignee: item.assignee ?? undefined,
    labels: (item.labels as string[]) ?? [],
  };

  const result = await adapter.pushIssue(
    prov.apiUrl,
    prov.credentialsRef ?? "",
    projectId,
    spec
  );

  // Update work item with external references
  await db
    .update(workItem)
    .set({
      externalId: result.externalId,
      externalKey: result.externalKey,
      externalUrl: result.externalUrl,
      workTrackerProviderId: providerId,
      updatedAt: new Date(),
    })
    .where(eq(workItem.workItemId, workItemId));

  return result;
}

// ---------------------------------------------------------------------------
// Agentic: PRD → Epic + Stories
// ---------------------------------------------------------------------------

export async function createEpicFromPrd(
  db: Database,
  providerId: string,
  moduleId: string,
  epic: { title: string; description: string },
  stories: Array<{
    title: string;
    description: string;
    kind?: string;
    priority?: string;
  }>
): Promise<{ epicWorkItemId: string; storyWorkItemIds: string[] }> {
  const prov = await getWorkTrackerProvider(db, providerId);
  if (!prov) throw new Error("provider not found");

  // Find mapping for module
  const mappings = await db
    .select()
    .from(workTrackerProjectMapping)
    .where(
      and(
        eq(workTrackerProjectMapping.workTrackerProviderId, providerId),
        eq(workTrackerProjectMapping.moduleId, moduleId)
      )
    );
  const mapping = mappings[0];
  const projectId =
    mapping?.externalProjectId ?? prov.defaultProjectKey ?? "";

  const adapter = getWorkTrackerAdapter(prov.kind);

  // 1. Push epic to external
  const epicResult = await adapter.pushIssue(
    prov.apiUrl,
    prov.credentialsRef ?? "",
    projectId,
    {
      title: epic.title,
      description: epic.description,
      kind: "epic",
    }
  );

  // 2. Insert local epic work item
  const epicWorkItemId = newId("wi");
  await db.insert(workItem).values({
    workItemId: epicWorkItemId,
    moduleId,
    title: epic.title,
    description: epic.description,
    kind: "epic",
    status: "backlog",
    externalId: epicResult.externalId,
    externalKey: epicResult.externalKey,
    externalUrl: epicResult.externalUrl,
    workTrackerProviderId: providerId,
  });

  // 3. Push stories to external with parent link
  const storySpecs: PushWorkItemSpec[] = stories.map((s) => ({
    title: s.title,
    description: s.description,
    kind: s.kind ?? "story",
    priority: s.priority,
    parentExternalId: epicResult.externalId,
  }));

  const storyResults = await adapter.pushIssues(
    prov.apiUrl,
    prov.credentialsRef ?? "",
    projectId,
    storySpecs
  );

  // 4. Insert local story work items
  const storyWorkItemIds: string[] = [];
  for (let i = 0; i < stories.length; i++) {
    const storyId = newId("wi");
    storyWorkItemIds.push(storyId);
    await db.insert(workItem).values({
      workItemId: storyId,
      moduleId,
      title: stories[i]!.title,
      description: stories[i]!.description,
      kind: stories[i]!.kind ?? "story",
      priority: stories[i]!.priority,
      status: "backlog",
      parentWorkItemId: epicWorkItemId,
      externalId: storyResults[i]!.externalId,
      externalKey: storyResults[i]!.externalKey,
      externalUrl: storyResults[i]!.externalUrl,
      workTrackerProviderId: providerId,
    });
  }

  logger.info(
    {
      epicWorkItemId,
      storyCount: storyWorkItemIds.length,
      providerId,
      moduleId,
    },
    "created epic from PRD"
  );

  return { epicWorkItemId, storyWorkItemIds };
}
