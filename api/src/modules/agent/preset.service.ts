import { eq, and, isNull } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { rolePreset } from "../../db/schema/org-v2";
import type { RolePresetSpec } from "@smp/factory-shared/schemas/org";
import { allocateSlug } from "../../lib/slug";

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listRolePresets(
  db: Database,
  filters?: { orgId?: string },
) {
  const rows = filters?.orgId
    ? await db
        .select()
        .from(rolePreset)
        .where(eq(rolePreset.orgId, filters.orgId))
    : await db.select().from(rolePreset);
  return { data: rows, total: rows.length };
}

export async function getRolePreset(db: Database, idOrSlug: string) {
  let rows = await db
    .select()
    .from(rolePreset)
    .where(eq(rolePreset.id, idOrSlug));
  if (rows.length === 0) {
    rows = await db
      .select()
      .from(rolePreset)
      .where(eq(rolePreset.slug, idOrSlug));
  }
  return rows[0] ?? null;
}

export async function createRolePreset(
  db: Database,
  data: {
    name: string;
    slug?: string;
    orgId?: string;
    description?: string;
    defaults: Record<string, unknown>;
  },
) {
  const slug = await allocateSlug({
    baseLabel: data.name,
    explicitSlug: data.slug,
    isTaken: async (s) => {
      const existing = await db
        .select()
        .from(rolePreset)
        .where(eq(rolePreset.slug, s));
      return existing.length > 0;
    },
  });

  const rows = await db
    .insert(rolePreset)
    .values({
      name: data.name,
      slug,
      orgId: data.orgId ?? null,
      spec: {
        description: data.description,
        defaults: data.defaults,
      } as RolePresetSpec,
    })
    .returning();
  return rows[0];
}

export async function updateRolePreset(
  db: Database,
  id: string,
  data: {
    name?: string;
    description?: string;
    defaults?: Record<string, unknown>;
  },
) {
  const existing = await getRolePreset(db, id);
  if (!existing) return null;

  const currentSpec = (existing.spec ?? {}) as RolePresetSpec;
  const updatedSpec: RolePresetSpec = {
    ...currentSpec,
    ...(data.description !== undefined && { description: data.description }),
    ...(data.defaults !== undefined && { defaults: data.defaults }),
  };

  const rows = await db
    .update(rolePreset)
    .set({
      ...(data.name !== undefined && { name: data.name }),
      spec: updatedSpec,
    })
    .where(eq(rolePreset.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteRolePreset(db: Database, id: string) {
  await db.delete(rolePreset).where(eq(rolePreset.id, id));
}

// ---------------------------------------------------------------------------
// Seed platform defaults
// ---------------------------------------------------------------------------

const PLATFORM_PRESETS = [
  {
    name: "Engineer",
    slug: "engineer",
    spec: {
      description: "Writes code, fixes bugs",
      defaults: {
        autonomyLevel: "executor",
        collaborationMode: "solo",
        capabilities: { tools: ["github", "sandbox"] },
      },
    },
  },
  {
    name: "Reviewer",
    slug: "reviewer",
    spec: {
      description: "Reviews PRs, suggests changes",
      defaults: {
        autonomyLevel: "advisor",
        collaborationMode: "pair",
        capabilities: { tools: ["github"] },
      },
    },
  },
  {
    name: "PM",
    slug: "pm",
    spec: {
      description: "Requirements → PRDs → plans",
      defaults: {
        autonomyLevel: "advisor",
        collaborationMode: "solo",
        capabilities: { tools: ["jira", "docs"] },
      },
    },
  },
  {
    name: "QA",
    slug: "qa",
    spec: {
      description: "Writes and runs tests",
      defaults: {
        autonomyLevel: "executor",
        collaborationMode: "solo",
        capabilities: { tools: ["sandbox", "test"] },
      },
    },
  },
  {
    name: "Ops",
    slug: "ops",
    spec: {
      description: "Infra, deploys, monitoring",
      defaults: {
        autonomyLevel: "operator",
        collaborationMode: "solo",
        capabilities: { tools: ["k8s", "deploy"] },
      },
    },
  },
  {
    name: "Observer",
    slug: "observer",
    spec: {
      description: "Watches, reports, never acts",
      defaults: {
        autonomyLevel: "observer",
        collaborationMode: "solo",
        capabilities: { tools: [] },
      },
    },
  },
  {
    name: "Supervisor",
    slug: "supervisor",
    spec: {
      description: "Decomposes, delegates, reviews",
      defaults: {
        autonomyLevel: "supervisor",
        collaborationMode: "hierarchy",
        capabilities: { tools: ["github", "jira", "sandbox"] },
      },
    },
  },
  {
    name: "Standup",
    slug: "standup",
    spec: {
      description: "Collects standups, summarizes",
      defaults: {
        autonomyLevel: "operator",
        collaborationMode: "crew",
        capabilities: { tools: ["slack", "jira"] },
      },
    },
  },
  {
    name: "Taskmaster",
    slug: "taskmaster",
    spec: {
      description: "Manages tasks, tracks progress",
      defaults: {
        autonomyLevel: "operator",
        collaborationMode: "hierarchy",
        capabilities: { tools: ["jira", "github"] },
      },
    },
  },
  {
    name: "Marketing",
    slug: "marketing",
    spec: {
      description: "Content, messaging, campaigns",
      defaults: {
        autonomyLevel: "advisor",
        collaborationMode: "solo",
        capabilities: { tools: ["docs"] },
      },
    },
  },
];

export async function seedPlatformPresets(db: Database) {
  for (const preset of PLATFORM_PRESETS) {
    const existing = await db
      .select()
      .from(rolePreset)
      .where(
        and(eq(rolePreset.slug, preset.slug), isNull(rolePreset.orgId)),
      )
      .limit(1);

    if (existing.length === 0) {
      await db.insert(rolePreset).values({
        name: preset.name,
        slug: preset.slug,
        orgId: null,
        spec: preset.spec as unknown as RolePresetSpec,
      });
    }
  }
}
